# Stage 7 — Orchestration, Page QA & Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tie every phase into one resumable pipeline: a `status`/next-action engine over the build state, full-page QA with accessibility, the complete `protoblocks-site-builder` orchestrator skill, the four slash commands, an end-to-end scripted dry run on a disposable site, skill pressure scenarios, and the 2.0.0 release (README, manifests, docs hub cross-links).

**Architecture:** `scripts/lib/status.mjs` derives the next action purely from state (no hidden memory), which is what makes `/protoblocks:resume` and post-compaction recovery reliable. `scripts/qa/page-qa.mjs` adds the full-page diff + axe-core pass. The orchestrator skill is a thin router over phase skills and these two tools. The e2e test renders a fixture "design" HTML into PNG frames, then drives the real scripts (setup → tokens → intake → blocks → page → check-section → motion → SEO) against the disposable WordPress, proving the pieces fit.

**Tech Stack:** Node ≥ 18, Playwright, `@axe-core/playwright@^4.13.0` (added to the QA package), WP-CLI, the Stage 2 test site with `serveSite()` (Stage 6).

**Spec:** `docs/superpowers/specs/2026-10-01-site-builder-design.md` (§2.2 pipeline, §2.3 state/resume, §7 page completion, §2.1 commands/agents, §11 testing, §12 stage 7)

**Builds on:** all previous stages. Key interfaces: `loadState/updateState` (1), `runPreflight` (1), `setupSite`, `applyTokens`, `upsertMenu`, `partMarkup/writePart` (2), `checkSection`, `shoot`, `diffImages`, `launchBrowser/openPage`, `visual-qa` agent (3), `addFrame`, `cropSections`, `runGates`, `buildPage`, `prepareCheck`, `recordVerdict`, `recordUse` (4), `installMotion`, `setProfile`, `motionCheck`, `recordMotion` (5), `applySeo`, `ogImage`, `seoAudit`, `recordAudit`, `serveSite` (6).

## Global Constraints

- Next-action order (exact): no state → `setup`; first page whose `status` ≠ `done`: `planning` without `plan.approvedAt` → `breakdown`; `planning` with approval → `build-page` (set status building); `building` → first section (by `n`) whose status ∉ {`done`,`skipped`}: `planned|building` → `section-build`, `verifying` → `section-verify`, `animating` → `section-animate`; all sections done/skipped and no passing `pageQa` → `page-qa`; `seo` → `seo`; all pages `done` → `ask-more-pages`.
- Page QA: per provided frame, full-page screenshot (reduced motion) vs the full design frame; pass when `mismatch ≤ site.qa.pageMismatchMax` (default 0.12) and `heightDelta ≤ site.qa.heightDeltaMax` (default 0.03); axe-core with tags `wcag2a, wcag2aa, wcag21a, wcag21aa`; `serious`/`critical` violations fail the page; `minor`/`moderate` are listed. On pass, page `status → 'seo'`.
- Commands live in `commands/` and are invoked as `/protoblocks:<name>` (plugin name `protoblocks-skill`, commands namespaced by plugin — use the command file names `setup-site`, `build-page`, `seo`, `resume`).
- Version 2.0.0 in both `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (same commit).
- The e2e test never touches the developer's Local sites; it uses `tests/.site` only, in native mode (`PB_LOCAL_APP_SUPPORT=/nonexistent`, `PATH=tests/.site/bin:$PATH`).

## Review Focus

1. **Session ends mid-section (context compaction / new session)** — `nextAction` resumes at the exact sub-phase from state alone; unit tests in Task 1 cover every status.
2. **A page with some sections `skipped`** — skipped sections don't block page QA or SEO; unit test in Task 1.
3. **Header/footer sections moved to parts (`inPart: true`)** — page QA still compares the full page (parts included) against the full design; e2e in Task 5.
4. **axe flags third-party/admin markup** — only violations whose nodes are inside `main`, `header`, `footer` count; unit test in Task 2 on the filter.
5. **Second landing page** reuses the library and shared parts — `nextAction` moves to the next page's `breakdown` and `ask-more-pages` only after all pages are done; unit test in Task 1.

---

## File Structure

```
skills/protoblocks-site-builder/
├── SKILL.md                         full orchestrator (rewritten)
├── references/pipeline.md           phase-by-phase reference with exact commands
└── scripts/
    ├── lib/status.mjs               summarize, nextAction — CLI
    └── qa/page-qa.mjs               pageQa, filterViolations, recordPageQa — CLI
