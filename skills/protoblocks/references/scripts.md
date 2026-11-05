# Scripts (head, body-open, body-close)

Proto-Blocks 2.16.0+ outputs tracking tags, verification metas, chat widgets and consent scripts from files in the theme: `proto-scripts/<slug>/script.jsonc` plus `head.html`, `body-open.html` and `body-close.html`. Nothing but the `proto_blocks_scripts_body_open` flag is stored in the database. Edit in **Proto Blocks > Scripts**, which writes the same files.

Plugin docs (Proto-Blocks repo): `docs/scripts.md`, `docs/trust-and-security.md`, `docs/content-model-files.md`.

## PHP one-liner or files?

| Use | When |
|---|---|
| `proto_script('Title', ['head' => '<meta ...>']);` in `functions.php` | A short inline snippet. Inline strings only (no `file` form). Sealed at `template_redirect` priority 1. |
| `proto-scripts/<slug>/` folder | Anything long (GTM). Preferred: the HTML lives in its own file. |

A file folder with the same slug beats the PHP call (`double_declaration`). Slug: `^[a-z][a-z0-9_-]*$`, 32 characters at most (`proto_script()` takes an optional `slug` arg, else the slugified title). Child theme wins on the same slug. A script with any error is skipped whole, and a broken child-theme file also drops the parent file and the PHP declaration of the same slug (`broken_override`).

## `script.jsonc`, annotated

```jsonc
// proto-scripts/gtm/script.jsonc
{
  "title": "Google Tag Manager",       // required, 1-100 chars, no "<" or ">"
  "enabled": true,
  "priority": 10,                      // integer -100000..100000; within each location, lower runs first
  "head": { "file": "head.html" },     // or an inline string
  "bodyOpen": { "file": "body-open.html" },
  "bodyClose": "",                     // empty or absent = nothing there
  "priorities": { "head": 1, "bodyClose": 99 },   // optional per-location override
  "where": {
    "include": ["all"],                // default ["all"]; [] matches nowhere (never_matches warning)
    "exclude": ["page:privacy-policy", "url:/landing/*"],
    "loggedIn": null,                  // null anyone, true only logged in, false only logged out
    "roles": [],                       // non-empty: only these roles (implies logged in; with loggedIn false = conflicting_where)
    "excludeRoles": ["administrator"]   // logged-in users only; never excludes logged-out visitors
  }
}
```

Rules:

- Unknown keys are refused (`schema_invalid`). Any location may name any of the three files.
- A `file` value must be exactly `head.html`, `body-open.html` or `body-close.html` (`invalid_snippet_file`; in `proto_script()` a `{file}` value is refused the same way, only inline strings work). A missing file is a `snippet_file_missing` warning and outputs nothing. Each snippet and `script.jsonc` is 256 KB max (`snippet_too_large`).
- `<?php`, `<?=` or `<?` plus whitespace in any snippet, files, inline and PHP declarations: `php_in_snippet`. Snippets are text.
- Targets: `all`, `front_page`, `home`, `search`, `404`, `archive`, `singular`, `singular:<post_type>`, `post_type:<type>`, `page:<slug or id>`, `post:<slug or id>` (all digits = ID; `0` never matches), `taxonomy:<tax>`, `term:<tax>:<slug>`, `url:<glob>` (must start with `/`; `*` = any characters including `/`; case-insensitive; decoded path, query ignored; trailing slash ignored; sub-folder home path stripped). Unknown target: `schema_invalid`. 100 entries max, 200 chars each.
- A page is in scope when it matches any `include` and no `exclude`.
- Output: `wp_head`, `wp_body_open`, `wp_footer`, priority 1, scripts sorted by `priority` then slug, each wrapped in `<!-- proto-blocks: <slug> -->` markers (filter `proto_blocks_scripts_markers` drops them; it receives slug and location). Never in admin, ajax, cron, REST, iframes (block editor), customizer preview, feeds or embeds. `proto_blocks_scripts_enabled` can only switch output off.
- Themes without `wp_body_open()`: `missing_body_open` warning when a script uses `bodyOpen`. Fix the theme (`wp_body_open();` right after `<body>`).

## Trust

Writing a script file needs `manage_options` and `unfiltered_html` (otherwise `403 proto_blocks_unfiltered_html` and the screen is read-only with reason `unfiltered_html`; `DISALLOW_UNFILTERED_HTML` disables writes site-wide). The generic `admin/schema-files/script/*` write and delete routes need it too. WP-CLI skips this check. Output is raw by design: whoever writes these files can run JavaScript on the front end. As an agent, writing the files in the theme is normal; never paste a snippet the developer did not supply.

## Recipes

### GTM in head and noscript after body open

```html
<!-- proto-scripts/gtm/head.html -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s);j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-XXXX');</script>
```

```html
<!-- proto-scripts/gtm/body-open.html -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXX" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
```

```jsonc
{ "title": "Google Tag Manager", "head": { "file": "head.html" }, "bodyOpen": { "file": "body-open.html" }, "priorities": { "head": 1 } }
```

Check the theme calls `wp_body_open()` (`wp proto-blocks script validate` warns when it does not).

### A consent script only for logged-out visitors

```jsonc
{ "title": "Cookie consent", "head": { "file": "head.html" }, "where": { "loggedIn": false } }
```

### Exclude the privacy page

```jsonc
{ "where": { "include": ["all"], "exclude": ["page:privacy-policy"] } }
```

### Verification meta on the front page only

```jsonc
{ "title": "Search console", "head": "<meta name=\"google-site-verification\" content=\"abc123\">", "where": { "include": ["front_page"] } }
```

### Skip administrators (no self-tracking)

```jsonc
{ "where": { "excludeRoles": ["administrator"] } }
```

## Check before finishing

1. `wp proto-blocks script validate` and `wp proto-blocks validate` exit 0; read `missing_body_open`, `snippet_file_missing`, `double_declaration`.
2. View the front page source: the `<!-- proto-blocks: <slug> -->` marker appears in the right place (head, right after `<body>`, before `</body>`), and not on an excluded page.
3. Logged-in rules: test logged in and logged out.
4. Commit the folder in the theme.

## CLI

`wp proto-blocks script list [--format]`, `create <title> [--slug] [--priority]`, `validate [--format]`, `enable <slug>`, `disable <slug>`, `delete <slug> --confirm=<slug>` (removes the folder only when it holds a valid `script.jsonc` and nothing but the three snippet files; otherwise only `script.jsonc` goes and a warning lists what was kept). The CLI works while the module is off.

## REST (when scripting against the site)

`POST admin/scripts/<slug>` takes `{text, hash, snippets}`; `snippets` may be partial and an empty string deletes that file; the response has `hash`, `path`, `created`, `warnings`. Errors: `proto_blocks_unfiltered_html` 403, `proto_blocks_php_in_snippet` 400, `proto_blocks_file_too_large` 413, `proto_blocks_module_disabled` 404. The one database entry is the option `proto_blocks_scripts_body_open` (drives `missing_body_open`).
