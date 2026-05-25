# Example Blocks (the reference gallery)

The plugin ships **9 example blocks** (6 vanilla CSS + 3 Tailwind), all marked `"isExample": true`, under the plugin's `examples/` directory. They are installable to a theme via **Proto-Blocks → Install Demo Blocks** or the Setup Wizard. They are the authoritative, working reference for every feature — when in doubt, mirror the closest example.

## What each block teaches

### Vanilla CSS (6)

| Block | Fields | Controls | Teaches |
|-------|--------|----------|---------|
| **card** | image, title(h3), content(wysiwyg), link | layout(select), imagePosition(select, conditional), showLink(toggle) | image+link+wysiwyg, conditional control visibility, block supports, conditional class builder |
| **testimonial** | quote(wysiwyg), authorName(cite), authorTitle(span), authorImage(image, thumbnail) | style(select), showAvatar(toggle), rating(range 0–5), showRating(toggle) | range control, multiple toggles, loop-rendered stars, style variants via BEM class |
| **accordion** | items(repeater: title, content) | allowMultiple(toggle), firstOpen(toggle), iconPosition(select) | repeater, Interactivity API (`data-wp-*` + store), drag/duplicate/min-max, preview seeding |
| **hero** | title(h1), subtitle(p), innerContent(inner-blocks) | backgroundImage(image), backgroundColor(color), overlayOpacity(range), textColor(color-palette), contentAlignment(radio), minHeight(number), verticalAlignment(select) | inner-blocks, color + color-palette, radio, number, image-in-inspector, overlay via `proto_blocks_hex_to_rgba()` |
| **stats** | stats(repeater: number, prefix, suffix, label) | columns(number), style(select), numberSize(range), showDividers(toggle) | repeater with optional fields, CSS custom properties from controls, responsive grid |
| **cta** | title(h2), description(p), link | backgroundColor(color-palette), textColor(color-palette), buttonStyle(radio), layout(select), showIcon(checkbox), fullWidth(checkbox, conditional) | textarea/checkbox/radio, conditional visibility, inline SVG icon, dynamic default text |

### Tailwind (3)

| Block | Fields | Controls | Teaches |
|-------|--------|----------|---------|
| **tl-header** | logo(image), siteTitle, navItems(repeater: label, url), ctaButton(link) | showCta(toggle), fixedPosition(toggle) | Tailwind layout, responsive utilities, repeater nav, inline vanilla-JS mobile toggle |
| **tl-hero** | badgeText, badgeLink, heading(h1), description, primaryButton, secondaryLink | showBadge(toggle), showSecondaryLink(toggle) | Tailwind dark theme, gradient blobs (`clip-path`), themed `primary-*` colors, focus-visible |
| **tl-footer** | logo, description, column1Title, column1Links(repeater), column2Title, phone, email, copyrightText, copyrightLink | showLogo, showColumn1, showColumn2 (toggles) | multiple repeaters, toggle-gated sections, responsive grid, semantic `<footer>` |

## Capability coverage matrix

Use this to find the closest example for a feature you need.

| Capability | card | testi. | accord. | hero | stats | cta | tl-hdr | tl-hero | tl-ftr |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| text field | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| image field | ✓ | ✓ | | | | | ✓ | | ✓ |
| link field | ✓ | | | | | ✓ | ✓ | ✓ | ✓ |
| wysiwyg | ✓ | ✓ | ✓ | | | | | | |
| repeater | | | ✓ | | ✓ | | ✓ | | ✓ |
| inner-blocks | | | | ✓ | | | | | |
| select | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | | |
| toggle | ✓ | ✓ | ✓ | | ✓ | | ✓ | ✓ | ✓ |
| range | | ✓ | | ✓ | ✓ | | | | |
| number | | | | ✓ | ✓ | | | | |
| color | | | | ✓ | | | | | |
| color-palette | | | | ✓ | | ✓ | | | |
| radio | | | | ✓ | | ✓ | | | |
| checkbox | | | | | | ✓ | | | |
| image (inspector) | | | | ✓ | | | | | |
| conditional controls | ✓ | | | | | ✓ | | | |
| Interactivity API | | | ✓ | | | | | | |
| Tailwind | | | | | | | ✓ | ✓ | ✓ |

---

## Canonical samples (verbatim)

### CTA — controls-heavy, conditional visibility, inline SVG