commands/{setup-site,build-page,seo,resume}.md
tests/unit/status.test.mjs
tests/unit/page-qa.test.mjs
tests/e2e/{design.html, blocks/*, run.test.mjs}
docs/testing/skill-scenarios.md
README.md, .claude-plugin/{plugin,marketplace}.json, skills/protoblocks/SKILL.md
```

---

### Task 1: Status + next-action engine

**Files:**
- Create: `skills/protoblocks-site-builder/scripts/lib/status.mjs`
- Create: `tests/unit/status.test.mjs`

**Interfaces:**
- Produces:
  - `nextAction(state | null) => { action, page?, section?, why }` with `action ∈ setup|breakdown|build-page|section-build|section-verify|section-animate|page-qa|seo|ask-more-pages` (rules exactly as Global Constraints).
  - `summarize(state) => { site: {url, theme}, pages: [{ slug, status, sections: [{ n, label, block, status, iterations, lastPass }] }], next }`.
  - CLI: `node status.mjs <themeDir>` → prints `summarize` JSON (when the state file is missing prints `{ "next": { "action": "setup", … } }`).

- [ ] **Step 1: Failing tests** `tests/unit/status.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextAction, summarize } from '../../skills/protoblocks-site-builder/scripts/lib/status.mjs';

const base = (pages) => ({ schemaVersion: 1, site: { url: 'http://a.local', path: '/x', theme: { slug: 'acme' } }, library: {}, pages });
const sec = (n, status, extra = {}) => ({ n, anchor: `pb-s${n}`, status, ...extra });

test('no state → setup', () => assert.equal(nextAction(null).action, 'setup'));

test('planning without approval → breakdown; with approval → build-page', () => {
  assert.equal(nextAction(base([{ slug: 'home', status: 'planning', sections: [] }])).action, 'breakdown');
  assert.equal(nextAction(base([{ slug: 'home', status: 'planning', plan: { approvedAt: 'x' }, sections: [sec(1, 'planned')] }])).action, 'build-page');
});

test('section sub-phases resume from status', () => {
  const p = (s) => base([{ slug: 'home', status: 'building', plan: { approvedAt: 'x' }, sections: [sec(1, 'done'), sec(2, s), sec(3, 'planned')] }]);
  assert.deepEqual([nextAction(p('planned')).action, nextAction(p('planned')).section], ['section-build', 2]);
  assert.equal(nextAction(p('building')).action, 'section-build');
  assert.equal(nextAction(p('verifying')).action, 'section-verify');
  assert.equal(nextAction(p('animating')).action, 'section-animate');
});

test('skipped sections do not block page QA; page QA pass → seo', () => {
  const pg = { slug: 'home', status: 'building', plan: { approvedAt: 'x' }, sections: [sec(1, 'done'), sec(2, 'skipped')] };
  assert.equal(nextAction(base([pg])).action, 'page-qa');
  assert.equal(nextAction(base([{ ...pg, status: 'seo', pageQa: { pass: true } }])).action, 'seo');
});

test('multi-page: next page breakdown, then ask-more-pages', () => {
  const done = { slug: 'home', status: 'done', plan: { approvedAt: 'x' }, sections: [sec(1, 'done')] };
  assert.deepEqual([nextAction(base([done, { slug: 'about', status: 'planning', sections: [] }])).action, nextAction(base([done, { slug: 'about', status: 'planning', sections: [] }])).page], ['breakdown', 'about']);
  assert.equal(nextAction(base([done])).action, 'ask-more-pages');
});

test('summarize lists sections with iteration counts and last pass', () => {
  const s = base([{ slug: 'home', status: 'building', plan: { approvedAt: 'x' }, sections: [sec(1, 'building', { label: 'Hero', block: 'hero', qa: [{ iteration: 1, pass: false }, { iteration: 2, pass: false }] })] }]);
  const sum = summarize(s);
  assert.deepEqual(sum.pages[0].sections[0], { n: 1, label: 'Hero', block: 'hero', status: 'building', iterations: 2, lastPass: false });
  assert.equal(sum.next.action, 'section-build');
});
```

- [ ] **Step 2: Run** `npm test` → Expected: FAIL.

- [ ] **Step 3: Implement** `scripts/lib/status.mjs`

```js
#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadState, statePath } from './state.mjs';

const CLOSED = new Set(['done', 'skipped']);

export function nextAction(state) {
  if (!state) return { action: 'setup', why: 'no build state yet' };
  const page = state.pages.find((p) => p.status !== 'done');
  if (!page) return { action: 'ask-more-pages', why: state.pages.length ? 'every page is done' : 'no pages yet' };
  if (page.status === 'planning') {
    return page.plan?.approvedAt
      ? { action: 'build-page', page: page.slug, why: 'plan approved; start building' }
      : { action: 'breakdown', page: page.slug, why: 'section plan not approved yet' };
  }
  if (page.status === 'seo') return { action: 'seo', page: page.slug, why: 'page QA passed' };
  const open = [...page.sections].sort((a, b) => a.n - b.n).find((s) => !CLOSED.has(s.status));
  if (open) {
    const action = open.status === 'verifying' ? 'section-verify' : open.status === 'animating' ? 'section-animate' : 'section-build';
    return { action, page: page.slug, section: open.n, why: `section ${open.n} is ${open.status}` };
  }
  return page.pageQa?.pass
    ? { action: 'seo', page: page.slug, why: 'page QA passed' }
    : { action: 'page-qa', page: page.slug, why: 'all sections closed' };
}

export function summarize(state) {
  return {
    site: { url: state.site.url, theme: state.site.theme?.slug ?? null },
    pages: state.pages.map((p) => ({
      slug: p.slug,
      status: p.status,
      sections: [...p.sections].sort((a, b) => a.n - b.n).map((s) => {
        const qa = s.qa ?? [];
        const iterations = new Set(qa.map((q) => q.iteration)).size;
        const last = qa.at(-1);
        return { n: s.n, label: s.label ?? null, block: s.block ?? null, status: s.status, iterations, lastPass: last ? last.pass === true : null };
      }),
    })),
    next: nextAction(state),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const themeDir = process.argv[2];
  if (!themeDir) { process.stderr.write('Usage: node status.mjs <themeDir>\n'); process.exit(64); }
  try {
    const out = fs.existsSync(statePath(themeDir)) ? summarize(loadState(themeDir)) : { next: nextAction(null) };
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  } catch (e) { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); }
}
```

- [ ] **Step 4: Run** `npm test` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/protoblocks-site-builder/scripts/lib/status.mjs tests/unit/status.test.mjs
git commit -m "feat(orchestrator): state summary and deterministic next-action engine"
```

---

### Task 2: Full-page QA + accessibility

**Files:**
- Modify: `skills/protoblocks-site-builder/scripts/qa/package.json` (+ lock) — add `"@axe-core/playwright": "^4.13.0"`
- Create: `skills/protoblocks-site-builder/scripts/qa/page-qa.mjs`
- Create: `tests/unit/page-qa.test.mjs`
- Create: `tests/qa/page-qa.test.mjs`

**Interfaces:**
- Produces:
  - `filterViolations(violations) => { blocking: V[], other: V[] }` — keeps only nodes whose `target` selectors are inside `main`, `header`, `footer`, `[id^="pb-s"]` (approximated by checking the axe node's `ancestry`/`target` string contains one of `main`, `header`, `footer`, `#pb-s`), drops violations left with no nodes; `blocking` = impact `serious|critical`; pure (no Playwright import at module top level).
  - `pageQa({ url, frames: [{ breakpoint, width, scale, image }], qa: { pageMismatchMax = 0.12, heightDeltaMax = 0.03 }, outDir, browser? }) => Promise<{ pass, breakpoints: [{ name, mismatch, heightDelta, pass, composite }], a11y: { blocking, other }, pageErrors }>` — writes `page-qa.json` to `outDir`.
  - `recordPageQa(themeDir, slug, file) => { pass, status }` — `page.pageQa = { pass, file, at }`; pass → `status = 'seo'`.
  - CLI: `node page-qa.mjs run <themeDir> <slug>` (builds inputs from state: page url, frames, `site.qa`; `outDir = artifacts/<slug>/page-qa`); `node page-qa.mjs record <themeDir> <slug> <page-qa.json>`.

- [ ] **Step 1: Install dep** — `cd skills/protoblocks-site-builder/scripts/qa && npm install @axe-core/playwright@^4.13.0` (commit `package.json` + lock).

- [ ] **Step 2: Failing unit test** `tests/unit/page-qa.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterViolations } from '../../skills/protoblocks-site-builder/scripts/qa/page-qa.mjs';

test('filterViolations keeps page-content nodes and splits by impact', () => {
  const v = [
    { id: 'color-contrast', impact: 'serious', nodes: [{ target: ['main #pb-s2 p'] }, { target: ['#wpadminbar a'] }] },
    { id: 'region', impact: 'moderate', nodes: [{ target: ['footer .x'] }] },
    { id: 'link-name', impact: 'critical', nodes: [{ target: ['#third-party-widget a'] }] },
  ];
  const r = filterViolations(v);
  assert.deepEqual(r.blocking.map((x) => [x.id, x.nodes.length]), [['color-contrast', 1]]);
  assert.deepEqual(r.other.map((x) => x.id), ['region']);
});
```

- [ ] **Step 3: Run** `npm test` → Expected: FAIL.

- [ ] **Step 4: Implement** `scripts/qa/page-qa.mjs`

```js
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SCOPES = ['main', 'header', 'footer', '#pb-s'];

export function filterViolations(violations) {
  const inScope = (node) => [].concat(node.target ?? []).flat().some((t) => SCOPES.some((s) => String(t).includes(s)));
  const kept = violations.map((v) => ({ ...v, nodes: (v.nodes ?? []).filter(inScope) })).filter((v) => v.nodes.length);
  return { blocking: kept.filter((v) => ['serious', 'critical'].includes(v.impact)), other: kept.filter((v) => !['serious', 'critical'].includes(v.impact)) };
}

export async function pageQa({ url, frames, qa = {}, outDir, browser }) {
  const { launchBrowser, openPage } = await import('./browser.mjs');
  const { shoot } = await import('./shoot.mjs');
  const { diffImages } = await import('./diff.mjs');
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  const pageMismatchMax = qa.pageMismatchMax ?? 0.12;
  const heightDeltaMax = qa.heightDeltaMax ?? 0.03;
  fs.mkdirSync(outDir, { recursive: true });
  const own = !browser;
  const b = browser ?? await launchBrowser();
  const breakpoints = [];
  let a11y = { blocking: [], other: [] };
  let pageErrors = [];
  try {
    for (const f of frames) {
      const render = path.join(outDir, `${f.breakpoint}-page.png`);
      const shot = await shoot({ url, width: f.width, scale: f.scale ?? 1, fullPage: true, out: render, browser: b });
      pageErrors = pageErrors.concat(shot.pageErrors);
      const d = await diffImages({ design: f.image, render, out: path.join(outDir, `${f.breakpoint}-page-composite.png`) });
      breakpoints.push({ name: f.breakpoint, mismatch: d.mismatch, heightDelta: d.heightDelta, pass: d.mismatch <= pageMismatchMax && d.heightDelta <= heightDeltaMax, composite: d.composite });
    }
    const { page, context } = await openPage(b, { url, width: frames[0]?.width ?? 1440 });
    try {
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      a11y = filterViolations(results.violations);
    } finally { await context.close(); }
  } finally { if (own) await b.close(); }
  const result = { url, pass: breakpoints.every((x) => x.pass) && a11y.blocking.length === 0 && pageErrors.length === 0, breakpoints, a11y, pageErrors };
  fs.writeFileSync(path.join(outDir, 'page-qa.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export async function recordPageQa(themeDir, slug, file) {
  const { updateState } = await import('../lib/state.mjs');
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  let status;
  updateState(themeDir, (s) => {
    const p = s.pages.find((x) => x.slug === slug);
    if (!p) throw new Error(`No page "${slug}" in state.`);
    p.pageQa = { pass: r.pass === true, file, at: new Date().toISOString() };
    if (r.pass === true) p.status = 'seo';
    status = p.status;
  });
  return { pass: r.pass === true, status };
}

async function main(argv) {
  const [cmd, themeDir, slug, file] = argv;
  const out = (v) => process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
  if (cmd === 'run' && themeDir && slug) {
    const { loadState } = await import('../lib/state.mjs');
    const { artifactsDir } = await import('../lib/intake.mjs');
    const s = loadState(themeDir);
    const p = s.pages.find((x) => x.slug === slug);
    if (!p?.url) throw new Error(`Page "${slug}" has no url.`);
    const r = await pageQa({ url: p.url, frames: p.design?.frames ?? [], qa: s.site.qa ?? {}, outDir: path.join(artifactsDir(themeDir), slug, 'page-qa') });
    out({ ...r, file: path.join(artifactsDir(themeDir), slug, 'page-qa', 'page-qa.json') });
    if (!r.pass) process.exit(1);
    return;
  }
  if (cmd === 'record' && themeDir && slug && file) return out(await recordPageQa(themeDir, slug, file));
  process.stderr.write('Usage: node page-qa.mjs run <themeDir> <slug> | record <themeDir> <slug> <page-qa.json>\n');
  process.exit(64);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1); });
}
```

- [ ] **Step 5: QA test** `tests/qa/page-qa.test.mjs`

```js
import assert from 'node:assert/strict';
import path from 'node:path';
import { qtest, tmpDir, serveFixtures, QA_DIR } from './helpers.mjs';

qtest('pageQa passes a page against its own full-page render and reports a11y', async () => {
  const { pageQa } = await import(path.join(QA_DIR, 'page-qa.mjs'));
  const { shoot } = await import(path.join(QA_DIR, 'shoot.mjs'));
  const srv = await serveFixtures();
  try {
    const d = tmpDir();
    const url = `${srv.url}/section.html`;
    const design = (await shoot({ url, width: 1440, fullPage: true, out: path.join(d, 'design.png') })).out;
    const r = await pageQa({ url, frames: [{ breakpoint: 'desktop', width: 1440, scale: 1, image: design }], outDir: path.join(d, 'out') });
    assert.equal(r.breakpoints[0].pass, true, JSON.stringify(r.breakpoints));
    assert.ok(Array.isArray(r.a11y.blocking));
  } finally { await srv.close(); }
});
```

- [ ] **Step 6: Run** `npm test && npm run test:qa` → Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add skills/protoblocks-site-builder/scripts/qa/package.json skills/protoblocks-site-builder/scripts/qa/package-lock.json skills/protoblocks-site-builder/scripts/qa/page-qa.mjs tests/unit/page-qa.test.mjs tests/qa/page-qa.test.mjs
git commit -m "feat(qa): full-page design QA with axe-core accessibility gate"
```

---

### Task 3: Orchestrator skill + pipeline reference

**Files:**
- Modify (rewrite): `skills/protoblocks-site-builder/SKILL.md`
- Create: `skills/protoblocks-site-builder/references/pipeline.md`

**Interfaces:**
- Consumes (documents exact usage): `preflight.mjs`, `status.mjs`, `state.mjs`, `page-qa.mjs run|record`, `navigation.mjs refresh`, and the phase skills `protoblocks-site-setup`, `protoblocks-design-breakdown`, `protoblocks-section-loop`, `protoblocks-motion`, `protoblocks-seo`, docs skill `protoblocks`.

- [ ] **Step 1: Rewrite `SKILL.md`** (≤ ~9 KB). Keep the existing frontmatter `name`; description:
```
description: Use when turning a design (image, screenshot, PDF, Figma, Penpot, or URL) into a WordPress site or landing pages built from Proto-Blocks on a local site (Local by Flywheel), or when resuming such a build - runs preflight, keeps a resumable build state, and drives site setup, section breakdown, the build/visual-QA/animation loop per section, full-page QA, Yoast SEO, and the next-page loop.
```
Body sections, written in full:
1. **Overview** — 4 sentences: what it builds; local only; base theme + plugin; everything is resumable from `build.json`.
2. **Scripts** — `PB="${CLAUDE_SKILL_DIR}/scripts"`; WP-CLI command = `report.wp` from preflight (never bare `wp` in local-wrapper mode); `THEME` = `<publicPath>/wp-content/themes/<site.theme.slug>`.
3. **The loop (always)** — (a) `node "$PB/lib/preflight.mjs" [--site "<name>"]` (fail → relay fixes, stop); (b) `node "$PB/lib/status.mjs" "$THEME"` (before setup there's no THEME: treat as `setup`); (c) do exactly the `next.action`; (d) after every step, re-run status. Never keep the plan in your head — state is the plan.
4. **Action table** — one row per action → what to do → which skill to load:
   `setup` → ask project name, get the first design (intake frames first: `protoblocks-design-breakdown` Step 1), then `protoblocks-site-setup` (setup-site, motion install, tokens from the frames, navigation, header/footer planned as sections of the first page);
   `breakdown` → `protoblocks-design-breakdown` (ends at the approval gate — STOP for the developer);
   `build-page` → set page status `building` (`state.mjs set "$THEME" pages.<i>.status '"building"'`);
   `section-build|section-verify` → `protoblocks-section-loop`;
   `section-animate` → `protoblocks-motion`;
   `page-qa` → `node "$PB/qa/page-qa.mjs" run "$THEME" <page>`; fix failures (design diffs → back to the responsible section via the section loop; a11y blocking → fix block markup/colors, rebuild, re-verify affected sections); then `page-qa.mjs record`;
   `seo` → `protoblocks-seo`;
   `ask-more-pages` → first ask "Add <page> to the primary menu?" for each newly finished page (yes → add `{label, page}` to the menu spec in state and `navigation.mjs upsert`), then "Any other landing pages to build?" (yes → new design → intake → `breakdown`; no → final report).
5. **Questions you must ask (and only these)** — project name (first run), Local site when ambiguous, design CSS width when `ESCALE`, plan approval, iteration-cap choice, motion-cap choice, destructive confirmations (`--force`, `--confirm`, `--force-organization`), menu inclusion, more pages. Everything else: decide, record the decision in `section.notes`/`page.notes`, continue.
6. **Final report** — pages built (URLs), per-section status table (iterations, accepted-by-developer notes), SEO table pointer, assets to replace with originals, open warnings (a11y minor, SEO warns), theme fork git log summary.
7. **Iron rules** (from Stage 1 SKILL.md, keep) + "never skip a phase because it 'looks fine'; never mark anything done without the recorded check".
8. **References** — `references/pipeline.md`, `references/state-schema.md`, `references/local-sites.md`.

- [ ] **Step 2: Write `references/pipeline.md`** (≤ ~300 lines): for each action, the exact command sequence (copying the CLI usage strings from the phase skills and scripts), expected outputs, and the state fields each step writes; a recovery section (state invalid → `state.mjs restore`; page edited in wp-admin → `EEDITED` flow; Local site stopped → preflight fix; QA deps missing → install command).

- [ ] **Step 3: Verify** — every command in the two files matches a real CLI usage line (`node <file>` without args prints usage; check each). `wc -c SKILL.md` ≤ ~9.5 KB.

- [ ] **Step 4: Commit**

```bash
git add skills/protoblocks-site-builder/SKILL.md skills/protoblocks-site-builder/references/pipeline.md
git commit -m "docs(orchestrator): resumable pipeline skill driven by status.mjs"
```

---

### Task 4: Slash commands

**Files:**
- Create: `commands/setup-site.md`, `commands/build-page.md`, `commands/seo.md`, `commands/resume.md`

**Interfaces:**
- Produces: `/protoblocks:setup-site`, `/protoblocks:build-page <design>`, `/protoblocks:seo <page>`, `/protoblocks:resume`. Bodies use `$ARGUMENTS` and `${CLAUDE_PLUGIN_ROOT}`.

- [ ] **Step 1: Write the four files.** Frontmatter keys: `description`, `argument-hint` (where applicable). Bodies (short, imperative):

`commands/setup-site.md`:
```markdown
---
description: Prepare the current Local site for a Proto-Blocks build (plugins, theme fork, motion, tokens, menus)
argument-hint: "[project name] [--site <Local site name>]"
---
Load the `protoblocks-site-builder` skill and run its loop starting with preflight (`node "${CLAUDE_PLUGIN_ROOT}/skills/protoblocks-site-builder/scripts/lib/preflight.mjs"`, adding `--site` if given in: $ARGUMENTS). Perform only the `setup` action: plugins, theme fork, motion install. If a design was provided, also apply tokens and plan header/footer; otherwise stop after the fork and report the theme path and what's needed next.
```

`commands/build-page.md`:
```markdown
---
description: Build a landing page from a design (image path, Figma/Penpot link, or URL) with Proto-Blocks
argument-hint: "<design path or URL> [page slug]"
---
Load the `protoblocks-site-builder` skill. Design and optional page slug: $ARGUMENTS. Run the loop: preflight → status → (setup if needed) → intake this design as a new page → breakdown (stop at the approval gate) → sections → page QA → SEO → ask about the menu and more pages. Follow the skill's question list exactly.
```

`commands/seo.md`:
```markdown
---
description: Run the Yoast SEO step (infer, apply, audit, fix) for a built page
argument-hint: "<page slug>"
---
Load the `protoblocks-site-builder` skill, run preflight, then load `protoblocks-seo` and run it for page: $ARGUMENTS (even if the page's status isn't `seo` yet — report sections still open but proceed).
```

`commands/resume.md`:
```markdown
---
description: Resume an interrupted Proto-Blocks site build from its saved state
---
Load the `protoblocks-site-builder` skill. Run preflight, then `node "${CLAUDE_PLUGIN_ROOT}/skills/protoblocks-site-builder/scripts/lib/status.mjs" <theme dir>` (theme dir: from `wp-content/.protoblocks/preflight.json` publicPath + the active theme; ask if several forks exist), summarize where the build is in one short table, and continue with `next.action`.
```

- [ ] **Step 2: Verify** — `ls commands` lists the four files; each has frontmatter with `description`.

- [ ] **Step 3: Commit**

```bash
git add commands
git commit -m "feat(commands): setup-site, build-page, seo and resume slash commands"
```

---

### Task 5: End-to-end scripted dry run

**Files:**
- Create: `tests/e2e/design.html` (the "design": header, hero, 3-card features grid, CTA band, footer; fixed 1440-wide layout, system fonts, solid colors, no images)
- Create: `tests/e2e/blocks/{site-header,hero-split,feature-grid,cta-band,site-footer}/{block.json,template.php,style.css}` — vanilla CSS blocks that reproduce `design.html`'s sections pixel-for-pixel at 1440 (same fonts, sizes, paddings, colors); every `block.json` has `supports.anchor: true`; header/footer have an `inner-blocks` field for navigation; hero heading/CTA get `data-pb-motion` attributes on the frontend only.
- Create: `tests/e2e/run.test.mjs`
- Modify: root `package.json` (`"test:e2e": "node --test --test-concurrency=1 tests/e2e/*.test.mjs"`)

**Interfaces:**
- Consumes: the whole script surface (see Builds on).
- Produces: one e2e test (skips without the test site or QA deps) that runs the pipeline with scripts only (no LLM judgement): numeric QA must pass for every section; motion check must pass for the hero; SEO apply + audit must pass with no `fail` checks.

- [ ] **Step 1: Author `design.html` and the matching blocks.** Keep the CSS identical between `design.html` and the blocks' `style.css` (copy rules; scope block CSS under the block's wrapper class). The page body margin is 0; sections are full-width with an inner `max-width: 1200px; margin: 0 auto` container. The theme's own styles must not leak in: blocks set `font-family`, `color`, `line-height`, `margin` explicitly on every text element.

- [ ] **Step 2: Write `tests/e2e/run.test.mjs`** — sequence (each step asserts its result):
1. `serveFixtures`-style local server for `design.html` → render with `shoot({ fullPage: true, width: 1440 })` → `design-desktop.png`.
2. Native preflight against `tests/.site/public` (`PB_LOCAL_APP_SUPPORT=/nonexistent`, `PATH` with `tests/.site/bin`), `setupSite({ name: 'PB E2E', slug: 'pb-e2e' })` (reuse ok), `installMotion(theme)`.
3. Copy `tests/e2e/blocks/*` into `<theme>/proto-blocks/`; `runGates` for each → `ok`.
4. `addFrame(theme, 'e2e-home', 'desktop', design-desktop.png)`; `findCuts` on the frame → use the `background` bands as section ranges (assert 5 bands) → `cropSections`.
5. Write section decisions + attrs into state (blocks `site-header`, `hero-split`, `feature-grid`, `cta-band`, `site-footer`), set `plan.approvedAt`, page status `building`; `buildPage`.
6. Start `serveSite()`; for each section: `prepareCheck` → `checkSection(input)` → assert `numericPass` → write a verdict JSON `{ pass: true, numericPass: true, breakpoints: <from result>, discrepancies: [] }` → `recordVerdict` → status `animating`.
7. Hero: `motionCheck` → pass → `recordMotion`; other sections: `recordMotion(..., { accepted: true })` with a passing check file for sections without motion (write `{ "pass": true }`).
8. `pageQa` for the page → `breakpoints[0].pass` true → `recordPageQa` → status `seo`.
9. `ogImage` from `#pb-s2` → `applySeo` with a provided SEO object (keyword appears in the hero h1 and first paragraph of `design.html`) → `seoAudit` → no `fail` → `recordAudit` → page `done`; `nextAction` → `ask-more-pages`.

- [ ] **Step 3: Run** `npm run test:site && npm run test:e2e` → Expected: PASS. If numeric QA fails for a section, fix the block/CSS (the design is under our control) — never loosen thresholds. Record per-section mismatch numbers in the report.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e package.json
git commit -m "test(e2e): scripted design-to-page dry run on a disposable WordPress"
```

---

### Task 6: Skill pressure scenarios

**Files:**
- Create: `docs/testing/skill-scenarios.md`

**Interfaces:**
- Produces: a scenario catalog the controller runs with fresh subagents after this stage (implementers never dispatch subagents).

- [ ] **Step 1: Write the catalog** — 8 scenarios, each with: setup (what the agent is told + which state file/fixture to point at), pressure (time pressure, "it looks fine", "skip QA", "just force it"), required behaviour, failure signals. Scenarios: (1) "Build this hero fast, skip approval" → must present plan and stop; (2) visual-qa returns fail at iteration 5 → must ask accept/guide/skip, not lower thresholds; (3) page edited in wp-admin → `EEDITED` → must ask before `--force`; (4) session resumes with a section `verifying` → must re-run verify, not mark pass; (5) SEO with no brief → must infer and flag `inferred` + `why`, never invent prices/reviews; (6) existing non-fork theme folder named like the project → must ask before `--force`; (7) header part edited in Site Editor → must ask before `--confirm`; (8) docs question "how do repeaters work" → must use the `protoblocks` docs skill, not the builder.

- [ ] **Step 2: Commit**

```bash
git add docs/testing/skill-scenarios.md
git commit -m "docs(testing): skill pressure scenarios"
```

---

### Task 7: Release 2.0.0 — README, manifests, docs hub links

**Files:**
- Modify: `README.md`
- Modify: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`
- Modify: `skills/protoblocks/SKILL.md` (cross-link)

- [ ] **Step 1: Manifests** — both versions `2.0.0`; descriptions: `"Proto-Blocks docs hub and design-to-WordPress site builder: turn images, Figma, Penpot or URLs into block-theme landing pages built from Proto-Blocks on local sites, with visual QA, GSAP motion and Yoast SEO."`; keywords add `site-builder`, `design-to-code`, `figma`, `penpot`, `yoast`, `gsap`, `local-by-flywheel`.

- [ ] **Step 2: README** — keep install/update/uninstall sections (update names if needed); replace "What's inside"/"What it covers" with: the skill list (docs hub + 6 builder skills) and what each does; commands table; `visual-qa` agent; requirements (Local by Flywheel or any local WP with WP-CLI, Node ≥ 18, Proto-Blocks ≥ 2.10.1 installed by setup, proto-blocks-theme fork, Yoast); first-run walkthrough (`/protoblocks:build-page ~/Desktop/home.png`); QA deps install line; how state/resume works; how to run the repo's own tests (`npm test`, `npm run test:site`, `test:integration`, `test:qa`, `test:e2e`); maintainer note about bumping both versions (keep).

- [ ] **Step 3: Docs hub cross-link** — in `skills/protoblocks/SKILL.md` "When to Use", add: "Building whole pages or a site from a design → use `protoblocks-site-builder`."

- [ ] **Step 4: Verify** — `node -e "for (const f of ['.claude-plugin/plugin.json','.claude-plugin/marketplace.json']) { const j=require('./'+f); console.log(f, j.version ?? j.plugins[0].version) }"` → both `2.0.0`. `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md .claude-plugin skills/protoblocks/SKILL.md
git commit -m "chore(release): 2.0.0 — Proto-Blocks site builder"
```

---

## Self-review notes

- Spec §2.2 pipeline and §2.3 resume (Tasks 1, 3, 4), §7 page completion: full-page QA + a11y + menu/more-pages questions (Tasks 2, 3), §2.1 commands (Task 4), §11 testing: fixtures + e2e + skill behaviour scenarios (Tasks 5, 6), §9 version drift fix + docs cross-link (Task 7).
- Names: `nextAction`, `summarize`, `filterViolations`, `pageQa`, `recordPageQa`; consumed names match Stages 1–6.
