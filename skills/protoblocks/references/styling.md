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

## Vanilla CSS vs Tailwind — which to choose

These are the two real authoring choices (theme styles are a complement, not an alternative). Pick **per block** — the `useTailwind` flag is per-block, so a project can mix both.

| | Vanilla CSS (`style.css`) | Tailwind (`useTailwind: true`) |
|---|---|---|
| Where styles live | a `style.css` next to the block | utility classes inline in `template.php` |
| Build step | none | yes — scanned + compiled by the plugin |
| Isolation | your own class names | auto-scoped to `.proto-blocks-scope` |
| Editor/frontend parity | identical (same stylesheet both places) | identical (compiled CSS loaded both places) |
| Best when | the block has a distinct, hand-crafted design; you want zero build; you're shipping the block standalone | you're building many blocks fast, reusing a design system / spacing scale, iterating in markup |
| Watch out for | class-name collisions if not namespaced | classes only exist after a (re)compile; scoping means utilities don't leak — and won't apply outside the scope wrapper |

**Decision guide:**
- **Use vanilla CSS** for a one-off, visually distinctive block, when you want no toolchain, or when the block must be portable/exported cleanly. Co-locate `style.css`; namespace classes (`.my-block__title`).
- **Use Tailwind** when you're producing a *set* of blocks and want consistent spacing/colors and fast iteration without round-tripping to a CSS file. Accept the compile step and the `.proto-blocks-scope` boundary.
- **Don't mix the two inside a single block** unless you have a reason — pick one as that block's primary styling method to keep it readable. Either way you can still pull in theme tokens via editor styles.
- **Consistency beats preference:** match whatever the surrounding blocks in the project already use. The setup wizard records a project-wide default in `proto_blocks_component_style` — follow it.

If you choose Tailwind and classes don't apply, the cause is almost always "not compiled yet" or "outside the scope wrapper" — see Troubleshooting and the Tailwind section above.

## Choosing among all three

- **Vanilla CSS** — most predictable, no build step, good for self-contained / portable blocks.
- **Tailwind** — fast iteration across many blocks; scoped to `.proto-blocks-scope`, needs compilation.
- **Theme styles** — not a primary method; use to inherit global design tokens / typography into the editor preview alongside either of the above.
