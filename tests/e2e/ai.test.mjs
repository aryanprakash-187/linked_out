// Feature 3 (the AI filter) end to end, with a local mock of the Anthropic
// API standing in for the real one. The extension's real code path runs:
// content script -> background batching -> official Anthropic SDK -> HTTP.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openFeed, postStates, barText, setSettings, setSecrets, startMockAnthropic } from './harness.mjs';
import { FIXTURES } from './harness.mjs';

const INSTRUCTIONS = 'Hide crypto promotion and webinars.';

async function withAi(fixture, opts, fn) {
  const mock = await startMockAnthropic(opts.mock);
  const b = await launch(fixture);
  try {
    await setSecrets(b.worker, { anthropicApiKey: opts.key ?? 'sk-ant-test', anthropicBaseUrl: mock.url });
    await setSettings(b.worker, {
      aiFilter: { enabled: true, instructions: INSTRUCTIONS, ...(opts.aiFilter || {}) },
    });
    await fn({ ...b, mock });
  } finally {
    await b.close();
    await mock.close();
  }
}

async function waitForNoPending(page, timeout = 10000) {
  await page.waitForFunction(() => !document.querySelector('[data-control="pending"]'), null, { timeout });
}

for (const fixture of FIXTURES) {
  describe(fixture, () => {
    test('AI filter blurs posts while checking, then hides what the model rejects', () =>
      withAi(fixture, { mock: { delayMs: 800 } }, async ({ context, mock }) => {
        const page = await openFeed(context);
        // Rules handle 1002/1003/1004/1006 instantly; the rest wait for the AI.
        let s = await postStates(page);
        for (const id of ['1001', '1005', '1007', '1008']) assert.equal(s[id], 'pending', id);
        assert.equal(s['1002'], 'hidden');
        assert.equal(await barText(page, '1001'), 'control. is checking this post…');
        await waitForNoPending(page);
        s = await postStates(page);
        assert.equal(s['1007'], 'hidden');
        assert.equal(s['1001'], 'shown');
        assert.equal(s['1008'], 'shown');
        assert.equal(await barText(page, '1007'), 'control. hid a post · Crypto promotion');

        // All four posts went out in one batched request.
        assert.equal(mock.requests.length, 1);
        const { headers, body, url } = mock.requests[0];
        assert.match(url, /^\/v1\/messages(\?|$)/);
        assert.equal(headers['x-api-key'], 'sk-ant-test');
        assert.match(headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
        assert.equal(body.model, 'claude-opus-5-5');
        assert.equal(body.fallbacks, 'default');
        assert.equal(body.output_config.effort, 'low');
        assert.equal(body.output_config.format.type, 'json_schema');
        assert.match(body.system, /Hide crypto promotion and webinars\./);
        const posts = JSON.parse(body.messages[0].content.slice(body.messages[0].content.indexOf('[')));
        assert.equal(posts.length, 4);
        assert.ok(posts.some((p) => p.author === 'Priya Raman' && /single-cell/.test(p.text)));
      }));

    test('verdicts are cached: reloading the feed makes no new API calls', () =>
      withAi(fixture, {}, async ({ context, mock }) => {
        const page = await openFeed(context);
        await waitForNoPending(page);
        assert.equal(mock.requests.length, 1);
        await page.reload();
        await page.waitForSelector('html[data-control-ready]', { state: 'attached' });
        await page.waitForTimeout(600);
        assert.equal((await postStates(page))['1007'], 'hidden');
        assert.equal(mock.requests.length, 1);
      }));

    test('changing the instructions re-checks the feed', () =>
      withAi(fixture, {}, async ({ context, worker, mock }) => {
        const page = await openFeed(context);
        await waitForNoPending(page);
        await setSettings(worker, { aiFilter: { instructions: 'Only bioinformatics please.' } });
        await page.waitForTimeout(200);
        await waitForNoPending(page);
        assert.equal(mock.requests.length, 2);
        assert.match(mock.requests[1].body.system, /Only bioinformatics please\./);
      }));

    test('without "blur while checking", posts stay readable until a verdict arrives', () =>
      withAi(fixture, { aiFilter: { holdWhileChecking: false }, mock: { delayMs: 800 } }, async ({ context }) => {
        const page = await openFeed(context);
        assert.equal((await postStates(page))['1007'], 'shown');
        await page.waitForFunction(
          () => document.querySelector('[data-fixture-id="1007"]').getAttribute('data-control') === 'hidden',
          null,
          { timeout: 10000 },
        );
      }));

    test('a rejected API key fails open: posts are shown and the popup explains why', () =>
      withAi(
        fixture,
        { mock: { fail: { status: 401, type: 'authentication_error', message: 'invalid x-api-key' } } },
        async ({ context, extensionId }) => {
          const page = await openFeed(context);
          await waitForNoPending(page);
          const s = await postStates(page);
          assert.equal(s['1007'], 'shown');
          assert.equal(s['1002'], 'hidden', 'rules keep working when the AI fails');
          const popup = await context.newPage();
          await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
          const error = popup.locator('#ai-error');
          await error.waitFor({ state: 'visible' });
          assert.match(await error.innerText(), /API key was rejected/);
        },
      ));

    test('no API key: nothing is hidden by AI and no request is sent', () =>
      withAi(fixture, { key: '' }, async ({ context, mock }) => {
        const page = await openFeed(context);
        await waitForNoPending(page);
        assert.equal((await postStates(page))['1007'], 'shown');
        assert.equal(mock.requests.length, 0);
      }));

    test('Chrome built-in AI provider: posts are judged on-device, nothing sent to Anthropic', () =>
      withAi(fixture, { aiFilter: { provider: 'chrome-ai' } }, async ({ context, worker, mock }) => {
        // Headless Chromium has no Gemini Nano, so stand in for the Prompt API
        // inside the service worker (where background.js looks first).
        await worker.evaluate(() => {
          globalThis.__lmCalls = [];
          const session = {
            clone: async () => session,
            destroy() {},
            async prompt(user, options) {
              globalThis.__lmCalls.push({ user, hasSchema: Boolean(options && options.responseConstraint) });
              const posts = JSON.parse(user.slice(user.indexOf('[')));
              const verdicts = posts.map((p) =>
                /crypto/i.test(p.text)
                  ? { id: p.id, decision: 'hide', reason: 'On-device: crypto' }
                  : { id: p.id, decision: 'show', reason: 'ok' },
              );
              return JSON.stringify({ verdicts });
            },
          };
          globalThis.LanguageModel = { availability: async () => 'available', create: async () => session };
        });
        const page = await openFeed(context);
        await waitForNoPending(page);
        assert.equal((await postStates(page))['1007'], 'hidden');
        assert.equal(await barText(page, '1007'), 'control. hid a post · On-device: crypto');
        const calls = await worker.evaluate(() => globalThis.__lmCalls);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].hasSchema, true);
        assert.equal(mock.requests.length, 0);
      }));

    test('Haiku is called without the fallback beta', () =>
      withAi(fixture, { aiFilter: { model: 'claude-haiku-5-5' } }, async ({ context, mock }) => {
        const page = await openFeed(context);
        await waitForNoPending(page);
        const { headers, body } = mock.requests[0];
        assert.equal(body.model, 'claude-haiku-5-5');
        assert.equal(body.fallbacks, undefined);
        assert.equal(headers['anthropic-beta'], undefined);
      }));
  });
}
