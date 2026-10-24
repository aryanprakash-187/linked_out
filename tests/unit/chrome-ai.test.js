const test = require('node:test');
const assert = require('node:assert/strict');

require('../../extension/shared/chrome-ai.js');
const { chromeAI } = globalThis.control;

// A stand-in for Chrome's Prompt API (LanguageModel) that records calls.
function fakeLanguageModel({ availability = 'available' } = {}) {
  const calls = { create: [], prompt: [], destroyed: 0 };
  const makeSession = (opts) => ({
    opts,
    async clone() {
      return makeSession(opts);
    },
    async prompt(user, options) {
      calls.prompt.push({ system: opts.initialPrompts && opts.initialPrompts[0].content, user, options });
      return '{"verdicts":[]}';
    },
    destroy() {
      calls.destroyed++;
    },
  });
  return {
    calls,
    api: {
      async availability() {
        return availability;
      },
      async create(opts) {
        calls.create.push(opts);
        return makeSession(opts);
      },
    },
  };
}

test('availability reports "unsupported" without the Prompt API', async () => {
  delete globalThis.LanguageModel;
  assert.equal(await chromeAI.availability(), 'unsupported');
});

test('prompt reuses one base session per system prompt and passes the schema', async () => {
  const fake = fakeLanguageModel();
  globalThis.LanguageModel = fake.api;
  const schema = { type: 'object' };
  await chromeAI.prompt({ system: 'A', user: 'u1', schema });
  await chromeAI.prompt({ system: 'A', user: 'u2', schema });
  assert.equal(fake.calls.create.length, 1, 'base session reused');
  await chromeAI.prompt({ system: 'B', user: 'u3', schema });
  assert.equal(fake.calls.create.length, 2, 'new instructions, new base session');
  assert.deepEqual(
    fake.calls.prompt.map((p) => [p.system, p.user]),
    [
      ['A', 'u1'],
      ['A', 'u2'],
      ['B', 'u3'],
    ],
  );
  assert.equal(fake.calls.prompt[0].options.responseConstraint, schema);
  // Each request's clone is destroyed, plus the replaced base session.
  assert.equal(fake.calls.destroyed, 4);
  delete globalThis.LanguageModel;
});

test('availability passes through the Prompt API status', async () => {
  globalThis.LanguageModel = fakeLanguageModel({ availability: 'downloadable' }).api;
  assert.equal(await chromeAI.availability(), 'downloadable');
  delete globalThis.LanguageModel;
});
