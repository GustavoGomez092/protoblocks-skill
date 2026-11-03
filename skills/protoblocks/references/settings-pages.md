# Settings pages (options pages)

Site-wide values (phone number, footer copy, tracking snippets, feature switches) live on a settings page declared in the theme: `proto-options/<slug>/page.jsonc` or `proto_options_page()` (Proto-Blocks 2.15.0+). The page renders the same field form as the meta boxes, saves through REST, and templates read values with `proto_field('<name>', 'option:<slug>')`. Edit declarations in **Proto Blocks > Options Pages**.

Plugin docs (Proto-Blocks repo): `docs/settings-pages.md`, `docs/fields.md`, `docs/trust-and-security.md`.

## When to use one

- A value shown on many pages or in a template part (header phone, footer copyright, social links) → settings page field, read in the header/footer block.
- A value per page or per post → a custom field (`custom-fields.md`), or a block field when it is layout copy.
- A setting on an existing core screen (Reading, General) → out of scope; keep it in PHP.

## `page.jsonc`, annotated

```jsonc
// proto-options/theme-settings/page.jsonc  -> slug "theme-settings" (the menu slug too)
{
  "title": "Theme Settings",            // required; no "<" or ">"
  // "menuTitle": "Theme",              // menu label (alias "menu_title"); default the title
  "menu": "top",                         // "top" | parent menu slug: "options-general.php", "edit.php?post_type=event", "themes.php"
  "capability": "manage_options",        // who can open the page AND save it; any capability, e.g. "manage_woocommerce"
  "icon": "dashicons-admin-generic",     // shown for top-level pages: a dashicon or a theme-relative .svg path
  // "position": 80,                    // menu position (integer)
  "autoload": true,                      // false: the page's options are stored with autoload off
  // "storage": { "mode": "fields" },   // default: one option per field, "<slug>_<field name>"
  "fields": [                            // bare fields (keys generated) or full ACF groups; both may mix
    { "name": "phone", "label": "Phone", "type": "text" },
    { "name": "email", "label": "Email", "type": "email" }
  ],
  "tabs": [                              // client-side tabs; each has a title and fields
    { "title": "Social", "fields": [
      { "name": "social_links", "label": "Social links", "type": "repeater", "sub_fields": [
        { "key": "field_social_label", "name": "label", "label": "Label", "type": "text" },
        { "key": "field_social_url", "name": "url", "label": "URL", "type": "url" }
      ] }
    ] },
    { "title": "Tracking", "fields": [
      { "name": "head_scripts", "label": "Head scripts", "type": "code", "bindings": false }
    ] }
  ],
  "children": [                          // real submenu pages under this one (one level only)
    { "slug": "footer", "title": "Footer", "fields": [ { "name": "copyright", "label": "Copyright", "type": "text" } ] }
  ]
}
```

Rules:

- **Page slug** = folder name, `^[a-z][a-z0-9-]{0,63}$` (hyphens, no underscores). From PHP the slug comes from the title (`Theme Settings` → `theme-settings`) or `$args['slug']`. Core screen slugs (`general`, `options`, `woocommerce`, ...) are reserved.
- **Child slug** is `<parent>-<child>`: `children[].slug: "footer"` above is page `theme-settings-footer`. A child takes `slug`, `title`, `capability`, `fields`, `tabs`, `storage`, `autoload`; children cannot have children. Children of a submenu page are listed beside it (`child_of_submenu` info).
- **Field names** on settings pages: `^[a-z][a-z0-9_]*$`, unique across the page (tabs included). Bare fields need no `key`; sub-fields of repeaters/groups do.
- Every field type from `custom-fields.md` works, conditional logic included. `code` (and `password`) values can only be saved by users with `unfiltered_html`; others see them read-only.
- Same as type files: no PHP callback keys, no `<`/`>` in titles, writes need `manage_options` + file mods + a network admin on multisite.

## Storage modes

| Mode | Where values live | Use |
|---|---|---|
| `fields` (default) | one option per field: `<page_slug>_<field_name>`, e.g. `theme-settings_phone`, `theme-settings-footer_copyright` (hyphens kept) | new pages |
| `{ "mode": "array", "option": "<name>" }` | every field of the page in one array option, keyed by field name | adopting a site that already stores its settings in one array option |

Option names that would hit protected core or plugin options (`siteurl`, `active_plugins`, salts, `cron`, ...) are refused (extend the list with the `proto_blocks_protected_options` filter). Two pages pointing at the same array option get a `shared_storage` warning. Emptied fields are stored empty, not deleted. Deleting a declaration keeps its saved values.

## Reading values

