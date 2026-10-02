# Pipeline

What `status.mjs` returns, what to run for each `next.action`, what each step writes to state, and how to recover. The phase skills hold the details of each step; this file only sequences them. `PB`, `THEME`, `WP` as in `SKILL.md`.

## Status

```bash
node "$PB/lib/status.mjs" --root "<publicPath>"    # find THEME (once per session)
node "$PB/lib/status.mjs" "$THEME"
```

`--root` scans `<publicPath>/wp-content/themes/*/.protoblocks/build.json`: one match prints `themeDir` (use it as `THEME`) plus the summary; none prints `{"themeDir": null, "next": {"action": "setup"}}`; several print `{"themes": [{themeDir, url, pages}], "next": null}`: ask the developer which one. With a theme folder it prints `{themeDir, site, pages: [{slug, status, sections: [{n, label, block, status, iterations, lastPass}]}], next: {action, page, section, sections, why}}`; without a `build.json` only `next` (`setup`). `[ENOTHEME]`: not a directory (wrong path, or setup never ran). `[EPARSE]` / `[EINVALID]`: see Recovery.

`nextAction` takes the first page whose status is not `done`, or that has a reopened section, in state order. "Open" sections are `building`, `verifying` or `animating`; `skipped` never blocks page QA or SEO. Only actions in `ACTIONS` are ever returned.

| State | `next.action` |
|---|---|
| no state | `setup` |
| `site.tokens`, `site.navigation.menus` or `site.parts.header` missing (`why` names them) | `setup` |
| no pages, or every page `done` with no open section | `ask-more-pages` |
| `planning`, no `plan.approvedAt` (or approved with no sections) | `breakdown` |
| `planning` with `plan.approvedAt` | `build-page` |
| `building`, no sections | `breakdown` |
| `building`, lowest open `n` is `planned` or `building` | `section-build` |
| `building`, lowest open `n` is `verifying` | `section-verify` |
| `building`, lowest open `n` is `animating` | `section-animate` |
| `seo` or `done` page with an open section (reopened) | that section's action |
| `building`, every section `done`/`skipped`, a header/footer section `done` and not `inPart` (no other page has it in a part) | `move-parts` (`next.sections`: their `n`s) |
| `building`, every section `done`/`skipped`, no passed or accepted `pageQa` | `page-qa` |
| `seo`, or `pageQa.pass` / `pageQa.accepted` | `seo` |

## Status transitions

Page (`planning` -> `building` -> `seo` -> `done`):

| From -> to | Written by |
|---|---|
| (new) -> `planning` | `intake.mjs add-frame` / `from-url` (creates the page) |
| `planning` -> `building` | `plan.mjs record` (with `plan.approvedAt`); `page.mjs build` refuses with `[ENOPLAN]` until `plan.approvedAt` exists |
| `building` -> `seo` | `page-qa.mjs record` with a passing result, or `--accepted "<note>"` on design-only differences (a plain failure keeps `building` and stores `pageQa.pass: false`, clearing any earlier acceptance) |
| `seo` -> `done` | `seo.mjs record-audit` with a passing audit (`[ESTATUS]` on any other page status, or while a section is open) |
| `done` -> `seo` | `seo.mjs apply` on a finished page (the old audit no longer applies) |

Section (`planned` -> `building` -> `verifying` -> `animating` -> `done`):

| From -> to | Written by |
|---|---|
| `planned` -> `building` | the Build step (`state.mjs set ... status '"building"'`, `protoblocks-section-loop` `references/build.md`); `plan.mjs record` for a later page's header/footer (`inPart`) |
| `building` -> `verifying` | `qa-input.mjs prepare` (refuses `planned` and `skipped`) |
| `verifying` -> `animating` | `qa-input.mjs record` with a pass (`done` instead when it was `done` before re-verification) |
| `verifying` -> `building` | `qa-input.mjs record` with a failing verdict; at `site.qa.maxIterations` failed iterations (default 5) it returns `capReached: true` |
| `verifying` stays | `qa-input.mjs record` with an error verdict (script/environment): not an iteration; fix the environment and re-verify |
| `animating` -> `done` | `motion.mjs record` with a passing check, or `--accepted`; a failure stays `animating`, `capReached: true` at `site.qa.motionMaxAttempts` (default 3) |
| any -> `skipped` | only the developer's choice at the iteration cap |
| `done` -> `verifying` -> `done` | re-verification (`qa-input.mjs prepare` on a shared-block edit or page-QA fix; `parts.mjs adopt` for the first content section) |
| `done` -> `building` (`inPart`) -> `verifying` -> `done` | `parts.mjs adopt` for the first page's header/footer; then page build and Verify |

