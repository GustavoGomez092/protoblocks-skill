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

### When your own `view.js` drives it (`"manual"`)

**CSS hides. JavaScript only raises opacity.** Hiding in JavaScript always
flashes: a view script runs in the footer, so the browser has already painted
the section at full size and full opacity before the script can touch it. The
reader sees the finished layout, it vanishes, then it animates in.

Key the hidden state to `html.proto-js`. Proto-Blocks 2.16.2+ adds that class
to `<html>` from `<head>`, before anything is painted; with JS off it is never
set, so nothing is hidden. `<html>` survives Taxi swaps, so the rule applies the
instant a swapped-in section exists. Set `done` in the same tick you write the
animation's start states:

```css
html.proto-js .my-block[data-proto-animate="manual"] [data-my-reveal] { opacity: 0; visibility: hidden; }
```
```js
gsap.set(els, { autoAlpha: 0, y: 24 });                // start states inline first
section.setAttribute('data-proto-animate', 'done');    // lifts the CSS, same tick
gsap.to(els, { autoAlpha: 1, y: 0, stagger: 0.08 });
```

`visibility` alongside `opacity` because `autoAlpha` sets both, and opacity
alone leaves the text selectable and reachable by find-in-page while invisible.
Set `data-proto-animate` only on the frontend (`$is_preview` false), so nothing
is hidden in the editor.

Traps, all of which have shipped:

- **Never hide from a script, including an inline `<script>` inside the
  section** that adds a pending class while it is parsed
  (`document.currentScript.parentNode`). It works on a full load. A Taxi swap
  imports the view with its scripts inert and runs them after the markup is in
  the document; proto-blocks-theme 1.6.0+ holds the view hidden until they
  settle but caps the hold on a slow network, and older forks have no hold. The
  finished section shows for a frame, vanishes and animates in. Symptom: right
  on reload, flashes when arriving by a link.
- **Plugin before 2.16.2: the `manual` watchdog fires early.** It
  force-revealed a `manual` section 1500ms after it entered view, so on a slow
  load a rule keyed on `manual` lifted before the block's script had arrived.
  2.16.2 starts the 1500ms after window load (capped at 10s). On an older
  plugin, key the hidden state to a marker only your script sets instead, and
  add a CSS failsafe animation (`animation: x 0s linear 10s forwards`, keyframes
  to `opacity:1; visibility:visible`) in place of the watchdog.
- **Plugin before 2.16.2: there is no `proto-js`, and the no-JS fallback is a
  `<noscript>`.** Taxi parses fetched pages with scripting disabled, so a merge
  can promote that `<style>` (with its `!important`) into the live document;
  `proto-blocks-theme` ships a guard. On such a site, add your own class from
  `<head>` (`add_action('wp_head', ..., 0)` echoing
  `document.documentElement.classList.add('mytheme-js')`) and key to it.

Reproduce all of these by **navigating** rather than reloading, with the cache
disabled. A warm reload hides them.

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

## Accessibility conventions

Page QA and `a11y.mjs check-section` (site builder) block on these; follow them when writing the template, not after the check fails.

- **One landmark per role per region.** Never wrap a `core/navigation` block in a `<nav>`: core already renders `<nav aria-label="<menu name>">`, so a second one is a nested landmark (`landmark-unique`, `nested-nav`). Header and footer blocks use `div` wrappers (the template part supplies `<header>` / `<footer>`); no block prints `<main>` (the theme template owns it).
- **Footer menus: one landmark.** Several core navs in a footer are several small landmarks (`nav-too-few-links`). Put the footer's inner blocks in one `<nav aria-label="Footer">` and demote the inner core navs to labelled groups with the filter below (fork `functions.php`). It is scoped through the parent block, not a global flag: `render_block_context` (WordPress 5.9+ passes each inner block its parent) marks every block rendered inside `proto-blocks/site-footer`, at any depth, and only those navs are rewritten; the header's nav keeps its landmark. Only the outer `<nav …>` / `</nav>` change; the inner markup, classes (so `syncNavState` still finds `.wp-block-navigation a`) and core's `aria-label` (the menu name) stay.

