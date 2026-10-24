const test = require('node:test');
const assert = require('node:assert/strict');

require('../../extension/shared/settings.js');
require('../../extension/shared/rules.js');
const { rules, settings } = globalThis.control;

const defaults = () => structuredClone(settings.DEFAULTS);

test('classifyHeader recognises network activity', () => {
  for (const header of [
    'Sam Ortiz likes this',
    'Sam Ortiz and 3 others like this',
    'Taylor Brooks commented on this',
    'Alex reposted this',
    'Jane celebrates this',
    'Jane loves this',
    'Jane supports this',
    'Jane finds this insightful',
    'Jane finds this funny',
    'Jane is curious about this',
    'Jane replied to a comment',
    'Taylor Brooks commented', // 2026 markup drops "on this"
    'Alex Kim reposted',
    'Sam Ortiz likes this ·',
  ]) {
    assert.equal(rules.classifyHeader(header), 'social', header);
  }
});

test('classifyHeader ignores author names and headlines that merely contain the verbs', () => {
  for (const line of [
    'Priya Raman',
    'Shared services lead at Acme',
    'Loves building things. Likes coffee.',
    'Commented code is good code, says this engineer at Acme',
    'Feed post number 3',
  ]) {
    assert.equal(rules.classifyHeader(line), null, line);
  }
});

test('classifyHeader recognises suggested posts and ignores everything else', () => {
  assert.equal(rules.classifyHeader('Suggested'), 'suggested');
  assert.equal(rules.classifyHeader('Recommended for you'), 'suggested');
  assert.equal(rules.classifyHeader('Popular in Bioinformatics'), 'suggested');
  assert.equal(rules.classifyHeader(''), null);
  assert.equal(rules.classifyHeader('Jobs you may be interested in'), null);
});

test('isPromotedLabel', () => {
  assert.equal(rules.isPromotedLabel('Promoted'), true);
  assert.equal(rules.isPromotedLabel('  Promoted  '), true);
  assert.equal(rules.isPromotedLabel('Promoted by Acme'), true);
  assert.equal(rules.isPromotedLabel('Promoted to Senior Engineer!'), false);
  assert.equal(rules.isPromotedLabel('I got promoted'), false);
});

test('evaluateModes respects each toggle', () => {
  const modes = defaults().modes;
  assert.deepEqual(rules.evaluateModes({ isPromoted: true }, modes), { kind: 'promoted', reason: 'Promoted' });
  const social = { headerKind: 'social', headerText: 'Sam Ortiz likes this' };
  assert.equal(rules.evaluateModes(social, modes).reason, 'Sam Ortiz likes this');
  assert.equal(rules.evaluateModes({ headerKind: 'suggested' }, modes), null, 'suggested is off by default');
  assert.equal(rules.evaluateModes({ headerKind: 'suggested' }, { ...modes, hideSuggested: true }).kind, 'suggested');
  assert.equal(rules.evaluateModes({ isPromoted: true }, { ...modes, hidePromoted: false }), null);
  assert.equal(rules.evaluateModes(social, { ...modes, hideSocialActivity: false }), null);
});

test('keywords: whole words, plurals, case-insensitive', () => {
  const c = rules.compileKeywords(['internship']);
  assert.equal(rules.matchKeywords('Applying for an Internship', c), 'internship');
  assert.equal(rules.matchKeywords('Two internships!', c), 'internship');
  assert.equal(rules.matchKeywords('#internships are great', c), 'internship');
  assert.equal(rules.matchKeywords('internshipping', c), null);
  assert.equal(rules.matchKeywords('superinternship', c), null);
});

test('keywords: phrases tolerate extra whitespace', () => {
  const c = rules.compileKeywords(['thrilled to announce']);
  assert.equal(rules.matchKeywords("I'm Thrilled  to\nannounce my new role", c), 'thrilled to announce');
  assert.equal(rules.matchKeywords("I'm thrilled. To announce:", c), null);
});

test('keywords: punctuation is literal and prefix* works', () => {
  const agree = rules.compileKeywords(['agree?']);
  assert.equal(rules.matchKeywords('Hot take. Agree?', agree), 'agree?');
  assert.equal(rules.matchKeywords('I agree with this', agree), null);
  const prefix = rules.compileKeywords(['intern*']);
  assert.equal(rules.matchKeywords('international teams', prefix), 'intern*');
  assert.equal(rules.matchKeywords('my interns', prefix), 'intern*');
  assert.equal(rules.matchKeywords('winter', prefix), null);
  const tag = rules.compileKeywords(['#hiring']);
  assert.equal(rules.matchKeywords('We are #Hiring now', tag), '#hiring');
  assert.equal(rules.matchKeywords('we are hiring', tag), null);
});

test('keywords: blanks and regex characters are safe', () => {
  const c = rules.compileKeywords(['', '   ', '*', 'c++', '(beta)']);
  assert.equal(c.length, 2);
  assert.equal(rules.matchKeywords('Learning C++ this year', c), 'c++');
  assert.equal(rules.matchKeywords('Our app (beta) is live', c), '(beta)');
});

test('keywords: non-English letters count as word characters', () => {
  const c = rules.compileKeywords(['café']);
  assert.equal(rules.matchKeywords('Meet me at the Café', c), 'café');
  assert.equal(rules.matchKeywords('cafétéria', c), null);
});

test('evaluateRules: modes win over keywords; keywords obey their toggle', () => {
  const s = defaults();
  s.keywords.list = ['webinar'];
  const compiled = rules.compileKeywords(s.keywords.list);
  const post = { text: 'Join our webinar', isPromoted: true };
  assert.equal(rules.evaluateRules(post, s, compiled).kind, 'promoted');
  assert.equal(rules.evaluateRules({ text: 'Join our webinar' }, s, compiled).reason, 'Keyword: webinar');
  s.keywords.enabled = false;
  assert.equal(rules.evaluateRules({ text: 'Join our webinar' }, s, compiled), null);
});
