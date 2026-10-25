const test = require('node:test');
const assert = require('node:assert/strict');

require('../../extension/shared/settings.js');
const { settings: S } = globalThis.control;

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

test('aiConfigKey changes only with the instructions', () => {
  const a = { ...S.DEFAULTS.aiFilter, instructions: 'only bioinformatics' };
  const base = S.aiConfigKey(a);
  assert.equal(S.aiConfigKey({ ...a, instructions: '  only bioinformatics \n' }), base);
  assert.equal(S.aiConfigKey({ ...a, holdWhileChecking: false }), base);
  assert.notEqual(S.aiConfigKey({ ...a, instructions: 'no internships' }), base);
});

test('settings from older versions drop the removed Claude options', () => {
  const s = S.fromStored({ aiFilter: { provider: 'anthropic', model: 'claude-haiku-5-5', claudeCheck: true, instructions: 'x' } });
  assert.deepEqual(Object.keys(s.aiFilter).sort(), Object.keys(S.DEFAULTS.aiFilter).sort());
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
