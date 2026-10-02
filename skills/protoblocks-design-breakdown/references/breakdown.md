# Breakdown: sections, patterns and decisions

## Band rules

- A section is one full-width band with its own background, or a run of content separated from its neighbours by a clear vertical gap.
- Never split one visual band (a heading above a card grid on the same background is one section).
- Never merge bands with different backgrounds, even if they look related.
- Cuts from `segment.mjs analyze`: `background` = strong boundary, `gap` = candidate (check by eye), `to: null` / `bg: null` = photo or gradient band (a hero with a background image): treat as one band unless the image visibly ends.
- Header and footer are the first and last bands. They become the shared `site-header` and `site-footer` blocks.

## Pattern catalog

| Pattern | Content model | Typical controls |
|---|---|---|
| Hero (split) | eyebrow, heading, text, 1-2 buttons, image | `imagePosition`, `alignment` |
| Hero (centered) | heading, text, buttons | `alignment`, `width` |
| Hero (background media) | heading, text, buttons, background image | `overlay`, `textColor` |
| Logo wall | gallery of logos (+ optional heading) | `columns`, `grayscale` |
| Feature grid | repeater: icon, title, text | `columns`, `style` |
| Media-text | image + wysiwyg body | `imagePosition`, `ratio` |
| Stats | repeater: value, label | `columns` |
| Testimonials | repeater (or one): quote, name, role, avatar | `layout` |
| Pricing | repeater of plans: name, price, features (wysiwyg list), button | `highlight` toggle per plan |
| FAQ | repeater: question, answer; accordion via the Interactivity API | `allowMultiple` |
| CTA band | heading, text, button(s) | `tone`, `alignment` |
| Content / rich text | inner-blocks | `width` |
| Team grid | repeater: photo, name, role, social links | `columns` |
| Timeline / steps | repeater: label, title, text | `orientation` |
| Contact / form embed | heading, text, form shortcode or embed field | `layout` |
| Header / footer | logo, menu, buttons / columns of links, legal | shared parts |

Content model rules: choose the fewest, richest regions. Repeating, same-shaped items are a repeater; plain media lists are a gallery; free-flowing prose is wysiwyg; mixed arbitrary blocks are inner-blocks. See the `protoblocks` skill `references/composition.md` for the decision, and `fields.md`, `controls.md`, `repeaters.md` for syntax. Visual choices that change how existing content looks (columns, alignment, position, tone) are controls with a default, not fields.

## Decision rules

| Decision | When | Example |
|---|---|---|
| `reuse` | an existing block already renders this layout with different content; at most variants already present | Second page also has a 3-column feature grid -> reuse `feature-grid` |
| `extend` | an existing block is 80% right and the gap is one more control or field | Media-text exists, new page needs image on the right: add `imagePosition` |
| `new` | structurally different (different regions, markup or behaviour) | Pricing table when only `feature-grid` exists |

Extend is additive only. The test: the new control or field defaults to the current output, so every existing instance renders identically. If you cannot meet that, make a new block. Regression checks on previously built pages verify it.

Intra-page merge: if two sections on this page share structure and differ only by content or by one existing/additive control, they are one block used twice (e.g. two media-text bands, one with the image flipped). Do not merge when the structure differs on mobile (a 4-up grid that becomes a carousel on mobile vs a stacked list), or when merging forces optional regions that make the block hard to use.

Use `library.mjs list` fields, controls and `variants` as the source of truth; a library entry with `error` is a block that exists but cannot be read: do not recreate it, report it.

## Naming

Generic, kebab-case, at most three words, describing the pattern and not the page or the client.

| Good | Bad |
|---|---|
| `hero-split`, `feature-grid`, `media-text`, `pricing-table`, `faq-accordion` | `home-hero`, `acme-banner`, `section-2`, `big-blue-cta-with-three-buttons` |

## Shared micro-elements

Buttons, eyebrows and section headings are not blocks. They are token-based classes in the theme (Tailwind utilities or component classes built from the design tokens). Name the class in the plan Notes (for example "btn-primary, eyebrow") so the section loop uses the same ones everywhere.

## Plan table

One row per section, with the crop path (`artifacts/<page>/crops/desktop/pb-s<n>.png`):

| # | Section | Crop | Decision | Block | Fields / controls | Notes |
|---|---|---|---|---|---|---|
| 1 | Header | crops/desktop/pb-s1.png | new | `site-header` | logo image, menu from `primary`, button | shared part; sticky |
| 2 | Hero | crops/desktop/pb-s2.png | new | `hero-split` | eyebrow, heading, text, buttons repeater, image; `imagePosition` | btn-primary, eyebrow |
| 3 | Logo wall | crops/desktop/pb-s3.png | new | `logo-wall` | gallery; `columns` | grayscale; logos cropped (replace with originals) |
| 4 | Features | crops/desktop/pb-s4.png | new | `feature-grid` | heading, repeater icon/title/text; `columns` | icons as inline SVG |
| 5 | Case study | crops/desktop/pb-s5.png | new | `media-text` | image, wysiwyg; `imagePosition` | photo masked |
| 6 | CTA | crops/desktop/pb-s6.png | new | `cta-band` | heading, text, button; `tone` | btn-primary |
| 7 | Footer | crops/desktop/pb-s7.png | new | `site-footer` | link columns, legal | shared part |

On the second page the same table shows `reuse` for header and footer, `extend`/`reuse` where blocks exist. After the table, list: assets cropped from the design (replace with originals), masks, tokens or fonts the design needs that setup did not provide, and any copy that could not be read.

## Recording the plan

Only after the developer approves. The per-field `set` calls in SKILL.md work for a few sections. For a whole page write one atomic update with `updateState` (the same lock and validation `state.mjs set` uses). Section `n` in the plan maps to the state section with that `n`; the script does not touch crops or masks.

<!-- test:run -->
```bash
cat > "$THEME/.protoblocks/plan.json" <<'JSON'
{
  "page": "home",
  "sections": [
    {"n": 1, "label": "Header", "decision": "new", "block": "site-header", "notes": "shared part; sticky"},
    {"n": 2, "label": "Hero", "decision": "new", "block": "hero-split", "notes": "Image right; \"Book a demo\" button"},
    {"n": 3, "label": "Features", "decision": "reuse", "block": "feature-grid", "notes": "3 columns"}
  ]
}
JSON
PLAN="$THEME/.protoblocks/plan.json" THEME="$THEME" PB="$PB" node --input-type=module -e '
const { updateState } = await import(process.env.PB + "/lib/state.mjs");
const fs = await import("node:fs");
const plan = JSON.parse(fs.readFileSync(process.env.PLAN, "utf8"));
updateState(process.env.THEME, (s) => {
  const page = s.pages.find((p) => p.slug === plan.page);
  if (!page) throw new Error("No page " + plan.page + " in state");
  for (const p of plan.sections) {
    const sec = page.sections.find((x) => x.n === p.n);
    if (!sec) throw new Error("No section n=" + p.n + " (run intake.mjs crop first)");
    Object.assign(sec, { label: p.label, decision: p.decision, block: p.block, notes: p.notes });
  }
  page.plan = { approvedAt: new Date().toISOString(), by: "developer" };
  page.status = "building";
});
'
node "$PB/lib/state.mjs" get "$THEME" pages.0.plan
```

Missing sections throw before anything is written, so a partial plan is never saved. Afterwards `node "$PB/lib/state.mjs" validate "$THEME"` must print `{"valid": true}`.
