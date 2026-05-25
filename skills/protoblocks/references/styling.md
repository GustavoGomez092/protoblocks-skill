# Styling

Three ways to style a Proto-Block: vanilla CSS, Tailwind, or theme/editor styles. They can be combined.

## 1. Vanilla CSS

Add `style.css` (or `{block-name}.css`) in the block folder. It's auto-discovered and enqueued on **both** the frontend and the editor, registered as handle `proto-blocks-{name}`.

```
my-block/
├── block.json
├── template.php
└── style.css
```

```css
/* style.css */
.my-block { display: grid; gap: 1rem; }
.my-block--horizontal { grid-template-columns: 1fr 1fr; }
```

Reference your own classes from the template and toggle modifier classes from controls:
```php
<div class="my-block my-block--<?php echo esc_attr($attributes['layout'] ?? 'vertical'); ?>">
```

## 2. Tailwind CSS

Enable per block in `block.json`:
```json
"protoBlocks": { "useTailwind": true }
```

Then write Tailwind utility classes directly in `template.php`:
```php
<article class="flex flex-col gap-4 rounded-xl bg-white p-6 shadow">
```

How it works:
- A scanner reads all blocks' templates for Tailwind classes, compiles CSS via the Tailwind CLI, and caches the output to `wp-content/cache/proto-blocks/`.
- The compiled CSS is **scoped to `.proto-blocks-scope`** so block utilities don't leak into the rest of the site. Selectors are rewritten (e.g. `.rounded-full` → `.proto-blocks-scope.rounded-full, .proto-blocks-scope .rounded-full`). Global at-rules (`:root`, keyframes, font-face, etc.) are not scoped.
- Compilation mode is configurable: `cached` (compile once, serve cached) or `on_reload` (recompile each load, for development). Managed via the Tailwind admin settings / `TailwindManager`.

Manager API (programmatic):
```php
\ProtoBlocks\Tailwind\Manager::getInstance()->isEnabled();
\ProtoBlocks\Tailwind\Manager::getInstance()->enable();
```
Settings live in the `proto_blocks_tailwind` option. An option exists to disable WordPress global styles when they conflict with Tailwind's reset.

If new Tailwind classes don't apply, force a recompile (clear the proto-blocks cache, or use `on_reload` mode while developing).

## 3. Theme / editor styles

The plugin adds the theme's editor styles into the block editor iframe (via `add_editor_style`) so previews match the front end. Design tokens/theme CSS can be surfaced this way. Keep block-specific rules in the block's own `style.css`.

## Color helper

`proto_blocks_hex_to_rgba()` converts a hex color (from a `color` control) to `rgba()` for use in inline styles:
```php
$overlay = proto_blocks_hex_to_rgba($attributes['overlayColor'] ?? '#000000', 0.5);
// "rgba(0, 0, 0, 0.5)"
```

## Choosing an approach

- **Vanilla CSS** — most predictable, no build step, good for self-contained component styles.
- **Tailwind** — fast iteration in markup; remember it's scoped to `.proto-blocks-scope` and needs compilation.
- **Theme styles** — for inheriting global design tokens / typography in the editor.
