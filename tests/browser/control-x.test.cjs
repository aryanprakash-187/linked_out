const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const extension = path.resolve(__dirname, '../../extension');
const fixture = (id, text, extra = '') => `<article data-testid="tweet" id="p${id}">
  <div data-testid="User-Name">Writer</div><a href="/writer/status/${id}"><time>Today</time></a>
  ${text ? '<div data-testid="tweetText">' + text + '</div>' : ''}${extra}</article>`;
async function setup(browser) {
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body:
    '<main data-testid="primaryColumn">' + fixture(1, 'junk promotion') + fixture(2, 'useful research',
      '<div role="link"><a href="/quoted/status/99"><time>Yesterday</time></a><div data-testid="tweetText">quoted junk</div></div>') +
      fixture(3, '', '<video></video>') + fixture(4, '', '<div role="link"><div data-testid="tweetText">quote only</div></div>') +
      '</main>' }));
  await page.goto('https://x.com/home');
  await page.evaluate(() => {
    const listeners = [], runtimeListeners = [], corrections = new Map();
    window.feedbackCalls = 0;
    window.chrome = {
      storage: {
        sync: { get: async () => ({ controlXSettings: window.demoSettings }) },
        local: { get: async () => ({}) },
        onChanged: { addListener: fn => listeners.push(fn) },
      },
      runtime: {
        onMessage: { addListener: fn => runtimeListeners.push(fn) },
        sendMessage: async msg => {
          if (msg.type === 'control:feedback') {
            window.feedbackCalls++;
            corrections.set(msg.payload.text, msg.payload.decision);
            listeners.forEach(fn => fn({ controlXFeedbackRevision: { newValue: window.feedbackCalls } }));
            return { ok: true, revision: window.feedbackCalls };
          }
          return { decision: corrections.get(msg.item.text) || (msg.item.text.includes('junk') ? 'hide' : 'show'), reason: 'Text preference' };
        },
      },
    };
  });
  await page.addScriptTag({ path: path.join(extension, 'shared/settings.js') });
  await page.evaluate(() => {
    window.demoSettings = structuredClone(control.settings.DEFAULTS);
    demoSettings.aiFilter = { ...demoSettings.aiFilter, enabled: true, instructions: 'Hide promotions', provider: 'local' };
    demoSettings.keywords.enabled = false;
  });
  for (const script of ['shared/rules.js', 'content/x.js', 'content/content.js']) await page.addScriptTag({ path: path.join(extension, script) });
  await page.addStyleTag({ path: path.join(extension, 'content/content.css') });
  await page.waitForFunction(() => document.querySelector('#p1').getAttribute('data-control') === 'hidden');
  return page;
}
test('X text extraction, reveal, explicit feedback, navigation and recycled elements', async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CONTROL_X_BROWSER || undefined });
  try {
    const page = await setup(browser);
    const extracted = await page.evaluate(() => [1, 2, 3, 4].map(id => control.x.extractPost(document.querySelector('#p' + id))));
    assert.equal(extracted[0].urn, 'x:1');
    assert.equal(extracted[1].text, 'useful research');
    assert.equal(extracted[2].ready, false);
    assert.equal(extracted[3].ready, false);
    assert.equal(await page.locator('#p3 [class^="control-"]').count(), 0);
    assert.equal(await page.locator('#p4 [class^="control-"]').count(), 0);
    await page.getByRole('button', { name: 'Show anyway', exact: true }).click();
    assert.equal(await page.evaluate(() => feedbackCalls), 0);
    assert.equal(await page.locator('#p1').getAttribute('data-control'), 'revealed');
    // X reuses article nodes: a temporary reveal must not leak to a different post.
    await page.evaluate(() => {
      const post = document.querySelector('#p1');
      post.querySelector('a').setAttribute('href', '/writer/status/10');
      post.querySelector('[data-testid="tweetText"]').textContent = 'new junk promotion';
    });
    await page.waitForFunction(() => document.querySelector('#p1').getAttribute('data-control') === 'hidden');
    await page.getByRole('button', { name: 'This should be shown', exact: true }).click();
    await page.waitForFunction(() => window.feedbackCalls === 1 && document.querySelector('#p1').getAttribute('data-control') === 'shown');
    await page.getByRole('button', { name: 'Undo correction', exact: true }).waitFor();
    assert.equal(await page.locator('#p2').getAttribute('data-control'), 'shown');
    // Dynamically inserted posts are processed.
    await page.evaluate(() => {
      const post = document.createElement('article');
      post.dataset.testid = 'tweet';
      post.id = 'p5';
      post.innerHTML = '<a href="/writer/status/5"><time>Today</time></a><div data-testid="tweetText">more junk</div>';
      document.querySelector('main').append(post);
    });
    await page.waitForFunction(() => document.querySelector('#p5').getAttribute('data-control') === 'hidden');
    // Navigating away restores the feed and does not filter a post detail page.
    await page.evaluate(() => history.pushState({}, '', '/writer/status/5'));
    await page.waitForTimeout(650);
    assert.notEqual(await page.locator('#p5').getAttribute('data-control'), 'hidden');
    await page.close();
  } finally { await browser.close(); }
});
test('manifest and branding target only X', () => {
  const fs = require('node:fs');
  const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
  assert.equal(manifest.name, 'Control-X');
  assert.match(manifest.description, /Cut out the junk/);
  assert.ok(manifest.content_scripts.every(script => script.matches.every(match => !match.includes('linkedin'))));
  assert.ok(manifest.content_scripts[0].js.includes('content/x.js'));
});
