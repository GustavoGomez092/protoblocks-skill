# Frontend Interactivity

Proto-Blocks supports three approaches for frontend behavior. **The Interactivity API is optional** — plain JS or jQuery work fine. Pick by complexity.

| Approach | Best for | block.json key |
|----------|----------|----------------|
| Plain JavaScript | simple toggles, one-off DOM work, animations | `"viewScript": "file:./view.js"` |
| ES modules | modern syntax, imports, organization | `"viewScriptModule": "file:./view.js"` |
| Interactivity API | reactive state, multiple instances sharing state | `"viewScriptModule"` + `supports.interactivity: true` |

The plugin also auto-detects a `view.js` (or `{block-name}.js`) in the block folder and registers it — but declaring the key in `block.json` is the clean, explicit way.

## Scroll-reveal animations (`data-proto-animate`)

For entrance/scroll-reveal animations, don't hand-roll an IntersectionObserver — the plugin ships a reveal runtime (2.4.0+) that owns the lifecycle and **guarantees content is never left hidden** (scroll-in, `prefers-reduced-motion`, no-JS `<noscript>`, and a watchdog). If your `view.js` drives the motion itself (e.g. a GSAP timeline), mark the root `data-proto-animate="manual"` (emitted only on the frontend, gated by `$is_preview`) so the runtime skips it and only backstops it; set `data-proto-animate="done"` when your animation runs. For CSS-only reveals, use `"pending"` and let the runtime flip it.

To start a `view.js` animation exactly when an element comes into view without wiring your own IntersectionObserver, listen for the bubbling `proto-blocks:reveal` CustomEvent the runtime dispatches on each element when it flips to `done`:

```js
el.addEventListener('proto-blocks:reveal', () => { /* animate now */ });
```

See `references/templates.md` and the plugin's `docs/animation.md`.

## 1. Plain JavaScript

`block.json`:
```json
{ "viewScript": "file:./view.js" }
```
`view.js`:
```js
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.my-accordion__trigger').forEach((trigger) => {
    trigger.addEventListener('click', () => {
      trigger.closest('.my-accordion__item')?.classList.toggle('is-open');
    });
  });
});
```

(You can also drop a plain `<script>` inline in `template.php` for trivial per-block JS — the bundled `tl-header` block does this for its mobile menu toggle. Prefer a real `view.js` for anything non-trivial.)

## 2. ES modules

`block.json`:
```json
{ "viewScriptModule": "file:./view.js" }
```
A `view.js` containing `import`/`export` is treated as a module. WordPress loads it as a module script.

## 3. WordPress Interactivity API

Declarative, reactive state. Three parts: enable the support, mark up the template with `data-wp-*` directives, and define a store.

`block.json` — enable the support, point at the module, and (Proto-Blocks managed registration) declare the store namespace:
```json
{
  "supports": { "interactivity": true },
  "viewScriptModule": "file:./view.js",
  "protoBlocks": {
    "version": "1.0",
    "template": "template.php",
    "interactivity": { "store": "proto-blocks/accordion" }
  }
}
```
- `supports.interactivity: true` turns on WordPress's Interactivity runtime for the block.
- `protoBlocks.interactivity.store` tells Proto-Blocks to register the block's `view.js` as a script module with the `@wordpress/interactivity` dependency (managed registration; matches the namespace you pass to `store()`).

`template.php` — set initial context and bind with `data-wp-*` (these attributes are **preserved** in output, unlike `data-proto-*`):
```php
<?php $context = ['isOpen' => false]; ?>
<div
  data-wp-interactive="proto-blocks/accordion"
  data-wp-context='<?php echo wp_json_encode($context); ?>'
>
  <button
    class="accordion__trigger"
    data-wp-on--click="actions.toggle"
    data-wp-bind--aria-expanded="context.isOpen"
  ><?php echo esc_html($item['title'] ?? ''); ?></button>

  <div class="accordion__panel" data-wp-bind--hidden="!context.isOpen">
    <?php echo wp_kses_post($item['content'] ?? ''); ?>
  </div>
</div>
```

`view.js` — the store (namespace must match `data-wp-interactive`):
```js
import { store, getContext } from '@wordpress/interactivity';

store('proto-blocks/accordion', {
  state: {
    // getters can read context + state
  },
  actions: {
    toggle() {
      const ctx = getContext();
      ctx.isOpen = !ctx.isOpen;
    },
  },
});
```

Common directives: `data-wp-interactive="ns"`, `data-wp-context='{...}'`, `data-wp-on--click="actions.x"`, `data-wp-bind--<attr>="state.y"` (or `context.y`, or `!context.y`), `data-wp-class--<name>="state.z"`. Requires WordPress 6.5+. The bundled `accordion` example is the full working reference (per-item open state, `allowMultiple` handling, `openAll`/`closeAll`).

### Two state shapes

Context nests: a child element's `data-wp-context` is **merged** with its ancestors', so `getContext()` inside an item sees both the block-level state and the item's own keys. That gives you two common patterns:

