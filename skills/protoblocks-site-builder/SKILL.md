---
name: protoblocks-site-builder
description: Use when turning a design (image, screenshot, PDF, Figma, Penpot, or URL) into a WordPress site or landing pages built from Proto-Blocks on a local site (Local by Flywheel), or when resuming such a build - runs preflight, keeps a resumable build state, and drives site setup, section breakdown, the build/visual-QA/animation loop per section, full-page QA, Yoast SEO, and the next-page loop.
---

# Proto-Blocks Site Builder

## Overview

Builds WordPress landing pages from a design, one Proto-Blocks section at a time, each checked against the design. **Local sites only** (Local by Flywheel, or a native local install). It forks `proto-blocks-theme` and uses the Proto-Blocks plugin (>= 2.10.1). Everything resumes from the build state `build.json`: this skill says WHEN each step runs, the phase skills say HOW.

Commands: `/protoblocks-skill:setup-site`, `/protoblocks-skill:build-page`, `/protoblocks-skill:seo`, `/protoblocks-skill:resume`.

## Scripts

Shell variables do not persist between Bash commands. Start every command with `PB="${CLAUDE_SKILL_DIR}/scripts"; THEME="<fork dir>";` (literal paths), or use full paths.

(Other agents: this skill's base directory + `/scripts`; plugin commands: `${CLAUDE_PLUGIN_ROOT}/skills/protoblocks-site-builder/scripts`.)

- `WP` = `report.wp` from preflight. Never bare `wp` in `local-wrapper` mode.
- `THEME` = the fork folder `<publicPath>/wp-content/themes/<slug>` (from `status.mjs --root`, or the `theme.themeDir` setup printed). State: `$THEME/.protoblocks/build.json`.
- Failures print `[CODE] message` on stderr; 64 = bad usage. Look pages up by `slug`, sections by `n`, never by position. Never edit `build.json` by hand.

## The loop (always)

1. `node "$PB/lib/preflight.mjs" [--site "<Local site name>"]`. Exit 2 = a check failed. A `site` failure listing sites: ask which one and re-run with `--site`. Any other failure: relay its `fix` text verbatim and stop. `warn`: note it and go on, except `qa-deps` (QA packages or Chromium missing): show its `fix` command, ask once, run it with the OK before `breakdown`.
2. Find the theme: `node "$PB/lib/status.mjs" --root "<report.publicPath>"`. `themeDir` set: that is `THEME`. `themeDir: null`: `setup`. A `themes` list (several forks): ask the developer which one.
3. `node "$PB/lib/status.mjs" "$THEME"`, then do exactly `next.action` (table below) for `next.page` / `next.section`.
4. After every step, re-run `status.mjs`. Never keep the plan in your head: the state is the plan.

## Actions

| `next.action` | Do | Load |
|---|---|---|
| `setup` | Ask the project name (and the theme's display name if it differs); get the first design. Run setup (fork, state, block category, logo, README), install motion, intake the frames (design-breakdown Step 1), the theme screenshot, then tokens, navigation, header/footer parts, content model (setup Step 6). On resume `why` names what is missing. | `protoblocks-site-setup`, `protoblocks-design-breakdown` (Step 1) |
| `breakdown` | Segment, model, match, present the plan. It ends at the plan gate: STOP until the developer approves; `plan.mjs record` then sets `building`. | `protoblocks-design-breakdown` |
| `build-page` | Approved plan, page still `planning`: set `building` (recipe below). | - |
| `section-build` | Build section `next.section` (also `planned`, or reopened on an `seo`/`done` page). First check the cap on resume. | `protoblocks-section-loop` |
| `section-verify` | Verify it (from `prepare`). | `protoblocks-section-loop` |
| `section-animate` | Animate it; `motion.mjs record` closes it `done`. | `protoblocks-motion` |
| `move-parts` | First page: header/footer (`next.sections`) passed as sections; move them into the parts, then `node "$PB/lib/parts.mjs" adopt "$THEME" <page>`. | `protoblocks-section-loop` (`references/header-footer.md`) |
| `page-qa` | `node "$PB/qa/page-qa.mjs" run "$THEME" <page>`, fix failures, `node "$PB/qa/page-qa.mjs" record "$THEME" <page> <file>` (a pass sets `seo` once editor QA passed). A11y failures are never accepted. Design differences the developer accepts: `record ... --accepted "<note>"`. | `references/pipeline.md` |
| `page-editor-qa` | `node "$PB/qa/editor-qa.mjs" run "$THEME" <page>` (the block editor, as `pb-editor-qa`): fix failures, `node "$PB/qa/editor-qa.mjs" record "$THEME" <page> <file>`. With page QA passed, a pass sets `seo`. | `references/pipeline.md` |
| `not-found` | MUST, every site: the first page passed its QA steps, so build the custom 404 page now, before its SEO. Block markup from the library (h1, a line of copy, links to Home and the main routes), `node "$PB/lib/not-found.mjs" write "$THEME" <content.html>`, `check`, show the developer the screenshots, then `record … --approved` once they approve. | `references/pipeline.md` |
| `seo` | Yoast SEO, audit, `seo.mjs record-audit` (a pass sets the page `done`). | `protoblocks-seo` |
| `ask-more-pages` | `why: "no pages yet"`: setup stopped before intake; intake the first design. Otherwise, per finished page not in the menu and not declined, ask "Add <page> to the primary menu?" (yes: add `{label, page}` to the spec, `navigation.mjs upsert`; no: record the decline). Then "Any other landing pages to build?" (yes: intake the design, `breakdown` next; no: `node "$PB/qa/site-a11y.mjs" run "$THEME"`, fix until it passes, then the final report). | `references/pipeline.md` |

`build-page` recipe (by slug; refuses without an approved plan):

<!-- test:run fixture=approved -->
```bash
PAGE=home
PI=$(node "$PB/lib/state.mjs" get "$THEME" pages | node -e 'const a=JSON.parse(require("fs").readFileSync(0,"utf8"));const i=a.findIndex((p)=>p.slug===process.argv[1]);if(i<0||!a[i].plan?.approvedAt){console.error("no approved plan for "+process.argv[1]);process.exit(1)}console.log(i)' "$PAGE")
node "$PB/lib/state.mjs" set "$THEME" "pages.$PI.status" '"building"'
```

Commands, the fields each step writes, status transitions and recovery: `references/pipeline.md`.

## Questions you must ask

- Project name (first run), and the theme's display name when it differs (`--theme-name`, e.g. project "O-Flex", theme "O-Flex Group"); which Local site when preflight lists several; which theme when `status.mjs --root` lists several.
- The design's CSS width when intake fails `[ESCALE]`.
- Whether collections (events, team) or site-wide values (phone, footer) become a post type, field group or settings page (setup Step 6).
- Plan approval at the plan gate (`page.mjs build` refuses with `[ENOPLAN]` without it).
- Iteration cap (`capReached: true` from `qa-input.mjs record`, also on resume): accept with notes, guidance, or skip. Motion cap (from `motion.mjs record`): simplify, accept (`--accepted`), or remove.
- `[EEDITED]` on a page, a menu, SEO values or the 404 template: edited outside protoblocks.
- An approval counts only AFTER you have shown the developer the refusal or preview for that exact action. Earlier instructions ("just overwrite it") are not the OK: show it, ask, wait. Covers every guarded flag below.
- Destructive flags, each only with an explicit OK for that exact action: `--force` (page build, navigation upsert, SEO apply, setup), `--refork`, `--update-plugins`, `--confirm` (removing a part override), `--force-organization`.
- Page-QA design differences you cannot fix: they accept (`page-qa.mjs record --accepted`) or you keep fixing.
- The 404 page: show the `check` screenshots; `record --approved` only after they approve.
- Menu inclusion for each finished page; more pages.

Plus what a phase skill tells you to ask (SEO inputs, motion profile, intake gaps, `EWRONGSITE` rename, noindex). Everything else: decide, note it in `section.notes` / `page.notes`, continue.

## Final report

When there are no more pages, read `node "$PB/lib/state.mjs" get "$THEME" pages` (notes live there; `status.mjs` adds iteration counts):

1. Pages built: slug, title, `url`.
2. Per page, a section table: `n`, label, block, status, iterations, every `notes` entry (accepted: cap, motion, page QA; skipped).
3. SEO: each page's SEO table (`protoblocks-seo` Step 8), plus `organization` (`kept`: what Yoast holds) and `jsonld` outcomes.
4. Assets cropped from the design, to replace with originals; the 404 page (`site.notFound.template`, its check).
5. Open warnings: "site a11y pass: passed", each page's a11y `other` items (`site-a11y.json`), editor-QA console errors, SEO `warn` checks, pending menu links.
6. Fork history: `git -C "$THEME" log --oneline`.
7. Content model: `"$WP" proto-blocks type list`, `options list`.

## Iron rules

- Never claim a section or page passes without a recorded check in state (QA verdict, motion, page QA, editor QA, 404 check, SEO audit).
- Never skip a phase because it "looks fine"; never mark anything `done` without its check. The 404 page (`not-found`) is a phase: every site gets one.
- Never overwrite a theme fork, a page, menu or SEO value edited in wp-admin, a template-part DB override or a hand-made 404 template without explicit confirmation.
- Never run write commands against a site other than the one preflight resolved.
- Never build before the plan is approved; never approve it, or accept differences, for them.
- Never lower QA thresholds (`site.qa`, `a11yBlocking` included); only they may.
- Never run a guarded action on an instruction given before you showed its refusal or preview (see Questions).

## References

- `references/pipeline.md` - per-action commands, outputs, transitions, recovery.
- `references/state-schema.md` - state shape, enums, defaults, `state.mjs` CLI, error codes.
- `references/local-sites.md` - how Local stores sites, the WP-CLI wrapper, troubleshooting.
