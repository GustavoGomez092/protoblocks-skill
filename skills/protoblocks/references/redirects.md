# Redirects

Proto-Blocks 2.16.0+ keeps every redirect rule and every redirect setting in files in the theme. The database holds only hit counts, the redirect log and the 404 log (three tables). Edit in **Proto Blocks > Redirects**, which writes the same files.

Plugin docs (Proto-Blocks repo): `docs/redirects.md`, `docs/content-model-files.md`, `docs/trust-and-security.md`, `docs/cli.md`.

## PHP one-liner or file?

| Use | When |
|---|---|
| `proto_redirect('/old', '/new');` in `functions.php` | One or two rules, no review needed. Group `php`. Callable until `init` priority 9. |
| `proto-redirects/<group>/redirects.jsonc` | Anything else: a migration, conditions, groups, flags. Preferred for agents: reviewable diff. |

Folder name = group slug: `^[a-z][a-z0-9_-]*$`, 60 chars max, `settings` reserved. Child theme wins on the same slug. A file group beats a PHP group (or PHP rule with the same `from` + `when`) with a `double_declaration` warning.

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
| `id` | derived `r_` + 8 hex | Stable id for hits. Two rules deriving the same id: `duplicate_rule`. |
| `title` | `""` | No `<` `>`. |
| `enabled` | `true` | |
| `from` | required unless `when.type` is `404` | Non-regex: starts with `/`. Same-host absolute URL is reduced to its path; another host is `use_when_server` (use `when: {type: "server"}`). |
| `regex` | `false` | PCRE body, no delimiters, max 500 chars, compile errors are `invalid_regex`, no `^`/`$` warns `unanchored_regex`. |
| `to` | required for `url`, `pass` | Path or absolute `http(s)://`. `$1`..`$9`, `${1}` when `regex`. Other schemes: `invalid_target`. |
| `else` | none | Target when `when` is false. Only with `when` and `action: url`. |
| `code` | 301 (`url`), 404 (`error`) | url: 301 302 303 307 308. error: 400 401 403 404 410 418 451 500 501 502 503 504. Else `invalid_code`. |
| `action` | `url` | `url`, `error`, `pass` (internal rewrite, path only), `nothing` (stop, no 404 log, no canonical). |
| `when` | none | One condition: `login`, `role`, `referrer`, `agent`, `header`, `cookie`, `ip` (IPs or CIDRs), `language`, `server`, `filter`, `404`. |
| `query` | group, else `exact` | `exact`, `exactOrder`, `ignore`, `pass` (extra params appended to target). |
| `ignoreCase`, `ignoreTrailingSlash` | group, else `true` | |
| `log` | `true` | `false`: no log row, no hit. |
| `headers` | none | Extra headers on this redirect. Not `Set-Cookie`, `Location`, `Status`, `Content-Length`, `Transfer-Encoding`; no CR/LF. |

## Settings file

`proto-redirects/settings.jsonc`, every key optional: `defaults`, `log` (`redirects` days, `notFound` days, `ip` = `none`|`masked`|`full`, `headers`, `external`, `trustedProxies`, `ipHeaders`), `trackHits`, `cache` (hours on 301/308), `monitor` (`postTypes`, `group`, `trash`, `associated`), `headers` (`site`, `redirect`), `canonical` (`https`, `www` = `""`|`www`|`nowww`, `aliases`, `relocate`), `coexist`. Unknown keys are `schema_invalid`. REST kind: `redirect-settings`, slug `settings`.

While the **Redirection** plugin is active, the module is paused (screen banner) unless `"coexist": true`.

## Recipes

### Migrate from Redirection

1. Install and activate Proto-Blocks 2.16.0+. Redirects pause while Redirection is active.
2. `wp proto-blocks redirect import-plugin redirection --dry-run`, read the output, then without `--dry-run` (or Proto Blocks > Redirects > Import / Export > Import from plugin). One group file per Redirection group is written; hits are not imported.
3. Deactivate Redirection (the import screen has a checkbox).
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
9. **Order.** First matching rule wins: group `position`, group slug, file order. A catch-all regex placed first wins everything.
10. **Excluded paths.** `/wp-admin/`, `/wp-login.php`, `/wp-cron.php`, `/xmlrpc.php` and REST are never matched.
11. **Methods.** All HTTP methods are redirected. Use 307/308 when a POST body must survive.
12. **Browser cache.** 301 and 308 are cached. Verify with `curl -sI` or `redirect test`.
13. **Read-only hosts.** With `DISALLOW_FILE_MODS`, an unwritable theme, or multisite without super-admin, the screen and CLI cannot write: edit the files in the theme.
14. **Comments lost on CLI writes.** `redirect add`, the monitor and the CLI serializer rewrite the group file; hand comments inside `rules` are lost. UI edits keep them. Prefer writing the file yourself.
15. **Hits after deletion.** A rule removed in the file leaves an orphan hit row: `wp proto-blocks redirect prune`.

Always finish with `wp proto-blocks validate` (exit 0) and `wp proto-blocks redirect test <url>` for each rule you added.

## CLI

`wp proto-blocks redirect` `list [--group= --format=]`, `add <from> [<to>] [--code= --group= --regex --when= --when-value= --action= --query= --title=]`, `delete <id>`, `enable <id>`, `disable <id>`, `group list|create <title>|enable|disable|delete <slug>`, `validate`, `test <url> [--logged-in]`, `import <file> [--format=csv|json|apache|redirects --group= --duplicates=skip|replace|add --dry-run]`, `import-plugin <id> [--group= --dry-run]`, `export [--format=csv|json|apache|nginx|redirects --group=] [<file>|-]`, `log [--404 --limit= --clear]`, `prune`, `db install|status|drop [--yes]`.

Import formats: CSV (`source,target,regex,code`), JSON (Proto-Blocks and Redirection shapes), Apache (`RewriteRule`, `Redirect`, `RedirectMatch`), `_redirects`. Exports add Nginx. Plugin importers: Redirection, Simple 301 Redirects, Safe Redirect Manager, Rank Math, Yoast SEO Premium, WordPress old slugs.
