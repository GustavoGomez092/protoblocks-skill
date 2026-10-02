#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser, openPage } from './browser.mjs';
import { shoot } from './shoot.mjs';
import { diffImages } from './diff.mjs';

export const MOTION_THRESHOLDS = { settledMismatchMax: 0.02, clsMax: 0.01, settleTimeoutMs: 6000, settleMs: 500, taxiReadyTimeoutMs: 8000, taxiSettleMs: 300 };

const revealSelector = (sel) => `${sel} [data-pb-motion][data-proto-animate], ${sel}[data-pb-motion][data-proto-animate]`;
const uniq = (...lists) => [...new Set(lists.flat())];

// Scroll from one viewport above the anchor slowly down through it, then centre it (ScrollTrigger sees every step).
const scrollThrough = (page, sel) => page.evaluate(async (s) => {
  const el = document.querySelector(s);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY;
  const end = top + el.offsetHeight;
  for (let y = Math.max(0, top - window.innerHeight); y <= end; y += 120) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
  el.scrollIntoView({ block: 'center' });
}, sel);

// Wait until every reveal element in the anchor reports done; on timeout return the stragglers (id or preset name).
async function waitSettled(page, sel) {
  const rs = revealSelector(sel);
  await page.waitForFunction((s) => [...document.querySelectorAll(s)].every((e) => e.getAttribute('data-proto-animate') === 'done'), rs, { timeout: MOTION_THRESHOLDS.settleTimeoutMs, polling: 100 })
    .catch((e) => { if (e.name !== 'TimeoutError') throw e; });
  return page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.getAttribute('data-proto-animate') !== 'done').map((e) => e.id || e.getAttribute('data-pb-motion')), rs);
}

// Taxi re-init. The count before any navigation is not comparable: openPage already scrolled the whole page, so
// every once-trigger fired and died. Instead, from scroll 0, do two identical home -> page round trips: the trigger
// count after each must match (a leak or duplicate init grows it), and the anchor must reveal again afterwards.
async function taxiCheck(page, url, sel) {
  await page.evaluate(() => {
    window.__pbReady = 0;
    document.addEventListener('proto:page-ready', () => { window.__pbReady += 1; });
    window.scrollTo(0, 0);
  });
  const roundTrip = async () => {
    for (const target of [new URL('/', url).href, url]) {
      const n = await page.evaluate((t) => { const n = window.__pbReady; window.protoTaxi.core.navigateTo(t); return n; }, target);
      await page.waitForFunction((k) => window.__pbReady > k, n, { timeout: MOTION_THRESHOLDS.taxiReadyTimeoutMs }).catch((e) => {
        if (e.name !== 'TimeoutError') throw e;
        const err = new Error(`proto:page-ready was not dispatched within ${MOTION_THRESHOLDS.taxiReadyTimeoutMs}ms of navigateTo(${target})`);
        err.code = 'ETAXI';
        throw err;
      });
      await page.waitForTimeout(MOTION_THRESHOLDS.taxiSettleMs); // let in-view triggers fire (once-triggers then kill themselves)
    }
    return page.evaluate(() => window.ScrollTrigger.getAll().length);
  };
  const before = await roundTrip();
  const after = await roundTrip();
  await scrollThrough(page, sel);
  const unsettled = await waitSettled(page, sel);
  return { checked: true, before, after, unsettled };
}

export async function motionCheck({ url, anchor, width = 1440, scale = 1, outDir, browser }) {
  fs.mkdirSync(outDir, { recursive: true });
  const own = !browser;
  const b = browser ?? await launchBrowser();
  const selector = `#${anchor}`;
  const reduced = path.join(outDir, 'reduced.png');
  const settled = path.join(outDir, 'settled.png');
  try {
    const shot = await shoot({ url, selector, width, scale, out: reduced, browser: b });
    const { page, context, errors } = await openPage(b, { url, width, scale, reducedMotion: false });
    try {
      await page.evaluate(() => {
        window.__pbCls = 0;
        new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__pbCls += e.value; })
          .observe({ type: 'layout-shift', buffered: true });
      });
      await scrollThrough(page, selector);
      const unsettled = await waitSettled(page, selector);
      await page.waitForTimeout(MOTION_THRESHOLDS.settleMs);
      await page.locator(selector).first().screenshot({ path: settled });
      const cls = await page.evaluate(() => Math.round((window.__pbCls ?? 0) * 10000) / 10000);

      const hasTaxi = await page.evaluate(() => !!(window.protoTaxi && window.protoTaxi.core && window.ScrollTrigger));
      const taxi = hasTaxi ? await taxiCheck(page, url, selector) : { checked: false };

      // Both shots are the anchor element itself, so no masks; fullyMasked would mean nothing was compared.
      const d = await diffImages({ design: reduced, render: settled });
      const pageErrors = uniq(shot.pageErrors, errors.page);
      const imageErrors = uniq(shot.imageErrors, errors.images);
      const result = {
        url, anchor,
        settledMismatch: d.mismatch,
        settledHeightDelta: d.heightDelta,
        cls,
        pageErrors,
        imageErrors,
        unsettled,
        taxi,
        reduced, settled,
      };
      result.pass = !d.fullyMasked && d.mismatch <= MOTION_THRESHOLDS.settledMismatchMax && d.heightDelta === 0
        && cls <= MOTION_THRESHOLDS.clsMax && pageErrors.length === 0 && imageErrors.length === 0 && unsettled.length === 0
        && (!taxi.checked || (taxi.before === taxi.after && taxi.unsettled.length === 0));
      fs.writeFileSync(path.join(outDir, 'motion-check.json'), `${JSON.stringify(result, null, 2)}\n`);
      return result;
    } finally { await context.close(); }
  } finally { if (own) await b.close(); }
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
