# Stage 5 — Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Animate verified sections consistently: a declarative GSAP preset runtime (`pb-motion.js`) installed into the theme, a per-site motion profile, a motion QA check (settles to the designed state, no layout shift, no errors, clean Taxi re-init), state recording that closes a section (`animating → done`), and the `protoblocks-motion` skill.

**Architecture:** `scripts/theme-assets/assets/js/pb-motion.js` (frontend runtime, plain ES5-style IIFE using the theme's `window.gsap`, `ScrollTrigger`, `SplitText`) + `scripts/theme-assets/inc/pb-motion.php` (prints the anti-flash CSS and the profile in `<head>`). Both are installed by Stage 2's `installThemeAssets`. Node side: `scripts/lib/motion.mjs` (profiles + recording) and `scripts/qa/motion-check.mjs` (Playwright). Browser tests use a fixture page served locally with GSAP from the root dev dependency `gsap`.

**Tech Stack:** GSAP 3.15 (theme-vendored on sites; `gsap@^3.15.0` root devDependency for tests), Playwright (Stage 3 QA package).

**Spec:** `docs/superpowers/specs/2026-10-01-site-builder-design.md` (§6.3 Animate, §6.4 Section done)

**Builds on:** Stage 2 (`installThemeAssets`, managed `inc/pb-*.php` loader, `pb-assets.php` enqueues `assets/js/pb-*.js` with handle = basename and deps on `proto-gsap`, `proto-scroll-trigger`, `proto-split-text`, `proto-init` when registered); Stage 3 (`launchBrowser`, `openPage`, `shoot`, `diffImages`, `tests/qa/helpers.mjs` incl. `serveFixtures`, `qtest`); Stage 4 (section `status: 'animating'` after a QA pass; `artifactsDir`; `prepareCheck` naming conventions).

Theme facts (verified in `proto-blocks-theme` source): Taxi dispatches `proto:page-ready` (`detail.container`, `detail.url`) on initial load and after every navigation, and `proto:page-leave` (`detail.container`) before leaving; the theme already kills ScrollTriggers inside the leaving container. The shared Lenis instance is `window.protoLenis`. Plugin reveal runtime: `data-proto-animate="pending|manual|done"`; `manual` elements get force-revealed 1500 ms after entering view if nothing sets `done`; under reduced motion everything is set `done` immediately; it dispatches `proto-blocks:reveal` on reveal.

## Global Constraints

- Preset vocabulary (exact names): reveal presets `fade-up`, `fade-in`, `scale-in`, `clip-reveal`, `stagger-children`, `split-lines`, `split-chars`, `counter`; continuous presets `parallax`, `marquee`.
- Options (data attributes): `data-pb-delay` (seconds), `data-pb-stagger` (seconds), `data-pb-start` (ScrollTrigger start, default `top 85%`), `data-pb-distance` (px, default from profile), `data-pb-speed` (parallax/marquee factor, default 1).
- Reveal-preset elements are rendered (frontend only, never in the editor preview) with `data-pb-motion="<preset>" data-proto-animate="manual"`. The head CSS hides `[data-pb-motion][data-proto-animate="manual"]` (`opacity:0`) so there's no flash; the runtime sets `data-proto-animate="done"` when the tween completes. If GSAP is missing, the runtime sets every element `done` immediately.
- Continuous presets never use `data-proto-animate` and are never hidden.
- Reduced motion: no tweens; every reveal element `done` at once; counters show their final value; marquee static; parallax off.
- Profiles: `subtle` `{duration:0.7, ease:'power2.out', stagger:0.08, distance:24}`, `expressive` `{duration:0.9, ease:'power3.out', stagger:0.1, distance:40}`, `bold` `{duration:1.1, ease:'expo.out', stagger:0.12, distance:64}`. Default `subtle`. Stored in the theme at `inc/pb-motion-profile.json` (theme-portable) and in state `site.motionProfile`.
- Init is idempotent (each element initialised once, tracked by a `WeakSet`): runs on `DOMContentLoaded`/immediately for the whole document AND on every `proto:page-ready` for `detail.container`. Teardown on `proto:page-leave` kills tweens and SplitText instances created inside `detail.container`.
- Motion check pass rule: settled frame vs reduced-motion frame mismatch ≤ 0.02; CLS ≤ 0.01; no `pageerror`; when Taxi is present, ScrollTrigger count after a navigate-away-and-back round trip equals the count before (no duplicates). Settled = every `[data-pb-motion][data-proto-animate]` in the section is `done` (timeout 6 s), then 500 ms.
- A section is `done` only after a passing motion check recorded in state, or an explicit developer acceptance (`--accepted`), which is recorded in `section.notes`.

## Review Focus

1. **GSAP missing or failing to load** — content must never stay hidden: runtime marks all reveal elements `done`; browser test in Task 1.
2. **Element initialised twice** (initial load + Taxi `page-ready` for the same nodes) — single tween per element, no duplicate ScrollTriggers; browser test in Task 1.
3. **Reduced-motion users** — final state instantly, counters show final value, no tweens; browser test in Task 1.
4. **Animation that ends in a different state than the design** (e.g. leftover transform/opacity) — motion check compares the settled frame to the reduced-motion frame; QA test in Task 3 with a deliberately broken preset fixture.
5. **Counter text with formatting** (`1,250+`, `$4.9M`, `98%`) — prefix/suffix/separators/decimals preserved at every frame and at the end; browser test in Task 1.

---

## File Structure

```
skills/protoblocks-site-builder/scripts/
├── theme-assets/
│   ├── assets/js/pb-motion.js     runtime (installed into theme)
│   └── inc/pb-motion.php          head CSS + profile bootstrap (installed into theme)
├── lib/motion.mjs                 PROFILES, setProfile, recordMotion — CLI
└── qa/motion-check.mjs            motionCheck — CLI
skills/protoblocks-motion/{SKILL.md, references/presets.md, references/custom-motion.md}
skills/protoblocks-section-loop/SKILL.md      (Animate section filled in)
tests/qa/fixtures/motion.html, motion-broken.html
tests/qa/{pb-motion,motion-check}.test.mjs
tests/unit/motion.test.mjs
package.json                                  (devDependency gsap)
```

---

### Task 1: `pb-motion.js` runtime + head bootstrap

**Files:**
- Create: `skills/protoblocks-site-builder/scripts/theme-assets/assets/js/pb-motion.js`
- Create: `skills/protoblocks-site-builder/scripts/theme-assets/inc/pb-motion.php`
- Create: `tests/qa/fixtures/motion.html`
- Create: `tests/qa/pb-motion.test.mjs`
- Modify: root `package.json` (`"devDependencies": { "gsap": "^3.15.0" }`; run `npm install` at the repo root)
- Modify: `tests/qa/helpers.mjs` — `serveFixtures()` also serves `/vendor/<file>` from `node_modules/gsap/dist/<file>` and `/runtime/pb-motion.js` from the theme-assets file.

**Interfaces:**
- Produces (browser globals):
  - `window.pbMotion = { init(root?: Element), teardown(root: Element), PRESETS: string[], version: '1' }`
  - Reads `window.pbMotionProfile` (`{duration, ease, stagger, distance}`), falling back to the `subtle` values.
  - `pb-motion.php` (PHP, front end only, `wp_head` priority 2): prints `<style id="pb-motion-css">[data-pb-motion][data-proto-animate="manual"]{opacity:0}</style>` and `<script>window.pbMotionProfile=…;</script>` with the JSON from `get_stylesheet_directory() . '/inc/pb-motion-profile.json'` when readable, else the subtle defaults; prints nothing in admin/editor.

- [ ] **Step 1: Root dev dependency + fixture serving**

Add `"devDependencies": { "gsap": "^3.15.0" }` to the root `package.json`, run `npm install`, and ensure root `node_modules/` is gitignored (add `node_modules/` to `.gitignore` if missing).

Extend `serveFixtures()` in `tests/qa/helpers.mjs`: before the fixtures lookup, map `/vendor/<name>` → `<repo>/node_modules/gsap/dist/<name>` and `/runtime/pb-motion.js` → `<repo>/skills/protoblocks-site-builder/scripts/theme-assets/assets/js/pb-motion.js`; serve `.js` as `text/javascript`.

- [ ] **Step 2: Fixture** `tests/qa/fixtures/motion.html`

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>motion</title>
<style>
  body { margin: 0; font-family: Arial, sans-serif; }
  section { min-height: 600px; padding: 40px; }
  [data-pb-motion][data-proto-animate="manual"] { opacity: 0; }
  .spacer { height: 1400px; }
  .row { display: flex; gap: 16px; }
  .row > div { width: 120px; height: 80px; background: #2563eb; }
</style>
<script>window.pbMotionProfile = { duration: 0.3, ease: 'power2.out', stagger: 0.05, distance: 24 };</script>
</head><body>
  <section id="pb-s1">
    <h1 id="t1" data-pb-motion="fade-up" data-proto-animate="manual">Fade up title</h1>
    <h2 id="t2" data-pb-motion="split-lines" data-proto-animate="manual">Split lines heading that wraps</h2>
    <div id="row" class="row" data-pb-motion="stagger-children" data-proto-animate="manual"><div></div><div></div><div></div></div>
  </section>
  <div class="spacer"></div>
  <section id="pb-s2">
    <p><span id="c1" data-pb-motion="counter" data-proto-animate="manual">1,250+</span>
       <span id="c2" data-pb-motion="counter" data-proto-animate="manual">$4.9M</span>
       <span id="c3" data-pb-motion="counter" data-proto-animate="manual">98%</span></p>
    <div id="clip" data-pb-motion="clip-reveal" data-proto-animate="manual" style="height:100px;background:#111"></div>
  </section>
  <script src="/vendor/gsap.min.js"></script>
  <script src="/vendor/ScrollTrigger.min.js"></script>
  <script src="/vendor/SplitText.min.js"></script>
  <script src="/runtime/pb-motion.js"></script>
</body></html>
```

- [ ] **Step 3: Failing browser tests** `tests/qa/pb-motion.test.mjs`

```js
import assert from 'node:assert/strict';
import path from 'node:path';
import { qtest, serveFixtures, QA_DIR } from './helpers.mjs';

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
  const { launchBrowser } = await import(path.join(QA_DIR, 'browser.mjs'));
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
  const { launchBrowser } = await import(path.join(QA_DIR, 'browser.mjs'));
  const srv = await serveFixtures();
  const browser = await launchBrowser();
  try {
    const { ctx, page } = await open(browser, `${srv.url}/motion.html`, { reducedMotion: true });
    await page.waitForTimeout(100);
    for (const sel of ['#t1', '#c2', '#clip']) assert.equal((await state(page, sel)).s, 'done', sel);
    assert.equal((await state(page, '#c2')).text, '$4.9M');
    assert.equal(await page.evaluate(() => window.gsap.globalTimeline.getChildren(true, true, false).length), 0);
    await ctx.close();
  } finally { await browser.close(); await srv.close(); }
});

