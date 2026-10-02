#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser, openPage } from './browser.mjs';
import { shoot, anchorImages, hideChrome } from './shoot.mjs';
import { diffImages } from './diff.mjs';

export const MOTION_THRESHOLDS = {
  settledMismatchMax: 0.02, clsMax: 0.01, settleTimeoutMs: 6000, settleMs: 500,
  taxiReadyTimeoutMs: 8000, taxiSettleTimeoutMs: 3000, taxiBusyMs: 3000, taxiRetryDelayMs: 150,
};

const revealSelector = (sel) => `${sel} [data-pb-motion][data-proto-animate], ${sel}[data-pb-motion][data-proto-animate]`;
const uniq = (...lists) => [...new Set(lists.flat())];

// Scroll from one viewport above the anchor slowly down through it, then centre it (ScrollTrigger sees every step).
// openPage's lazy-image scroll has usually fired the once-triggers already, so on first load this confirms the
// settled state rather than exercising the motion itself.
const scrollThrough = (page, sel) => page.evaluate(async (s) => {
  const el = document.querySelector(s);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY;
  const end = top + el.offsetHeight;
  for (let y = Math.max(0, top - window.innerHeight); y <= end; y += 120) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
  el.scrollIntoView({ block: 'center' });
}, sel);

// Layout shifts since navigation start (buffered), on the whole page and those with a source node in the anchor.
// The same observer runs on the reduced-motion page (baseline) and on the motion page.
const watchCls = (page, sel) => page.evaluate((s) => {
  const anchorEl = document.querySelector(s);
  window.__pbCls = 0;
  window.__pbClsPage = 0;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (e.hadRecentInput) continue;
      window.__pbClsPage += e.value;
      if (anchorEl && (e.sources || []).some((x) => x.node && anchorEl.contains(x.node))) window.__pbCls += e.value;
    }
  }).observe({ type: 'layout-shift', buffered: true });
}, sel);
const readCls = (page) => page.evaluate(() => ({ anchor: window.__pbCls, page: window.__pbClsPage }));
const round4 = (v) => Math.round(v * 10000) / 10000;

// Wait until every reveal element in the anchor reports done; on timeout return the stragglers (id or preset name).
async function waitSettled(page, sel) {
  const rs = revealSelector(sel);
  await page.waitForFunction((s) => [...document.querySelectorAll(s)].every((e) => e.getAttribute('data-proto-animate') === 'done'), rs, { timeout: MOTION_THRESHOLDS.settleTimeoutMs, polling: 100 })
    .catch((e) => { if (e.name !== 'TimeoutError') throw e; });
  return page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.getAttribute('data-proto-animate') !== 'done').map((e) => e.id || e.getAttribute('data-pb-motion')), rs);
}

const taxiError = (msg) => { const e = new Error(msg); e.code = 'ETAXI'; return e; };
// Taxi's only navigateTo rejection (allowInterruption:false while a transition runs); anything else is a real failure.
const TAXI_LOCKED = 'transition is currently in progress';
// When its fetch fails or returns non-2xx, Taxi falls back to window.location.href = url: the page reloads, and any
// in-flight evaluate/wait dies with one of these.
const HARD_NAV = /Execution context was destroyed|Target (page, context or browser has been )?closed|navigat|frame was detached/i;

// Run one page call of a Taxi navigation, turning a hard-navigation death into ETAXI.
async function viaTaxi(target, call) {
  try {
    return await call();
  } catch (e) {
    if (e.code !== 'ETAXI' && HARD_NAV.test(String(e && e.message))) {
      throw taxiError(`navigateTo(${target}) fell back to a hard navigation (Taxi sets location.href when its fetch fails or is non-2xx): ${String(e.message).split('\n')[0]}`);
    }
    throw e;
  }
}

