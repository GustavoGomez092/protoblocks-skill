# Changelog

## 2.3.5

- `navigation.mjs upsert`: page links are stored host-relative (`/about/`, via `wp_make_link_relative`) instead of the absolute permalink. A site moved to another host or scheme by a host-only search-replace kept `http://` menu links on an `https://` page; Taxi treated them as internal, its mixed-content fetch failed and every such click fell back to a full page load after the curtain had dropped. Re-run `upsert` for each menu to rewrite existing links.

## 2.3.4

- `navigation.mjs upsert`: a submenu parent with neither `page` nor `url` is a label-only toggle (no `href`), for designs whose top-level items with a dropdown are buttons rather than links. A leaf without `url` still gets `#`.

## 2.3.3

Docs only, from the O-Flex build.

- `protoblocks-section-loop/references/header-footer.md`: animating core's navigation drawer: own every layout property in both the open and closed states at higher specificity than core's `.is-menu-open` rules, place the panel below the admin bar when logged in, and prove the close with a computed-style diff.
- `protoblocks-section-loop/references/build.md`: editability rules the editor QA enforces (no `<a>` repeater rows, static authoring layout for hover-state blocks, editor wrappers around inner-blocks slots, rows editable only while the block is selected) and a class-naming rule (never a Tailwind utility prefix such as `pb-` on a shared class).
- `protoblocks-design-breakdown/references/intake.md`: read the design source's root font size (Figma Make bundles often use 14px) and set the fork's `html { font-size }` to match before tokens.

## 2.3.2

Page editor QA

- New `qa/editor-qa.mjs`: `run "$THEME" <page>` logs into wp-admin headlessly (Playwright) as a dedicated administrator `pb-editor-qa` (created through the resolved WP-CLI on first use, a random password regenerated per run and kept in memory, welcome guides off through `wp_persisted_preferences`; remove with `wp user delete pb-editor-qa --yes`), opens the page in the block editor and checks every Proto-Blocks block there: `isValid`, the canvas wrapper rendered without an error notice, every `block.json` field bound in the editor preview markup (repeater subfields included, `itemControls` excluded, whole-card/icon-only repeater links counting through the item toolbar), the inspector showing the block's title and a control panel when controls are declared, the state's sections present once and in order as top-level blocks with nothing extra, and `isEditedPostDirty()` false after opening and selecting. Writes `artifacts/<page>/editor-qa/editor-qa.json` plus `editor.png` / `inspector.png`. `record` writes `pages[i].editorQa` (never accepted).
- `run "$THEME" --parts` performs the same checks on the header and footer template parts in the Site Editor; `record --parts` writes `site.parts.editorQa`. The first page's `move-parts` flow runs it before page QA.
- A page now needs both page QA and editor QA before SEO: `page-qa.mjs record` no longer moves a page to `seo` on its own; `status.mjs` routes the new `page-editor-qa` action after page QA passed until `editorQa.pass`. Pages already `seo`/`done` from older builds are left alone.
- Docs: `page-editor-qa` in the site-builder action table and `references/pipeline.md` (commands, transitions, `[ELOGIN]` recovery), `editorQa` in the state schema, an "Editor check" section in the section loop's `build.md` pointing to the unbound-fields check.

Site setup

- `setup-site.mjs --logo <file>` (SVG or PNG) copies the client logo into the fork as `assets/img/logo.<ext>` (an SVG loses its xml prolog, comments and root `id`/`x`/`y`/`version`/`xml:space`) and records `site.theme.logo`. The fork now gets a short client README (logo, display name, "WordPress block theme for <project>, powered by Proto-Blocks") instead of inheriting proto-blocks-theme's: written on a fresh fork, or on an existing one with `--readme`; `site.theme.readmeHash` remembers what was written and a README edited since is refused with `[EEDITED]` (`--force` overwrites). The site-setup skill asks for the logo file in Step 1.

Motion

- `pb-motion.js` reveal presets wait for the theme's intro overlay: while `.proto-intro` is up they are queued and start together on `proto:intro-complete` (10 s backstop), so the hero entrance plays after the preloader instead of underneath it. Continuous presets are not gated; the motion check is unaffected (it skips the intro). The Proto-Blocks plugin's reveal watchdog waits too from plugin 2.14.1 (`protoblocks-motion` `references/presets.md`, "Hero and the intro overlay").
- `data-pb-duration` (seconds) overrides the profile duration per element; on `counter` it is the count time itself. The motion skill recommends exposing timing as block controls (`motionDuration`, `motionDelay`, `motionStagger`, `counterDuration`; 0 = profile default) merged into the preset options by the `$pb_motion` helper, keeping delay + duration under 1.4 s.

## 2.3.1

Navigation

- Menu spec items accept an optional `className` (letters, digits, `-`, `_`; several separated by spaces), written to the `core/navigation-link` / `core/navigation-submenu` block as `className`, so a highlighted entry such as a "See all services" link in a dropdown can be styled from the header block's CSS.

## 2.3.0

Site setup

- `setup-site.mjs --theme-name "<display name>"` sets the fork's `Theme Name:` and `Description:` (default: the project name) and is re-runnable on an existing fork: a later run with `--theme-name` renames the theme without re-forking. Recorded as `site.theme.displayName`. The site-setup and site-builder skills ask for the display name when it differs from the project name.
- Theme screenshot: `theme-screenshot.mjs "$THEME" <page>` crops the top of the page's desktop frame (full width, 4:3) to `$THEME/screenshot.png` at 1200x900 and records `site.theme.screenshot`. It runs right after the first page's frames are intaken, before tokens; `status.mjs` treats setup as unfinished until it exists.
- Per-site block category: the fork's `functions.php` filters `proto_blocks_category_slug` / `proto_blocks_category_title` are rewritten to the theme slug and "<display name> blocks" (`--category-title` overrides), recorded as `site.theme.category`. Block scaffolding uses that slug and the build gates check every `block.json` `"category"` against it (falling back to `proto-blocks` when state has none).

Full-bleed sections

- The managed `pb-shell.css` lifts the base theme's 1440px cap and side gutters from `main`: every Proto-Blocks section is a full-bleed band with its own inner container, so pages span any viewport width. The "Shell cap" guidance (raising `max-width: 1440px` in the fork's `style.css` for wider frames) is gone; `notes.shellCap` in old builds is tolerated.
- Visual QA adds the `wide` sanity breakpoint (1920px, no design frame): a section narrower than the viewport fails `widthDelta`/`numericPass`. Page QA runs a 1920px wide pass and fails the page (`wide.boxed`) when any section does not span the viewport; such a failure cannot be accepted as a design difference.

## 2.2.1

Previous release (see the git history).
