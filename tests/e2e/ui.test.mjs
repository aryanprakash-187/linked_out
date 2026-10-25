// The popup and settings page, driven like a user would: typing, clicking,
// and checking that an open LinkedIn tab reacts without a reload.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openFeed, postStates } from './harness.mjs';
import { FIXTURES } from './harness.mjs';

async function withBrowser(fixture, fn) {
  const b = await launch(fixture);
  try {
    await fn(b);
  } finally {
    await b.close();
  }
}

async function openOptions(context, extensionId, hash = '') {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options/options.html${hash}`);
  // options.js has rendered the saved settings (#enabled is unchecked in the HTML).
  await page.waitForSelector('#enabled:checked', { state: 'attached' });
  return page;
}

async function activeTabId(worker) {
  return worker.evaluate(async () => (await chrome.tabs.query({ active: true }))[0].id);
}

for (const fixture of FIXTURES) {
  describe(fixture, () => {
    test('typing keywords on the settings page updates an open feed', () =>
      withBrowser(fixture, async ({ context, extensionId }) => {
        const feed = await openFeed(context);
        const options = await openOptions(context, extensionId);
        await options.fill('#keyword-list', 'crypto\nvariant-calling\n  \nCRYPTO');
        await options.locator('#keyword-list').blur();
        await options.waitForSelector('#keywords-state:has-text("Saved · 2 keywords")');
        await feed.waitForTimeout(300);
        const s = await postStates(feed);
        assert.equal(s['1004'], 'shown', 'internship placeholder removed');
        assert.equal(s['1007'], 'hidden');
        assert.equal(s['1008'], 'hidden');
        // Reloading the settings page shows the cleaned-up list.
        await options.reload();
        assert.equal(await options.inputValue('#keyword-list'), 'crypto\nvariant-calling');
      }));

    test('instructions need an explicit save, which also switches the AI filter on', () =>
      withBrowser(fixture, async ({ context, extensionId }) => {
        const options = await openOptions(context, extensionId);
        const save = options.locator('#save-instructions');
        assert.equal(await save.isDisabled(), true);
        await options.fill('#instructions', 'Only bioinformatics.');
        assert.equal(await save.isDisabled(), false);
        assert.equal(await options.innerText('#instructions-state'), 'Unsaved changes');
        await save.click();
        await options.waitForSelector('#instructions-state:has-text("Saved")');
        assert.equal(await options.isChecked('#ai input[data-path="aiFilter.enabled"]'), true);
        // The on-device filter shows how it parsed the instructions.
        assert.equal(await options.innerText('#understood-list'), 'Only show: bioinformatics');
        assert.equal(await save.isDisabled(), true);
        // Ctrl+Enter saves too.
        await options.fill('#instructions', 'Only bioinformatics and genomics.');
        await options.press('#instructions', 'Control+Enter');
        await options.waitForFunction(() => document.querySelector('#save-instructions').disabled);
      }));

    test('"Try it on sample posts" shows a verdict per sample, on-device', () =>
      withBrowser(fixture, async ({ context, extensionId }) => {
        const options = await openOptions(context, extensionId, '#ai');
        await options.fill('#instructions', 'Hide webinars and engagement bait.');
        await options.click('#test-ai');
        await options.waitForSelector('.verdict', { timeout: 30000 });
        const tags = await options.locator('.verdict .tag').allInnerTexts();
        // The 4th sample (a rejection story ending in "Agree?") is too subtle
        // for the small model; the default keyword list catches "agree?".
        assert.deepEqual(
          tags.map((t) => t.toLowerCase()),
          ['show', 'show', 'hide', 'show'],
        );
      }));

    test('popup toggles control the open feed', () =>
      withBrowser(fixture, async ({ context, worker, extensionId }) => {
        const feed = await openFeed(context);
        const tabId = await activeTabId(worker);
        const popup = await context.newPage();
        await popup.goto(`chrome-extension://${extensionId}/popup/popup.html?tabId=${tabId}`);
        await popup.waitForSelector('#status:has-text("Hidden 4 of 8 posts")');

        await popup.click('label:has([data-path="modes.hidePromoted"])');
        await feed.waitForTimeout(300);
        assert.equal((await postStates(feed))['1002'], 'shown');

        await popup.click('label:has([data-path="layout.blankHome"])');
        await feed.waitForTimeout(300);
        assert.equal(await feed.locator('#main').isVisible(), false);
        await popup.waitForSelector('#status:has-text("Home page is blank")');

        await popup.click('#enabled');
        await feed.waitForTimeout(300);
        assert.equal(await feed.locator('#main').isVisible(), true);
        assert.equal(await feed.locator('.control-bar').count(), 0);
        await popup.waitForSelector('#status:has-text("out is off")');
      }));

    test('turning on the AI filter from the popup before setup opens settings at that section', () =>
      withBrowser(fixture, async ({ context, extensionId }) => {
        const popup = await context.newPage();
        await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
        const [options] = await Promise.all([
          context.waitForEvent('page'),
          popup.click('label:has([data-path="aiFilter.enabled"])'),
        ]);
        await options.waitForLoadState();
        assert.match(options.url(), /options\.html#ai$/);
      }));
  });
}
