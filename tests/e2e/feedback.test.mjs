// Personal feedback end to end: the teaching buttons, a correction re-judging
// the feed with the real model, Undo, "Show anyway" reveals, and persistence.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openFeed, postStates, barText, setSettings, FIXTURES } from './harness.mjs';

const INSTRUCTIONS = 'Hide crypto promotion and webinars.';
const MODEL_LOAD_MS = 30000; // the first batch loads the model

async function withAi(fixture, fn) {
  const b = await launch(fixture);
  try {
    await setSettings(b.worker, { aiFilter: { enabled: true, instructions: INSTRUCTIONS } });
    await fn(b);
  } finally {
    await b.close();
  }
}

const post = (id) => `[data-fixture-id="${id}"]`;

async function settle(page) {
  await page.waitForFunction(() => !document.querySelector('[data-control="pending"]'), null, {
    timeout: MODEL_LOAD_MS,
  });
}

async function waitForState(page, id, status) {
  await page.waitForFunction(
    ([selector, wanted]) => document.querySelector(selector).getAttribute('data-control') === wanted,
    [post(id), status],
    { timeout: MODEL_LOAD_MS },
  );
}

for (const fixture of FIXTURES) {
  describe(fixture, () => {
    test('AI-judged posts offer teaching buttons; rule-hidden posts do not', () =>
      withAi(fixture, async ({ context }) => {
        const page = await openFeed(context);
        await settle(page);
        // 1007 is hidden by the model, 1001/1005/1008 are shown, 1002 is hidden by a rule.
        assert.equal(await page.innerText(`${post('1007')} .control-bar .control-feedback-actions`), 'This should be shown');
        for (const id of ['1001', '1005', '1008']) {
          assert.equal(await page.innerText(`${post(id)} .control-feedback-actions`), 'Hide more like this', id);
        }
        assert.equal(await page.locator(`${post('1002')} .control-feedback-actions`).count(), 0);
      }));

    test('"This should be shown" un-hides the post, and Undo stays available and hides it again', () =>
      withAi(fixture, async ({ context }) => {
        const page = await openFeed(context);
        await settle(page);
        await page.click(`${post('1007')} .control-feedback-actions button`);
        await waitForState(page, '1007', 'shown');
        await settle(page);
        // The correction re-judges the whole feed; the note and its Undo survive that.
        const note = page.locator(`${post('1007')} .control-feedback-status`);
        assert.match(await note.innerText(), /^Preference saved on this device\.\s+Undo correction$/);
        await note.locator('button').click();
        await waitForState(page, '1007', 'hidden');
        await settle(page);
        assert.equal(await note.innerText(), 'Correction undone.');
        assert.match(await barText(page, '1007'), /Looks like crypto promotion/);
      }));

    test('a correction keeps other posts revealed with "Show anyway"', () =>
      withAi(fixture, async ({ context }) => {
        const page = await openFeed(context);
        await settle(page);
        await page.click(`${post('1002')} .control-bar__show`);
        assert.equal((await postStates(page))['1002'], 'revealed');
        await page.click(`${post('1007')} .control-feedback-actions button`);
        await waitForState(page, '1007', 'shown');
        await settle(page);
        assert.equal((await postStates(page))['1002'], 'revealed');
      }));

    test('"Hide more like this" on a post revealed with "Show anyway" hides it again', () =>
      withAi(fixture, async ({ context }) => {
        const page = await openFeed(context);
        await settle(page);
        await page.click(`${post('1007')} .control-bar__show`);
        assert.equal(await page.innerText(`${post('1007')} .control-feedback-actions`), 'Hide more like this');
        await page.click(`${post('1007')} .control-feedback-actions button`);
        await waitForState(page, '1007', 'hidden');
        assert.match(await barText(page, '1007'), /Your correction/);
      }));

    test('a correction survives reloading the page', () =>
      withAi(fixture, async ({ context }) => {
        const page = await openFeed(context);
        await settle(page);
        await page.click(`${post('1005')} .control-feedback-actions button`);
        await waitForState(page, '1005', 'hidden');
        assert.match(await barText(page, '1005'), /Your correction/);
        await page.reload();
        await page.waitForSelector('html[data-control-ready]', { state: 'attached' });
        await page.waitForTimeout(150); // first scan is debounced
        await settle(page);
        assert.equal((await postStates(page))['1005'], 'hidden');
        assert.match(await barText(page, '1005'), /Your correction/);
      }));
  });
}
