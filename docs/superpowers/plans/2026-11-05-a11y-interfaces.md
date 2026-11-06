# Accessibility verification 2.6.0 — interface contract

Binding for every track. Spec: the developer's request (reproduced in `docs/superpowers/specs/2026-11-05-a11y-design.md`).
Repo: protoblocks-skill, branch `feat/a11y-verification`, version 2.5.0 → 2.6.0.

## Ownership

- **Track A (code):** `skills/protoblocks-site-builder/scripts/qa/a11y.mjs` (new), `page-qa.mjs`, `site-a11y.mjs` (new),
  `tests/unit/a11y.test.mjs` (new), `tests/unit/page-qa.test.mjs`, `tests/qa/a11y.test.mjs` (new), `tests/qa/page-qa.test.mjs`,
  `tests/qa/fixtures/a11y-*.html` (new), `scripts/qa/package.json` only if a dependency is needed (none expected).
- **Track B (docs):** every `.md` under `skills/`, `CHANGELOG.md`, `README.md` if it lists scripts, `.claude-plugin/plugin.json`,
  `.claude-plugin/marketplace.json`, `tests/unit/release.test.mjs` (version assertion), `tests/unit/skill-docs.test.mjs` only if a
  limit table needs the new script listed. Track B never edits `.mjs` under `scripts/`.

## `scripts/qa/a11y.mjs` exports (Track A)

