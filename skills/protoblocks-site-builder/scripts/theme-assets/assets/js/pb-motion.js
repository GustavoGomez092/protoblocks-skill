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
      start: el.getAttribute('data-pb-start') || null
    };
  }
  function done(el) {
    if (el.getAttribute('data-proto-animate') !== 'done') {
      el.setAttribute('data-proto-animate', 'done');
      try { el.dispatchEvent(new CustomEvent('proto-blocks:reveal', { bubbles: true })); } catch (e) {}
    }
  }
  function own(el, kill) { owned.push({ el: el, kill: kill }); }
  // Run and drop every cleanup registered for one element, newest first (kill the tween before reverting the
  // DOM it animates). Used when a preset fails part-way through init.
  function release(el) {
    var mine = [];
    owned = owned.filter(function (o) { if (o.el === el) { mine.push(o); return false; } return true; });
    for (var i = mine.length - 1; i >= 0; i--) { try { mine[i].kill(); } catch (e) {} }
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
        own(el, function () { split.revert(); });
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
        var finish = function () { el.textContent = original; el.removeAttribute('aria-label'); };
        own(el, finish);
        el.setAttribute('aria-label', original); // screen readers get the real value while the visible text counts up
        el.textContent = formatCounter(c, 0);
        return g.to(state, Object.assign({ v: c.value, duration: Math.max(1, o.duration * 2), onUpdate: function () { el.textContent = formatCounter(c, state.v); }, onComplete: finish }, { ease: o.ease, delay: o.delay }));
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

  function initReveal(el, name) {
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
      own(el, function () { if (t.scrollTrigger) t.scrollTrigger.kill(); t.kill(); g.set(el, { clearProps: 'transform' }); });
    } else if (name === 'marquee') {
      var track = el.firstElementChild;
      if (!track) return;
      if (!track.getAttribute('data-pb-cloned')) { cloneForLoop(track); track.setAttribute('data-pb-cloned', '1'); }
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
        // Never leave content hidden: undo whatever the preset already did (kill its tween, restore counter text and
        // aria-label, revert SplitText), then strip GSAP's from-state from the element and everything inside it.
        release(el);
        // Only nodes with an inline style can hold GSAP's from-state; skipping the rest avoids leaving style="" behind.
        var styled = [el].concat(Array.prototype.slice.call(el.querySelectorAll('[style]'))).filter(function (n) { return n.hasAttribute('style'); });
        if (window.gsap && styled.length) {
          try { window.gsap.set(styled, { clearProps: 'opacity,transform,clipPath' }); } catch (e2) {}
        }
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

  // Put the continuous presets inside root at rest: parallax back at offset 0, marquee stopped at position 0 with
  // its runtime copies removed. Reveal tweens are untouched and nothing is marked for re-init. Used by the motion
  // check, which judges continuous presets at rest (they never settle; a mid-motion frame is not a residue).
  function rest(root) {
    owned = owned.filter(function (o) {
      var name = o.el.getAttribute && o.el.getAttribute('data-pb-motion');
      if (CONTINUOUS.indexOf(name) < 0 || (root && !root.contains(o.el))) return true;
      try { o.kill(); } catch (e) {}
      var track = name === 'marquee' ? o.el.firstElementChild : null;
      if (track) {
        Array.prototype.forEach.call(track.querySelectorAll('[data-pb-clone]'), function (n) { if (n.parentNode === track) track.removeChild(n); });
        track.removeAttribute('data-pb-cloned');
      }
      return false;
    });
  }

  window.pbMotion = { init: init, teardown: teardown, rest: rest, PRESETS: REVEAL.concat(CONTINUOUS), version: '1' };
  if (gsapReady()) window.gsap.registerPlugin(window.ScrollTrigger);

  document.addEventListener('proto:page-ready', function (e) { init((e.detail && e.detail.container) || document); });
  document.addEventListener('proto:page-leave', function (e) { teardown((e.detail && e.detail.container) || document.body); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(document); });
  else init(document);
})();
