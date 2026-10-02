---
name: protoblocks-site-builder
description: Use when turning a design (image, screenshot, Figma, Penpot, or URL) into a WordPress site or landing page built from Proto-Blocks on a local site (Local by Flywheel) — runs preflight, keeps a resumable build state, and drives site setup, section breakdown, build/visual-QA/animation loops, and Yoast SEO.
---

# Proto-Blocks Site Builder

## Overview

Turns a design into a WordPress page made of Proto-Blocks, section by section, with visual QA against the design and a resumable state file. It works on **local sites only** (Local by Flywheel, or a native local WordPress install), on a fork of the base theme `proto-blocks-theme`, and requires Proto-Blocks >= 2.10.1. The pipeline (site setup, design breakdown, build, QA, animation, SEO) is extended by later stages; this file defines the shared foundations every phase relies on.

## Script location

All tools live in `scripts/` next to this file:

```bash
PB="${CLAUDE_SKILL_DIR}/scripts"
```

Claude Code substitutes `${CLAUDE_SKILL_DIR}` in skill bodies; in other agents use this skill's base directory. Call tools as `node "$PB/lib/<tool>.mjs" ...`. Other protoblocks-* skills reach them at `${CLAUDE_SKILL_DIR}/../protoblocks-site-builder/scripts/`; plugin commands and agents use `${CLAUDE_PLUGIN_ROOT}/skills/protoblocks-site-builder/scripts/`.

## Step 1 - Preflight (always first)

```bash
node "$PB/lib/preflight.mjs" [--site "<Local site name>"]
```

Prints a JSON report and exits 2 when any check fails. Run it from inside the site folder, or pass `--site` (an explicit `--site` never falls back to native mode). Use `--path <wp-root>` for a non-Local install.

- A check with `status: "fail"`: stop and relay its `fix` text verbatim.
- `warn`: note it and continue; site setup fixes plugin/permalink/theme warnings. Playwright is only needed from visual QA onward.
- `site` fail that lists available sites: ask the developer which one, then re-run with `--site`.
- Afterwards use `report.wp` as the WP-CLI command for every WordPress call, for example `"$WP" option get siteurl`. Never use bare `wp` in `local-wrapper` mode.

The report is also saved to `<wp-content>/.protoblocks/preflight.json`. See `references/local-sites.md`.

## Step 2 - Build state

State lives in the theme fork at `wp-content/themes/<fork>/.protoblocks/build.json` (set `THEME` to that directory). Create it once, after the theme fork exists, from a JSON file holding the `site` object (`url`, `path` required):

```bash
node "$PB/lib/state.mjs" init "$THEME" site.json
```

Every phase reads state first and writes its outcome immediately, so any session can resume. Never edit `build.json` by hand.

```bash
node "$PB/lib/state.mjs" get "$THEME" [dotted.path]        # missing path prints null
node "$PB/lib/state.mjs" set "$THEME" pages.0.sections.2.status '"done"'
node "$PB/lib/state.mjs" append "$THEME" pages.0.sections.2.qa '{"iteration":1,"breakpoint":"desktop","mismatch":0.12,"heightDelta":0.02,"pass":false}'
node "$PB/lib/state.mjs" validate "$THEME"
node "$PB/lib/state.mjs" restore "$THEME"                  # roll back to build.json.bak
```

Values are JSON (quote strings: `'"done"'`). Writes are validated and locked. Recovery: `[EPARSE]`, or `[EINVALID]` from `get`/`validate` (the file on disk is bad), means run `restore`. `[EINVALID]` or `[EVALUE]` from `set`/`append` means the value was rejected and state is unchanged: fix the value and retry; never `restore` (it would roll back the previous good write). Never re-`init` over existing state. Full schema: `references/state-schema.md`.

## Site setup

**Site setup** - after preflight, run the `protoblocks-site-setup` skill (one-shot `setup-site.mjs`, then tokens, navigation, header/footer parts). It creates the theme fork and initializes the build state.

## Iron rules

- Never claim a section passes without a recorded QA verdict in state.
- Never overwrite a theme fork, a page edited in wp-admin, or a template-part DB override without explicit confirmation.
- Never run write commands against a site other than the one preflight resolved.

## References

- `references/state-schema.md` - state file shape, enums, defaults, CLI exit behavior.
- `references/local-sites.md` - how Local stores sites, the WP-CLI wrapper, troubleshooting.