- **Per-item toggle** (accordion): each item owns its own boolean. Put the state in (or per) the item; toggle it independently.
- **Shared single selection** (tabs, carousels): the *active index* lives in **block-level** context; each item carries its own `index`; a getter compares them.

```php
<!-- tabs: shared activeTab at block level, index per item -->
<div data-wp-interactive="proto-blocks/tabs" data-wp-context='{ "activeTab": 0 }'>
  <?php foreach ($tabs as $i => $tab) : ?>
    <button
      data-wp-context='<?php echo wp_json_encode(["index" => $i]); ?>'
      data-wp-on--click="actions.select"
      data-wp-class--is-active="state.isActive"
    ><?php echo esc_html($tab['label'] ?? ''); ?></button>
  <?php endforeach; ?>
  <?php foreach ($tabs as $i => $tab) : ?>
    <div data-wp-context='<?php echo wp_json_encode(["index" => $i]); ?>'
         data-wp-bind--hidden="!state.isActive">
      <?php echo wp_kses_post($tab['body'] ?? ''); ?>
    </div>
  <?php endforeach; ?>
</div>
```
```js
import { store, getContext } from '@wordpress/interactivity';
store('proto-blocks/tabs', {
  state: { get isActive() { const c = getContext(); return c.index === c.activeTab; } },
  actions: { select() { const c = getContext(); c.activeTab = c.index; } },
});
```
Because the editor preview is server-rendered (no JS runtime), also server-render the initial state so the editor looks right: add `is-active` to the first tab and `hidden` to the non-first panels in PHP.

## Complete reference — the Accordion block

This is the bundled `accordion` example verbatim — a repeater + Interactivity API with single/multiple-open support, full ARIA, and server-rendered initial state. Copy and adapt it. Open state is kept as an `openItems` array in **block-level** context (so one place controls all items), each item carries its own `index`, and `allowMultiple` (a toggle control) is passed into context to drive the toggle logic.

`template.php`:
```php
<?php
/** @var array $attributes  @var WP_Block|null $block */
$items          = $attributes['items'] ?? [];
$allow_multiple = $attributes['allowMultiple'] ?? false;
$first_open     = $attributes['firstOpen'] ?? true;
$icon_position  = $attributes['iconPosition'] ?? 'right';
$is_preview     = ! isset( $block ) || $block === null;

// Preview seeding (and bail on empty frontend)
if ( empty( $items ) ) {
    if ( $is_preview ) {
        $items = [
            [ 'id' => 'preview-1', 'title' => 'Accordion Item 1', 'content' => 'Click to edit this content...' ],
            [ 'id' => 'preview-2', 'title' => 'Accordion Item 2', 'content' => 'Add more items using the repeater...' ],
        ];
    } else {
        return;
    }
}

$block_id = $is_preview ? 'preview-' . uniqid() : 'accordion-' . ( $block->context['postId'] ?? uniqid() );

$classes = [ 'proto-accordion', 'proto-accordion--icon-' . esc_attr( $icon_position ) ];

// Initial Interactivity state lives at block level
$context = [
    'allowMultiple' => $allow_multiple,
    'openItems'     => $first_open ? [ 0 ] : [],
];

$wrapper_attributes = get_block_wrapper_attributes( [
    'class'               => implode( ' ', $classes ),
    'data-wp-interactive' => 'proto-blocks/accordion',
    'data-wp-context'     => wp_json_encode( $context ),
] );
?>
<div <?php echo $wrapper_attributes; ?> data-proto-repeater="items">
    <?php foreach ( $items as $index => $item ) :
        $item_id = $block_id . '-' . $index;
        $is_open = $first_open && 0 === $index; ?>
        <div
            class="proto-accordion__item"
            data-proto-repeater-item
            data-wp-context='{"index": <?php echo $index; ?>}'
            data-wp-class--is-open="state.isItemOpen"
        >
            <h3 class="proto-accordion__header">
                <button
                    type="button"
                    class="proto-accordion__trigger"
                    id="<?php echo esc_attr( $item_id ); ?>-trigger"
                    aria-expanded="<?php echo $is_open ? 'true' : 'false'; ?>"
                    aria-controls="<?php echo esc_attr( $item_id ); ?>-panel"
                    data-wp-on--click="actions.toggle"
                    data-wp-bind--aria-expanded="state.isItemOpen"
                >
                    <span class="proto-accordion__title" data-proto-field="title"><?php echo esc_html( $item['title'] ?? '' ); ?></span>
                    <span class="proto-accordion__icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </span>
                </button>
            </h3>
            <div
                id="<?php echo esc_attr( $item_id ); ?>-panel"
                class="proto-accordion__panel"
                role="region"
                aria-labelledby="<?php echo esc_attr( $item_id ); ?>-trigger"
                data-wp-bind--hidden="!state.isItemOpen"
                <?php echo ! $is_open ? 'hidden' : ''; ?>
            >
                <div class="proto-accordion__content" data-proto-field="content"><?php echo wp_kses_post( $item['content'] ?? '' ); ?></div>
            </div>
        </div>
    <?php endforeach; ?>
</div>
```

