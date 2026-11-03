# Custom fields (field groups, `proto_field()`)

ACF-class custom fields for posts, pages, custom post types, taxonomy terms, users and settings pages (Proto-Blocks 2.15.0+, WordPress 6.5+). Groups are declared in theme files (or one PHP call), edited in **Proto Blocks > Fields** (a visual builder that writes the same files), stored as ordinary meta, and read back escaped with `proto_field()`.

**Not the same thing as block fields.** `references/fields.md` is about `protoBlocks.fields` in `block.json` (per-block-instance content edited inline). This file is about data that belongs to a post, term, user or settings page and is edited in meta boxes. Rule of thumb: content that is the same wherever the post is shown (an event's date, a speaker's role, a product's spec sheet) is a custom field; layout copy of one page section is a block field.

Plugin docs (Proto-Blocks repo): `docs/fields.md`, `docs/trust-and-security.md`, `docs/content-model-files.md`.

## Declaring a group: three ways

The group shape **mirrors ACF local JSON** (`key`, `title`, `fields[]` with `key`, `label`, `name`, `type`, `required`, `default_value`, `instructions`, `placeholder`, `conditional_logic`, `sub_fields`, `layouts`, plus `location`, `position`, `style`, `menu_order`). ACF-only keys are kept and ignored, never an error.

### 1. Inline in a type, taxonomy or settings-page file (location implied)

```jsonc
// proto-types/event/type.jsonc
{
  "name": "Event",
  "fields": [
    {
      "key": "group_event_details",          // unique across the site; ACF convention group_<id>
      "title": "Event details",
      "position": "acf_after_title",         // "normal" (default) | "side" | "acf_after_title"
      "fields": [
        { "key": "field_event_subtitle", "label": "Subtitle", "name": "subtitle", "type": "text", "maxlength": 120 },
        { "key": "field_event_start", "label": "Start date", "name": "start_date", "type": "date", "required": 1 },
        { "key": "field_event_agenda", "label": "Agenda", "name": "agenda", "type": "repeater", "max": 20,
          "sub_fields": [
            { "key": "field_event_agenda_time", "label": "Time", "name": "time", "type": "time" },
            { "key": "field_event_agenda_title", "label": "Title", "name": "title", "type": "text" }
          ] }
      ]
    }
  ]
}
```

A `location` inside an inline group is ignored with `location_ignored`: the file decides it (`post_type == <slug>`, `taxonomy == <slug>`, `options_page == <slug>`).

### 2. Standalone `proto-fields/<slug>/group.jsonc` (own `location`)

```jsonc
// proto-fields/page-hero/group.jsonc
{
  "key": "group_page_hero",
  "title": "Page hero",
  "location": [                                   // OR-list of AND-lists
    [ { "param": "post_type", "operator": "==", "value": "page" } ],
    [ { "param": "post_type", "operator": "==", "value": "event" } ]
  ],
  "position": "side",
  "fields": [
    { "key": "field_page_hero_image", "label": "Hero image", "name": "hero_image", "type": "image" },
    { "key": "field_page_hero_tagline", "label": "Tagline", "name": "hero_tagline", "type": "text" }
  ]
}
```

Folder name: `^[a-z][a-z0-9_-]{0,31}$`. One group or an ACF Tools export (a list of groups) per file. `.jsonc` wins over `.json`.

Location params: `post_type`, `post_status`, `post_taxonomy`, `page_template`, `post` (ID), `taxonomy` (term screens), `user_role`, `user_form` (user screens), `options_page`; operators `==` / `!=`. A group with any other param is **not rendered at all** (warning `unsupported_location_rule`), never shown everywhere. A group with no location shows nowhere (`missing_location`). One AND-list mixing post and user rules can never match (`mixed_location_kinds`). Term example: `[[{ "param": "taxonomy", "operator": "==", "value": "category" }]]`; user example: `[[{ "param": "user_role", "operator": "==", "value": "all" }]]`.

### 3. PHP

```php
// functions.php, or on `init` before priority 10
proto_field_group('event', [            // '<post type>' | 'taxonomy:<tax>' | 'options:<page>' | '' (group has its own location)
    'key'      => 'group_event_developer',
    'title'    => 'Developer',
    'position' => 'side',
    'fields'   => [
        ['key' => 'field_event_snippet', 'label' => 'Snippet', 'name' => 'snippet', 'type' => 'code'],
    ],
]);
```

Groups added after the index is built (first field read after `init` 10, at the latest `init` 20) are not seen.

**Precedence** for the same group `key`: a `proto-fields` file over a type/taxonomy file over PHP, with a `duplicate_group_key` warning. Child theme `proto-fields/<slug>` replaces the parent's; a **broken child file does not fall back** to the parent's file (`broken_override` error): fix it, never delete it to "get the parent back" without meaning to. When ACF is active and already registers the same key, Proto-Blocks skips its copy and shows a notice.

## Names, keys, storage

- `name` is the meta key: `^[A-Za-z][A-Za-z0-9_-]{0,63}$`, unique per level (`duplicate_name`). Settings-page fields are stricter: `^[a-z][a-z0-9_]*$`.
- `key` is required on every field and group in type/taxonomy/proto-fields groups (`missing_key`) and must be unique (`duplicate_key`). Settings-page bare fields get one generated.
- **One meta row per top-level field.** Group, repeater and flexible content are one meta value holding the whole structure (an array), not ACF's flattened rows. Terms use term meta, users user meta, settings pages one option per field (`settings-pages.md`).
- Every field is registered with a REST schema. Post and term fields are in `show_in_rest` by default (except `code`/`password`); **user fields are not** unless the field sets `"show_in_rest": true`. REST meta of public posts is readable anonymously: set `"show_in_rest": false` on anything private.
- Keys are protected meta: core's Custom Fields panel never lists them. Types that receive groups gain `custom-fields` support automatically.
- Renaming a field's `name` leaves stored values under the old meta key (the builder warns; files written by hand do not). Re-typing a field to `code` makes its old values come back raw.

## Field types

`proto_field()` returns the value **escaped for its type** (`$raw = true` returns the stored value). Echo the getter's output directly; escaping again with `esc_html()` etc. is harmless (no double encoding).

| Type | Settings (beyond label/name/required/default_value/instructions/placeholder) | Stored | `proto_field()` returns | Template |
|---|---|---|---|---|
| `text` | `maxlength`, `minlength`, `pattern` (PCRE, max 200 chars) | string | `esc_html` string | `<?php echo proto_field('subtitle'); ?>` |
| `textarea` | `maxlength`, `minlength`, `new_lines: "br"` | string | `esc_html` (+ `nl2br` with `br`) | `<p><?php echo proto_field('summary'); ?></p>` |
| `number` | `min`, `max`, `step` | number | int/float, or `null` when empty | `<?php echo (int) proto_field('seats'); ?>` |
| `email` | — | string | `esc_html` string | `<?php echo proto_field('contact_email'); ?>` |
| `url` | — | string | `esc_url` string | `<a href="<?php echo proto_field('website'); ?>">` |
| `password` | — | string | `esc_html` string; write needs `unfiltered_html`; never REST, never bindings | rarely printed |
| `wysiwyg` | — | HTML string | `wp_kses_post` HTML | `<div><?php echo proto_field('body'); ?></div>` |
| `code` | — | string | **as stored, raw** (write needs `unfiltered_html`) | `<?php echo proto_field('head_scripts', 'option:theme-settings'); ?>` |
| `image` | — | attachment ID | `{id, url, alt, width, height, sizes: {<size>: {url, width, height}}}` or `null` | see snippet below |
| `file` | — | attachment ID | `{id, url, filename, mime, size}` or `null` | `<a href="<?php echo $f['url']; ?>"><?php echo $f['filename']; ?></a>` |
| `gallery` | `max` | ID list | list of image arrays | `foreach (proto_field('photos') as $img)` |
| `video` | — | video attachment ID or URL | `{id, url}` / `{url}` or `null` | `<video src="<?php echo $v['url']; ?>" controls></video>` |
| `link` | — | `{url, title, target}` | `{url, title, target}` (+ `rel: "noopener noreferrer"` when `_blank`) | `<a href="<?php echo $l['url']; ?>"<?php echo proto_blocks_link_attrs($l); ?>><?php echo $l['title']; ?></a>` |
| `select` | `choices` (`{"value": "Label"}` or list), `multiple`, `optionsSource` + `sourceArgs` | string, or string[] when `multiple` | the stored **value(s)**, `esc_html`; not the label | `<?php echo proto_field('level'); ?>` |
| `radio` | `choices` | string | stored value, `esc_html` | as select |
| `true_false` | — | bool | bool | `<?php if (proto_field('featured')) : ?>` |
| `color` | — | string | sanitised colour, `''` if invalid | `style="color: <?php echo proto_field('accent'); ?>"` |
| `date` / `time` / `datetime` | — | `Y-m-d` / `H:i:s` / `Y-m-d H:i:s` (ACF `Ymd` is read as `Y-m-d`) | `esc_html` string | `<?php echo esc_html(date_i18n(get_option('date_format'), strtotime(proto_field('start_date', null, true)))); ?>` |
| `taxonomy` | `taxonomy` (required), `max`, `save_terms` (also sets the post's terms) | term ID list | list of `{id, name, slug, url}` | `foreach (proto_field('tracks') as $t)` |
| `relationship` | `post_type` (list), `max` | post ID list | list of `{id, title, url, type}` (only posts the viewer may see); `max: 1` returns one item or `null` | `foreach (proto_field('speakers') as $p)` |
| `group` | `sub_fields` (required, 1+) | object | name => escaped sub-values | `$a = proto_field('address'); echo $a['city'];` |
| `repeater` | `sub_fields` (required), `min`, `max` | list of rows | list of escaped rows; read with `proto_rows()` | `foreach (proto_rows('agenda') as $row)` |
| `flexible_content` | `layouts` (required; each `name`, `label`, `sub_fields`, optional `min`/`max`) | list of `{layout, ...}` | rows with `layout` + escaped values | `switch ($row['layout'])` |
| `tab`, `accordion`, `message` | layout only (`name` may be `""`) | nothing | `null` (never read) | — |

ACF type names are aliased on load: `date_picker` → `date`, `time_picker` → `time`, `date_time_picker` → `datetime`, `color_picker` → `color`, `checkbox` → `select` (multiple), `button_group` → `radio`, `post_object` / `page_link` → `relationship` (one item unless `multiple`), `oembed` → `video` (URL), `user` → `select` with `optionsSource: "wp:users"`. Any other unknown type (ACF `range`, `google_map`, `clone`, ...) is **skipped** with an `unknown_type` warning: model it differently or keep it in ACF.

Image snippet (every value already escaped):

```php
<?php $img = proto_field('hero_image'); ?>
<?php if ($img) : ?>
    <img src="<?php echo $img['url']; ?>" alt="<?php echo $img['alt']; ?>"
         width="<?php echo (int) $img['width']; ?>" height="<?php echo (int) $img['height']; ?>" loading="lazy">
<?php endif; ?>
```

For `srcset`, use core with the ID: `echo wp_get_attachment_image($img['id'], 'large');`.

## Conditional logic

ACF semantics: a field shows when it has no rules, or when every rule of at least one AND-list passes. Rules name a **sibling field by its `key`** (same level only), with `operator` `==`, `!=`, `==contains`, `==empty`, `!=empty`, `==pattern`.

```jsonc
{ "key": "field_event_online", "label": "Online event", "name": "online", "type": "true_false" },
{ "key": "field_event_stream", "label": "Stream URL", "name": "stream_url", "type": "url",
  "conditional_logic": [[ { "field": "field_event_online", "operator": "==", "value": "1" } ]] }
```

Hidden fields are hidden in the box and skipped by server validation (and not written). Validation (`required`, `pattern`, `min`/`max`, `minlength`/`maxlength`, choice membership) runs in the browser and again in PHP; a failing save keeps the post and shows the errors in the box.

## Repeaters and flexible content

```php
<?php foreach (proto_rows('agenda') as $row) : ?>
    <li><time><?php echo $row['time']; ?></time> <?php echo $row['title']; ?></li>
<?php endforeach; ?>

<?php foreach (proto_rows('sections') as $row) : ?>
    <?php if ($row['layout'] === 'quote') : ?>
        <blockquote><?php echo $row['text']; ?></blockquote>
    <?php elseif ($row['layout'] === 'gallery') : ?>
        <?php foreach ($row['images'] as $img) : ?><img src="<?php echo $img['url']; ?>" alt="<?php echo $img['alt']; ?>"><?php endforeach; ?>
    <?php endif; ?>
<?php endforeach; ?>
```

`proto_rows()` returns `[]` for any non-repeater/non-flexible field. Rows above `max` are refused on save. The site-wide row cap is the `proto_blocks_repeater_max_items` filter (default 500, signature `($max, $fieldName, $settings)`, shared nested budget); lowering it never truncates stored rows: the box warns and refuses the save until rows are removed.

## Getter API

```php
proto_field(string $name, $context = null, bool $raw = false): mixed   // one value; null when not declared for that object
proto_fields($context = null, bool $raw = false): array                 // every field shown on that object, name => value
proto_rows(string $name, $context = null): iterable                     // escaped rows of a repeater / flexible content
$template->field(string $name, bool $raw = false): mixed                // in template.php: the block's post (Query Loop postId, else the current post)
```

`$context`: `null` (current loop post, else the queried object: singular post, term archive, author archive), a post ID or `WP_Post`/`WP_Term`/`WP_User`, `'post:<id>'`, `'term:<id>'`, `'user:<id>'`, `'option:<page-slug>'`. Anything malformed resolves to nothing (`null`), never a guess. With `WP_DEBUG`, reading an undeclared name triggers a `_doing_it_wrong` notice.

**Escaping contract.** Values are escaped per type on every read, whoever wrote them. Exceptions: `code` comes back exactly as stored (and so does any pre-existing meta row of that name), and `$raw = true` escapes nothing (your job then). **No read-permission check**: the getter reads drafts, private posts and any user. Never build `$context` from visitor input (`$_GET`, query vars, block attributes a contributor controls).

**ACF aliases.** When ACF is not active, `get_field($name, $post_id = false, $format_value = true)`, `the_field()` and `get_fields()` exist and call the same getter, **escaped by default** (unlike ACF); `$format_value = false` is raw. ACF ids `term_<id>`, `<taxonomy>_<id>`, `user_<id>` map to contexts; `'option'` / `'options'` read nothing (there is no default options page): use `proto_field('x', 'option:<page-slug>')`. There is no `have_rows()`/`the_row()`: loop `proto_rows()`.

In a Proto-Blocks block, prefer `$template->field()`: it follows the Query Loop's `postId`, else the current post. In the editor preview (`$block === null`) do not count on a post: the block editor's preview request (admin-ajax `proto_blocks_preview`) sends no post ID, so values come back empty there (only the REST preview route accepts a `postId`). Render a visible placeholder when the value is empty and `$block` is `null`, so the block is never an invisible box in the editor or the Site Editor.

## Block Bindings (`proto-blocks/field`)

Core `paragraph`, `heading`, `image` and `button` blocks can read a field server-side through the same getter. Args: `name` (required), `context` (optional, getter grammar; default the block's `postId`), `key` (optional array key).

```html
<!-- wp:paragraph {"metadata":{"bindings":{"content":{"source":"proto-blocks/field","args":{"name":"subtitle"}}}}} -->
<p></p>
<!-- /wp:paragraph -->

<!-- wp:image {"metadata":{"bindings":{"url":{"source":"proto-blocks/field","args":{"name":"hero_image"}},"alt":{"source":"proto-blocks/field","args":{"name":"hero_image"}}}}} -->
<figure class="wp-block-image"><img alt=""/></figure>
<!-- /wp:image -->

<!-- wp:paragraph {"metadata":{"bindings":{"content":{"source":"proto-blocks/field","args":{"name":"phone","context":"option:theme-settings"}}}}} -->
<p></p>
<!-- /wp:paragraph -->
```

- Image/file arrays map to the bound attribute (`url`, `alt`, `id`); link maps `url` and `text`/`content` → `title`; `key` picks one key of an image/file/link/video value, a single-item relationship, or one sub-field of a `group`.
- Never bound: `code`, `password`, and fields with `"bindings": false`. Posts behind a password or not viewable by the visitor give nothing; term fields of non-public taxonomies need `edit_term`; user fields need `edit_user`. A `null` value keeps the block's saved content.
- **Settings-page fields are bindable by any author** who can edit a post: put `"bindings": false` on any option field that must not be printed on arbitrary pages.
- Values depend on the viewer: a full-page cache that serves logged-in users must vary by user.
- The editor shows a `{name}` placeholder (WordPress 6.7+); the value renders on the front end.

## Importing an ACF group

1. In ACF: **Tools > Export > Generate JSON** (or copy a file from the site's `acf-json/`).
2. Save it unchanged as `proto-fields/<slug>/group.json` (a list of groups is fine). ACF's `acf-json/` folder itself is never read.
3. `wp proto-blocks fields validate` and read every warning: `unknown_type` (field skipped), `unsupported_location_rule` (group not rendered), `wide_location` (group matches every post type).
4. Replace `get_field('x', 'option')` calls with `proto_field('x', 'option:<page-slug>')`, and `have_rows()` loops with `proto_rows()`.
5. With ACF still active, its copy wins (same key): deactivate ACF to switch. Stored ACF meta is not migrated: this is for new builds and for re-using group definitions.

## Trust rules

- Values are sanitised **at write time per user**: users without `unfiltered_html` get each type's sanitiser (`wp_kses_post` for wysiwyg, URL and colour sanitisers, ...); trusted users' values are stored as given; the getter escapes on read either way.
- `code` and `password` (and any group/repeater containing one) can only be written by users with `unfiltered_html`. Others see them read-only and their saves leave them untouched; REST writes are refused. On multisite, sub-site admins usually lack `unfiltered_html`.
- Seeding from WP-CLI runs as user 0 (untrusted): markup is stripped and code values are refused. Seed such values with a trusted user: `wp eval --user=admin '...'` or `wp post meta update <id> <key> '<value>' --user=admin`.
- Core's sensitive user-meta keys (`session_tokens`, `*capabilities`, `*user_level`) are refused as user field names (`protected_meta_key`).
- Declaring a `code` field only needs file-write rights; the trust rule applies to its values.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| `proto_field()` returns `null` | Name not declared for that object (wrong post type, group location does not match, or the group was skipped) | `wp proto-blocks fields list` (status column), `wp proto-blocks fields validate` |
| Group missing everywhere | `unsupported_location_rule`, `missing_location`, `mixed_location_kinds`, or ACF registers the same key | Fix the location; deactivate ACF or change the key |
| Child theme group gone, parent's not used either | Broken child `proto-fields/<slug>` file (`broken_override`) | Fix the child file's JSONC |
| `get_field('x', 'option')` empty | No ACF default options page here | `proto_field('x', 'option:<page-slug>')` |
| Markup stripped from a value seeded by CLI | CLI user 0 lacks `unfiltered_html` | Add `--user=<admin>` |
| A `select` prints `gold` not "Gold tier" | The getter returns choice values | Map labels in the template or store labels as values |
| Escaped `&lt;b&gt;` in a wysiwyg | Printed through `esc_html()` after a raw read | Echo `proto_field()` unchanged (already `wp_kses_post`) |
| Field visible in a REST response for visitors | Post/term fields are `show_in_rest` by default | `"show_in_rest": false` on that field |
| Bound paragraph empty | `code`/`password` field, `"bindings": false`, or a draft viewed logged out | Use a public value field |
| Old values "lost" after a rename | Meta key = `name`; the old key still holds them | Rename back, or move the meta yourself |
