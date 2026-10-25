const test = require('node:test');
const assert = require('node:assert/strict');
require('../../extension/shared/feedback-memory.js');
const M = globalThis.control.feedbackMemory;
const entry = (text, decision = 'show', angle = 0) => ({
  profile: 'Hide internship announcements', encoder: 'gte:v1', text, decision,
  vector: [Math.cos(angle), Math.sin(angle)],
});
const empty = () => ({ revision: 0, examples: [], undo: null });
const query = (text = 'unseen') => ({ ...entry(text), vector: [1, 0] });

test('one correction applies exactly, but cannot generalize alone', () => {
  const s = M.correct(empty(), entry('original'));
  assert.equal(M.predict(s.examples, query('original')).decision, 'show');
  assert.equal(M.predict(s.examples, query()), null);
});
test('three distinct nearby corrections generalize to an unseen post', () => {
  let s = empty();
  for (let i = 1; i <= 3; i++) s = M.correct(s, entry('example' + i, 'hide', i * 0.01));
  assert.equal(M.predict(s.examples, query()).decision, 'hide');
});
test('conflicting, weak, or incompatible examples abstain', () => {
  let s = empty();
  for (let i = 1; i <= 3; i++) s = M.correct(s, entry('example' + i, 'hide'));
  s = M.correct(s, entry('conflict', 'show', 0.02));
  assert.equal(M.predict(s.examples, query()), null);
  assert.equal(M.predict(s.examples, { ...query(), profile: 'Only research' }), null);
  assert.equal(M.predict(s.examples, { ...query('example1'), encoder: 'gte:v2' }), null);
  assert.equal(M.predict(s.examples, { ...query(), vector: [0, 1] }), null);
});
test('repeated feedback replaces an example and undo restores its old label', () => {
  let s = M.correct(empty(), entry('post', 'hide'));
  s = M.correct(s, entry('post', 'show'));
  assert.equal(s.examples.length, 1);
  const undone = M.undo(JSON.parse(JSON.stringify(s)));
  assert.equal(undone.examples[0].decision, 'hide');
  assert.equal(undone.revision, 3);
});
test('storage cap and undo restore evicted examples', () => {
  let s = empty();
  for (let i = 0; i < 4; i++) s = M.correct(s, entry('p' + i), { maxExamples: 3 });
  assert.deepEqual(s.examples.map(e => e.text), ['p1', 'p2', 'p3']);
  assert.deepEqual(M.undo(s).examples.map(e => e.text), ['p0', 'p1', 'p2']);
});
test('invalid vectors and labels cannot enter memory', () => {
  assert.throws(() => M.correct(empty(), { ...entry('x'), decision: 'maybe' }));
  assert.throws(() => M.correct(empty(), { ...entry('x'), vector: [NaN, 0] }));
  assert.throws(() => M.correct(empty(), { ...entry('x'), vector: [0, 0] }));
});
test('nearby opposite examples block generalization even outside the neighbor threshold', () => {
  const examples = [entry('a'), entry('b'), entry('c'), entry('opposite', 'hide', 0.46)];
  assert.equal(M.predict(examples, query(), { ...M.CONFIG, minMargin: 0.15 }), null);
});
