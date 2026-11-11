# proto-blocks-theme (starter theme)

Source: https://github.com/GustavoGomez092/proto-blocks-theme (v1.1.3 verified). A batteries-included block-theme starter for Proto-Blocks: neutral Tailwind tokens, vendored animation libraries, a builder-canvas page editor, Taxi page transitions, WP Engine deploy workflows. Designed to be **forked once per project**: change tokens, drop blocks into `proto-blocks/`, replace the intro Lottie and favicon, wire deploy workflows.

**Requirements:** WordPress 6.9+, PHP 8.0+, Proto-Blocks plugin.

## Required plugins (TGMPA prompt on activation)

| Plugin | Status |
|---|---|
| Safe SVG | Required |
| Yoast SEO | Required |
| Yoast Duplicate Post | Required |
| Proto-Blocks (from GitHub release) | Required |
| Wordfence Security | Recommended |

The theme resolves the Proto-Blocks zip via `proto_protoblocks_zip_url()` (`inc/proto-required-plugins.php`) using GitHub `/releases/latest`, cached 12h in a transient (`wp transient delete proto_protoblocks_zip_url` to refresh). Before the next plugin release, `/releases/latest` can return a stale tag with an older zip; download the highest `vX.Y.Z` release explicitly (fixed in the next release: the release workflow marks the newest version as latest).

## Layout

```
templates/{index,page,single}.html   all wrap <main> in the Taxi wrapper
parts/{header,footer}.html           outside the wrapper
proto-blocks/                        your blocks (auto-discovered)
tailwind-theme.css                   @theme design tokens
theme.json
scripts/                             vendored gsap, SplitText, ScrollTrigger, lottie, lenis, taxi, proto-init/intro/taxi
inc/                                 TGMPA plugin list, Taxi PHP integration
```

## Builder canvas

All **Pages** use `page.html`. The title input is hidden from the canvas so blocks fill the viewport; the title lives in the **"Page Title" panel** in the document sidebar (still drives slug, menus, SEO title). Posts and other post types are unaffected. Switch a page's template to opt out.

## Taxi page transitions

Same-origin links swap `<main>` in place; header, footer, Lenis and the intro overlay persist. Default is a GSAP fade; `prefers-reduced-motion` makes it an instant swap. **Pretty permalinks are required** (Settings > Permalinks > Post name).

**Markup requirement** (already in the three templates; without it transitions disable and a console warning is logged):
```html
<div data-taxi>
  <div data-taxi-view>
    <!-- wp:group {"tagName":"main", ...} --> ... <!-- /wp:group -->
  </div>
</div>
```
Template parts stay outside. Plugin-supplied templates (e.g. WooCommerce product pages) lack the wrapper: override them or add the URLs to `proto_taxi_ignore_urls`.