## Actions

### `setup`

Ask the project name, get the first design. Then follow `protoblocks-site-setup`:

```bash
node "$PB/lib/setup-site.mjs" --name "<Project>" [--site "<Local site>"]
node "$PB/lib/motion.mjs" install "$THEME"
```

`THEME` = the printed `theme.themeDir`. `setup-site.mjs` writes `build.json` (`site.url`, `site.path`, `site.theme`, `site.wp`, `site.qa` defaults). Then intake the first design (`protoblocks-design-breakdown` Step 1, `references/intake.md`), because tokens are read from the frames:

```bash
node "$PB/lib/intake.mjs" add-frame "$THEME" <page> desktop frame-desktop.png [--width W] [--title "Home"]
```

That creates `pages[]` (`status: planning`, `design.frames`). Then tokens (`site.tokens`), navigation (`site.navigation.menus.<key>`) and the header/footer parts (site-setup Steps 2-4):

```bash
node "$PB/lib/tokens.mjs" apply "$THEME" "$THEME/.protoblocks/tokens.json"
node "$PB/lib/navigation.mjs" upsert "$THEME" primary spec.json
node "$PB/lib/parts.mjs" overrides "$THEME"
```

Plan the header and footer as the first and last sections of the first page (ranges with `part`); the section loop builds them and moves them into the parts later.

`tokens.mjs apply` writes `site.tokens`, `navigation.mjs upsert` writes `site.navigation.menus.<key>`, and `parts.mjs write` writes `site.parts.<slug>` (`{block, writtenAt}`).

Resuming a half-done setup: status says `setup` with `why` naming the missing fields (or `ask-more-pages` with `why: "no pages yet"` when only the intake is missing). Run only those steps; also check `site.motionProfile` and `pages` (`node "$PB/lib/state.mjs" get "$THEME" site`). `setup-site.mjs` is safe to re-run (it reuses the fork) and every setup step is idempotent.

### `breakdown`

Follow `protoblocks-design-breakdown` Steps 1-5 for `next.page` (frames, `segment.mjs analyze`, `intake.mjs crop`, `library.mjs list`, plan table). It ends at the plan gate: present the table and STOP. After the developer approves, `plan.mjs record` writes `plan`, `label`/`decision`/`block` per section, the fixed header/footer anchors, and page status `building`:

```bash
node "$PB/lib/plan.mjs" record "$THEME" "$THEME/.protoblocks/plan.json"
```

`[EPLAN]`: fix the plan file (nothing was written). `[ENOSECTION]`: crop that `n` first.

### `build-page`

The plan is approved but the page is still `planning`. Set it `building` with the recipe in `SKILL.md` (looks the page up by slug, refuses without `plan.approvedAt`). Never set `building` without an approved plan; go back to `breakdown` instead.

### `section-build`

Load `protoblocks-section-loop` for `next.page` / `next.section` and follow its resume table. A header/footer in `building` with `inPart: true` (after `move-parts`, or on a later page) is not built: its resume row is `library.mjs record`, `page.mjs build`, then Verify. First check the cap: if the section's last `qa` record has `capReached: true`, ask the developer before anything else (`verify.md`, "Iteration cap"). Build writes `block`, `attrs`, `inner`, status `building`; `page.mjs build` writes `postId`, `url`, `contentHash`; `library.mjs record` writes `library.<block>.usedOn`.

Find a section's indexes by slug and `n` (for any `state.mjs set` the phase skills ask for):

