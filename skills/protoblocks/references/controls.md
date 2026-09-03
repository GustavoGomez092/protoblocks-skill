# Controls

Controls are settings that appear in the editor's **inspector sidebar** (not inline in the content). They are declared under `protoBlocks.controls` and become block attributes readable as `$attributes['name']`. Use controls for layout/style/behavior choices; use fields (`fields.md`) for editable content.

## Control types

| Type | Data type | Value | Notes | Seen in |
|------|-----------|-------|-------|---------|
| `text` | string | string | Single-line input. | — |
| `textarea` | string | string | Multi-line input. | cta (description) |
| `select` | string | option key | **Requires `options`** (static) **or `optionsSource`** (server-loaded — see [Dynamic options](#dynamic--server-provided-options)). Dropdown. | card, testimonial, accordion, hero, stats, cta, dynamic-select |
| `multiselect` | array | list of option keys | **Requires `options` or `optionsSource`** — same contract as `select`. Stores an ordered `string[]`; drag to reorder. | — |
| `toggle` | boolean | `true`/`false` | On/off switch. | card, testimonial, accordion, stats, tl-* |
| `checkbox` | boolean | `true`/`false` | Renders like a toggle. | cta (showIcon, fullWidth) |
| `range` | number | number | Slider. Expects `min`/`max` (+ optional `step`). | testimonial (rating 0–5), hero (overlayOpacity), stats (numberSize) |
| `number` | number | number | Numeric input; optional `min`/`max`/`step`. | hero (minHeight), stats (columns) |
| `color` | string | color string | Full color picker (alpha enabled). | hero (backgroundColor) |
| `color-palette` | string | color string | Theme palette swatches. | hero (textColor), cta (bg/text color) |
| `radio` | string | option key | Radio buttons; requires `options`. | hero (contentAlignment), cta (buttonStyle) |
| `image` | object | `{ id, url, alt }` | Media picker in the sidebar (a *setting*, e.g. a background). | hero (backgroundImage) |
| `video` | object | `{ id, url, mime }` | Media picker in the sidebar, filtered to **video**. Optional `allowedTypes` (defaults `["video"]`). | — |

(Open the named example's `block.json` for the exact, working config of each control.)

> The `image` **control** value is `{ id, url, alt }` — fewer keys than the `image` **field** (`{ id, url, alt, caption, size }`, see `fields.md`). The `video` **control** value is `{ id, url, mime }`. Don't conflate fields and controls: a field is editable content in the block body (bound via `data-proto-field`); a control is a sidebar setting (read in PHP).
>
> **`image` and `video` are available as both field types and control types.** Use the **control** form when the media picker should live in the inspector sidebar — for example a "video source" with no natural inline element. A field renders inline and *only* shows where its `data-proto-field` element is in the template; if there's no inline element for it, it won't appear anywhere, so reach for the control.

> Validation note: the SchemaValidator only *warns* on control types outside a core subset, so custom/extra control types load fine. A `select` with neither `options` nor `optionsSource` is a hard error.

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

## Dynamic / server-provided options

A `select` whose choices come from the site's data (existing pages, categories, users) or from a value only the server knows should declare an **`optionsSource`** instead of a static `options` array. The control fetches its options live in the editor over REST and renders an async dropdown (spinner while loading), so newly created content appears without rebuilding the block.

A `select` is "dynamic" the moment it has an `optionsSource`. `options` is then optional and ignored. `sourceArgs` is an optional object forwarded to the provider (only keys the provider allow-lists are passed through). The **stored value is the option key** (e.g. a post ID as a string) — read it like any other control and resolve it in the template.

### Built-in sources

| `optionsSource` | Returns | `sourceArgs` (defaults) | Option key |
|-----------------|---------|--------------------------|------------|
| `wp:posts` | Published posts of a type | `post_type` (`post`), `per_page` (50), `search` | post ID |
| `wp:terms` | Terms of a taxonomy | `taxonomy` (`category`), `per_page` (100), `search` | term ID |
| `wp:users` | Site users | `per_page` (50), `search` | user ID |

`per_page` is clamped server-side to **1–200**.

### Examples by type

**Relate to a page (or any post type):**
```json
"relatedPage": {
  "type": "select", "label": "Related Page",
  "optionsSource": "wp:posts",
  "sourceArgs": { "post_type": "page", "per_page": 50 }
}
```

**Pick a taxonomy term:**
```json
"category": {
  "type": "select", "label": "Category",
  "optionsSource": "wp:terms",
  "sourceArgs": { "taxonomy": "category" }
}
```

**Pick a user (e.g. an author):**
```json
"author": {
  "type": "select", "label": "Author",
  "optionsSource": "wp:users"
}
```

**Custom static table** — a developer registers the source (see below), the block just references it:
```json
"currency": {
  "type": "select", "label": "Currency",
  "optionsSource": "currencies"
}
```

### Reading the value in `template.php`

The attribute holds the chosen key; resolve it to whatever you need:
```php
$relatedPage = $attributes['relatedPage'] ?? '';
$pageTitle   = $relatedPage ? get_the_title( (int) $relatedPage ) : '';

$category = $attributes['category'] ?? '';
$termName = '';
if ($category) {
    $term = get_term( (int) $category );
    if ($term instanceof \WP_Term) { $termName = $term->name; }
}
```

### Registering a custom provider (PHP)

To expose your own data (an external API, plugin settings, a static list), register a provider on the `proto_blocks_register_options_providers` action. The name you give it is the value authors put in `optionsSource`. The callback returns a `{ key, label }[]` list (a `key => label` map also works and is normalized). The optional 3rd `register()` argument allow-lists which `sourceArgs` keys reach the callback (omit it to allow all):

```php
add_action('proto_blocks_register_options_providers', function ($providers) {
    // Static table → "optionsSource": "currencies"
    $providers->register('currencies', function (array $args): array {
        return [
            ['key' => 'usd', 'label' => 'US Dollar'],
            ['key' => 'eur', 'label' => 'Euro'],
        ];
    });

    // Computed, with a whitelisted arg → "optionsSource": "product_categories"
    $providers->register('product_categories', function (array $args): array {
        $terms = get_terms([
            'taxonomy'   => 'product_cat',
            'hide_empty' => empty($args['include_empty']),
        ]);
        return is_wp_error($terms) ? [] : array_map(
            fn($t) => ['key' => (string) $t->term_id, 'label' => $t->name],
            $terms
        );
    }, ['include_empty']);   // only `include_empty` from sourceArgs is forwarded
});
```

### Multiselect

`multiselect` takes the identical config to `select` but stores an **ordered
array of keys**. The author picks with a token field (searching the server as
they type, so a catalogue past `per_page` is still reachable) and drags to
reorder.

```json
"featuredProducts": {
  "type": "multiselect", "label": "Featured products",
  "optionsSource": "wp:posts",
  "sourceArgs": { "post_type": "product", "per_page": 200 }
}
```

```php
$ids = $attributes['featuredProducts'] ?? [];

$products = $ids ? get_posts([
    'post_type'      => 'product',
    'post__in'       => array_map('intval', $ids),
    'orderby'        => 'post__in',   // <- keeps the author's drag order
    'posts_per_page' => count($ids),
]) : [];
```

**`orderby => 'post__in'` is load-bearing.** Omit it and WordPress returns date
order, discarding the ordering the author just dragged into place.

Two options sharing a label render disambiguated — `Half Size Oven (#18282)` —
but the stored value is always the bare key. A key whose post was deleted stays
visible as a bare token so it can be removed, and simply yields no row in the
query.

### How it works at runtime

- The editor calls `GET /wp-json/proto-blocks/v1/controls/options?source=<id>&args=<json>` (capability: `edit_posts`) and renders the result as the dropdown options.
- Unknown source → HTTP 400 (`proto_blocks_unknown_source`); a throwing provider → HTTP 500. The control shows a "Could not load options." message on failure.
- A working example block ships in the plugin's `examples/dynamic-select/` (a `wp:posts` + `wp:terms` demo).

## Conditional rendering (`conditions`)

Show a control only when other attributes have certain values. Declare a `conditions.visible` object on the control; it is evaluated **live in the editor**, and the control renders (or is hidden) as the values change.

```json
"borderWidth": {
  "type": "range", "label": "Border Width", "min": 0, "max": 10,
  "conditions": { "visible": { "hasBorder": true } }
}
```

(`enabled` is also accepted by the schema validator, but `visible` is the key that actually gates rendering today — prefer `visible`.)

### Evaluation rules
- **Multiple keys → AND.** Every entry in the `conditions.visible` object must pass for the control to show.
- **Scalar value → strict equality:** passes when `attributes[key] === value`.
- **Array value → membership (OR):** passes when the array includes the current value of `attributes[key]`.
- Keys reference **any other attribute** — another control *or* a field. There is no compile-time check that the key exists; it is resolved at runtime in the editor.

```json
"conditions": { "visible": { "layout": ["horizontal", "overlay"] } }
```
(shows when `layout` is `horizontal` OR `overlay`.)

### Composing conditions

Combine the two rules to express real logic — AND across keys, OR within an array:

```json
// visible only when source is youtube OR vimeo, AND advanced mode is on
"conditions": { "visible": { "source": ["youtube", "vimeo"], "advanced": true } }
```

The canonical pattern is a single "switch" control that the others condition on, so each input only appears for the relevant choice:

```json
"controls": {
  "source":    { "type": "select", "label": "Video source", "default": "youtube",
                 "options": [
                   { "key": "youtube", "label": "YouTube" },
                   { "key": "vimeo",   "label": "Vimeo" },
                   { "key": "mp4",     "label": "Self-hosted" }
                 ] },

  "videoUrl":  { "type": "text",  "label": "Video URL / ID",
                 "conditions": { "visible": { "source": ["youtube", "vimeo"] } } },

  "videoFile": { "type": "video", "label": "Video file",
                 "conditions": { "visible": { "source": ["mp4"] } } },

  "poster":    { "type": "image", "label": "Poster image",
                 "conditions": { "visible": { "source": ["mp4"] } } }
}
```

There is **no** OR-across-different-keys and **no** negation/comparison operator. To express those, model the inputs so the rule fits AND + membership — e.g. add one `mode`/`source` select and switch on it, rather than combining unrelated booleans. Keep a single control as the switch and condition the rest on it.

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
