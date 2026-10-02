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
  // Cleanups per element, split in two: kill stops motion (tweens, triggers, observers) and changes nothing visible;
  // revert restores the authored DOM and styles (SplitText markup, counter text, cleared transforms).
  var owned = []; // { el, kill: fn, revert: fn }
  // Reverts left behind by a kill-only teardown, keyed by element: run just before that element is initialised again
  // (only happens when the DOM survived the teardown). Discarded DOM takes its entries with it.
  var pending = new WeakMap();
  function noop() {}

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
      start: el.getAttribute('data-pb-start') || null
    };
  }
  function done(el) {
    if (el.getAttribute('data-proto-animate') !== 'done') {
      el.setAttribute('data-proto-animate', 'done');
      try { el.dispatchEvent(new CustomEvent('proto-blocks:reveal', { bubbles: true })); } catch (e) {}
    }
  }
  function own(el, kill, revert) { owned.push({ el: el, kill: kill || noop, revert: revert || noop }); }
  // Stop every entry first (kill a tween before reverting the DOM it animates), then revert, newest first.
  function finishEntries(list, revert) {
    var i;
    for (i = list.length - 1; i >= 0; i--) { try { list[i].kill(); } catch (e) {} }
    if (revert) { for (i = list.length - 1; i >= 0; i--) { try { list[i].revert(); } catch (e) {} } }
  }
  function take(match) {
    var out = [];
    owned = owned.filter(function (o) { if (match(o)) { out.push(o); return false; } return true; });
    return out;
  }
  // Run and drop every cleanup registered for one element, revert included. Used when a preset fails part-way.
  function release(el) { finishEntries(take(function (o) { return o.el === el; }), true); }
  function flushPending(el) {
    var list = pending.get(el);
    if (!list) return;
    pending.delete(el);
    for (var i = list.length - 1; i >= 0; i--) { try { list[i](); } catch (e) {} }
  }

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
        own(el, null, function () { split.revert(); });
        var targets = lines ? split.lines : split.chars;
        return g.fromTo(targets, lines ? { yPercent: 100 } : { opacity: 0, y: o.distance / 2 },
          Object.assign(lines ? { yPercent: 0 } : { opacity: 1, y: 0 }, { stagger: lines ? o.stagger : o.stagger / 4, onComplete: function () { split.revert(); } }, base));
      }
      case 'counter': {
        // The authored text is stored once and always parsed from there, so teardown/re-init never re-reads "0".
        if (!el.hasAttribute('data-pb-counter-text')) el.setAttribute('data-pb-counter-text', el.textContent);
        var original = el.getAttribute('data-pb-counter-text');
        var c = parseCounter(original);
        g.set(el, { opacity: 1 });
        if (!c) return g.fromTo(el, { opacity: 0 }, Object.assign({ opacity: 1 }, base));
        var state = { v: 0 };
        // Hold the box at the authored text's width while counting (and while hidden at "0"), with tabular digits,
        // so a growing number never pushes its neighbours. min-width needs a box: an inline element counts as an
        // inline-block, which lays the same text out identically. All of it is removed when the count ends.
        var inline = window.getComputedStyle(el).display === 'inline';
        // Measured with the element's own digits: the authored text is what stays when the count ends.
        var reserve = function () {
          el.style.minWidth = '';
          el.style.fontVariantNumeric = '';
          el.textContent = original;
          var cs = window.getComputedStyle(el);
          var w = el.getBoundingClientRect().width;
          if (cs.boxSizing !== 'border-box') w -= (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
          el.style.minWidth = w + 'px';
          el.style.fontVariantNumeric = 'tabular-nums';
        };
        var finish = function () {
          el.textContent = original;
          el.removeAttribute('aria-label');
          el.style.minWidth = '';
          el.style.fontVariantNumeric = '';
          if (inline) el.style.display = '';
        };
        own(el, null, finish);
        el.setAttribute('aria-label', original); // screen readers get the real value while the visible text counts up
        if (inline) el.style.display = 'inline-block';
        reserve();
        el.textContent = formatCounter(c, 0);
        // Capped so the plugin watchdog (done 1.5 s after entering view) never cuts the count short.
        return g.to(state, Object.assign({
          v: c.value, duration: Math.min(1.2, Math.max(1, o.duration * 2)),
          onStart: function () { reserve(); el.textContent = formatCounter(c, state.v); }, // re-measure: web fonts may have loaded since init
          onUpdate: function () { el.textContent = formatCounter(c, state.v); }, onComplete: finish
        }, { ease: o.ease, delay: o.delay }));
      }
    }
    return null;
  }

  // Default start: 'top 85%', capped just below the last reachable scroll position. Elements in the last ~15% of
  // a document can never reach 'top 85%'. GSAP's clamp() fixes that end but also clamps above-the-fold elements
  // to 0, and a trigger never fires at scroll 0, so hero content would wait for the first scroll.
  // Recomputed by ScrollTrigger on every refresh (resize, late images, fonts).
  function defaultStart(el) {
    return function () {
      var natural = el.getBoundingClientRect().top + (window.pageYOffset || 0) - window.innerHeight * 0.85;
      return Math.min(natural, window.ScrollTrigger.maxScroll(window) - 1);
    };
  }

  // SplitText freezes the current line breaks into wrappers, so a split made before the element's web font arrives
  // keeps fallback-font lines (wrong wraps, clipped masks). Split presets wait for the font, at most FONT_WAIT_MS;
  // past that the element reveals with a plain fade, never split. The element stays hidden meanwhile, under the
  // usual backstops (the plugin watchdog, this runtime's own done observer).
  var SPLIT = ['split-lines', 'split-chars'];
  var FONT_WAIT_MS = 2500;
  function fontSpec(el) {
    var cs = window.getComputedStyle(el);
    return cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
  }
  // Resolves true once the fonts the element's text needs are loaded (and no other font is still loading), false on
  // timeout. null: nothing to wait for, split now.
  function fontsFor(el) {
    var fonts = document.fonts;
    if (!fonts || !fonts.ready || typeof fonts.check !== 'function') return null;
    var spec;
    var text = el.textContent || ' ';
    try { spec = fontSpec(el); if (fonts.check(spec, text) && fonts.status !== 'loading') return null; } catch (e) { return null; }
    var loaded = fonts.load(spec, text).then(function () { return fonts.ready; }, function () { return fonts.ready; }).then(function () { return true; });
    return Promise.race([loaded, new Promise(function (r) { setTimeout(function () { r(false); }, FONT_WAIT_MS); })]);
  }

  function initReveal(el, name) {
    var wait = SPLIT.indexOf(name) >= 0 && window.SplitText ? fontsFor(el) : null;
    if (!wait) { startReveal(el, name); return; }
    var live = true;
    own(el, function () { live = false; }); // torn down while waiting: never split
    wait.then(function (ready) {
      if (!live) return;
      live = false;
      // Revealed by someone else meanwhile (the watchdog): the CSS no longer hides it; leave the authored text alone.
      if (el.getAttribute('data-proto-animate') === 'done') return;
      try { startReveal(el, ready ? name : 'fade-in'); } catch (e) { recover(el, name, e); }
    });
  }

  function startReveal(el, name) {
    var o = opts(el);
    var tween = revealTween(el, name, o);
    if (!tween) { done(el); return; }
    tween.pause();
    own(el, function () { tween.kill(); }); // registered before ScrollTrigger.create so a throw there can still clean up
    var st = window.ScrollTrigger.create({
      trigger: el, start: o.start || defaultStart(el), once: true,
      onEnter: function () { tween.eventCallback('onComplete', (function (prev) { return function () { if (prev) prev(); done(el); }; })(tween.eventCallback('onComplete'))); tween.play(); }
    });
    // Self-backstop: if anything else (e.g. the Proto-Blocks reveal watchdog) marks this element done before the
    // tween finished, jump the tween to its end so clearProps runs and GSAP's inline from-state never wins.
    var mo = new MutationObserver(function () {
      if (el.getAttribute('data-proto-animate') !== 'done') return;
      mo.disconnect();
      st.kill();
      if (tween.progress() < 1) tween.progress(1);
    });
    mo.observe(el, { attributes: true, attributeFilter: ['data-proto-animate'] });
    own(el, function () { mo.disconnect(); st.kill(); });
  }

  // Duplicate the track's content for a seamless loop. The copy is hidden from assistive tech, made inert,
  // and stripped of ids; bare text nodes are wrapped in a span so they can carry those attributes too.
  function cloneForLoop(track) {
    Array.prototype.slice.call(track.childNodes).forEach(function (node) {
      var copy;
      if (node.nodeType === 1) copy = node.cloneNode(true);
      else if (node.nodeType === 3 && node.nodeValue.trim()) { copy = document.createElement('span'); copy.textContent = node.nodeValue; }
      else return;
      copy.removeAttribute('id');
      Array.prototype.forEach.call(copy.querySelectorAll('[id]'), function (n) { n.removeAttribute('id'); });
      copy.setAttribute('aria-hidden', 'true');
      copy.setAttribute('inert', '');
      copy.setAttribute('data-pb-clone', '');
      track.appendChild(copy);
    });
  }

  function initContinuous(el, name) {
    var g = window.gsap;
    var o = opts(el);
    if (name === 'parallax') {
      var t = g.to(el, { yPercent: -10 * o.speed, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true } });
      own(el, function () { if (t.scrollTrigger) t.scrollTrigger.kill(); t.kill(); }, function () { g.set(el, { clearProps: 'transform' }); });
    } else if (name === 'marquee') {
      var track = el.firstElementChild;
      if (!track) return;
      if (!track.getAttribute('data-pb-cloned')) { cloneForLoop(track); track.setAttribute('data-pb-cloned', '1'); }
      var m = g.to(track, { xPercent: -50, ease: 'none', duration: 20 / o.speed, repeat: -1 });
      own(el, function () { m.kill(); }, function () { g.set(track, { clearProps: 'transform' }); });
    }
  }

  function init(root) {
    var scope = root || document;
    var els = scope.querySelectorAll ? scope.querySelectorAll(SEL) : [];
    Array.prototype.forEach.call(els, function (el) {
      if (seen.has(el)) return;
      seen.add(el);
      flushPending(el);
      var name = el.getAttribute('data-pb-motion');
      var isReveal = REVEAL.indexOf(name) >= 0;
      if (reduced || !gsapReady()) { if (isReveal || el.hasAttribute('data-proto-animate')) done(el); return; }
      try {
        if (isReveal) initReveal(el, name);
        else if (CONTINUOUS.indexOf(name) >= 0) initContinuous(el, name);
        else done(el);
      } catch (e) { recover(el, name, e); }
    });
  }

  // Never leave content hidden: undo whatever the preset already did (kill its tween, restore counter text and
  // aria-label, revert SplitText), then strip GSAP's from-state from the element and everything inside it.
  function recover(el, name, e) {
    release(el);
    // Only nodes with an inline style can hold GSAP's from-state; skipping the rest avoids leaving style="" behind.
    var styled = [el].concat(Array.prototype.slice.call(el.querySelectorAll('[style]'))).filter(function (n) { return n.hasAttribute('style'); });
    if (window.gsap && styled.length) {
      try { window.gsap.set(styled, { clearProps: 'opacity,transform,clipPath' }); } catch (e2) {}
    }
    done(el);
    if (window.console) console.warn('[pb-motion] ' + name + ' failed:', e);
  }

  // Stop motion inside root (all of it without root): kill tweens, triggers and observers, and forget the elements so
  // a later init starts them again. Nothing visible changes: on proto:page-leave the leaving view is still on screen
  // (Taxi fades it out, then discards it). opts.revert: also restore the authored DOM now, for DOM that stays.
  // Without it, the reverts wait for the element's next init, which only happens when that DOM survived.
  function teardown(root, opts) {
    var revert = !!(opts && opts.revert);
    var mine = take(function (o) { return !root || root.contains(o.el); });
    finishEntries(mine, revert);
    mine.forEach(function (o) {
      seen.delete(o.el);
      if (revert) return;
      var list = pending.get(o.el) || [];
      list.push(o.revert);
      pending.set(o.el, list);
    });
    if (root && root.querySelectorAll) Array.prototype.forEach.call(root.querySelectorAll(SEL), function (el) { seen.delete(el); });
  }

  // Put the continuous presets inside root at rest: parallax back at offset 0, marquee stopped at position 0 with
  // its runtime copies removed. Reveal tweens are untouched and nothing is marked for re-init. Used by the motion
  // check, which judges continuous presets at rest (they never settle; a mid-motion frame is not a residue).
  function rest(root) {
    var mine = take(function (o) {
      var name = o.el.getAttribute && o.el.getAttribute('data-pb-motion');
      return CONTINUOUS.indexOf(name) >= 0 && (!root || root.contains(o.el));
    });
    finishEntries(mine, true);
    mine.forEach(function (o) {
      var track = o.el.getAttribute('data-pb-motion') === 'marquee' ? o.el.firstElementChild : null;
      if (!track) return;
      Array.prototype.forEach.call(track.querySelectorAll('[data-pb-clone]'), function (n) { if (n.parentNode === track) track.removeChild(n); });
      track.removeAttribute('data-pb-cloned');
    });
  }

  window.pbMotion = { init: init, teardown: teardown, rest: rest, PRESETS: REVEAL.concat(CONTINUOUS), version: '1' };
  if (gsapReady()) window.gsap.registerPlugin(window.ScrollTrigger);

  document.addEventListener('proto:page-ready', function (e) { init((e.detail && e.detail.container) || document); });
  document.addEventListener('proto:page-leave', function (e) { teardown((e.detail && e.detail.container) || document.body); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(document); });
  else init(document);
})();