qtest('GSAP missing: content revealed, no errors', async () => {
  const { launchBrowser } = await import(path.join(QA_DIR, 'browser.mjs'));
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
  const { launchBrowser } = await import(path.join(QA_DIR, 'browser.mjs'));
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
```

- [ ] **Step 4: Run** `npm run test:qa` → Expected: FAIL (runtime missing).

- [ ] **Step 5: Implement** `scripts/theme-assets/assets/js/pb-motion.js`

```js
/**
 * pb-motion — declarative GSAP presets for Proto-Blocks sites.
 * Managed by protoblocks-site-builder; overwritten on install. Do not edit.
 *
 * Markup: <el data-pb-motion="fade-up" data-proto-animate="manual" data-pb-delay="0.1">
 * Reveal presets: fade-up fade-in scale-in clip-reveal stagger-children split-lines split-chars counter
 * Continuous presets: parallax marquee
 */
(function () {
  'use strict';

  var REVEAL = ['fade-up', 'fade-in', 'scale-in', 'clip-reveal', 'stagger-children', 'split-lines', 'split-chars', 'counter'];
  var CONTINUOUS = ['parallax', 'marquee'];
  var DEFAULTS = { duration: 0.7, ease: 'power2.out', stagger: 0.08, distance: 24 };
  var SEL = '[data-pb-motion]';
  var seen = new WeakSet();
  var owned = []; // { el, kill: fn }

  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var profile = Object.assign({}, DEFAULTS, window.pbMotionProfile || {});

  function gsapReady() { return !!(window.gsap && window.ScrollTrigger); }
  function num(el, name, fallback) { var v = parseFloat(el.getAttribute(name)); return isNaN(v) ? fallback : v; }
  function opts(el) {
    return {
      duration: profile.duration, ease: profile.ease,
      delay: num(el, 'data-pb-delay', 0),
      stagger: num(el, 'data-pb-stagger', profile.stagger),
      distance: num(el, 'data-pb-distance', profile.distance),
      speed: num(el, 'data-pb-speed', 1),
      start: el.getAttribute('data-pb-start') || 'top 85%'
    };
  }
  function done(el) {
    if (el.getAttribute('data-proto-animate') !== 'done') {
      el.setAttribute('data-proto-animate', 'done');
      try { el.dispatchEvent(new CustomEvent('proto-blocks:reveal', { bubbles: true })); } catch (e) {}
    }
  }
  function own(el, kill) { owned.push({ el: el, kill: kill }); }

  function parseCounter(text) {
    var m = String(text).match(/^(\D*?)([\d.,]+)(.*)$/);
    if (!m) return null;
    var raw = m[2];
    var decimals = raw.indexOf('.') >= 0 ? raw.split('.')[1].length : 0;
    var value = parseFloat(raw.replace(/,/g, ''));
    if (isNaN(value)) return null;
    return { prefix: m[1], suffix: m[3], value: value, decimals: decimals, grouped: raw.indexOf(',') >= 0 };
  }
  function formatCounter(c, v) {
    var s = v.toFixed(c.decimals);
    if (c.grouped) { var parts = s.split('.'); parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); s = parts.join('.'); }
    return c.prefix + s + c.suffix;
  }

  function revealTween(el, name, o) {
    var g = window.gsap;
    var base = { duration: o.duration, ease: o.ease, delay: o.delay };
    switch (name) {
      case 'fade-up': return g.fromTo(el, { opacity: 0, y: o.distance }, Object.assign({ opacity: 1, y: 0, clearProps: 'transform' }, base));
      case 'fade-in': return g.fromTo(el, { opacity: 0 }, Object.assign({ opacity: 1 }, base));
      case 'scale-in': return g.fromTo(el, { opacity: 0, scale: 0.94 }, Object.assign({ opacity: 1, scale: 1, clearProps: 'transform' }, base));
      case 'clip-reveal':
        g.set(el, { opacity: 1 });
        return g.fromTo(el, { clipPath: 'inset(0 0 100% 0)' }, Object.assign({ clipPath: 'inset(0 0 0% 0)', clearProps: 'clipPath' }, base));
      case 'stagger-children':
        g.set(el, { opacity: 1 });
        return g.fromTo(el.children, { opacity: 0, y: o.distance }, Object.assign({ opacity: 1, y: 0, stagger: o.stagger, clearProps: 'transform' }, base));
      case 'split-lines':
      case 'split-chars': {
        g.set(el, { opacity: 1 });
        if (!window.SplitText) return g.fromTo(el, { opacity: 0 }, Object.assign({ opacity: 1 }, base));
        var lines = name === 'split-lines';
        var split = new window.SplitText(el, lines ? { type: 'lines', mask: 'lines' } : { type: 'chars' });
        own(el, function () { split.revert(); });
        var targets = lines ? split.lines : split.chars;
        return g.fromTo(targets, lines ? { yPercent: 100 } : { opacity: 0, y: o.distance / 2 },
          Object.assign(lines ? { yPercent: 0 } : { opacity: 1, y: 0 }, { stagger: lines ? o.stagger : o.stagger / 4, onComplete: function () { split.revert(); } }, base));
      }
      case 'counter': {
        var c = parseCounter(el.textContent);
        g.set(el, { opacity: 1 });
        if (!c) return g.fromTo(el, { opacity: 0 }, Object.assign({ opacity: 1 }, base));
        var state = { v: 0 };
        el.textContent = formatCounter(c, 0);
        return g.to(state, Object.assign({ v: c.value, duration: Math.max(1, o.duration * 2), onUpdate: function () { el.textContent = formatCounter(c, state.v); }, onComplete: function () { el.textContent = formatCounter(c, c.value); } }, { ease: o.ease, delay: o.delay }));
      }
    }
    return null;
  }

  function initReveal(el, name) {
    var o = opts(el);
    var tween = revealTween(el, name, o);
    if (!tween) { done(el); return; }
    tween.pause();
    var st = window.ScrollTrigger.create({
      trigger: el, start: o.start, once: true,
      onEnter: function () { tween.eventCallback('onComplete', (function (prev) { return function () { if (prev) prev(); done(el); }; })(tween.eventCallback('onComplete'))); tween.play(); }
    });
    own(el, function () { st.kill(); tween.kill(); });
  }

  function initContinuous(el, name) {
    var g = window.gsap;
    var o = opts(el);
    if (name === 'parallax') {
      var t = g.to(el, { yPercent: -10 * o.speed, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true } });
      own(el, function () { if (t.scrollTrigger) t.scrollTrigger.kill(); t.kill(); g.set(el, { clearProps: 'transform' }); });
    } else if (name === 'marquee') {
      var track = el.firstElementChild;
      if (!track) return;
      if (!track.getAttribute('data-pb-cloned')) { track.innerHTML += track.innerHTML; track.setAttribute('data-pb-cloned', '1'); }
      var m = g.to(track, { xPercent: -50, ease: 'none', duration: 20 / o.speed, repeat: -1 });
      own(el, function () { m.kill(); g.set(track, { clearProps: 'transform' }); });
    }
  }

  function init(root) {
    var scope = root || document;
    var els = scope.querySelectorAll ? scope.querySelectorAll(SEL) : [];
    Array.prototype.forEach.call(els, function (el) {
      if (seen.has(el)) return;
      seen.add(el);
      var name = el.getAttribute('data-pb-motion');
      var isReveal = REVEAL.indexOf(name) >= 0;
      if (reduced || !gsapReady()) { if (isReveal || el.hasAttribute('data-proto-animate')) done(el); return; }
      try {
        if (isReveal) initReveal(el, name);
        else if (CONTINUOUS.indexOf(name) >= 0) initContinuous(el, name);
        else done(el);
      } catch (e) {
        done(el);
        if (window.console) console.warn('[pb-motion] ' + name + ' failed:', e);
      }
    });
  }

  function teardown(root) {
    owned = owned.filter(function (o) {
      if (root && !root.contains(o.el)) return true;
      try { o.kill(); } catch (e) {}
      seen.delete(o.el);
      return false;
    });
    if (root && root.querySelectorAll) Array.prototype.forEach.call(root.querySelectorAll(SEL), function (el) { seen.delete(el); });
  }

  window.pbMotion = { init: init, teardown: teardown, PRESETS: REVEAL.concat(CONTINUOUS), version: '1' };
  if (gsapReady()) window.gsap.registerPlugin(window.ScrollTrigger);

  document.addEventListener('proto:page-ready', function (e) { init((e.detail && e.detail.container) || document); });
  document.addEventListener('proto:page-leave', function (e) { teardown((e.detail && e.detail.container) || document.body); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(document); });
  else init(document);
})();
```

- [ ] **Step 6: Implement** `scripts/theme-assets/inc/pb-motion.php`

```php
<?php
/**
 * Managed by protoblocks-site-builder — overwritten on every install. Do not edit.
 * Prints the pb-motion anti-flash CSS and the site motion profile in <head>.
 */
