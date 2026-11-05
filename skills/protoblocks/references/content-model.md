# Content model: post types and taxonomies

Proto-Blocks 2.15.0+ registers custom post types and taxonomies from a line of PHP or a JSONC file in the theme, and edits them from **Proto Blocks > Post Types / Taxonomies** by rewriting those same files. Nothing about the content model is stored in the database. Requires WordPress 6.5+ and PHP 8.1.

Plugin docs (Proto-Blocks repo): `docs/post-types.md`, `docs/taxonomies.md`, `docs/content-model-files.md`, `docs/trust-and-security.md`. Fields: `custom-fields.md`. Settings pages: `settings-pages.md`. Redirects: `redirects.md`. Head/body scripts: `scripts.md`. CLI and admin: `admin-and-cli.md`.

## PHP one-liner or JSONC file?

| Use | When |
|---|---|
| `proto-types/<slug>/type.jsonc` (default) | Every new build. Git-tracked, validated by `wp proto-blocks validate`, editable in the admin UI, can hold the type's taxonomies and field groups. |
| `proto_post_type('Event')` in `functions.php` | A theme that wants everything in PHP, or a declaration that needs something a file cannot carry (a PHP callback). |
| Plain `register_post_type()` | Bespoke registrations Proto-Blocks should not own (WooCommerce rewrites, importer-created types). They coexist. |

Never declare the same slug both ways. The **file wins entirely** (no merge) and every screen shows a "Declared twice" warning (`double_declaration` in `validate`). That is the designed outcome when someone edits a PHP-declared type in the UI: the UI writes a file, the file takes over, then delete the PHP line.

## Where files live

```
your-theme/
├── proto-blocks/<block>/block.json            blocks (unchanged)
├── proto-types/<slug>/type.jsonc              post type + inline taxonomies + field groups
├── proto-taxonomies/<slug>/taxonomy.jsonc     standalone taxonomy for any post types
├── proto-fields/<slug>/group.jsonc            standalone field group (custom-fields.md)
├── proto-options/<slug>/page.jsonc            settings page (settings-pages.md)
├── proto-redirects/<group>/redirects.jsonc    redirect rules (redirects.md); proto-redirects/settings.jsonc
└── proto-scripts/<slug>/script.jsonc          head/body snippets + head.html, body-open.html, body-close.html (scripts.md)
```

