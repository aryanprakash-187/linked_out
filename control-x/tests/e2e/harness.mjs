// Loads the unpacked extension into Chromium and serves the LinkedIn feed
// fixture at https://www.linkedin.com/feed/ so the content script runs for
// real. Also provides a mock Anthropic API for the AI filter.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../..');
export const EXT = path.join(ROOT, 'extension');
// Every end-to-end test runs once per markup LinkedIn has shipped.
export const FIXTURES = ['feed.html', 'feed-2026.html'];

export async function launch(fixture = 'feed.html') {
  const FIXTURE = fs.readFileSync(path.join(ROOT, 'tests/fixtures', fixture), 'utf8');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'control-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium', // full Chromium (new headless) so extensions load
    headless: process.env.HEADED ? false : true,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  // Every LinkedIn URL serves the fixture; it renders the full feed on the
  // home page and a single post elsewhere.
  await context.route('https://www.linkedin.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: FIXTURE }),
  );

  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;

  // The extension opens its settings page on install; close it.
  await new Promise((r) => setTimeout(r, 300));
  for (const p of context.pages()) if (p.url().startsWith('chrome-extension://')) await p.close();

  return { context, worker, extensionId, close: () => context.close() };
}

export async function setSettings(worker, patch) {
  await worker.evaluate(async (patch) => {
    const S = globalThis.control.settings;
    const current = await S.load();
    const merged = structuredClone(current);
    for (const [section, value] of Object.entries(patch)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) Object.assign(merged[section], value);
      else merged[section] = value;
    }
    await S.save(merged);
  }, patch);
}

export async function setSecrets(worker, secrets) {
  await worker.evaluate((s) => globalThis.control.settings.saveSecrets(s), secrets);
}

export async function openFeed(context) {
  const page = await context.newPage();
  await page.goto('https://www.linkedin.com/feed/');
  await page.waitForSelector('html[data-control-ready]', { state: 'attached' });
  await page.waitForTimeout(150); // first scan is debounced
  return page;
}

// Returns { id: status } for every post, e.g. { '1001': 'shown', '1002': 'hidden' }.
export async function postStates(page) {
  return page.evaluate(() => {
    const out = {};
    for (const el of document.querySelectorAll('[data-fixture-id]')) {
      out[el.getAttribute('data-fixture-id')] = el.getAttribute('data-control') || 'none';
    }
    return out;
  });
}

export async function barText(page, id) {
  return page.locator(`[data-fixture-id="${id}"] .control-bar__label`).innerText();
}

// Minimal stand-in for POST /v1/messages. Hides posts mentioning crypto or
// webinars, shows the rest, after an artificial delay.
export async function startMockAnthropic({ delayMs = 400, fail = null } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') return res.end();
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      requests.push({ url: req.url, headers: req.headers, body });
      setTimeout(() => {
        if (fail) {
          res.statusCode = fail.status;
          res.setHeader('content-type', 'application/json');
          return res.end(JSON.stringify({ type: 'error', error: { type: fail.type, message: fail.message } }));
        }
        const content = body.messages[0].content;
        const posts = JSON.parse(content.slice(content.indexOf('[')));
        const verdicts = posts.map((p) =>
          /crypto|webinar/i.test(p.text)
            ? { id: p.id, decision: 'hide', reason: 'Crypto promotion' }
            : { id: p.id, decision: 'show', reason: 'Fits your interests' },
        );
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            id: 'msg_mock',
            type: 'message',
            role: 'assistant',
            model: body.model,
            content: [{ type: 'text', text: JSON.stringify({ verdicts }) }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 10 },
          }),
        );
      }, delayMs);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, requests, close: () => new Promise((r) => server.close(r)) };
}
