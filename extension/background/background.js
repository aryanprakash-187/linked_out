// Background service worker. Receives posts from the content script that
// need an AI verdict (feature 3), batches them, asks the configured model,
// caches the answers, and records the last error for the popup.
//
// Providers:
//   local      on-device sentence encoder (offscreen page). Default. Free.
//              Optionally sends the posts it's unsure about to Claude.
//   anthropic  every post goes to Claude with the user's API key.
importScripts('../vendor/anthropic-sdk.js', '../shared/settings.js', '../shared/prompt.js');

const control = globalThis.control;
const S = control.settings;
const P = control.prompt;

const BATCH_SIZE = 8;
const BATCH_WAIT_MS = 350; // gather posts that load together into one request
const MAX_CONCURRENT = 2;
const AI_TIMEOUT_MS = 25000;
const CACHE_KEY = 'controlXVerdicts';
const CACHE_MAX = 3000;
const FEEDBACK_REVISION_KEY = 'controlXFeedbackRevision';
async function feedbackRevision() {
  return (await chrome.storage.local.get(FEEDBACK_REVISION_KEY))[FEEDBACK_REVISION_KEY] || 0;
}

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
  const url = chrome.runtime.getURL('offscreen/offscreen.html');
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
  if (existing.length) return;
  try {
    await chrome.offscreen.createDocument({
      url,
      reasons: ['WORKERS'],
      justification: 'Run the on-device AI model that filters feed posts.',
    });
  } catch (err) {
    // Two batches can race to create it; only one document may exist.
    if (!/single offscreen/i.test(String(err && err.message))) throw err;
  }
}

async function classifyLocal(posts, settings) {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'control:local-classify',
    payload: { instructions: settings.aiFilter.instructions, posts },
  });
  if (!res || res.error) {
    throw new ControlError('local', (res && res.error) || "The on-device model didn't respond.");
  }
  const verdicts = new Map(res.verdicts.map((v) => [v.key, { decision: v.decision, reason: v.reason }]));
  const unsure = posts.filter((p) => res.verdicts.find((v) => v.key === p.key && v.uncertain));
  if (settings.aiFilter.claudeCheck && unsure.length) {
    // Best effort: if Claude fails, keep the on-device verdicts.
    try {
      const second = await classifyWithAnthropic(unsure, settings);
      for (const [key, v] of second) verdicts.set(key, v);
    } catch (err) {
      console.warn('[control.] Claude double-check failed:', err.code || '', err.message);
    }
  }
  return verdicts;
}

function classify(posts, settings) {
  const run =
    settings.aiFilter.provider === 'anthropic'
      ? classifyWithAnthropic(posts, settings)
      : classifyLocal(posts, settings);
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
    // Feedback may have arrived while the model was running. Never cache an old verdict.
    const currentKey = S.aiConfigKey(settings.aiFilter) + ':' + await feedbackRevision();
    if (batch[0].key !== currentKey) {
      for (const b of batch) b.resolve({ decision: 'show', error: 'Preferences changed; retrying' });
      return;
    }
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
  const key = S.aiConfigKey(settings.aiFilter) + ':' + await feedbackRevision();
  const itemKey = item.id + ':' + S.hash(item.text || '');
  const hit = (await getCache()).get(key + ':' + itemKey);
  if (hit) return { key, decision: hit.d, reason: hit.r };
  return new Promise((resolve) => {
    queue.push({ item: { ...item, id: itemKey }, key, settings, resolve });
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

// Serialize feedback, including revision publication, across all feed tabs.
let feedbackQueue = Promise.resolve();
async function handleFeedback(payload) {
  const settings = await S.load();
  if (payload.action === 'correct' && (settings.aiFilter.provider !== 'local' || !S.isAiActive(settings))) throw new Error('Enable the on-device filter to personalize it');
  if (payload.instructions !== settings.aiFilter.instructions) throw new Error('Instructions changed; try again');
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({
    target: 'offscreen', type: 'control:local-feedback',
    payload: { ...payload, instructions: settings.aiFilter.instructions },
  });
  if (!res || res.error) throw new Error(res && res.error || 'Feedback could not be saved');
  cache = new Map();
  await chrome.storage.local.remove(CACHE_KEY);
  await chrome.storage.local.set({ [FEEDBACK_REVISION_KEY]: res.revision });
  return { ok: true, ...res };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'control:feedback') {
    const result = feedbackQueue.then(() => handleFeedback(msg.payload));
    feedbackQueue = result.catch(() => {});
    result.then(sendResponse).catch((err) => sendResponse({ error: err.message }));
    return true;
  }
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
