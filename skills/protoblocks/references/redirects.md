# Redirects

Proto-Blocks 2.16.0+ keeps every redirect rule and every redirect setting in files in the theme. The database holds only hit counts, the redirect log and the 404 log (three tables). Edit in **Proto Blocks > Redirects**, which writes the same files.

Plugin docs (Proto-Blocks repo): `docs/redirects.md`, `docs/content-model-files.md`, `docs/trust-and-security.md`, `docs/cli.md`.

## PHP one-liner or file?

| Use | When |
|---|---|
| `proto_redirect('/old', '/new');` in `functions.php` | One or two rules, no review needed. Group `php`. Callable until `init` priority 9. |
| `proto-redirects/<group>/redirects.jsonc` | Anything else: a migration, conditions, groups, flags. Preferred for agents: reviewable diff. |

Folder name = group slug: `^[a-z][a-z0-9_-]*$`, 60 chars max, `settings` reserved (and `php` for `proto_redirect_group()`). Child theme wins on the same slug. A file group beats a PHP group (or PHP rule with the same `from` + regex flag + `when`) with a `double_declaration` warning. A broken group file (invalid JSONC, over 256 KB, outside its root) also drops the PHP group and the parent's group of that slug (`broken_override`). A group-level schema error skips the group; a rule-level error drops only that rule.

```php
proto_redirect('/old', '/new');                       // 301
proto_redirect('/promo', '/sale', 302);
proto_redirect('/gone', null, 410);                   // 4xx/5xx code implies action error
proto_redirect('^/blog/(.*)$', '/news/$1', ['regex' => true]);
proto_redirect('/members', '/dashboard', ['when' => ['type' => 'login'], 'else' => '/login']);
proto_redirect_group('Legacy site', ['position' => 5, 'rules' => [['from' => '/a', 'to' => '/b']]]);
```

## `redirects.jsonc`, annotated

```jsonc
// proto-redirects/legacy-site/redirects.jsonc  -> group "legacy-site"
{
  "title": "Legacy site",
  "enabled": true,                  // false silences the whole group
  "position": 10,                   // ascending, then slug
  "defaults": { "ignoreCase": true, "ignoreTrailingSlash": true, "query": "exact" },
  "rules": [
    { "from": "/about-us", "to": "/about" },
    { "id": "r_8f3a2c1d", "title": "Old blog", "from": "^/blog/(\\d+)/(.*)$", "regex": true, "to": "/news/$2", "code": 301 },
    { "from": "/promo", "to": "/sale", "code": 302, "query": "pass" },
    { "from": "/members", "when": { "type": "login" }, "to": "/dashboard", "else": "/login" },
    { "from": "/gone-forever", "action": "error", "code": 410 },
    { "from": "/old-api", "action": "pass", "to": "/wp-json/v1/thing" },
    { "from": "/ignore-me", "action": "nothing" },
    { "when": { "type": "404" }, "to": "/", "enabled": false }
  ]
}
```

## Every rule key

| Key | Default | Notes |
|---|---|---|
| `id` | derived `r_` + 8 hex | Stable id for hits, derived from slug + `from` + normalised `when` + `action` (so give an explicit id before editing a source). Two rules with the same id: `duplicate_rule`. |
| `title` | `""` | No `<` `>`. |
| `enabled` | `true` | |
| `from` | required unless `when.type` is `404` | Non-regex: starts with `/` (`missing_source`, `invalid_source`). Kept as written, decoded once when matched. `\\?` is a literal `?`. Same-host absolute URL is reduced to its path; another host is `use_when_server` (use `when: {type: "server"}`). |
| `regex` | `false` | PCRE body, no delimiters, max 500 chars, compile errors are `invalid_regex`, no `^`/`$` warns `unanchored_regex`. |
| `to` | required for `url`, `pass`; refused for `error`, `nothing` | Path or absolute `http(s)://`. `$1`..`$9`, `${1}` when `regex`. Other shapes: `invalid_target`. |
| `else` | none | Target when `when` is false. Only with `when` and `action: url`. |
| `code` | 301 (`url`), 404 (`error`) | url: 301 302 303 307 308. error: 400 401 403 404 410 418 451 500 501 502 503 504. Else `invalid_code`; `pass` and `nothing` take none. |
| `action` | `url` | `url`, `error`, `pass` (internal rewrite, path only; logged with code 200), `nothing` (stop, no 404 log, no canonical, never logged). |
| `when` | none | One condition: `login`, `role`, `referrer`, `agent`, `header`, `cookie`, `ip` (IPs or CIDRs), `language`, `server`, `filter`, `404`. |
| `query` | group, else `exact` | `exact`, `exactOrder`, `ignore`, `pass` (extra params appended to target). |
| `ignoreCase`, `ignoreTrailingSlash` | group, else `true` | |
| `log` | `true` | `false`: no log row, no hit. |

