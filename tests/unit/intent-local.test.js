const test = require('node:test');
const assert = require('node:assert/strict');
require('../../extension/shared/intent.js');
require('../../extension/shared/local-filter.js');
const { parseInstructions } = globalThis.control.intent;
const F = globalThis.control.localFilter;

const labels = (topics) => topics.map((t) => t.label);

test('parses hide, only and "more of" clauses', () => {
  const r = parseInstructions(
    "Only show me posts about AI and machine learning. No humblebrags or engagement bait.\nI'd like more robotics.",
  );
  assert.equal(r.only, true);
  assert.deepEqual(labels(r.show), ['AI and machine learning']);
  assert.deepEqual(labels(r.hide), ['humblebrags or engagement bait']);
  assert.deepEqual(r.more, ['robotics']);
});

test('strips filler words and keeps the topic', () => {
  assert.deepEqual(labels(parseInstructions('Hide crypto and web3 posts.').hide), ['crypto and web3']);
  assert.deepEqual(labels(parseInstructions("I don't want to see job announcements").hide), ['job announcements']);
  assert.deepEqual(labels(parseInstructions('No politics!').hide), ['politics']);
  assert.deepEqual(labels(parseInstructions('crypto').hide), ['crypto']); // bare phrase means hide
});

test('"only X, but no Y" gives both a show and a hide topic', () => {
  const r = parseInstructions('Only bioinformatics, but no hiring posts');
  assert.equal(r.only, true);
  assert.deepEqual(labels(r.show), ['bioinformatics']);
  assert.deepEqual(labels(r.hide), ['hiring']);
});

test('known LinkedIn genres add example anchors; topics split into parts', () => {
  const [t] = parseInstructions('Hide engagement bait').hide;
  assert.deepEqual(t.genres, ['bait']);
  assert.ok(t.anchors.includes('Comment YES if you agree'));
  const [ai] = parseInstructions('Only AI and machine learning').show;
  assert.deepEqual(ai.anchors, ['AI and machine learning', 'AI', 'machine learning']);
});

test('empty instructions parse to nothing', () => {
  assert.deepEqual(parseInstructions('  \n '), { only: false, hide: [], show: [], more: [] });
});

// ---------- decision logic ----------

const C = F.CONFIG;
const atZ = (z) => C.priorMean + z * C.priorSd; // similarity at a given z under the prior
const fresh = (intent) => F.newIntentStats(intent);

test('block mode: unusually similar posts are hidden with the topic as reason', () => {
  const intent = parseInstructions('Hide crypto');
  const hit = F.judge(intent, { hide: [atZ(3)], show: [] }, fresh(intent));
  assert.deepEqual(hit, { decision: 'hide', reason: 'Looks like crypto', uncertain: false });
  const miss = F.judge(intent, { hide: [atZ(-1)], show: [] }, fresh(intent));
  assert.deepEqual(miss, { decision: 'show', reason: '', uncertain: false });
});

test('posts near the threshold are flagged uncertain', () => {
  const intent = parseInstructions('Hide crypto');
  const v = F.judge(intent, { hide: [atZ(C.zThreshold + 0.1)], show: [] }, fresh(intent));
  assert.equal(v.decision, 'hide');
  assert.equal(v.uncertain, true);
});

test('only mode hides posts that are not about the wanted topics', () => {
  const intent = parseInstructions('Only show genomics');
  const off = F.judge(intent, { hide: [], show: [atZ(-1)] }, fresh(intent));
  assert.deepEqual(off, { decision: 'hide', reason: 'Not about genomics', uncertain: false });
  const on = F.judge(intent, { hide: [], show: [atZ(3)] }, fresh(intent));
  assert.equal(on.decision, 'show');
});

test('"more of" topics never hide anything', () => {
  const intent = parseInstructions('Show me more robotics');
  assert.equal(F.judge(intent, { hide: [], show: [] }, fresh(intent)).decision, 'show');
});

test('running stats adapt the threshold to the feed', () => {
  const intent = parseInstructions('Hide crypto');
  const stats = fresh(intent);
  const sim = atZ(2); // a clear hit under the prior...
  assert.equal(F.judge(intent, { hide: [sim], show: [] }, stats).decision, 'hide');
  // ...but not once we learn this topic sits close to everything in this feed.
  for (let i = 0; i < 200; i++) F.observe({ hide: [sim + (i % 2 ? 0.02 : -0.02)], show: [] }, stats);
  assert.equal(F.judge(intent, { hide: [sim], show: [] }, stats).decision, 'show');
});