<!-- test:run -->
```bash
PAGE=home N=3
PI=$(node "$PB/lib/state.mjs" get "$THEME" pages | node -e 'const a=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(a.findIndex((p)=>p.slug===process.argv[1]))' "$PAGE")
SI=$(node "$PB/lib/state.mjs" get "$THEME" "pages.$PI.sections" | node -e 'const a=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(a.findIndex((x)=>x.n===Number(process.argv[1])))' "$N")
test "$PI" -ge 0 && test "$SI" -ge 0
node "$PB/lib/state.mjs" get "$THEME" "pages.$PI.sections.$SI.status"
```

### `section-verify`

`protoblocks-section-loop` Verify, re-run from `prepare`:

```bash
node "$PB/lib/qa-input.mjs" prepare "$THEME" <page> <n>
node "$PB/lib/qa-input.mjs" record "$THEME" <page> <n> <iterDir>/verdict.json
```

Between them, the `protoblocks-skill:visual-qa` subagent checks the section. `record` appends `qa` records and prints `{pass, iteration, capReached, status}`. On `capReached: true` stop and ask (accept with notes -> `animating`, or `done` when the section has `prevStatus: "done"` (a re-verification); guidance -> continue; skip -> `skipped`).

### `section-animate`

Load `protoblocks-motion` for that section (profile once per site, presets, `motion-check.mjs`, then `motion.mjs record`). `record` prints `{pass, attempts, capReached, status}` and writes `motion`; a pass sets `done`. On `capReached: true` ask: simplify, accept (`--accepted`), or remove. Header and footer get no motion (`protoblocks-motion` step 1), but they still close through the check (`motion-check.mjs --anchor pb-header`, or `pb-footer`, never `pb-s<n>`) and `motion.mjs record` (no `--presets`).

### `move-parts`

First page only: every section is closed and the header/footer (`next.sections`) passed as page sections. Follow `protoblocks-section-loop` `references/header-footer.md` "Moving them into the parts": overrides, `parts.mjs markup "$THEME" --from-state <page> <n>`, `parts.mjs write`, then in one atomic write:

```bash
node "$PB/lib/parts.mjs" adopt "$THEME" <page>
```

Prints `{page, moved: [{n, anchor, status}], reverify}`. It sets the header/footer `inPart: true`, status `building`, `prevStatus: "done"`, and the first content section `verifying` (`prevStatus: "done"`). Status then routes through them: `section-build` for the header (inPart row: `library.mjs record`, `page.mjs build`, Verify), `section-verify` for the content section, then the footer. Each pass returns them to `done`. `[EINPUT]` "does not carry the anchor": write the part from state first. `[EINPUT]` "nothing to adopt": already moved. Afterwards: `node "$PB/lib/navigation.mjs" refresh "$THEME"`.

### `page-qa`

1. Run full-page QA (Playwright, reduced motion, each design frame vs a full-page screenshot, axe on `wcag2a, wcag2aa, wcag21a, wcag21aa`):

```bash
node "$PB/qa/page-qa.mjs" run "$THEME" <page>
```

   Prints `{url, pass, breakpoints: [{name, status, mismatch, heightDelta, fullyMasked, masksApplied, masks, imageErrors, composite, pass}], a11y: {blocking, other}, pageErrors, warnings, file}` and exits 1 unless `pass`. Section masks (`sections[j].masks.<bp>`) are applied at the design position (via the crop range `sections[j].ranges.<bp>`) and at the position the section renders; a section with masks but no range is listed in `warnings` (re-crop it to record the range). The result is saved to `$THEME/.protoblocks/artifacts/<page>/page-qa/page-qa.json`. A breakpoint passes at `mismatch <= site.qa.pageMismatchMax` (0.12) and `heightDelta <= site.qa.heightDeltaMax` (0.03). Only `serious`/`critical` axe violations inside `main`, `header`, `footer` or a `#pb-s…` section block the page; `minor`/`moderate` go into the final report. `[ENOPAGE]` "has no url": the page was never built (`page.mjs build`). `[EINPUT]` "at least one design frame": intake first.
