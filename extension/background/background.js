// Background service worker. Receives posts from the content script that
// need an AI verdict (feature 3), batches them, runs the on-device model in
// the offscreen page, caches the answers, and records the last error for the
// popup. Nothing leaves the device.
importScripts('../shared/settings.js');

const control = globalThis.control;
const S = control.settings;

const BATCH_SIZE = 8;
const BATCH_WAIT_MS = 350; // gather posts that load together into one request
const MAX_CONCURRENT = 2;
const AI_TIMEOUT_MS = 25000;
const CACHE_KEY = 'controlVerdicts';
const CACHE_MAX = 3000;
const FEEDBACK_REVISION_KEY = 'controlFeedbackRevision';
async function feedbackRevision() {
  return (await chrome.storage.local.get(FEEDBACK_REVISION_KEY))[FEEDBACK_REVISION_KEY] || 0;
}

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

// ---------- on-device model ----------

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
  return new Map(res.verdicts.map((v) => [v.key, { decision: v.decision, reason: v.reason }]));
}

function classify(posts, settings) {
  const run = classifyLocal(posts, settings);
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
    console.warn('[out] AI filter failed:', e.code, e.message);
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
  if (payload.action === 'correct' && !S.isAiActive(settings)) throw new Error('Turn on the AI filter to personalize it');
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
  // From the on-page panel; content scripts can't open extension pages.
  if (msg.type === 'control:open-options') {
    const hash = /^#[a-z]+$/.test(msg.hash || '') ? msg.hash : '';
    if (hash) chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html' + hash) });
    else chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'control:clear-cache') {
    cache = new Map();
    chrome.storage.local.remove(CACHE_KEY).then(() => sendResponse({ ok: true }));
    return true;
  }
});

// Changing the AI settings clears the last error so the popup doesn't show a
// stale problem.
chrome.storage.onChanged.addListener((changes) => {
  if (changes[S.SETTINGS_KEY]) setStatus({ lastError: null });
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
  // Versions with the Claude option stored an Anthropic API key here. The
  // option is gone, so the key shouldn't stay behind.
  chrome.storage.local.remove('controlSecrets');
});