`block.json` (`protoBlocks` section):
```json
"protoBlocks": {
  "version": "1.0", "isExample": true, "useTailwind": false, "template": "template.php",
  "fields": {
    "title":       { "type": "text", "tagName": "h2", "format": "simple" },
    "description": { "type": "text", "tagName": "p", "format": "standard", "label": "Description", "default": "Take action now…" },
    "link":        { "type": "link", "tagName": "a" }
  },
  "controls": {
    "backgroundColor": { "type": "color-palette", "label": "Background Color" },
    "textColor":       { "type": "color-palette", "label": "Text Color" },
    "buttonStyle":     { "type": "radio", "label": "Button Style", "default": "primary",
      "options": [ {"key":"primary","label":"Primary"}, {"key":"secondary","label":"Secondary"}, {"key":"outline","label":"Outline"} ] },
    "layout":          { "type": "select", "label": "Layout", "default": "centered",
      "options": [ {"key":"centered","label":"Centered"}, {"key":"inline","label":"Inline"}, {"key":"stacked","label":"Stacked"} ] },
    "showIcon":        { "type": "checkbox", "label": "Show Arrow Icon", "default": true },
    "fullWidth":       { "type": "checkbox", "label": "Full Width Button", "default": false,
      "conditions": { "visible": { "layout": ["centered", "stacked"] } } }
  }
}
```

`template.php` (key parts):
```php
<?php
$title = $attributes['title'] ?? '';
$description = $attributes['description'] ?? '';
$link = $attributes['link'] ?? [];
$bg = $attributes['backgroundColor'] ?? '';
$fg = $attributes['textColor'] ?? '';
$button_style = $attributes['buttonStyle'] ?? 'primary';
$layout = $attributes['layout'] ?? 'centered';
$show_icon = $attributes['showIcon'] ?? true;
$full_width = $attributes['fullWidth'] ?? false;
$is_preview = ! isset($block) || $block === null;

$classes = ['proto-cta', 'proto-cta--layout-' . esc_attr($layout), 'proto-cta--button-' . esc_attr($button_style)];
if ($full_width) $classes[] = 'proto-cta--button-full';

$styles = [];
if ($bg) $styles[] = 'background-color: ' . esc_attr($bg);
if ($fg) $styles[] = 'color: ' . esc_attr($fg);

$wrapper = get_block_wrapper_attributes([
  'class' => implode(' ', $classes),
  'style' => $styles ? implode('; ', $styles) : null,
]);
$arrow = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M13.3 5.3a1 1 0 0 1 1.4 0l6 6a1 1 0 0 1 0 1.4l-6 6a1 1 0 1 1-1.4-1.4L17.6 13H4a1 1 0 1 1 0-2h13.6l-4.3-4.3a1 1 0 0 1 0-1.4z"/></svg>';
?>
<div <?php echo $wrapper; ?>>
  <div class="proto-cta__content">
    <h2 class="proto-cta__title" data-proto-field="title"><?php
      if ($title) echo wp_kses_post($title); elseif ($is_preview) echo 'Ready to Get Started?';
    ?></h2>
    <?php if ($description || $is_preview) : ?>
      <p class="proto-cta__description" data-proto-field="description"><?php echo wp_kses_post($description); ?></p>
    <?php endif; ?>
  </div>
  <div class="proto-cta__action">
    <a class="proto-cta__button" href="<?php echo esc_url($link['url'] ?? '#'); ?>" data-proto-field="link"
       <?php echo !empty($link['target']) ? 'target="' . esc_attr($link['target']) . '"' : ''; ?>>
      <span class="proto-cta__button-text"><?php echo esc_html($link['text'] ?? 'Get Started'); ?></span>
      <?php if ($show_icon) : ?><span class="proto-cta__button-icon"><?php echo $arrow; ?></span><?php endif; ?>
    </a>
  </div>
</div>
```
**Patterns:** conditional class array → `implode`; inline-style array → `implode('; ')`; conditional control (`fullWidth` only for certain layouts); SVG kept in a PHP variable; dynamic preview-only default text.

### Stats — repeater + CSS custom properties

```php
<?php
$stats = $attributes['stats'] ?? [];
$columns = $attributes['columns'] ?? 4;
$number_size = $attributes['numberSize'] ?? 48;
$is_preview = ! isset($block) || $block === null;

$wrapper = get_block_wrapper_attributes([
  'class' => 'proto-stats proto-stats--cols-' . esc_attr($columns),
  'style' => '--proto-stats-number-size: ' . esc_attr($number_size) . 'px; --proto-stats-columns: ' . esc_attr($columns) . ';',
]);

if (empty($stats) && $is_preview) {
  $stats = [
    ['id' => '1', 'number' => '150', 'suffix' => '+', 'label' => 'Happy Clients'],
    ['id' => '2', 'number' => '500', 'suffix' => 'K', 'label' => 'Downloads'],
  ];
}
?>
<div <?php echo $wrapper; ?>>
  <div class="proto-stats__grid" data-proto-repeater="stats">
    <?php foreach ($stats as $stat) : ?>
      <div class="proto-stats__item" data-proto-repeater-item>
        <div class="proto-stats__number-wrapper">
          <?php if (!empty($stat['prefix']) || $is_preview) : ?>
            <span class="proto-stats__prefix" data-proto-field="prefix"><?php echo esc_html($stat['prefix'] ?? ''); ?></span>
          <?php endif; ?>
          <span class="proto-stats__number" data-proto-field="number"><?php echo esc_html($stat['number'] ?? '0'); ?></span>
          <?php if (!empty($stat['suffix']) || $is_preview) : ?>
            <span class="proto-stats__suffix" data-proto-field="suffix"><?php echo esc_html($stat['suffix'] ?? ''); ?></span>
          <?php endif; ?>
        </div>
        <span class="proto-stats__label" data-proto-field="label"><?php echo esc_html($stat['label'] ?? ''); ?></span>
      </div>
    <?php endforeach; ?>
  </div>
</div>
```
CSS reads the vars: `.proto-stats__number { font-size: var(--proto-stats-number-size); }`, grid uses `--proto-stats-columns`.
**Patterns:** CSS custom properties driven by numeric/range controls; optional repeater sub-fields (prefix/suffix) shown only when set or in preview.

