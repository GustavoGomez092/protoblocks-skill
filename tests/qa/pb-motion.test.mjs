import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { qtest, serveFixtures, QA_DIR, tmpDir } from './helpers.mjs';

const PHP_FILE = fileURLToPath(new URL('../../skills/protoblocks-site-builder/scripts/theme-assets/inc/pb-motion.php', import.meta.url));
const havePhp = spawnSync('php', ['-v']).status === 0;

// Imported lazily so the file still loads (and qtest skips) when the QA deps are not installed.
const launchBrowser = async () => (await import(path.join(QA_DIR, 'browser.mjs'))).launchBrowser();

async function open(browser, url, { reducedMotion = false, block = [] } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  for (const pattern of block) await page.route(pattern, (r) => r.abort());
  await page.goto(url, { waitUntil: 'load' });
  return { ctx, page, errors };
}

const state = (page, sel) => page.$eval(sel, (el) => ({ s: el.getAttribute('data-proto-animate'), o: getComputedStyle(el).opacity, t: getComputedStyle(el).transform, text: el.textContent, label: el.getAttribute('aria-label') }));

// Condition-based wait: every reveal element reports done (returns false on timeout so asserts give the detail).
async function allDone(page, timeout = 6000) {
  try {
    await page.waitForFunction(() => [...document.querySelectorAll('[data-pb-motion][data-proto-animate]')].every((e) => e.getAttribute('data-proto-animate') === 'done'), null, { timeout });
  } catch { return false; }
  await page.waitForTimeout(100); // settle: let the final frame (clearProps / counter text) flush
  return true;
}

async function scrollThrough(page) {
  await page.evaluate(async () => {
    for (let y = 0; y <= document.documentElement.scrollHeight; y += 300) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)); }
  });
  await allDone(page);
}

async function withPage(fixture, opts, fn) {
  const srv = await serveFixtures();
  const browser = await launchBrowser();
  try {
    const { ctx, page, errors } = await open(browser, `${srv.url}/${fixture}`, opts);
    await fn(page, errors);
    await ctx.close();
  } finally { await browser.close(); await srv.close(); }
}

qtest('reveal presets end visible and done; counters keep formatting', () => withPage('motion.html', {}, async (page, errors) => {
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
}));

qtest('reduced motion: everything done immediately, no tweens', () => withPage('motion.html', { reducedMotion: true }, async (page) => {
  assert.ok(await allDone(page, 2000), 'all reveal elements done');
  for (const sel of ['#t1', '#c2', '#clip']) assert.equal((await state(page, sel)).s, 'done', sel);
  assert.equal((await state(page, '#c2')).text, '$4.9M');
  // Why the filter: ScrollTrigger 3.15 self-registers on load and always leaves its own delayedCalls on the
  // global timeline (a paused resize debounce + a 0.5s startup flag), even with pb-motion.js blocked.
  // A delayedCall's target is its callback function, so they are excluded. Caveat: this would also hide a
  // future gsap.delayedCall() added by the runtime; the triggers === 0 check below still catches scroll work.
  const live = await page.evaluate(() => ({
    tweens: window.gsap.globalTimeline.getChildren(true, true, false).filter((t) => typeof t.targets()[0] !== 'function').length,
    triggers: window.ScrollTrigger.getAll().length,
  }));
  assert.deepEqual(live, { tweens: 0, triggers: 0 });
}));

qtest('GSAP missing: content revealed, no errors', () => withPage('motion.html', { block: ['**/vendor/*'] }, async (page, errors) => {
  assert.ok(await allDone(page, 2000), 'all reveal elements done');
  assert.equal((await state(page, '#t1')).s, 'done');
  assert.equal((await state(page, '#t1')).o, '1');
  assert.deepEqual(errors, []);
}));

qtest('init is idempotent and teardown/re-init does not duplicate ScrollTriggers', () => withPage('motion.html', {}, async (page) => {
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
}));

qtest('above the fold: in-view elements reveal at scroll 0 without any scrolling', () => withPage('motion.html', {}, async (page) => {
  const ok = await page.waitForFunction(() => ['t1', 't2', 'row'].every((id) => document.getElementById(id).getAttribute('data-proto-animate') === 'done'), null, { timeout: 4000 }).then(() => true, () => false);
  await page.waitForTimeout(100);
  const st = await state(page, '#t1');
  assert.ok(ok, `hero revealed without scrolling: ${JSON.stringify(st)}`);
  assert.equal(st.o, '1');
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  assert.equal((await state(page, '#c1')).s, 'manual', 'below-the-fold content still waits for scroll');
}));

