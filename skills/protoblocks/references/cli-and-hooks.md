# CLI, Hooks, Discovery & Admin

## WP-CLI commands

Registered under `wp proto-blocks`:

| Command | Args / options | Purpose |
|---------|----------------|---------|
| `wp proto-blocks list` | `--format=table\|csv\|json\|yaml` | List all registered blocks. |
| `wp proto-blocks create <name>` | `--title`, `--description`, `--category`, `--fields="name:type,..."`, `--dir=theme\|plugin`, `--force` | Scaffold a new block. |
| `wp proto-blocks validate` | `[<name>]`, `--format=table\|json` | Validate block.json (all or one). |
| `wp proto-blocks cache clear` | — | Clear the template cache. |
| `wp proto-blocks cache stats` | — | Show cache statistics. |
| `wp proto-blocks export <name>` | `--output=<path>` | Export a block to a standalone directory. |

```bash
wp proto-blocks create hero --title="Hero" --fields="title:text,content:wysiwyg,image:image"
wp proto-blocks validate
wp proto-blocks cache clear
```

## Block discovery

Default search paths (first match wins; theme overrides examples):
1. `get_template_directory() . '/proto-blocks'` (active/parent theme)
2. `get_stylesheet_directory() . '/proto-blocks'` (child theme, if different)
3. `PROTO_BLOCKS_DIR . 'examples'` (only if `PROTO_BLOCKS_EXAMPLE_BLOCKS` is true)
4. Anything added via the `proto_blocks_paths` filter.

A folder is registered as a block when it contains both:
- `block.json` (or legacy `{folder}.json`), and
- `template.php` (or legacy `{folder}.php`).

The **folder name is the block slug**; the default block name is `proto-blocks/{folder}`.

Add a custom path (e.g. from a plugin):
```php
add_filter('proto_blocks_paths', function (array $paths) {
    $paths[] = plugin_dir_path(__FILE__) . 'blocks';
    return $paths;
});
```

## Actions & filters

| Hook | Type | Use |
|------|------|-----|
| `proto_blocks_init` | action | Fires after field types register (during `init` priority 5). Register **custom field/control types** here: `$plugin = func_get_arg(0); $plugin->getFieldRegistry()->register(...)`. |
| `proto_blocks_paths` | filter | Add block discovery paths (array of dirs). |
| `proto_blocks_discovered` | filter | Modify the discovered blocks map before registration. |
| `proto_blocks_registered` | action | Fires after all blocks are registered. |
| `proto_blocks_category_title` | filter | Block category display name (default "Proto Blocks"). |
| `proto_blocks_category_icon` | filter | Category icon (dashicon or null). |
| `proto_blocks_category_slug` | filter | Category slug (default `proto-blocks`). |

Register a custom field type:
```php
add_action('proto_blocks_init', function ($plugin) {
    $plugin->getFieldRegistry()->register('color', [
        'php_class'        => \MyTheme\Fields\ColorField::class,
        'attribute_schema' => ['type' => 'string', 'default' => '#000000'],
    ]);
});
```
(See `fields.md` for the `FieldInterface` contract.)

## Constants (override in `wp-config.php`)

| Constant | Default | Effect |
|----------|---------|--------|
| `PROTO_BLOCKS_DEBUG` | `false` | Debug mode. |
| `PROTO_BLOCKS_CACHE_ENABLED` | `true` | Toggle template caching. |
| `PROTO_BLOCKS_EXAMPLE_BLOCKS` | `true` | Register bundled example blocks. |

Also defined: `PROTO_BLOCKS_VERSION`, `PROTO_BLOCKS_FILE`, `PROTO_BLOCKS_DIR`, `PROTO_BLOCKS_URL`, `PROTO_BLOCKS_BASENAME`.

## Admin: Setup Wizard

A 4-step wizard runs after activation (welcome → choose styling approach vanilla/Tailwind → optionally install demo blocks → done). Tracked by the `proto_blocks_wizard_completed` option; styling preference stored in `proto_blocks_component_style`.

## Admin: Preview Capture

Auto-generates inserter thumbnails. The admin "Preview Capture" page renders each block in a hidden iframe, captures it to a PNG, and saves `preview.png` into the block's folder; the schema reader then auto-detects it. Full workflow (and the manual alternative) in `references/previews.md`.

## Block category

Proto-Blocks registers a custom inserter category that appears at the **top** of the block inserter.
- Defaults: title "Proto Blocks", slug `proto-blocks`, icon `layout` (dashicon).
- Rename in admin (Proto-Blocks → System Status → General Settings) or via filters: `proto_blocks_category_title`, `proto_blocks_category_icon`, `proto_blocks_category_slug`. If you change the slug, update each block's `"category"` to match.

## Demo blocks

The 9 example blocks (see `examples.md`) can be copied into the active theme's `proto-blocks/` directory:
- **Install:** Proto-Blocks admin → "Install Demo Blocks to Theme" (or the Setup Wizard). They're great editable references.
- **Remove:** Proto-Blocks admin → "Remove Demo Blocks" (your own blocks are untouched).
- They can also be registered in place (not copied) via `PROTO_BLOCKS_EXAMPLE_BLOCKS`.

## Editor preview system

The editor preview is **server-rendered**, not React-rendered:
1. The PHP template is rendered server-side via AJAX (`admin-ajax.php`).
2. The HTML is sent to the editor; `data-proto-field` elements are swapped for React editing components.
3. Changing a **control** (select/toggle/range/…) triggers a **full preview re-render**.
4. Editing a **field** (text/image/link) updates **inline** without a full refresh (faster).

Implication: `data-wp-*` interactivity runs on the **frontend**, not in the editor preview — verify interactive behavior on the front end.

## Debug mode

```php
define('PROTO_BLOCKS_DEBUG', true); // wp-config.php
```
Enables PHP error logging for registration/rendering, JS console logs for preview/attribute changes, and detailed errors in AJAX responses. Disable in production.
