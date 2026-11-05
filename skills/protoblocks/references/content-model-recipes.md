# Content model recipes

End-to-end procedures. Each ends with the QA checklist at the bottom. Paths are relative to the active theme folder; `wp` means the site's WP-CLI (`report.wp` in the site builder). Background: `content-model.md`, `custom-fields.md`, `settings-pages.md`, `admin-and-cli.md`.

## 1. An Event post type with fields and a card block

**1. Declare the type and its fields** in `proto-types/event/type.jsonc`:

```jsonc
// Events: one post per event, with an archive at /events/.
{
  "name": "Event",
  "has_archive": "events",
  "rewrite": { "slug": "events" },
  "menu_icon": "dashicons-calendar-alt",
  "supports": ["title", "editor", "thumbnail", "excerpt", "revisions"],
  "taxonomies": [ { "name": "Event Type", "hierarchical": true } ],
  "fields": [
    {
      "key": "group_event_details",
      "title": "Event details",
      "position": "acf_after_title",
      "fields": [
        { "key": "field_event_subtitle", "label": "Subtitle", "name": "subtitle", "type": "text", "maxlength": 120 },
        { "key": "field_event_start", "label": "Start date", "name": "start_date", "type": "date", "required": 1 },
        { "key": "field_event_venue", "label": "Venue", "name": "venue", "type": "text" },
        { "key": "field_event_ticket", "label": "Tickets", "name": "ticket_link", "type": "link" },
        { "key": "field_event_agenda", "label": "Agenda", "name": "agenda", "type": "repeater", "max": 30,
          "sub_fields": [
            { "key": "field_event_agenda_time", "label": "Time", "name": "time", "type": "time" },
            { "key": "field_event_agenda_title", "label": "Title", "name": "title", "type": "text" }
          ] }
      ]
    }
  ]
}
```

**2. Validate and scaffold:**

```bash
wp proto-blocks validate
wp proto-blocks type list
wp proto-blocks type scaffold event --taxonomies   # single-event.html, archive-event.html, taxonomy-event-type.html
```

