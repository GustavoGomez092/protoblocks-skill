# Pipeline

What `status.mjs` returns, what to run for each `next.action`, what each step writes to state, and how to recover. The phase skills hold the details of each step; this file only sequences them. `PB`, `THEME`, `WP` as in `SKILL.md`.

## Status

```bash
node "$PB/lib/status.mjs" "$THEME"
```

Prints `{site, pages: [{slug, status, sections: [{n, label, block, status, iterations, lastPass}]}], next: {action, page, section, why}}`. Without a `build.json` it prints only `{"next": {"action": "setup"}}`. `[ENOTHEME]`: `$THEME` is not a directory (wrong path, or setup never ran). `[EPARSE]` / `[EINVALID]`: see Recovery.

`nextAction` takes the first page whose status is not `done`, in state order:

| Page state | `next.action` |
|---|---|
| no state | `setup` |
| no pages, or every page `done` | `ask-more-pages` |
| `planning`, no `plan.approvedAt` (or approved with no sections) | `breakdown` |
| `planning` with `plan.approvedAt` | `build-page` |
| `building`, no sections | `breakdown` |
| `building`, lowest open `n` is `planned` or `building` | `section-build` |
| `building`, lowest open `n` is `verifying` | `section-verify` |
| `building`, lowest open `n` is `animating` | `section-animate` |
| `building`, every section `done`/`skipped`, no passing `pageQa` | `page-qa` |
| `seo` (or a passing `pageQa`) | `seo` |

"Open" means not `done` and not `skipped`; skipped sections never block page QA or SEO.

## Status transitions

Page (`planning` -> `building` -> `seo` -> `done`):

| From -> to | Written by |
|---|---|
| (new) -> `planning` | `intake.mjs add-frame` / `from-url` (creates the page) |
| `planning` -> `building` | `plan.mjs record` (with `plan.approvedAt`); `page.mjs build` refuses with `[ENOPLAN]` until `plan.approvedAt` exists |
| `building` -> `seo` | `page-qa.mjs record` with a passing result (a failing one keeps `building` and stores `pageQa.pass: false`) |
| `seo` -> `done` | `seo.mjs record-audit` with a passing audit (`[ESTATUS]` on any other page status) |
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
| `done` -> `verifying` -> `done` | re-verification (header/footer move, shared-block edit, page-QA fix) |

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

Resuming a half-done setup (status then says `ask-more-pages` with `why: "no pages yet"`, or `breakdown`): `setup-site.mjs` is safe to re-run (it reuses the fork). Check `site.motionProfile`, `pages`, `site.tokens` and `site.navigation.menus` with `node "$PB/lib/state.mjs" get "$THEME" site`, and run only the missing steps. Every setup step is idempotent.

### `breakdown`

Follow `protoblocks-design-breakdown` Steps 1-5 for `next.page` (frames, `segment.mjs analyze`, `intake.mjs crop`, `library.mjs list`, plan table). It ends at the plan gate: present the table and STOP. After the developer approves, `plan.mjs record` writes `plan`, `label`/`decision`/`block` per section, the fixed header/footer anchors, and page status `building`:

```bash
node "$PB/lib/plan.mjs" record "$THEME" "$THEME/.protoblocks/plan.json"
```

`[EPLAN]`: fix the plan file (nothing was written). `[ENOSECTION]`: crop that `n` first.

### `build-page`

The plan is approved but the page is still `planning`. Set it `building` with the recipe in `SKILL.md` (looks the page up by slug, refuses without `plan.approvedAt`). Never set `building` without an approved plan; go back to `breakdown` instead.

### `section-build`

Load `protoblocks-section-loop` for `next.page` / `next.section` and follow its resume table. First check the cap: if the section's last `qa` record has `capReached: true`, ask the developer before anything else (`verify.md`, "Iteration cap"). Build writes `block`, `attrs`, `inner`, status `building`; `page.mjs build` writes `postId`, `url`, `contentHash`; `library.mjs record` writes `library.<block>.usedOn`.

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

Between them, the `protoblocks-skill:visual-qa` subagent checks the section. `record` appends `qa` records and prints `{pass, iteration, capReached, status}`. On `capReached: true` stop and ask (accept with notes -> `animating`; guidance -> continue; skip -> `skipped`).

