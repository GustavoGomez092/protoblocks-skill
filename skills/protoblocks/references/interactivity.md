# Frontend Interactivity

Proto-Blocks supports three approaches for frontend behavior. **The Interactivity API is optional** — plain JS or jQuery work fine. Pick by complexity.

| Approach | Best for | block.json key |
|----------|----------|----------------|
| Plain JavaScript | simple toggles, one-off DOM work, animations | `"viewScript": "file:./view.js"` |
| ES modules | modern syntax, imports, organization | `"viewScriptModule": "file:./view.js"` |
| Interactivity API | reactive state, multiple instances sharing state | `"viewScriptModule"` + `supports.interactivity: true` |

The plugin also auto-detects a `view.js` (or `{block-name}.js`) in the block folder and registers it — but declaring the key in `block.json` is the clean, explicit way.

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

## Editor note

The editor preview is server-rendered; interactivity runs on the **frontend**. To verify `data-wp-*` behavior, view the block on the front end, not in the editor.
