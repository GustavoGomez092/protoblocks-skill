# Troubleshooting

Symptom → cause → fix. Grouped by area.

## Registration / discovery

| Symptom | Cause | Fix |
|---------|-------|-----|
| Block not in inserter | Missing `block.json` or template file | Block folder needs both `block.json` and `template.php` (or legacy `{folder}.json`/`{folder}.php`). |
| Block not in inserter | Folder not under a discovered path | Put it in `theme/proto-blocks/{name}/`, or add the path via `proto_blocks_paths`. |
| Wrong block name | Relying on the default | Default is `proto-blocks/{folder}`. Set `name` explicitly as `namespace/block-name`. |
| "Validation error" | `name` missing, or a `select` control without `options` | Add `name`; give every select/radio `options`. Run `wp proto-blocks validate`. |
| Edited block.json ignored | Template/schema cached | `wp proto-blocks cache clear`. |

## Editing in the editor

| Symptom | Cause | Fix |
|---------|-------|-----|
| Field shows but isn't editable | Element missing `data-proto-field` | Add `data-proto-field="name"` to the element. |
| Field disappears / can't click when empty | Element only rendered when value is non-empty | Always render the element (with its `data-proto-field`) even when empty. |
| Inline formatting toolbar missing/limited on a text field | `format` restricts it | Set `"format": "standard"` or `"full"` on the text field. |
| Control doesn't appear in sidebar | Field/control name collision (field wins) or unknown type | Rename so field and control don't share a name; check the control type. |
| Conditional control never shows | Condition references wrong control/value | `conditions.visible` keys are other control names; scalar = equality, array = membership. |

## Templates / output

| Symptom | Cause | Fix |
|---------|-------|-----|
| Template changes don't appear | Output cached | `wp proto-blocks cache clear`, or set `PROTO_BLOCKS_CACHE_ENABLED` false while developing. |
| Rich text shows raw `<p>` tags | Escaped with `esc_html()` | Use `wp_kses_post()` for wysiwyg/HTML values. |
| PHP warning: undefined array key | No null-coalescing default | `$attributes['x'] ?? ''` everywhere. |
| `$block` errors in editor | Code assumes frontend context | `$block` is `null` in preview — guard with `$is_preview = !isset($block) || $block === null;`. |
| Underscore vs hyphen attribute name | Hyphenated keys are underscored in `$attributes` | Read the underscored form in PHP. |
| `data-proto-*` visible in page source | (shouldn't happen) | They're stripped on render; if visible, the element wasn't processed — check the attribute spelling. |

## Repeaters

| Symptom | Cause | Fix |
|---------|-------|-----|
| Items don't render | Container name ≠ field name, or no `data-proto-repeater-item` | Match `data-proto-repeater="items"` to field `items`; add `data-proto-repeater-item` per item. |
| Can't add / reorder items | Missing `data-proto-repeater` on container | Add it (directly or via `get_block_wrapper_attributes`). |
| Sub-field not editable | `data-proto-field` missing inside item | Add it inside the item markup, matching a sub-field name. |
| New items render blank | Parser couldn't read item structure | Ensure the first item renders full markup for every sub-field. |

## Styling

| Symptom | Cause | Fix |
|---------|-------|-----|
| Tailwind classes have no effect | `useTailwind` off, or class not yet compiled | Set `"useTailwind": true`; recompile (clear cache or use `on_reload` mode). |
| Tailwind styles leak / get overridden | Scoping to `.proto-blocks-scope` | Expected — utilities are scoped; ensure your markup is inside the scoped wrapper. |
| `style.css` not loading | Wrong filename/location | Use `style.css` or `{block-name}.css` in the block folder. |
| Editor preview looks different from front end | Theme editor styles not loaded | The plugin injects theme editor styles; confirm theme registers them. |

## Interactivity

| Symptom | Cause | Fix |
|---------|-------|-----|
| `view.js` not running | Not detected / wrong type | Plain script → `view.js`; ES module → use `viewScriptModule`; Interactivity API → set `protoBlocks.interactivity`. |
| `data-wp-*` directives ignored | Interactivity API not enabled / WP too old | Enable `protoBlocks.interactivity`; requires WP 6.5+. |
| Interactivity store not found | Namespace mismatch | `data-wp-interactive` namespace must match the `store('namespace', ...)` id. |

## Quick diagnostic order

1. `wp proto-blocks list` — is the block registered?
2. `wp proto-blocks validate <name>` — schema errors/warnings?
3. `wp proto-blocks cache clear` — stale output?
4. Check every editable element has `data-proto-field` and is always rendered.
5. Check escaping (`wp_kses_post` for HTML) and `?? ''` defaults.