```js
export const A11Y_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa', 'best-practice'];
export const BLOCKING_IMPACTS = ['serious', 'critical'];
// Moderate rules that block anyway; one comment per rule saying which oflex finding it catches.
export const BLOCKING_RULES = ['landmark-unique', 'landmark-no-duplicate-main', 'landmark-main-is-top-level', 'heading-order', 'region'];
export const SKIP_LINK_SELECTOR = '#wp-skip-link'; // core's skip link: a `region` node on it is info, never blocking

// {blocking, other}. Unchanged first-argument behaviour (scope via node.inScope or the selector fallback).
// `blockingRules` replaces BLOCKING_RULES (site.qa.a11yBlocking). A `region` node whose target is #wp-skip-link (or inside
// it) is moved to `other` with impact 'info'. Every kept violation is trimmed with trimViolation.
export function filterViolations(violations, { blockingRules = BLOCKING_RULES } = {});

// {id, impact, help, helpUrl, tags, nodes: up to 5 × {target, html (≤120 chars), inScope?}}
export function trimViolation(v);

// Runs AxeBuilder on an open Playwright page: withTags(tags), optional .include(include) (a CSS selector string), resolves
// inScope for every node like page-qa did (main/header/footer/[id^=pb-s] or html/body; with `include` set, inScope = inside it),
// then filterViolations. Returns {blocking, other, tagsUsed: tags}.
export async function runAxe(page, { tags = A11Y_TAGS, blockingRules = BLOCKING_RULES, include = null } = {});

// One page.evaluate; whole document minus #wpadminbar (or the `root` selector's subtree when given). Returns a list of
// {id, impact: 'serious', help, helpUrl: null, nodes: [{target, html}]} — same shape as a trimmed axe violation — with ids:
//   tab-outside-tablist      [role=tab] not a descendant of a [role=tablist] (aria-owns does not count)
//   tabpanel-unlabelled      [role=tabpanel] without aria-labelledby pointing at an existing [role=tab]
//   tabpanel-in-tablist      [role=tabpanel] inside a [role=tablist]
//   anchor-without-href      <a> without href, unless role="button" and tabindex="0"
//   role-img-misplaced       role="img" on anything but svg/img/canvas, or on an element with child elements, or with no accessible name
//   multiple-main            more than one <main> (or [role=main])
//   nested-nav               <nav> (or [role=navigation]) inside another
//   nav-too-few-links        a nav landmark with fewer than 2 <a href> (links inside a role=group wrapper still count for the nav)
//   heading-skip             a heading more than one level deeper than the previous one in document order; nodes = the two headings
// `root` restricts every check to that subtree (check-section); heading-skip then compares inside the subtree only.
export async function patternChecks(page, { root = null } = {});

// Merges per-viewport results by rule id + first target: {blocking, other, byViewport: [{name, width, blocking: [ids], other: [ids]}]}.
// A merged violation carries `viewports: [names]` and the union of nodes (still ≤5).
export function mergeViewports(results /* [{name, width, blocking, other}] */);

// The post-navigation pass. Opens `url` at `width`, finds the first <header> link that is same-origin, has a different
// pathname (trailing slash ignored), is not hash-only and not mailto/tel/download, clicks it, waits for `proto:page-ready`
// (fallback: `load` when document has no [data-taxi]), then runAxe + patternChecks + the aria-current check:
//   must:  every header/footer <a href> whose URL has no hash and whose pathname equals location.pathname has aria-current="page"
//   never: any other header/footer link, and any link whose href has a hash, has aria-current="page"
// Returns {skipped: false, from, to, blocking, other, patterns, ariaCurrent: {pass, missing: [targets], stale: [targets], hash: [targets]}, pass}
// or {skipped: true, warning} when [data-taxi] is absent (warning: "theme has no Taxi") or no candidate link exists.
// `pass` = no blocking, no patterns, ariaCurrent.pass.
export async function afterNavigation({ browser, openPage, url, width, tags, blockingRules });

// Everything page QA needs for one page: axe at every width in `widths` (deduped, in order), patterns once at widths[0],
// afterNavigation at widths[0]. Returns the full `a11y` object below (never throws for axe failures: sets `error`).
export async function a11yForPage({ browser, openPage, url, widths, blockingRules, navigation = true });

// Strings for acceptBlockers / record refusal: blocking violations, patterns, afterNavigation blocking/patterns/ariaCurrent, error.
export function a11yBlockers(a11y);

// check-section: axe with include `#anchor` + patternChecks({root: '#anchor'}) at `width` (default 1440).
export async function checkSectionA11y({ url, anchor, width = 1440, browser, blockingRules });
```

CLI (`a11y.mjs`): `node a11y.mjs check-section <url> <anchor> [--width N]` prints `{url, anchor, width, blocking, other, patterns, pass}`,
exits 1 unless pass, 64 on usage. `anchor` must match `/^[A-Za-z][A-Za-z0-9_-]*$/`.

## `a11y` object in page-qa.json (Track A → Track B documents it)

```json
"a11y": {
  "blocking": [ { "id": "landmark-unique", "impact": "moderate", "help": "…", "helpUrl": "…", "tags": ["best-practice"], "viewports": ["desktop","mobile"], "nodes": [{ "target": ["header nav nav"], "html": "<nav aria-label=\"Primary\">…", "inScope": true }] } ],
  "other":    [ { "id": "region", "impact": "info", "...": "the #wp-skip-link node only" } ],
  "byViewport": [ { "name": "desktop", "width": 1440, "blocking": ["landmark-unique"], "other": ["region"] } ],
  "patterns": [ { "id": "nested-nav", "impact": "serious", "help": "…", "helpUrl": null, "nodes": [{ "target": ["header nav nav"], "html": "…" }] } ],
  "afterNavigation": { "skipped": false, "from": "http://…/", "to": "http://…/about/", "blocking": [], "other": [], "patterns": [], "ariaCurrent": { "pass": true, "missing": [], "stale": [], "hash": [] }, "pass": true },
  "tagsUsed": ["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22a","wcag22aa","best-practice"],
  "error": "only when axe could not run"
}
```

`afterNavigation` is `{ "skipped": true, "warning": "…" }` when the theme has no Taxi or the header has no same-site link to another page; a skip never fails the page (the warning is also pushed to `warnings`).

page-qa `pass` additionally requires `a11y.patterns` empty and `a11y.afterNavigation.pass !== false`.
`page-qa.mjs record --accepted` refuses (`[EACCEPT]`) with every string from `a11yBlockers(a11y)`.
`buildInputs` passes `qa.a11yBlocking` (array of rule ids, optional) through `qa`; `pageQa` uses it as `blockingRules`.
Widths: every frame width (`frames.map(f => f.width)`, deduped).

## `scripts/qa/site-a11y.mjs` (Track A)

`node site-a11y.mjs run <themeDir> [--out file]`: every page in state with a `url`, plus the 404 probe `<site.url>/__pb-404-probe__`
(slug `__404__`), each through `a11yForPage` at the site's frame widths (the union of every page's design frame widths; 1440 and 390 when none).
Prints `{pages: [{slug, url, status (HTTP), blocking, other, patterns, afterNavigation, pass}], pass, file}`; `pass` = every page passes
(the 404 probe must answer 404 and still pass a11y). Saved to `--out` or `$THEME/.protoblocks/artifacts/site-a11y.json`. Exit 1 unless pass.
`site.qa.a11yBlocking` applies here too. `[ENOTHEME]`/`[EINPUT]` like the other scripts.

## State (Track B documents, Track A reads)

`site.qa.a11yBlocking`: optional array of axe rule ids that replaces the built-in moderate blocking list
(`landmark-unique`, `landmark-no-duplicate-main`, `landmark-main-is-top-level`, `heading-order`, `region`). Serious/critical always block.
Only the developer may set it (the "never lower QA thresholds" rule covers it).

## Flow (Track B)

- `ask-more-pages`, when the developer says no more pages: first `node "$PB/qa/site-a11y.mjs" run "$THEME"`; a failing page is fixed through
  the section loop exactly like a page-QA content failure (point to the `page-qa` fix list, do not duplicate the loop), then re-run the site
  pass; only then the final report. Final report item 5 lists remaining `other` items per page and states the site pass passed.
- Section loop Verify: after the visual verdict passes, `node "$PB/qa/a11y.mjs" check-section <url> <anchor>` must pass before the
  section is recorded; failures are fixed as build fixes.
- `templates.md` "Accessibility conventions" and the `recipes.md` tabs recipe per the spec.

## Fixtures (Track A, `tests/qa/fixtures/`)

- `a11y-oflex-bad.html`: header with `<nav aria-label="Primary"><nav class="wp-block-navigation">…</nav></nav>`, footer with three
  `<nav>` of 2–3 links, main with h1 then an h3, a logo carousel with 8×8px dot `<button>`s, a tabs block with tab buttons outside the
  tablist using aria-owns and panels interleaved, a dropdown parent `<a>` without href, `<div role="img"><svg>…</svg></div>`,
  `<a id="wp-skip-link" class="skip-link" href="#main">`.
- `a11y-oflex-fixed.html`: the same page fixed (div wrapper, one `<nav aria-label="Footer">` with `role="group"` columns, 24px dots,
  tablist-contained tabs, `<button>` dropdown parent, role=img on the svg). Expected: pass, `other` = only `region` on `#wp-skip-link` as info.
- `a11y-taxi.html`: a fake Taxi like `motion-taxi.html` with a header nav of two pages (`/` and `?page=about` or a path the fixture
  server can answer), `?sync=1` runs a `syncNavState` copy on NAVIGATE_IN, without it aria-current stays on the old link; a footer
  `href="#cookie-settings"` link. Expected: stale fails `afterNavigation.ariaCurrent`, synced passes.
