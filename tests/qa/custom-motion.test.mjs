// The bespoke-motion example in custom-motion.md is extracted verbatim and proven against the contract,
// in the existing fake-Taxi motion fixture: it reaches done, matches the reduced frame, owns one trigger per
// element across Taxi round trips, runs its page-leave teardown without errors, and completes at once under reduced motion.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { qtest, tmpDir, serveFixtures, QA_DIR } from './helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOC = fs.readFileSync(path.join(HERE, '../../skills/protoblocks-motion/references/custom-motion.md'), 'utf8');
const EXAMPLE = DOC.match(/<!-- test:fixture draw-line -->\n```js\n([\s\S]*?)\n```/)?.[1];

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>custom motion</title>
<style>
  body { margin: 0; font-family: Arial, sans-serif; }
  section { min-height: 600px; padding: 40px; }
  .spacer { height: 1400px; }
  .draw-line[data-proto-animate="manual"] { opacity: 0; }
  .draw-line svg { width: 400px; height: 20px; display: block; color: #111; }
</style></head><body>
  <div data-taxi><div data-taxi-view>
  <section id="pb-s1">
    <h1>Bespoke</h1>
    <div id="line" class="draw-line" data-draw-line data-proto-animate="manual"><svg viewBox="0 0 400 20"><path d="M0 10 H400" stroke="currentColor" fill="none" stroke-width="2"/></svg></div>
  </section>
  <div class="spacer"></div>
  </div></div>
  <script src="/vendor/gsap.min.js"></script>
  <script src="/vendor/ScrollTrigger.min.js"></script>
  <script>gsap.registerPlugin(ScrollTrigger);</script>
  <script src="/custom/view.js"></script>
  <script>
    // Fake Taxi in the theme's event order. Like the real one it re-executes the block's classic view.js after the
    // swap (before page-ready), and kills the leaving container's ScrollTriggers without reverting.
    (function () {
      var view = document.querySelector('[data-taxi-view]');
      var original = view.innerHTML;
      function fire(name, detail) { document.dispatchEvent(new CustomEvent(name, { detail: detail })); }
      window.__leaves = 0;
      document.addEventListener('proto:page-leave', function () { window.__leaves += 1; });
      window.protoTaxi = { core: { navigateTo: function (u) {
        var target = new URL(u, location.href);
        var away = target.searchParams.get('pb-motion-away') === '1';
        fire('proto:page-leave', { container: view });
        window.ScrollTrigger.getAll().forEach(function (t) { if (view.contains(t.trigger)) t.kill(false); });
        view.innerHTML = away ? '<p>away</p>' : original;
        var s = document.createElement('script'); s.src = '/custom/view.js?rerun=' + Date.now(); document.body.appendChild(s);
        window.ScrollTrigger.refresh();
        return new Promise(function (resolve) {
          setTimeout(function () { fire('proto:page-ready', { container: view, url: target.href }); resolve(); }, 80);
        });
      } } };
    })();
  </script>
</body></html>`;

async function withServer(fn) {
  assert.ok(EXAMPLE && EXAMPLE.includes('proto:page-ready'), 'example block not found in custom-motion.md');
  const srv = await serveFixtures({
    '/custom/view.js': { body: EXAMPLE, type: 'text/javascript' },
    '/custom.html': { body: PAGE, type: 'text/html' },
  });
  const { launchBrowser } = await import(path.join(QA_DIR, 'browser.mjs'));
  const browser = await launchBrowser();
  try { await fn(srv.url, browser); } finally { await browser.close().catch(() => {}); await srv.close().catch(() => {}); }
}

qtest('the documented bespoke example passes motionCheck, including the Taxi round trips', () => withServer(async (url, browser) => {
  const { motionCheck } = await import(path.join(QA_DIR, 'motion-check.mjs'));
  const r = await motionCheck({ url: `${url}/custom.html`, anchor: 'pb-s1', width: 1280, outDir: tmpDir(), browser });
  assert.equal(r.taxi.checked, true);
  assert.ok(r.settledMismatch <= 0.02, `settledMismatch ${r.settledMismatch}`);
  assert.deepEqual(r.pageErrors, []);
  assert.equal(r.taxi.before, r.taxi.after, JSON.stringify(r.taxi));
  assert.equal(r.pass, true, JSON.stringify(r, null, 2));
}));

qtest('the bespoke example reaches done with no residue and re-initialises after Taxi round trips (leave handler runs without errors)', () => withServer(async (url, browser) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${url}/custom.html`, { waitUntil: 'load' });
  const line = () => page.evaluate(() => { const e = document.getElementById('line'); const p = e.querySelector('path'); return { s: e.getAttribute('data-proto-animate'), style: e.getAttribute('style') || '', pathStyle: p.getAttribute('style') || '', triggers: window.ScrollTrigger.getAll().filter((t) => t.trigger === e).length }; });
  await page.waitForFunction(() => document.getElementById('line').getAttribute('data-proto-animate') === 'done', null, { timeout: 6000 });
  let st = await line();
  assert.equal(st.s, 'done');
  assert.ok(!/dash|opacity/.test(st.style + st.pathStyle), `no inline residue: ${JSON.stringify(st)}`);
  // Round trips: page-leave runs the example's teardown on the live element, the re-executed view.js must not double-init.
  await page.evaluate(() => window.scrollTo(0, 0));
  for (let i = 0; i < 2; i++) {
    await page.evaluate(async () => { await window.protoTaxi.core.navigateTo(location.href + '?pb-motion-away=1'); });
    assert.equal(await page.evaluate(() => document.getElementById('line')), null);
    await page.evaluate(async () => { await window.protoTaxi.core.navigateTo(location.pathname); });
    // The re-executed view.js added no second set of listeners, so exactly one init ran for the new element.
    await page.waitForFunction(() => document.getElementById('line').getAttribute('data-proto-animate') === 'done', null, { timeout: 6000 });
    st = await line();
    assert.equal(st.s, 'done');
    assert.ok(!/dash|opacity/.test(st.style + st.pathStyle), `no inline residue after taxi: ${JSON.stringify(st)}`);
  }
  assert.ok((await page.evaluate(() => window.__leaves)) >= 4);
  assert.deepEqual(errors, []);
  await ctx.close();
}));

qtest('the bespoke example is done immediately under reduced motion, with no tween', () => withServer(async (url, browser) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(`${url}/custom.html`, { waitUntil: 'load' });
  const st = await page.evaluate(() => { const e = document.getElementById('line'); return { s: e.getAttribute('data-proto-animate'), style: e.getAttribute('style') || '', path: document.querySelector('#line path').getAttribute('style') || '', o: getComputedStyle(e).opacity, triggers: window.ScrollTrigger.getAll().length }; });
  assert.deepEqual(st, { s: 'done', style: '', path: '', o: '1', triggers: 0 });
  await ctx.close();
}));
