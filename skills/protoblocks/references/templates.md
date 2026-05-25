# Templates (`template.php`)

`template.php` is plain PHP/HTML. The **same file renders both the editor preview and the frontend**. It reads values from `$attributes` and marks editable regions with `data-proto-*` attributes. The plugin parses those attributes to build the editor UI, and strips them from the final output.

## Available variables

| Variable | Type | Notes |
|----------|------|-------|
| `$attributes` | array | All field + control values, plus core attributes (`align`, `anchor`, `className`, `backgroundColor`, `textColor`, `fontSize`, `style`, `innerBlocksContent`). **Hyphenated attribute keys are converted to underscores** for PHP safety. |
| `$block` | `WP_Block`\|null | The block instance on the frontend; **`null` in editor preview**. Use it to branch on context. |
| `$innerBlocksContent` | string | The nested-blocks HTML for an `inner-blocks` field. Same value as `$attributes['innerBlocksContent']`. **Echo this, not `$content`.** Always `?? ''`. |
| `$template` | object | Helper: `$template->has_value($name)` (true if attribute exists and non-empty), `$template->get($name, $default)`. |

> **`$content` is not passed to the template.** WordPress's render content is stored as `$attributes['innerBlocksContent']` and exposed as `$innerBlocksContent`. A template that echoes `$content` for inner blocks produces empty output (and an `Undefined variable` warning). The bundled `hero` example pre-defines `$content = $content ?? ''` and echoes it — that's the legacy pattern; use `$innerBlocksContent ?? ''` instead.

In preview, each control name is also exposed as a variable with its default value, and `$block` is `null`.

## Detecting editor preview vs frontend

```php
$is_preview = ! isset($block) || $block === null;

if (empty($attributes['items']) && $is_preview) {
    // Seed placeholder content so the block looks populated in the inserter/editor
    $attributes['items'] = [
        ['id' => 'preview-1', 'title' => 'Example item'],
    ];
}
```

## The `data-proto-*` system

| Attribute | Binds | Required usage |
|-----------|-------|----------------|
| `data-proto-field="name"` | element ↔ field `name` | Put on the element that displays the field. **Render it even when the value is empty**, or it can't be edited. |
| `data-proto-repeater="name"` | container ↔ repeater field `name` | On the wrapping element of a repeater. |
| `data-proto-repeater-item` | one per repeated item | On each item element inside the repeater container. |
| `data-proto-inner-blocks` | inner blocks slot | Marks where nested blocks render. Use **this**, not `data-proto-field`, for an `inner-blocks` field; echo `$innerBlocksContent ?? ''` inside it. |

How it works:
1. The Parser scans the rendered template for these attributes to discover fields/repeaters and their types/tags.
2. The Renderer injects current values into the matching elements (repeaters first, then regular fields, skipping fields nested inside repeaters).
3. A cleanup pass **removes all `proto-*` (and legacy `zen-*`) attributes** from the final HTML. `data-wp-*` attributes (Interactivity API) are preserved.

So `data-proto-*` attributes never appear in page source — they exist only to wire up editing.

## Escaping (mandatory)

| Value kind | Escape with |
|------------|-------------|
| Plain text | `esc_html()` |
| Attribute value | `esc_attr()` |
| URL | `esc_url()` |
| Rich text / wysiwyg / HTML | `wp_kses_post()` |

Always pair with a null-coalescing default: `esc_html($attributes['title'] ?? '')`.

## Block wrapper

Use `get_block_wrapper_attributes()` on the root element so WordPress applies `align`, `className`, anchor, color, spacing, etc.:

```php
<article <?php echo get_block_wrapper_attributes(['class' => 'my-block my-block--' . esc_attr($layout)]); ?>>
  ...
</article>
```

You can pass `data-proto-repeater` through it too:
```php
<div <?php echo get_block_wrapper_attributes(['class' => 'accordion', 'data-proto-repeater' => 'items']); ?>>
```

## Canonical template skeleton

```php
<?php
/**
 * Template for proto-blocks/my-block
 * @var array         $attributes
 * @var WP_Block|null $block
 * @var string        $innerBlocksContent  (for inner-blocks fields; NOT $content)
 */
$title   = $attributes['title'] ?? '';
$body    = $attributes['body'] ?? '';
$image   = $attributes['image'] ?? [];
$layout  = $attributes['layout'] ?? 'vertical';
$is_preview = ! isset($block) || $block === null;
?>
<section <?php echo get_block_wrapper_attributes(['class' => 'my-block my-block--' . esc_attr($layout)]); ?>>

  <figure data-proto-field="image">
    <?php if (!empty($image['url'])) : ?>
      <img src="<?php echo esc_url($image['url']); ?>" alt="<?php echo esc_attr($image['alt'] ?? ''); ?>" />
    <?php endif; ?>
  </figure>

  <h2 data-proto-field="title"><?php echo esc_html($title); ?></h2>
  <div data-proto-field="body"><?php echo wp_kses_post($body); ?></div>

</section>
```

## Caching

Parsed templates are cached to `wp-content/cache/proto-blocks/`, keyed by template path and validated by file mtime (template + block.json). After editing a template, if changes don't appear:

```bash
wp proto-blocks cache clear        # all templates
wp proto-blocks cache stats        # inspect cache
```

Caching can be disabled globally with `define('PROTO_BLOCKS_CACHE_ENABLED', false);` in `wp-config.php`.
