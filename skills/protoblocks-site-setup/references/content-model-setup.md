# Content model during site setup

Step 6 of site setup: declare the site's post types, field groups and settings pages in the fork before any section is built, so blocks can read them. Requires Proto-Blocks 2.15.0+ (WordPress 6.5+, PHP 8.1). How to write each file: the `protoblocks` skill's `references/content-model.md`, `references/custom-fields.md`, `references/settings-pages.md`; worked examples and the full QA list: `references/content-model-recipes.md`.

`WP` is the WP-CLI command preflight resolved (`report.wp`); `THEME` is the fork directory. Shell variables do not persist between Bash commands: write literal paths, or start each command with the `PB=...; THEME=...;` line from SKILL.md.

## When it applies

Ask the developer, once, when the design or brief shows any of:

| Signal in the design | Declaration |
|---|---|
| A collection whose items have their own page or card list (events, team, case studies, products, jobs) | post type `proto-types/<slug>/type.jsonc`, with its taxonomies and field group inline |
| Per-item data shown in a fixed layout (date, venue, role, price, spec rows) | a field group in that type file (or `proto-fields/<slug>/group.jsonc` for core `page`/`post`) |
| Values repeated on every page that the client should edit once (phone, address, social links, footer copy, tracking codes) | settings page `proto-options/<slug>/page.jsonc` (usually `theme-settings`) |

A landing page with one-off copy needs none of this: block fields stay the right tool. If the developer declines, do nothing here.

## Steps

1. Folders live at the fork's root, next to `proto-blocks/`: `proto-types/`, `proto-taxonomies/`, `proto-fields/`, `proto-options/`. Create only the ones the site uses, each with its first declaration (git does not keep empty folders). Start from the commented templates:

   ```bash
   "$WP" proto-blocks type create "Event" --plural="Events"
   "$WP" proto-blocks options create "Theme Settings"
   ```

   Both write into the active theme, which is the fork. Then edit the files (fields, archive slug, icon, tabs). Never put PHP callbacks or `<`/`>` in them; never declare the same slug in `functions.php` as well.

2. Validate until it exits 0 and every warning is understood:

   ```bash
   "$WP" proto-blocks validate
   "$WP" proto-blocks fields validate
   "$WP" proto-blocks type list
   ```

3. Block templates for each new type (block theme, never overwrites):

   ```bash
   "$WP" proto-blocks type scaffold <slug> --taxonomies
   ```

   The scaffolded `single-<slug>.html` / `archive-<slug>.html` hold the fork's header and footer parts. Sections that render the type's data are planned and built later through the normal loop.

4. Seed one or two sample items so blocks have data to render and QA has something to check (`wp post create --post_type=<slug> ...`, `wp post meta update <id> <field> <value>`). Markup or `code` values: add `--user=<admin login>` (WP-CLI's user 0 lacks `unfiltered_html`).

5. Commit in the fork: `git -C "<theme dir>" add -A && git -C "<theme dir>" commit -m "feat(content): content model"`.

## Rules

- The declarations are the record: the fork's files (and git) say what the site declares; nothing goes into `build.json`.
- Never rename a post type or taxonomy slug that has posts or terms by moving folders; use `"$WP" proto-blocks type rename <old> <new>` and only with the developer's OK (it prints the plan without `--yes`).
- On multisite the CLI writes only as a network admin (`--user=<login>`); under `DISALLOW_FILE_MODS` / `DISALLOW_FILE_EDIT` the CLI and the screens refuse every write. Report it and ask before writing the files by hand.
- Re-run `"$WP" proto-blocks validate` after every later change to these folders (the section loop does when a block reads fields).
