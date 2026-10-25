// Scores the shipped on-device filter (extension/shared/intent.js +
// local-filter.js + the bundled gte-small model) on eval/data.mjs: 83
// hand-written LinkedIn-style posts x 13 filter instructions. "Only" filters
// are also run on a skewed feed that's mostly on-topic, the way a tech feed
// is mostly tech, because that's where z-scores alone hide wanted posts.
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
let skewKept = 0, skewWanted = 0, skewHid = 0, skewUnwanted = 0;
for (const s of SCENARIOS) {
  const intent = I.parseInstructions(s.instr);
  const hv = [], sv = [];
  for (const t of intent.hide) hv.push(await embed(t.anchors));
  for (const t of intent.show) sv.push(await embed(t.anchors));
  const competing = intent.only ? F.competingAnchors(sv, await embed(I.otherSubjects(intent))) : [];
  const sims = vecs.map((v) => ({ hide: F.topicSims(v, hv), show: F.topicSims(v, sv), other: F.otherSim(v, competing) }));
  const golds = POSTS.map((p) => gold(s, p));
  const stats = F.newIntentStats(intent);
  sims.forEach((x) => F.observe(x, stats));
  let ok = 0, n = 0;
  const misses = [];
  sims.forEach((x, i) => {
    if (golds[i] === null) return; // either answer is fine
    const v = F.judge(intent, x, stats);
    const good = (v.decision === 'hide') === golds[i];
    ok += good;
    n++;
    unsure += v.uncertain;
    if (!v.uncertain) rightSure += good;
    if (!good) misses.push(`${v.decision}${v.uncertain ? '?' : ''}: ${POSTS[i].text.slice(0, 60)}`);
  });
  total += n;
  right += ok;
  let skew = '';
  if (s.mode === 'only') {
    // Every wanted post plus a third as many unwanted ones: ~75% on-topic.
    const wanted = golds.flatMap((g, i) => (g === false ? [i] : []));
    const unwanted = golds.flatMap((g, i) => (g === true ? [i] : [])).slice(0, Math.ceil(wanted.length / 3));
    const st = F.newIntentStats(intent);
    for (const i of [...wanted, ...unwanted]) F.observe(sims[i], st);
    const kept = wanted.filter((i) => F.judge(intent, sims[i], st).decision === 'show').length;
    const hid = unwanted.filter((i) => F.judge(intent, sims[i], st).decision === 'hide').length;
    skewKept += kept, skewWanted += wanted.length, skewHid += hid, skewUnwanted += unwanted.length;
    skew = `  | mostly on-topic feed: kept ${kept}/${wanted.length} wanted, hid ${hid}/${unwanted.length} unwanted`;
  }
  console.log(`${s.id.padEnd(14)} ${s.kind.padEnd(5)} acc=${(ok / n).toFixed(3)}  "${s.instr}"${skew}`);
  for (const m of misses) console.log(`    miss ${m}`);
}
console.log(
  `\noverall acc=${(right / total).toFixed(3)} | uncertain=${((unsure / total) * 100).toFixed(0)}% ` +
    `| acc on confident=${(rightSure / (total - unsure)).toFixed(3)} | ${msPerPost.toFixed(1)} ms/post (Node, CPU)` +
    `\nmostly on-topic feeds ("only" filters): kept ${skewKept}/${skewWanted} wanted posts, hid ${skewHid}/${skewUnwanted} unwanted`,
);
