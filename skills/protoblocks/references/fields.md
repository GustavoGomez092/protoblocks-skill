# Fields

Fields are editable content regions. They are declared under `protoBlocks.fields` in `block.json` and bound to template elements with `data-proto-field="name"` (repeaters and inner-blocks have their own bindings). Each field becomes a block attribute readable as `$attributes['name']`.

There are six built-in field types: `text`, `wysiwyg`, `image`, `link`, `repeater`, `inner-blocks`.

> Note on the inner-blocks type string: the schema accepts both `"inner-blocks"` and `"innerblocks"`. The internal `__protoType` is `innerblocks`. Either spelling works in `block.json`; `inner-blocks` is the documented form.

---

## text

Inline editable text (uses the editor's RichText under the hood).

```json
"title": { "type": "text", "tagName": "h3", "format": "standard", "maxLength": 80 }
```

| Config | Default | Meaning |
|--------|---------|---------|
| `tagName` | `div` | Element tag to render. |
| `format` | `standard` | Allowed inline formats: `plain` (none), `simple` (bold, italic), `standard` (bold, italic, link), `full` (all). |
| `maxLength` | — | Max characters. |
| `required` | `false` | — |

**Value shape:** plain string.

**Template:**
```php
<h3 data-proto-field="title"><?php echo esc_html($attributes['title'] ?? ''); ?></h3>
```

---

## wysiwyg

Rich text with full formatting (all formats enabled: bold, italic, link, lists, etc.).

```json
"body": { "type": "wysiwyg", "tagName": "div", "maxLength": 500 }
```

| Config | Default | Meaning |
|--------|---------|---------|
| `tagName` | `div` | Container tag. |
| `placeholder` | — | Editor placeholder. |
| `maxLength` | — | Counts text with tags stripped. |
| `required` | `false` | — |

**Value shape:** HTML string. **Escape with `wp_kses_post()`, never `esc_html()`** (which would show the tags as text).

**Template:**
```php
<div data-proto-field="body"><?php echo wp_kses_post($attributes['body'] ?? ''); ?></div>
```

---

## image

WordPress media-library image.

```json
"photo": { "type": "image", "sizes": ["medium", "large"], "defaultSize": "large" }
```

| Config | Default | Meaning |
|--------|---------|---------|
| `sizes` | — | Selectable image sizes. |
| `defaultSize` | `full` | Default size. |
| `required` | `false` | — |

**Value shape:**
```php
[ 'id' => int|null, 'url' => string, 'alt' => string, 'caption' => string, 'size' => string ]
```

**Template** — put `data-proto-field` on the wrapper (so it stays editable even with no image yet):
```php
<?php $photo = $attributes['photo'] ?? []; ?>
<figure data-proto-field="photo">
  <?php if (!empty($photo['url'])) : ?>
    <img src="<?php echo esc_url($photo['url']); ?>" alt="<?php echo esc_attr($photo['alt'] ?? ''); ?>" />
  <?php endif; ?>
</figure>
```

Sanitization: `id`→absint, `url`→`esc_url_raw`, `alt`→`sanitize_text_field`, `caption`→`wp_kses_post`, `size`→`sanitize_key`.

---

## link

URL + display text with target/rel controls.

```json
"cta": { "type": "link", "tagName": "a" }
```

**Value shape:**
```php
[ 'url' => string, 'text' => string, 'target' => string, 'rel' => string, 'title' => string ]
```
`target` is validated against `['', '_self', '_blank', '_parent', '_top']`. When `target` is `_blank`, `rel` auto-includes `noopener noreferrer`.

**Template** — `data-proto-field` goes on the `<a>`:
```php
<?php $cta = $attributes['cta'] ?? []; ?>
<a data-proto-field="cta"
   href="<?php echo esc_url($cta['url'] ?? '#'); ?>"
   <?php echo !empty($cta['target']) ? 'target="' . esc_attr($cta['target']) . '"' : ''; ?>
   <?php echo !empty($cta['rel']) ? 'rel="' . esc_attr($cta['rel']) . '"' : ''; ?>>
  <?php echo esc_html($cta['text'] ?? ''); ?>
</a>
```

The link field can wrap inline children (e.g. an icon next to the text).

---

## repeater

A repeatable list of sub-fields. See `repeaters.md` for full detail.

```json
"items": {
  "type": "repeater",
  "min": 1, "max": 20,
  "itemLabel": "title",
  "collapsible": true,
  "fields": {
    "title":   { "type": "text", "tagName": "span" },
    "content": { "type": "wysiwyg" }
  }
}
```

| Config | Meaning |
|--------|---------|
| `fields` | **Required.** Sub-field definitions per item. |
| `min` / `max` | Item count bounds. |
| `itemLabel` | Sub-field name used as each item's label in the editor. |
| `collapsible` | Whether items collapse in the editor. |

**Value shape:** array of objects, each with an auto-generated `id` plus the sub-fields:
```php
[ ['id' => 'item_...', 'title' => '...', 'content' => '...'], ... ]
```
Every item always has an `id` (auto-generated UUID if missing).

**Template** uses `data-proto-repeater` on the container and `data-proto-repeater-item` per item:
```php
<div data-proto-repeater="items">
  <?php foreach (($attributes['items'] ?? []) as $item) : ?>
    <div data-proto-repeater-item>
      <span data-proto-field="title"><?php echo esc_html($item['title'] ?? ''); ?></span>
      <div data-proto-field="content"><?php echo wp_kses_post($item['content'] ?? ''); ?></div>
    </div>
  <?php endforeach; ?>
</div>
```

---

## inner-blocks

A slot for free-form nested WordPress blocks (paragraphs, images, etc.). **Only one per block.**

```json
"innerContent": {
  "type": "inner-blocks",
  "allowedBlocks": ["core/paragraph", "core/heading", "core/image"],
  "template": [["core/paragraph", { "placeholder": "Add content..." }]],
  "templateLock": false,
  "orientation": "vertical",
  "renderAppender": "default"
}
```

| Config | Default | Meaning |
|--------|---------|---------|
| `allowedBlocks` | `[]` | Permitted block names. |
| `template` | `[]` | Default inner block template. |
| `templateLock` | `false` | `all` \| `insert` \| `contentOnly` \| `false`. |
| `orientation` | `vertical` | `horizontal` \| `vertical`. |
| `renderAppender` | `default` | `default` \| `button` \| `false`. |

**Value:** serialized block HTML string. In the template, output the inner content with `$content` (a.k.a. `$attributes['innerBlocksContent']`), and bind the slot with `data-proto-field` or `data-proto-inner-blocks`:
```php
<div data-proto-field="innerContent"><?php echo $content; ?></div>
```

---

## Registering a custom field type

Custom field types implement `FieldInterface` (extend `AbstractField`) and are registered on the `proto_blocks_init` action (which fires during `init` priority 5, before block registration).

**PHP side** — implement the interface:
```php
namespace MyTheme\Fields;

use DOMElement;
use ProtoBlocks\Fields\AbstractField;

class ColorField extends AbstractField {
    public static function getAttributeSchema(mixed $default = null, array $config = []): array {
        return ['type' => 'string', 'default' => $default ?? '#000000', '__protoType' => 'color'];
    }
    public static function updateElement(DOMElement $el, mixed $value, array $config = []): void {
        if (is_string($value) && $value !== '') $el->setAttribute('style', 'color:' . $value);
    }
    public static function extractDefault(DOMElement $el): mixed { return '#000000'; }
    public static function sanitize(mixed $value, array $config = []): mixed {
        return preg_match('/^#[0-9A-F]{6}$/i', (string) $value) ? $value : '#000000';
    }
    public static function validate(mixed $value, array $config = []): bool|string {
        return preg_match('/^#[0-9A-F]{6}$/i', (string) $value) ? true : 'Invalid hex color';
    }
}
```

**Register it:**
```php
add_action('proto_blocks_init', function ($plugin) {
    $plugin->getFieldRegistry()->register('color', [
        'php_class'        => \MyTheme\Fields\ColorField::class,
        'attribute_schema' => ['type' => 'string', 'default' => '#000000'],
    ]);
});
```

The `FieldInterface` contract: `getAttributeSchema()`, `updateElement()`, `extractDefault()`, `sanitize()`, `validate()`. A matching editor (React) component handles the editing UI for the type.