if (!defined('ABSPATH')) {
    exit;
}

add_action('wp_head', function () {
    if (is_admin()) {
        return;
    }
    $profile = ['duration' => 0.7, 'ease' => 'power2.out', 'stagger' => 0.08, 'distance' => 24];
    $file = get_stylesheet_directory() . '/inc/pb-motion-profile.json';
    if (is_readable($file)) {
        $data = json_decode((string) file_get_contents($file), true);
        if (is_array($data)) {
            $profile = array_merge($profile, array_intersect_key($data, $profile));
        }
    }
    echo '<style id="pb-motion-css">[data-pb-motion][data-proto-animate="manual"]{opacity:0}</style>' . "\n";
    echo '<script id="pb-motion-profile">window.pbMotionProfile=' . wp_json_encode($profile) . ';</script>' . "\n";
}, 2);
```

- [ ] **Step 7: Run** `npm run test:qa` → Expected: PASS. If a test fails because of how `fromTo` + `pause()` interacts with ScrollTrigger in GSAP 3.15, fix the runtime (not the tests) and describe the change in the report.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .gitignore skills/protoblocks-site-builder/scripts/theme-assets tests/qa/fixtures/motion.html tests/qa/pb-motion.test.mjs tests/qa/helpers.mjs
git commit -m "feat(motion): declarative GSAP preset runtime with reveal guarantees"
```

