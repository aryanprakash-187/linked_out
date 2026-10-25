// Features 1, 2 and 4 against the LinkedIn feed fixture, in real Chromium.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openFeed, postStates, barText, setSettings } from './harness.mjs';
import { FIXTURES } from './harness.mjs';

async function withBrowser(fixture, fn) {
  const b = await launch(fixture);
  try {
    await fn(b);
  } finally {
    await b.close();
  }
}

const settle = (page) => page.waitForTimeout(300);

for (const fixture of FIXTURES) {
  describe(fixture, () => {
    test('default settings hide promoted, network activity and placeholder keywords', () =>
      withBrowser(fixture, async ({ context }) => {
        const page = await openFeed(context);
        await settle(page);
        assert.deepEqual(await postStates(page), {
          1001: 'shown',
          1002: 'hidden', // promoted
          1003: 'hidden', // "Sam Ortiz likes this"
          1004: 'hidden', // keyword "internship" (matches "#internships")
          1005: 'shown', // suggested is off by default
          1006: 'hidden', // "commented on this"
          1007: 'shown',
          1008: 'shown',
        });
        assert.equal(await barText(page, '1002'), 'control. hid a post · Promoted');
        assert.equal(await barText(page, '1003'), 'control. hid a post · Sam Ortiz likes this');
        assert.equal(await barText(page, '1004'), 'control. hid a post · Keyword: internship');
        // Hidden content really is invisible, and visible posts have no bar.
        assert.equal(await page.locator('[data-fixture-id="1002"] [data-fixture-text]').isVisible(), false);
        assert.equal(await page.locator('[data-fixture-id="1001"] .control-bar').count(), 0);
      }));

    test('"Show anyway" reveals a post and it stays revealed', () =>
      withBrowser(fixture, async ({ context }) => {
        const page = await openFeed(context);
        await page.locator('[data-fixture-id="1002"] .control-bar__show').click();
        const text = page.locator('[data-fixture-id="1002"] [data-fixture-text]');
        assert.equal(await text.isVisible(), true);
        // A later DOM mutation (e.g. more posts loading) must not re-hide it.
        await page.evaluate(() => appendPost({ id: '3001', author: 'New', text: 'Fresh post' }));
        await settle(page);
        assert.equal(await text.isVisible(), true);
        assert.equal((await postStates(page))['1002'], 'revealed');
      }));

    test('each mode toggle applies live, without reloading LinkedIn', () =>
      withBrowser(fixture, async ({ context, worker }) => {
        const page = await openFeed(context);
        await setSettings(worker, { modes: { hidePromoted: false, hideSocialActivity: false, hideSuggested: true } });
        await settle(page);
        const s = await postStates(page);
        assert.equal(s['1002'], 'shown');
        assert.equal(s['1003'], 'shown');
        assert.equal(s['1006'], 'shown');
        assert.equal(s['1005'], 'hidden');
        assert.equal(await barText(page, '1005'), 'control. hid a post · Suggested by LinkedIn');
      }));

    test('keyword list and keyword toggle apply live', () =>
      withBrowser(fixture, async ({ context, worker }) => {
        const page = await openFeed(context);
        await setSettings(worker, { keywords: { list: ['webinar', 'variant-calling'] } });
        await settle(page);
        let s = await postStates(page);
        assert.equal(s['1004'], 'shown', 'internship no longer a keyword');
        assert.equal(s['1007'], 'hidden');
        assert.equal(s['1008'], 'hidden');
        await setSettings(worker, { keywords: { enabled: false } });
        await settle(page);
        s = await postStates(page);
        assert.equal(s['1007'], 'shown');
        assert.equal(s['1008'], 'shown');
      }));

    test("keywords don't match LinkedIn's own buttons, counters or author names", () =>
      withBrowser(fixture, async ({ context, worker }) => {
        const page = await openFeed(context);
        await setSettings(worker, { keywords: { list: ['comment', 'send', 'repost', 'Priya Raman', 'edited'] } });
        await settle(page);
        const s = await postStates(page);
        for (const id of ['1001', '1005', '1007', '1008']) assert.equal(s[id], 'shown', id);
        // A keyword in the post itself still matches.
        await setSettings(worker, { keywords: { list: ['portfolio'] } });
        await settle(page);
        assert.equal((await postStates(page))['1007'], 'hidden');
      }));

    test('master switch off leaves LinkedIn untouched', () =>
      withBrowser(fixture, async ({ context, worker }) => {
        const page = await openFeed(context);
        await setSettings(worker, { enabled: false, layout: { blankHome: true } });
        await settle(page);
        const s = await postStates(page);
        assert.ok(
          Object.values(s).every((v) => v === 'none'),
          JSON.stringify(s),
        );
        assert.equal(await page.locator('.control-bar').count(), 0);
        assert.equal(await page.locator('#main').isVisible(), true);
        await setSettings(worker, { enabled: true });
        await settle(page);
        assert.equal(await page.locator('#main').isVisible(), false, 'blank home comes back when switched on');
      }));

    test('posts loaded later (infinite scroll) and lazily rendered posts are filtered', () =>
      withBrowser(fixture, async ({ context }) => {
        const page = await openFeed(context);
        await page.evaluate(() => {
          appendPost({ id: '4001', author: 'Late', text: 'Hiring summer internship candidates now' });
          appendPost({ id: '4002', author: 'Lazy', empty: true, text: '' });
        });
        await settle(page);
        let s = await postStates(page);
        assert.equal(s['4001'], 'hidden');
        assert.equal(s['4002'], 'none', 'empty shell is left alone until it renders');
        await page.evaluate(() => hydratePost({ id: '4002', author: 'Acme', text: 'Buy now', promoted: true }));
        await settle(page);
        s = await postStates(page);
        assert.equal(s['4002'], 'hidden');
      }));

    test('LinkedIn re-rendering a hidden post does not lose the bar', () =>
      withBrowser(fixture, async ({ context }) => {
        const page = await openFeed(context);
        // Simulate LinkedIn replacing a post's children (it does this when
        // posts scroll far out of view and back).
        await page.evaluate(() =>
          hydratePost({ id: '1002', author: 'Acme Cloud', text: 'Scale your data pipelines', promoted: true }),
        );
        await page.evaluate(() => {
          const el = document.querySelector('[data-fixture-id="1002"]');
          el.querySelector('.control-bar')?.remove(); // the 2026 re-render already dropped it
        });
        await settle(page);
        assert.equal(await page.locator('[data-fixture-id="1002"] .control-bar').count(), 1);
        assert.equal(await page.locator('[data-fixture-id="1002"] [data-fixture-text]').isVisible(), false);
      }));

    test('blank home page shows only the top bar', () =>
      withBrowser(fixture, async ({ context, worker }) => {
        await setSettings(worker, { layout: { blankHome: true } });
        const page = await openFeed(context);
        await settle(page);
        assert.equal(await page.locator('[data-fixture-nav]').isVisible(), true);
        assert.equal(await page.locator('[data-fixture-nav] a[href="/jobs/"]').isVisible(), true);
        for (const sel of ['#main', '#left-sidebar', '#right-sidebar', '[data-fixture-text] >> nth=0']) {
          assert.equal(await page.locator(sel).isVisible(), false, sel);
        }
        const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        assert.equal(bg, 'rgb(255, 255, 255)');
        // Posts on a blank page aren't judged (no wasted AI calls).
        assert.equal(await page.locator('[data-control]').count(), 0);
        // Nav links stay clickable.
        const box = await page.locator('[data-fixture-nav] a[href="/jobs/"]').boundingBox();
        const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y).getAttribute('href'), {
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
        });
        assert.equal(hit, '/jobs/');
      }));

    test('blank home turns off when navigating away inside LinkedIn (single-page app)', () =>
      withBrowser(fixture, async ({ context, worker }) => {
        await setSettings(worker, { layout: { blankHome: true } });
        const page = await openFeed(context);
        await page.evaluate(() => history.pushState({}, '', '/jobs/'));
        await page.waitForTimeout(700);
        assert.equal(await page.locator('#main').isVisible(), true);
        await page.evaluate(() => history.pushState({}, '', '/feed/'));
        await page.waitForTimeout(700);
        assert.equal(await page.locator('#main').isVisible(), false);
        // Turning blank home off brings the feed back, filtered.
        await setSettings(worker, { layout: { blankHome: false } });
        await settle(page);
        assert.equal(await page.locator('#main').isVisible(), true);
        assert.equal((await postStates(page))['1002'], 'hidden');
      }));

    test('sidebar toggles hide only their sidebar', () =>
      withBrowser(fixture, async ({ context, worker }) => {
        await setSettings(worker, { layout: { hideLeftSidebar: true } });
        const page = await openFeed(context);
        await settle(page);
        const feedBox = async () => page.locator('#main').boundingBox();
        const before = await feedBox();
        assert.equal(await page.locator('#left-sidebar').isVisible(), false);
        assert.equal(await page.locator('#right-sidebar').isVisible(), true);
        await setSettings(worker, { layout: { hideLeftSidebar: false, hideRightSidebar: true } });
        await settle(page);
        assert.equal(await page.locator('#left-sidebar').isVisible(), true);
        assert.equal(await page.locator('#right-sidebar').isVisible(), false);
        assert.equal(await page.locator('#main').isVisible(), true);
        await setSettings(worker, { layout: { hideLeftSidebar: true, hideRightSidebar: true } });
        await settle(page);
        // The feed keeps its width and position; the sidebars leave empty space.
        assert.deepEqual(await feedBox(), before);
      }));

    test('pages other than the home feed are not filtered or blanked', () =>
      withBrowser(fixture, async ({ context, worker }) => {
        await setSettings(worker, { layout: { blankHome: true, hideLeftSidebar: true } });
        const page = await context.newPage();
        await page.goto('https://www.linkedin.com/in/someone/recent-activity/all/');
        await page.waitForTimeout(500);
        assert.equal(await page.locator('#main').isVisible(), true);
        assert.equal(await page.locator('#left-sidebar').isVisible(), true);
        assert.equal((await postStates(page))['2001'], 'none');
      }));
  });
}
