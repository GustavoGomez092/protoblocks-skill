---
name: protoblocks-site-builder
description: Use when turning a design (image, screenshot, PDF, Figma, Penpot, or URL) into a WordPress site or landing pages built from Proto-Blocks on a local site (Local by Flywheel), or when resuming such a build - runs preflight, keeps a resumable build state, and drives site setup, section breakdown, the build/visual-QA/animation loop per section, full-page QA, Yoast SEO, and the next-page loop.
---

# Proto-Blocks Site Builder

## Overview

Builds WordPress landing pages from a design, one Proto-Blocks section at a time, each checked against the design. It works on **local sites only** (Local by Flywheel, or a native local install). It forks the base theme `proto-blocks-theme` and uses the Proto-Blocks plugin (>= 2.10.1). Everything is resumable from the build state `build.json`: this skill says WHEN each step runs, the phase skills say HOW.

Commands: `/protoblocks:setup-site`, `/protoblocks:build-page`, `/protoblocks:seo`, `/protoblocks:resume`.

## Scripts

```bash
PB="${CLAUDE_SKILL_DIR}/scripts"
```

(Other agents: this skill's base directory + `/scripts`; plugin commands: `${CLAUDE_PLUGIN_ROOT}/skills/protoblocks-site-builder/scripts`.)

- `WP` = `report.wp` from preflight. Never bare `wp` in `local-wrapper` mode.
- `THEME` = `<publicPath>/wp-content/themes/<site.theme.slug>` (the `theme.themeDir` setup printed). State: `$THEME/.protoblocks/build.json`.
- Failures print `[CODE] message` on stderr; 64 = bad usage. Look pages up by `slug` and sections by `n`, never by position. Never edit `build.json` by hand.

## The loop (always)

1. `node "$PB/lib/preflight.mjs" [--site "<Local site name>"]` (exit 2 = a check failed: relay its `fix` text verbatim and stop; `warn` = note it and go on).
2. `node "$PB/lib/status.mjs" "$THEME"`. No `THEME` yet (before setup) means `setup`.
3. Do exactly `next.action` (table below) for `next.page` / `next.section`.
4. After every step, re-run `status.mjs`. Never keep the plan in your head: the state is the plan.

## Actions

| `next.action` | Do | Load |
|---|---|---|
| `setup` | Ask the project name; get the first design (files or links). Run setup (fork + state), install motion, intake the frames (design-breakdown Step 1), then tokens from the frames, navigation, header/footer parts. Header and footer are planned as sections of the first page. | `protoblocks-site-setup`, `protoblocks-design-breakdown` (Step 1) |
| `breakdown` | Segment, model, match, present the plan. It ends at the plan gate: STOP until the developer approves; `plan.mjs record` then sets the page `building`. | `protoblocks-design-breakdown` |
| `build-page` | Approved plan, page still `planning`: set it `building` (recipe below). | - |
| `section-build` | Build section `next.section` (also covers `planned`). First check the cap on resume. | `protoblocks-section-loop` |
| `section-verify` | Verify it (re-run from `prepare`). | `protoblocks-section-loop` |
| `section-animate` | Animate it; `motion.mjs record` closes it `done`. | `protoblocks-motion` |
| `page-qa` | First page: move header/footer into the parts if not done yet. Then `node "$PB/qa/page-qa.mjs" run "$THEME" <page>`, fix failures, `node "$PB/qa/page-qa.mjs" record "$THEME" <page> <file>` (a pass sets the page `seo`). | `references/pipeline.md` |
| `seo` | Yoast SEO, audit, `seo.mjs record-audit` (a pass sets the page `done`). | `protoblocks-seo` |
| `ask-more-pages` | `why: "no pages yet"`: setup stopped before intake; intake the first design. Otherwise, for each newly finished page ask "Add <page> to the primary menu?" (yes: add `{label, page}` to the spec, `navigation.mjs upsert`). Then "Any other landing pages to build?" (yes: new design, intake, then `breakdown` comes next; no: final report). | `references/pipeline.md` |

`build-page` recipe (by slug; refuses without an approved plan):

<!-- test:run fixture=approved -->
```bash
PAGE=home
PI=$(node "$PB/lib/state.mjs" get "$THEME" pages | node -e 'const a=JSON.parse(require("fs").readFileSync(0,"utf8"));const i=a.findIndex((p)=>p.slug===process.argv[1]);if(i<0||!a[i].plan?.approvedAt){console.error("no approved plan for "+process.argv[1]);process.exit(1)}console.log(i)' "$PAGE")
node "$PB/lib/state.mjs" set "$THEME" "pages.$PI.status" '"building"'
```

Exact command sequences, the fields each step writes, every status transition and recovery: `references/pipeline.md`.

## Questions you must ask (and only these)

- Project name (first run); which Local site when preflight lists several.
- The design's CSS width when intake fails `[ESCALE]`.
- Plan approval at the plan gate (`page.mjs build` refuses with `[ENOPLAN]` without it).
- Iteration cap (`capReached: true` from `qa-input.mjs record`, also on resume): accept with notes, guidance, or skip.
- Motion cap (`capReached: true` from `motion.mjs record`): simplify, accept (`--accepted`), or remove.
- `[EEDITED]` on a page, a menu or SEO values: someone edited them in wp-admin or the Site Editor.
- Destructive flags, each only with an explicit OK for that exact action: `--force` (page build, navigation upsert, SEO apply, setup), `--refork`, `--update-plugins`, `--confirm` (removing a part override), `--force-organization`.
- `organization: kept` from SEO apply: report what Yoast holds; overwrite only if they ask.
- A page-QA failure you cannot fix without changing the design match the developer already accepted.
- Menu inclusion for each finished page; more pages.

Everything else: decide, write the decision into `section.notes` / `page.notes`, and continue.

## Final report

When the developer wants no more pages:

1. Pages built: slug, title, `url`.
2. Per page, a section table from `status.mjs`: `n`, label, block, status, iterations, and notes accepted by the developer (cap, motion, skipped).
3. SEO: point to each page's SEO table (`protoblocks-seo` Step 8).
4. Assets cropped from the design, to replace with originals.
5. Open warnings: a11y `minor`/`moderate` from page QA, SEO `warn` checks, `organization`/`jsonld` outcomes, pending menu links.
6. Theme fork history: `git -C "$THEME" log --oneline`.

## Iron rules

- Never claim a section or page passes without a recorded check in state (QA verdict, motion check, page QA, SEO audit).
- Never skip a phase because it "looks fine"; never mark anything `done` without its recorded check.
- Never overwrite a theme fork, a page, menu or SEO value edited in wp-admin, or a template-part DB override without explicit confirmation.
- Never run write commands against a site other than the one preflight resolved.
- Never build before the plan is approved; never approve it for the developer.
- Never lower QA thresholds (`site.qa`); only the developer may.

## References

- `references/pipeline.md` - per-action commands and outputs, status transitions, recovery.
- `references/state-schema.md` - state shape, enums, defaults, `state.mjs` CLI and its error codes.
- `references/local-sites.md` - how Local stores sites, the WP-CLI wrapper, troubleshooting.
