# Apply, audit and record: results and errors

## `seo.mjs apply` result

- `jsonld`: `written`, `unsupported` (theme lacks the extension), `none` (no schema leaf; page JSON-LD untouched) or `cleared` (a schema applied earlier was dropped from `seo.json`, so it was removed).
- `organization`: `set`, `kept` or `skipped` (no organization leaf).
- `media`: imported OG image and logo `{role, id, reused}`.
- `index`: `ok`, `skipped` or `failed: ...`.
- `ogImage`: `{file, resized, source}` for a supplied file; `resized: true` means it was not 1200x630 and the cover-fitted copy `artifacts/<page>/og-supplied.png` was imported instead (`seo.json` keeps the original path). Tell the developer; never swap a supplied image for a generated one without asking.
- `overwritten`: with `--force`, the edited values that were replaced.
- `kept`: derived social fields (`opengraph-title`, `opengraph-description`, `twitter-title`, `twitter-description`) that the developer customised in wp-admin and that `seo.json` has no leaf for; they were left as they are. Report them; to change one, add its leaf (`ogTitle`, `ogDescription`, `twitterTitle`, `twitterDescription`).
- `warnings`: for example site context unavailable, or an organization without a logo (Yoast prints no Organization schema piece without one).

## Edits made in wp-admin

`apply` stores what it wrote in the page's `seo.appliedValues`. Before writing, it reads the live values (`seo.mjs get`) and refuses with `[EEDITED]` when a value it would overwrite differs from both what it last applied and what it is about to write: a different non-empty value, or a value the developer cleared. On a first apply every non-empty Yoast value counts, because the developer may have filled Yoast by hand. Nothing is imported or written on `[EEDITED]`. Resolve it by treating the live value as provided in `seo.json` (then it is not a conflict), or with `--force` when the developer agrees to the overwrite. A derived social field without a leaf never raises `[EEDITED]`: a customised one is kept and listed in `kept`.

`seo.mjs get` prints `{slug, postId, values, appliedValues, edited}`: `values` are the raw per-page Yoast values (`''` when unset, so Yoast's post-type defaults are not shown) and `jsonld` is the stored JSON string.

Organization policy: Yoast's site Organization is written only when the site is an unconfigured Company (no company name). A Person site or an existing company is `kept`, and its logo file is then not imported. On an unconfigured Company, supplied socials merge with the existing ones (an empty Facebook / Twitter field is filled; the rest join the other URLs); `--force-organization` replaces them. Report `organization: kept` to the developer with what Yoast holds; never pass `--force-organization` unless they explicitly ask for the overwrite (it replaces name, logo and socials).

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
