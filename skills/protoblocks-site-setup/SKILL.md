---
name: protoblocks-site-setup
description: Use when preparing a local WordPress site for a Proto-Blocks build - installing Proto-Blocks/Yoast, forking and activating proto-blocks-theme, applying design tokens to Tailwind and theme.json, creating block-theme navigation menus, or wiring header/footer template parts. Normally invoked by protoblocks-site-builder.
---

# Proto-Blocks Site Setup

Prepares a Local WordPress site: plugins, theme fork, tokens, navigation, header/footer parts. Work only on the site preflight resolved.

```bash
PB="${CLAUDE_SKILL_DIR}/../protoblocks-site-builder/scripts"
```

Order: preflight (`protoblocks-site-builder` Step 1) -> `setup-site.mjs` -> tokens -> navigation -> header/footer parts. The header/footer blocks themselves are built later in the section loop; this skill only writes the parts.

Every tool prints JSON on stdout. On failure it prints `[CODE] message` on stderr and exits non-zero (64 = bad usage).

## Step 1 - One-shot setup

Ask the developer for the client/project name if you do not have it (the slug is derived from it; `--slug` overrides).

```bash
node "$PB/lib/setup-site.mjs" --name "<Project>" [--slug s] [--site "<Local site>"] [--force] [--update-plugins] [--cwd D]
```

It runs preflight itself, then: installs/activates Proto-Blocks and wordpress-seo, safe-svg, duplicate-post; enables Tailwind; sets `/%postname%/` permalinks only when they are plain (a custom structure is left alone and reported in `plugins.warnings`); forks `proto-blocks-theme` into `wp-content/themes/<slug>` and activates it; installs the managed theme assets; creates the build state. Running it again reuses the fork (`theme.reused: true`) and leaves plugins alone.

Plugins already installed are never replaced. When a newer Proto-Blocks release exists the result says `"updateAvailable": "<version>"` on the `proto-blocks` entry; tell the developer. Only with their explicit OK re-run with `--update-plugins`, which reinstalls Proto-Blocks from the release zip. It refuses with `EPLUGINDEV` when the plugin folder is a symlink or a git checkout (WordPress would delete the checkout, `.git` included); the developer updates that copy themselves (e.g. `git pull`).

Result: `{ preflight, plugins, theme: {themeDir, slug, reused, forkedFrom}, assets, stateFile }`. Set `THEME=<theme.themeDir>` for every later command. Every value flag needs a value; an unknown flag or missing `--name` prints usage and exits 64.

Errors:
- `EPREFLIGHT` - lists the failing checks with fixes; relay them, change nothing.
- `EFORKEXISTS` - a folder with that slug exists and is not a protoblocks fork. Ask the developer; only on their explicit OK re-run with `--force` (it deletes that folder).
- `ESLUG` - bad or underivable slug; pick another with `--slug`.
- `ENOTHEME` - the downloaded zip had no theme.
- `ERELEASE` - release lookup failed and Proto-Blocks is not installed.
- `EWP` - a WP-CLI call failed; the message has its output.
- `EMANAGEDBLOCK` - the managed block in the theme's functions.php is broken; ask the developer to fix it by hand.

## Step 2 - Tokens

Read `references/tokens.md`, extract tokens from the design, write them to `$THEME/.protoblocks/tokens.json`, then:

```bash
node "$PB/lib/tokens.mjs" apply "$THEME" "$THEME/.protoblocks/tokens.json" [--no-compile]
```

`[ETOKENS]` lists every validation problem: fix the JSON and re-run. `[ECOMPILE]` means Tailwind compile failed. Never hand-edit `tailwind-theme.css`; `apply` regenerates it.

## Step 3 - Navigation

Read `references/navigation.md`. One spec per menu (`primary`, `footer-1`, ...):

```bash
node "$PB/lib/navigation.mjs" upsert "$THEME" primary spec.json
node "$PB/lib/navigation.mjs" refresh "$THEME"     # after creating pages
```

Links to pages that do not exist yet are normal: they are reported in `pending` and converted by `refresh`.

## Step 4 - Header/footer parts

1. List saved Site Editor copies: `node "$PB/lib/parts.mjs" overrides "$THEME"`. An empty list `[]` means none.
2. If a `header`/`footer` copy exists, show the developer what would be discarded and ask. Only after their explicit OK run `node "$PB/lib/parts.mjs" remove-override "$THEME" header --confirm --id <n>`, where `<n>` is the id previewed by the `[ECONFIRM]` error (run it once without `--confirm` to get the preview). The copy goes to Trash; the printed recovery command restores it.
3. Write markup (see `references/navigation.md` for the `partMarkup` shape): `node "$PB/lib/parts.mjs" write "$THEME" header header.html` (writes `$THEME/parts/header.html`).

Part errors: `ECONFIRM` (needs developer OK + id), `ESTALE` (the id changed; re-preview), `EAMBIGUOUS` (several copies; resolve in wp-admin), `ETHEMEMISMATCH` (the theme is not the active one, or the saved part does not resolve to this theme), `ESLUG`/`ETHEME` (invalid argument), `ENOTRASH` (Trash is disabled, so removal would delete permanently: tell the developer to use "Clear customizations" on the part in the Site Editor).

## Iron rules

- Never pass `--force` or `--confirm` without the developer's explicit OK for that exact action.
- Never edit the vendored theme `scripts/`.
- Managed files (`inc/pb-*.php`, `assets/js/pb-*.js`, the functions.php managed block) are overwritten by `theme-assets.mjs install` (also run by `setup-site.mjs`); keep custom code elsewhere.
- Never use `register_nav_menus` or classic menus.
