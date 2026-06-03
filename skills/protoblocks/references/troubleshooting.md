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
| Control change has no effect on output | Attribute name mismatch (case-sensitive) | Names are camelCase and must match exactly: `$attributes['imagePosition']` ↔ `block.json` `imagePosition` (not `image_position`). |

## Templates / output

| Symptom | Cause | Fix |
|---------|-------|-----|
| Template changes don't appear | Output cached | `wp proto-blocks cache clear`, or set `PROTO_BLOCKS_CACHE_ENABLED` false while developing. |
| Rich text shows raw `<p>` tags | Escaped with `esc_html()` | Use `wp_kses_post()` for wysiwyg/HTML values. |
| PHP warning: undefined array key | No null-coalescing default | `$attributes['x'] ?? ''` everywhere. |
| `$block` errors in editor | Code assumes frontend context | `$block` is `null` in preview — guard with `$is_preview = !isset($block) || $block === null;`. |
| Underscore vs hyphen attribute name | Hyphenated keys are underscored in `$attributes` | Read the underscored form in PHP. |
| `data-proto-*` visible in page source | (shouldn't happen) | They're stripped on render; if visible, the element wasn't processed — check the attribute spelling. |

## Inner blocks

| Symptom | Cause | Fix |
|---------|-------|-----|
| Not nestable — no `+` appender, treated as a leaf | Field type spelled `innerblocks` (no hyphen) — the editor parser only matches `inner-blocks` | Use `"type": "inner-blocks"` (hyphenated). |
| Not nestable — no slot | Template has no `data-proto-inner-blocks` element | Add a container with `data-proto-inner-blocks`. |
| Was nestable, now isn't | Stale saved instance (inserted before the field existed / while misspelled) | Delete the existing block and re-insert a fresh one — the editor reads stored markup. |
| Renders empty on the frontend | Template echoes `$content` | Echo `$innerBlocksContent ?? ''` instead (`$content` is never passed). |
| Container/wrapper feels off (no layout controls) | Missing `supports.layout` | Add `supports.layout.default = { "type": "constrained" }` for group-like blocks. |

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
| Tailwind classes have no effect | See dedicated section below | Most often: no first compile yet (shell host: binary not downloaded; managed host like WP Engine: hit **Compile CSS** to run the browser engine), or prod (`cached`) mode without a recompile. |
| Tailwind styles leak / get overridden | Scoping to `.proto-blocks-scope` | Expected — utilities are scoped; ensure your markup is inside the scoped wrapper. |
| `style.css` not loading | Wrong filename/location | Use `style.css` or `{block-name}.css` in the block folder. |
| Editor preview looks different from front end | Theme editor styles not loaded | The plugin injects theme editor styles; confirm theme registers them. |

### Tailwind classes aren't working

Compilation is automatic (the plugin bundles its own Tailwind runtime), so when classes have no effect it's almost never your markup. Check these in order:

1. **Has a first compile run?** Check the engine for the host (Proto Blocks → Tailwind settings shows the active engine):
   - **Shell host (CLI engine):** the standalone Tailwind binary must be downloaded **once** from the settings page (falls back to `npx` if available; needs PHP `exec()`). If never downloaded, **no CSS is generated** and every class silently does nothing. → Download the binary; confirm the status shows it installed/runnable.
   - **Managed host without shell access — WP Engine, etc. (browser engine):** there is **no binary and no `exec()` needed**; the CSS compiles in the browser. → Open Tailwind settings (status shows **"Browser compiler"**) and click **Compile CSS** once. Do **not** chase a "download the binary / needs exec" path here — that does not apply to this host.
2. **Are you in prod mode instead of dev mode?** In `cached` (prod) mode the CSS is compiled once and cached — newly added classes won't appear until you recompile. In `on_reload` (dev) mode the CSS regenerates on **every page load**, so changes show immediately. → While developing, switch to **dev (`on_reload`) mode**. In prod, trigger a recompile after adding classes (re-save Tailwind settings or `wp proto-blocks cache clear`).
3. **Is `useTailwind` enabled on the block?** → Set `"useTailwind": true` in the block's `protoBlocks` config.
4. **Is the element inside the scoped wrapper?** Compiled utilities are scoped to `.proto-blocks-scope`; markup outside that scope won't receive them. → Keep Tailwind-styled markup within the block's wrapper.

Quick rule of thumb: **classes do nothing at all** → no first compile yet (step 1 — download the binary on a shell host, or click Compile to run the browser engine on a managed host). **Old classes work but new ones don't** → prod/`cached` mode, needs recompile (step 2).

## Interactivity

| Symptom | Cause | Fix |
|---------|-------|-----|
| `view.js` not running | Not detected / wrong type | Plain script → `"viewScript"`; ES module → `"viewScriptModule"`; Interactivity API → `"viewScriptModule"` + `supports.interactivity: true`. |
| `data-wp-*` directives ignored | Interactivity runtime not enabled / WP too old | Add `supports.interactivity: true` (this enables the runtime) and load the store via `viewScriptModule`; optionally declare `protoBlocks.interactivity.store` for managed registration. Requires WP 6.5+. |
| Interactivity store not found | Namespace mismatch | `data-wp-interactive` namespace must match the `store('namespace', ...)` id. |

## Scroll-reveal animations (`data-proto-animate`)

| Symptom | Cause | Fix |
|---------|-------|-----|
| Content stuck invisible on the frontend | Element marked `data-proto-animate="manual"` (or `"pending"`) but block JS never set it to `done` and the watchdog hasn't fired | The runtime backstops within ~2s of load for in/above-viewport elements; if permanent, your `view.js` errored before setting `data-proto-animate="done"` — check the console. For CSS-only reveals use `"pending"` (the runtime flips it), not `"manual"`. |
| Content hidden until clicked/scrolled, no animation in editor | Working as intended — the attribute is gated by `$is_preview`, so it's frontend-only; the editor shows the resting state | None. Verify the template emits the attribute only when `!$is_preview`. |
| Reveal never animates (snaps in) | `prefers-reduced-motion` is on, or the `done` rule has no `transition` | Reduced motion intentionally reveals instantly. Otherwise put the `transition` on the `[data-proto-animate="done"]` rule. |
| Legacy `data-animate` block not revealing | Fine — `data-animate` is an accepted alias | Migrate to `data-proto-animate` when convenient; both are handled by the runtime. |

## Quick diagnostic order

1. `wp proto-blocks list` — is the block registered?
2. `wp proto-blocks validate <name>` — schema errors/warnings?
3. `wp proto-blocks cache clear` — stale output?
4. Check every editable element has `data-proto-field` and is always rendered.
5. Check escaping (`wp_kses_post` for HTML) and `?? ''` defaults.
