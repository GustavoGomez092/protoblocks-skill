# Controls

Controls are settings that appear in the editor's **inspector sidebar** (not inline in the content). They are declared under `protoBlocks.controls` and become block attributes readable as `$attributes['name']`. Use controls for layout/style/behavior choices; use fields (`fields.md`) for editable content.

## Control types

| Type | Data type | Value | Notes | Seen in |
|------|-----------|-------|-------|---------|
| `text` | string | string | Single-line input. | — |
| `textarea` | string | string | Multi-line input. | cta (description) |
| `select` | string | option key | **Requires `options`.** Dropdown. | card, testimonial, accordion, hero, stats, cta |
| `toggle` | boolean | `true`/`false` | On/off switch. | card, testimonial, accordion, stats, tl-* |
| `checkbox` | boolean | `true`/`false` | Renders like a toggle. | cta (showIcon, fullWidth) |
| `range` | number | number | Slider. Expects `min`/`max` (+ optional `step`). | testimonial (rating 0–5), hero (overlayOpacity), stats (numberSize) |
| `number` | number | number | Numeric input; optional `min`/`max`/`step`. | hero (minHeight), stats (columns) |
| `color` | string | color string | Full color picker (alpha enabled). | hero (backgroundColor) |
| `color-palette` | string | color string | Theme palette swatches. | hero (textColor), cta (bg/text color) |
| `radio` | string | option key | Radio buttons; requires `options`. | hero (contentAlignment), cta (buttonStyle) |
| `image` | object | `{ id, url, alt }` | Media picker in the sidebar (a *setting*, e.g. a background). | hero (backgroundImage) |

(Open the named example's `block.json` for the exact, working config of each control.)

> The `image` **control** value is `{ id, url, alt }` — fewer keys than the `image` **field** (`{ id, url, alt, caption, size }`, see `fields.md`). Don't conflate them: a field is editable content in the block body; a control is a sidebar setting.

> Validation note: the SchemaValidator only *warns* on control types outside a core subset, so custom/extra control types load fine. `select` without `options` is a hard error.

## Config options

```json
"layout": {
  "type": "select",
  "label": "Layout",
  "default": "vertical",
  "options": [
    { "key": "vertical",   "label": "Vertical" },
    { "key": "horizontal", "label": "Horizontal" }
  ],
  "help": "Choose how the card is arranged",
  "affects": ["image", "content"],
  "conditions": { "visible": { "showAdvanced": true } }
}
```

| Option | Applies to | Meaning |
|--------|-----------|---------|
| `label` | all | Sidebar label (auto-generated from name if omitted). |
| `default` | all | Initial value. |
| `options` | select, radio, color-palette | Array of `{ "key", "label" }` (a `{ key: label }` map is also accepted). |
| `min` / `max` / `step` | range, number | Numeric bounds and increment. |
| `help` | all | Helper text under the control. |
| `affects` | all | Field names this control influences (hint to the editor). |
| `conditions` | all | Conditional visibility/enablement (below). |

## Reading controls in the template

```php
$layout = $attributes['layout'] ?? 'vertical';
$columns = (int) ($attributes['columns'] ?? 3);
$showIcon = $attributes['showIcon'] ?? false;
```

```php
<div class="card card--<?php echo esc_attr($layout); ?>" style="--cols:<?php echo $columns; ?>">
  <?php if ($showIcon) : ?><span class="icon"></span><?php endif; ?>
</div>
```

**Match your `??` fallback to the declared `default`.** A control's declared `default` is generated into the block's attributes, but write the null-coalescing fallback to agree with it so behavior is correct even before the attribute is persisted. For a toggle that defaults to *on*, use `?? true` — not the habitual `?? false`:
```php
$showBio = $attributes['showBio'] ?? true;   // control default: true
```
Using `?? false` against a `"default": true` toggle silently hides the element on a fresh block.

## Conditional visibility (`conditions`)

Show or enable a control based on other control values. Two condition keys are recognized: `visible` and `enabled`.

```json
"borderWidth": {
  "type": "range", "label": "Border Width", "min": 0, "max": 10,
  "conditions": { "visible": { "hasBorder": true } }
}
```

Evaluation rules:
- All entries in the `conditions.visible` object must pass (AND logic).
- **Scalar value** → strict equality: the control shows when `otherControl === value`.
- **Array value** → membership: shows when the array includes the other control's current value.

```json
"conditions": { "visible": { "layout": ["horizontal", "overlay"] } }
```
(shows when `layout` is `horizontal` OR `overlay`.)

There is no compile-time check that the referenced control exists — it is evaluated at runtime in the editor.

## Sanitization

Control values are sanitized by their data type:

| Data type | Sanitization |
|-----------|--------------|
| boolean | cast to bool |
| number | numeric check → float (else 0) |
| integer | cast to int |
| string | `sanitize_text_field()` |
| object | array preserved, else `[]` |

Controls may also define custom `sanitize` / `process_value` callbacks when registered programmatically.

## Field vs control — which to use

- **Field** = content the user types/places *in the block body* (headings, images, links, rich text, lists). Bound via `data-proto-*` in the markup; edited inline.
- **Control** = a *setting* in the sidebar (layout, color, toggle, count). Read in PHP to alter markup/classes; not bound to a specific element.