```php
<?php // in a header block's template.php
$phone  = proto_field('phone', 'option:theme-settings');           // esc_html string
$footer = proto_field('copyright', 'option:theme-settings-footer');
?>
<?php if ($phone) : ?>
    <a class="site-phone" href="tel:<?php echo esc_attr(preg_replace('/[^0-9+]/', '', proto_field('phone', 'option:theme-settings', true))); ?>"><?php echo $phone; ?></a>
<?php endif; ?>

<ul class="site-social">
<?php foreach (proto_rows('social_links', 'option:theme-settings') as $link) : ?>
    <li><a href="<?php echo $link['url']; ?>"><?php echo $link['label']; ?></a></li>
<?php endforeach; ?>
</ul>

<?php echo proto_field('head_scripts', 'option:theme-settings'); // code: printed exactly as stored ?>
```

The getter reads either storage mode; never read the option names directly. `proto_fields('option:theme-settings')` returns every value of the page. In core blocks: a binding with `"context": "option:theme-settings"` (`custom-fields.md`, "Block Bindings"). Option fields are bindable by any author unless `"bindings": false`: set it on anything that is not meant for public output (tracking codes, internal notes).

Declare pages in a file, or with `proto_options_page()` in `functions.php` (any time before `wp_loaded`). A call made only inside `admin_menu` reaches the menu but not REST saves or `proto_field()` on other requests.

```php
proto_options_page('Theme Settings', [
    'menu'   => 'top',
    'icon'   => 'dashicons-admin-generic',
    'fields' => [
        ['name' => 'phone', 'label' => 'Phone', 'type' => 'text'],
    ],
]);
```

A `proto-options/theme-settings/page.jsonc` file of the same slug wins over the PHP call (double-declaration warning). The admin's Options Pages screen offers "Create file" for a PHP page.

## Migrating a hand-written settings page (CADCO pattern)

A theme that registered its own page with `add_submenu_page()` + `register_setting()` and stores everything in one array option keeps its values by pointing `storage` at that option:

```jsonc
// proto-options/cadco-display-settings/page.jsonc
{
  "title": "Display Settings",
  "menu": "edit.php?post_type=product",           // under Products
  "capability": "manage_woocommerce",             // shop managers, not only admins
  "storage": { "mode": "array", "option": "cadco_display_settings" },
  "fields": [
    { "key": "field_cadco_hide_children", "name": "hide_children", "label": "Hide child products", "type": "true_false" },
    { "key": "field_cadco_children_placement", "name": "children_placement", "label": "Child product placement", "type": "radio",
      "choices": { "related": "Related products", "section": "Own section" }, "default_value": "related" },
    { "key": "field_cadco_children_heading", "name": "children_heading", "label": "Section heading", "type": "text",
      "conditional_logic": [[ { "field": "field_cadco_children_placement", "operator": "==", "value": "section" } ]] }
  ]
}
```

Steps:

1. Read the old code: option name, array keys, menu parent, capability. Each array key becomes a field `name` (same spelling).
2. Write the file; remove the old `add_submenu_page()` / `register_setting()` / render callback (the old reads, `get_option('cadco_display_settings')['hide_children']`, keep working, or switch them to `proto_field('hide_children', 'option:cadco-display-settings')`).
3. `wp proto-blocks validate`, then open the page and confirm the existing values show. Save once and diff `wp option get cadco_display_settings --format=json` before/after.
4. If the named option currently holds something that is not an array, a save keeps it and warns instead of overwriting it. Check value types the old code relied on (a `'1'` string vs a boolean) before deleting the old reads.

## REST and CLI

- `GET|POST /wp-json/proto-blocks/v1/options/<slug>`: values of one page, gated on the page's **own** capability (plus the `wp_rest` nonce for cookie auth). GET returns `values`, `trusted`, `readOnly` (code fields are `null` for untrusted users). POST is what the page's Save button sends; prefer the screen or WP-CLI for writes.
- `wp proto-blocks options list [--format=table|json|csv]` (slug, title, menu, capability, storage, origin).
- `wp proto-blocks options create "<Title>" [--slug=<slug>] [--menu=<menu>] [--capability=<cap>] [--storage-option=<name>]` writes a commented `page.jsonc` into the active theme.
- `wp proto-blocks validate` reports settings-page findings (schema errors, `shared_storage`, skipped fields). Menu warnings (unknown capability, missing parent) appear only in the admin.
- Seed values: `wp option update theme-settings_phone "+1 555 0100"`; an array page: `wp option update cadco_display_settings '{"hide_children":true}' --format=json`. Markup or code values need a trusted user: `wp eval --user=admin 'update_option("theme-settings_head_scripts", "<script>…</script>", false);'`.