### `section-animate`

Load `protoblocks-motion` for that section (profile once per site, presets, `motion-check.mjs`, then `motion.mjs record`). `record` prints `{pass, attempts, capReached, status}` and writes `motion`; a pass sets `done`. On `capReached: true` ask: simplify, accept (`--accepted`), or remove. Header and footer get no motion (`protoblocks-motion` step 1), but they still close through the check and `motion.mjs record` (no `--presets`).

### `page-qa`

1. First page only: if its header/footer sections are not yet in the template parts, run `protoblocks-section-loop` `references/header-footer.md` "Moving them into the parts" first. That re-verifies sections, so re-run `status.mjs` afterwards. To list what still needs moving:

<!-- test:run fixture=approved -->
```bash
PAGE=home
node "$PB/lib/state.mjs" get "$THEME" pages | node -e 'const a=JSON.parse(require("fs").readFileSync(0,"utf8"));const p=a.find((x)=>x.slug===process.argv[1]);for(const s of p.sections)if(["pb-header","pb-footer"].includes(s.anchor)&&s.inPart!==true)console.log(s.n,s.anchor)' "$PAGE"
```

   Empty output: nothing to move (or the page has no header/footer section).
2. Run full-page QA (Playwright, reduced motion, each design frame vs a full-page screenshot, axe on `wcag2a, wcag2aa, wcag21a, wcag21aa`):

```bash
node "$PB/qa/page-qa.mjs" run "$THEME" <page>
```

   Prints `{url, pass, breakpoints: [{name, mismatch, heightDelta, imageErrors, composite, pass}], a11y: {blocking, other}, pageErrors, warnings, file}` and exits 1 unless `pass`. The result is saved to `$THEME/.protoblocks/artifacts/<page>/page-qa/page-qa.json`. A breakpoint passes at `mismatch <= site.qa.pageMismatchMax` (0.12) and `heightDelta <= site.qa.heightDeltaMax` (0.03). Only `serious`/`critical` axe violations inside `main`, `header`, `footer` or a `#pb-s…` section block the page; `minor`/`moderate` go into the final report. `[ENOPAGE]` "has no url": the page was never built (`page.mjs build`). `[EINPUT]` "at least one design frame": intake first.
3. Fix failures:
   - Design difference: open the `composite` images, find the responsible section, fix it with `protoblocks-section-loop` (Build fix, gates, `page.mjs build`), then `qa-input.mjs prepare` for that section. Status now routes to `section-verify`; a pass returns it to `done` and page QA comes up again.
   - Blocking a11y violation: fix the block markup or colors (tokens), rebuild, re-verify every section whose markup changed.
   - `imageErrors` / `pageErrors`: broken media or console errors; fix them, rebuild.
   - `a11y.error`: axe could not run (QA deps, see Recovery).
   - Still failing only where the developer already accepted a section difference: show the composites and ask. Only the developer may change `site.qa`.
4. Record the run (every run, pass or fail):

```bash
node "$PB/qa/page-qa.mjs" record "$THEME" <page> "$THEME/.protoblocks/artifacts/<page>/page-qa/page-qa.json"
```

   Prints `{pass, status}`; writes `pageQa: {pass, file, at}`. A pass sets the page `seo`.

### `seo`

Load `protoblocks-seo` for `next.page`: `seo.mjs get`, infer, OG image, schema, `seo.mjs apply`, `seo-audit.mjs`, up to 3 fix rounds, then:

```bash
node "$PB/lib/seo.mjs" record-audit "$THEME" <page> "$THEME/.protoblocks/artifacts/<page>/seo-audit.json"
```

`apply` writes `seo.appliedValues` (and sets a `done` page back to `seo`); `record-audit` writes the audit and, on a pass, page status `done`. `[EEDITED]`, `organization: kept` and `--force-organization`: see the questions in `SKILL.md`.

### `ask-more-pages`

`why: "no pages yet"`: setup stopped before intake; intake the first design (see `setup`). No questions.

Otherwise every page is `done`:

1. For each finished page not yet in the primary menu, ask "Add <page> to the primary menu?". On yes, add `{label, page}` to the spec stored in state and upsert it:

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
