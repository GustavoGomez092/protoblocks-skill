---
name: protoblocks-seo
description: Use when a Proto-Blocks page is complete and needs SEO, or when asked to fix a page's SEO - sets the Yoast focus keyword, SEO title, meta description, Open Graph/Twitter data and image, schema page type and JSON-LD, inferring and flagging anything the developer didn't provide, then audits the rendered page and fixes failures. Normally invoked by protoblocks-site-builder after the last section of a page is done.
---

# Proto-Blocks SEO

Writes a built page's SEO through Yoast, then audits the rendered page. Work only on the site preflight resolved. Every tool prints JSON on stdout; failures print `[CODE] message` on stderr.

```bash
PB="${CLAUDE_SKILL_DIR}/../protoblocks-site-builder/scripts"
```

`THEME` is the fork's directory (`protoblocks-site-setup` result). Look the page up by `slug` in state: `node "$PB/lib/state.mjs" get "$THEME" pages` (never assume a position). Its `url` is the live page; `postId` must exist (the page was built). Status `seo` means all sections are done or skipped.

## When

- A page reaches status `seo`, or the developer asks for SEO on a page (also for an already `done` page).
- Re-applying on a `done` page resets its status to `seo`; the old audit no longer applies, so finish with Step 8.

## Step 1 - Gather

Ask once for what the developer wants to provide: focus keyword, title, description, audience or location, an OG image file, business name, logo file, social links. Never block on it: infer the rest. Read the page's real headings and copy once (the audit prints them under `extract`):

```bash
node "$PB/qa/seo-audit.mjs" --url <url> --keyword "<draft keyword>" --out "$THEME/.protoblocks/artifacts/<page>/seo-audit.json"
```

(exit 1 only means checks failed; the file is still written.)

## Step 2 - Infer

Rules and the `seo.json` shape: `references/inference.md`. Every inferred value carries `inferred: true` and a one-line `why`; provided values carry `inferred: false`.

## Step 3 - OG image

Supplied file: use it as `ogImage.file`. Otherwise generate 1200x630 from the first content section (lowest `n` that is not header/footer):

```bash
node "$PB/qa/og-image.mjs" --url <url> --selector '#pb-s<n>' --out "$THEME/.protoblocks/artifacts/<page>/og.png"
```

Open the PNG. If a headline is cut or the crop is empty, pick another section selector and say why. The image is imported with alt = page title and also becomes the featured image when the page has none.

## Step 4 - Schema

Choose `schemaPageType` and build `schema.value` from what the page really shows: `references/schema.md`. The theme must support custom JSON-LD:

```bash
node "$PB/lib/jsonld.mjs" check "$THEME"
```

`{"supported":false}` means apply skips the JSON-LD (`jsonld: "unsupported"`); tell the developer the theme needs a proto-blocks-theme release with the Yoast JSON-LD extension.

## Step 5 - Apply

Write `seo.json`, then:

```bash
node "$PB/lib/seo.mjs" apply "$THEME" <page> seo.json [--force-organization]
```

`apply` validates first. `[ESEO]` lists every problem: fix the values and re-run (nothing was written). Rules: the title rendered with the site's real name and Yoast separator is at most 60 chars; keyword is 1-4 lowercase words without `%`, `<`, `>`; description is 120-156 chars with no newline; schema page type is a supported one; organization socials are https. Missing files (`[EFILE]`) and a missing page or postId (`[ENOPAGE]`) also stop it before any import.

Result fields to read and relay:

- `jsonld`: `written`, `unsupported` (theme lacks the extension), `none` (no schema leaf; page JSON-LD untouched) or `cleared` (a schema applied earlier was dropped from `seo.json`, so it was removed).
- `organization`: `set`, `kept` or `skipped` (no organization leaf).
- `media`: imported OG image and logo `{role, id, reused}`; `index`: `ok`, `skipped` or `failed: ...`; `warnings`: for example site context unavailable.

Organization policy: Yoast's site Organization is written only when the site is an unconfigured Company (no company name). A Person site or an existing company is `kept`. Report `organization: kept` to the developer with what Yoast holds; never pass `--force-organization` unless they explicitly ask for the overwrite (it replaces name, logo and socials).

## Step 6 - Audit and fix

```bash
node "$PB/qa/seo-audit.mjs" --url <url> --keyword "<keyword>" --out "$THEME/.protoblocks/artifacts/<page>/seo-audit.json"
```

`pass` means no `fail` check; `warn` checks are reported, not blocking. Each failing check has a `fix`.

- Meta checks (title, description, og, canonical, jsonld): edit `seo.json` and re-apply.
- Content checks (`h1-count`, `kw-h1`, `kw-first-paragraph`, `img-alt`, `heading-order`): change the section's attrs or template through the `protoblocks-section-loop` skill's Build and Verify steps, rebuild with `node "$PB/lib/page.mjs" build "$THEME" <page>`, and re-run visual QA for every section whose markup changed (`qa-input.mjs prepare`, the visual-qa agent, `qa-input.mjs record`). Do not duplicate those steps here.
- Slug changes (`kw-slug`) only with the developer's OK.

Repeat up to 3 rounds, then report what remains.

## Step 7 - Record

```bash
node "$PB/lib/seo.mjs" record-audit "$THEME" <page> "$THEME/.protoblocks/artifacts/<page>/seo-audit.json"
```

Prints `{pass, status}`; a passing audit sets the page `done`.

## Step 8 - Report

A table: field | value | provided or inferred | why. Then the audit summary with warnings, `organization`, `jsonld`, `index` and `warnings` outcomes.

## Iron rules

- Never invent facts (prices, ratings, reviews, addresses, phone numbers, awards) for schema or copy.
- Review or AggregateRating schema only when the page shows real reviews.
- Never keyword-stuff.
- Never change a published slug without asking.
- `organization: kept` is reported, not forced.

## References

- `references/inference.md` - `seo.json` shape, inference formulas, worked example.
- `references/schema.md` - how the theme merges JSON-LD, recipes per section type.
