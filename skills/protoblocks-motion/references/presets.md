# pb-motion presets

Source of truth: the theme's `assets/js/pb-motion.js`. `tests/unit/motion-docs.test.mjs` fails if a preset or option named here does not exist there.

Reveal presets (frontend markup `data-pb-motion="<name>" data-proto-animate="manual"`; hidden until revealed; the runtime sets `done`):

| Preset | What it does | Use for | Avoid for |
|---|---|---|---|
| `fade-up` | opacity 0 to 1 while rising `distance` px | headings, CTA groups, cards, any block of content | long body text; elements with a CSS transform |
| `fade-in` | opacity 0 to 1, no movement | logo walls, small media, anything that must not shift | none |
| `scale-in` | opacity and scale 0.94 to 1 | panels, CTA bands, cards | elements with a CSS transform |
| `clip-reveal` | top-down clip wipe (no fade) | images, media panels, dividers | text blocks |
| `stagger-children` | each direct child fades up in sequence | grids, card rows, lists, stat rows | a parent with one child; children with CSS transforms |
| `split-lines` | SplitText line mask: lines slide up | the section heading (hero level) | paragraphs over ~3 lines; elements holding forms or media |
| `split-chars` | SplitText characters fade up | one short word or phrase of display text | anything longer than a few words |
| `counter` | counts up from 0 to the authored number | stat values | text with no number (falls back to a fade) |

Continuous presets (markup `data-pb-motion="<name>"` only; never `data-proto-animate`; never hidden):

| Preset | What it does | Use for | Avoid for |
|---|---|---|---|
| `parallax` | the element drifts up `10% x speed` of its height across the viewport | background media inside an `overflow: hidden` wrapper | text, or media without an overflow-hidden wrapper |
| `marquee` | infinite horizontal loop of the first child (the track) | a scrolling logo or phrase row the design shows | static rows |

Options (all optional, numbers except `start`):

| Attribute | Meaning | Applies to |
|---|---|---|
| `data-pb-delay` | seconds before the tween starts | reveal presets and `counter` |
| `data-pb-stagger` | seconds between items; default from the profile | `stagger-children`, `split-lines`; `split-chars` uses a quarter of it |
| `data-pb-start` | ScrollTrigger start string; default `top 85%` | reveal presets |
| `data-pb-distance` | px travelled; default from the profile | `fade-up`, `stagger-children`; half of it for `split-chars` |
| `data-pb-speed` | factor, default 1 | `parallax` (drift), `marquee` (loop takes 20 s / speed) |

Keep `data-pb-delay` plus `data-pb-start` modest: the plugin watchdog forces `done` 1.5 s after a `manual` element scrolls into view, snapping an unfinished tween to its end.

## Choosing per pattern

- Hero: `split-lines` on the heading, `fade-up` on the CTA group with `data-pb-delay="0.15"`.
- Feature grid: `stagger-children` on the grid element.
- Logo wall: `fade-in`, or `marquee` if the design shows a scrolling row.
- Stats: `counter` on each value element, `stagger-children` on the row.
- Testimonial: `fade-up`.
- Media plus text: `clip-reveal` on the image, `fade-up` on the copy.
- CTA band: `scale-in` on the panel.
- Background media: `parallax` with `data-pb-speed="0.5"`.

## Presets clear transforms

`fade-up`, `scale-in` and `stagger-children` end with `clearProps: 'transform'`. A Tailwind or CSS transform on the same element (or on a child of `stagger-children`) is wiped at the end and the section settles differently from the reduced frame (`settledMismatch`). Put the preset on a wrapper instead. The same applies to `clip-reveal` and an author `clip-path`.

## Counters

The element must contain only the number text (no child elements): it is replaced while counting. The authored text is restored at the end and `aria-label` carries it meanwhile.

- Supported: `1,250+`, `$4.9M`, `98%`, `4.5`. Prefix, suffix, thousands commas and decimal places are preserved at every frame.
- Not supported: ranges such as `10-20` (only the first number counts, the rest stays as typed); `1.250,5` style European separators (the comma is read as a thousands separator). Avoid both: use `fade-up` instead.

## Marquee markup

```html
<div data-pb-motion="marquee" style="overflow:hidden">
  <div class="flex w-max gap-12"><span>Acme</span><span>Globex</span><span>Initech</span></div>
</div>
```

The first child is the track. Its content is duplicated at runtime (copies are `aria-hidden` and `inert`), the track slides by half its width. The track must be as wide as its content (`w-max` or `width: max-content`, no wrapping) and the outer element must clip (`overflow: hidden`). Render the content once; never duplicate it in the template. Under reduced motion it stays static and unduplicated.

## Parallax

The element moves, so give it an `overflow: hidden` wrapper and make it taller than the wrapper (for example `h-[120%]`) or edges will show. It does not use `data-proto-animate`.
