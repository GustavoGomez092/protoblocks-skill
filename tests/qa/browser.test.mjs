// openPage must never sit on a stalled request for the old 60 s per load: an unreachable web font or stylesheet (Google
// Fonts offline) either fails fast with a clear error (the page cannot render) or the page is used as it is.
import assert from 'node:assert/strict';
import path from 'node:path';
import { qtest, serveFixtures, QA_DIR } from './helpers.mjs';

const html = (head, body = '<main><h1>Stalled</h1><p>Text</p></main>') => ({ type: 'text/html', body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title>${head}</head><body>${body}</body></html>` });
const PAGES = {
  '/stalled-css.html': html('<link rel="stylesheet" href="/__hang">'),
  '/stalled-import.html': html('<style>@import url("/__hang");</style>'),
  '/stalled-font.html': html('<style>@font-face{font-family:Stalled;src:url(/__hang) format("woff2")} h1,p{font-family:Stalled,sans-serif}</style>'),
  '/stalled-fetch.html': html('', '<main><h1>Fetch</h1></main><script>fetch("/__hang")</script>'),
};

async function open(url, opts = {}) {
  const { launchBrowser, openPage } = await import(path.join(QA_DIR, 'browser.mjs'));
  const browser = await launchBrowser();
  const t0 = Date.now();
  try {
    const r = await openPage(browser, { url, width: 800, ...opts });
    const ms = Date.now() - t0;
    const text = await r.page.locator('h1').innerText();
    await r.context.close();
    return { ok: true, ms, errors: r.errors, status: r.status, text };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: e };
  } finally {
    await browser.close();
  }
}

qtest('openPage bounds the page load (30 s by default, not 60 s)', async () => {
  const { DEFAULT_LOAD_TIMEOUT_MS } = await import(path.join(QA_DIR, 'browser.mjs'));
  assert.ok(DEFAULT_LOAD_TIMEOUT_MS <= 30000, String(DEFAULT_LOAD_TIMEOUT_MS));
});

qtest('a stalled render-blocking stylesheet (link or @import) fails fast with ELOADTIMEOUT naming the request', { timeout: 60000 }, async () => {
  const srv = await serveFixtures(PAGES);
  try {
    for (const p of ['/stalled-css.html', '/stalled-import.html']) {
      const r = await open(`${srv.url}${p}`, { loadTimeoutMs: 3000 });
      assert.equal(r.ok, false, p);
      assert.equal(r.error.code, 'ELOADTIMEOUT', `${p}: ${r.error.message}`);
      assert.match(r.error.message, /__hang/);
      assert.match(r.error.message, /stylesheet/);
      assert.ok(r.ms < 10000, `${p}: failed after ${r.ms} ms`);
    }
  } finally { await srv.close(); }
});

qtest('a stalled web font or fetch does not stall the load: the page is used within bounded time, the stall reported', { timeout: 60000 }, async () => {
  const srv = await serveFixtures(PAGES);
  try {
    const font = await open(`${srv.url}/stalled-font.html`, { loadTimeoutMs: 3000 });
    assert.equal(font.ok, true, font.error?.message);
    assert.equal(font.text, 'Stalled');
    assert.ok(font.ms < 20000, `font: ${font.ms} ms`);
    assert.ok(font.errors.stalled.some((u) => u.endsWith('/__hang')), JSON.stringify(font.errors.stalled));
    const fetchPage = await open(`${srv.url}/stalled-fetch.html`, { loadTimeoutMs: 3000 });
    assert.equal(fetchPage.ok, true, fetchPage.error?.message);
    assert.ok(fetchPage.ms < 15000, `fetch: ${fetchPage.ms} ms`);
    assert.equal(fetchPage.status, 200);
  } finally { await srv.close(); }
});
