# Navigation and header/footer parts

Block themes ignore classic menus: `register_nav_menus` locations and `wp_nav_menu` are not used by the theme's templates, so menus here are `wp_navigation` posts built from `core/navigation-link` and `core/navigation-submenu` blocks. They appear in the Site Editor (Appearance > Editor > Navigation).

## Spec

```json
{
  "title": "Primary",
  "items": [
    { "label": "Home", "page": "home" },
    { "label": "Services", "page": "services", "children": [
      { "label": "Design", "page": "services/design" },
      { "label": "Docs", "url": "https://example.com/docs", "opensInNewTab": true }
    ] },
    { "label": "Contact", "page": "contact" }
  ]
}
```

Footer column:

```json
{ "title": "Footer 1", "items": [ { "label": "Privacy", "page": "privacy" }, { "label": "Press", "url": "/press" } ] }
```

- `items` (required array); `title` optional (defaults to the capitalized key).
- Item: `label`, plus `page` (page slug/path, e.g. `services/design`) or `url`; optional `opensInNewTab` (for `url` links); optional `children` (turns the item into a submenu).
- Key: `primary`, `footer-1`, `footer-2`, `utility`, ... A lowercase letter or digit first, then `[a-z0-9_-]` (`[ENAVKEY]` otherwise). The key is the upsert identity (post slug `pb-nav-<key>`): the same key updates the menu, never duplicates it.

## Commands

```bash
node "$PB/lib/navigation.mjs" upsert "$THEME" <key> <spec.json> [--force]
node "$PB/lib/navigation.mjs" refresh "$THEME"
```

`upsert` prints `{ "id": 12, "key": "primary", "created": true, "pending": [{"label":"Services","page":"services"}], "contentHash": "<sha256>" }` and saves `{id, spec, pending, contentHash}` under `site.navigation.menus.<key>` in the build state (when state exists). Keep the `id`: the header part references it. `contentHash` is the sha256 of the menu's `post_content` as protoblocks last wrote it.

## Site Editor edits

Menus are editable in the Site Editor, and those edits live in the same `wp_navigation` post. `upsert` on an existing menu only overwrites it when its content still matches `contentHash` (or already equals the new content). Otherwise it fails with `[EEDITED]` and changes nothing: the menu was edited in the Site Editor (or elsewhere). Tell the developer and either leave the menu alone (or change the spec to match their edits), or, only with their explicit OK, re-run with `--force`. `--force` first saves the current menu to `$THEME/.protoblocks/artifacts/backups/nav-<key>-<timestamp>.html` (reported as `backup`), then overwrites it.

## Pending links

A `page` that does not exist or is not published yet is written as a custom link to its future URL and listed in `pending`. This is normal while pages are still being built. After creating/publishing pages run `refresh`. It does not rewrite the menu: it parses the saved blocks and converts only the pending placeholder links (custom links whose URL is the future URL of a now-published page) into `post-type` page links, so Site Editor edits elsewhere in the menu are kept. Output: `{ "refreshed": ["primary"], "menus": { "primary": { "id": 12, "patched": [...], "pending": [...], "missing": [...] } } }`. `missing` lists pending links that are no longer in the menu (removed in the Site Editor); they are dropped from `pending`. Errors: `ENOMENU` (the menu post is gone; run `upsert` again).

## Header/footer parts

A part is `$THEME/parts/<slug>.html`. The markup wraps `core/navigation` (by menu `ref`) in the proto-block that renders the header:

```html
<!-- wp:proto-blocks/site-header {"sticky":true} -->
<!-- wp:navigation {"ref":12} /-->
<!-- /wp:proto-blocks/site-header -->
```

Without a menu: `<!-- wp:proto-blocks/site-footer /-->`. `partMarkup({ block, attrs, navRef })` in `lib/parts.mjs` produces exactly this (`navRef` must be a positive integer, the menu `id`). Generate it with `node "$PB/lib/parts.mjs" markup site-header --attrs '{"sticky":true}' --nav-ref 12 > header.html` (pure, no WordPress needed; do not add an `anchor` at setup time, the section loop adds it when it supersedes this part). Then write it:

```bash
node "$PB/lib/parts.mjs" write "$THEME" header header.html     # -> {"written": ".../parts/header.html"}
```

## Saved Site Editor copies (overrides)

If someone edited the header or footer in the Site Editor, WordPress holds a database copy that wins over `parts/<slug>.html`. Writing the file will then appear to do nothing.

```bash
node "$PB/lib/parts.mjs" overrides "$THEME"                       # [{id, slug, theme, modified}, ...]; [] = none
node "$PB/lib/parts.mjs" remove-override "$THEME" header          # preview only: [ECONFIRM] with the id, exit 1
node "$PB/lib/parts.mjs" remove-override "$THEME" header --confirm --id <n>
```

Flow: list overrides, ask the developer (their Site Editor edits are discarded), then run with `--confirm --id <n>` using the id from the `[ECONFIRM]` preview. The copy is moved to Trash, not deleted; the result lists `removed`, `records` and a `recovery` command per id (`<wp> eval 'wp_untrash_post(<id>);' && <wp> post update <id> --post_status=publish`, where `<wp>` is the WP-CLI command preflight resolved: Local's wrapper `'<site>/app/public/wp-content/.protoblocks/wp'`, or `wp --path='<root>'`).

Errors: `ECONFIRM` (missing `--confirm` or `--id`), `ESTALE` (id differs from the live copy; preview again), `EAMBIGUOUS` (several matches; nothing removed, resolve in wp-admin), `ETHEMEMISMATCH` (`<themeDir>` is not the active theme, or the part does not resolve to it), `ESLUG`/`ETHEME` (invalid slug/theme), `ENOTRASH` (Trash disabled, so removal would be permanent: ask the developer to use "Clear customizations" on the part in the Site Editor).

The theme is the folder name of `$THEME` and must be the active theme (setup activates the fork).