// One Taxi navigation. Waits for core.isTransitioning to clear (the theme runs ~0.9s transitions with
// allowInterruption:false), awaits navigateTo's own promise in the page so a rejection never becomes an unhandled
// page error, retries only the transition-lock rejection for up to taxiBusyMs (for a Taxi that exposes no flag),
// then waits for page-ready. Every other failure is an immediate ETAXI.
async function navigate(page, target, taxi) {
  const T = MOTION_THRESHOLDS;
  const deadline = Date.now() + T.taxiBusyMs;
  for (;;) {
    await viaTaxi(target, () => page.waitForFunction(() => window.protoTaxi.core.isTransitioning !== true, null, { timeout: T.taxiBusyMs, polling: 50 })
      .catch((e) => { if (e.name !== 'TimeoutError') throw e; })); // still busy: try anyway, the rejection is handled below
    const r = await viaTaxi(target, () => page.evaluate(async ({ t, ms }) => {
      const n = window.__pbReady;
      let timer;
      try {
        await Promise.race([
          Promise.resolve(window.protoTaxi.core.navigateTo(t)),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`navigateTo did not settle within ${ms}ms`)), ms); }),
        ]);
        return { ok: true, n };
      } catch (e) {
        return { ok: false, n, error: String((e && e.message) || e) };
      } finally { clearTimeout(timer); }
    }, { t: target, ms: T.taxiReadyTimeoutMs }));
    if (r.ok) {
      await viaTaxi(target, () => page.waitForFunction((k) => window.__pbReady > k, r.n, { timeout: T.taxiReadyTimeoutMs }).catch((e) => {
        if (e.name !== 'TimeoutError') throw e;
        throw taxiError(`proto:page-ready was not dispatched within ${T.taxiReadyTimeoutMs}ms of navigateTo(${target})`);
      }));
      // New triggers already past their start fire on ScrollTrigger's next internal update (~0.3s after init here),
      // then kill themselves (once). Count only after none is pending, or the count depends on timing.
      await viaTaxi(target, () => page.waitForFunction(() => window.ScrollTrigger.getAll().every((t) => !t.vars.once || t.start >= t.scroll()), null, { timeout: T.taxiSettleTimeoutMs, polling: 50 })
        .catch((e) => { if (e.name !== 'TimeoutError') throw e; }));
      return;
    }
    if (!r.error.includes(TAXI_LOCKED)) throw taxiError(`navigateTo(${target}) rejected: ${r.error}`);
    if (Date.now() >= deadline) throw taxiError(`navigateTo(${target}) kept rejecting for ${T.taxiBusyMs}ms: ${r.error}`);
    taxi.retries += 1; // counted as it happens, so a navigation that finally fails still reports its retries
    await page.waitForTimeout(T.taxiRetryDelayMs);
  }
}

// Taxi re-init. The count before any navigation is not comparable: openPage already scrolled the whole page, so
// every once-trigger fired and died. Instead, from scroll 0, do two identical away -> page round trips: the trigger
// count after each must match (a leak grows it), no motion element may own two triggers (duplicate init), and the
// anchor must reveal again afterwards. "Away" is the page itself with a marker query, so it works for home-page
// anchors and subdirectory installs. A navigation failure is recorded as taxi.error, never thrown.
async function taxiCheck(page, url, sel) {
  const awayUrl = new URL(url);
  awayUrl.searchParams.set('pb-motion-away', '1');
  awayUrl.hash = '';
  const away = awayUrl.href;
  await page.evaluate(() => {
    window.__pbReady = 0;
    document.addEventListener('proto:page-ready', () => { window.__pbReady += 1; });
    window.scrollTo(0, 0);
  });
  const taxi = { checked: true, away, retries: 0 };
  try {
    const roundTrip = async () => {
      for (const target of [away, url]) await navigate(page, target, taxi);
      return page.evaluate(() => window.ScrollTrigger.getAll().length);
    };
    taxi.before = await roundTrip();
    taxi.after = await roundTrip();
  } catch (e) {
    if (e.code !== 'ETAXI') throw e;
    taxi.error = `ETAXI: ${e.message}`;
    return taxi;
  }
  taxi.duplicates = await page.evaluate(() => {
    const root = document.querySelector('[data-taxi-view]') || document.body;
    const counts = new Map();
    for (const t of window.ScrollTrigger.getAll()) {
      const el = t.trigger;
      if (el && el.nodeType === 1 && el.matches('[data-pb-motion]') && root.contains(el)) counts.set(el, (counts.get(el) || 0) + 1);
    }
    return [...counts].filter(([, c]) => c > 1).map(([el]) => el.id || el.getAttribute('data-pb-motion'));
  });
  await scrollThrough(page, sel);
  taxi.unsettled = await waitSettled(page, sel);
  return taxi;
}

