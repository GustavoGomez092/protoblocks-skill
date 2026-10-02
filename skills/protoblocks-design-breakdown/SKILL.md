---
name: protoblocks-design-breakdown
description: Use when a design (image, screenshot, PDF page, Figma frame, Penpot board, or live URL) must be turned into a plan of Proto-Blocks sections for a WordPress page - normalizes frames, segments and crops sections, maps each to reuse/extend/new blocks against the theme's block library, and gets the developer's approval. Normally invoked by protoblocks-site-builder.
---

# Proto-Blocks Design Breakdown

Turns one design into an approved section plan stored in the build state. It builds nothing; the section loop builds after approval. Preconditions: preflight passed and `protoblocks-site-setup` ran (theme fork and build state exist).

## Scripts

Shell variables do not persist between Bash commands. Start every command with `PB="${CLAUDE_SKILL_DIR}/../protoblocks-site-builder/scripts"; THEME="<fork dir>";` (literal paths), or use full paths.

`THEME` is the forked theme directory, `<site.path>/wp-content/themes/<site.theme.slug>` (the `theme.themeDir` that `setup-site.mjs` printed). The state file is `$THEME/.protoblocks/build.json`; read it first with `node "$PB/lib/state.mjs" get "$THEME"`. Failures print `[CODE] message` on stderr (64 = bad usage). A page `<page>` slug is lowercase letters, digits and dashes.

## Step 1 - Intake to frames

Get one PNG per breakpoint, then register it. Read `references/intake.md` for the exact calls per source (image/PDF, Figma, Penpot, URL, MCP down, assets).

```bash
node "$PB/lib/intake.mjs" add-frame "$THEME" <page> desktop frame-desktop.png [--width W] [--title "Home"]
node "$PB/lib/intake.mjs" from-url "$THEME" <page> https://example.com --widths 1440,390
```

The desktop frame is required; tablet and mobile are optional. `[ESCALE]` means the width fits no 1x/2x/3x scale: ask the developer for the frame's CSS width once and pass `--width`. If the desktop width is above 1440, raise the theme shell cap first (intake.md, "Shell cap").

## Step 2 - Segment

Analyze the frame file recorded in state (JPEG frames keep `.jpg`; never assume `desktop.png`):

```bash
FRAME=$(node "$PB/lib/state.mjs" get "$THEME" pages | node -e 'const a=JSON.parse(require("fs").readFileSync(0,"utf8"));const p=a.find((x)=>x.slug===process.argv[1]);console.log(p.design.frames.find((f)=>f.breakpoint===process.argv[2]).image)' <page> desktop)
node "$PB/qa/segment.mjs" analyze "$FRAME"
```

Output: `{width,height,cuts,bands}`. `background` cuts (colour change) are strong boundaries; `gap` cuts are candidates only. A band with `bg: null` is a photo or gradient band: read it by eye. Open the frame and confirm every band. Header and footer are the first and last bands; mark them `"part":"header"` / `"part":"footer"` (they get the fixed anchors `pb-header` / `pb-footer`). Map mobile bands to desktop sections by order and content. Write `ranges.json` in frame pixels, the same `n` across breakpoints, then crop:

```json
{"desktop":[{"n":1,"y0":0,"y1":96,"part":"header"},{"n":2,"y0":96,"y1":820}],"mobile":[{"n":1,"y0":0,"y1":72,"part":"header"},{"n":2,"y0":72,"y1":1500}]}
```
```bash
node "$PB/lib/intake.mjs" crop "$THEME" <page> ranges.json
```

Crops land in `artifacts/<page>/crops/<bp>/<anchor>.png`; each section is created in state (`status: planned`, `anchor` `pb-s<n>`, or `pb-header`/`pb-footer`, `crops.<bp>`).

## Step 3 - Model each section

Follow `references/breakdown.md`: pattern label, content model (fewest richest regions; repeater vs gallery vs wysiwyg vs inner-blocks, see the `protoblocks` skill `references/composition.md`), variants.

## Step 4 - Match the library

```bash
node "$PB/lib/library.mjs" list "$THEME"
```

Prints one entry per block: `slug, title, description, fields, controls, innerBlocks, purpose, variants, usedOn`. An entry with an `error` is a broken block that still exists: never recreate it; tell the developer. Decide per section: `reuse` (fits as is), `extend` (additive controls only), `new`. Header and footer map to the shared `site-header`/`site-footer` blocks: built as sections on the first page, then moved into the template parts (`protoblocks-section-loop` `references/header-footer.md`). On later pages they are `reuse`, rendered by the parts, and only verified.

## Step 5 - Plan gate (mandatory)

Present this table, with crop paths, then STOP and wait for approval:

`| # | Section | Crop | Decision | Block | Fields / controls | Notes |`

Also list assets that will be cropped from the design ("replace with originals"). Look pages up by `slug` and sections by `n`; never assume a position (`n` need not be contiguous, and other pages may exist).

After approval, record the whole plan in one atomic, validated write (`plan.mjs record` looks the page up by slug and sections by `n`; a missing section throws before anything is saved). Header/footer rows carry `part`:

<!-- test:run -->
```bash
cat > "$THEME/.protoblocks/plan.json" <<'JSON'
{
  "page": "home",
  "sections": [
    {"n": 1, "label": "Header", "decision": "new", "block": "site-header", "part": "header", "notes": "shared part; sticky"},
    {"n": 3, "label": "Hero", "decision": "new", "block": "hero-split", "notes": "Image right; \"Book a demo\" button"}
  ]
}
JSON
node "$PB/lib/plan.mjs" record "$THEME" "$THEME/.protoblocks/plan.json"
node "$PB/lib/state.mjs" validate "$THEME"
```

It sets `plan.approvedAt`, page status `building`, and the fixed anchors. On a later page, header/footer already live in the template parts: plan them `reuse` (anything else is `[EPLAN]`); they are recorded `inPart: true` (see `references/breakdown.md`).

Secondary, for a single field: find the indexes first, then `set` (JSON values, strings quoted). Never `set` page status `building` without `pages.<i>.plan`:

<!-- test:run -->
```bash
PI=$(node "$PB/lib/state.mjs" get "$THEME" pages | node -e 'const a=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(a.findIndex((p)=>p.slug===process.argv[1]))' home)
SI=$(node "$PB/lib/state.mjs" get "$THEME" "pages.$PI.sections" | node -e 'const a=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(a.findIndex((x)=>x.n===Number(process.argv[1])))' 3)
node "$PB/lib/state.mjs" set "$THEME" "pages.$PI.sections.$SI.notes" '"Image right, CTA pair"'
```

An index of `-1` means the slug or `n` is not in state: stop and fix that first. `[EINVALID]` or `[EVALUE]` means nothing was written: fix the value and retry.

## Iron rules

- Never build before approval; never mark a plan approved on the developer's behalf.
- Never name blocks after pages (`home-hero`); names are generic.
- Never extend a block so existing instances render differently.
- Copy text exactly from structured sources (Figma, Penpot, URL); never paraphrase design copy. From images, transcribe and flag unreadable text.
- Pass design copy to WordPress only through the scripts (`media.mjs --alt`, page build); never as a free-text positional argument to WP-CLI.

## References

- `references/intake.md` - per-source intake, assets, masks, shell cap.
- `references/breakdown.md` - patterns, band rules, decision rules, naming, plan format, recording the plan.
