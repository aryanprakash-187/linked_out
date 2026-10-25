// Scores the shipped on-device filter (extension/shared/intent.js +
// local-filter.js + the bundled gte-small model) on eval/data.mjs: 60
// hand-written LinkedIn-style posts x 10 filter instructions.
// Run: npm run eval   (needs `npm run models` first)
import { pipeline, env } from '@huggingface/transformers';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POSTS, SCENARIOS, gold } from './data.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
require(path.join(root, 'extension/shared/intent.js'));
require(path.join(root, 'extension/shared/local-filter.js'));
const { intent: I, localFilter: F } = globalThis.control;

env.allowRemoteModels = false;
env.localModelPath = path.join(root, 'extension/models') + '/';
const ex = await pipeline('feature-extraction', 'Xenova/gte-small', { dtype: 'q8' });
const embed = async (t) => (await ex(t, { pooling: 'mean', normalize: true })).tolist();

const t0 = performance.now();
const vecs = await embed(POSTS.map((p) => p.text));
const msPerPost = (performance.now() - t0) / POSTS.length;

let total = 0, right = 0, unsure = 0, rightSure = 0;
for (const s of SCENARIOS) {
  const intent = I.parseInstructions(s.instr);
  const hv = [], sv = [];
  for (const t of intent.hide) hv.push(await embed(t.anchors));
  for (const t of intent.show) sv.push(await embed(t.anchors));
  const stats = F.newIntentStats(intent);
  const sims = vecs.map((v) => ({ hide: F.topicSims(v, hv), show: F.topicSims(v, sv) }));
  sims.forEach((x) => F.observe(x, stats));
  let ok = 0;
  const misses = [];
  sims.forEach((x, i) => {
    const v = F.judge(intent, x, stats);
    const good = (v.decision === 'hide') === gold(s, POSTS[i]);
    ok += good;
    unsure += v.uncertain;
    if (!v.uncertain) rightSure += good;
    if (!good) misses.push(`${v.decision}${v.uncertain ? '?' : ''}: ${POSTS[i].text.slice(0, 60)}`);
  });
  total += POSTS.length;
  right += ok;
  console.log(`${s.id.padEnd(14)} ${s.kind.padEnd(5)} acc=${(ok / POSTS.length).toFixed(3)}  "${s.instr}"`);
  for (const m of misses) console.log(`    miss ${m}`);
}
console.log(
  `\noverall acc=${(right / total).toFixed(3)} | uncertain=${((unsure / total) * 100).toFixed(0)}% ` +
    `| acc on confident=${(rightSure / (total - unsure)).toFixed(3)} | ${msPerPost.toFixed(1)} ms/post (Node, CPU)`,
);