export async function motionCheck({ url, anchor, width = 1440, scale = 1, outDir, browser, imageWaitMs }) {
  fs.mkdirSync(outDir, { recursive: true });
  // A result from an earlier run must never outlive this one: if this run crashes, there is no file to record.
  fs.rmSync(path.join(outDir, 'motion-check.json'), { force: true });
  const own = !browser;
  const b = browser ?? await launchBrowser();
  const selector = `#${anchor}`;
  const reduced = path.join(outDir, 'reduced.png');
  const settled = path.join(outDir, 'settled.png');
  try {
    // Baseline: the reduced-motion page, measured like the motion page (scroll through, settle). Shifts it sees
    // (font swap, late images, load-time scripts) happen without motion and are not held against it.
    const shot = await shoot({
      url, selector, width, scale, out: reduced, browser: b, imageWaitMs,
      inspect: async (p) => {
        await watchCls(p, selector);
        await scrollThrough(p, selector);
        await p.waitForTimeout(MOTION_THRESHOLDS.settleMs);
        return readCls(p);
      },
    });
    const { page, context, errors } = await openPage(b, { url, width, scale, reducedMotion: false, imageWaitMs });
    try {
      // cls (pass/fail): anchor-sourced shifts on the motion page minus the reduced page's (clsBaseline).
      // clsPage: every shift on the motion page (information only).
      await watchCls(page, selector);
      await scrollThrough(page, selector);
      const unsettled = await waitSettled(page, selector);
      await page.waitForTimeout(MOTION_THRESHOLDS.settleMs);
      // Same framing as shoot's reduced frame: hide fixed/sticky chrome outside the anchor, or a fixed header stitched
      // into a taller-than-viewport anchor shot reads as settle residue. Animations are deliberately NOT disabled here:
      // this frame is the post-motion state, and freezing animations would hide exactly the residue being measured.
      const loc = page.locator(selector).first();
      const motionImages = await anchorImages(loc);
      await hideChrome(loc);
      // Continuous presets (parallax, marquee) never settle, so they are judged at rest: stopped in their rest
      // position (offset 0, marquee copies removed), the same state the reduced-motion frame shows.
      await page.evaluate((sel) => { if (window.pbMotion && window.pbMotion.rest) window.pbMotion.rest(document.querySelector(sel)); }, selector);
      await page.waitForTimeout(150);
      await loc.screenshot({ path: settled });
      const measured = await readCls(page);
      const clsMotion = round4(measured.anchor);
      const clsBaseline = round4(shot.inspected.anchor);
      // Caveat: baseline and motion come from two separate page loads. Load-time shifts are not perfectly repeatable,
      // and a large baseline (e.g. a font swap reflowing the section) can absorb a motion shift of similar size, so a
      // passing cls with a large clsBaseline is weak evidence. Both inputs are reported (clsMotion, clsBaseline).
      const cls = round4(Math.max(0, measured.anchor - shot.inspected.anchor));
      const clsPage = round4(measured.page);

      const hasTaxi = await page.evaluate(() => !!(window.protoTaxi && window.protoTaxi.core && window.ScrollTrigger));
      const taxi = hasTaxi ? await taxiCheck(page, url, selector) : { checked: false };

      // Both shots are the anchor element itself, so no masks; fullyMasked would mean nothing was compared.
      const d = await diffImages({ design: reduced, render: settled });
      const pageErrors = uniq(shot.pageErrors, errors.page);
      // Only the anchor's images can fail the check (as in shoot); stalled images elsewhere are warnings.
      const imageErrors = uniq(shot.imageErrors, motionImages.errors);
      const pageImageWarnings = uniq(shot.pageImageWarnings, motionImages.warnings);
      const result = {
        url, anchor,
        settledMismatch: d.mismatch,
        settledHeightDelta: d.heightDelta,
        cls,
        clsMotion,
        clsBaseline,
        clsPage,
        pageErrors,
        imageErrors,
        pageImageWarnings,
        unsettled,
        taxi,
        reduced, settled,
      };
      result.pass = !d.fullyMasked && d.mismatch <= MOTION_THRESHOLDS.settledMismatchMax && d.heightDelta === 0
        && cls <= MOTION_THRESHOLDS.clsMax && pageErrors.length === 0 && imageErrors.length === 0 && unsettled.length === 0
        && (!taxi.checked || (!taxi.error && taxi.before === taxi.after && taxi.duplicates.length === 0 && taxi.unsettled.length === 0));
      fs.writeFileSync(path.join(outDir, 'motion-check.json'), `${JSON.stringify(result, null, 2)}\n`);
      return result;
    } finally { await context.close().catch(() => {}); }
  } finally { if (own) await b.close().catch(() => {}); }
}

async function main(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
  if (!a.url || !a.anchor || !a.out) { process.stderr.write('Usage: node motion-check.mjs --url U --anchor pb-sN --out <dir> [--width 1440] [--scale 1]\n'); process.exit(64); }
  const r = await motionCheck({ url: a.url, anchor: a.anchor, outDir: a.out, width: a.width ? Number(a.width) : 1440, scale: a.scale ? Number(a.scale) : 1 });
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  if (!r.pass) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); });
}
