// The "out" button just before LinkedIn's logo and the panel it opens, driven
// like a user would, against both feed markups.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, openFeed, postStates, setSettings, ROOT, FIXTURES } from './harness.mjs';

async function withBrowser(fixture, fn) {
  const b = await launch(fixture);
  try {
    await fn(b);
  } finally {
    await b.close();
  }
}

const LOGO = '._lg, .global-nav__logo'; // the fixtures' logos
const panel = '#control-out-panel .panel';
const chip = (page, settingsPath) => page.locator(`#control-out-panel [data-path="${settingsPath}"]`);

async function openPanel(page) {
  await page.click('#control-out .out');
  await page.locator(`${panel}.open`).waitFor();
}

async function isOpen(page) {
  return page.locator(`${panel}.open`).count().then((n) => n === 1);
}

async function storedSettings(worker) {
  return worker.evaluate(() => globalThis.control.settings.load());
}

for (const fixture of FIXTURES) {
  describe(fixture, () => {
    test('the out button sits just left of the LinkedIn logo, at its height', () =>
      withBrowser(fixture, async ({ context }) => {
        const page = await openFeed(context);
        await page.waitForSelector('#control-out', { state: 'attached' });
        const g = await page.evaluate((LOGO) => {
          const host = document.querySelector('#control-out');
          const b = host.shadowRoot.querySelector('.out').getBoundingClientRect();
          const l = document.querySelector(LOGO).getBoundingClientRect();
          return {
            inNav: Boolean(host.closest('[data-fixture-nav]')),
            text: host.shadowRoot.querySelector('.out').textContent,
            height: [b.height, l.height],
            middle: [b.top + b.height / 2, l.top + l.height / 2],
            gap: l.left - b.right,
          };
        }, LOGO);
        assert.equal(g.inNav, true);
        assert.equal(g.text, 'out');
        assert.equal(g.height[0], g.height[1]);
        assert.ok(Math.abs(g.middle[0] - g.middle[1]) < 1, `centred on the logo: ${g.middle}`);
        assert.ok(Math.abs(g.gap - 8) <= 1, `8px from the logo, got ${g.gap}`);
      }));

    test('clicking out opens the panel; clicking it again, Escape or outside closes it', () =>
      withBrowser(fixture, async ({ context }) => {
        const page = await openFeed(context);
        await openPanel(page);
        assert.equal(await page.getAttribute('#control-out .out', 'aria-expanded'), 'true');
        assert.equal(await page.innerText(`${panel} .title`), '4 posts hidden');
        assert.equal(await page.innerText(`${panel} .sub`), 'of 8 on this page');
        // The current options, as in the popup.
        const pressed = async (p) => (await chip(page, p).getAttribute('aria-pressed')) === 'true';
        assert.equal(await pressed('modes.hidePromoted'), true);
        assert.equal(await pressed('modes.hideSocialActivity'), true);
        assert.equal(await pressed('modes.hideSuggested'), false);
        assert.equal(await pressed('keywords.enabled'), true);
        assert.equal(await pressed('layout.blankHome'), false);
        assert.equal(await chip(page, 'keywords.enabled').locator('.n').innerText(), '3');

        await page.click('#control-out .out');
        await page.waitForFunction(() => !document.querySelector('#control-out-panel').shadowRoot.querySelector('.open'));
        assert.equal(await page.getAttribute('#control-out .out', 'aria-expanded'), 'false');

        await openPanel(page);
        await page.keyboard.press('Escape');
        assert.equal(await isOpen(page), false);

        await openPanel(page);
        await page.mouse.click(1100, 700); // the feed, away from the panel
        assert.equal(await isOpen(page), false);
      }));

    test('panel buttons change the feed live, and follow changes made elsewhere', () =>
      withBrowser(fixture, async ({ context, worker }) => {
        const page = await openFeed(context);
        await openPanel(page);

        await chip(page, 'modes.hidePromoted').click();
        await page.waitForFunction(() => document.querySelector('[data-fixture-id="1002"]').dataset.control === 'shown');
        assert.equal(await chip(page, 'modes.hidePromoted').getAttribute('aria-pressed'), 'false');
        await page.waitForSelector(`${panel} .title:has-text("3 posts hidden")`);
        assert.equal((await storedSettings(worker)).modes.hidePromoted, false);

        await chip(page, 'modes.hideSuggested').click();
        await page.waitForFunction(() => document.querySelector('[data-fixture-id="1005"]').dataset.control === 'hidden');

        // A change from the popup or settings page shows up in the open panel.
        await setSettings(worker, { modes: { hidePromoted: true } });
        await page.waitForFunction(
          () =>
            document
              .querySelector('#control-out-panel')
              .shadowRoot.querySelector('[data-path="modes.hidePromoted"]')
              .getAttribute('aria-pressed') === 'true',
        );

        // Master switch: off leaves LinkedIn untouched, and the button says so.
        await chip(page, 'enabled').click();
        await page.waitForSelector(`${panel} .title:has-text("Paused")`);
        assert.ok(Object.values(await postStates(page)).every((s) => s === 'none'));
        assert.equal(await page.locator('#control-out[data-off]').count(), 1);
        await chip(page, 'enabled').click();
        await page.waitForSelector(`${panel} .title:has-text("posts hidden")`);
        assert.equal(await page.locator('#control-out[data-off]').count(), 0);
      }));

    test('instructions typed in the panel are saved and turn the AI filter on', () =>
      withBrowser(fixture, async ({ context, worker }) => {
        const page = await openFeed(context);
        await openPanel(page);
        const text = page.locator('#control-out-panel textarea');
        const save = page.locator(`${panel} .save`);

        // The AI switch can't go on with nothing to filter by.
        await chip(page, 'aiFilter.enabled').click();
        assert.equal(await chip(page, 'aiFilter.enabled').getAttribute('aria-checked'), 'false');
        assert.equal(await page.innerText(`${panel} .hint`), 'Write what you want first.');

        assert.equal(await save.isDisabled(), true);
        await text.fill('Only bioinformatics. No crypto');
        assert.equal(await save.isDisabled(), false);
        assert.match(await page.innerText(`${panel} .hint`), /^Unsaved/);
        // How the on-device filter reads it, before saving.
        assert.equal(await page.innerText(`${panel} .understood`), 'Only show: bioinformatics\nHide: crypto');

        await text.press('Control+Enter');
        await page.waitForFunction(
          () => document.querySelector('#control-out-panel').shadowRoot.querySelector('.save').disabled,
        );
        const s = await storedSettings(worker);
        assert.equal(s.aiFilter.instructions, 'Only bioinformatics. No crypto');
        assert.equal(s.aiFilter.enabled, true);
        assert.equal(await chip(page, 'aiFilter.enabled').getAttribute('aria-checked'), 'true');
        assert.equal(await page.innerText(`${panel} .hint`), 'Saved. Re-checking your feed…');
      }));

    test('keys typed in the panel do not reach the page', () =>
      withBrowser(fixture, async ({ context }) => {
        const page = await openFeed(context);
        await page.evaluate(() => {
          window.__keys = 0;
          document.addEventListener('keydown', () => window.__keys++);
        });
        await openPanel(page);
        await page.locator('#control-out-panel textarea').pressSequentially('crypto');
        assert.equal(await page.evaluate(() => window.__keys), 0);
      }));

    test('"All settings" and "Edit keywords" open the settings page', () =>
      withBrowser(fixture, async ({ context }) => {
        const page = await openFeed(context);
        await openPanel(page);
        const [all] = await Promise.all([
          context.waitForEvent('page'),
          page.click(`${panel} [data-open=""]`),
        ]);
        await all.waitForLoadState();
        assert.match(all.url(), /options\/options\.html$/);
        const [kw] = await Promise.all([
          context.waitForEvent('page'),
          page.click(`${panel} [data-open="#keywords"]`),
        ]);
        await kw.waitForLoadState();
        assert.match(kw.url(), /options\/options\.html#keywords$/);
      }));

    test('on a blank home page the button still works and can bring the feed back', () =>
      withBrowser(fixture, async ({ context, worker }) => {
        await setSettings(worker, { layout: { blankHome: true } });
        const page = await openFeed(context);
        assert.equal(await page.locator('#main').isVisible(), false);
        assert.equal(await page.locator('#control-out .out').isVisible(), true);
        await openPanel(page);
        assert.equal(await page.innerText(`${panel} .title`), 'Home page is blank');
        await chip(page, 'layout.blankHome').click();
        await page.waitForFunction(() => !document.documentElement.classList.contains('control-blank-home'));
        assert.equal(await page.locator('#main').isVisible(), true);
      }));

    test('LinkedIn re-rendering its top bar does not lose the button', () =>
      withBrowser(fixture, async ({ context }) => {
        const page = await openFeed(context);
        await page.waitForSelector('#control-out', { state: 'attached' });
        await page.evaluate(() => document.querySelector('#control-out').remove());
        await page.waitForSelector('[data-fixture-nav] #control-out', { state: 'attached' });
      }));

    test('the button is on other LinkedIn pages too', () =>
      withBrowser(fixture, async ({ context }) => {
        const page = await context.newPage();
        await page.goto('https://www.linkedin.com/jobs/');
        await page.waitForSelector('[data-fixture-nav] #control-out', { state: 'attached' });
        await openPanel(page);
        assert.equal(await page.innerText(`${panel} .title`), 'Filtering your home feed');
      }));

    test('without a logo to sit next to, the button floats in the corner', () =>
      withBrowser(fixture, async ({ context }) => {
        const html = fs
          .readFileSync(path.join(ROOT, 'tests/fixtures', fixture), 'utf8')
          .replace(/<div class="(?:_lg|global-nav__logo)">in<\/div>/, '');
        await context.route('https://www.linkedin.com/**', (route) =>
          route.fulfill({ status: 200, contentType: 'text/html', body: html }),
        );
        const page = await openFeed(context);
        await page.waitForSelector('#control-out[data-floating]', { state: 'attached', timeout: 8000 });
        assert.equal(await page.evaluate(() => document.querySelector('#control-out').parentElement.tagName), 'HTML');
        await openPanel(page);
        // Opens upwards, above the button.
        const [panelBottom, buttonTop] = await page.evaluate(() => [
          document.querySelector('#control-out-panel').shadowRoot.querySelector('.panel').getBoundingClientRect().bottom,
          document.querySelector('#control-out').getBoundingClientRect().top,
        ]);
        assert.ok(panelBottom <= buttonTop, `${panelBottom} <= ${buttonTop}`);
      }));
  });
}
