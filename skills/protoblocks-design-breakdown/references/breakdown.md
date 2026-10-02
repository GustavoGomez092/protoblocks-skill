# Breakdown: sections, patterns and decisions

Shell variables do not persist between Bash commands: start each command with the `PB=...; THEME=...;` line from SKILL.md (Scripts).

## Band rules

- A section is one full-width band with its own background, or a run of content separated from its neighbours by a clear vertical gap.
- Never split one visual band (a heading above a card grid on the same background is one section).
- Never merge bands with different backgrounds, even if they look related.
- Cuts from `segment.mjs analyze`: `background` = strong boundary, `gap` = candidate (check by eye), `to: null` / `bg: null` = photo or gradient band (a hero with a background image): treat as one band unless the image visibly ends.
- Header and footer are the first and last bands. They become the shared `site-header` and `site-footer` blocks, with the fixed anchors `pb-header` and `pb-footer` (mark their ranges and plan rows with `"part"`).
- Overlay header on a full-bleed photo hero (a transparent header drawn over the hero image): the header band's crop then contains the hero photo, which the header block alone never renders. Either (a) crop the header band with the photo behind it and mask the photo region of the header crop (`sections[j].masks`, see `intake.md`; keep logo, menu and buttons unmasked), or (b) verify the header in the context of the hero: start the hero's crop at the top of the frame (`y0` 0) so the hero's verification covers the header as drawn over the photo (an element screenshot of the hero includes what overlaps it), and still mask the header crop's photo region as in (a). Note the choice in the plan Notes.

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

One row per section, with the crop path (`artifacts/<page>/crops/desktop/<anchor>.png`):

| # | Section | Crop | Decision | Block | Fields / controls | Notes |
|---|---|---|---|---|---|---|
| 1 | Header | crops/desktop/pb-header.png | new | `site-header` | logo image, menu from `primary`, button | shared part; sticky |
| 2 | Hero | crops/desktop/pb-s2.png | new | `hero-split` | eyebrow, heading, text, buttons repeater, image; `imagePosition` | btn-primary, eyebrow |
| 3 | Logo wall | crops/desktop/pb-s3.png | new | `logo-wall` | gallery; `columns` | grayscale; logos cropped (replace with originals) |
| 4 | Features | crops/desktop/pb-s4.png | new | `feature-grid` | heading, repeater icon/title/text; `columns` | icons as inline SVG |
| 5 | Case study | crops/desktop/pb-s5.png | new | `media-text` | image, wysiwyg; `imagePosition` | photo masked |
| 6 | CTA | crops/desktop/pb-s6.png | new | `cta-band` | heading, text, button; `tone` | btn-primary |
| 7 | Footer | crops/desktop/pb-footer.png | new | `site-footer` | link columns, legal | shared part |

On the second page the same table shows `reuse` for header and footer (rendered by the template parts, so nothing to build), `extend`/`reuse` where blocks exist. After the table, list: assets cropped from the design (replace with originals), masks, tokens or fonts the design needs that setup did not provide, and any copy that could not be read.

## Recording the plan

Only after the developer approves. Use `plan.mjs record` (SKILL.md Step 5): it finds the page by slug and each section by `n`, writes label, decision, block and notes, gives `part` rows the anchors `pb-header` / `pb-footer`, then sets `plan` and the page status, atomically. Crops and masks stay untouched. Afterwards `node "$PB/lib/state.mjs" validate "$THEME"` must print `{"valid": true}`.

### Later pages: header and footer from the parts

Once the first page moved header and footer into the template parts (`inPart: true` there), every later page shows them from the parts. Plan them `reuse` with the same `part`; `plan.mjs` records them as `{decision: "reuse", inPart: true, anchor: "pb-header"}` (and `pb-footer`) with status `building`. `page.mjs build` leaves them out of the page content, and the section loop only verifies them, through the part's anchor:

<!-- test:run fixture=later -->
```bash
cat > "$THEME/.protoblocks/plan.json" <<'JSON'
{
  "page": "about",
  "sections": [
    {"n": 1, "label": "Header", "decision": "reuse", "block": "site-header", "part": "header"},
    {"n": 2, "label": "Team", "decision": "new", "block": "team-grid"},
    {"n": 4, "label": "Footer", "decision": "reuse", "block": "site-footer", "part": "footer"}
  ]
}
JSON
node "$PB/lib/plan.mjs" record "$THEME" "$THEME/.protoblocks/plan.json"
node "$PB/lib/state.mjs" validate "$THEME"
```

`[EPLAN]` "must be planned as reuse" means the row asked for `new`/`extend` on a part that already exists: change the part through `protoblocks-section-loop` `references/header-footer.md` ("Editing the header later"), never as a page section.
