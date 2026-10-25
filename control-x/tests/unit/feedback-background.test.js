const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function start() {
  const data = {};
  let listener, pending, calls = 0;
  const settings = { aiFilter: { provider: 'local', instructions: 'Hide crypto' } };
  const context = vm.createContext({
    console, clearTimeout,
    // Skip only the one-second deferred cache write; execute the batching queue immediately.
    setTimeout: (fn, ms) => ms === 1000 ? 0 : setTimeout(fn, ms === 350 ? 0 : ms),
    importScripts: () => {},
    control: {
      settings: { load: async () => settings, isAiActive: () => true, aiConfigKey: () => 'config', hash: text => text,
        STATUS_KEY: 'status', SETTINGS_KEY: 'settings', SECRETS_KEY: 'secrets' },
      prompt: {},
    },
    chrome: {
      storage: { local: {
        get: async key => ({ [key]: data[key] }),
        set: async values => Object.assign(data, values),
        remove: async key => { delete data[key]; },
      }, onChanged: { addListener: () => {} } },
      runtime: {
        getURL: p => p, getContexts: async () => [{}],
        onMessage: { addListener: fn => { listener = fn; } },
        onInstalled: { addListener: () => {} },
        sendMessage: async msg => {
          if (msg.type === 'control:local-classify') {
            calls++;
            return pending ? pending : { verdicts: msg.payload.posts.map(p => ({ key: p.key, decision: 'hide', reason: 'topic', uncertain: false })) };
          }
          return { revision: (data.controlXFeedbackRevision || 0) + 1, count: 1 };
        },
      },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../extension/background/background.js'), 'utf8'), context);
  const send = msg => new Promise(resolve => listener(msg, {}, resolve));
  return { data, send, get calls() { return calls; }, delay(promise) { pending = promise; } };
}
const classify = text => ({ type: 'control:classify', item: { id: 'same-urn', text } });
test('cache uses post text and feedback changes invalidate the cache', async () => {
  const app = start();
  await app.send(classify('a'));
  await app.send(classify('a'));
  assert.equal(app.calls, 1);
  await app.send(classify('edited'));
  assert.equal(app.calls, 2);
  const feedback = await app.send({ type: 'control:feedback', payload: { action: 'correct', instructions: 'Hide crypto', text: 'a', decision: 'show' } });
  assert.equal(feedback.ok, true);
  await app.send(classify('a'));
  assert.equal(app.calls, 3);
});
test('a result from before a feedback revision cannot be cached or hide a post', async () => {
  const app = start();
  let resolve;
  app.delay(new Promise(done => { resolve = done; }));
  const response = app.send(classify('a'));
  while (!app.calls) await new Promise(done => setTimeout(done, 1));
  app.data.controlXFeedbackRevision = 1;
  resolve({ verdicts: [{ key: 'p1', decision: 'hide', reason: 'old', uncertain: false }] });
  const verdict = await response;
  assert.equal(verdict.decision, 'show');
  assert.match(verdict.error, /Preferences changed/);
});