qtest('page bottom: elements below the 85% line still reveal at max scroll', () => withPage('motion-bottom.html', {}, async (page, errors) => {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await allDone(page);
  for (const sel of ['#cta', '#cn']) {
    const st = await state(page, sel);
    assert.equal(st.s, 'done', `${sel} done`);
    assert.equal(st.o, '1', `${sel} opacity`);
  }
  assert.equal((await state(page, '#cn')).text, '250+');
  assert.deepEqual(errors, []);
}));

qtest('backstop: done set externally on an unrevealed element makes it visible', () => withPage('motion-bottom.html', {}, async (page) => {
  await page.waitForTimeout(150);
  assert.equal((await state(page, '#cta')).s, 'manual', 'precondition: CTA not revealed at scroll 0');
  await page.evaluate(() => { for (const id of ['cta', 'cn']) document.getElementById(id).setAttribute('data-proto-animate', 'done'); });
  const ok = await page.waitForFunction(() => getComputedStyle(document.getElementById('cta')).opacity === '1' && document.getElementById('cn').textContent === '250+', null, { timeout: 2000 }).then(() => true, () => false);
  const cta = await state(page, '#cta');
  const cn = await state(page, '#cn');
  assert.ok(ok, `backstop revealed: cta ${JSON.stringify(cta)} cn ${JSON.stringify(cn)}`);
  assert.equal(cta.t, 'none', 'transform cleared');
  assert.equal(cn.label, null, 'counter aria-label removed once done');
  assert.equal(await page.evaluate(() => window.ScrollTrigger.getAll().length), 0, 'triggers killed');
}));

qtest('counter: original text survives teardown/re-init and is exposed via aria-label while unrevealed', () => withPage('motion-extra.html', {}, async (page) => {
  let cb = await state(page, '#cb');
  assert.equal(cb.text, '0', 'counter starts from 0 before reveal');
  assert.equal(cb.label, '500', 'unrevealed counter labelled with its real value');
  await page.evaluate(() => { window.pbMotion.teardown(document.body); window.pbMotion.init(document.body); });
  assert.equal((await state(page, '#cb')).label, '500', 'label after re-init');
  await page.evaluate(() => document.getElementById('cb').scrollIntoView({ block: 'center' }));
  assert.ok(await allDone(page), 'counter revealed');
  cb = await state(page, '#cb');
  assert.equal(cb.text, '500');
  assert.equal(cb.label, null, 'aria-label removed once done');
}));

qtest('teardown restores the counter text', () => withPage('motion-extra.html', {}, async (page) => {
  assert.equal(await page.evaluate(() => { window.pbMotion.teardown(document.body); return document.getElementById('cb').textContent; }), '500');
  assert.equal((await state(page, '#cb')).label, null);
}));

qtest('marquee: clone copy is hidden from AT, inert, and has no duplicate ids', () => withPage('motion-extra.html', {}, async (page) => {
  const dom = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    const track = document.getElementById('track');
    const hidden = [...track.childNodes].filter((n) => n.nodeType === 1 && n.getAttribute('aria-hidden') === 'true');
    return { dupIds: ids.filter((id, i) => ids.indexOf(id) !== i), hidden: hidden.length, inert: hidden.every((n) => n.inert), text: track.textContent };
  });
  assert.deepEqual(dom.dupIds, []);
  assert.ok(dom.hidden > 0 && dom.inert, `clone marked aria-hidden + inert (${JSON.stringify(dom)})`);
  assert.equal(dom.text.split('Alpha').length - 1, 2, 'content visually duplicated for the loop');
  assert.equal(await page.getByRole('link', { name: 'Alpha' }).count(), 1, 'one accessible link');
  const aria = await page.locator('#mq').ariaSnapshot();
  for (const word of ['Alpha', 'Beta', 'loose text']) assert.equal(aria.split(word).length - 1, 1, `${word} once in a11y tree:\n${aria}`);
}));

qtest('preset error path: element left visible and done', () => withPage('motion-error.html', {}, async (page, errors) => {
  assert.ok(await allDone(page, 2000));
  const st = await state(page, '#e1');
  assert.equal(st.s, 'done');
  assert.equal(st.o, '1', 'opacity');
  assert.equal(st.t, 'none', 'transform');
  assert.deepEqual(errors, []);
}));

