---
name: protoblocks-site-builder
description: Use when turning a design (image, screenshot, PDF, Figma, Penpot, or URL) into a WordPress site or landing pages built from Proto-Blocks on a local site (Local by Flywheel), or when resuming such a build - runs preflight, keeps a resumable build state, and drives site setup, section breakdown, the build/visual-QA/animation loop per section, full-page QA, Yoast SEO, and the next-page loop.
---

# Proto-Blocks Site Builder

## Overview

Builds WordPress landing pages from a design, one Proto-Blocks section at a time, each checked against the design. It works on **local sites only** (Local by Flywheel, or a native local install). It forks the base theme `proto-blocks-theme` and uses the Proto-Blocks plugin (>= 2.10.1). Everything is resumable from the build state `build.json`: this skill says WHEN each step runs, the phase skills say HOW.

Commands: `/protoblocks-skill:setup-site`, `/protoblocks-skill:build-page`, `/protoblocks-skill:seo`, `/protoblocks-skill:resume`.

## Scripts

Shell variables do not persist between Bash commands. Start every command with `PB="${CLAUDE_SKILL_DIR}/scripts"; THEME="<fork dir>";` (literal paths), or use full paths.

(Other agents: this skill's base directory + `/scripts`; plugin commands: `${CLAUDE_PLUGIN_ROOT}/skills/protoblocks-site-builder/scripts`.)

- `WP` = `report.wp` from preflight. Never bare `wp` in `local-wrapper` mode.
- `THEME` = the fork folder `<publicPath>/wp-content/themes/<slug>` (found by `status.mjs --root`, or the `theme.themeDir` setup printed). State: `$THEME/.protoblocks/build.json`.
- Failures print `[CODE] message` on stderr; 64 = bad usage. Look pages up by `slug` and sections by `n`, never by position. Never edit `build.json` by hand.

## The loop (always)

1. `node "$PB/lib/preflight.mjs" [--site "<Local site name>"]`. Exit 2 = a check failed. A `site` failure that lists available sites: ask the developer which one and re-run with `--site`. Any other failure: relay its `fix` text verbatim and stop. `warn`: note it and go on, except `qa-deps` (visual QA's packages or Chromium are missing): show its `fix` command, ask once to run it, and run it with the OK before `breakdown` (QA cannot run without it).
2. Find the theme: `node "$PB/lib/status.mjs" --root "<report.publicPath>"`. `themeDir` set: that is `THEME`. `themeDir: null`: `setup`. A `themes` list (several forks have a build state): ask the developer which one.
3. `node "$PB/lib/status.mjs" "$THEME"`, then do exactly `next.action` (table below) for `next.page` / `next.section`.
4. After every step, re-run `status.mjs`. Never keep the plan in your head: the state is the plan.

## Actions

| `next.action` | Do | Load |
|---|---|---|
| `setup` | Ask the project name; get the first design (files or links). Run setup (fork + state), install motion, intake the frames (design-breakdown Step 1), then tokens from the frames, navigation, header/footer parts. On resume `why` names the missing steps. Header and footer are planned as sections of the first page. | `protoblocks-site-setup`, `protoblocks-design-breakdown` (Step 1) |
| `breakdown` | Segment, model, match, present the plan. It ends at the plan gate: STOP until the developer approves; `plan.mjs record` then sets the page `building`. | `protoblocks-design-breakdown` |
| `build-page` | Approved plan, page still `planning`: set it `building` (recipe below). | - |
| `section-build` | Build section `next.section` (also `planned`, and a reopened section of an `seo`/`done` page). First check the cap on resume. | `protoblocks-section-loop` |
| `section-verify` | Verify it (re-run from `prepare`). | `protoblocks-section-loop` |
| `section-animate` | Animate it; `motion.mjs record` closes it `done`. | `protoblocks-motion` |
| `move-parts` | First page: header/footer (`next.sections`) passed as sections; move them into the template parts, then `node "$PB/lib/parts.mjs" adopt "$THEME" <page>`. | `protoblocks-section-loop` (`references/header-footer.md`) |
| `page-qa` | `node "$PB/qa/page-qa.mjs" run "$THEME" <page>`, fix failures, `node "$PB/qa/page-qa.mjs" record "$THEME" <page> <file>` (a pass sets the page `seo`). Design differences the developer accepts: `record ... --accepted "<note>"`. | `references/pipeline.md` |
| `seo` | Yoast SEO, audit, `seo.mjs record-audit` (a pass sets the page `done`). | `protoblocks-seo` |
| `ask-more-pages` | `why: "no pages yet"`: setup stopped before intake; intake the first design. Otherwise, for each finished page not in the menu and not declined, ask "Add <page> to the primary menu?" (yes: add `{label, page}` to the spec, `navigation.mjs upsert`; no: record the decline). Then "Any other landing pages to build?" (yes: new design, intake, then `breakdown` comes next; no: final report). | `references/pipeline.md` |

`build-page` recipe (by slug; refuses without an approved plan):

<!-- test:run fixture=approved -->
```bash
PAGE=home
PI=$(node "$PB/lib/state.mjs" get "$THEME" pages | node -e 'const a=JSON.parse(require("fs").readFileSync(0,"utf8"));const i=a.findIndex((p)=>p.slug===process.argv[1]);if(i<0||!a[i].plan?.approvedAt){console.error("no approved plan for "+process.argv[1]);process.exit(1)}console.log(i)' "$PAGE")
node "$PB/lib/state.mjs" set "$THEME" "pages.$PI.status" '"building"'
```

Exact command sequences, the fields each step writes, every status transition and recovery: `references/pipeline.md`.

## Questions you must ask

- Project name (first run); which Local site when preflight lists several; which theme when `status.mjs --root` lists several.
- The design's CSS width when intake fails `[ESCALE]`.
- Plan approval at the plan gate (`page.mjs build` refuses with `[ENOPLAN]` without it).
- Iteration cap (`capReached: true` from `qa-input.mjs record`, also on resume): accept with notes, guidance, or skip.
- Motion cap (`capReached: true` from `motion.mjs record`): simplify, accept (`--accepted`), or remove.
- `[EEDITED]` on a page, a menu or SEO values: someone edited them in wp-admin or the Site Editor.
- An approval counts only if the developer gives it AFTER you have shown them the refusal or preview for that exact action. Instructions given before that ("just overwrite it", "remove it") are not the OK: show the preview, ask, and wait. This covers every guarded flag below.
- Destructive flags, each only with an explicit OK for that exact action: `--force` (page build, navigation upsert, SEO apply, setup), `--refork`, `--update-plugins`, `--confirm` (removing a part override), `--force-organization`.
- Page-QA design differences you cannot fix: accept them (`page-qa.mjs record --accepted`) or keep fixing.
- Menu inclusion for each finished page; more pages.

Plus any question a phase skill tells you to ask (SEO inputs, motion profile, intake gaps, `EWRONGSITE` rename, noindex). Everything else: decide, write the decision into `section.notes` / `page.notes`, and continue.

## Final report

When the developer wants no more pages, read `node "$PB/lib/state.mjs" get "$THEME" pages` (notes live there; `status.mjs` adds iteration counts):

1. Pages built: slug, title, `url`.
2. Per page, a section table: `n`, label, block, status, iterations, and every `notes` entry (accepted by developer: cap, motion, page QA; skipped).
3. SEO: point to each page's SEO table (`protoblocks-seo` Step 8), plus `organization` (`kept`: what Yoast holds) and `jsonld` outcomes.
4. Assets cropped from the design, to replace with originals.
5. Open warnings: a11y `minor`/`moderate` from page QA, SEO `warn` checks, pending menu links.
6. Theme fork history: `git -C "$THEME" log --oneline`.

## Iron rules

- Never claim a section or page passes without a recorded check in state (QA verdict, motion check, page QA, SEO audit).
- Never skip a phase because it "looks fine"; never mark anything `done` without its recorded check.
- Never overwrite a theme fork, a page, menu or SEO value edited in wp-admin, or a template-part DB override without explicit confirmation.
- Never run write commands against a site other than the one preflight resolved.
- Never build before the plan is approved; never approve it, or accept differences, for the developer.
- Never lower QA thresholds (`site.qa`); only the developer may.
- Never run a guarded action on the strength of an instruction given before you showed its refusal or preview: approval must come AFTER you have shown it (see Questions).

## References

- `references/pipeline.md` - per-action commands and outputs, status transitions, recovery.
- `references/state-schema.md` - state shape, enums, defaults, `state.mjs` CLI and its error codes.
- `references/local-sites.md` - how Local stores sites, the WP-CLI wrapper, troubleshooting.
