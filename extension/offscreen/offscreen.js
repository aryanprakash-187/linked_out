// Hidden page the background worker opens to run the on-device model.
// Service workers can't import ES modules dynamically or run the WASM
// runtime comfortably, so Transformers.js lives here.
//
// Pipeline per batch: parse instructions into topics (cached), embed the
// topic anchors and, for "only" mode, the competing subjects (cached), embed
// the posts, z-score each post against each topic's running stats, and judge.
import { env, pipeline } from '../vendor/transformers.min.js';

const { intent: I, localFilter: F } = globalThis.control;
const MODEL_ID = 'Xenova/gte-small';

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
  const showVecs = await vecs(intent.show);
  profile = {
    instructions,
    intent,
    hideVecs: await vecs(intent.hide),
    showVecs,
    competing: intent.only ? F.competingAnchors(showVecs, await embed(I.otherSubjects(intent))) : [],
    stats: F.newIntentStats(intent),
  };
  return profile;
}

async function classify({ instructions, posts }) {
  const p = await getProfile(instructions);
  const vectors = await embed(posts.map((x) => (x.text || '').slice(0, 2000)));
  const sims = vectors.map((v) => ({
    hide: F.topicSims(v, p.hideVecs),
    show: F.topicSims(v, p.showVecs),
    other: F.otherSim(v, p.competing),
  }));
  // Learn from the whole batch first so the very first batch isn't judged
  // on the prior alone.
  for (const s of sims) F.observe(s, p.stats);
  return posts.map((post, i) => ({ key: post.key, ...F.judge(p.intent, sims[i], p.stats) }));
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen' || msg.type !== 'control:local-classify') return;
  classify(msg.payload)
    .then((verdicts) => sendResponse({ verdicts }))
    .catch((err) => sendResponse({ error: String(err && err.message ? err.message : err) }));
  return true;
});
