import { chromium } from 'playwright';

const HIDE_CSS = '.proto-intro{display:none!important}#wpadminbar{display:none!important}html{margin-top:0!important}';

const DEFAULT_IMAGE_WAIT_MS = 10000;

export const launchBrowser = () => chromium.launch({ headless: true });

export async function openPage(browser, { url, width, height = 900, scale = 1, reducedMotion = true, imageWaitMs = DEFAULT_IMAGE_WAIT_MS }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
    ignoreHTTPSErrors: true,
  });
  const errors = { console: [], page: [], images: [] };
  let status = null;
  try {
    await context.addInitScript(() => { try { sessionStorage.setItem('protoIntroShown', 'true'); } catch {} });
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.console.push(m.text()); });
    page.on('pageerror', (e) => errors.page.push(String(e.message ?? e)));
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    status = response ? response.status() : null;
    await page.addStyleTag({ content: HIDE_CSS });
    errors.images = await page.evaluate(async (maxWaitMs) => {
      await document.fonts.ready;
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
    }, imageWaitMs);
    // A still-pending request (e.g. a stalled image) keeps the network busy; do not wait on it forever.
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(300);
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
