# Verify: loop, verdicts, fixes

`PB`, `THEME` as in `SKILL.md`. A section passes only through a recorded verdict.

## Procedure

1. Page is built and gates passed (`SKILL.md`, Build).
2. `node "$PB/lib/qa-input.mjs" prepare "$THEME" <page> <n>` returns `{input, iteration}` and sets status `verifying`. It needs `page.url` (run `page.mjs build` first) and the section's crops, and refuses a `planned` or `skipped` section (`[EINPUT]` build it first). Breakpoints without a design frame are checked with sanity checks only. Only the newest prepared iteration can be recorded.
3. Dispatch the subagent `protoblocks-skill:visual-qa` with the prompt `CheckInput: <input path>`. It runs `check-section.mjs` (Bash timeout 600000, already in the agent file), reads the composites, writes `<iterDir>/verdict.json` and replies with it. Outside Claude Code run `node "$PB/qa/check-section.mjs" <input>` yourself and judge the `design | render | heatmap` composites.
4. `node "$PB/lib/qa-input.mjs" record "$THEME" <page> <n> <iterDir>/verdict.json` prints `{pass, iteration, capReached, status}`. `record` never trusts the verdict's numbers: it compares them with `<iterDir>/result.json` (written by `check-section.mjs`) and `input.json`, and re-applies the pass rule with the thresholds in `site.qa`. `[EVERDICT]` means the verdict is inconsistent (pass with failing numbers or a high discrepancy, numbers or breakpoints that differ from `result.json`, anchor mismatch, an older iteration, outside the iteration folder, or no `result.json` because check-section did not run): re-dispatch visual-qa for the newest iteration; never edit the file.
5. Pass: status is `animating` (or back to `done` if the section was `done` before this re-verification), baselines were stored for later regression checks. Fail: status is `building`; fix, re-run gates and `page.mjs build`; if the edited block's `usedOn` lists other pages, run `regress.mjs` (see "Regression") and fix until it passes; repeat from step 2.

## Pass rule

`mismatch <= mismatchMax` AND `heightDelta <= heightDeltaMax` AND no `high` discrepancy; never pass when `numericPass` is false. Thresholds come from `site.qa` (defaults 0.08, 0.03, `maxIterations` 5). Never lower them to get a pass.

## Result fields and what to fix

Each breakpoint result in `result.json` (and `verdict.breakpoints`) has `mode` `diff`, `sanity` or `error`.

| field | meaning | fix |
|---|---|---|
| `mismatch`, `heightDelta` | pixel difference and relative height difference against the crop | see "Fix by discrepancy type" |
| `numericPass` | all numeric checks passed, including no page or in-section image errors and `widthDelta` 0 | must be true to pass |
| `widthDelta` != 0 | the section renders N CSS px narrower (negative) or wider than the viewport | the anchor element must be the full-bleed band (`alignfull`, no outer max-width or margins); insets go inside it. If every section shows the same negative delta at desktop, the theme shell cap is too small: see the design-breakdown intake note ("Shell cap") |
| `fullyMasked` (reported as mismatch 1) | every pixel was masked, nothing was compared | the masks are wrong: fix `sections[j].masks.<bp>` (recipe below), not the block |
| `imageErrors` (in-section) | images in the section failed, stalled or are broken | fix the attachment id/url, or re-import with `media.mjs import ... --alt`; check `section.attrs` |
| `pageImageWarnings` | stalled images elsewhere on the page | informational; never chase them |
| `status` >= 400 on an `error` result | HTTP error loading the page | page URL wrong or page not published: check `page.url`, re-run `page.mjs build` (draft/private: see the note below) |
| `pageErrors`, `consoleErrors` | PHP/JS errors captured while loading | fix the template; they explain an `error` result |
| sanity `issues` | `overflow`, `overlap` (high), `small-text`, `tap-target` (medium), `note` (ignore) | fix in the block CSS for that breakpoint |

