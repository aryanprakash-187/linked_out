// Loads the unpacked extension into Chromium and serves the LinkedIn feed
// fixture at https://www.linkedin.com/feed/ so the content script runs for
// real.
import { chromium } from 'playwright';
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
