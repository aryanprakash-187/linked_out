// Background service worker. Receives posts from the content script that
// need an AI verdict (feature 3), batches them, asks the configured model,
// caches the answers, and records the last error for the popup.
importScripts('../vendor/anthropic-sdk.js', '../shared/settings.js', '../shared/prompt.js', '../shared/chrome-ai.js');

const control = globalThis.control;
const S = control.settings;
const P = control.prompt;

const BATCH_SIZE = 8;
const BATCH_WAIT_MS = 350; // gather posts that load together into one request
const MAX_CONCURRENT = 2;
const AI_TIMEOUT_MS = 25000;
const CACHE_KEY = 'controlVerdicts';
const CACHE_MAX = 3000;

// Server-side refusal fallbacks are available for these models.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

class ControlError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ---------- verdict cache (persists across service worker restarts) ----------

let cache = null;
let cacheWriteTimer = null;

async function getCache() {
  if (!cache) {
    const got = await chrome.storage.local.get(CACHE_KEY);
    cache = new Map(Object.entries(got[CACHE_KEY] || {}));
  }
  return cache;
}

function persistCacheSoon() {
  if (cacheWriteTimer) return;
  cacheWriteTimer = setTimeout(async () => {
    cacheWriteTimer = null;
    const entries = [...cache.entries()].sort((a, b) => b[1].t - a[1].t).slice(0, CACHE_MAX);
    cache = new Map(entries);
    await chrome.storage.local.set({ [CACHE_KEY]: Object.fromEntries(entries) });
  }, 1000);
}

// ---------- status for the popup / options page ----------

async function setStatus(patch) {
  const got = await chrome.storage.local.get(S.STATUS_KEY);
  await chrome.storage.local.set({ [S.STATUS_KEY]: Object.assign({}, got[S.STATUS_KEY], patch) });
}

// ---------- providers ----------

function describeAnthropicError(err) {
  const A = globalThis.Anthropic;
  if (err instanceof A.AuthenticationError) return new ControlError('auth', 'Your Anthropic API key was rejected.');
  if (err instanceof A.PermissionDeniedError)
    return new ControlError('permission', "Your API key can't use this model.");
  if (err instanceof A.NotFoundError)
    return new ControlError('model', 'Model not found. Pick another model in settings.');
  if (err instanceof A.RateLimitError)
    return new ControlError('rate-limit', 'Rate limited by the Anthropic API. Try again shortly.');
  if (err instanceof A.BadRequestError)
    return new ControlError('bad-request', 'Anthropic API rejected the request: ' + err.message);
  if (err instanceof A.APIConnectionError) return new ControlError('network', "Couldn't reach the Anthropic API.");
  if (err instanceof A.APIError) return new ControlError('api', `Anthropic API error ${err.status}: ${err.message}`);
  return new ControlError('unknown', String(err && err.message ? err.message : err));
}

async function classifyWithAnthropic(posts, settings) {
  const secrets = await S.loadSecrets();
  if (!secrets.anthropicApiKey) {
    throw new ControlError('no-api-key', 'Add your Anthropic API key in control. settings to use the AI filter.');
  }
  const client = new globalThis.Anthropic({
    apiKey: secrets.anthropicApiKey,
    baseURL: secrets.anthropicBaseUrl || undefined,
    dangerouslyAllowBrowser: true, // the key is the user's own, stored in their browser
    maxRetries: 1,
  });
  const model = settings.aiFilter.model;
  const params = {
    model,
    max_tokens: 4000,
    system: P.buildSystemPrompt(settings.aiFilter.instructions),
    messages: [{ role: 'user', content: P.buildUserMessage(posts) }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: P.VERDICT_SCHEMA } },
  };
  let response;
  try {
    response = FALLBACK_MODELS.has(model)
      ? await client.beta.messages.create({
          ...params,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        })
      : await client.messages.create(params);
  } catch (err) {
    throw describeAnthropicError(err);
  }
  if (response.stop_reason === 'refusal') return new Map(); // fail open: show all
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return P.parseVerdicts(
    text,
    posts.map((p) => p.key),
  );
}

async function ensureOffscreen() {
  if (!chrome.offscreen) throw new ControlError('unsupported', "Chrome's built-in AI isn't available in this browser.");
  const url = chrome.runtime.getURL('offscreen/offscreen.html');
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
  if (existing.length) return;
  await chrome.offscreen.createDocument({
    url,
    reasons: ['WORKERS'],
    justification: "Run Chrome's built-in AI model to filter feed posts on-device.",
  });
}

