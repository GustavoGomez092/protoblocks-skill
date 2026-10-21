// pb-motion.js waits for the theme's intro overlay before arming reveals: the queue logic, evaluated on its own
// (the runtime is an IIFE for the browser; tests/qa/pb-motion.test.mjs runs the whole file).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUNTIME = fs.readFileSync(path.join(ROOT, 'skills/protoblocks-site-builder/scripts/theme-assets/assets/js/pb-motion.js'), 'utf8');

// The intro block sits right before startReveal; startReveal's first line is the guard.
const start = RUNTIME.indexOf('  var introQueue = null;');
const end = RUNTIME.indexOf('  function startReveal(el, name) {');
assert.ok(start > 0 && end > start, 'pb-motion.js has the intro block before startReveal');
const BLOCK = RUNTIME.slice(start, end);

// A tiny document: html classes, an optional .proto-intro overlay, event listeners.
function fakeDom({ htmlClasses = [], overlay = null, now = 100 } = {}) {
  const listeners = {};
  const classList = (arr) => ({ contains: (c) => arr.includes(c), add: (c) => { if (!arr.includes(c)) arr.push(c); }, remove: (c) => { const i = arr.indexOf(c); if (i >= 0) arr.splice(i, 1); } });
  const overlayEl = overlay ? { classList: classList(overlay) } : null;
  const timers = [];
  const document = {
    documentElement: { classList: classList(htmlClasses) },
    querySelector: (sel) => (sel === '.proto-intro' ? overlayEl : null),
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
    dispatch: (type) => { const fns = listeners[type] ?? []; listeners[type] = []; fns.forEach((fn) => fn()); },
  };
  const window = { setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, performance: { now: () => now } };
  return { document, window, timers, listeners };
}

function load(dom) {
  const ctx = vm.createContext({ document: dom.document, window: dom.window, performance: dom.window.performance });
  vm.runInContext(`${BLOCK}\n;this.introActive = introActive; this.afterIntro = afterIntro; this.releaseIntro = releaseIntro; this.queued = function () { return introQueue ? introQueue.length : null; };`, ctx);
  return ctx;
}

test('startReveal is guarded by the intro queue (source check)', () => {
  const guard = RUNTIME.slice(end, end + 400);
  assert.match(guard, /if \(introQueue \|\| introActive\(\)\) \{ afterIntro\(function \(\) \{ if \(el\.getAttribute\('data-proto-animate'\) !== 'done'\) startReveal\(el, name\); \}\); return; \}/);
  assert.match(BLOCK, /document\.addEventListener\('proto:intro-complete', releaseIntro, \{ once: true \}\)/);
  assert.match(BLOCK, /window\.setTimeout\(releaseIntro, 10000\)/);
});

test('introActive: only while the overlay is up and the theme marks the intro active (or the page is younger than 3 s); skip class wins', () => {
  assert.equal(load(fakeDom()).introActive(), false, 'no overlay');
  assert.equal(load(fakeDom({ overlay: [], htmlClasses: ['proto-intro-active'] })).introActive(), true);
  assert.equal(load(fakeDom({ overlay: ['is-hidden'], htmlClasses: ['proto-intro-active'] })).introActive(), false, 'hidden overlay');
  assert.equal(load(fakeDom({ overlay: [], htmlClasses: ['proto-intro-active', 'proto-intro-skip'] })).introActive(), false, 'skip (later page of the session)');
  assert.equal(load(fakeDom({ overlay: [], now: 2999 })).introActive(), true, 'overlay present on a young page, before the theme adds the class');
  assert.equal(load(fakeDom({ overlay: [], now: 3000 })).introActive(), false, 'overlay present but the theme never marked it active');
  const noPerf = fakeDom({ overlay: [] });
  delete noPerf.window.performance;
  assert.equal(load(noPerf).introActive(), true);
});

test('afterIntro runs at once without an intro; with one it queues every reveal and releases them once on proto:intro-complete', () => {
  const calls = [];
  const none = load(fakeDom());
  none.afterIntro(() => calls.push('a'));
  assert.deepEqual(calls, ['a']);
  assert.equal(none.queued(), null);

  const dom = fakeDom({ overlay: [], htmlClasses: ['proto-intro-active'] });
  const ctx = load(dom);
  ctx.afterIntro(() => calls.push('hero'));
  ctx.afterIntro(() => { throw new Error('boom'); });
  ctx.afterIntro(() => calls.push('second'));
  assert.deepEqual(calls, ['a'], 'nothing ran yet');
  assert.equal(ctx.queued(), 3);
  assert.equal(dom.listeners['proto:intro-complete'].length, 1, 'one listener for the whole queue');
  assert.deepEqual(dom.timers.map((t) => t.ms), [10000], 'one backstop for the whole queue');
  dom.document.dispatch('proto:intro-complete');
  assert.deepEqual(calls, ['a', 'hero', 'second'], 'released in order; a throwing reveal does not block the others');
  assert.equal(ctx.queued(), null);
  // After the release, reveals run at once again (the overlay is gone) and the backstop is a no-op.
  dom.document.querySelector = () => null;
  ctx.afterIntro(() => calls.push('later'));
  assert.deepEqual(calls, ['a', 'hero', 'second', 'later']);
  dom.timers[0].fn();
  assert.deepEqual(calls, ['a', 'hero', 'second', 'later']);
});

test('the 10 s backstop releases the queue when the theme never dispatches the event; the event afterwards is a no-op', () => {
  const calls = [];
  const dom = fakeDom({ overlay: [], htmlClasses: ['proto-intro-active'] });
  const ctx = load(dom);
  ctx.afterIntro(() => calls.push('hero'));
  dom.timers[0].fn();
  assert.deepEqual(calls, ['hero']);
  assert.equal(ctx.queued(), null);
  dom.document.dispatch('proto:intro-complete');
  assert.deepEqual(calls, ['hero']);
});
