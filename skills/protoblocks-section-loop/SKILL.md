---
name: protoblocks-section-loop
description: Use when building, verifying and fixing one Proto-Blocks section of a planned page until it visually matches its design crop - authoring the block, passing build gates, assembling the page, dispatching the visual-qa subagent, recording verdicts, and handling the iteration cap. Normally invoked by protoblocks-site-builder for each section in order.
---

# Proto-Blocks Section Loop

Builds one section of an approved plan, then verifies it against its design crop until it passes. Preconditions: preflight passed, `protoblocks-site-setup` ran, and `protoblocks-design-breakdown` recorded an approved plan (`pages[i].plan`). No block is built before approval.

## Scripts and state

```bash
PB="${CLAUDE_SKILL_DIR}/../protoblocks-site-builder/scripts"
```

`THEME` is the fork directory (`<site.path>/wp-content/themes/<site.theme.slug>`). `WP` is the WP-CLI command preflight resolved (`report.wp`). Failures print `[CODE] message` on stderr; error codes for setup tools are in `protoblocks-site-setup/references/errors.md`.

Read the section first (look up the page by `slug` and the section by `n`, never by position):

```bash
node "$PB/lib/state.mjs" get "$THEME" pages
```

Resume by `status`:

| status | go to |
|---|---|
| `planned`, `building` | Build |
| `verifying` | Verify, re-run from `prepare` |
| `building` with `capReached: true` on the last `qa` record | ask the developer first (`references/verify.md`, "Iteration cap") |
| `animating` | Animate |
| `done`, `skipped` | next section |

Work one section at a time, in plan order (header first, footer last: `references/header-footer.md`).

## Build

Details and checklist: `references/build.md`.

1. Load the `protoblocks` skill (always) for authoring rules.
2. By `decision`:
   - `new`: scaffold with `"$WP" proto-blocks create <block> --title="<Title>" --dir=theme`, then write `block.json`, `template.php` and CSS. Never `--dir=plugin` (not a discovery path); never `--force` over an existing block.
   - `extend`: add a control whose default reproduces the current output. Never change what existing instances render.
   - `reuse`: no block changes; set attrs only.
3. Assets cropped from the design: `node "$PB/lib/media.mjs" import "$THEME" <file> --alt "<text>"`. Alt is required. Put the printed `attr` object into `section.attrs`. A re-import reuses the attachment and keeps its existing alt (`altKept: true`, `attr.alt` is the kept text); add `--force-alt` only when the developer wants it replaced.
4. Write `block`, `attrs` and `inner` with `state.mjs set` (recipe in `references/build.md`).
5. Gates until `ok: true`; a failing step names the cause. They read `block` and `attrs` from state (never hand-copy JSON into the shell):
   `node "$PB/lib/gates.mjs" "$THEME" --from-state <page> <n>`
6. Assemble the page (creates it on first run, then rewrites it):
   `node "$PB/lib/page.mjs" build "$THEME" <page>`
   `EEDITED`, `ESLUGTAKEN`, `EFOREIGN` mean the builder refused to overwrite something. Show the developer the message, ask, and only with their OK re-run with `--force` (it backs up first). `ENOTPAGE` (the stored `postId` is not a page) is not fixable with `--force`: tell the developer, then clear `pages.<i>.postId` to `null` (by-slug recipe in `references/build.md`) and build again. `ESTALE`: the page changed during the build; just re-run the build, never `--force`. `ENOPLAN`: no approved plan; go back to the plan gate. Relay `warnings` (kept developer title/slug/status).
7. Record the block in the library:
   `node "$PB/lib/library.mjs" record "$THEME" <block> <page> --purpose "<one line>" [--variants a,b]` (variants are added to the recorded ones)
8. `extend`, or any edit to a block whose `usedOn` (`library.mjs list`) lists other pages: `node "$PB/lib/regress.mjs" "$THEME" <block>`. `checked: 0` with a `note` means no baselines yet (fine). Failures: fix the block until earlier pages are unchanged.
9. Commit in the theme fork (skip if nothing changed):
   `git -C "$THEME" add -A && git -C "$THEME" commit -m "feat(block): <block>"`

## Verify

Procedure, result fields and fix strategies: `references/verify.md`.

1. `node "$PB/lib/qa-input.mjs" prepare "$THEME" <page> <n>` prints `{input, iteration}` and sets status `verifying` (refuses `planned`/`skipped`: build first).
2. Dispatch the `protoblocks-skill:visual-qa` subagent (Agent tool, subagent type `protoblocks-skill:visual-qa`) with the prompt `CheckInput: <input path>`. It needs a Bash timeout of 600000 (set in the agent). Elsewhere: run `node "$PB/qa/check-section.mjs" <input>` yourself and judge the composites with the same rubric.
3. `node "$PB/lib/qa-input.mjs" record "$THEME" <page> <n> <iterDir>/verdict.json` prints `{pass, iteration, capReached, status}`.
4. `pass: true`: status is now `animating` (go to Animate), or `done` again for a section that was `done` before this re-verification (next section).
5. `pass: false`: apply the verdict's fixes, highest severity first, re-run gates and page build. If you edited a block whose `usedOn` lists other pages, run `node "$PB/lib/regress.mjs" "$THEME" <block>` and fix until it passes, before re-verifying. Then Verify again. An error verdict (`error` set) stays `verifying`, does not count as an iteration, and means fix the environment and re-run.
6. `capReached: true` (also stored on that iteration's `qa` records, so check it on resume): stop and ask the developer before another iteration, never continue silently (see `references/verify.md`, "Iteration cap"). Their options: accept with notes, give guidance and continue, or skip the section.

## Animate

When status is `animating`, load the `protoblocks-motion` skill (Stage 5). If the `protoblocks-motion` skill is not installed, set the status to `done` (`state.mjs set "$THEME" "pages.$PI.sections.$SI.status" '"done"'`, indexes looked up as in `references/build.md`) and continue with the next section.

## Iron rules

- Never mark a section passing without a recorded verdict.
- Never edit `verdict.json` or state by hand; a verdict that contradicts its numbers is rejected (`EVERDICT`).
- Never lower QA thresholds to get a pass; only the developer may change `site.qa`.
- Never pass `--force` (page build) or `--confirm` (parts) without the developer's OK for that exact action.
- One section at a time, in plan order.
- Never recreate a block the library lists with an `error`; tell the developer.

## References

- `references/build.md` - authoring checklist, gate failures, state recipes.
- `references/verify.md` - verify loop, verdict fields, fix strategies, cap conversation, regressions.
- `references/header-footer.md` - header/footer through the loop, then template parts.