**3. The card block** `proto-blocks/event-card/` reads the post it renders for. It has no block fields of its own (the data is edited in the Event's meta box), so `"fields": {}`; `usesContext` lets `$template->field()` follow a Query Loop's `postId`.

`block.json`:

```json
{
  "$schema": "https://schemas.wp.org/trunk/block.json",
  "apiVersion": 3,
  "name": "proto-blocks/event-card",
  "title": "Event Card",
  "category": "proto-blocks",
  "icon": "calendar",
  "usesContext": ["postId", "postType"],
  "supports": { "html": false, "anchor": true },
  "protoBlocks": { "version": "1.0", "template": "template.php", "useTailwind": false, "fields": {} }
}
```

`template.php` (getter values are already escaped; do not escape them again, do not use `$raw` without escaping yourself):

```php
<?php
$subtitle = $template->field('subtitle');
$start    = $template->field('start_date', true);   // raw Y-m-d, formatted and escaped below
$venue    = $template->field('venue');
$ticket   = $template->field('ticket_link');
$post_id  = $block->context['postId'] ?? get_the_ID();
$rows     = $post_id ? proto_rows('agenda', (int) $post_id) : [];
$preview  = $block === null; // editor preview: no post, show a placeholder
?>
<article <?php echo get_block_wrapper_attributes(['class' => 'event-card']); ?>>
    <?php if ($preview && !$subtitle) : ?>
        <p class="event-card__placeholder"><?php esc_html_e('Event card: shows the event subtitle, date, venue and agenda.', 'my-theme'); ?></p>
    <?php endif; ?>
    <?php if ($subtitle) : ?><p class="event-card__subtitle"><?php echo $subtitle; ?></p><?php endif; ?>
    <?php if ($start) : ?>
        <time datetime="<?php echo esc_attr($start); ?>"><?php echo esc_html(date_i18n(get_option('date_format'), strtotime($start))); ?></time>
    <?php endif; ?>
    <?php if ($venue) : ?><p class="event-card__venue"><?php echo $venue; ?></p><?php endif; ?>
    <?php if ($rows) : ?>
        <ul class="event-card__agenda">
            <?php foreach ($rows as $row) : ?>
                <li><span><?php echo $row['time']; ?></span> <?php echo $row['title']; ?></li>
            <?php endforeach; ?>
        </ul>
    <?php endif; ?>
    <?php if ($ticket && $ticket['url']) : ?>
        <a class="event-card__cta" href="<?php echo $ticket['url']; ?>"<?php echo proto_blocks_link_attrs($ticket); ?>><?php echo $ticket['title'] ?: esc_html__('Tickets', 'my-theme'); ?></a>
    <?php endif; ?>
</article>
```

On a site-builder site use the site's block category instead of `proto-blocks`.

**4. Use it:** in `templates/single-event.html` (`<!-- wp:proto-blocks/event-card /-->` inside the main group), and in `archive-event.html` inside the `core/query` loop's `core/post-template` so each card reads its own post.

**5. Seed one event and check:**

```bash
ID=$(wp post create --post_type=event --post_status=publish --post_title="Launch night" --porcelain)
wp post meta update "$ID" subtitle "Doors at seven"
wp post meta update "$ID" start_date 2026-12-01
wp post meta update "$ID" agenda '[{"time":"19:00:00","title":"Doors"},{"time":"20:00:00","title":"Keynote"}]' --format=json
wp eval "echo wp_json_encode(proto_field('agenda', $ID));"
curl -s "$(wp eval "echo get_permalink($ID);")" | grep -c event-card__agenda   # 1 or more
```

Then open the event in wp-admin: the "Event details" box shows after the title, the date is required, and saving keeps the values.

## 2. Convert an ACF export

1. Get the export: ACF **Tools > Export > Generate JSON**, or a file from the old theme's `acf-json/`.
2. Save it unchanged: `proto-fields/<slug>/group.json` (a list of groups is fine; one folder per logical group keeps diffs small).
3. Validate and read every warning:

   ```bash
   wp proto-blocks fields validate
   wp proto-blocks fields list
   ```

   - `unknown_type`: that field is skipped (ACF `range`, `google_map`, `clone`, ...). Replace it with a supported type (`number` for range) or leave it in ACF.
   - `unsupported_location_rule`: the whole group is not rendered. Rewrite the location with the supported params (`custom-fields.md`).
   - `wide_location`: the group matches every post type; narrow it unless that is intended.
4. If the groups targeted an ACF options page, move those fields into `proto-options/<slug>/page.jsonc` (`settings-pages.md`).
5. Templates: `get_field()` / `the_field()` keep working while ACF is inactive (now escaped by default; remove double `esc_*` only if output looks wrong, it is harmless otherwise). Replace `get_field('x', 'option')` with `proto_field('x', 'option:<slug>')` and every `have_rows()` / `the_row()` / `get_sub_field()` loop with `foreach (proto_rows('x') as $row)`. `wysiwyg` values that printed raw under ACF are now `wp_kses_post`-filtered; scripts belong in a `code` field.
6. With ACF still active, ACF's copy of each same-key group wins and Proto-Blocks shows a notice. Deactivate ACF to switch. Stored ACF data is not migrated: group values, repeater rows and options pages store differently.

## 3. A theme settings page read in the header block

1. `wp proto-blocks options create "Theme Settings"`, then edit `proto-options/theme-settings/page.jsonc`:

   ```jsonc
   {
     "title": "Theme Settings",
     "menu": "top",
     "icon": "dashicons-admin-generic",
     "fields": [
       { "name": "phone", "label": "Phone", "type": "text" },
       { "name": "header_cta", "label": "Header button", "type": "link" }
     ],
     "tabs": [
       { "title": "Tracking", "fields": [ { "name": "head_scripts", "label": "Head scripts", "type": "code", "bindings": false } ] }
     ]
   }
   ```

2. In the header block's `template.php`:

   ```php
   <?php
   $phone = proto_field('phone', 'option:theme-settings');
   $cta   = proto_field('header_cta', 'option:theme-settings');
   ?>
   <?php if ($phone) : ?><span class="site-header__phone"><?php echo $phone; ?></span><?php endif; ?>
   <?php if ($cta && $cta['url']) : ?>
       <a class="site-header__cta" href="<?php echo $cta['url']; ?>"<?php echo proto_blocks_link_attrs($cta); ?>><?php echo $cta['title']; ?></a>
   <?php endif; ?>
   ```

   The editor preview has no post but options do not need one: the values show in the editor too.

3. Print the tracking code once, from `functions.php` (a `code` value is raw by design and only trusted users can save it):

   ```php
   add_action('wp_head', static function (): void {
       echo proto_field('head_scripts', 'option:theme-settings'); // phpcs:ignore WordPress.Security.EscapeOutput -- code field, unfiltered_html writers only
   });
   ```

4. Seed and check: `wp option update theme-settings_phone "+1 555 0100"`, then `wp eval 'echo proto_field("phone", "option:theme-settings");'`, then load the front page and find the phone in the header.

## 4. Expose a field to the block editor with Block Bindings

When a core block should show a field (the subtitle under the title on `single-event.html`, a hero image from a page field), bind it instead of writing a block:

```html
<!-- wp:post-title {"level":1} /-->

<!-- wp:paragraph {"className":"event-subtitle","metadata":{"bindings":{"content":{"source":"proto-blocks/field","args":{"name":"subtitle"}}}}} -->
<p class="event-subtitle"></p>
<!-- /wp:paragraph -->

<!-- wp:button {"metadata":{"bindings":{"url":{"source":"proto-blocks/field","args":{"name":"ticket_link"}},"text":{"source":"proto-blocks/field","args":{"name":"ticket_link"}}}}} -->
<div class="wp-block-button"><a class="wp-block-button__link wp-element-button">Tickets</a></div>
<!-- /wp:button -->
```

- Supported blocks: paragraph, heading, image, button. Anything richer (repeaters, conditional markup) needs a Proto-Blocks block with `$template->field()` / `proto_rows()`.
- The editor shows `{subtitle}` (WordPress 6.7+); the value renders on the front end. A field that is empty, `code`, `password` or `"bindings": false` leaves the saved block content.
- Settings values: add `"context": "option:<slug>"` to `args`. Option fields are bindable by any author: mark private ones `"bindings": false`.

## 5. Redirects and scripts

See `redirects.md` (migrate from the Redirection plugin, catch a renamed section, role and login landing pages, retire a URL with 410) and `scripts.md` (GTM in head plus noscript after body open, consent script for logged-out visitors, exclude the privacy page). Both end with a check list; run `wp proto-blocks validate` after each change.

## 6. QA checklist for a content-model change

Run after every change to `proto-types/`, `proto-taxonomies/`, `proto-fields/`, `proto-options/`, `proto-redirects/`, `proto-scripts/` or a template that reads fields.

1. `wp proto-blocks validate` exits 0. Read every warning and fix or justify it: `double_declaration` (remove the PHP line or the file), `declared_too_late`, `unknown_type`, `unsupported_location_rule`, `broken_override`, `shared_storage`.
2. `wp proto-blocks fields validate` (adds `wide_location`). `wp proto-blocks fields list`: every group `active`, none `unrenderable` or `skipped-acf` unless intended.
3. `wp proto-blocks type list` / `taxonomy list` / `options list`: origin `file` for what you declared, `double` = `no`, `posts` counts as expected. Before a slug rename or `supports` removal on a type with posts, stop and ask.
4. `wp rewrite list --match=/<archive slug>/` lists the archive rule after one front-end request (flushes are automatic; never flush by hand).
5. The values read back escaped: `wp eval 'echo wp_json_encode(proto_fields(<id>));'`.
6. In wp-admin: the box appears on the right screens only (post type, term form, user profile, settings page), required fields block a bad save with a message, conditional fields hide, and a save keeps the values. `code`/`password` fields are read-only for a user without `unfiltered_html`.
7. Front end: the single template, archive and any Query Loop render each post's own values; empty values render no broken markup.
8. REST exposure is deliberate: `curl -s <site>/wp-json/wp/v2/<rest_base>/<id> | grep -o '"meta":{[^}]*}'` shows only fields meant to be public (`"show_in_rest": false` hides one).
9. Commit the theme (`git -C "<theme dir>" add -A && git -C "<theme dir>" commit -m "feat(content): ..."`). The content model is code: it ships with the theme.
