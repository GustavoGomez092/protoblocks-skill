# Frontend Interactivity

Proto-Blocks supports three approaches to frontend behavior, from simplest to most integrated.

## 1. Plain `view.js`

Add `view.js` (or `{block-name}.js`) to the block folder. If it's a classic script (no `import`/`export`), it's registered as `proto-blocks-{name}` and enqueued on the frontend. Optionally depend on jQuery by setting `protoBlocks.jquery` in `block.json`.

```js
// view.js
document.querySelectorAll('.accordion__trigger').forEach((btn) => {
  btn.addEventListener('click', () => {
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!expanded));
  });
});
```

Good for small, self-contained behavior.

## 2. ES module `view.js`

If `view.js` contains `import`/`export`, it's treated as an ES module and registered as a script module. Point `block.json`'s `viewScriptModule` at the file so WordPress loads it as a module.

```json
{ "viewScriptModule": "file:./view.js" }
```

## 3. WordPress Interactivity API

For reactive, declarative behavior, use the Interactivity API. Enable it via `protoBlocks.interactivity` in `block.json`; the plugin registers the block's `view.js` as a script module with `@wordpress/interactivity` as a dependency and enqueues it when the block renders.

In the template, drive behavior with `data-wp-*` directives (these are **preserved** in the output — unlike `data-proto-*`, which are stripped):

```php
<div
  data-wp-interactive="proto-blocks/accordion"
  data-wp-context='{ "isOpen": false }'
>
  <button data-wp-on--click="actions.toggle" data-wp-bind--aria-expanded="context.isOpen">
    <?php echo esc_html($item['title'] ?? ''); ?>
  </button>
  <div data-wp-bind--hidden="!context.isOpen">
    <?php echo wp_kses_post($item['content'] ?? ''); ?>
  </div>
</div>
```

```js
// view.js (ES module)
import { store, getContext } from '@wordpress/interactivity';

store('proto-blocks/accordion', {
  actions: {
    toggle() {
      const ctx = getContext();
      ctx.isOpen = !ctx.isOpen;
    },
  },
});
```

Requires WordPress 6.5+ for the Interactivity API. The bundled `accordion` example demonstrates this pattern.

## Choosing

| Need | Use |
|------|-----|
| A few event listeners | plain `view.js` |
| Module imports, no shared state | ES module `view.js` |
| Reactive UI, server-rendered state, multiple instances | Interactivity API (`data-wp-*` + `store`) |
