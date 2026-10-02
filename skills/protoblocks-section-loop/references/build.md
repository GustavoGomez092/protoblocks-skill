# Build: authoring checklist and recipes

Authoring rules (field types, controls, templates, Tailwind) live in the `protoblocks` skill; load it first. This file lists what the builder adds on top. `PB`, `THEME`, `WP` as in `SKILL.md`.

## Scaffold (decision `new`)

```bash
"$WP" proto-blocks create hero-split --title="Hero Split" --dir=theme
```

Real flags (checked against the plugin's `create` command): `--title`, `--description`, `--category`, `--fields="name:type,..."`, `--dir=theme|plugin`, `--force`. Use `--dir=theme` (default); `plugin` is not a discovery path. The block lands in `$THEME/proto-blocks/<block>/`. The scaffold is a starting point: rewrite `block.json`, `template.php` and CSS to the design. Names are generic (`hero-split`, never `home-hero`).

## Block checklist

- `block.json` declares `"supports": { "anchor": true }`. The gate enforces it; QA targets the section anchor (`#pb-s<n>`, or `#pb-header` / `#pb-footer`).
- The root element of `template.php` carries `<?php echo get_block_wrapper_attributes([...]); ?>` so the anchor and classes reach the DOM.
- The root is the full-bleed band (`alignfull`, no outer max-width or margins). Put the container inside it: `max-w-[1200px] mx-auto px-6` (use the design's width). If the same container repeats on every section, record it once in `state.site.tokens.spacing` and reuse the class.
- Style with Tailwind and the theme tokens (`text-h1`, `bg-accent`, `font-display`, `rounded-card`), never raw hex when a token exists. Add responsive prefixes (`md:`, `lg:`) that match the design's breakpoints (mobile first). Use vanilla CSS in `style.css`, scoped under the block's class, when Tailwind is awkward (pseudo-elements, complex grids, the mobile nav overlay).
- Every editable element has `data-proto-field` (or `data-proto-repeater` / `data-proto-inner-blocks`) even when its value is empty.
- No hard-coded copy in templates: copy lives in attributes (`$attributes['heading'] ?? ''`), escaped on output.
- Images use the shape `{id, url, alt, caption, size}` (what `media.mjs` prints as `attr`). Use `loading="lazy"`, except the first section's hero image: `fetchpriority="high"` and no lazy.
- `extend`: the new control's default must reproduce today's output exactly; run `regress.mjs` afterwards.

## Writing attrs, inner and block to state

Find indexes first (`n` need not be contiguous; other pages may exist), then write. Values are JSON; strings are quoted.

<!-- test:run -->
```bash
PI=$(node "$PB/lib/state.mjs" get "$THEME" pages | node -e 'const a=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(a.findIndex((p)=>p.slug===process.argv[1]))' home)
SI=$(node "$PB/lib/state.mjs" get "$THEME" "pages.$PI.sections" | node -e 'const a=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(a.findIndex((x)=>x.n===Number(process.argv[1])))' 3)
test "$PI" -ge 0 && test "$SI" -ge 0
S="pages.$PI.sections.$SI"
node "$PB/lib/state.mjs" set "$THEME" "$S.block" '"hero-split"'
node "$PB/lib/state.mjs" set "$THEME" "$S.attrs" '{"heading":"Build faster","image":{"id":12,"url":"https://x.local/a.png","alt":"Dashboard","caption":"","size":"full"}}'
node "$PB/lib/state.mjs" set "$THEME" "$S.inner" '["<!-- wp:paragraph -->\n<p>Intro text</p>\n<!-- /wp:paragraph -->"]'
node "$PB/lib/state.mjs" set "$THEME" "$S.status" '"building"'
```

Setting status `building` matters: `page.mjs build` leaves out sections that are still `planned` (and `skipped` ones, and ones rendered by a template part).

An index of `-1` means the slug or `n` is not in state: stop. `[EINVALID]` or `[EVALUE]` means nothing was written: fix the value and retry (never `restore`). Do not set the anchor: it already exists and `page.mjs` adds it to the attrs.

`section.inner` is a list of raw block-markup strings, joined and placed inside the block for an `inner-blocks` field:

```html
<!-- wp:paragraph -->
<p>Intro text</p>
<!-- /wp:paragraph -->

<!-- wp:buttons -->
<div class="wp-block-buttons"><!-- wp:button -->
<div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="/contact/">Book a demo</a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons -->
```

## Gate failures

`gates.mjs` prints `{ok, steps:[{id, ok, detail}]}` and stops at the first failing step. Exit 1 when `ok` is false.

| step | typical cause | fix |
|---|---|---|
| `anchor-support` | `block.json` unreadable, or `supports.anchor` not `true` | fix the JSON; add `"supports": {"anchor": true}` |
| `validate` | invalid field/control type, `select` without `options`, bad `inner-blocks` type | follow the detail text; see `protoblocks` `references/troubleshooting.md` |
| `cache` | WP-CLI problem | check `"$WP"` works; relay the error |
| `tailwind` | compile failed (bad `@apply`, unknown token) | fix the class or token; re-run |
| `render` | PHP error in the block's own files, empty output, missing `id="pb-gate"`, preview REST not 200 | read `detail` (message, file, line); fix `template.php`; `other` errors from other files do not fail the gate |

Re-run the gate after every fix. Pass attrs that exercise the template (all fields filled), not `{}`.

## Errors from page build

| code | meaning | action |
|---|---|---|
| `EEDITED` | the page was edited in wp-admin since the last build | ask; `--force` backs up first |
| `ESLUGTAKEN` / `EFOREIGN` | a page with this slug exists and the builder did not create it | ask; `--force` only to adopt it |
| `ENOTPAGE` | the stored post id is not a page | tell the developer; do not force |
| `ESTALE` | the page changed while the build ran | re-run the build |
| `ENOPLAN` | the page has no approved plan (`pages[i].plan.approvedAt`) | run the plan gate (`protoblocks-design-breakdown`); never record approval yourself |

Warnings about a kept title, slug or status mean the developer changed them; the message contains the command to hand control back.
