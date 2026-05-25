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

**Compilation is automatic — there is no separate build step you run.** The plugin ships its own Tailwind runtime: it manages a standalone Tailwind CLI binary and compiles the CSS for you. You write classes in `template.php`; the plugin scans all blocks, compiles, scopes, and serves the result. (You never run `npm`/`tailwindcss` yourself for this.)

How it works:
- The plugin uses a **bundled Tailwind CLI binary** (downloaded once from Tailwind's official releases, managed by the plugin; falls back to `npx @tailwindcss/cli` if available). Compilation requires PHP shell access (`exec()`).
- A scanner reads all blocks' templates for Tailwind classes, compiles CSS, and caches the output to `wp-content/cache/proto-blocks/`.
- The compiled CSS is **scoped to `.proto-blocks-scope`** so block utilities don't leak into the rest of the site. Selectors are rewritten (e.g. `.rounded-full` → `.proto-blocks-scope.rounded-full, .proto-blocks-scope .rounded-full`). Global at-rules (`:root`, keyframes, font-face, etc.) are not scoped.

### Two compilation modes (dev vs prod)

Set in the plugin's Tailwind admin settings (stored in the `proto_blocks_tailwind` option):

| Mode | Behavior | Use for |
|------|----------|---------|
| `on_reload` (**dev**) | Regenerates the Tailwind CSS on **every page load**, so new classes appear immediately. | Active development. |
| `cached` (**prod**, default) | Compiles once and serves the cached CSS. New classes do **not** appear until a recompile is triggered. | Production. |

So while iterating, use **dev (`on_reload`) mode** and your classes always reflect the current markup. In **prod (`cached`) mode**, after adding new classes trigger a recompile (clear the cache / re-save Tailwind settings) or they won't show.

Manager API (programmatic):
```php
\ProtoBlocks\Tailwind\Manager::getInstance()->isEnabled();
\ProtoBlocks\Tailwind\Manager::getInstance()->setMode('on_reload'); // 'cached' | 'on_reload'
```
An option also exists to disable WordPress global styles when they conflict with Tailwind's reset.

**First-time setup:** download the Tailwind binary once from the plugin's Tailwind settings page. Until the binary (or `npx`) is available, no Tailwind CSS is generated and classes have no effect — see Troubleshooting below.

### Themed colors (admin-configurable)

Tailwind blocks get three built-in color scales whose base values are set in **Proto-Blocks → Tailwind Settings**:

| Scale | Utilities | CSS variable | Default |
|-------|-----------|--------------|---------|
| `primary-50`…`primary-950` | `bg-primary-600`, `text-primary-500`, `border-primary-700`, … | `--tw-color-primary-*` | blue |
| `secondary-50`…`secondary-950` | `bg-secondary-500`, `text-secondary-600`, … | `--tw-color-secondary-*` | teal |
| `accent-50`…`accent-950` | `bg-accent-500`, … | `--tw-color-accent-*` | red |

```php
<button class="bg-primary-600 hover:bg-primary-700 text-white">Click me</button>
<span class="text-secondary-500">Secondary</span>
```
Using these instead of hard-coded hex keeps blocks on-brand and re-themeable from the admin. (The bundled `tl-hero` uses `bg-primary-500 hover:bg-primary-400`.)

### Theme design tokens (`tailwind-theme.css`, Tailwind v4)

Proto-Blocks compiles **Tailwind v4** at runtime and reads design tokens from a CSS file **in your active theme**, not the database — so your palette/fonts/shadows live in version control. Default location:

```
wp-content/themes/<active-theme>/tailwind-theme.css
```

The file holds a single Tailwind v4 `@theme { … }` block; anything declared there becomes a utility on the next compile:

```css
/* themes/your-theme/tailwind-theme.css */
@theme {
  --color-brand:     #D1001D;
  --color-brand-700: #A0001A;
  --font-display:    "Manrope", ui-sans-serif, system-ui, sans-serif;
  --shadow-glow:     0 38px 41.5px rgba(208,0,29,0.10);
}
```
→ generates `bg-brand`, `text-brand`, `border-brand`, `bg-brand-700`, `font-display`, `shadow-glow`, etc., usable in any block template.

- **Create it:** Tailwind Settings → "Create starter file" writes a minimal `tailwind-theme.css` into the active theme (button hidden once it exists).
- **Relocate it:** `add_filter('proto_blocks_theme_css_path', fn() => WP_CONTENT_DIR . '/design-tokens.css');` (useful for monorepos).
- **Force a recompile from CLI:** `wp eval 'ProtoBlocks\Core\Plugin::getInstance()->getTailwindManager()->compile();'`

### Scoped preflight

Tailwind's reset would clobber WordPress theme defaults globally, so Proto-Blocks emits its preflight wrapped in `:where(.proto-blocks-scope)` at **zero specificity**. Result: resets apply only inside rendered blocks; your theme's styles still win outside blocks; author utility classes always beat preflight. Opt out if your theme has its own reset:
```php
add_filter('proto_blocks_preflight', '__return_false');
```

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
| Build step | none | none you run — the plugin compiles automatically (bundled Tailwind runtime); one-time binary download |
| Isolation | your own class names | auto-scoped to `.proto-blocks-scope` |
| Editor/frontend parity | identical (same stylesheet both places) | identical (compiled CSS loaded both places) |
| Best when | the block has a distinct, hand-crafted design; you want zero build; you're shipping the block standalone | you're building many blocks fast, reusing a design system / spacing scale, iterating in markup |
| Watch out for | class-name collisions if not namespaced | binary must be downloaded once; in prod (`cached`) mode new classes need a recompile (dev `on_reload` mode regenerates each load); scoping means utilities don't apply outside the scope wrapper |

**Decision guide:**
- **Use vanilla CSS** for a one-off, visually distinctive block, when you want no toolchain, or when the block must be portable/exported cleanly. Co-locate `style.css`; namespace classes (`.my-block__title`).
- **Use Tailwind** when you're producing a *set* of blocks and want consistent spacing/colors and fast iteration without round-tripping to a CSS file. Compilation is automatic (the plugin bundles the Tailwind runtime); you just download the binary once and pick dev/prod mode, and work within the `.proto-blocks-scope` boundary.
- **Don't mix the two inside a single block** unless you have a reason — pick one as that block's primary styling method to keep it readable. Either way you can still pull in theme tokens via editor styles.
- **Consistency beats preference:** match whatever the surrounding blocks in the project already use. The setup wizard records a project-wide default in `proto_blocks_component_style` — follow it.

If you choose Tailwind and classes don't apply, the cause is almost always (1) the Tailwind binary hasn't been downloaded in plugin settings, or (2) you're in prod (`cached`) mode and haven't recompiled — see the Tailwind section above and Troubleshooting.

## Choosing among all three

- **Vanilla CSS** — most predictable, no build step, good for self-contained / portable blocks.
- **Tailwind** — fast iteration across many blocks; scoped to `.proto-blocks-scope`, needs compilation.
- **Theme styles** — not a primary method; use to inherit global design tokens / typography into the editor preview alongside either of the above.
