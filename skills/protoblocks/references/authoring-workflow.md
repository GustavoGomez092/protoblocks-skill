# Authoring Workflow — build any block, cleanly

Follow these steps in order to build a Proto-Blocks block. This is the clean path that produces a correct, editable, well-styled block every time.

## 0. Decide the shape first

Before writing anything, decide how to model the content (this prevents the most common rework):
- List the content regions. For each, ask: distinct slot, flowing rich text, open composition, or a repeating list? → pick **discrete field / wysiwyg / inner-blocks / repeater**. See `composition.md`.
- Decide which knobs are **settings** (layout, color, counts, on/off) → those are **controls**, not fields. See `controls.md`.
- Pick a styling method: vanilla CSS or Tailwind. See `styling.md`. Match the project's existing blocks.

## 1. Create the folder

In the active theme:
```
your-theme/proto-blocks/<block-slug>/
├── block.json     (required)
└── template.php   (required)
```
Folder slug = block slug. Lowercase + hyphens. Default block name becomes `proto-blocks/<slug>`.

Optionally scaffold from the CLI:
```bash
wp proto-blocks create feature --title="Feature" --fields="heading:text,body:wysiwyg,image:image"
```

## 2. Write `block.json`

Standard WP metadata + a `protoBlocks` block:
```json
{
  "$schema": "https://schemas.wp.org/trunk/block.json",
  "apiVersion": 3,
  "name": "proto-blocks/feature",
  "title": "Feature",
  "category": "proto-blocks",
  "icon": "star-filled",
  "description": "…",
  "keywords": ["feature"],
  "supports": { "html": false, "anchor": true, "customClassName": true, "align": ["wide", "full"] },
  "protoBlocks": {
    "version": "1.0",
    "template": "template.php",
    "useTailwind": false,
    "fields":   { /* editable content — see fields.md */ },
    "controls": { /* sidebar settings — see controls.md */ }
  }
}
```
Reminders: `select`/`radio` controls need `options`; `range` needs `min`/`max`; field/attribute names are **camelCase and case-sensitive**; for nested blocks use `"type": "inner-blocks"` (hyphenated).

## 3. Write `template.php`

Use this skeleton. It is correct by construction (defaults, escaping, preview detection, wrapper).
```php
<?php
/**
 * @var array         $attributes
 * @var WP_Block|null $block
 * @var string        $innerBlocksContent
 */
$heading = $attributes['heading'] ?? '';
$body    = $attributes['body'] ?? '';
$layout  = $attributes['layout'] ?? 'default';
$is_preview = ! isset($block) || $block === null;

$classes = ['feature', 'feature--' . esc_attr($layout)];
$wrapper = get_block_wrapper_attributes(['class' => implode(' ', $classes)]);
?>
<section <?php echo $wrapper; ?>>
  <h2 class="feature__heading" data-proto-field="heading"><?php echo esc_html($heading); ?></h2>
  <div class="feature__body" data-proto-field="body"><?php echo wp_kses_post($body); ?></div>
</section>
```
Rules that keep it editable and safe:
- Every editable element carries `data-proto-field="name"` and is **always rendered** (even when empty).
- Repeaters: container `data-proto-repeater="name"`, each item `data-proto-repeater-item`; seed placeholder items under `$is_preview` so the editor can discover sub-fields.
- Inner blocks: `data-proto-inner-blocks` container, echo `$innerBlocksContent ?? ''`.
- Escape everything: `esc_html`, `esc_attr`, `esc_url`, `wp_kses_post` (HTML/wysiwyg).
- Drive markup/classes/inline-styles from controls (`$attributes['controlName']`). The CSS-variable pattern (`'style' => '--x: ' . esc_attr($v)`) is great for numeric controls.

## 4. Style it

- **Vanilla:** add `style.css` (auto-enqueued). Namespace classes (`.feature__heading`).
- **Tailwind:** set `"useTailwind": true` and write utilities in the template; use tokens from the theme's `tailwind-theme.css` (`@theme`). Classes like `primary-*` work only if the theme defines them. See `styling.md`.

## 5. Add a preview image (optional)

Drop a `preview.png` (~400px wide) in the folder, or generate one via **Proto-Blocks → Preview Capture**. See `previews.md`.

## 6. Validate & test

```bash
wp proto-blocks validate <slug>     # schema errors/warnings
wp proto-blocks cache clear          # after template edits
```
Then check the block in the **editor** (fields editable? controls update the preview?) and on the **frontend** (renders correctly? interactivity works?).

### Every declared field must be reachable

A field is only editable if some element carries its `data-proto-field`. Checking
that each element you wrote has one is not the same thing, and misses the case
that actually bites: a field whose value is **not displayed** has no element to
carry it, so nothing in the front-end markup will ever be its input.

That is any field the template consumes rather than prints — a CSV that is
parsed into a table, a colour fed to a `style` attribute, a key that selects an
icon, an identifier for an embed. The block renders perfectly and cannot be
authored at all.

Run this in the block's folder before you call it done:

```bash
python3 - <<'CHECK'
import json, re
b = json.load(open('block.json'))
pb = b.get('protoBlocks', {})
fields = dict(pb.get('fields') or {})
names = set(fields)
for name, f in fields.items():                      # repeater subfields count too
    if f.get('type') == 'repeater':
        names |= set((f.get('fields') or {}).keys())
tpl = open('template.php').read()
bound = set(re.findall(r'data-proto-field="([^"]+)"', tpl))
bound |= set(re.findall(r'data-proto-repeater="([^"]+)"', tpl))
bound |= {n for n, f in fields.items() if f.get('type') in ('inner-blocks', 'innerblocks')
          and 'data-proto-inner-blocks' in tpl}
missing = sorted(names - bound)
print('unbound fields:', ', '.join(missing) if missing else 'none')
CHECK
```

Anything listed cannot be edited. Give it an **editor-only authoring region**:
render the bound element behind `$is_preview`, labelled, with the hint the
author needs, and keep it out of the front end.

```php
<?php if ($is_preview) : ?>
    <div class="my-block__authoring">
        <label>Table (CSV)</label>
        <div data-proto-field="csv"><?php echo wp_kses_post($csv); ?></div>
    </div>
<?php endif; ?>
```

Then open the editor and type into it. A block that renders and cannot be
authored is not finished.

## Quick-start checklist

- [ ] Folder under `theme/proto-blocks/<slug>/`, lowercase-hyphen name
- [ ] `block.json`: `apiVersion: 3`, `name`, `title`, `category`, `protoBlocks` with `version` + `template`
- [ ] Content modeled per `composition.md` (no field proliferation)
- [ ] `select`/`radio` have `options`; `range` has `min`/`max`
- [ ] `template.php`: defaults (`?? ''`), `data-proto-field` on every editable element (always rendered), escaping everywhere
- [ ] Repeaters: `data-proto-repeater` + `data-proto-repeater-item` + preview seeding
- [ ] Inner blocks: `"inner-blocks"` + `data-proto-inner-blocks` + `$innerBlocksContent`
- [ ] Styling chosen (vanilla `style.css` or `useTailwind: true`)
- [ ] Every field in `block.json` is bound somewhere (run the unbound-fields check); a field the template parses rather than prints gets an editor-only authoring region
- [ ] Validated, cache cleared, tested in editor + frontend — including typing into every field
