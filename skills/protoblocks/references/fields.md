# Fields

Fields are editable content regions. They are declared under `protoBlocks.fields` in `block.json` and bound to template elements with `data-proto-field="name"` (repeaters and inner-blocks have their own bindings). Each field becomes a block attribute readable as `$attributes['name']`.

There are seven built-in field types: `text`, `wysiwyg`, `image`, `video`, `link`, `repeater`, `inner-blocks`.

> **Inner-blocks type string — must be hyphenated.** Use `"type": "inner-blocks"`. The editor's HTML-to-React parser matches `config.type === 'inner-blocks'` (hyphenated) to inject the nested-blocks slot; the non-hyphenated `"innerblocks"` is **silently skipped** — the block renders as a leaf with no `+` appender and no drop target. (The bundled `hero` example still uses the legacy `"innerblocks"` spelling; prefer the hyphenated form.)

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

## video

WordPress media-library video — the picker is filtered to **video** attachments. Use it for a self-hosted video source (e.g. an MP4).

```json
"clip": { "type": "video", "allowedTypes": ["video"] }
```

| Config | Default | Meaning |
|--------|---------|---------|
| `allowedTypes` | `["video"]` | MIME types the media modal accepts (e.g. `["video"]`, or narrow to `["video/mp4"]`). |
| `required` | `false` | — |

**Value shape:**
```php
[ 'id' => int|null, 'url' => string, 'mime' => string ]
```

**Template** — bind `data-proto-field` to a `<video>` (or `<source>`) to write `src` (and `type` on a `<source>`), or just read the URL:
```php
<?php $clip = $attributes['clip'] ?? []; ?>
<?php if (!empty($clip['url'])) : ?>
  <video data-proto-field="clip" src="<?php echo esc_url($clip['url']); ?>" controls></video>
<?php endif; ?>
```

Sanitization: `id`→absint, `url`→`esc_url_raw`, `mime`→`sanitize_text_field`.

> `video` exists as **both** a field (inline, bound via `data-proto-field`) and a **control** (a media picker in the inspector sidebar — see `controls.md`). Use the **control** form when the picker should live in the sidebar rather than inline in the block body (e.g. a "video source" setting that has no natural inline element).

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

**Inside a repeater**, a `link` sub-field that is *not* bound to an inline `data-proto-field` element (e.g. the whole item is the `<a>`, or it's an icon-only link with no text) is editable from the item's overlay toolbar instead of inline. See `repeaters.md` → *Item-level link editing*.

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
| `allowedBlocks` | `[]` (all) | Whitelist of block names. Omit to allow every block. |
| `template` | `[]` | Default blocks inserted when the parent is first added. Format: `[blockName, attrs?, innerTemplate?]`. |
| `templateLock` | `false` | `all` \| `insert` \| `contentOnly` \| `false`. |
| `orientation` | `vertical` | `horizontal` \| `vertical`. |
| `renderAppender` | `default` | `default` (plus button) \| `button` \| `false`. |

**Template binding — three things must line up:**
1. Field `"type": "inner-blocks"` (hyphenated — see note at top of this file).
2. The container element carries the **`data-proto-inner-blocks`** attribute (not `data-proto-field`).
3. You echo **`$innerBlocksContent`** — *not* `$content`. The engine stores WP's render content as `$attributes['innerBlocksContent']` and exposes it as `$innerBlocksContent`; plain `$content` is **not** passed to the template and echoing it produces empty output. Always null-coalesce (a fresh/empty instance leaves it undefined).

```php
<div class="my-block__body" data-proto-inner-blocks>
  <?php echo $innerBlocksContent ?? ''; ?>
</div>
```

For container/wrapper blocks (group-like), also add `supports.layout` (e.g. `{ "default": { "type": "constrained" } }`) so the editor shows native Layout controls (content/wide width, justification). See `composition.md` for when to choose inner-blocks over typed fields, and `troubleshooting.md` for the "not nestable / renders empty" fixes.

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