---

### Task 2: Motion profile + recording (`motion.mjs`)

**Files:**
- Create: `skills/protoblocks-site-builder/scripts/lib/motion.mjs`
- Create: `tests/unit/motion.test.mjs`

**Interfaces:**
- Consumes: `loadState`, `updateState` (Stage 1); `installThemeAssets` (Stage 2).
- Produces:
  - `PROFILES = { subtle: {...}, expressive: {...}, bold: {...} }` (exact values from Global Constraints).
  - `setProfile(themeDir, nameOrObject) => profile` — accepts a profile name or a custom object (must contain numeric `duration`, `stagger`, `distance` and a string `ease`; throws `EPROFILE` otherwise); writes `<themeDir>/inc/pb-motion-profile.json` and `state.site.motionProfile = { name, ...values }` when the state exists.
  - `installMotion(themeDir) => { copied, functionsUpdated }` — `installThemeAssets(themeDir)` (copies `pb-motion.js` + `pb-motion.php`) and writes the default profile file if missing.
  - `recordMotion(themeDir, slug, n, { presets, checkFile, accepted = false }) => { status }` — reads the motion-check JSON; requires `check.pass === true` unless `accepted`; throws `EMOTION` otherwise; sets `section.motion = { presets, check: 'pass'|'accepted', result: checkFile }`, `section.status = 'done'`; when `accepted`, appends `"motion accepted by developer"` to `section.notes`.
  - CLI: `node motion.mjs install <themeDir>`; `node motion.mjs profile <themeDir> <subtle|expressive|bold|<json>>`; `node motion.mjs record <themeDir> <slug> <n> <check.json> --presets a,b [--accepted]`.