Other validation codes: `invalid_else`, `self_redirect`, `invalid_header`, `invalid_condition`, `invalid_regex`, `unanchored_regex` (warning), `redirect_chain` (warning), `schema_invalid`, `declared_too_late`, `duplicate_php`, `both_extensions`, `invalid_jsonc`, `file_too_large`, `path_outside_root`, `unreadable`, `broken_override`, `double_declaration`. Settings: `invalid_header`, `invalid_host`, `invalid_url`, `invalid_ip`.
| `headers` | none | Extra headers on this redirect. Not `Set-Cookie`, `Location`, `Status`, `Content-Length`, `Transfer-Encoding`; no CR/LF. |

## Settings file

`proto-redirects/settings.jsonc`, every key optional: `defaults`, `log` (`redirects` days, `notFound` days, `ip` = `none`|`masked`|`full`, `headers`, `external`, `trustedProxies`, `ipHeaders`), `trackHits`, `cache` (hours on 301/308), `monitor` (`postTypes`, `group`, `trash`, `associated`), `headers` (`site`, `redirect`), `canonical` (`https`, `www` = `""`|`www`|`nowww`, `aliases`, `relocate`), `coexist`. Unknown keys and out-of-range values are `schema_invalid`; on load numbers are clamped (log days -1..90, `cache` in -1, 0, 1, 24, 168 else 1, 20 aliases). `log.external` is reserved: accepted but not acted on. The file is flat (`proto-redirects/settings.jsonc`, no slug folder); REST kind `redirect-settings`, slug `settings`.

While the **Redirection** plugin is active, the module is paused (screen banner) unless `"coexist": true`.

## Recipes

### Migrate from Redirection

1. Install and activate Proto-Blocks 2.16.0+. Redirects pause while Redirection is active.
2. `wp proto-blocks redirect import-plugin redirection --dry-run`, read the output, then without `--dry-run` (or Proto Blocks > Redirects > Import / Export tab > Import from a plugin > Preview, pick the duplicate mode, Import). One group file per Redirection group is written (no group picker in the UI; `--group=` in the CLI); hits are not imported.
3. Deactivate Redirection (the import screen has a "Deactivate ... after importing" checkbox that needs `activate_plugins`).
4. `wp proto-blocks redirect validate`, then `wp proto-blocks redirect test /some/old/url` for 3 known URLs.
5. Commit `proto-redirects/`.

### Catch a renamed section

All `/services/*` moved to `/solutions/*`:

```jsonc
{ "from": "^/services/(.*)$", "regex": true, "to": "/solutions/$1" }
```

For single posts that get renamed later, set `"monitor": { "postTypes": ["page", "post"] }` in `settings.jsonc`: the monitor appends a rule to `modified-posts/redirects.jsonc` when a published post's path changes.

### Role and login landing pages

```jsonc
{ "from": "/account", "when": { "type": "login" }, "to": "/account/dashboard", "else": "/login" },
{ "from": "/start", "when": { "type": "role", "value": "editor" }, "to": "/wp-admin/edit.php" }
```

`login` and `role` depend on the session; `redirect test --logged-in` evaluates them as a logged-in visitor.

### Retire a URL with 410

```jsonc
{ "from": "/discontinued-product", "action": "error", "code": 410 }
```

### Other safe patterns

- Keep marketing parameters: `"query": "pass"`.
- Serve content from another path without changing the URL: `"action": "pass", "to": "/real-path"` (path only).
- Redirect another domain's host: `{ "from": "/", "when": {"type": "server", "value": "old.example.com"}, "to": "https://www.example.com/" }`, or `canonical.aliases`.
- Block a path for everyone: `{ "from": "/private-dump", "action": "error", "code": 403 }`.

