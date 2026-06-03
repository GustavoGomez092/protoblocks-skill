# Repeaters

A repeater field is a repeatable list of sub-fields — the way to build accordions, stat grids, nav menus, feature lists, etc. Declared as a field with `type: "repeater"` and a `fields` map of per-item sub-fields.

## Definition (block.json)

```json
"items": {
  "type": "repeater",
  "min": 1,
  "max": 20,
  "itemLabel": "title",
  "collapsible": true,
  "fields": {
    "title":   { "type": "text", "tagName": "span", "label": "Title" },
    "content": { "type": "wysiwyg", "label": "Content" }
  }
}
```

| Option | Meaning |
|--------|---------|
| `fields` | **Required.** Sub-field definitions, same syntax as top-level fields. |
| `min` | Minimum item count (validation; e.g. `1`). |
| `max` | Maximum item count (e.g. `20`). |
| `itemLabel` | Which sub-field's value labels each item in the editor list. |
| `collapsible` | Whether items can collapse in the editor. |

## Value shape

An array of objects. **Every item carries an auto-generated `id`** plus its sub-fields:

```php
$attributes['items'] = [
  ['id' => 'item_1700000000_abc123', 'title' => 'First',  'content' => '<p>...</p>'],
  ['id' => 'item_1700000001_def456', 'title' => 'Second', 'content' => '<p>...</p>'],
];
```

The `id` is generated automatically (UUID) if missing — you don't set it, but you can use it as a loop key / anchor.

## Template markup

Three things are required and must line up:

1. `data-proto-repeater="items"` on the **container** — name must match the field name.
2. `data-proto-repeater-item` on **each item** element (one per loop iteration).
3. `data-proto-field="subFieldName"` on elements **inside** each item, matching the sub-field names.

```php
<?php $items = $attributes['items'] ?? []; ?>
<div <?php echo get_block_wrapper_attributes(['class' => 'accordion', 'data-proto-repeater' => 'items']); ?>>
  <?php foreach ($items as $item) : ?>
    <div class="accordion__item" data-proto-repeater-item>
      <button class="accordion__trigger" type="button">
        <span class="accordion__title" data-proto-field="title">
          <?php echo esc_html($item['title'] ?? ''); ?>
        </span>
      </button>
      <div class="accordion__panel">
        <div class="accordion__content" data-proto-field="content">
          <?php echo wp_kses_post($item['content'] ?? ''); ?>
        </div>
      </div>
    </div>
  <?php endforeach; ?>
</div>
```

The parser reads the first item's structure to learn the repeater's sub-fields, so render at least one item's full markup. **Always seed a placeholder item in preview** — if a repeater can be empty (`min: 0`) and renders zero `data-proto-repeater-item` elements, the parser has no markup to learn the sub-fields from and the repeater can't be edited. Seed under a preview check:

```php
$items = $attributes['items'] ?? [];
$is_preview = ! isset($block) || $block === null;
if (empty($items) && $is_preview) {
    $items = [['id' => 'preview-1', 'title' => 'Example', 'content' => '']];
}
```

> `get_block_wrapper_attributes()` applies to the block's **outermost** element. If your repeater container is a nested element, put `data-proto-repeater="..."` **directly on that nested element** — not through the wrapper helper.

### Object-valued sub-fields (link/image inside a repeater)

A repeater item is a flat dict keyed by sub-field name, but a sub-field can itself hold an object (a `link` or `image`). Mind the nesting: if a sub-field is named `url` and is a `link`, then `$item['url']` is the **link object**, and the actual href is `$item['url']['url']`.

```php
<li data-proto-repeater-item>
  <span data-proto-field="platform"><?php echo esc_html($item['platform'] ?? ''); ?></span>
  <?php $link = $item['url'] ?? []; // link sub-field named "url" → an object ?>
  <a data-proto-field="url"
     href="<?php echo esc_url($link['url'] ?? '#'); ?>"
     <?php echo !empty($link['target']) ? 'target="' . esc_attr($link['target']) . '"' : ''; ?>>
    <?php echo esc_html($link['text'] ?? ''); ?>
  </a>
</li>
```

