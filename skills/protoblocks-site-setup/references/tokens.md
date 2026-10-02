# Design tokens

`tokens.mjs apply` turns one JSON file into `tailwind-theme.css` (Tailwind v4 `@theme`), the `theme.json` palette/fonts/sizes and the Google Fonts `@import` in `style.css`, then compiles Tailwind and saves the tokens to `site.tokens` in the build state.

```bash
node "$PB/lib/tokens.mjs" apply "$THEME" "$THEME/.protoblocks/tokens.json" [--no-compile]
```

Prints `{ "written": ["tailwind-theme.css","theme.json","style.css"], "compiled": {...} }`.

## Shape

```json
{
  "colors":  { "ink": "#111111", "accent": "#ff5a1f" },
  "fonts":   { "sans": { "family": "Inter", "fallback": "ui-sans-serif, system-ui, sans-serif", "google": [400, 500, 700] },
               "display": { "family": "Fraunces", "google": [600, 700] } },
  "type":    { "h1": { "size": "64px", "lineHeight": "1.05", "letterSpacing": "-0.02em", "fontWeight": "700" }, "body-md": "16px" },
  "radii":   { "card": "16px" },
  "shadows": { "soft": "0 6px 16px rgba(0,0,0,0.08)" },
  "spacing": { "section": "120px" }
}
```

| Group | Value | Notes |
|---|---|---|
| `colors` | color string | Required, at least one. Hex, `rgb()/hsl()/oklch()`, `transparent`, `currentColor`. |
| `fonts.<k>` | `{family, fallback?, google?}` | `family`: letters, digits, spaces, hyphens. `fallback`: comma list (default `ui-sans-serif, system-ui, sans-serif`). `google`: array of weights 100-900. |
| `type.<k>` | length string, or `{size, lineHeight?, letterSpacing?, fontWeight?}` | `size`/`letterSpacing`: px, rem, em, %, vw, vh, ch, `clamp()/calc()/min()/max()`. `lineHeight`: unitless or length. `fontWeight`: 100-900 in hundreds. |
| `radii.<k>`, `spacing.<k>` | length | |
| `shadows.<k>` | free text | Only letters, digits, space and `. , % # ( ) - + /`. |

Names are lowercase kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`). Values must not contain `; { } \ " ' ! < > @ url(` or comments.

## Validation errors

`[ETOKENS]` lists every problem with a dotted path, for example `colors.Accent: invalid name (use lowercase-kebab-case)`, `colors: at least one color is required`, `fonts.sans: invalid family ...`, `type.h1: invalid size "64"`. Nothing is written when any error exists. `[ECOMPILE]` means files were written but the Tailwind compile failed (the message has the reason).

## Extraction

- Figma: `get_variable_defs` first, then styles from `get_design_context`.
- Penpot: library colors and typographies via `execute_code`.
- Image only: sample dominant colors from the frames (background, text, primary CTA, accents). Estimate the type scale from measured cap heights at the design width and round to the nearest 2px.

Semantic names: colors `ink`, `paper`, `accent`, `muted`, `surface`; type keys `display`, `h1`-`h4`, `body-lg`, `body-md`, `body-sm`, `eyebrow`.

Fonts: give `google` only to fonts that exist on Google Fonts. For any other font, leave `google` out and list it in your report as "supply font files".

## Utilities produced

`--color-accent` -> `bg-accent`, `text-accent`; `--text-h1` (+ `--text-h1--line-height`, `--letter-spacing`, `--font-weight`) -> `text-h1`; `--font-display` -> `font-display`; `--radius-card` -> `rounded-card`; `--shadow-soft` -> `shadow-soft`; `--spacing-section` -> `p-section`, `py-section`, `gap-section`.

Re-applying overwrites `tailwind-theme.css`, the `theme.json` palette/fontFamilies/fontSizes (only for groups you provide) and the managed Google Fonts `@import` line. Never hand-edit those; change the tokens JSON and re-apply.