async function classifyWithChromeAI(posts, settings) {
  const payload = {
    system: P.buildSystemPrompt(settings.aiFilter.instructions),
    user: P.buildUserMessage(posts),
    schema: P.VERDICT_SCHEMA,
  };
  let text;
  if (typeof globalThis.LanguageModel !== 'undefined') {
    text = await control.chromeAI.prompt(payload);
  } else {
    await ensureOffscreen();
    const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'control:chrome-ai-prompt', payload });
    if (!res || res.error) {
      throw new ControlError('chrome-ai', (res && res.error) || "Chrome's built-in AI didn't respond.");
    }
    text = res.text;
  }
  return P.parseVerdicts(
    text,
    posts.map((p) => p.key),
  );
}

function classify(posts, settings) {
  const run =
    settings.aiFilter.provider === 'chrome-ai'
      ? classifyWithChromeAI(posts, settings)
      : classifyWithAnthropic(posts, settings);
  // Shorter than the content script's own 30s limit, so the popup gets a
  // real explanation instead of a silent timeout.
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new ControlError('timeout', 'The AI model took too long to answer.')),
      AI_TIMEOUT_MS,
    );
  });
  return Promise.race([run, timeout]).finally(() => clearTimeout(timer));
}

// ---------- batching queue ----------

const queue = []; // { item, key, settings, resolve }
let flushTimer = null;
let inflight = 0;

function scheduleFlush() {
  if (flushTimer || !queue.length) return;
  const wait = queue.length >= BATCH_SIZE ? 0 : BATCH_WAIT_MS;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, wait);
}

async function flush() {
  while (queue.length && inflight < MAX_CONCURRENT) {
    const key = queue[0].key;
    const batch = [];
    for (let i = 0; i < queue.length && batch.length < BATCH_SIZE; ) {
      if (queue[i].key === key) batch.push(queue.splice(i, 1)[0]);
      else i++;
    }
    inflight++;
    runBatch(batch).finally(() => {
      inflight--;
      scheduleFlush();
    });
  }
}

async function runBatch(batch) {
  const settings = batch[0].settings;
  const posts = batch.map((b, i) => ({ key: 'p' + (i + 1), author: b.item.author, text: b.item.text }));
  try {
    const verdicts = await classify(posts, settings);
    const c = await getCache();
    const now = Date.now();
    batch.forEach((b, i) => {
      const v = verdicts.get('p' + (i + 1)) || { decision: 'show', reason: '' };
      c.set(b.key + ':' + b.item.id, { d: v.decision, r: v.reason, t: now });
      b.resolve({ key: b.key, decision: v.decision, reason: v.reason });
    });
    persistCacheSoon();
    setStatus({ lastOkAt: now, lastError: null });
  } catch (err) {
    const e =
      err instanceof ControlError ? err : new ControlError('unknown', String(err && err.message ? err.message : err));
    console.warn('[control.] AI filter failed:', e.code, e.message);
    setStatus({ lastError: { code: e.code, message: e.message, at: Date.now() } });
    for (const b of batch) b.resolve({ key: b.key, decision: 'show', error: e.message });
  }
}

async function handleClassify(item) {
  const settings = await S.load();
  if (!S.isAiActive(settings)) return { decision: 'show', error: 'AI filter is off' };
  const key = S.aiConfigKey(settings.aiFilter);
  const hit = (await getCache()).get(key + ':' + item.id);
  if (hit) return { key, decision: hit.d, reason: hit.r };
  return new Promise((resolve) => {
    queue.push({ item, key, settings, resolve });
    scheduleFlush();
  });
}

// "Test" button on the options page: classify sample posts with the current
// settings, bypassing the cache, and report what happened.
async function handleTest(samples) {
  const settings = await S.load();
  if (!settings.aiFilter.instructions.trim()) {
    return { ok: false, error: 'Write what you want (or don’t want) to see first.' };
  }
  const posts = samples.map((s, i) => ({ key: 'p' + (i + 1), author: s.author, text: s.text }));
  try {
    const started = Date.now();
    const verdicts = await classify(posts, settings);
    setStatus({ lastOkAt: Date.now(), lastError: null });
    return {
      ok: true,
      ms: Date.now() - started,
      results: posts.map((p) => verdicts.get(p.key) || { decision: 'show', reason: '(no verdict returned)' }),
    };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    return { ok: false, error: message };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return;
  if (msg.type === 'control:classify') {
    handleClassify(msg.item).then(sendResponse);
    return true;
  }
  if (msg.type === 'control:test-ai') {
    handleTest(msg.samples).then(sendResponse);
    return true;
  }
  if (msg.type === 'control:clear-cache') {
    cache = new Map();
    chrome.storage.local.remove(CACHE_KEY).then(() => sendResponse({ ok: true }));
    return true;
  }
});

// Changing the AI settings or key clears the last error so the popup doesn't
// show a stale problem.
chrome.storage.onChanged.addListener((changes) => {
  if (changes[S.SECRETS_KEY] || changes[S.SETTINGS_KEY]) setStatus({ lastError: null });
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});
