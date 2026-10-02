# Bespoke motion (custom view.js)

Write bespoke motion only when no preset can express the intent: SVG path drawing, Lottie, cursor effects, multi-step timelines on one element. Pinned or scrubbed storytelling is possible, but see "What the check cannot judge". If a preset (or two) gets within reach of the design, use presets.

## The contract

1. Root element carries `data-proto-animate="manual"`, only on the frontend (`$is_preview` rule from `SKILL.md`). The block's own CSS hides what must start hidden: `[data-proto-animate="manual"] { opacity: 0 }` scoped to the block's class. The theme's anti-flash CSS covers only `[data-pb-motion]` elements.
2. Never put `data-pb-motion` on a bespoke element. pb-motion marks an unknown preset name `done` at once, which un-hides it and defeats your script.
3. Run on `proto:page-ready` for `e.detail.container` (it fires on first load and after every Taxi navigation), and also once on `DOMContentLoaded` or immediately: without Taxi no event fires. Guard each element with a `WeakSet`.
4. Kill everything you created on `proto:page-leave`: tweens, SplitText, Lottie instances, observers, listeners on `window`/`document`. The theme has already killed the ScrollTriggers inside the leaving container (without reverting); do not rely on that for anything else. Use `gsap.context(fn, el)` and `ctx.kill()` (no revert: the old view is still fading out).
5. When finished, set `data-proto-animate="done"` and dispatch nothing else. Reduced motion (`matchMedia('(prefers-reduced-motion: reduce)')`) or missing `window.gsap`/`window.ScrollTrigger`: jump to the end state and set `done` immediately.
6. End state equals the reduced-motion state: clear inline styles you set (`clearProps`).
7. Use theme globals, never your own copies: `window.gsap`, `window.ScrollTrigger` (registered by `proto-init`), `window.SplitText`, `window.lottie`, `window.protoLenis` (exists only when `proto-init` is enqueued; guard it), `window.protoTaxi` and `window.pbMotion`.

The Proto-Blocks plugin watchdog (`reveal-runtime.js`) forces `done` 1.5 s after a `manual` element scrolls into view (and 2 s after load for elements already in view). It is a safety net, not a timing: a tween that is still running then snaps to its end. Keep bespoke timelines under about 1.2 s after the trigger.

## Script lifetime

- Classic `view.js` (script handle `proto-blocks-<name>`): Taxi **re-executes** it after every navigation. A `WeakSet` inside the IIFE is new on each run, so it guards nothing, and each run would add another pair of `document` listeners (double init). Register listeners once with a `window` flag, as below; the first run's listeners keep serving every later view.
- ES module (`viewScriptModule`): evaluated once and never re-run by Taxi. It must rely on the events alone, so the same code works unchanged.

## Complete example: SVG line draw

Markup (frontend only): `<div class="draw-line" data-draw-line data-proto-animate="manual"><svg viewBox="0 0 400 20"><path d="M0 10 H400" stroke="currentColor" fill="none" stroke-width="2"/></svg></div>` with block CSS `.draw-line[data-proto-animate="manual"] { opacity: 0; }`.

<!-- test:fixture draw-line -->
```js
(function () {
  var FLAG = '__pbDrawLine';
  if (window[FLAG]) return; // Taxi re-runs this file; the first run's listeners stay alive
  window[FLAG] = true;

  var seen = new WeakSet();
  var live = []; // { el, ctx }
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function finish(el) { el.setAttribute('data-proto-animate', 'done'); }

  function init(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('[data-draw-line]'), function (el) {
      if (seen.has(el)) return;
      seen.add(el);
      var path = el.querySelector('path');
      if (reduced || !window.gsap || !window.ScrollTrigger || !path) { finish(el); return; }
      var len = path.getTotalLength();
      var ctx = window.gsap.context(function () {
        window.gsap.fromTo(path,
          { strokeDasharray: len, strokeDashoffset: len },
          {
            strokeDashoffset: 0, duration: 1, ease: 'power2.out',
            scrollTrigger: { trigger: el, start: 'top 85%', once: true },
            onComplete: function () {
              window.gsap.set(path, { clearProps: 'strokeDasharray,strokeDashoffset' });
              window.gsap.set(el, { clearProps: 'opacity' });
              finish(el);
            }
          });
        window.gsap.set(el, { opacity: 1 }); // the path is hidden by its dash offset now
      }, el);
      live.push({ el: el, ctx: ctx });
    });
  }

  function teardown(root) {
    live = live.filter(function (o) {
      if (root && !root.contains(o.el)) return true;
      o.ctx.kill();
      seen.delete(o.el);
      return false;
    });
  }

  document.addEventListener('proto:page-ready', function (e) { init((e.detail && e.detail.container) || document); });
  document.addEventListener('proto:page-leave', function (e) { teardown((e.detail && e.detail.container) || document.body); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(document); });
  else init(document);
})();
```

`tests/qa/custom-motion.test.mjs` extracts this block verbatim and runs it in the fixture page with the fake Taxi: it must reach `done`, leave no residue against the reduced-motion frame, own one trigger per element across Taxi round trips, and finish immediately under reduced motion. Edit the example only together with that test.

## What the check cannot judge

- `unsettled` lists only `[data-pb-motion][data-proto-animate]` elements. A bespoke element that never reaches `done` is not reported; the plugin watchdog will mask it in the browser. Check the end state yourself.
- Pinned or scrubbed motion depends on scroll position. The settled frame is taken after a scroll-through with the anchor centred, so a scrub shows as `settledMismatch`, and pin spacing as a height difference (`settledHeightDelta`, which fails the check). The developer must accept it (`--accepted`) or the motion must be redesigned as a once-triggered timeline.
- A bespoke infinite loop (CSS `@keyframes`, `repeat: -1`) never settles: the settled frame catches it mid-cycle and the reduced frame does not, so it reads as `settledMismatch`. Use the `marquee` preset (judged at rest by the check), or make the loop stop under reduced motion with CSS (`@media (prefers-reduced-motion: reduce)`) and ask the developer to accept the residual mismatch.
- Taxi checks (`taxi.before`/`after`, `duplicates`) see only ScrollTriggers, and the theme already kills those in the leaving view, so a missing teardown is not caught: leaked tweens, SplitText, observers and listeners are invisible to the check. Review them yourself; `tests/qa/custom-motion.test.mjs` proves this example's teardown by disabling the fake Taxi's trigger kill and refresh (`?nokill=1`; GSAP drops triggers of removed elements on `refresh()`, which can hide a leak).
