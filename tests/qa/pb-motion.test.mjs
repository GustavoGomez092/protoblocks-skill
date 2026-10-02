import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { qtest, serveFixtures, QA_DIR } from './helpers.mjs';

// scripts/qa/browser.mjs does not exist yet; launch Chromium straight from the QA package.
async function launchBrowser() {
  const { chromium } = createRequire(path.join(QA_DIR, 'package.json'))('playwright');
  return chromium.launch();
}

async function open(browser, url, { reducedMotion = false, block = [] } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  for (const pattern of block) await page.route(pattern, (r) => r.abort());
  await page.goto(url, { waitUntil: 'load' });
  return { ctx, page, errors };
}

const state = (page, sel) => page.$eval(sel, (el) => ({ s: el.getAttribute('data-proto-animate'), o: getComputedStyle(el).opacity, t: getComputedStyle(el).transform, text: el.textContent }));

async function scrollThrough(page) {
  await page.evaluate(async () => {
    for (let y = 0; y <= document.documentElement.scrollHeight; y += 300) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)); }
  });
  await page.waitForTimeout(1200);
}

qtest('reveal presets end visible and done; counters keep formatting', async () => {
  const srv = await serveFixtures();
  const browser = await launchBrowser();
  try {
    const { ctx, page, errors } = await open(browser, `${srv.url}/motion.html`);
    await scrollThrough(page);
    for (const sel of ['#t1', '#t2', '#row', '#c1', '#clip']) {
      const st = await state(page, sel);
      assert.equal(st.s, 'done', `${sel} done`);
      assert.equal(st.o, '1', `${sel} opacity`);
    }
    assert.equal((await state(page, '#t1')).t, 'none');
    assert.equal((await state(page, '#c1')).text, '1,250+');
    assert.equal((await state(page, '#c2')).text, '$4.9M');
    assert.equal((await state(page, '#c3')).text, '98%');
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await browser.close(); await srv.close(); }
});

qtest('reduced motion: everything done immediately, no tweens', async () => {
  const srv = await serveFixtures();
  const browser = await launchBrowser();
  try {
    const { ctx, page } = await open(browser, `${srv.url}/motion.html`, { reducedMotion: true });
    await page.waitForTimeout(100);
    for (const sel of ['#t1', '#c2', '#clip']) assert.equal((await state(page, sel)).s, 'done', sel);
    assert.equal((await state(page, '#c2')).text, '$4.9M');
    // ScrollTrigger 3.15 self-registers on load and always leaves its own delayedCalls (a paused
    // resize debounce + a 0.5s startup flag) on the global timeline, even with pb-motion.js blocked.
    // Those target a function; any real tween targets an element or a state object.
    const live = await page.evaluate(() => ({
      tweens: window.gsap.globalTimeline.getChildren(true, true, false).filter((t) => typeof t.targets()[0] !== 'function').length,
      triggers: window.ScrollTrigger.getAll().length,
    }));
    assert.deepEqual(live, { tweens: 0, triggers: 0 });
    await ctx.close();
  } finally { await browser.close(); await srv.close(); }
});

qtest('GSAP missing: content revealed, no errors', async () => {
  const srv = await serveFixtures();
  const browser = await launchBrowser();
  try {
    const { ctx, page, errors } = await open(browser, `${srv.url}/motion.html`, { block: ['**/vendor/*'] });
    await page.waitForTimeout(100);
    assert.equal((await state(page, '#t1')).s, 'done');
    assert.equal((await state(page, '#t1')).o, '1');
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await browser.close(); await srv.close(); }
});

qtest('init is idempotent and teardown/re-init does not duplicate ScrollTriggers', async () => {
  const srv = await serveFixtures();
  const browser = await launchBrowser();
  try {
    const { ctx, page } = await open(browser, `${srv.url}/motion.html`);
    const counts = await page.evaluate(() => {
      const before = window.ScrollTrigger.getAll().length;
      document.dispatchEvent(new CustomEvent('proto:page-ready', { detail: { container: document.body } }));
      window.pbMotion.init(document.body);
      const afterDup = window.ScrollTrigger.getAll().length;
      document.dispatchEvent(new CustomEvent('proto:page-leave', { detail: { container: document.body } }));
      const afterLeave = window.ScrollTrigger.getAll().length;
      document.dispatchEvent(new CustomEvent('proto:page-ready', { detail: { container: document.body } }));
      return { before, afterDup, afterLeave, afterReady: window.ScrollTrigger.getAll().length };
    });
    assert.ok(counts.before > 0);
    assert.equal(counts.afterDup, counts.before);
    assert.equal(counts.afterLeave, 0);
    assert.equal(counts.afterReady, counts.before);
    await ctx.close();
  } finally { await browser.close(); await srv.close(); }
});
