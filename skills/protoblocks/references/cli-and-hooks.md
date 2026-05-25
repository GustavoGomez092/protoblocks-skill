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
