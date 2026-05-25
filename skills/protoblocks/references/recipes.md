# Recipes — "I want to build X"

A lookup from common module types to the right field/control/pattern choices, with the nearest bundled example to copy. Combine these freely — most real modules are a mix. See `composition.md` for the field-vs-control-vs-inner-blocks reasoning and `examples.md` for full code.

## How to read a recipe

Each entry gives: **fields** (editable content), **controls** (sidebar settings), and the **pattern/closest example**. Apply the authoring workflow (`authoring-workflow.md`) to assemble it.

---

### Hero / banner
- **Fields:** `heading` (text, h1), `subheading` (text/wysiwyg), `cta` (link); optionally `innerContent` (inner-blocks) for free body content.
- **Controls:** `backgroundImage` (image), `backgroundColor` (color), `overlayOpacity` (range), `textColor` (color-palette), `contentAlignment` (radio), `minHeight` (number).
- **Pattern:** background image + tinted overlay via `proto_blocks_hex_to_rgba()`; alignment via classes. **Examples:** `hero` (vanilla, inner-blocks), `tl-hero` (Tailwind).

### Card grid / feature grid
- **Fields:** `items` (repeater of `{ icon/image, title, body(wysiwyg), link }`).
- **Controls:** `columns` (number), `style` (select), `gap` (range).
- **Pattern:** repeater + CSS-variable columns (`--cols`); one card markup per item. **Examples:** `stats` (repeater + CSS vars), `card` (single-card styling to replicate per item).

### Accordion / FAQ
- **Fields:** `items` (repeater of `{ title(text), content(wysiwyg) }`).
- **Controls:** `allowMultiple` (toggle), `firstOpen` (toggle), `iconPosition` (select).
- **Pattern:** repeater + Interactivity API for open/close (or plain `view.js`). **Example:** `accordion` (copy wholesale).

### Stats / metrics
- **Fields:** `stats` (repeater of `{ prefix, number, suffix, label }`, all plain text).
- **Controls:** `columns` (number), `numberSize` (range), `style` (select), `showDividers` (toggle).
- **Pattern:** numeric controls → CSS custom properties. **Example:** `stats`.

### Pricing table
- **Fields:** `plans` (repeater of `{ name, price, period, features(wysiwyg or repeater of text), cta(link) }`).
- **Controls:** `columns` (number), `highlightIndex` (number), `currency` (text/select).
- **Pattern:** repeater of plans; mark the highlighted plan with a class from `highlightIndex`. Features can be a nested wysiwyg (a bullet list) — don't make each feature a field.

### Testimonial / quote
- **Fields:** `quote` (wysiwyg), `authorName` (text, cite), `authorTitle` (text), `authorImage` (image).
- **Controls:** `style` (select), `rating` (range 0–5), `showAvatar`/`showRating` (toggles).
- **Pattern:** loop-render stars from the range control. **Example:** `testimonial`.

### Tabs
- **Fields:** `tabs` (repeater of `{ label(text), content(wysiwyg or inner-blocks?) }`). Note: inner-blocks is one-per-block, so tab bodies are usually wysiwyg.
- **Controls:** `orientation` (radio), `defaultTab` (number).
- **Pattern:** repeater + Interactivity API to switch active tab (mirror `accordion`'s store).

### Call to action (CTA) / banner
- **Fields:** `title` (text), `description` (text/wysiwyg), `link` (link).
- **Controls:** `layout` (select), `buttonStyle` (radio), `backgroundColor`/`textColor` (color-palette), `showIcon` (checkbox), `fullWidth` (checkbox, conditional on layout).
- **Pattern:** conditional control visibility; inline SVG icon. **Example:** `cta`.

### Navigation / header
- **Fields:** `logo` (image), `siteTitle` (text), `navItems` (repeater of `{ label(text), url(text) }`), `ctaButton` (link).
- **Controls:** `showCta` (toggle), `fixedPosition` (toggle).
- **Pattern:** Tailwind responsive layout + small `view.js`/inline script for the mobile toggle. **Example:** `tl-header`.

### Footer
- **Fields:** `logo`, `description`, per-column `title` + `links` (repeater), contact fields, `copyrightText`, `copyrightLink`.
- **Controls:** `showLogo`, `showColumn1`, `showColumn2` (toggles to gate sections).
- **Pattern:** multiple repeaters + toggle-gated sections. **Example:** `tl-footer`.

### Logo wall / partner grid
- **Fields:** `logos` (repeater of `{ image, link? }`).
- **Controls:** `columns` (number), `grayscale` (toggle).
- **Pattern:** image-only repeater; toggle adds a filter class.

### Rich content section / freeform
- **Fields:** one `body` (**inner-blocks**) — let authors compose paragraphs, images, columns, embeds.
- **Controls:** `width` (select), `align` (radio), `background` (color-palette).
- **Pattern:** the composable-surface pattern; restore typography inside the slot with low-specificity `:where()` rules. **Example:** `hero`'s inner-blocks slot. See `composition.md`.

### Media + text (split)
- **Fields:** `image` (image), `heading` (text), `body` (wysiwyg), `link` (link).
- **Controls:** `mediaPosition` (select left/right), `mediaWidth` (range), `verticalAlign` (select).
- **Pattern:** discrete fields (distinct slots) + layout controls flipping a flex direction class. **Example:** `card` (horizontal layout).

---

## Choosing controls quickly

| You want the author to… | Use |
|---|---|
| pick one of a few options | `select` (dropdown) or `radio` (visible buttons) |
| turn something on/off | `toggle` (or `checkbox`) |
| set a count / size | `number` (input) or `range` (slider with min/max) |
| pick a brand color | `color-palette` (curated theme swatches) |
| pick any color | `color` (full picker) |
| choose an image as a *setting* (e.g. background) | `image` control |
| type a short/long string | `text` / `textarea` |

When a control should only appear for certain other values, add `conditions.visible` (see `controls.md`).