**Scripts after a swap** (theme 1.6.0+, `docs/script-reloading.md` upstream): nothing in the fetched page runs unless its tag carries `data-taxi-reload`. The theme's loader (`scripts/proto-taxi.js` `reloadScripts()`, Taxi's own loader is off) re-runs the marked tags in document order: files fetched in parallel (preload hints the moment the HTML arrives, prefetch on hover) and executed in order, an inline script after every file printed before it; the new view stays `inert` and hidden until they settled (4 s cap). Two modes:
- `data-taxi-reload` = **rerun** on every navigation: a block's `view.js` (handle `proto-blocks-{name}`, stamped by default; plain IIFEs need no change but must be idempotent: bind `document` listeners once behind a flag, clean up on `proto:page-leave`). Inline tags (localized data, a nonce, per-form init) always re-run.
- `data-taxi-reload="once"` = **once**: loaded when the document does not hold it yet, then kept (jQuery, a form plugin's runtime). Matched by the `{handle}-js` id; the same id with another `src` (a deploy changed the file) loads the page in full.
- Opt a plugin in with `proto_taxi_reload_rules` (handle or prefix, `mode`, `deps` walks the dependency chain; conflicts resolve to once; `jquery*`/`wp-polyfill` are never rerun). Raw inline tags a plugin prints go through the plugin's own output filter, a comparison with its source in `wp_inline_script_attributes`, or (last resort) `proto_taxi_reload_inline_patterns`; shortcode output through `do_shortcode_tag`. Only first-party/functional scripts get rules: clones are marked `data-cookieconsent="ignore"` unless the tag they replace was consent-blocked, which stays blocked.
- Gravity Forms works out of the box (`inc/proto-gravity-forms.php`: `gform_` once with deps, its own filters stamp the per-form scripts, a `gform.domLoaded` shim, namespaced `gform_post_render` handlers). Use it as the template for another plugin.
- `viewScriptModule` / Interactivity API modules do **NOT** re-run (ES modules evaluate once per URL; core Interactivity blocks like the image lightbox also go inert after a swap). Use the events below, or add the route to `proto_taxi_ignore_urls`.

**Events** (dispatched on `document`, both with `{ container, url }`):
```js
document.addEventListener('proto:scripts-ready', (e) => {
  // the new page's marked scripts have executed (not on initial load)
});
document.addEventListener('proto:page-ready', (e) => {
  // fires on initial load AND after every navigation, after scripts-ready
  init(e.detail.container); // the [data-taxi-view] element; e.detail.url = new page URL
});
document.addEventListener('proto:page-leave', (e) => {
  teardown(e.detail.container); // only { container }
});
```
The theme itself kills ScrollTriggers whose trigger lived inside the leaving container; do not duplicate that.

**Custom transition:** `window.protoTaxi.addTransition('slide', class extends window.protoTaxi.Transition { onLeave({from, done}){...done()} onEnter({to, done}){...done()} })`, then `<a href="/about" data-transition="slide">`. `window.protoTaxi` also exposes `core` (`navigateTo`, `preload`, `addRoute`).

**Links not intercepted:** admin bar, wp-admin/wp-login, `mailto:`/`tel:`, `[download]`, hash-only, `[target]`, `[data-taxi-ignore]`, WooCommerce add-to-cart. Forms always do a full page load.

**PHP filters:**

| Filter | Purpose |
|---|---|
| `proto_taxi_enabled` | Master switch (always false in wp-admin and JSON requests). |
| `proto_taxi_reload_rules` | Script reload rules: `['prefix' => 'gform_', 'mode' => 'once', 'deps' => true]` or `['handle' => …]`; mode `rerun` (default) or `once`. |
| `proto_taxi_reload_handles` | Legacy: extra handles re-run every navigation (a `rerun` rule without deps). |
| `proto_taxi_reload_inline_patterns` | Substrings marking inline scripts printed via `wp_get_inline_script_tag` for re-run (last resort). |
| `proto_taxi_once_only_handles` | Never rerun whatever rule reaches them (`jquery`, `jquery-core`, `jquery-migrate`, `wp-polyfill`). |
| `proto_taxi_denied_handles` | Handles never re-run (theme runtime scripts by default); wins over every rule. |
| `proto_taxi_ignore_urls` | URLs whose links get `data-taxi-ignore` (WooCommerce cart/checkout/account/shop by default). |

Known behaviour: Back/Forward pressed during the ~0.9s fade is dropped (stock Taxi, `allowInterruption: false`). Do not enable `allowInterruption`.

## Animation globals

Self-hosted, enqueued by the theme (no bundling needed in blocks):

| Global | Library | Version |
|---|---|---|
| `window.gsap` | GSAP Core | 3.15.0 |
| `window.SplitText` | GSAP SplitText | 3.15.0 |
| `window.ScrollTrigger` | GSAP ScrollTrigger | 3.15.0 |
| `window.lottie` | lottie-web (light) | 5.13.0 |
| `window.Lenis` | Lenis | 1.1.13 |
| `window.protoLenis` | the shared Lenis instance created by `scripts/proto-init.js` | n/a |

Pause smooth scroll with `window.protoLenis.stop()` / `.start()`. (The theme README up to v1.1.3 wrongly says `window.__protoLenis`; the code uses `window.protoLenis`. Fixed in the next theme release, PR #5.)

## Design tokens

`tailwind-theme.css` holds one `@theme {}` block read by Proto-Blocks' Tailwind compiler. Shipped: neutral ramp (`--color-ink`, `--color-gray-900/700/500/300/100`, `--color-paper`), placeholder `--color-accent: #2563eb`, `--font-sans`, `--font-display`. Names become utilities (`--color-accent` -> `bg-accent`/`text-accent`, `--font-display` -> `font-display`). There are **no `primary-*`/`secondary-*` tokens**: add them if blocks use those classes. Reload open editor tabs after edits.

## Intro overlay and favicon

The intro overlay plays once per browser session (`sessionStorage` key `protoIntroShown`) via `scripts/proto-intro.js`, playing the Lottie at `assets/lottie/intro.json` (swap the file; size via `.proto-intro__lottie`). Disable by removing the `wp_body_open` hook and `wp_head` script in `functions.php`. The favicon is `assets/img/favicon.svg`, registered by the theme (bypasses the Customizer); replace the file.

## Upcoming (pending release)

Unverified until released: a pending feature PR (`feat/yoast-jsonld`) adds a "JSON-LD" panel to Yoast's editor UI, stores the data in post meta `_proto_jsonld`, and merges it into Yoast's schema graph. Not in v1.1.3.