Draft or private page: QA loads the page as an anonymous visitor, so a draft, pending or private page answers with a 404 or a redirect to the login page (renders that show a login form, or `status` >= 400). `page.mjs build` keeps a status the developer set. Ask the developer whether to publish it: only with their OK, `node "$PB/lib/page.mjs" build "$THEME" <page> --force` (it backs up first, and `--force` publishes a draft, pending or private page).

### Error-shaped verdicts

`{"pass":false,"error":"..."}` means the check itself failed (missing dependencies, `[EINPUT]`, `[EANCHOR]`, timeout). `record` keeps the status `verifying` and does not count it as an iteration. Fix the environment (install the QA deps in `scripts/qa`, check the URL, retry the page) and re-run from `prepare`. Do not edit the block for it.

## Fix by discrepancy type

Apply highest severity first; re-measure after each batch.

| type | fix |
|---|---|
| spacing | padding/margin/gap tokens (`py-section`, `gap-6`), never ad-hoc pixels twice |
| type | text token and weight (`text-h2 font-semibold`), line-height, max width of the text column |
| layout | grid/flex structure, column count, alignment, order, breakpoint prefixes |
| color | a theme token; if none matches, add it to the tokens file via `tokens.mjs apply` rather than hard-coding |
| height delta | line-height, vertical padding, image aspect ratio (`aspect-[16/9]`, `object-cover`), wrapped text |
| structure | missing or extra element in `template.php`, or a field left empty |

## Masks for placeholders

When the design crop contains a photo or an asset you cannot reproduce (placeholder or cropped stock image, video, map), the diff is noisy there. Mask it; do not chase it. Masks are crop-pixel rectangles per breakpoint (the crop's own pixels, device pixels):

<!-- test:run -->
```bash
PI=$(node "$PB/lib/state.mjs" get "$THEME" pages | node -e 'const a=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(a.findIndex((p)=>p.slug===process.argv[1]))' home)
SI=$(node "$PB/lib/state.mjs" get "$THEME" "pages.$PI.sections" | node -e 'const a=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(a.findIndex((x)=>x.n===Number(process.argv[1])))' 1)
test "$PI" -ge 0 && test "$SI" -ge 0
node "$PB/lib/state.mjs" set "$THEME" "pages.$PI.sections.$SI.masks" '{"desktop":[{"x":720,"y":0,"w":720,"h":640}]}'
```

The next `prepare` copies the masks into the check input. Mask only what you cannot match; keep text and layout unmasked. A mask covering the whole crop gives `fullyMasked`. Tell the developer which regions were masked and why (put it in `section.notes`).

## Iteration cap

`record` returns `capReached: true` after `maxIterations` failed real iterations (error verdicts do not count; the count restarts after a passing iteration), and stores `capReached: true` on that iteration's `qa` records. On resume, if the section's last `qa` record has `capReached: true`, ask the developer before running another iteration. Stop. Show the developer the latest composite path(s) (`<iterDir>/<bp>-composite.png`, see `result.json`) and the open discrepancies, then ask them to choose:

1. Accept with notes: set status `animating` and write what remains in `section.notes` (for example "accepted by developer: hero image 12px taller").
2. Give guidance and continue: apply their direction and keep iterating. Continuing past the cap is a developer decision; a fresh budget only starts after a pass, so further failed iterations stay over the cap and each one asks again.
3. Skip: `node "$PB/lib/state.mjs" set "$THEME" pages.<i>.sections.<j>.status '"skipped"'` (page build then leaves the section out).

Never continue, accept or skip silently.

## Regression (decision `extend`, or any edit to a shared block)

After an `extend`, and after any edit (including a Verify fix) to a block whose `usedOn` (`library.mjs list`) lists other pages, and before re-verifying: `node "$PB/lib/regress.mjs" "$THEME" <block>` re-shoots every earlier use against its stored baseline. Output `{block, checked, results, pass}`; `checked: 0` plus a `note` means no baselines yet. Thresholds: `mismatch <= 0.01` and `heightDelta <= 0.005`. A result with `error` failed too (page gone, baseline file missing, browser). Fix the block until every previous page is unchanged; the extension must be additive. Once the section itself passes Verify, new baselines are stored for it.
