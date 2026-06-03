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

> **Plugin 2.4.0+:** the renderer now actually passes `$block` to the template — the real `WP_Block` on the frontend, `null` in the editor preview. (Before 2.4.0 it was never passed, so `$block` was always `null` and `$is_preview` was always `true`; any frontend-only branch silently never ran.)

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

## Scroll-reveal animations (`data-proto-animate`)

The plugin ships a frontend reveal runtime (2.4.0+) that owns a safe-by-default
reveal lifecycle. Mark an element `data-proto-animate="pending"` (emit it only on
the frontend, gated by `$is_preview`) and the runtime reveals it
(`data-proto-animate="done"`) when it scrolls into view. Use `"manual"` instead
when your block's own `view.js` drives the motion — the runtime then only
backstops it. The runtime **guarantees content is never left hidden**: scroll-in,
`prefers-reduced-motion` (instant), JS-disabled (`<noscript>`), and a watchdog for
failed/absent block JS all reveal it. Legacy `data-animate` is accepted as an
alias. Full guide: the plugin's `docs/animation.md`.

```php
<section <?php echo get_block_wrapper_attributes(['class' => 'my-block']); ?>
  <?php echo $is_preview ? '' : 'data-proto-animate="pending"'; ?>>
```
```css
.my-block[data-proto-animate="pending"] { opacity: 0; transform: translateY(16px); }
.my-block[data-proto-animate="done"]    { opacity: 1; transform: none; transition: opacity .6s, transform .6s; }
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