- [ ] **Step 1: Failing tests** `tests/unit/motion.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROFILES, setProfile, recordMotion } from '../../skills/protoblocks-site-builder/scripts/lib/motion.mjs';
import { initState, updateState, loadState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';

function theme() {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-mo-'));
  fs.mkdirSync(path.join(t, 'inc'));
  initState(t, { url: 'http://a.local', path: '/x' });
  updateState(t, (s) => { s.pages.push({ slug: 'home', status: 'building', sections: [{ n: 1, anchor: 'pb-s1', block: 'hero', status: 'animating' }] }); });
  return t;
}

test('profiles have the documented values', () => {
  assert.deepEqual(PROFILES.subtle, { duration: 0.7, ease: 'power2.out', stagger: 0.08, distance: 24 });
  assert.deepEqual(PROFILES.bold, { duration: 1.1, ease: 'expo.out', stagger: 0.12, distance: 64 });
});

test('setProfile writes the theme file and state; rejects bad custom profiles', () => {
  const t = theme();
  setProfile(t, 'expressive');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(t, 'inc/pb-motion-profile.json'), 'utf8')), PROFILES.expressive);
  assert.equal(loadState(t).site.motionProfile.name, 'expressive');
  setProfile(t, { duration: 0.5, ease: 'sine.out', stagger: 0.05, distance: 12 });
  assert.equal(loadState(t).site.motionProfile.name, 'custom');
  assert.throws(() => setProfile(t, { duration: 'slow' }), (e) => e.code === 'EPROFILE');
  assert.throws(() => setProfile(t, 'wild'), (e) => e.code === 'EPROFILE');
});

test('recordMotion closes a section only on pass or explicit acceptance', () => {
  const t = theme();
  const fail = path.join(t, 'fail.json');
  const pass = path.join(t, 'pass.json');
  fs.writeFileSync(fail, JSON.stringify({ pass: false }));
  fs.writeFileSync(pass, JSON.stringify({ pass: true }));
  assert.throws(() => recordMotion(t, 'home', 1, { presets: ['fade-up'], checkFile: fail }), (e) => e.code === 'EMOTION');
  assert.equal(loadState(t).pages[0].sections[0].status, 'animating');
  recordMotion(t, 'home', 1, { presets: ['fade-up'], checkFile: fail, accepted: true });
  let sec = loadState(t).pages[0].sections[0];
  assert.equal(sec.status, 'done');
  assert.equal(sec.motion.check, 'accepted');
  assert.match(sec.notes, /accepted by developer/);
  recordMotion(t, 'home', 1, { presets: ['fade-up', 'stagger-children'], checkFile: pass });
  sec = loadState(t).pages[0].sections[0];
  assert.equal(sec.motion.check, 'pass');
  assert.deepEqual(sec.motion.presets, ['fade-up', 'stagger-children']);
});
```

- [ ] **Step 2: Run** `npm test` → Expected: FAIL.

- [ ] **Step 3: Implement** `scripts/lib/motion.mjs`

```js
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadState, updateState, statePath } from './state.mjs';
import { installThemeAssets } from './theme-assets.mjs';

export const PROFILES = Object.freeze({
  subtle: { duration: 0.7, ease: 'power2.out', stagger: 0.08, distance: 24 },
  expressive: { duration: 0.9, ease: 'power3.out', stagger: 0.1, distance: 40 },
  bold: { duration: 1.1, ease: 'expo.out', stagger: 0.12, distance: 64 },
});

const fail = (message, code) => { const e = new Error(message); e.code = code; return e; };

export function setProfile(themeDir, nameOrObject) {
  let name;
  let values;
  if (typeof nameOrObject === 'string') {
    if (!PROFILES[nameOrObject]) throw fail(`Unknown motion profile "${nameOrObject}" (subtle|expressive|bold or a custom object).`, 'EPROFILE');
    name = nameOrObject;
    values = { ...PROFILES[nameOrObject] };
  } else {
    const o = nameOrObject ?? {};
    if (![o.duration, o.stagger, o.distance].every((v) => typeof v === 'number' && Number.isFinite(v)) || typeof o.ease !== 'string') {
      throw fail('Custom profile needs numeric duration, stagger, distance and a string ease.', 'EPROFILE');
    }
    name = 'custom';
    values = { duration: o.duration, ease: o.ease, stagger: o.stagger, distance: o.distance };
  }
  fs.mkdirSync(path.join(themeDir, 'inc'), { recursive: true });
  fs.writeFileSync(path.join(themeDir, 'inc', 'pb-motion-profile.json'), `${JSON.stringify(values, null, 2)}\n`);
  if (fs.existsSync(statePath(themeDir))) updateState(themeDir, (s) => { s.site.motionProfile = { name, ...values }; });
  return { name, ...values };
}

export function installMotion(themeDir) {
  const r = installThemeAssets(themeDir);
  if (!fs.existsSync(path.join(themeDir, 'inc', 'pb-motion-profile.json'))) setProfile(themeDir, 'subtle');
  return r;
}

export function recordMotion(themeDir, slug, n, { presets = [], checkFile, accepted = false }) {
  const check = JSON.parse(fs.readFileSync(checkFile, 'utf8'));
  if (check.pass !== true && !accepted) throw fail(`Motion check did not pass (${checkFile}). Fix the motion or ask the developer to accept.`, 'EMOTION');
  let status;
  updateState(themeDir, (s) => {
    const page = s.pages.find((p) => p.slug === slug);
    const sec = page?.sections.find((x) => x.n === Number(n));
    if (!sec) throw fail(`No section ${n} on page "${slug}".`, 'ENOSECTION');
    sec.motion = { presets, check: check.pass === true ? 'pass' : 'accepted', result: checkFile };
    if (check.pass !== true) sec.notes = [sec.notes, 'motion accepted by developer'].filter(Boolean).join('; ');
    sec.status = 'done';
    status = sec.status;
  });
  return { status };
}

function main(argv) {
  const [cmd, themeDir, a, b, c, ...rest] = argv;
  const out = (v) => process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
  if (cmd === 'install' && themeDir) return out(installMotion(themeDir));
  if (cmd === 'profile' && themeDir && a) return out(setProfile(themeDir, a.trim().startsWith('{') ? JSON.parse(a) : a));
  if (cmd === 'record' && themeDir && a && b && c) {
    const flags = [...rest];
    const pi = flags.indexOf('--presets');
    return out(recordMotion(themeDir, a, b, { checkFile: c, presets: pi >= 0 ? flags[pi + 1].split(',') : [], accepted: flags.includes('--accepted') }));
  }
  process.stderr.write('Usage: node motion.mjs install <themeDir> | profile <themeDir> <name|json> | record <themeDir> <slug> <n> <check.json> --presets a,b [--accepted]\n');
  process.exit(64);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); }
}
```

