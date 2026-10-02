import { chromium } from 'playwright';

const HIDE_CSS = '.proto-intro{display:none!important}#wpadminbar{display:none!important}html{margin-top:0!important}';

const DEFAULT_IMAGE_WAIT_MS = 10000;
// Every wait is bounded: a stalled request (an unreachable web font or stylesheet) must never hold a page load for long.
export const DEFAULT_LOAD_TIMEOUT_MS = 30000;
const NETWORK_IDLE_MS = 5000;
const FONTS_READY_MS = 5000;

const loadTimeout = (ms, stalled, why) => Object.assign(
  new Error(`Page did not finish loading within ${ms} ms: ${why}. Still pending: ${stalled.map((s) => `${s.url} (${s.type})`).join(', ') || 'none'}. An unreachable third-party stylesheet or font? Self-host it (tokens.mjs apply does for Google fonts).`),
  { code: 'ELOADTIMEOUT', stalled: stalled.map((s) => s.url) },
);

export const launchBrowser = () => chromium.launch({ headless: true });

/**
 * Opens `url` and waits, each step bounded: the load event (`loadTimeoutMs`), network idle (5 s), web fonts (5 s), lazy
 * images (`imageWaitMs`). When the load event does not come, a page that cannot have rendered (a stylesheet still
 * pending, or parsing still blocked) fails with ELOADTIMEOUT; otherwise it is used as it is and the requests still
 * pending are reported in `errors.stalled`.
 */
export async function openPage(browser, { url, width, height = 900, scale = 1, reducedMotion = true, imageWaitMs = DEFAULT_IMAGE_WAIT_MS, loadTimeoutMs = DEFAULT_LOAD_TIMEOUT_MS }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
    ignoreHTTPSErrors: true,
  });
  const errors = { console: [], page: [], images: [], stalled: [] };
  let status = null;
  try {
    await context.addInitScript(() => { try { sessionStorage.setItem('protoIntroShown', 'true'); } catch {} });
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.console.push(m.text()); });
    page.on('pageerror', (e) => errors.page.push(String(e.message ?? e)));
    const pending = new Set();
    page.on('request', (r) => pending.add(r));
    page.on('requestfinished', (r) => pending.delete(r));
    page.on('requestfailed', (r) => pending.delete(r));
    const stalledNow = () => [...pending].map((r) => ({ url: r.url(), type: r.resourceType() }));
    const response = await page.goto(url, { waitUntil: 'commit', timeout: loadTimeoutMs });
    status = response ? response.status() : null;
    try {
      await page.waitForLoadState('load', { timeout: loadTimeoutMs });
    } catch (e) {
      if (e?.name !== 'TimeoutError') throw e;
      const stalled = stalledNow();
      const css = stalled.filter((s) => s.type === 'stylesheet');
      if (css.length) throw loadTimeout(loadTimeoutMs, stalled, 'a render-blocking stylesheet never loaded, so nothing is rendered');
      const parsing = await page.evaluate(() => document.readyState).catch(() => 'loading');
      if (parsing === 'loading') throw loadTimeout(loadTimeoutMs, stalled, 'the document is still being parsed (a blocking script?)');
    }
    await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_MS }).catch(() => {});
    await page.addStyleTag({ content: HIDE_CSS });
    errors.images = await page.evaluate(async ({ maxWaitMs, fontsMs }) => {
      await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, fontsMs))]);
      const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      // Not-rendered images (display:none subtree, visibility:hidden) never load when lazy and are not painted: skip them.
      const rendered = (i) => i.getClientRects().length > 0 && getComputedStyle(i).visibility !== 'hidden';
      const stalled = () => [...document.images].filter((i) => !i.complete && rendered(i));
      const pending = stalled();
      await Promise.race([
        Promise.all(pending.map((i) => new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); }))),
        new Promise((r) => setTimeout(r, maxWaitMs)),
      ]);
      window.scrollTo(0, 0);
      return stalled().map((i) => i.currentSrc || i.src);
    }, { maxWaitMs: imageWaitMs, fontsMs: FONTS_READY_MS });
    // A still-pending request (e.g. a stalled image) keeps the network busy; do not wait on it forever.
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(300);
    errors.stalled = [...new Set(stalledNow().map((s) => s.url))];
    return { page, context, errors, status };
  } catch (e) {
    await context.close().catch(() => {});
    throw withDiagnostics(e, errors, status);
  }
}

// Keep what the page reported before a failure so error results stay diagnosable.
export function withDiagnostics(e, errors, status) {
  if (e && typeof e === 'object') {
    e.pageErrors ??= errors.page;
    e.consoleErrors ??= errors.console;
    e.status ??= status;
  }
  return e;
}