### Hero — inner-blocks (shown the **reliable** way)

> The shipped `hero` uses the legacy `"innerblocks"` + `$content`. Below is the same block with the reliable form: hyphenated `"inner-blocks"` + `data-proto-inner-blocks` + `$innerBlocksContent`.

`block.json` field:
```json
"innerContent": {
  "type": "inner-blocks",
  "allowedBlocks": ["core/buttons", "core/button", "core/paragraph", "core/heading", "core/list", "core/image"],
  "template": [["core/buttons", {}, [
    ["core/button", { "text": "Get Started", "className": "is-style-fill" }],
    ["core/button", { "text": "Learn More", "className": "is-style-outline" }]
  ]]],
  "orientation": "vertical"
}
```
`template.php` (overlay + inner blocks):
```php
<?php
$bg_color = $attributes['backgroundColor'] ?? '#1e1e1e';
$opacity = $attributes['overlayOpacity'] ?? 70;
$min_h = $attributes['minHeight'] ?? 60;
$align = $attributes['contentAlignment'] ?? 'center';
$bg_image = $attributes['backgroundImage'] ?? [];
$overlay_rgba = proto_blocks_hex_to_rgba($bg_color, $opacity / 100);

$styles = ['min-height: ' . esc_attr($min_h) . 'vh', 'color: ' . esc_attr($attributes['textColor'] ?? '#fff')];
if (!empty($bg_image['url'])) $styles[] = 'background-image: url(' . esc_url($bg_image['url']) . ')';

$wrapper = get_block_wrapper_attributes([
  'class' => 'proto-hero proto-hero--align-' . esc_attr($align),
  'style' => implode('; ', $styles),
]);
?>
<section <?php echo $wrapper; ?>>
  <div class="proto-hero__overlay" style="background-color: <?php echo esc_attr($overlay_rgba); ?>;"></div>
  <div class="proto-hero__content">
    <h1 class="proto-hero__title" data-proto-field="title"><?php echo wp_kses_post($attributes['title'] ?? ''); ?></h1>
    <div class="proto-hero__inner-blocks" data-proto-inner-blocks>
      <?php echo $innerBlocksContent ?? ''; ?>
    </div>
  </div>
</section>
```
**Patterns:** background image + tinted overlay via `proto_blocks_hex_to_rgba(hex, 0..1)`; inner-blocks slot for free composition; numeric/range/radio/color controls feeding inline styles and classes.

### Tailwind Hero (tl-hero) — Tailwind dark theme + themed colors

```php
<?php
$show_badge = $attributes['showBadge'] ?? true;
$heading = $attributes['heading'] ?? 'Data to enrich your business';
$primary = $attributes['primaryButton'] ?? ['url' => '#', 'text' => 'Get started'];
$wrapper = get_block_wrapper_attributes(['class' => 'relative isolate bg-gray-900 px-6 py-24 sm:py-32 lg:px-8 overflow-hidden']);
?>
<section <?php echo $wrapper; ?>>
  <div class="mx-auto max-w-2xl">
    <div class="text-center">
      <h1 class="text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-7xl" data-proto-field="heading">
        <?php echo esc_html($heading); ?>
      </h1>
      <div class="mt-10 flex items-center justify-center gap-x-6">
        <a href="<?php echo esc_url($primary['url'] ?? '#'); ?>" data-proto-field="primaryButton"
           class="rounded-md bg-primary-500 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-primary-400 no-underline focus-visible:outline focus-visible:outline-2">
          <?php echo esc_html($primary['text'] ?? 'Get started'); ?>
        </a>
      </div>
    </div>
  </div>
</section>
```
**Patterns:** `useTailwind: true`, no `style.css`; themed `bg-primary-500`/`hover:bg-primary-400`; responsive text scale; `no-underline` to defeat theme link styles; toggle-gated badge/secondary link.

---

To study a feature end to end, open the matching folder in the plugin's `examples/` — each has the full `block.json`, `template.php`, and (where used) `style.css` / `view.js` / `preview.png`.