- [ ] **Step 4: Run** `npm test` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/protoblocks-site-builder/scripts/lib/motion.mjs tests/unit/motion.test.mjs
git commit -m "feat(motion): site motion profiles and section completion recording"
```

---

### Task 3: Motion QA check

**Files:**
- Create: `skills/protoblocks-site-builder/scripts/qa/motion-check.mjs`
- Create: `tests/qa/fixtures/motion-broken.html`
- Create: `tests/qa/fixtures/motion-taxi.html`
- Create: `tests/qa/motion-check.test.mjs`

**Interfaces:**
- Consumes: `launchBrowser`, `openPage` (Stage 3), `shoot`, `diffImages` (Stage 3).
- Produces:
  - `motionCheck({ url, anchor, width = 1440, scale = 1, outDir, browser? }) => Promise<{ pass, settledMismatch, cls, pageErrors, unsettled: string[], taxi: { checked: boolean, before?: number, after?: number }, reduced: string, settled: string }>` — writes `reduced.png`, `settled.png` and `motion-check.json` in `outDir`.
  - Steps: (1) reduced-motion element shot → `reduced.png`; (2) new page with motion on (via `openPage(... reducedMotion:false)`), register a buffered `layout-shift` PerformanceObserver summing `value` where `!hadRecentInput`, scroll the anchor into view and slowly through it, wait until every `[data-pb-motion][data-proto-animate]` in the anchor is `done` (6 s timeout → names of stragglers in `unsettled`), wait 500 ms, element shot → `settled.png`; (3) diff settled vs reduced; (4) if `window.protoTaxi?.core` exists: record `ScrollTrigger.getAll().length`, `protoTaxi.core.navigateTo(<origin>/)` and wait for `proto:page-ready`, `navigateTo(url)` and wait again, record count again; (5) `pass` = `settledMismatch ≤ 0.02 && cls ≤ 0.01 && pageErrors.length === 0 && unsettled.length === 0 && (!taxi.checked || taxi.before === taxi.after)`.
  - CLI: `node motion-check.mjs --url U --anchor pb-s3 --out <dir> [--width 1440] [--scale 1]` (exit 1 when not pass).

- [ ] **Step 1: Fixtures**

`tests/qa/fixtures/motion-broken.html`: copy `motion.html` but replace `pb-s1` content with a single element whose motion leaves a residue, and add a script after the runtime that overrides the end state:
```html
<section id="pb-s1"><h1 id="t1" data-pb-motion="fade-up" data-proto-animate="manual">Fade up title</h1></section>
...
<script>
  document.addEventListener('proto-blocks:reveal', (e) => { if (e.target.id === 't1') e.target.style.transform = 'translateY(40px)'; });
</script>
```
(Under reduced motion the runtime sets `done` too, so make the residue only apply when `!matchMedia('(prefers-reduced-motion: reduce)').matches`.)

`tests/qa/fixtures/motion-taxi.html`: copy `motion.html` and wrap both sections in `<div data-taxi><div data-taxi-view>…</div></div>`; append a fake Taxi after the runtime:
```html
<script>
  (function () {
    var view = document.querySelector('[data-taxi-view]');
    var original = view.innerHTML;
    function fire(name) { document.dispatchEvent(new CustomEvent(name, { detail: { container: view, url: location.href } })); }
    window.protoTaxi = { core: { navigateTo: function (u) {
      fire('proto:page-leave');
      window.ScrollTrigger.getAll().forEach(function (t) { if (view.contains(t.trigger)) t.kill(); });
      view.innerHTML = u.endsWith('/') ? '<p>home</p>' : original;
      setTimeout(function () { fire('proto:page-ready'); }, 50);
      return Promise.resolve();
    } } };
  })();
</script>
```

- [ ] **Step 2: Failing tests** `tests/qa/motion-check.test.mjs`

```js
import assert from 'node:assert/strict';
import path from 'node:path';
import { qtest, tmpDir, serveFixtures, QA_DIR } from './helpers.mjs';

