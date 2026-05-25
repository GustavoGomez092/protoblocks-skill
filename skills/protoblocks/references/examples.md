# Example Blocks

The plugin ships example blocks under its `examples/` directory (enabled by `PROTO_BLOCKS_EXAMPLE_BLOCKS`). They're the best canonical references. Each is marked `"isExample": true`.

| Block | Demonstrates |
|-------|--------------|
| `card` | image + text + wysiwyg + link fields; `select`/`toggle` controls; conditional layout |
| `accordion` | repeater (title + content), Interactivity API (`data-wp-*`), collapsible items |
| `hero` | inner-blocks field, image/color controls, overlay opacity, alignment controls |
| `stats` | repeater with 4 sub-fields, `range`/`number` controls, CSS custom properties |
| `cta` | conditional visibility (`fullWidth` shown based on `layout`), `radio` button style, inline SVG icon |
| `testimonial` | wysiwyg quote + image + text, star rating via `range`, multiple toggles |
| `tl-header` | Tailwind, repeater nav items, preview defaults, responsive script |
| `tl-footer` | Tailwind, multiple repeaters, field-group visibility toggles, grid layout |
| `tl-hero` | Tailwind gradients, multiple link fields, conditional badge/secondary link |

## Canonical: simple field block (Card)

`block.json`:
```json
{
  "$schema": "https://schemas.wp.org/trunk/block.json",
  "apiVersion": 3,
  "name": "proto-blocks/card",
  "title": "Card",
  "description": "A card with image, title, content, and a call-to-action link.",
  "category": "proto-blocks",
  "icon": "admin-post",
  "keywords": ["card", "box", "feature"],
  "supports": {
    "html": false,
    "anchor": true,
    "customClassName": true,
    "align": ["wide", "full"],
    "color": { "background": true, "text": true },
    "spacing": { "padding": true, "margin": true }
  },
  "protoBlocks": {
    "version": "1.0",
    "isExample": true,
    "useTailwind": false,
    "template": "template.php",
    "fields": {
      "image":   { "type": "image", "sizes": ["medium", "large"] },
      "title":   { "type": "text", "tagName": "h3" },
      "content": { "type": "wysiwyg" },
      "link":    { "type": "link", "tagName": "a" }
    },
    "controls": {
      "layout": {
        "type": "select",
        "label": "Layout",
        "default": "vertical",
        "options": [
          { "key": "vertical",   "label": "Vertical" },
          { "key": "horizontal", "label": "Horizontal" },
          { "key": "overlay",    "label": "Overlay" }
        ],
        "affects": ["image", "content"]
      }
    }
  }
}
```

`template.php`:
```php
<?php
$layout       = $attributes['layout'] ?? 'vertical';
$image        = $attributes['image'] ?? [];
$title        = $attributes['title'] ?? '';
$card_content = $attributes['content'] ?? '';
$link         = $attributes['link'] ?? [];
$is_preview   = ! isset($block) || $block === null;
?>
<article <?php echo get_block_wrapper_attributes(['class' => 'proto-card proto-card--' . esc_attr($layout)]); ?>>

  <?php if (!empty($image['url']) || $is_preview) : ?>
    <figure class="proto-card__image" data-proto-field="image">
      <?php if (!empty($image['url'])) : ?>
        <img src="<?php echo esc_url($image['url']); ?>" alt="<?php echo esc_attr($image['alt'] ?? ''); ?>" />
      <?php endif; ?>
    </figure>
  <?php endif; ?>

  <div class="proto-card__content">
    <h3 class="proto-card__title" data-proto-field="title"><?php echo esc_html($title); ?></h3>
    <div class="proto-card__body" data-proto-field="content"><?php echo wp_kses_post($card_content); ?></div>
    <a class="proto-card__link"
       href="<?php echo esc_url($link['url'] ?? '#'); ?>"
       data-proto-field="link"
       <?php echo !empty($link['target']) ? 'target="' . esc_attr($link['target']) . '"' : ''; ?>>
      <?php echo esc_html($link['text'] ?? 'Learn More'); ?>
    </a>
  </div>
</article>
```

## Canonical: repeater block (Accordion)

`protoBlocks` section:
```json
"protoBlocks": {
  "version": "1.0",
  "isExample": true,
  "template": "template.php",
  "fields": {
    "items": {
      "type": "repeater",
      "min": 1, "max": 20,
      "itemLabel": "title",
      "collapsible": true,
      "fields": {
        "title":   { "type": "text", "label": "Title", "tagName": "span" },
        "content": { "type": "wysiwyg", "label": "Content" }
      }
    }
  },
  "controls": {
    "allowMultiple": { "type": "toggle", "label": "Allow Multiple Open", "default": false },
    "firstOpen":     { "type": "toggle", "label": "First Item Open by Default", "default": true }
  }
}
```

`template.php`:
```php
<?php
$items       = $attributes['items'] ?? [];
$first_open  = $attributes['firstOpen'] ?? true;
$is_preview  = ! isset($block) || $block === null;

if (empty($items) && $is_preview) {
  $items = [
    ['id' => 'preview-1', 'title' => 'Accordion Item 1', 'content' => 'Click to edit...'],
    ['id' => 'preview-2', 'title' => 'Accordion Item 2', 'content' => 'Add more items...'],
  ];
}
?>
<div <?php echo get_block_wrapper_attributes(['class' => 'proto-accordion', 'data-proto-repeater' => 'items']); ?>>
  <?php foreach ($items as $index => $item) : ?>
    <div class="proto-accordion__item" data-proto-repeater-item>
      <h3 class="proto-accordion__header">
        <button type="button" class="proto-accordion__trigger"
                aria-expanded="<?php echo $index === 0 && $first_open ? 'true' : 'false'; ?>">
          <span class="proto-accordion__title" data-proto-field="title">
            <?php echo esc_html($item['title'] ?? ''); ?>
          </span>
        </button>
      </h3>
      <div class="proto-accordion__panel" <?php echo $index === 0 && $first_open ? '' : 'hidden'; ?>>
        <div class="proto-accordion__content" data-proto-field="content">
          <?php echo wp_kses_post($item['content'] ?? ''); ?>
        </div>
      </div>
    </div>
  <?php endforeach; ?>
</div>
```

To study a feature, open the matching example in the plugin's `examples/` folder — it always contains the authoritative, working `block.json` + `template.php` (+ `style.css`/`view.js` where relevant).
