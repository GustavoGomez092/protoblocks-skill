# Intake: design source to frames

Goal: one PNG per breakpoint registered with `intake.mjs add-frame`, plus a list of assets. Frames are copied to `$THEME/.protoblocks/artifacts/<page>/design/<breakpoint>.png` and recorded in `pages[i].design.frames` as `{breakpoint, width, scale, image, pixelWidth}`. Always read `frame.image` from state; the extension follows the source file.

```bash
node "$PB/lib/intake.mjs" add-frame "$THEME" <page> <desktop|tablet|mobile> <image> [--width W] [--title T]
```

Scale inference tries 1x, 2x, 3x and accepts the first whole CSS width in the breakpoint range: desktop 1200-1920, tablet 700-1100, mobile 320-480. Examples: a 2880px desktop export is 1440 at 2x; 780px mobile is 390 at 2x. When nothing fits (`[ESCALE]`), ask the developer once for the frame's CSS width and pass `--width W`. Only PNG and JPEG are read; convert anything else first. The desktop frame is required; tablet and mobile are optional (the section loop uses sanity widths 834 and 390 for a missing frame).

## Image, screenshot, PDF

- PNG: `add-frame` directly.
- JPEG: convert, then add: `sips -s format png in.jpg --out out.png` (macOS).
- PDF: render the page to PNG first: `sips -s format png in.pdf --out out.png` (macOS renders page 1; for other pages ask the developer for PNG exports). Check that the PNG is not clipped.
- Text from an image is transcribed by eye. Mark anything unreadable as "TBC" in the plan Notes and ask; never invent copy.
- Ask for each missing breakpoint only if the developer wants a tablet or mobile layout; otherwise build desktop and let the section loop sanity-check the rest.

## Figma (Figma MCP)

1. `get_metadata` on the page or frame URL: find the top-level frames per breakpoint (names usually say Desktop/Mobile; widths settle it).
2. `get_screenshot` per frame at the highest scale offered; save the PNG to a temp path and `add-frame` it.
3. `get_design_context` per top-level child of a frame for exact text, colours, sizes and spacing. Copy text verbatim.
4. `get_variable_defs` for design tokens; hand them to the `protoblocks-site-setup` tokens step (`references/tokens.md`).
5. `download_assets` for images and icons; import with `media.mjs` (Assets below).

Top-level children of a frame usually equal sections. Use each child's `y` and `height` multiplied by the frame scale as the crop `y0`/`y1` instead of running segmentation; still open the image to confirm. Match mobile children to desktop children by order and content.

## Penpot (Penpot MCP)

1. Read `high_level_overview` first, once.
2. `export_shape` per board as PNG, then `add-frame`.
3. `execute_code` to list each board's children with `y`, `height` and text content (read-only code; never modify the file). Children become crop ranges (scale them to the exported pixels) and give exact copy.
4. Library colours and typographies feed the tokens step.

## Live URL

```bash
node "$PB/lib/intake.mjs" from-url "$THEME" <page> <url> --widths 1440,390
```

Takes full-page screenshots at each width (>=1200 desktop, >=700 tablet, else mobile) and registers them. Read the DOM text with `shoot.mjs` output plus a short Playwright script (`page.locator('h1,h2,h3,p,a,button').allInnerTexts()`), and copy it verbatim. Cookie banners and sticky bars appear in the screenshot: note them and mask or exclude them from crops.

## MCP unavailable

Say which server failed and the error. Offer the fallback: the developer exports PNGs and (for copy) pastes text. Do not guess content or reconstruct a frame from memory.

## Shell cap (desktop frames above 1440px)

The base theme caps `header`, `main` and `footer` at `max-width: 1440px` (theme `style.css`, the `.wp-site-blocks > header, > footer, main` rule). If the desktop frame width W is greater than 1440, every section verified against it fails with `widthDelta = 1440 - W`. Before any section is verified:

1. `grep -n "max-width: 1440px" "$THEME/style.css"` and edit that one rule (and the comment above it) so it reads `max-width: Wpx`. Edit the forked theme in `$THEME` only, never the upstream `proto-blocks-theme` checkout.
2. Record it in state notes (this example uses W = 1600):

<!-- test:run -->
```bash
node "$PB/lib/state.mjs" set "$THEME" pages.0.notes.shellCap '"style.css shell max-width raised from 1440px to 1600px for the 1600px desktop frame"'
```

Frames at or below 1440 need no change (the shell is centred). The cap is theme-wide: if a later page has a different W, ask the developer before changing it again.

## Assets

| Source | Originals | Fallback |
|---|---|---|
| Figma | `download_assets` | crop from the frame |
| Penpot | `export_shape` on the image shape | crop from the frame |
| URL | download the image URLs found in the DOM | crop from the frame |
| Image / PDF | ask the developer for originals | crop from the frame |

Crop a region out of a frame (arbitrary x/y, integer image pixels, names `[A-Za-z0-9_-]+`):

```bash
node "$PB/qa/segment.mjs" crop "$THEME/.protoblocks/artifacts/<page>/design/desktop.png" --ranges '[{"name":"hero-photo","y0":120,"y1":760,"x0":720,"x1":1440}]' --out "$THEME/.protoblocks/artifacts/<page>/assets"
```

Import every image that ends up in the page; alt text is required (use `--alt ""` only for purely decorative images). Imports are de-duplicated by file hash, so a logo reused on several pages is one attachment.

```bash
node "$PB/lib/media.mjs" import "$THEME" "$THEME/.protoblocks/artifacts/<page>/assets/hero-photo.png" --alt "Team reviewing a roadmap" [--title "Hero photo"]
```

The result has the attachment id, URL and an `attr` object to put into the block's image attribute. List every asset cropped from the design in the plan under "replace with originals". Icons are recreated as inline SVG in the block template, not cropped.

Masks: regions of the design that cannot match the render (cropped stock photos, video posters, maps, placeholders, cookie banners) are recorded per section in crop pixel coordinates so visual QA ignores them:

<!-- test:run -->
```bash
node "$PB/lib/state.mjs" set "$THEME" pages.0.sections.0.masks '{"desktop":[{"x":720,"y":0,"w":720,"h":640}]}'
```

Keep masks small; `fullyMasked` in QA means the masks cover everything and are wrong.