- **The folder name is the slug.** Post type: `^[a-z][a-z0-9_-]{0,19}$` (20 chars max, WordPress's limit). Taxonomy: same pattern, 32 chars. A `slug` key inside the file must equal the folder name (`slug_mismatch` error otherwise). Reserved core slugs are refused.
- `.jsonc` (comments, trailing commas) or `.json`. Both present: `.jsonc` is used, `both_extensions` warning.
- Parent theme folders load first, then the child theme: **the child theme wins on the same slug**. Extra roots: the `proto_blocks_schema_paths` filter. The UI and CLI only ever write to the active (child) theme or its parent.
- Files are data, never executed. A broken file is reported and skipped; every other declaration still loads. Files over 256 KB are not read.
- Files are re-read on every request (no cache): edit, reload. Rewrite rules flush automatically on the next request after the set of slugs or rewrite settings changes. Never call `flush_rewrite_rules()` yourself.

## Post type defaults

A bare declaration (`{ "name": "Event" }`, or `proto_post_type('Event')`) registers, relative to WordPress's defaults:

| Arg | Default |
|---|---|
| slug | from the name (`Event` → `event`), or the folder |
| `labels` | the full label set, from the singular and plural (English plural rules; override with `plural`) |
| `public`, `show_in_rest`, `has_archive` | `true` |
| `rewrite` | `{ "slug": "<slug>", "with_front": false }` |
| `supports` | `title, editor, thumbnail, excerpt, revisions` (+ `custom-fields` automatically once a field group attaches) |
| `menu_position` | `22` (below Pages) |
| `menu_icon` | the Proto-Blocks glyph |
| `hierarchical` | `false` |
| `capability_type` | `post` |

Any other `register_post_type()` key passes through unchanged. `name` is required for a new type; leave it out only in an override file (below). A name-less declaration for a slug nobody registers is error `name_required`.

### Annotated `type.jsonc`

```jsonc
// proto-types/event/type.jsonc
{
  "name": "Event",                       // singular; labels, slug and plural derive from it
  "plural": "Events",                    // only when the English rule gets it wrong ("Person" -> "People" is handled)
  // "labels": { "menu_name": "Calendar" },   // merged over the generated labels; no "<" or ">"
  "has_archive": "events",               // true | false | archive slug string (false: a page is the archive)
  "rewrite": { "slug": "events" },       // merged over the default; "with_front" stays false
  "supports": ["title", "editor", "thumbnail", "excerpt", "revisions"],
  "menu_icon": "dashicons-calendar-alt", // dashicon | https:// URL | theme-relative .svg/.png/.jpg/.webp
  "menu_position": 22,
  "hierarchical": false,
  "show_in_rest": true,                  // keep true: the block editor and REST meta need it
  "template": [["core/paragraph", { "placeholder": "Event description" }]],
  "template_lock": false,                // false | "all" | "insert" | "contentOnly"
  "taxonomies": [
    "post_tag",                          // a string attaches an existing taxonomy
    { "name": "Event Type", "hierarchical": true }   // an object declares one inline (slug "event-type")
  ],
  "fields": [                            // field groups; location is implied (post_type == event)
    {
      "key": "group_event_details",
      "title": "Event details",
      "fields": [
        { "key": "field_event_subtitle", "label": "Subtitle", "name": "subtitle", "type": "text" },
        { "key": "field_event_start", "label": "Start date", "name": "start_date", "type": "date", "required": 1 }
      ]
    }
  ]
}
```

Menu icon rules: a `dashicons-*` class is used as is; an `https://` URL passes through; a theme-relative `.svg` is size-capped, sanitised on the server and inlined as a `data:` URI (follows the admin colour scheme); `.png`/`.jpg`/`.webp` resolve to the theme URL. Anything else falls back to the default glyph with an `icon_invalid` warning.

## Taxonomies

Defaults: `public`, `show_in_rest`, `show_admin_column` all `true`, `hierarchical: false`, `rewrite` `{ slug, with_front: false }`, generated labels (`menu_name` = plural).

Two ways to declare one:

- **Inline** in a type file's `taxonomies` list (object with at least `name`): `post_types` is pre-filled with the enclosing type. Identical inline taxonomies in two type files merge their post types.
- **Standalone** `proto-taxonomies/<slug>/taxonomy.jsonc`: lists its `post_types`, which may be core types or types Proto-Blocks does not own.

```jsonc
// proto-taxonomies/topic/taxonomy.jsonc
{
  "name": "Topic",
  "plural": "Topics",
  "post_types": ["event", "post"],     // any registered or declared types
  "hierarchical": false,               // true = category-like (checkbox tree)
  "show_admin_column": true,
  "rewrite": { "slug": "topics" },
  "fields": [                          // term field groups; location is implied (taxonomy == topic)
    {
      "key": "group_topic_extra",
      "title": "Topic extras",
      "fields": [ { "key": "field_topic_colour", "label": "Colour", "name": "topic_colour", "type": "color" } ]
    }
  ]
}
```

PHP: `proto_taxonomy('Topic', ['post_types' => ['event', 'post']]);`

## PHP one-liners

```php
// functions.php: any time before `init` priority 9
proto_post_type('Event');
proto_post_type('Resource', ['has_archive' => false, 'menu_icon' => 'assets/icons/resource.svg']);
proto_taxonomy('Media Type', ['post_types' => ['resource'], 'hierarchical' => true]);
```

The second argument takes every key a JSONC file accepts. A call after `init` 9 is ignored with a `declared_too_late` warning. Calls from a theme file are recorded with their file and line, so `validate` and the double-declaration notice can point at them.

## Overrides of core and plugin types

A declaration whose slug is already registered (core `post`, `page`, `attachment`, `category`, `post_tag`, or another plugin's type) is an **override**: only its declared keys are merged onto the existing args (`register_post_type_args` / `register_taxonomy_args`); labels and rewrite merge key by key. Leave `name` out.

```jsonc
// proto-types/post/type.jsonc: give posts a starter template
{
  "template": [
    ["core/heading", { "level": 2, "placeholder": "Eyebrow title" }],
    ["core/paragraph", { "placeholder": "Intro" }],
    ["core/image", {}]
  ],
  "template_lock": false,
  "fields": [ { "key": "group_post_extra", "title": "Post extras", "fields": [ { "key": "field_post_kicker", "label": "Kicker", "name": "kicker", "type": "text" } ] } ]
}
```

String `taxonomies` in an override attach those taxonomies to the type. An override of a type registered before the declaration could be seen applies only the keys that still work on a registered object, and warns.

## Rules declaration files enforce

- **No PHP callbacks or classes in files**: `register_meta_box_cb`, `meta_box_cb`, `meta_box_sanitize_cb`, `update_count_callback`, `rest_controller_class`, `autosave_rest_controller_class`, `revisions_rest_controller_class`, `_builtin`, `_edit_link`. On load they are stripped with a warning; the UI and CLI refuse to save them. Need one? Use the PHP one-liner.
- **Labels, names and titles may not contain `<` or `>`.**
- Writes need `manage_options`, file modifications allowed (no `DISALLOW_FILE_MODS` / `DISALLOW_FILE_EDIT`) and a writable theme folder; **on multisite only a network admin** may write. Otherwise the screens are read-only with a banner.
- You (the agent) writing files directly bypass the UI's content guardrails. Before renaming a slug, removing `title`/`editor`/`thumbnail` from `supports`, or deleting a declaration, check `wp proto-blocks type list` (the `posts` column). Rename with `wp proto-blocks type rename <old> <new> --yes [--migrate]`, never by moving the folder by hand: existing posts stay under the old slug unless migrated.

## Templates for a new type

Registration never creates templates. On a block theme, scaffold them deliberately:

```bash
wp proto-blocks type scaffold event               # templates/single-event.html (+ archive-event.html when it has an archive)
wp proto-blocks type scaffold event --taxonomies  # also taxonomy-<tax>.html for each of its taxonomies
```

Writes into the active theme's `templates/`, seeded from the theme's own `single.html` / `archive.html` (header/footer parts, main group) or a minimal `core/post-content` / `core/query` template. Existing files are skipped and listed; classic themes are refused. Same action: the Scaffold button on the type's screen, or `POST /proto-blocks/v1/admin/types/<slug>/scaffold`.

Then put the type's fields into `single-<slug>.html` with a Proto-Blocks block that calls `$template->field()` or with core blocks bound to `proto-blocks/field` (`custom-fields.md`, "Block Bindings").

## CLI

```bash
wp proto-blocks type list [--format=table|json|csv]      # slug, name, origin, source, override, double, posts
wp proto-blocks type create "<Name>" [--slug=<slug>] [--plural=<plural>] [--json]
wp proto-blocks type scaffold <slug> [--taxonomies]
wp proto-blocks type validate [<slug>] [--format=table|json]
wp proto-blocks type rename <old> <new> [--yes] [--migrate]
wp proto-blocks taxonomy list|create|validate|rename      # same flags; no scaffold
```

`create` writes a commented `type.jsonc` / `taxonomy.jsonc` (only `name` live, every default shown as a comment) into the active theme. `rename` without `--yes` prints the plan and changes nothing; `--migrate` also moves the existing posts or terms (refused when the new slug already has content). Full list: `admin-and-cli.md`.

## Modules

`proto_blocks_modules` (filter, from `functions.php`) turns modules off: `['post_types' => true, 'taxonomies' => true, 'fields' => true, 'options_pages' => true]`. A module that is off registers nothing and its screen shows it as disabled.
