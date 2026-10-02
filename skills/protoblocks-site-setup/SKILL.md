---
name: protoblocks-site-setup
description: Use when preparing a local WordPress site for a Proto-Blocks build - installing Proto-Blocks/Yoast, forking and activating proto-blocks-theme, applying design tokens to Tailwind and theme.json, creating block-theme navigation menus, or wiring header/footer template parts. Normally invoked by protoblocks-site-builder.
---

# Proto-Blocks Site Setup

Prepares a Local WordPress site: plugins, theme fork, tokens, navigation, header/footer parts. Work only on the site preflight resolved.

Shell variables do not persist between Bash commands. Start every command with `PB="${CLAUDE_SKILL_DIR}/../protoblocks-site-builder/scripts"; THEME="<fork dir>";` (literal paths), or use full paths.

Order: preflight (`protoblocks-site-builder` Step 1) -> `setup-site.mjs` -> tokens -> navigation -> header/footer parts. The header/footer blocks themselves are built later in the section loop; this skill only writes the parts.

Every tool prints JSON on stdout. On failure it prints `[CODE] message` on stderr and exits non-zero (64 = bad usage).

## Step 1 - One-shot setup

Ask the developer for the client/project name if you do not have it (the slug is derived from it; `--slug` overrides).

```bash
node "$PB/lib/setup-site.mjs" --name "<Project>" [--slug s] [--site "<Local site>"] [--force] [--refork <slug>] [--update-plugins] [--cwd D]
```

It runs preflight itself, then: installs/activates Proto-Blocks and wordpress-seo, safe-svg, duplicate-post; enables Tailwind; sets `/%postname%/` permalinks only when they are plain (a custom structure is left alone and reported in `plugins.warnings`); forks `proto-blocks-theme` into `wp-content/themes/<slug>` and activates it; installs the managed theme assets; creates the build state. Running it again reuses the fork (`theme.reused: true`) and leaves plugins alone.

Custom JSON-LD is provided by the theme's Yoast extension (`_proto_jsonld`); check support with `node "$PB/lib/jsonld.mjs" check "$THEME"`.

Fork and plugin rules (details: `references/errors.md`): an existing fork is always reused (offline OK); `--force` only replaces a foreign folder, `--refork <slug>` replaces a fork, and both move the old folder to `wp-content/.protoblocks/backups/` - use either only with the developer's explicit OK. Installed plugins are never replaced; report `updateAvailable` and use `--update-plugins` only with their OK.

Result: `{ preflight, plugins, theme: {themeDir, slug, reused, forkedFrom}, assets, stateFile }`. Use `THEME=<theme.themeDir>` (literal path) in every later command. Every value flag needs a value; an unknown flag or missing `--name` prints usage and exits 64.

Install motion (idempotent; adds the default profile): `node "$PB/lib/motion.mjs" install "$THEME"`. Choose the profile later, in `protoblocks-motion`.

Errors: see `references/errors.md` for every code and what to do. Ask the developer before acting on `EFORKEXISTS`, `ERFORK`, `EPLUGINDEV` and `EWRONGSITE`; relay `EPREFLIGHT` checks and change nothing.

## Step 2 - Tokens

Read `references/tokens.md`, extract tokens from the design, write them to `$THEME/.protoblocks/tokens.json`, then:

```bash
node "$PB/lib/tokens.mjs" apply "$THEME" "$THEME/.protoblocks/tokens.json" [--no-compile]
```

`[ETOKENS]` lists every validation problem: fix the JSON and re-run. `[ECOMPILE]` means Tailwind compile failed. Never hand-edit `tailwind-theme.css`; `apply` regenerates it. `apply` also sets the body font (`theme.json` and the fork's `style.css` body rule); relay any `warnings`.

## Step 3 - Navigation

Read `references/navigation.md`. One spec per menu (`primary`, `footer-1`, ...):

```bash
node "$PB/lib/navigation.mjs" upsert "$THEME" primary spec.json [--force]
node "$PB/lib/navigation.mjs" refresh "$THEME"     # after creating pages
```

Links to pages that do not exist yet are normal: they are reported in `pending` and converted by `refresh`, which patches only those links and keeps Site Editor edits. `[EEDITED]` means the menu was edited in the Site Editor since protoblocks wrote it; nothing changed. Ask the developer; only with their OK re-run `upsert` with `--force` (it saves the current menu to `$THEME/.protoblocks/artifacts/backups/` first).

## Step 4 - Header/footer parts

1. List saved Site Editor copies: `node "$PB/lib/parts.mjs" overrides "$THEME"`. An empty list `[]` means none.
2. If a `header`/`footer` copy exists, show the developer what would be discarded and ask. Only after their explicit OK run `node "$PB/lib/parts.mjs" remove-override "$THEME" header --confirm --id <n>`, where `<n>` is the id previewed by the `[ECONFIRM]` error (run it once without `--confirm` to get the preview). The copy goes to Trash; the printed recovery command restores it.
3. Write markup (see `references/navigation.md` for the `partMarkup` shape): `node "$PB/lib/parts.mjs" write "$THEME" header header.html` (writes `$THEME/parts/header.html` and records `site.parts.header` in the build state; `status.mjs` treats setup as unfinished without it).

The printed recovery command uses the same WP-CLI command preflight resolved (Local's wrapper at `wp-content/.protoblocks/wp`, or `wp --path=...`), never a bare `wp` that may target another install.

Part errors (`ECONFIRM`, `ESTALE`, `EAMBIGUOUS`, `ETHEMEMISMATCH`, `ENOTRASH`, ...): see `references/errors.md`.

## Errors shared by every step

See `references/errors.md` (`ENOTFORK`, `EWRONGSITE`, `EARGV`, `ENAVKEY`, `ENORUNTIME`).

## Iron rules

- Never pass `--force`, `--refork`, `--update-plugins` or `--confirm` without the developer's explicit OK for that exact action.
- Never edit the vendored theme `scripts/`.
- Managed files (`inc/pb-*.php`, `assets/js/pb-*.js`, the functions.php managed block) are overwritten by `theme-assets.mjs install` (also run by `setup-site.mjs`); keep custom code elsewhere.
- Never use `register_nav_menus` or classic menus.
