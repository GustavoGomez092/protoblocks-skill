# SEO inference

Shell variables do not persist between Bash commands: start each command with the `PB=...; THEME=...;` line from SKILL.md (Scripts).


What to put in `seo.json` when the developer did not provide a value. Never block on missing input; flag it.

## `seo.json` shape

Every leaf is `{ "value": ..., "inferred": true|false, "why": "..." }`. `why` is required when `inferred` is true. Only `focusKeyword`, `title` and `description` are required. For `ogImage` and `organization` the object below is the leaf's `value`, for example `"ogImage": { "value": { "file": "og.png" }, "inferred": false }`.

| Leaf | `value` |
|---|---|
| `focusKeyword` | string, 1-4 lowercase words, no `%`, `<`, `>` |
| `title` | string; Yoast vars `%%sep%%` and `%%sitename%%` allowed. Rendered with the site's real name and separator it must be at most 60 chars |
| `description` | string, 120-156 chars, no newline |
| `schemaPageType` | one of `WebPage, ItemPage, AboutPage, FAQPage, QAPage, ProfilePage, ContactPage, MedicalWebPage, CollectionPage, CheckoutPage, RealEstateListing, SearchResultsPage` (default `WebPage`) |
| `schema` | JSON-LD: an array of nodes (preferred), one node, or an `@graph` object. See `schema.md` |
| `ogImage` | `{ "file": "<path to png>" }` (imported) or `{ "id": <attachment id> }` |
| `organization` | `{ "name": "...", "logo": { "file": "..." } or { "id": N }, "socials": ["https://..."] }` |
| `ogTitle`, `ogDescription`, `twitterTitle`, `twitterDescription` | optional string, one line; only when the developer provides one (for example a social text already set in wp-admin) |

Pitfall: a flat leaf such as `"ogImage": { "file": "og.png", "inferred": false }` has no `value` and is rejected with `[ESEO]`; nest it as `{ "value": { "file": ... }, "inferred": false }`.

Open Graph and Twitter titles are the SEO title with the vars removed and any dangling separator trimmed; their descriptions equal the meta description. Do not infer them. Set a social leaf only for a value the developer provides; a social text customised in wp-admin without a leaf is kept (`kept` in the apply result).

A complete example (the title leaves room for the site name and separator, so it passes without site context; `apply` re-checks it with the real name):

<!-- seo.json example -->
```json
{
  "focusKeyword": { "value": "emergency plumber austin", "inferred": true, "why": "h1 is 'Emergency plumbers in Austin' and the page is a local service" },
  "title": { "value": "Emergency Plumber Austin, 24/7 Repairs %%sep%% %%sitename%%", "inferred": true, "why": "keyword first, qualifier second, site name last" },
  "description": { "value": "Emergency plumbing in Austin, day or night: our plumbers arrive fast, fix it right the first time and quote before work starts. Call or book online today.", "inferred": true, "why": "benefit, proof, call to action; every keyword word in the first half" },
  "schemaPageType": { "value": "WebPage", "inferred": true, "why": "services landing page" },
  "ogImage": { "value": { "file": "/tmp/og.png" }, "inferred": false }
}
```

Validate any `seo.json` offline before applying (this is the same check `apply` runs first; the real site name is added by `apply`):

<!-- test:run -->
```bash
cat > "$THEME/seo-doc.json" <<'JSON'
{
  "focusKeyword": { "value": "emergency plumber austin", "inferred": true, "why": "h1 is the local service" },
  "title": { "value": "Emergency Plumber Austin, 24/7 Repairs %%sep%% %%sitename%%", "inferred": true, "why": "keyword first" },
  "description": { "value": "Emergency plumbing in Austin, day or night: our plumbers arrive fast, fix it right the first time and quote before work starts. Call or book online today.", "inferred": true, "why": "benefit, proof, call to action" }
}
JSON
node --input-type=module -e '
import fs from "node:fs";
const { validateSeo } = await import(process.env.PB + "/lib/seo.mjs");
const seo = JSON.parse(fs.readFileSync(process.env.THEME + "/seo-doc.json", "utf8"));
const errs = validateSeo(seo);
if (errs.length) { console.error(errs.join("\n")); process.exit(1); }
const long = { ...seo, title: { value: "x".repeat(61), inferred: false } };
if (!validateSeo(long).some((e) => e.startsWith("title:"))) { console.error("a 61-char title must fail"); process.exit(1); }
const site = validateSeo(seo, { siteName: "A Very Long Plumbing Company Name Ltd", sep: "|" });
if (!site.some((e) => e.startsWith("title:"))) { console.error("the real site name must count"); process.exit(1); }
console.log("ok");
'
rm -f "$THEME/seo-doc.json"
```