2. Fix failures:
   - Design difference: open the `composite` images, find the responsible section, fix it with `protoblocks-section-loop` (Build fix, gates, `page.mjs build`), then `qa-input.mjs prepare` for that section. Status now routes to `section-verify`; a pass returns it to `done` and page QA comes up again.
   - Blocking a11y violation: fix the block markup or colors (tokens), rebuild, re-verify every section whose markup changed.
   - `imageErrors` / `pageErrors`: broken media or console errors; fix them, rebuild.
   - `a11y.error`: axe could not run (QA deps, see Recovery).
   - Design differences you cannot fix (for example ones the developer already accepted per section): show the composites and ask. They accept them (step 3 with `--accepted`) or you keep fixing. Never accept for them; only the developer may change `site.qa`.
3. Record the run (every run, pass or fail):

```bash
node "$PB/qa/page-qa.mjs" record "$THEME" <page> "$THEME/.protoblocks/artifacts/<page>/page-qa/page-qa.json"
```

   Prints `{pass, status}`; writes `pageQa: {pass, file, at}`. A pass sets the page `seo`. With the developer's acceptance:

```bash
node "$PB/qa/page-qa.mjs" record "$THEME" <page> "$THEME/.protoblocks/artifacts/<page>/page-qa/page-qa.json" --accepted "<what they accepted>"
```

   Prints `{pass: false, accepted: true, status: "seo"}`; writes `pageQa: {pass: false, accepted: true, note, by: "developer", file, at}` and `page.notes.pageQa`. A real pass ignores `--accepted`. `[EACCEPT]`: something other than a design difference failed (axe error or blocking violation, page errors, broken images, HTTP error, fully masked or missing breakpoint, run error): fix it, re-run. `[ESTATUS]`: the page is not `building` or a section is still open. `[EINPUT]`: the file is for another url (re-run `run`), or `--accepted` has no note.

### `seo`

Load `protoblocks-seo` for `next.page`: `seo.mjs get`, infer, OG image, schema, `seo.mjs apply`, `seo-audit.mjs`, up to 3 fix rounds, then:

```bash
node "$PB/lib/seo.mjs" record-audit "$THEME" <page> "$THEME/.protoblocks/artifacts/<page>/seo-audit.json"
```

`apply` writes `seo.appliedValues` (and sets a `done` page back to `seo`); `record-audit` writes the audit and, on a pass, page status `done`. It refuses with `[ESTATUS]` while a section of the page is open (reopened by a content fix): finish it, re-audit. `[EEDITED]` and `--force-organization`: see the questions in `SKILL.md`; `organization: kept` goes into the final report.

### `ask-more-pages`

`why: "no pages yet"`: setup stopped before intake; intake the first design (see `setup`). No questions.

Otherwise every page is `done`:

1. List the finished pages to ask about (not in the primary menu, not declined before):

<!-- test:run -->
```bash
node "$PB/lib/state.mjs" get "$THEME" | node -e 'const s=JSON.parse(require("fs").readFileSync(0,"utf8"));const has=(xs,p)=>(xs??[]).some((i)=>i.page===p||has(i.children,p));const items=s.site.navigation?.menus?.primary?.spec?.items;for(const p of s.pages)if(p.status==="done"&&!has(items,p.slug)&&p.notes?.menu!=="declined")console.log(p.slug)'
```

   For each, ask "Add <page> to the primary menu?". No: record the decline so it is never asked again:

<!-- test:run -->
```bash
PAGE=home
PI=$(node "$PB/lib/state.mjs" get "$THEME" pages | node -e 'const a=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(a.findIndex((p)=>p.slug===process.argv[1]))' "$PAGE")
test "$PI" -ge 0
node "$PB/lib/state.mjs" set "$THEME" "pages.$PI.notes.menu" '"declined"'
```

   Yes: add `{label, page}` to the spec stored in state and upsert it:

<!-- test:run -->
```bash
PAGE=home LABEL="Home" SPEC="$THEME/.protoblocks/menu-primary.json"
node "$PB/lib/state.mjs" get "$THEME" site.navigation.menus.primary.spec > "$SPEC"
node -e 'const fs=require("fs");const [f,page,label]=process.argv.slice(1);const spec=JSON.parse(fs.readFileSync(f,"utf8"))??{title:"Primary",items:[]};const has=(xs)=>xs.some((i)=>i.page===page||has(i.children??[]));if(!has(spec.items))spec.items.push({label,page});fs.writeFileSync(f,JSON.stringify(spec,null,2)+"\n")' "$SPEC" "$PAGE" "$LABEL"
```
```bash
node "$PB/lib/navigation.mjs" upsert "$THEME" primary "$THEME/.protoblocks/menu-primary.json"
```

   `upsert` updates `site.navigation.menus.primary` (`id`, `spec`, `pending`, `contentHash`). `[EEDITED]`: see Recovery. `pending` links are converted by `page.mjs build` or `node "$PB/lib/navigation.mjs" refresh "$THEME"` once the page is published.
2. Ask "Any other landing pages to build?". Yes: get the design, intake it (`intake.mjs add-frame` with the new slug creates the page in `planning`); status then says `breakdown` for it. The library and the shared header/footer parts are reused (`reuse`, `inPart`). No: write the final report (`SKILL.md`).

## Recovery

### State file bad

`[EPARSE]` (not JSON), or `[EINVALID]` from `status.mjs`, `get` or `validate`: the file on disk is bad. Roll back to the last valid copy and re-run status:

```bash
node "$PB/lib/state.mjs" restore "$THEME"
node "$PB/lib/state.mjs" validate "$THEME"
```

`[ENOBACKUP]`: there is no `build.json.bak`; tell the developer. `[EINVALID]` or `[EVALUE]` from `set`/`append` is different: the value was rejected and nothing changed. Fix the value and retry; never `restore` (it would undo the previous good write). Never re-`init` over existing state.

### `[EEDITED]`: edited outside protoblocks

Nothing was written in every case. Show the developer the message and ask.

- Page (`page.mjs build`): the page was edited in wp-admin since the builder last wrote it. Keep their version (stop changing that page), or with their OK `node "$PB/lib/page.mjs" build "$THEME" <page> --force` (backs up the current content first; also publishes a draft). The same applies to `ESLUGTAKEN` and `EFOREIGN`.
- Menu (`navigation.mjs upsert`): the menu was edited in the Site Editor. Leave it, change the spec to match it, or with their OK `node "$PB/lib/navigation.mjs" upsert "$THEME" primary "$THEME/.protoblocks/menu-primary.json" --force` (saves the menu to `artifacts/backups/nav-<key>-<timestamp>.html` first).
- SEO (`seo.mjs apply`): a Yoast value was set outside the skill. Read it with `node "$PB/lib/seo.mjs" get "$THEME" <page>` and put it in `seo.json` as provided, or with their OK `node "$PB/lib/seo.mjs" apply "$THEME" <page> seo.json --force`.

### Local site stopped

Preflight fails the `site` check ("Start the site in Local") or WP-CLI reports `Error establishing a database connection`. Ask the developer to start the site in Local, then re-run preflight (it rewrites the WP-CLI wrapper) and status. Nothing in state needs fixing. More: `references/local-sites.md`.

### QA dependencies missing

Preflight warns on `playwright`, or a QA script fails to import `playwright` / `@axe-core/playwright` / `sharp` / `pixelmatch` (page QA then reports `a11y.error`). Install them once:

```bash
cd "$PB/qa" && npm install && npx playwright install chromium
```

Then re-run the failed check. An error verdict from visual QA leaves the section `verifying`, so status resumes there.

### `[EWRONGSITE]`

The fork's state belongs to another site (`site.url` differs from the site preflight resolved); nothing changed. Use the theme of the site preflight resolved, or run preflight with the right `--site`. If the site was renamed, fix `site.url` with the `state.mjs set` command the message prints, only after the developer confirms it is the same site.

### `[ENOPLAN]`

`page.mjs build` on a page without `plan.approvedAt`. Go back to `breakdown` and the plan gate; never record approval for the developer.
