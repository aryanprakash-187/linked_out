// Hidden page the background worker opens to run the on-device model.
// Service workers can't import ES modules dynamically or run the WASM
// runtime comfortably, so Transformers.js lives here.
//
// Pipeline per batch: parse instructions into topics (cached), embed the
// topic anchors (cached), embed the posts, z-score each post against each
// topic's running stats, and judge. Uncertain verdicts are flagged so the
// background can optionally double-check them with Claude.
import { env, pipeline } from '../vendor/transformers.min.js';

const { intent: I, localFilter: F } = globalThis.control;
const MODEL_ID = 'Xenova/gte-small';
const ENCODER_VERSION = MODEL_ID + ':q8:mean:normalized:v1';
const M = control.feedbackMemory;
let memory;
async function getMemory() { return memory ||= await control.feedbackStore.load(); }
// Classification and writes share a queue, avoiding lost updates across tabs.
let operations = Promise.resolve();
function enqueue(run) {
  const result = operations.then(run);
  operations = result.catch(() => {});
  return result;
}

env.allowRemoteModels = false; // everything ships inside the extension
env.allowLocalModels = true;
env.localModelPath = chrome.runtime.getURL('models/');
env.useBrowserCache = false;
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('vendor/ort/');
env.backends.onnx.wasm.numThreads = 1; // extension pages aren't cross-origin isolated

let extractor = null;
function getExtractor() {
  extractor ||= pipeline('feature-extraction', MODEL_ID, { dtype: 'q8', device: 'wasm' }).catch((err) => {
    extractor = null;
    throw err;
  });
  return extractor;
}

async function embed(texts) {
  const run = await getExtractor();
  const out = [];
  for (let i = 0; i < texts.length; i += 8) {
    const t = await run(texts.slice(i, i + 8), { pooling: 'mean', normalize: true });
    out.push(...t.tolist());
  }
  return out;
}

// One "profile" per instructions string: parsed topics, anchor vectors and
// running stats. Changing the instructions starts a fresh profile.
let profile = null;
async function getProfile(instructions) {
  if (profile && profile.instructions === instructions) return profile;
  const intent = I.parseInstructions(instructions);
  const vecs = async (topics) => {
    const out = [];
    for (const t of topics) out.push(await embed(t.anchors));
    return out;
  };
  profile = {
    instructions,
    intent,
    hideVecs: await vecs(intent.hide),
    showVecs: await vecs(intent.show),
    stats: F.newIntentStats(intent),
  };
  return profile;
}

async function classify({ instructions, posts }) {
  const saved = await getMemory();
  const profileId = instructions.trim();
  const p = await getProfile(instructions);
  const vectors = await embed(posts.map((x) => (x.text || '').slice(0, 2000)));
  const sims = vectors.map((v) => ({ hide: F.topicSims(v, p.hideVecs), show: F.topicSims(v, p.showVecs) }));
  // Learn from the whole batch first so the very first batch isn't judged
  // on the prior alone.
  for (const s of sims) F.observe(s, p.stats);
  return posts.map((post, i) => ({
    key: post.key,
    ...(M.predict(saved.examples, { profile: profileId, encoder: ENCODER_VERSION, text: post.text, vector: vectors[i] }) ||
      F.judge(p.intent, sims[i], p.stats)),
  }));
}


async function feedback(payload) {
  const saved = await getMemory();
  let next;
  if (payload.action === 'undo') {
    if (payload.expectedRevision !== saved.revision) throw new Error('A newer correction was saved. Undo it first.');
    next = M.undo(saved);
  }
  else if (payload.action === 'reset') next = {
    revision: saved.revision + 1,
    examples: saved.examples.filter((e) => e.profile !== payload.instructions.trim()),
    undo: null,
  };
  else if (payload.action === 'correct') {
    const [vector] = await embed([M.textOf(payload.text).slice(0, 2000)]);
    next = M.correct(saved, {
      profile: payload.instructions.trim(), encoder: ENCODER_VERSION,
      text: payload.text, vector, decision: payload.decision,
    });
  } else throw new Error('Unknown feedback action');
  await control.feedbackStore.save(next);
  memory = next;
  return { revision: next.revision, count: next.examples.filter((e) => e.profile === payload.instructions.trim()).length };
}
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return;
  const run = msg.type === 'control:local-classify' ? async () => ({ verdicts: await classify(msg.payload) })
    : msg.type === 'control:local-feedback' ? () => feedback(msg.payload) : null;
  if (!run) return;
  enqueue(run).then(sendResponse).catch((err) => sendResponse({ error: String(err && err.message ? err.message : err) }));
  return true;
});
