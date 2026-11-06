/**
 * Proto-theme page transitions (Taxi.js).
 *
 * Boots a single Taxi Core against the [data-taxi] wrapper the templates
 * provide, registers a GSAP fade as the default transition, and exposes
 *   window.protoTaxi = { core, Transition, addTransition }
 *
 * Loaded as `proto-taxi-init` with `proto-taxi` and `proto-init` as deps, so
 * window.taxi and window.protoLenis are guaranteed to exist by the time this
 * file runs.
 */
(function () {
  'use strict';

  var taxi = window.taxi;
  if (!taxi || !taxi.Core) {
    return;
  }

  if (!document.querySelector('[data-taxi]')) {
    console.warn('[proto-taxi] No [data-taxi] wrapper found — page transitions are disabled. See the theme README.');
    return;
  }

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* Optional PHP-side configuration (wp_localize_script on `proto-taxi-init`).
     Absent on a stock install; every key has a built-in default. */
  var settings = window.protoTaxiSettings && typeof window.protoTaxiSettings === 'object'
    ? window.protoTaxiSettings
    : {};

  /* ----------------------------------------------------------------------
     Link exclusions. One predicate, two consumers: Taxi's click intercept
     and its hover/focus prefetch. See docs/page-transitions.md, "Security".
     ------------------------------------------------------------------- */

  /**
   * Substrings that mark a same-host URL as an action rather than a page.
   *
   * Taxi prefetches on mouseenter and focus with the reader's cookies, and
   * WordPress protects state-changing GETs with a nonce carried *in the
   * URL*, so a prefetch of such a link is the action itself: WooCommerce's
   * "Log out" endpoint (`customer-logout/?_wpnonce=`), `?add-to-cart=`,
   * `?action=…&_wpnonce=…` plugin links. Matched case-insensitively
   * against both the href attribute and the resolved URL.
   *
   * A PHP-localised `protoTaxiSettings.ignoreHrefPatterns` array (strings)
   * replaces this list wholesale.
   */
  var DEFAULT_IGNORE_HREF = [
    '_wpnonce=',
    'add-to-cart=',
    '?action=',
    '&action=',
    'remove_item=',
    'customer-logout',
    '/wp-admin',
    'wp-login'
  ];

  function stringList(value, fallback) {
    if (!Array.isArray(value)) return fallback.slice();
    var out = [];
    for (var i = 0; i < value.length; i++) {
      if (typeof value[i] === 'string' && value[i] !== '') out.push(value[i]);
    }
    return out;
  }

  var ignoreHrefPatterns = stringList(settings.ignoreHrefPatterns, DEFAULT_IGNORE_HREF);

  /**
   * Whether Taxi must leave this anchor alone: no transition, no prefetch.
   * Runs at event time, so it also covers hrefs rewritten after boot and
   * patterns added to `protoTaxi.ignoreHrefPatterns` at runtime.
   */
  function isExcludedLink(a) {
    if (!a || typeof a.getAttribute !== 'function') return true;
    if (a.hasAttribute('data-taxi-ignore') || a.hasAttribute('download') || a.hasAttribute('target')) {
      return true;
    }
    /* rel=nofollow on a same-host link is how WordPress and WooCommerce mark
       their own action links (add-to-cart, comment reply, logout). */
    var rel = (a.getAttribute('rel') || '').toLowerCase().split(/\s+/);
    if (rel.indexOf('nofollow') !== -1) return true;

    /* An SVG <a>'s .href is an SVGAnimatedString; the attribute is always a
       string. Check both so relative and resolved forms are covered. */
    var attr = a.getAttribute('href') || '';
    var prop = typeof a.href === 'string' ? a.href : '';
    var href = (attr + '\n' + prop).toLowerCase();

    for (var i = 0; i < ignoreHrefPatterns.length; i++) {
      if (href.indexOf(String(ignoreHrefPatterns[i]).toLowerCase()) !== -1) return true;
    }
    return false;
  }

  function cssString(value) {
    return '"' + String(value).replace(/["\\]/g, '\\$&') + '"';
  }

  /**
   * The delegation selector Taxi attaches its click and prefetch handlers
   * to. Built from the same list as isExcludedLink() so an excluded link
   * never even reaches a handler; the predicate is the runtime backstop.
   */
  function buildLinksSelector(patterns) {
    var parts = [
      'a[href]',
      ':not([target])',
      ':not([href^="#"])',
      ':not([data-taxi-ignore])',
      ':not([download])',
      ':not([rel~="nofollow" i])',
      ':not([href^="mailto:" i])',
      ':not([href^="tel:" i])',
      ':not(#wpadminbar a)',
      ':not(.add_to_cart_button)',
      ':not(.wc-block-components-product-button a)'
    ];
    for (var i = 0; i < patterns.length; i++) {
      parts.push(':not([href*=' + cssString(patterns[i]) + ' i])');
    }
    return parts.join('');
  }

  var LINKS = buildLinksSelector(ignoreHrefPatterns);
  try {
    document.querySelector(LINKS);
  } catch (err) {
    /* A malformed localised pattern must not take every link down with it. */
    console.error('[proto-taxi] Invalid ignoreHrefPatterns, using the defaults.', err);
    ignoreHrefPatterns = DEFAULT_IGNORE_HREF.slice();
    LINKS = buildLinksSelector(ignoreHrefPatterns);
  }

  /* ----------------------------------------------------------------------
     Fetched-document hygiene.
     ------------------------------------------------------------------- */

  /**
   * Make a fetched document parse-equivalent to a full load before Taxi
   * reads anything out of it.
   *
   * Taxi parses responses with DOMParser, i.e. with scripting *disabled*,
   * and in that mode the contents of <noscript> come back as real elements
   * instead of the inert text a full load sees. Left in place they go two
   * ways: the stock Renderer serialises the view (outerHTML) and re-parses
   * it in the live document — the classic mutation-XSS round trip, where a
   * serialiser that re-emits `</noscript>` inside an attribute or RCDATA
   * text lets markup break out of the fallback — and createCacheEntry()
   * collects every <style>/<link> it finds, promoting no-JS fallback CSS
   * into the live page (the bug proto-reveal-guard.js was written around).
   *
   * Nothing inside <noscript> can matter to a reader running this script,
   * so the whole element is dropped. <template> contents live in an inert
   * DocumentFragment, are not reached by querySelectorAll, and stay inert
   * when imported, so they are left as they are.
   */
  function stripInertMarkup(page) {
    if (!page || typeof page.querySelectorAll !== 'function') return page;
    var dead = page.querySelectorAll('noscript');
    for (var i = 0; i < dead.length; i++) {
      dead[i].remove();
    }
    return page;
  }

  /**
   * Taxi's reloadCssFilter. Applied to the fetched document's stylesheets
   * and to the live document's alike, so it only has to say which ones may
   * take part in the carry-over: anything not inside a <noscript> (already
   * stripped above — this is the backstop) or a <template>.
   *
   * Not head-only on purpose: WordPress prints stylesheets enqueued during
   * render at wp_footer (print_late_styles), and a block first used on the
   * incoming page gets its CSS exactly that way.
   */
  function isLiveStylesheet(el) {
    if (!el || typeof el.closest !== 'function') return false;
    return !el.closest('noscript, template');
  }

  /**
   * The element the fade animates. The view wrapper is a grid cell used for
   * stacking, so animate the <main> inside it when there is one.
   */
  function animTarget(el) {
    if (!el) return null;
    return el.querySelector('main') || el;
  }

  /**
   * Reset the scroll position for the incoming view.
   *
   * Called from the fade Transition's onEnter, at the point where the old
   * view has already been removed and the new one is appended (so document
   * height — and therefore Lenis's scroll limit — is correct) but still at
   * opacity: 0, making the jump invisible.
   *
   * `force: true` is required: Lenis's own scrollTo() silently no-ops
   * while the instance is stopped or locked
   * (`if (!this.isStopped && !this.isLocked || force)` in lenis.min.js), and
   * block code is documented (proto-init.js) to call `protoLenis.stop()` /
   * `.start()` as a scroll-lock API — an overlay or mobile nav left open
   * across a navigation must not leave the incoming page stuck mid-scroll.
   */
  function resetScroll() {
    if (window.protoLenis) {
      window.protoLenis.scrollTo(0, { immediate: true, force: true });
    } else {
      window.scrollTo(0, 0);
    }
  }

  var ProtoFade = class extends taxi.Transition {
    onLeave(props) {
      var el = animTarget(props.from);
      if (reduced.matches || !window.gsap || !el) {
        props.done();
        return;
      }
      window.gsap.to(el, {
        opacity: 0,
        duration: 0.4,
        ease: 'power2.inOut',
        onComplete: props.done
      });
    }

    onEnter(props) {
      safe('resetScroll', resetScroll);

      var el = animTarget(props.to);
      if (reduced.matches || !window.gsap || !el) {
        props.done();
        return;
      }
      window.gsap.fromTo(
        el,
        { opacity: 0 },
        { opacity: 1, duration: 0.5, ease: 'power2.out', onComplete: props.done }
      );
    }
  };

  /**
   * Renderer that moves the fetched view into the page as nodes.
   *
   * The stock Renderer keeps `content.outerHTML` and re-parses it through
   * innerHTML when the view is swapped. Importing the parsed subtree
   * instead means the markup is parsed exactly once, by the browser's own
   * HTML parser, the same way a full load would parse it — there is no
   * string round trip for a serialiser quirk to turn inert markup into
   * live markup. (Scripts in the view stay inert either way: the parser
   * marks them "already started" and a clone inherits that flag. Taxi's
   * loadScripts() recreates the [data-taxi-reload] ones.)
   *
   * importNode (a copy) rather than adoptNode: the cache entry is reused
   * on back/forward, so the source tree must survive the first swap.
   */
  var ProtoRenderer = class extends taxi.Renderer {
    constructor(props) {
      super(props);
      this.protoContent = props.content;
    }

    createDom() {
      if (this._DOM) return;
      this._DOM = document.createElement('div');
      this._DOM.appendChild(document.importNode(this.protoContent, true));
    }
  };

  function hasTransition(core, name) {
    return typeof name === 'string' &&
      Object.prototype.hasOwnProperty.call(core.transitions, name) &&
      typeof core.transitions[name] === 'function';
  }

  /**
   * Taxi never resets isTransitioning on failure — only on success, after
   * NAVIGATE_END. A navigation whose promise rejects or simply never
   * settles (a throwing listener inside afterFetch, a transition that
   * never calls done()) leaves every later click rejected with
   * "A transition is currently in progress" until a hard reload. The
   * watchdog puts a ceiling on that.
   */
  var WATCHDOG_MS = parseInt(settings.watchdogMs, 10) > 0 ? parseInt(settings.watchdogMs, 10) : 10000;

  var ProtoCore = class extends taxi.Core {
    createCacheEntry(page, url) {
      return super.createCacheEntry(stripInertMarkup(page), url);
    }

    /* Called from Taxi's constructor, after it has assigned onClick and
       onPrefetch and before either is delegated: the one place both can be
       wrapped so the exclusion predicate runs for every event. */
    attachEvents(selector) {
      var click = this.onClick;
      var prefetch = this.onPrefetch;

      this.onClick = function (e) {
        if (isExcludedLink(e.currentTarget)) return;
        return click.call(this, e);
      };
      this.onPrefetch = function (e) {
        if (isExcludedLink(e.currentTarget)) return;
        return prefetch.call(this, e);
      };

      super.attachEvents(selector);
    }

    navigateTo(url, transition, trigger) {
      /* data-* attributes pass KSES for every role, so an unknown (or
         prototype-key: "constructor") data-transition is content, not a
         developer error. Taxi would `new undefined` inside its Promise
         executor and leave isTransitioning stuck. */
      if (transition && !hasTransition(this, transition)) {
        console.warn('[proto-taxi] Unknown transition "' + transition + '", using the default.');
        transition = false;
      }

      var fresh = this.allowInterruption || !this.isTransitioning;
      var promise = super.navigateTo(url, transition, trigger);
      if (fresh) this.armWatchdog(promise);
      return promise;
    }

    armWatchdog(promise) {
      var self = this;
      self.disarmWatchdog();
      self.protoWatchdog = setTimeout(function () {
        self.protoWatchdog = null;
        if (!self.isTransitioning && !self.isPopping) return;
        console.error('[proto-taxi] Navigation did not finish within ' + WATCHDOG_MS +
          'ms; resetting the transition state so links keep working.');
        self.isTransitioning = false;
        self.isPopping = false;
      }, WATCHDOG_MS);

      promise.then(function () {
        self.disarmWatchdog();
      }, function (err) {
        /* This navigation was the only one in flight (see `fresh`), so its
           failure can release the lock straight away. */
        self.disarmWatchdog();
        self.isTransitioning = false;
        self.isPopping = false;
        console.error('[proto-taxi] Navigation failed; transition state reset.', err);
      });
    }

    disarmWatchdog() {
      if (this.protoWatchdog) {
        clearTimeout(this.protoWatchdog);
        this.protoWatchdog = null;
      }
    }
  };

  var core = new ProtoCore({
    links: LINKS,
    transitions: { default: ProtoFade },
    renderers: { default: ProtoRenderer },
    reloadCssFilter: isLiveStylesheet
    // reloadJsFilter is left at its default: only [data-taxi-reload] scripts
    // are re-run. inc/proto-taxi.php decides which tags carry it.
  });

  window.protoTaxi = {
    core: core,
    Transition: taxi.Transition,

    /**
     * Register a transition usable via <a data-transition="name">.
     *
     * @param {string} name
     * @param {Function} TransitionClass  extends window.taxi.Transition
     * @return {object} this, for chaining
     */
    addTransition: function (name, TransitionClass) {
      core.transitions[name] = TransitionClass;
      return this;
    },

    /** Same predicate Taxi's click and prefetch handlers consult. */
    isExcludedLink: isExcludedLink,

    /** The href substrings behind it; push to it to exclude more at runtime. */
    ignoreHrefPatterns: ignoreHrefPatterns
  };

  /* ----------------------------------------------------------------------
     Everything below is what Taxi does NOT do. Taxi sets document.title
     (Renderer.js:38) and nothing else outside the swapped view.
     ------------------------------------------------------------------- */

  var E = window.E;

  /**
   * The live region that announces navigations to screen readers. Created
   * here, at boot, before any navigation can occur: many screen readers
   * only pick up a live region if it already exists in the accessibility
   * tree before its content first changes, so creating it lazily inside
   * announce() (on the first NAVIGATE_END) would silently miss announcing
   * that first client-side navigation.
   */
  var announcer = document.createElement('div');
  announcer.className = 'proto-taxi-announcer';
  announcer.setAttribute('aria-live', 'polite');
  announcer.setAttribute('aria-atomic', 'true');
  document.body.appendChild(announcer);

  function liveView() {
    return document.querySelector('[data-taxi-view]');
  }

  function dispatch(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail: detail }));
  }

  /** Copy <body class> from the fetched document. */
  function syncBodyClass(page) {
    if (page && page.body) {
      document.body.className = page.body.className;
    }
  }

  /**
   * Replace the head tags that describe the page. Yoast and friends emit
   * these per-URL, so a stale set would report the wrong page to crawlers
   * and share sheets.
   */
  var HEAD_SELECTORS = [
    'meta[name="description"]',
    'link[rel="canonical"]',
    'meta[property^="og:"]',
    'meta[name^="twitter:"]'
  ].join(',');

  function syncHead(page) {
    if (!page || !page.head) return;

    var current = document.head.querySelectorAll(HEAD_SELECTORS);
    for (var i = 0; i < current.length; i++) {
      current[i].remove();
    }

    var incoming = page.head.querySelectorAll(HEAD_SELECTORS);
    for (var n = 0; n < incoming.length; n++) {
      document.head.appendChild(incoming[n].cloneNode(true));
    }
  }

  /**
   * The header template part never re-renders, so WordPress's
   * current-menu-item classes would stay pinned to the first page loaded.
   *
   * Compares origin as well as pathname: an external link (e.g. a footer
   * link to a sister site) whose path happens to match the current page's
   * path must not be marked current. `link.href` is a browser-resolved
   * absolute URL for a plain <a>. An SVG <a> element's `.href` is an
   * SVGAnimatedString rather than a string, but `new URL()` still accepts
   * it — it gets coerced to a string and resolves fine against this page's
   * https: origin (it only throws "Invalid URL" against an opaque base
   * like about:blank, which this function never uses) — so that is not a
   * throw risk here. This function is still wrapped in `safe()` at its
   * caller (see the NAVIGATE_IN handler below) as defense-in-depth, same
   * as every other sync step in this file — not because of a known bug in
   * this particular function. (For a real, verified example of the kind of
   * failure `safe()` guards against, see killScrollTriggersIn() below: a
   * ScrollTrigger whose trigger selector matched nothing leaves a bare
   * string where an Element is expected, and container.contains() on it
   * throws a TypeError.)
   */
  function syncNavState(url) {
    var target = new URL(url, window.location.href);
    var hereOrigin = target.origin;
    var here = target.pathname.replace(/\/+$/, '');
    var links = document.querySelectorAll('.wp-block-navigation a[href]');

    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      var parent = link.parentElement;
      var there = new URL(link.href, window.location.href);
      var isCurrent = there.origin === hereOrigin &&
        there.pathname.replace(/\/+$/, '') === here;

      link.classList.toggle('current-menu-item', isCurrent);
      if (isCurrent) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }

      if (parent && parent.classList.contains('wp-block-navigation-item')) {
        parent.classList.toggle('current-menu-item', isCurrent);
        parent.classList.toggle('current_page_item', isCurrent);
      }
    }
  }

  /** Keep the admin bar's "Edit" link pointing at the page being viewed. */
  function syncAdminBar(page) {
    var current = document.getElementById('wp-admin-bar-edit');
    if (!current || !page) return;

    var incoming = page.querySelector('#wp-admin-bar-edit');

    if (incoming) {
      var replacement = incoming.cloneNode(true);
      replacement.style.display = '';
      current.replaceWith(replacement);
      return;
    }

    // The incoming page has nothing editable (an archive or a 404), so a hard
    // load would render no Edit node. Hide it rather than remove it: this
    // function bails out when #wp-admin-bar-edit is absent, so removing the
    // node is irreversible — navigating back to an editable page could never
    // restore it. Hiding keeps the node addressable for that later navigation.
    current.style.display = 'none';
  }

  /**
   * Announce the new page and move focus into it, so a swap is not silent
   * for screen-reader and keyboard users. (announcer itself is created at
   * boot — see above.)
   */
  function announce(title) {
    announcer.textContent = title;
  }

  function focusView(container) {
    if (!container) return;
    container.setAttribute('tabindex', '-1');
    container.focus({ preventScroll: true });
  }

  /**
   * Hash of the link that started the current navigation, when it points at
   * another page ("/services/#fabrication" clicked anywhere but /services/).
   * Taxi resolves the fetch URL and writes it back with replaceState, which
   * drops the hash, and the fade's onEnter resets the scroll to 0; so the
   * target is scrolled to on NAVIGATE_END and the hash restored in the URL,
   * which is what a full page load would have done. Same-page hash links
   * never reach Taxi: proto-init.js scrolls them and stops the event.
   */
  var pendingHash = '';

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    pendingHash = '';
    if (!a || !a.hash) return;
    try {
      var url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname.replace(/\/+$/, '') === window.location.pathname.replace(/\/+$/, '')) return;
      pendingHash = url.hash;
    } catch (err) {
      pendingHash = '';
    }
  }, true);

  function landOnHash() {
    var hash = pendingHash;
    pendingHash = '';
    if (!hash || hash.length < 2) return;
    var target;
    try {
      target = document.getElementById(decodeURIComponent(hash.slice(1)));
    } catch (err) {
      return;
    }
    if (!target) return;
    if (window.history && typeof window.history.replaceState === 'function') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search + hash);
    }
    // Fixed header plus the target's scroll-margin-top (proto-init.js); the header alone on an older proto-init.
    var offset = typeof window.protoAnchorOffset === 'function' ? -window.protoAnchorOffset(target)
      : typeof window.protoHeaderOffset === 'function' ? -window.protoHeaderOffset() : 0;
    if (window.protoLenis) {
      window.protoLenis.scrollTo(target, { force: true, offset: offset });
    } else {
      window.scrollTo({ top: target.getBoundingClientRect().top + window.pageYOffset + offset, behavior: 'smooth' });
    }
  }

  /**
   * Kill only the ScrollTriggers whose trigger element lived inside the view
   * being removed. Triggers created by the persistent header/footer survive.
   *
   * kill(false) is required: ScrollTrigger's kill(revert, ...) forwards an
   * undefined `revert` by default, and its internal disable() treats
   * `undefined !== false` as truthy, so a bare kill() reverts — stripping
   * any tween-set inline style (e.g. a pre-reveal opacity: 0) from the
   * outgoing elements, popping them visible right as the fade-out starts.
   */
  function killScrollTriggersIn(container) {
    if (!window.ScrollTrigger || !container) return;

    var all = window.ScrollTrigger.getAll();
    for (var i = 0; i < all.length; i++) {
      // Guarded per iteration, not around the whole loop: a ScrollTrigger whose
      // selector matched nothing leaves a bare string in vars.trigger, and
      // container.contains(string) throws a TypeError. A single loop-level
      // try/catch would abandon every trigger after the bad one, leaking them
      // into the next page. Isolating each iteration means one malformed
      // trigger costs only itself.
      try {
        var trigger = all[i].trigger || all[i].vars.trigger;
        if (trigger && container.contains(trigger)) {
          all[i].kill(false);
        }
      } catch (err) {
        console.error('[proto-taxi] killScrollTriggersIn', err);
      }
    }
  }

  /**
   * @unseenco/e's bus (E.on/E.emit) runs every listener in a plain forEach
   * with no try/catch. An exception thrown here propagates out of E.emit
   * inside Taxi's afterFetch Promise executor, which rejects that promise —
   * so loadScripts(), renderer.enter() and NAVIGATE_END never run, and
   * isTransitioning is never reset. Every later link click then dies
   * silently. Guard each sync step individually so one bad block/link
   * cannot take the rest of navigation down with it.
   */
  function safe(label, fn) {
    try {
      fn();
    } catch (err) {
      console.error('[proto-taxi]', label, err);
    }
  }

  E.on('NAVIGATE_OUT', function (payload) {
    var container = payload && payload.from && payload.from.renderer
      ? payload.from.renderer.content
      : liveView();

    safe('killScrollTriggersIn', function () {
      killScrollTriggersIn(container);
    });

    safe('proto:page-leave dispatch', function () {
      dispatch('proto:page-leave', { container: container });
    });
  });

  /**
   * Links to this site's own host but on the other scheme (an `http://` menu
   * link on an `https://` page, typically a site whose stored URLs were
   * migrated by host only). Taxi compares hosts, so it treats such a link as
   * internal and starts the transition, but its same-origin fetch of the
   * other scheme is blocked as mixed content and the fallback is a full
   * page load: the curtain drops and the page then reloads. Pointing the link
   * at https keeps the transition on the fast path. Runs for the first
   * document and again for every swapped-in page.
   *
   * Upgrade only. On a page served over plain http an explicit https link
   * ("log in securely", checkout) is left as the author wrote it — a
   * downgrade would be the transition buying speed with the reader's
   * transport security.
   */
  function sameSchemeLinks(root) {
    if (window.location.protocol !== 'https:') return;
    var links = (root || document).querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (a.host === window.location.host && a.protocol === 'http:') {
        a.protocol = 'https:';
      }
    }
  }
  safe('sameSchemeLinks', function () { sameSchemeLinks(document); });

  E.on('NAVIGATE_IN', function (payload) {
    if (!payload || !payload.to) return;

    var page = payload.to.page;
    var url = payload.to.finalUrl || window.location.href;

    safe('syncBodyClass', function () { syncBodyClass(page); });
    safe('syncHead', function () { syncHead(page); });
    safe('syncAdminBar', function () { syncAdminBar(page); });
    safe('syncNavState', function () { syncNavState(url); });
  });

  E.on('NAVIGATE_END', function (payload) {
    var container = payload && payload.to && payload.to.renderer
      ? payload.to.renderer.content
      : liveView();

    safe('sameSchemeLinks', function () { sameSchemeLinks(document); });
    safe('focusView', function () { focusView(container); });
    safe('announce', function () { announce(document.title); });

    safe('resize', function () {
      /* The new content changed the document height; both libraries cache it. */
      if (window.protoLenis && typeof window.protoLenis.resize === 'function') {
        window.protoLenis.resize();
      }
      if (window.ScrollTrigger) {
        window.ScrollTrigger.refresh();
      }
    });

    safe('proto:page-ready dispatch', function () {
      dispatch('proto:page-ready', {
        container: container,
        url: window.location.href
      });
    });

    safe('landOnHash', landOnHash);
  });

  /* The initial page load gets the same event, so block code has exactly one
     contract to write against. */
  function readyOnLoad() {
    dispatch('proto:page-ready', {
      container: liveView(),
      url: window.location.href
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', readyOnLoad);
  } else {
    readyOnLoad();
  }
})();