qtest('preset error path: stagger-children leaves every child visible', () => withPage('motion-error.html', {}, async (page) => {
  assert.ok(await allDone(page, 2000));
  const kids = await page.$$eval('#e2 > .kid', (els) => els.map((e) => ({ o: getComputedStyle(e).opacity, t: getComputedStyle(e).transform, style: e.getAttribute('style') })));
  assert.equal(kids.length, 3);
  for (const k of kids) assert.deepEqual({ o: k.o, t: k.t }, { o: '1', t: 'none' }, JSON.stringify(kids));
  assert.equal((await state(page, '#e2')).o, '1');
}));

qtest('preset error path: split-lines restores the original heading markup', () => withPage('motion-error.html', {}, async (page) => {
  assert.ok(await allDone(page, 2000));
  const h = await page.$eval('#e3', (e) => ({ html: e.innerHTML, o: getComputedStyle(e).opacity, wrappers: e.querySelectorAll('div, [aria-hidden]').length, label: e.getAttribute('aria-label') }));
  assert.equal(h.html, 'Split <em>heading</em> that fails');
  assert.equal(h.wrappers, 0, 'no split wrappers left');
  assert.equal(h.label, null, 'SplitText aria-label removed');
  assert.equal(h.o, '1');
}));

qtest('preset error path: counter shows its original text and no aria-label', () => withPage('motion-error.html', {}, async (page) => {
  assert.ok(await allDone(page, 2000));
  const c = await state(page, '#e4');
  assert.equal(c.text, '1,250+');
  assert.equal(c.label, null);
  assert.equal(c.o, '1');
  assert.equal(await page.evaluate(() => window.gsap.getTweensOf(document.getElementById('e4')).length + window.gsap.globalTimeline.getChildren(true, true, false).filter((t) => t.vars && t.vars.onUpdate).length), 0, 'counter tween killed');
}));

(havePhp ? qtest : (n, f) => qtest(`${n} (skipped: php not on PATH)`, () => {}))('pb-motion.php: no-JS fallback shows content; profile is escaped', async () => {
  const dir = tmpDir('pb-motion-php-');
  fs.mkdirSync(path.join(dir, 'inc'));
  fs.writeFileSync(path.join(dir, 'inc', 'pb-motion-profile.json'), JSON.stringify({ duration: '1.2', ease: "</script><script>alert(1)</script>&'\"", stagger: 0.1, distance: 40, evil: 'x' }));
  const harness = path.join(dir, 'harness.php');
  fs.writeFileSync(harness, `<?php
define('ABSPATH', '/');
$hooks = [];
function add_action($h, $cb, $p = 10) { global $hooks; $hooks[] = [$h, $cb, $p]; }
function is_admin() { return false; }
function get_stylesheet_directory() { return ${JSON.stringify(dir)}; }
function wp_json_encode($d, $f = 0) { return json_encode($d, $f); }
require ${JSON.stringify(PHP_FILE)};
foreach ($hooks as [$h, $cb, $p]) { if ($h === 'wp_head' && $p === 2) $cb(); }
`);
  const r = spawnSync('php', [harness], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const head = r.stdout;
  assert.ok(!head.includes('</script><script>alert'), 'ease escaped');
  assert.match(head, /"duration":1\.2,/);
  assert.ok(!head.includes('evil'));
  const html = `<!doctype html><html><head>${head}</head><body><h1 id="n" data-pb-motion="fade-up" data-proto-animate="manual">Hi</h1></body></html>`;
  const browser = await launchBrowser();
  try {
    const opacity = async (javaScriptEnabled) => {
      const ctx = await browser.newContext({ javaScriptEnabled });
      const page = await ctx.newPage();
      await page.route('http://pb.test/', (route) => route.fulfill({ contentType: 'text/html', body: html }));
      await page.goto('http://pb.test/');
      const o = await page.$eval('#n', (el) => getComputedStyle(el).opacity);
      await ctx.close();
      return o;
    };
    assert.equal(await opacity(false), '1', 'no-JS: content visible');
    assert.equal(await opacity(true), '0', 'JS on: anti-flash CSS still hides until the runtime reveals');
  } finally { await browser.close(); }
});