```php
add_filter('render_block_context', function ($context, $parsed_block, $parent_block) {
    if ($parent_block instanceof WP_Block
        && ('proto-blocks/site-footer' === $parent_block->name || ! empty($parent_block->context['pb/inFooter']))) {
        $context['pb/inFooter'] = true;
    }
    return $context;
}, 10, 3);

add_filter('render_block_core/navigation', function ($html, $parsed_block, $instance) {
    if (empty($instance->context['pb/inFooter'])) {
        return $html;
    }
    $html = preg_replace('/^(\s*)<nav\b/i', '$1<div role="group"', $html, 1);
    $html = preg_replace('/<\/nav>(\s*)$/i', '</div>$1', $html, 1);
    $tags = new WP_HTML_Tag_Processor($html); // set_attribute() escapes the value
    if ($tags->next_tag('div') && ! $tags->get_attribute('aria-label')) {
        $ref = (int) ($instance->attributes['ref'] ?? 0);
        $tags->set_attribute('aria-label', $ref ? get_post_field('post_title', $ref) : __('Footer links'));
    }
    return $tags->get_updated_html();
}, 10, 3);
```

```php
<div <?php echo get_block_wrapper_attributes(['class' => 'site-footer']); ?>>
  <nav class="site-footer__menus" aria-label="<?php echo esc_attr__('Footer'); ?>">
    <?php echo $innerBlocksContent ?? ''; ?>
  </nav>
</div>
```

- **Heading levels per region.** Exactly one `h1`, in `main` (the hero or page title). Section titles are `h2`, items inside a section `h3`. Never skip a level in document order, header and footer included (`heading-order`, `heading-skip`): footer column titles are `h2` or a styled `<p>`, never `h3` after a page whose last heading is the `h1`. Choose the level from the outline, then style it with a text token.
- **Tabs: the ARIA tabs pattern on the frontend.** A `[role=tablist]` that contains only the `<button role="tab" id aria-controls aria-selected tabindex>` elements; the `[role=tabpanel]` elements (`id`, `aria-labelledby` = their tab's id, `tabindex="0"`, `hidden` when inactive) follow the tablist, never inside it or between its tabs, never wired with `aria-owns`. Arrow keys move between tabs (roving `tabindex`). Tab+panel rows per repeater item (easy to edit) render only under `$is_preview`; the frontend loops the repeater twice (tabs, then panels). Recipe: `recipes.md`, Tabs.
- **`role="img"` on the SVG itself**, with its own name: `<svg role="img" aria-label="…">` (or `aria-hidden="true" focusable="false"` when decorative). Never on a wrapper `div` around the SVG (`role-img-misplaced`).
- **No `<a>` without `href`.** A dropdown parent either links to a page or is a `<button type="button" aria-expanded>`. Core navigation prints a label-only submenu parent (no url) as an href-less `<a>` unless the navigation block has `"openSubmenusOnClick": true` (then it is a `<button>`). Hash-only actions (`#cookie-settings`) are buttons too.
- **Touch targets at least 24×24px** (`target-size`). Make the control itself 24px and draw the small visual on a pseudo-element: `.dot { position: relative; width: 24px; height: 24px; } .dot::before { content: ""; position: absolute; inset: 8px; border-radius: 50%; background: currentColor; }` (8px dot, 24px button). A pseudo-element *around* an 8px button does not count: axe measures the element.
- **`aria-current` is the theme's job.** Never print `aria-current` in a template: the header and footer persist across Taxi page swaps, so a server-printed value goes stale. The theme's `scripts/proto-taxi.js` (`syncNavState`, on every `NAVIGATE_IN`) sets `aria-current="page"` on the `.wp-block-navigation a[href]` whose pathname is the new location and removes it from the rest. Links outside a core navigation block (the logo, a legal link) are not synced; if the post-navigation check lists them under `missing` or `stale`, the fix is the fork's `proto-taxi.js` (tell the developer), not block JS.

## Caching

Parsed templates are cached to `wp-content/cache/proto-blocks/`, keyed by template path and validated by file mtime (template + block.json). After editing a template, if changes don't appear:

```bash
wp proto-blocks cache clear        # all templates
wp proto-blocks cache stats        # inspect cache
```

Caching can be disabled globally with `define('PROTO_BLOCKS_CACHE_ENABLED', false);` in `wp-config.php`.
