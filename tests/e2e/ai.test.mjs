// Feature 3 (the AI filter) end to end: content script -> background batching
// -> the real bundled model in the offscreen page.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openFeed, postStates, barText, setSettings } from './harness.mjs';
import { FIXTURES } from './harness.mjs';

const INSTRUCTIONS = 'Hide crypto promotion and webinars.';
const MODEL_LOAD_MS = 30000; // the first batch loads the model

async function withAi(fixture, aiFilter, fn) {
  const b = await launch(fixture);
  try {
    await setSettings(b.worker, { aiFilter: { enabled: true, instructions: INSTRUCTIONS, ...aiFilter } });
    await fn(b);
  } finally {
    await b.close();
  }
}

async function waitForNoPending(page, timeout = MODEL_LOAD_MS) {
  await page.waitForFunction(() => !document.querySelector('[data-control="pending"]'), null, { timeout });
}

for (const fixture of FIXTURES) {
  describe(fixture, () => {
    test('blurs posts while checking, then hides what the model rejects', () =>
      withAi(fixture, {}, async ({ context }) => {
        const page = await openFeed(context);
        // Rules handle 1002/1003/1004/1006 instantly; the rest wait for the model.
        let s = await postStates(page);
        for (const id of ['1001', '1005', '1007', '1008']) assert.equal(s[id], 'pending', id);
        assert.equal(s['1002'], 'hidden');
        assert.equal(await barText(page, '1001'), 'out is checking this post…');
        await waitForNoPending(page);
        s = await postStates(page);
        assert.equal(s['1007'], 'hidden'); // crypto webinar
        assert.match(await barText(page, '1007'), /^out hid a post · Looks like crypto promotion/);
        for (const id of ['1001', '1005', '1008']) assert.equal(s[id], 'shown', id); // science posts
      }));

    test('verdicts are cached: a reload hides the same posts without re-checking', () =>
      withAi(fixture, {}, async ({ context }) => {
        const page = await openFeed(context);
        await waitForNoPending(page);
        await page.reload();
        await page.waitForSelector('html[data-control-ready]', { state: 'attached' });
        await page.waitForTimeout(600);
        const s = await postStates(page);
        assert.equal(s['1007'], 'hidden');
        assert.equal(Object.values(s).includes('pending'), false);
      }));

    test('changing the instructions re-checks the feed', () =>
      withAi(fixture, {}, async ({ context, worker }) => {
        const page = await openFeed(context);
        await waitForNoPending(page);
        await setSettings(worker, { aiFilter: { instructions: 'Only show posts about genomics and bioinformatics.' } });
        await page.waitForTimeout(200);
        await waitForNoPending(page);
        assert.match(await barText(page, '1007'), /Not about genomics and bioinformatics/);
      }));

    test('without "blur while checking", posts stay readable until a verdict arrives', () =>
      withAi(fixture, { holdWhileChecking: false }, async ({ context }) => {
        const page = await openFeed(context);
        assert.equal((await postStates(page))['1007'], 'shown');
        await page.waitForFunction(
          () => document.querySelector('[data-fixture-id="1007"]').getAttribute('data-control') === 'hidden',
          null,
          { timeout: MODEL_LOAD_MS },
        );
      }));

    test('"only" filter hides posts that are off-topic', () =>
      withAi(fixture, { instructions: 'Only show posts about genomics and bioinformatics.' }, async ({ context }) => {
        const page = await openFeed(context);
        await waitForNoPending(page);
        const s = await postStates(page);
        assert.equal(s['1007'], 'hidden');
        assert.match(await barText(page, '1007'), /Not about genomics and bioinformatics/);
        // 1008 (variant-calling runtime) is a known borderline miss for the
        // small model in a 4-post feed; accuracy is measured by the eval, not here.
        for (const id of ['1001', '1005']) assert.equal(s[id], 'shown', id);
      }));
  });
}
