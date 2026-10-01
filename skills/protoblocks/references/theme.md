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

**Block scripts:**
- `view.js` enqueued with a handle starting `proto-blocks-` is stamped `data-taxi-reload` and **re-runs automatically** on every navigation. Plain IIFE blocks need no changes.
- `viewScriptModule` / Interactivity API modules do **NOT** re-run (ES modules evaluate once per URL; core Interactivity blocks like the image lightbox also go inert after a swap). Use the events below, or add the route to `proto_taxi_ignore_urls`.

**Events** (dispatched on `document`):
```js
document.addEventListener('proto:page-ready', (e) => {
  // fires on initial load AND after every navigation
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
| `proto_taxi_reload_handles` | Extra script handles (beyond `proto-blocks-` prefix) to mark `data-taxi-reload`. |
| `proto_taxi_denied_handles` | Handles never re-run (theme runtime scripts by default); wins over the prefix. |
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