qtest('motionCheck passes clean motion, fails residue, and checks Taxi re-init', async () => {
  const { motionCheck } = await import(path.join(QA_DIR, 'motion-check.mjs'));
  const srv = await serveFixtures();
  try {
    const good = await motionCheck({ url: `${srv.url}/motion.html`, anchor: 'pb-s1', width: 1280, outDir: tmpDir() });
    assert.equal(good.pass, true, JSON.stringify(good, null, 2));
    assert.equal(good.taxi.checked, false);

    const bad = await motionCheck({ url: `${srv.url}/motion-broken.html`, anchor: 'pb-s1', width: 1280, outDir: tmpDir() });
    assert.equal(bad.pass, false);
    assert.ok(bad.settledMismatch > 0.02, `mismatch ${bad.settledMismatch}`);

    const taxi = await motionCheck({ url: `${srv.url}/motion-taxi.html`, anchor: 'pb-s1', width: 1280, outDir: tmpDir() });
    assert.equal(taxi.taxi.checked, true);
    assert.equal(taxi.taxi.before, taxi.taxi.after, JSON.stringify(taxi.taxi));
    assert.equal(taxi.pass, true, JSON.stringify(taxi, null, 2));
  } finally { await srv.close(); }
});
```

- [ ] **Step 3: Run** `npm run test:qa` → Expected: FAIL.

- [ ] **Step 4: Implement** `scripts/qa/motion-check.mjs`

```js
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser, openPage } from './browser.mjs';
import { shoot } from './shoot.mjs';
import { diffImages } from './diff.mjs';

export const MOTION_THRESHOLDS = { settledMismatchMax: 0.02, clsMax: 0.01, settleTimeoutMs: 6000 };

export async function motionCheck({ url, anchor, width = 1440, scale = 1, outDir, browser }) {
  fs.mkdirSync(outDir, { recursive: true });
  const own = !browser;
  const b = browser ?? await launchBrowser();
  const selector = `#${anchor}`;
  const reduced = path.join(outDir, 'reduced.png');
  const settled = path.join(outDir, 'settled.png');
  try {
    await shoot({ url, selector, width, scale, out: reduced, browser: b });
    const { page, context, errors } = await openPage(b, { url, width, scale, reducedMotion: false });
    try {
      await page.evaluate(() => {
        window.__pbCls = 0;
        new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__pbCls += e.value; })
          .observe({ type: 'layout-shift', buffered: true });
      });
      await page.evaluate(async (sel) => {
        const el = document.querySelector(sel);
        if (!el) return;
        const top = el.getBoundingClientRect().top + window.scrollY;
        const end = top + el.offsetHeight;
        for (let y = Math.max(0, top - window.innerHeight); y <= end; y += 120) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
        el.scrollIntoView({ block: 'center' });
      }, selector);
      const unsettled = await page.evaluate(async ({ sel, timeout }) => {
        const start = Date.now();
        const pending = () => [...document.querySelectorAll(`${sel} [data-pb-motion][data-proto-animate], ${sel}[data-pb-motion][data-proto-animate]`)].filter((e) => e.getAttribute('data-proto-animate') !== 'done');
        while (pending().length && Date.now() - start < timeout) await new Promise((r) => setTimeout(r, 100));
        return pending().map((e) => e.id || e.getAttribute('data-pb-motion'));
      }, { sel: selector, timeout: MOTION_THRESHOLDS.settleTimeoutMs });
      await page.waitForTimeout(500);
      await page.locator(selector).first().screenshot({ path: settled });
      const cls = await page.evaluate(() => Math.round((window.__pbCls ?? 0) * 10000) / 10000);

      let taxi = { checked: false };
      const hasTaxi = await page.evaluate(() => !!(window.protoTaxi && window.protoTaxi.core && window.ScrollTrigger));
      if (hasTaxi) {
        const nav = (target) => page.evaluate((t) => new Promise((resolve) => {
          const done = () => { document.removeEventListener('proto:page-ready', done); setTimeout(resolve, 300); };
          document.addEventListener('proto:page-ready', done);
          window.protoTaxi.core.navigateTo(t);
          setTimeout(resolve, 8000);
        }), target);
        const before = await page.evaluate(() => window.ScrollTrigger.getAll().length);
        await nav(new URL('/', url).href);
        await nav(url);
        const after = await page.evaluate(() => window.ScrollTrigger.getAll().length);
        taxi = { checked: true, before, after };
      }

      const d = await diffImages({ design: reduced, render: settled });
      const result = {
        url, anchor,
        settledMismatch: d.mismatch,
        cls,
        pageErrors: errors.page,
        unsettled,
        taxi,
        reduced, settled,
      };
      result.pass = d.mismatch <= MOTION_THRESHOLDS.settledMismatchMax && d.heightDelta === 0 && cls <= MOTION_THRESHOLDS.clsMax
        && errors.page.length === 0 && unsettled.length === 0 && (!taxi.checked || taxi.before === taxi.after);
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
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1); });
}
```

- [ ] **Step 5: Run** `npm run test:qa` → Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add skills/protoblocks-site-builder/scripts/qa/motion-check.mjs tests/qa/fixtures/motion-broken.html tests/qa/fixtures/motion-taxi.html tests/qa/motion-check.test.mjs
git commit -m "feat(motion): motion QA check for settle state, CLS, errors and Taxi re-init"
```

---

### Task 4: `protoblocks-motion` skill + section-loop Animate step

**Files:**
- Create: `skills/protoblocks-motion/SKILL.md`
- Create: `skills/protoblocks-motion/references/presets.md`
- Create: `skills/protoblocks-motion/references/custom-motion.md`
- Modify: `skills/protoblocks-section-loop/SKILL.md` (replace the Animate placeholder)
- Modify: `skills/protoblocks-site-setup/SKILL.md` (setup installs motion: add `node "$PB/lib/motion.mjs" install "$THEME"` after `setup-site.mjs`, and choose the profile)

**Interfaces:**
- Consumes (document exact usage): `motion.mjs install|profile|record`, `qa/motion-check.mjs`, `gates.mjs`, `page.mjs build`.

- [ ] **Step 1: Write `SKILL.md`** (≤ ~6 KB)

