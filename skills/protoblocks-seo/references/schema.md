# JSON-LD (schema)

Shell variables do not persist between Bash commands: start each command with the `PB=...; THEME=...;` line from SKILL.md (Scripts).

Custom JSON-LD is the `schema` leaf of `seo.json`; `apply` stores it in the page's post meta `_proto_jsonld` and the theme prints it inside Yoast's single graph. It needs a proto-blocks-theme release with the Yoast JSON-LD extension (`node "$PB/lib/jsonld.mjs" check "$THEME"` prints `{"supported":true}`). Without it `apply` reports `jsonld: "unsupported"` and writes nothing.

## How the theme merges it

Source: the theme's `inc/proto-yoast-jsonld.php`, `wpseo_schema_graph` filter (`proto_jsonld_filter_graph`). Only singular post indexables are touched; password-protected pages are skipped.

- **Accepted shapes**: a single node object, an array of nodes, or an object with `@graph`. `@context` is dropped from every node. Blank or invalid JSON is stored but never printed, so the page then has no custom JSON-LD (the audit's `jsonld-parse` still sees Yoast's own block).
- **Merged into Yoast's WebPage piece**: a node whose `@id` is the page's main schema id or `#webpage`, or whose `@type` is `WebPage` or a subtype (`AboutPage`, `CheckoutPage`, `CollectionPage`, `ContactPage`, `FAQPage`, `ItemPage`, `MedicalWebPage`, `ProfilePage`, `QAPage`, `RealEstateListing`, `SearchResultsPage`, `MediaGallery`, `ImageGallery`, `VideoGallery`). The node's properties override Yoast's (`array_merge`), Yoast's `@id` is kept, and the `@type` values are unioned. So do not repeat `name`, `url` or `@id` in such a node unless you mean to replace Yoast's.
- **Appended as their own nodes**: every other node. A relative id (`#faq-q1`) becomes `<canonical>#faq-q1`, including ids nested inside the node (such as `mainEntity` refs). A node without `@id` gets `<canonical>#proto-<type>-<n>`. A node without `isPartOf` gets `isPartOf: {"@id": <main id>}`, except `Organization`, `Person`, `Brand`, `WebSite`, `ImageObject` and `Place`.
- If Yoast has no WebPage piece, a WebPage-type node is appended with the main id as its `@id`.

Developers can also edit the field by hand in the Yoast editor panel ("JSON-LD" row). A hand edit is not tracked by `seo.json`: if the page's state still lists a `schema`, the next `apply` overwrites it, and dropping the `schema` leaf from `seo.json` clears what a previous `apply` wrote (`jsonld: "cleared"`). With no schema leaf and none applied before, the page's JSON-LD is left alone (`jsonld: "none"`). An explicit empty array `[]` as `schema.value` clears it too.

## Required properties

The audit's `jsonld-required` check fails when a node (including nested ones) lacks:

| Type | Required |
|---|---|
| WebPage | `name`, `url` |
| Organization | `name`, `url` |
| FAQPage | `mainEntity` |
| Question | `name`, `acceptedAnswer` |
| Answer | `text` |
| Product | `name` |
| Service | `name` |
| Event | `name`, `startDate`, `location` |
| Review | `itemReviewed`, `reviewRating`, `author` |
| HowTo | `name`, `step` |
| BreadcrumbList | `itemListElement` |

Yoast supplies the WebPage `name` and `url`. Check the rendered page after applying; the audit reads the served JSON-LD.

## Recipes

Use only content the page shows, word for word where it is text. Set `schemaPageType` to `FAQPage` only when the FAQ is the page's main content.

### FAQ section

The `FAQPage` node merges into Yoast's WebPage; each question is its own appended node.

```json
[
  { "@type": "FAQPage", "mainEntity": [{ "@id": "#faq-1" }, { "@id": "#faq-2" }] },
  { "@type": "Question", "@id": "#faq-1", "name": "Do you quote before starting?", "acceptedAnswer": { "@type": "Answer", "text": "Yes. You get a written quote before any work begins." } },
  { "@type": "Question", "@id": "#faq-2", "name": "Do you work weekends?", "acceptedAnswer": { "@type": "Answer", "text": "Yes, we take emergency calls every day." } }
]
```

### Services grid

One `Service` per card. `provider` points at the site's Organization only when the site is a Yoast Company; Yoast's id is `<home url>/#organization` (confirm it in the rendered JSON-LD first; a Person site has no such piece, so omit `provider`).

```json
[
  { "@type": "Service", "name": "Drain cleaning", "description": "Clears blocked sinks, showers and main lines.", "provider": { "@id": "https://example.com/#organization" } }
]
```

### Product or pricing

`Product` with `offers` only when prices are shown on the page; copy them exactly.

```json
[
  { "@type": "Product", "name": "Starter plan", "description": "Text from the card.", "offers": { "@type": "Offer", "price": "29.00", "priceCurrency": "USD", "url": "https://example.com/pricing/" } }
]
```

### Event

`startDate` is ISO 8601; `location` is a `Place` (with `address`) or `VirtualLocation` (with `url`), as the page states.

```json
[
  { "@type": "Event", "name": "Open house", "startDate": "2027-03-14T10:00:00-05:00", "location": { "@type": "VirtualLocation", "url": "https://example.com/live/" } }
]
```

### How-to or steps

```json
[
  { "@type": "HowTo", "name": "How it works", "step": [
    { "@type": "HowToStep", "name": "Call or book", "text": "Tell us what is wrong." },
    { "@type": "HowToStep", "name": "Get a quote", "text": "We confirm the price first." }
  ] }
]
```

### Testimonials

`Review` pieces only with a real author name and the rating shown on the page. No rating shown, no `Review`, and never an `AggregateRating` made up from a few quotes.

```json
[
  { "@type": "Review", "itemReviewed": { "@type": "Service", "name": "Drain cleaning" }, "reviewRating": { "@type": "Rating", "ratingValue": "5", "bestRating": "5" }, "author": { "@type": "Person", "name": "Name as shown" }, "reviewBody": "Quote as shown." }
]
```

## In `seo.json`

The array goes in `schema.value`; mark it inferred with a `why` naming the sections it came from.

<!-- seo.json example -->
```json
{
  "focusKeyword": { "value": "emergency plumber austin", "inferred": false },
  "title": { "value": "Emergency Plumber Austin, 24/7 Repairs %%sep%% %%sitename%%", "inferred": false },
  "description": { "value": "Burst pipe or no hot water? Our Austin plumbers arrive fast, fix it right the first time and quote before work starts. Call or book online today.", "inferred": false },
  "schemaPageType": { "value": "WebPage", "inferred": true, "why": "FAQ is one section of a services page" },
  "schema": { "value": [
    { "@type": "FAQPage", "mainEntity": [{ "@id": "#faq-1" }] },
    { "@type": "Question", "@id": "#faq-1", "name": "Do you quote before starting?", "acceptedAnswer": { "@type": "Answer", "text": "Yes. You get a written quote before any work begins." } }
  ], "inferred": true, "why": "section 5 is an FAQ with these questions" }
}
```

## Check

After `apply`, run the audit: `jsonld-parse` fails on unparsable JSON-LD, `jsonld-required` names `Type.property` pairs that are missing. Optionally paste the page URL into Google's Rich Results Test by hand.
