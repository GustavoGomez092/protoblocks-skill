---
name: protoblocks-design-breakdown
description: Use when a design (image, screenshot, PDF page, Figma frame, Penpot board, or live URL) must be turned into a plan of Proto-Blocks sections for a WordPress page - normalizes frames, segments and crops sections, maps each to reuse/extend/new blocks against the theme's block library, and gets the developer's approval. Normally invoked by protoblocks-site-builder.
---

# Proto-Blocks Design Breakdown

Turns one design into an approved section plan stored in the build state. It builds nothing; the section loop builds after approval. Preconditions: preflight passed and `protoblocks-site-setup` ran (theme fork and build state exist).

## Scripts

```bash
PB="${CLAUDE_SKILL_DIR}/../protoblocks-site-builder/scripts"
```

`THEME` is the forked theme directory, `<site.path>/wp-content/themes/<site.theme.slug>` (the `theme.themeDir` that `setup-site.mjs` printed). The state file is `$THEME/.protoblocks/build.json`; read it first with `node "$PB/lib/state.mjs" get "$THEME"`. Tools print JSON on stdout; failures print `[CODE] message` on stderr (64 = bad usage). A page `<page>` slug is lowercase letters, digits and dashes.

## Step 1 - Intake to frames

Get one PNG per breakpoint, then register it. Read `references/intake.md` for the exact calls per source (image/PDF, Figma, Penpot, URL, MCP down, assets).

```bash
node "$PB/lib/intake.mjs" add-frame "$THEME" <page> desktop frame-desktop.png [--width W] [--title "Home"]
node "$PB/lib/intake.mjs" from-url "$THEME" <page> https://example.com --widths 1440,390
```

The desktop frame is required; tablet and mobile are optional. `[ESCALE]` means the width fits no 1x/2x/3x scale: ask the developer for the frame's CSS width once and pass `--width`. If the desktop width is above 1440, raise the theme shell cap first (intake.md, "Shell cap").

## Step 2 - Segment

```bash
node "$PB/qa/segment.mjs" analyze "$THEME/.protoblocks/artifacts/<page>/design/desktop.png"
```

Output: `{width,height,cuts,bands}`. `background` cuts (colour change) are strong boundaries; `gap` cuts (empty rows inside one band) are candidates only. A band with `bg: null` (cut `to: null`) is a photo or gradient band: no gap candidates inside it, so read it by eye. Open the frame image and confirm every band visually. Header and footer are the first and last bands (logo + nav; legal + links). Map mobile bands to desktop sections by order and content. Write `ranges.json` in image pixels (frame pixels, not CSS px), one entry per section with the same `n` across breakpoints, then crop:

```json
{"desktop":[{"n":1,"y0":0,"y1":96},{"n":2,"y0":96,"y1":820}],"mobile":[{"n":1,"y0":0,"y1":72},{"n":2,"y0":72,"y1":1500}]}
```
```bash
node "$PB/lib/intake.mjs" crop "$THEME" <page> ranges.json
```

Crops land in `artifacts/<page>/crops/<bp>/pb-s<n>.png` and each section is created in state (`status: planned`, `anchor: pb-s<n>`, `crops.<bp>`).

## Step 3 - Model each section

Follow `references/breakdown.md`: pattern label, content model (fewest richest regions; repeater vs gallery vs wysiwyg vs inner-blocks, see the `protoblocks` skill `references/composition.md`), variants.

## Step 4 - Match the library

```bash
node "$PB/lib/library.mjs" list "$THEME"
```

Prints one entry per block: `slug, title, description, fields, controls, innerBlocks, purpose, variants, usedOn`. An entry with an `error` is a broken block that still exists: never recreate it; tell the developer. Decide per section: `reuse` (fits as is), `extend` (additive controls only), `new`. Apply intra-page merge and generic naming (breakdown.md). Header and footer map to the shared `site-header`/`site-footer` blocks and template parts, built through the section loop; the parts flow is in `protoblocks-site-setup` Step 4. On later pages they are `reuse` and only verified.

## Step 5 - Plan gate (mandatory)

Present this table, with crop paths, then STOP and wait for approval:

`| # | Section | Crop | Decision | Block | Fields / controls | Notes |`

Also list assets that will be cropped from the design ("replace with originals"). Do not write the plan as approved before the developer says so. Pages are indexed in `pages` (`node "$PB/lib/state.mjs" get "$THEME" pages` shows the order); sections are ordered by `n`, so section `n` is at index `n-1`.

After approval, record each section (one `set` per field; JSON values, strings quoted), then the approval, then the page status, in that order:

<!-- test:run -->
```bash
node "$PB/lib/state.mjs" set "$THEME" pages.0.sections.0.label '"Hero"'
node "$PB/lib/state.mjs" set "$THEME" pages.0.sections.0.decision '"new"'
node "$PB/lib/state.mjs" set "$THEME" pages.0.sections.0.block '"hero-split"'
node "$PB/lib/state.mjs" set "$THEME" pages.0.sections.0.notes '"Image right, CTA pair"'
node "$PB/lib/state.mjs" set "$THEME" pages.0.plan "{\"approvedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"by\":\"developer\"}"
node "$PB/lib/state.mjs" set "$THEME" pages.0.status '"building"'
```

For many sections or notes with quotes, use one atomic write from a `plan.json` (`references/breakdown.md`, "Recording the plan"). Never `set` page status `building` without `plan.approvedAt`. `[EINVALID]` or `[EVALUE]` means nothing was written: fix the value and retry.

## Iron rules

- Never build before approval; never mark a plan approved on the developer's behalf.
- Never name blocks after pages (`home-hero`); names are generic.
- Never extend a block so existing instances render differently.
- Copy text exactly from structured sources (Figma, Penpot, URL); never paraphrase design copy. From images, transcribe and flag unreadable text.
- Pass design copy to WordPress only through the scripts (`media.mjs --alt`, page build); never as a free-text positional argument to WP-CLI.

## References

- `references/intake.md` - per-source intake, assets, masks, shell cap.
- `references/breakdown.md` - patterns, band rules, decision rules, naming, plan format, recording the plan.
