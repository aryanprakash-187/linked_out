const test = require('node:test');
const assert = require('node:assert/strict');

require('../../extension/shared/settings.js');
require('../../extension/shared/prompt.js');
const { settings: S, prompt: P } = globalThis.control;

test('merge fills missing keys from defaults and drops unknown ones', () => {
  const merged = S.merge(S.DEFAULTS, { modes: { hidePromoted: false }, bogus: 1 });
  assert.equal(merged.modes.hidePromoted, false);
  assert.equal(merged.modes.hideSocialActivity, true);
  assert.deepEqual(merged.keywords.list, S.PLACEHOLDER_KEYWORDS);
  assert.equal('bogus' in merged, false);
});

test('merge rejects values of the wrong type', () => {
  const merged = S.merge(S.DEFAULTS, { enabled: 'yes', keywords: { list: 'internship' } });
  assert.equal(merged.enabled, true);
  assert.deepEqual(merged.keywords.list, S.PLACEHOLDER_KEYWORDS);
});

test('merge of nothing equals defaults but never shares references', () => {
  const merged = S.merge(S.DEFAULTS, undefined);
  assert.deepEqual(merged, S.DEFAULTS);
  merged.keywords.list.push('x');
  assert.notDeepEqual(merged.keywords.list, S.DEFAULTS.keywords.list);
});

test('aiConfigKey changes with instructions, provider, Claude check and (when Claude is used) model', () => {
  const a = { ...S.DEFAULTS.aiFilter, instructions: 'only bioinformatics' };
  const base = S.aiConfigKey(a);
  assert.equal(a.provider, 'local');
  assert.equal(S.aiConfigKey({ ...a, instructions: '  only bioinformatics \n' }), base);
  assert.equal(S.aiConfigKey({ ...a, holdWhileChecking: false }), base);
  // On-device only: the Claude model is irrelevant.
  assert.equal(S.aiConfigKey({ ...a, model: 'claude-opus-5-5' }), base);
  assert.notEqual(S.aiConfigKey({ ...a, instructions: 'no internships' }), base);
  assert.notEqual(S.aiConfigKey({ ...a, provider: 'anthropic' }), base);
  const checked = { ...a, claudeCheck: true };
  assert.notEqual(S.aiConfigKey(checked), base);
  assert.notEqual(S.aiConfigKey({ ...checked, model: 'claude-opus-5-5' }), S.aiConfigKey(checked));
});

test('settings from older versions fall back to valid values', () => {
  const s = S.fromStored({ aiFilter: { provider: 'chrome-ai', model: 'claude-old-1', instructions: 'x' } });
  assert.equal(s.aiFilter.provider, 'local');
  assert.equal(s.aiFilter.model, S.DEFAULTS.aiFilter.model);
  assert.equal(s.aiFilter.instructions, 'x');
});

test('isAiActive needs the master switch, the toggle and instructions', () => {
  const s = structuredClone(S.DEFAULTS);
  assert.equal(S.isAiActive(s), false);
  s.aiFilter.enabled = true;
  assert.equal(S.isAiActive(s), false, 'no instructions yet');
  s.aiFilter.instructions = 'only bioinformatics';
  assert.equal(S.isAiActive(s), true);
  s.enabled = false;
  assert.equal(S.isAiActive(s), false);
});

test('system prompt carries the instructions; user message is JSON with ids', () => {
  const sys = P.buildSystemPrompt('  Only bioinformatics  ');
  assert.match(sys, /<instructions>\nOnly bioinformatics\n<\/instructions>/);
  const msg = P.buildUserMessage([{ key: 'p1', author: 'A', text: 'x'.repeat(5000) }]);
  const arr = JSON.parse(msg.slice(msg.indexOf('[')));
  assert.equal(arr[0].id, 'p1');
  assert.equal(arr[0].text.length, P.MAX_POST_CHARS);
});

test('parseVerdicts keeps only valid verdicts for known ids', () => {
  const text = JSON.stringify({
    verdicts: [
      { id: 'p1', decision: 'hide', reason: 'Internship announcement' },
      { id: 'p2', decision: 'maybe', reason: '?' },
      { id: 'p9', decision: 'hide', reason: 'unknown id' },
      { id: 'p3', decision: 'show', reason: 'About bioinformatics' },
    ],
  });
  const v = P.parseVerdicts(text, ['p1', 'p2', 'p3']);
  assert.deepEqual([...v.keys()], ['p1', 'p3']);
  assert.equal(v.get('p1').decision, 'hide');
});

test('parseVerdicts tolerates surrounding prose and garbage', () => {
  const v = P.parseVerdicts('Sure! {"verdicts":[{"id":"p1","decision":"hide","reason":"r"}]} Done.', ['p1']);
  assert.equal(v.get('p1').decision, 'hide');
  assert.equal(P.parseVerdicts('not json at all', ['p1']).size, 0);
  assert.equal(P.parseVerdicts('{"verdicts": 3}', ['p1']).size, 0);
});