`view.js` (declare it via `"viewScriptModule": "file:./view.js"` + `supports.interactivity: true` + `protoBlocks.interactivity.store: "proto-blocks/accordion"`):
```js
import { store, getContext } from '@wordpress/interactivity';

store('proto-blocks/accordion', {
  state: {
    get isItemOpen() {
      const { index, openItems = [] } = getContext();
      return openItems.includes(index);
    },
  },
  actions: {
    toggle() {
      const context = getContext();
      const { index } = context;
      if (typeof index !== 'number') return;

      const openItems = [...(context.openItems || [])];
      const at = openItems.indexOf(index);
      if (at > -1) {
        openItems.splice(at, 1);          // close
      } else if (context.allowMultiple) {
        openItems.push(index);            // open (keep others)
      } else {
        openItems.length = 0;             // open (single mode)
        openItems.push(index);
      }
      context.openItems = openItems;
    },
    openAll() {
      const context = getContext();
      const items = document.querySelectorAll('[data-wp-context] .proto-accordion__item');
      context.openItems = Array.from({ length: items.length }, (_, i) => i);
    },
    closeAll() {
      getContext().openItems = [];
    },
  },
});
```

Things to notice you can reuse anywhere: server-rendered `aria-expanded`/`hidden` initial values so the block reads correctly before JS runs; `data-wp-class--is-open` for CSS state; the `allowMultiple` toggle control threaded into context to change behavior; unique per-instance ids for ARIA wiring.

## Loading JS in the editor (interactive embeds)

A block's `view.js` / `viewScript` runs on the **front end only** — it does *not* run in the editor, and the editor preview is server-rendered HTML with no per-block JS. So a block that embeds a third-party widget (a HubSpot form, Calendly, a map) shows nothing in the editor unless you also load that widget's script into the editor.

**The hook that reaches the editor canvas is `enqueue_block_assets`.** In WP 6.3+/7.0 the editor canvas is an **iframe**, and assets enqueued on `enqueue_block_assets` load in **both** the front end and that canvas iframe. (`enqueue_block_editor_assets` loads only in the editor *parent* document, which cannot reach the block previews inside the iframe.)

Two things make a third-party embed render in the editor:

1. **Output the embed target in the editor too.** Render the same container in `template.php` for both editor and front end (don't swap it for a placeholder), so the script has something to fill.
2. **Enqueue a small loader on `enqueue_block_assets`** that boots the widget. Because the editor injects (and re-renders) block previews *after* load, scan with a `MutationObserver` and load the third-party script idempotently.

```php
// functions.php (or an inc/ file)
add_action('enqueue_block_assets', function () {
    $rel = '/assets/js/my-embeds.js';
    wp_enqueue_script(
        'my-embeds',
        get_stylesheet_directory_uri() . $rel,
        [],
        (string) filemtime(get_stylesheet_directory() . $rel),
        true
    );
});
```

```js
// assets/js/my-embeds.js — example: HubSpot forms (.hs-form-frame[data-portal-id])
(function () {
  function loadPortal(portal) {
    if (!portal || document.getElementById('hsforms-embed-' + portal)) return;
    var s = document.createElement('script');
    s.id = 'hsforms-embed-' + portal;
    s.src = 'https://js.hsforms.net/forms/embed/' + portal + '.js';
    s.defer = true;
    document.head.appendChild(s);
  }
  function inEditor() {
    return !!document.body &&
      document.body.classList.contains('block-editor-iframe__body');
  }
  function scan() {
    var frames = document.querySelectorAll('.hs-form-frame[data-portal-id]');
    if (!frames.length) return;
    // In the editor the embed is a visual preview only: make it non-interactive
    // so clicking it selects the block (instead of the iframe swallowing clicks).
    if (inEditor() && !window.__pbEmbedEditorCss) {
      window.__pbEmbedEditorCss = true;
      var st = document.createElement('style');
      st.textContent = '.hs-form-frame, .hs-form-frame * { pointer-events: none !important; }';
      document.head.appendChild(st);
    }
    frames.forEach(function (f) { loadPortal(f.getAttribute('data-portal-id')); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
  else scan();
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
})();
```

Key points:
- **Detect the editor** via the `block-editor-iframe__body` class on the canvas `<body>` (present only inside the editor iframe).
- **Cross-origin iframe embeds aren't usefully interactive in the editor** — and if left interactive they *swallow clicks*, so you can't select the block. Set `pointer-events: none` on the embed in the editor (above) so it's visible but clicking it selects the block. It stays fully interactive on the front end.
- Keep the loader **idempotent** (guard the injected `<script>`/`<style>` by id/flag) — both `enqueue_block_assets` and the `MutationObserver` invoke it repeatedly.

## Editor note

For `view.js` / Interactivity API behavior, the editor preview is server-rendered and your `view.js` does **not** run there — verify `data-wp-*` behavior on the front end. The one way to run JS in the editor canvas is the `enqueue_block_assets` loader pattern above (for third-party embeds), not the block's `view.js`.