## Focus keyword

The page's primary topic phrase.

1. Take the noun phrase of the h1, and the most repeated 2-3-word phrase across the hero and section headings.
2. Prefer the phrase both share. Add the location when the page is a local service (city or region the page states).
3. Lowercase, 1-4 words. Leave the brand name out unless this is the brand's own page.
4. `why`: name the h1 or headings it came from.

The audit expects the keyword in the SEO title, h1, first paragraph and meta description (fail) and the slug (warn). It matches like Yoast: every keyword word of 3+ characters must appear, in any order, as the word itself or one of its regular forms: `-s`, `-es`, `-y` to `-ies`, `-ing`, `-ed`, `-er`, `-ers` and the possessive `'s` (`plumber` matches `plumbers`, `emergency` matches `emergencies`). Other words never match, even with the same start: `plumber` does not match `plumbing`, `car` does not match `care`. So `emergency plumber austin` passes the h1 "Emergency plumbers in Austin" but not "Emergency plumbing in Austin"; pick the keyword from the words the h1 really uses. Text is compared after Unicode (NFC), quote and dash normalisation. If the page copy lacks a keyword word, change the keyword to words the copy already uses; edit copy only when the developer agrees. Never repeat the keyword to satisfy a check.

## SEO title

`<Primary keyword phrase> <qualifier> %%sep%% %%sitename%%`

- Front-load the keyword. Qualifier: a benefit or modifier taken from the page (not a made-up claim).
- Budget: 60 minus the length of ` <sep> <site name>`. Get the real values before writing: `apply` fetches them and reports the rendered length in `[ESEO]`; the audit checks the served `<title>`.
- Title Case is fine; no keyword repetition.

## Meta description

Benefit, then proof, then a call to action; 120-156 chars; keyword in the first half; no double quotes; one line.

- Proof must come from the page (a number or guarantee it shows). If it shows none, write benefit and action only, padded with specifics the page does show.
- Count characters before applying; `[ESEO]` reports the count.

## Schema page type

| Page | `schemaPageType` |
|---|---|
| Landing, services, home | `WebPage` |
| About | `AboutPage` |
| Contact | `ContactPage` |
| Page led by an FAQ | `FAQPage` |
| Single product | `ItemPage` |
| Listing of items | `CollectionPage` |

When unsure, `WebPage`.

## Organization

Only when Yoast has no company yet; otherwise `apply` returns `organization: kept` (report it, do not force). Read the header logo and footer: name from the logo text or footer legal line, logo file from the design assets (cropped logo PNG; ask if none), socials from the footer icons' link URLs (https only, drop any that are not full URLs). Omit the leaf entirely when you have no real name. Mark each part provided or inferred. Without a logo Yoast prints no Organization schema piece at all (it needs a company name and a logo); `apply` warns, so ask for the logo file rather than leaving it out.

## Worked example: 6-section landing page

Sections: 1 header, 2 hero (h1 "Emergency plumbers in Austin", paragraph "Burst pipe at 2 a.m.? Our licensed Austin plumbers handle emergency repairs around the clock, with upfront quotes.", CTA "Book now"), 3 three-service grid, 4 how it works (3 steps), 5 FAQ (4 questions), 6 footer.

- Keyword: h1 and headings repeat "plumbers" and "Austin" -> `emergency plumber austin`, inferred. Every word is in the h1, the hero paragraph and the description, so `kw-h1`, `kw-first-paragraph` and `kw-description` pass.
- Title and description: as in the example above.
- Page type: the FAQ is one of several sections, so `WebPage`, not `FAQPage`.
- OG image: first content section is `#pb-s2` (section 1 is the header): `og-image.mjs ... --selector '#pb-s2'`; open the PNG and check the headline is whole.
- Schema: a `FAQPage` node from section 5's real questions (`schema.md`), plus `Service` nodes from section 3.
- Organization: footer shows a name and logo; Yoast is empty, so include it. If Yoast already has one, `kept` goes in the report.
- Audit: fix the failing checks; then `record-audit`.
