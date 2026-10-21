---
name: protoblocks-site-setup
description: Use when preparing a local WordPress site for a Proto-Blocks build - installing Proto-Blocks/Yoast, forking and activating proto-blocks-theme, applying design tokens to Tailwind and theme.json, creating block-theme navigation menus, or wiring header/footer template parts. Normally invoked by protoblocks-site-builder.
---

# Proto-Blocks Site Setup

Prepares a Local WordPress site: plugins, theme fork, screenshot, tokens, navigation, header/footer parts. Work only on the site preflight resolved.

Shell variables do not persist between Bash commands. Start every command with `PB="${CLAUDE_SKILL_DIR}/../protoblocks-site-builder/scripts"; THEME="<fork dir>";` (literal paths), or use full paths.

Order: preflight (`protoblocks-site-builder` Step 1) -> `setup-site.mjs` -> first-page intake -> screenshot -> tokens -> navigation -> header/footer parts. The header/footer blocks themselves are built later in the section loop; this skill only writes the parts.

Tools print JSON on stdout; a failure prints `[CODE] message` on stderr and exits non-zero (64 = bad usage).

## Step 1 - One-shot setup

Ask the developer for the client/project name if you do not have it (the slug derives from it; `--slug` overrides), for the theme's display name when it differs ("O-Flex" vs "O-Flex Group": `--theme-name`), and for the client logo (SVG/PNG; usually the design's primary logo asset, Figma: `download_assets`): `--logo`.

```bash
node "$PB/lib/setup-site.mjs" --name "<Project>" [--slug s] [--theme-name "<display name>"] [--category-title "<title>"] [--logo <file>] [--readme] [--site "<Local site>"] [--force] [--refork <slug>] [--update-plugins] [--cwd D]
```

It runs preflight itself, then: installs/activates Proto-Blocks and wordpress-seo, safe-svg, duplicate-post; enables Tailwind; sets `/%postname%/` permalinks only when they are plain (a custom structure is kept, see `plugins.warnings`); forks `proto-blocks-theme` into `wp-content/themes/<slug>` and activates it (`Theme Name: <display name>`; `functions.php` registers the site's block category: slug `<slug>`, title "<display name> blocks" or `--category-title`); installs the managed theme assets; copies the logo to `assets/img/logo.<ext>` and writes a short client README (logo, name, one line); creates the build state. Every `block.json` must use that slug as `"category"` (the gates check it). A re-run reuses the fork (`theme.reused: true`), leaves plugins and the README alone (`--readme` rewrites it; `[EEDITED]` if edited); `--theme-name` / `--category-title` then rename it (`theme.renamed: true`).

Fork and plugin rules (`references/errors.md`): an existing fork is always reused (offline OK); `--force` only replaces a foreign folder, `--refork <slug>` replaces a fork, and both move the old folder to `wp-content/.protoblocks/backups/` - use either only with the developer's explicit OK. Installed plugins are never replaced; report `updateAvailable` and use `--update-plugins` only with their OK.

Result: `{ preflight, plugins, theme: {themeDir, slug, reused, forkedFrom, displayName, category}, assets, stateFile }`. Use `THEME=<theme.themeDir>` (literal path) in later commands.

Install motion (idempotent): `node "$PB/lib/motion.mjs" install "$THEME"`; the profile is chosen later in `protoblocks-motion`.

Errors: `references/errors.md`. Ask the developer before acting on `EFORKEXISTS`, `ERFORK`, `EPLUGINDEV` and `EWRONGSITE`; relay `EPREFLIGHT` checks and change nothing.

## Step 2 - Theme screenshot

After the first page's desktop frame is intaken (design-breakdown Step 1), before tokens:

```bash
node "$PB/lib/theme-screenshot.mjs" "$THEME" <page>
```

Writes the top of that frame (full width, 4:3) to `$THEME/screenshot.png` at 1200x900 and records `site.theme.screenshot` (setup is unfinished without it). `[EQADEPS]`: QA dependencies missing: show preflight's `qa-deps` fix, ask once, install.

## Step 3 - Tokens

Read `references/tokens.md`, extract tokens from the design, write them to `$THEME/.protoblocks/tokens.json`, then:

```bash
node "$PB/lib/tokens.mjs" apply "$THEME" "$THEME/.protoblocks/tokens.json" [--no-compile]
```

`[ETOKENS]` lists every validation problem: fix the JSON and re-run. `[ECOMPILE]`: Tailwind compile failed. Never hand-edit `tailwind-theme.css`; `apply` regenerates it. `apply` also sets the body font (`theme.json` and the fork's `style.css` body rule); relay any `warnings`.

## Step 4 - Navigation

Read `references/navigation.md`. One spec per menu (`primary`, `footer-1`, ...):

```bash
node "$PB/lib/navigation.mjs" upsert "$THEME" primary spec.json [--force]
node "$PB/lib/navigation.mjs" refresh "$THEME"     # after creating pages
```

No navigation in the design (no menu in its header or footer): create no menu; record that instead, so setup can finish:

<!-- test:run -->
```bash
node "$PB/lib/state.mjs" set "$THEME" site.navigation '{"menus":{},"none":true}'
```

Links to pages that do not exist yet are reported in `pending` and converted by `refresh` (it patches only those links and keeps Site Editor edits). `[EEDITED]`: the menu was edited in the Site Editor since protoblocks wrote it; nothing changed. Ask the developer; only with their OK re-run `upsert` with `--force` (it backs the menu up under `$THEME/.protoblocks/artifacts/backups/` first).

## Step 5 - Header/footer parts

1. List saved Site Editor copies: `node "$PB/lib/parts.mjs" overrides "$THEME"`. An empty list `[]` means none.
2. If a `header`/`footer` copy exists, run `node "$PB/lib/parts.mjs" remove-override "$THEME" header` once without `--confirm`: its `[ECONFIRM]` preview shows what would be discarded. Show it and ask; an approval counts only if the developer gives it AFTER you have shown them the preview ("remove it" said earlier is not the OK). Then re-run with `--confirm --id <n>`. The copy goes to Trash; the printed recovery command restores it.
3. Write markup (see `references/navigation.md` for the `partMarkup` shape; no navigation in the design: the header part holds the design's header block alone, `node "$PB/lib/parts.mjs" markup site-header` without `--nav-ref`): `node "$PB/lib/parts.mjs" write "$THEME" header header.html` (writes `$THEME/parts/header.html` and records `site.parts.header` in the build state; `status.mjs` treats setup as unfinished without it).

Part errors (`ECONFIRM`, `ESTALE`, `EAMBIGUOUS`, `ETHEMEMISMATCH`, `ENOTRASH`, ...): `references/errors.md`.

## Errors shared by every step

See `references/errors.md` (`ENOTFORK`, `EWRONGSITE`, `EARGV`, `ENAVKEY`, `ENORUNTIME`).

## Iron rules

- Never pass `--force`, `--refork`, `--update-plugins` or `--confirm` without the developer's explicit OK for that exact action, given AFTER you have shown them its refusal or preview (earlier instructions are not the OK). Show it, ask, wait.
- Never edit the vendored theme `scripts/`.
- Managed files (`inc/pb-*.php`, `assets/js/pb-*.js`, `assets/css/pb-*.css`, the functions.php managed block) are overwritten by `theme-assets.mjs install` (also run by `setup-site.mjs`); keep custom code elsewhere.
- Never use `register_nav_menus` or classic menus.