Pull the object into a local variable first (`$link = $item['url']`) so you never accidentally `esc_url($item['url'])` an array. To avoid confusion, prefer a distinct sub-field name (e.g. `profileLink`) over `url`.

## How the editor handles repeaters

- Drag-and-drop reordering, plus per-item duplicate / remove, and an "add between" (`+`) button.
- New items use the existing markup as a template (the first item acts as a stub while a new one loads).
- Items render using the real template markup, so styling matches the frontend.
- Each item shows a floating overlay toolbar (drag / link / duplicate / remove) on hover; it's absolutely positioned and never participates in the item's layout.
- **The "add between" button is teleported and flow-aware.** It renders through a portal into the editor's top-level popover layer, not inside the item — so an item with `overflow: hidden` (rounded corners, inner shadows) can't clip it. Its placement follows the rendered flow direction: items in a **row** get the `+` on the **right edge**; **stacked** items get it on the **bottom edge** (measured from geometry, so flex rows, grids, and wrapped grids all place it correctly). Nothing to configure.

### Item-level link editing (whole-card & icon-only links)

When a repeater declares a `link` sub-field, how you edit it depends on the markup:

- **Inline** — if the element carrying the link is bound with `data-proto-field="<linkField>"` (so it has editable link text), edit it inline as usual via the link-settings popover.
- **Toolbar** — if the item **is** or **contains** an `<a>` but the link field is **not** bound to an inline `data-proto-field` element, a link button appears in the item's overlay toolbar. It opens a URL + "open in new tab" popover. This is how you make a **whole-card link** (the entire item is the `<a>`) or an **icon-only link** (an `<a>` with no text node) editable — there's nothing inline to bind, so the URL is edited from the toolbar. The toolbar control is suppressed when the link is already bound inline, so a field never gets two editors.

```php
<!-- Whole-card link: the item IS the <a>, no inner data-proto-field for the
     link → its URL is editable from the item's toolbar. -->
<a data-proto-repeater-item class="card"
   href="<?php echo esc_url($item['cardLink']['url'] ?? '#'); ?>"
   <?php echo !empty($item['cardLink']['target']) ? 'target="' . esc_attr($item['cardLink']['target']) . '"' : ''; ?>>
  <span data-proto-field="title"><?php echo esc_html($item['title'] ?? ''); ?></span>
</a>
```

Declared as a normal `link` sub-field:

```json
"fields": {
  "title":    { "type": "text" },
  "cardLink": { "type": "link" }
}
```

## Min / max

`min`/`max` are enforced during validation and reflected in the editor (e.g. remove disabled at `min`, add disabled at `max`). They don't change the template — your `foreach` simply iterates whatever items exist.

## Multiple repeaters & nesting

- A block may have **multiple repeater fields** (e.g. a footer with `column1Links` and `column2Links`). Each needs its own uniquely named container.
- Repeater items can contain any editable fields. Each item is a flat dict of its sub-fields (`$item['fieldName']`).
- When processing the template, the parser skips `data-proto-field` elements that are nested inside a repeater container during the top-level pass, so item fields are only bound within their repeater.

## Common repeater mistakes

| Symptom | Cause | Fix |
|---------|-------|-----|
| Items don't render | No `data-proto-repeater-item`, or container name ≠ field name | Add the item attr; match `data-proto-repeater="items"` to field `items` |
| Can't add/reorder in editor | Missing `data-proto-repeater` on container | Add it to the wrapper (or via `get_block_wrapper_attributes`) |
| Sub-field not editable | `data-proto-field` missing inside the item, or rendered only when non-empty | Always render the element with `data-proto-field` |
| `id` undefined in PHP | Reading `$item['id']` when seeding preview items by hand | Provide an `id` in seeded preview items |