## Edge cases to check before declaring a redirect

1. **Trailing slash.** `ignoreTrailingSlash` defaults to `true`; with `false`, `/a` and `/a/` are different sources.
2. **Case.** `ignoreCase` defaults to `true` for the path and query.
3. **Query mode.** `exact` fails when the request has extra parameters (UTM tags). Use `ignore` (drops them) or `pass` (keeps them).
4. **Regex anchoring.** Without `^`/`$` the pattern matches anywhere (`unanchored_regex`). A regex matches `path?query` as one string, and `query` is ignored.
5. **Loops.** `to` equal to `from` is `self_redirect`. A computed target equal to the current request does not fire.
6. **Chains.** `redirect_chain` warns when one target is another rule's source. Point the first rule at the final URL.
7. **Capture groups.** A path target must still be a path after substitution (`//`, backslash, `scheme:` stop the rule). Constrain captures: `([^/]+)` rather than `(.*)` when the target starts with `/$1`.
8. **404 condition.** `when.type: "404"` rules run only at `template_redirect`, after WordPress resolved the request; a real page never reaches them.
9. **Order.** First matching rule wins: group `position`, group slug, file order, one global order for exact and regex rules. A catch-all regex placed first wins everything. A disabled group is skipped whole.
10. **Excluded paths.** `/wp-admin/`, `/wp-login.php`, `/wp-cron.php`, `/xmlrpc.php` and REST are never matched.
11. **Methods.** All HTTP methods are redirected. Use 307/308 when a POST body must survive.
12. **Browser cache.** 301 and 308 are cached. Verify with `curl -sI` or `redirect test`.
13. **Read-only hosts.** With `DISALLOW_FILE_MODS`, an unwritable theme, or multisite without super-admin, the screen and CLI cannot write: edit the files in the theme.
14. **Comments lost on CLI writes.** `redirect add`, the monitor and the CLI serializer rewrite the group file; hand comments inside `rules` are lost. UI edits keep them. The CLI refuses broken JSONC, PHP-only groups and groups from the parent theme. Prefer writing the file yourself.
15. **Hits after deletion.** A rule removed in the file or in the screen leaves an orphan hit row (only the CLI `delete` removes it): `wp proto-blocks redirect prune`, which also runs log retention.
16. **Skipped targets.** A target made unsafe by a capture (`//`, backslash, scheme) or equal to the request does not fire and evaluation continues; `redirect test` shows `unsafe_target`, `self_loop` or `regex_error` in the trace.

Always finish with `wp proto-blocks validate` (exit 0) and `wp proto-blocks redirect test <url>` for each rule you added.

## CLI

`wp proto-blocks redirect` `list [--group= --format=]`, `add <from> [<to>] [--code= --group= (default redirects) --regex --when= --when-value= --when-name= --action= --query= --title=]`, `delete <id>`, `enable <id>`, `disable <id>`, `group list|create <title> [--slug= --position=]|enable|disable|delete <slug> --yes`, `validate [--format=]`, `test <url> [--logged-in --format=]`, `import <file> [--format=csv|json|apache|redirects --group= (default imported) --duplicates=skip|replace|add --dry-run]`, `import-plugin <id> [--group= --duplicates= --dry-run]`, `export [<file>|-] [--format=csv|json|apache|nginx|redirects --group= --force]`, `log [--404 --limit= --clear --format=]`, `prune` (orphan hits plus retention), `db install|status|drop [--yes]`.

Import formats (5 MB cap): CSV (`source,target,regex,code`), JSON (Proto-Blocks and Redirection shapes), Apache (`RewriteRule`, `Redirect`, `RedirectMatch`; no `NC` means case-sensitive, no `QSA` means `query: ignore`, `[F]` is 403), `_redirects`. Exports add Nginx. CSV export omits conditional and 404 rules, `_redirects` export skips non-portable rules; use JSON for a lossless copy. Duplicate key: normalised `from` + regex flag + `when`; `replace` keeps the id. Plugin importers: Redirection, Simple 301 Redirects, Safe Redirect Manager, Rank Math, Yoast SEO Premium, WordPress old slugs.
