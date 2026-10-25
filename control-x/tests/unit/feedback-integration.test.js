const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = (file) => fs.readFileSync(path.join(__dirname, '../../extension', file), 'utf8');
function start(disk = { state: null }) {
  let listener;
  const context = vm.createContext({
    console, setTimeout, clearTimeout,
    env: { backends: { onnx: { wasm: {} } } },
    pipeline: async () => async (texts) => ({ tolist: () => texts.map(() => [1, 0]) }),
    chrome: { runtime: {
      getURL: p => 'chrome-extension://test/' + p,
      onMessage: { addListener: fn => { listener = fn; } },
    } },
  });
  for (const file of ['shared/intent.js', 'shared/local-filter.js', 'shared/feedback-memory.js']) {
    vm.runInContext(source(file), context);
  }
  context.control.feedbackStore = {
    load: async () => structuredClone(disk.state || { revision: 0, examples: [], undo: null }),
    save: async state => { if (disk.fail) throw new Error('disk full'); disk.state = structuredClone(state); },
  };
  vm.runInContext(source('offscreen/offscreen.js').replace(/^import .*;$/m, ''), context);
  const send = (type, payload) => new Promise(resolve => listener({ target: 'offscreen', type, payload }, {}, resolve));
  return {
    correct: text => send('control:local-feedback', { action: 'correct', instructions: 'Hide crypto', text, decision: 'show' }),
    classify: text => send('control:local-classify', { instructions: 'Hide crypto', posts: [{ key: 'p1', text }] }),
    action: (action, extra = {}) => send('control:local-feedback', { action, instructions: 'Hide crypto', ...extra }),
  };
}
test('explicit correction survives restart and is used by the classification route', async () => {
  const disk = { state: null };
  const app = start(disk);
  assert.equal((await app.correct('post one')).revision, 1);
  const restarted = start(disk);
  const result = await restarted.classify('post one');
  assert.equal(result.verdicts[0].source, 'feedback-exact');
  assert.equal(result.verdicts[0].decision, 'show');
});
test('concurrent corrections are serialized, unseen posts adapt, and reset restores baseline', async () => {
  const disk = { state: null };
  const app = start(disk);
  await Promise.all(['a', 'b', 'c'].map(text => app.correct(text)));
  assert.equal(disk.state.examples.length, 3);
  assert.equal(disk.state.revision, 3);
  assert.equal((await app.classify('unseen')).verdicts[0].source, 'feedback-similar');
  const staleUndo = await app.action('undo', { expectedRevision: 1 });
  assert.match(staleUndo.error, /newer correction/);
  assert.equal(disk.state.examples.length, 3);
  await app.action('undo', { expectedRevision: 3 });
  assert.equal(disk.state.examples.length, 2);
  await app.action('reset');
  assert.equal(disk.state.examples.length, 0);
  assert.equal((await app.classify('a')).verdicts[0].source, undefined);
});
test('failed persistence does not install an unsaved correction', async () => {
  const disk = { state: null, fail: true };
  const app = start(disk);
  assert.match((await app.correct('a')).error, /disk full/);
  assert.equal((await app.classify('a')).verdicts[0].source, undefined);
});
