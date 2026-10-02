# Apply, audit and record: results and errors

## `seo.mjs apply` result

- `jsonld`: `written`, `unsupported` (theme lacks the extension), `none` (no schema leaf; page JSON-LD untouched) or `cleared` (a schema applied earlier was dropped from `seo.json`, so it was removed).
- `organization`: `set`, `kept` or `skipped` (no organization leaf).
- `media`: imported OG image and logo `{role, id, reused}`.
- `index`: `ok`, `skipped` or `failed: ...`.
- `warnings`: for example site context unavailable.

Organization policy: Yoast's site Organization is written only when the site is an unconfigured Company (no company name). A Person site or an existing company is `kept`. Report `organization: kept` to the developer with what Yoast holds; never pass `--force-organization` unless they explicitly ask for the overwrite (it replaces name, logo and socials).

## `seo-audit.mjs` exit codes

| Exit | Meaning | Audit file |
|---|---|---|
| 0 | every check passed (warnings allowed) | written |
| 1 | at least one check failed | written |
| 2 | the audit could not run: browser launch, navigation, or the page answered HTTP 400+ (`[EHTTP]`: check the URL and that the page is published) | not written |
| 64 | usage | not written |

The file records `url`, `focusKeyword` and `at` (ISO time of the audit), which `record-audit` checks.

`robots-noindex` (warn) and a warn-level `canonical` that names noindex: Settings → Reading → "Discourage search engines" is on (or the page is noindex), so Yoast omits the canonical. Ask the developer; never toggle it yourself.

## `seo.mjs record-audit` errors

Only a page in status `seo` is promoted, to `done`, and only by a passing audit. Nothing is recorded on an error.

- `[EAUDITSTALE]`: the audit's `focusKeyword` is not the applied focus keyword, its `url` is not the page's `url`, its `at` is missing or not later than the last apply, or SEO was never applied. Re-run the audit after the last apply and record that file.
- `[ESTATUS]`: the page is not in status `seo`: still `planning`/`building` (not ready for SEO), or already `done` (re-apply its SEO to audit it again).
- `[EINPUT]`: the file is unreadable or not an audit result. `[ENOPAGE]`: no such page.