```markdown
---
name: protoblocks-motion
description: Use when adding scroll/entrance animation to a verified Proto-Blocks section or choosing a site's motion style - applies the pb-motion GSAP preset vocabulary via data attributes, keeps motion consistent with the site profile, writes bespoke view.js only when presets can't express the intent, and verifies with the motion check. Normally invoked by protoblocks-section-loop when a section reaches status "animating".
---
```
Body, written in full:
1. **Scripts** (`PB`, `THEME`).
2. **Once per site** — `node "$PB/lib/motion.mjs" install "$THEME"`; pick a profile from the design's personality (calm/corporate → `subtle`; product/marketing → `expressive`; editorial/brand-heavy → `bold`) or the developer's motion notes; `motion.mjs profile "$THEME" <name>`.
3. **Per section** — choose presets (rules in `references/presets.md`): one hero-level effect for the section heading, one supporting effect for the content group, counters for stats, at most 3 distinct presets per section, nothing on body paragraphs longer than ~3 lines, never animate navigation links or form inputs; honour design motion notes first.
4. **Apply** — edit `template.php` so animated elements get the attributes **only on the frontend**:
   ```php
   <?php $pb_motion = fn($preset, $extra = '') => $is_preview ? '' : sprintf('data-pb-motion="%s" data-proto-animate="manual" %s', esc_attr($preset), $extra); ?>
   <h2 <?php echo $pb_motion('split-lines'); ?> data-proto-field="heading">…</h2>
   ```
   (continuous presets: `data-pb-motion="parallax"` without `data-proto-animate`); re-run gates; rebuild the page.
5. **Verify** — `node "$PB/qa/motion-check.mjs" --url <page url> --anchor pb-s<n> --width <desktop width> --out "$THEME/.protoblocks/artifacts/<page>/pb-s<n>/motion"`; fix until `pass`; failures map: `settledMismatch` → preset leaves residue (missing `clearProps`, custom CSS transform) ; `cls` → animating layout properties (height/margin) instead of transform/opacity; `unsettled` → element never reaches `done` (custom view.js forgot to set it); `taxi` mismatch → bespoke JS not tearing down on `proto:page-leave`.
6. **Record** — `node "$PB/lib/motion.mjs" record "$THEME" <page> <n> <out>/motion-check.json --presets a,b`; after 3 failed attempts ask the developer: simplify the motion, accept (`--accepted`), or remove motion from the section.
7. **Iron rules** — no motion in the editor preview; never hide content without `data-proto-animate="manual"` (the plugin's watchdog is the safety net); transform/opacity/clip-path only; respect reduced motion (the runtime does — bespoke code must too); commit in the theme fork after recording.

- [ ] **Step 2: Write `references/presets.md`**

Content (≤ ~200 lines): a table of every preset (name → what it does → use for → avoid for → options); per-pattern recommendations (hero: `split-lines` heading + `fade-up` CTA group with `data-pb-delay="0.15"`; feature grid: `stagger-children` on the grid; logo wall: `fade-in` or `marquee` if the design shows a scrolling row; stats: `counter` on each value + `stagger-children` on the row; testimonial: `fade-up`; media-text: `clip-reveal` on the image + `fade-up` on the copy; CTA band: `scale-in` on the panel; background media: `parallax` with `data-pb-speed="0.5"`); counter text formats supported (`1,250+`, `$4.9M`, `98%`, `4.5`) and unsupported (ranges like `10-20` animate the first number only — avoid); marquee markup requirement (single child track element, content duplicated at runtime).

- [ ] **Step 3: Write `references/custom-motion.md`**

Content (≤ ~150 lines): when to write a bespoke `view.js` (pinned/scrubbed storytelling, SVG path drawing, Lottie, cursor effects); the contract — set `data-proto-animate="manual"` on the root, run on `proto:page-ready` for `e.detail.container` (also fires on first load), kill everything you created on `proto:page-leave`, set `data-proto-animate="done"` when finished, check `matchMedia('(prefers-reduced-motion: reduce)')` and jump to the end state, use `window.protoLenis` (not a new Lenis) and the theme's `window.gsap`/`ScrollTrigger`/`SplitText`/`lottie`; plain IIFE `view.js` (block scripts with handle prefix `proto-blocks-` are re-run by Taxi — guard against double init with a `WeakSet` like pb-motion does); ES-module `viewScriptModule` scripts are NOT re-run by Taxi — rely on the events only; a complete minimal example of a pinned scrub timeline following the contract.

- [ ] **Step 4: Replace the Animate section in `skills/protoblocks-section-loop/SKILL.md`**

"**Animate** — when the section's status is `animating`, load the `protoblocks-motion` skill and follow it for this section. The section is finished only when `motion.mjs record` sets it to `done`."

- [ ] **Step 5: Add motion install to `skills/protoblocks-site-setup/SKILL.md`** after the one-shot setup step: "Install motion: `node "$PB/lib/motion.mjs" install "$THEME"` (choose the profile later, in `protoblocks-motion`)."

- [ ] **Step 6: Verify**

Run: `npm test && npm run test:qa` → Expected: PASS. `head -4 skills/protoblocks-motion/SKILL.md` → frontmatter present.

- [ ] **Step 7: Commit**

```bash
git add skills/protoblocks-motion skills/protoblocks-section-loop/SKILL.md skills/protoblocks-site-setup/SKILL.md
git commit -m "docs(motion): protoblocks-motion skill and section-loop animate step"
```

---

## Self-review notes

- Spec §6.3: runtime + presets + options + manual state + Taxi events + reduced motion (Task 1); profile (Task 2); motion-check thresholds (Task 3); templates-only-add-attributes and bespoke view.js rules (Task 4). §6.4 done + commit (Task 2 `recordMotion`, Task 4 skill).
- Interfaces: `installThemeAssets` (Stage 2) copies `pb-motion.js`/`pb-motion.php`; `pb-assets.php` enqueues `pb-motion` handle with GSAP deps; `motionCheck` reuses Stage 3 `openPage`/`shoot`/`diffImages`.
