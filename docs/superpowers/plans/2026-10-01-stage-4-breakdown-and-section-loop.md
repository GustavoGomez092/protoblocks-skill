# Stage 4 — Intake, Breakdown & Section Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The machinery and the two skills that take a design to verified sections on a real page: design intake into normalized frames + section crops, a block-library manifest, block build gates (validate → cache → Tailwind → PHP render smoke), media import with dedupe, idempotent page assembly with an edit guard, QA input/verdict plumbing with an integrity check, regression re-shoots, and the `protoblocks-design-breakdown` and `protoblocks-section-loop` skills.

**Architecture:** Node CLIs in `scripts/lib/` (`intake`, `library`, `gates`, `media`, `page`, `qa-input`, `regress`) over the Stage 2 WP runner and Stage 3 QA package; WordPress-side work in `scripts/wp/{render-block,media,page}.php`. All state goes through `state.mjs`. Skills hold the judgement (how to break a design down, how to fix a failing section); scripts hold everything that must be exact.

**Tech Stack:** Node ≥ 18, WP-CLI `eval-file`, Stage 3 QA package (Playwright, sharp, pixelmatch).

**Spec:** `docs/superpowers/specs/2026-10-01-site-builder-design.md` (§5 intake/assets/breakdown/plan gate, §6.1 build, §6.2 verify loop + regressions, §4 step 6 header/footer through the loop, §10 errors)

**Builds on:**
- Stage 1: `state.mjs` (`loadState`, `updateState(themeDir, fn, {timeoutMs}?)`, `getPath`, `setPath`, `appendPath`, `statePath`, `DEFAULT_QA`), `exec.mjs`.
- Stage 2: `wp.mjs` (`createWp`, `loadRuntime`, `WP_SCRIPTS_DIR`, `WpError`), `tests/integration/helpers.mjs` (`itest`, `testWp`, `PUBLIC`), `navigation.mjs` (`refreshMenus`), `blocks.mjs` (`serializeAttrs`, `blockComment`), test theme fork `pb-itest` active on `tests/.site`.
- Stage 3: `scripts/qa/` (`shoot`, `diffImages`, `cropRanges`, `findCuts`, `checkSection`), `agents/visual-qa.md` (writes `<iterDir>/verdict.json`), `tests/qa/helpers.mjs`.

## Global Constraints

- Artifacts root: `<theme>/.protoblocks/artifacts/`. Design frames `artifacts/<page>/design/<breakpoint>.png`; crops `artifacts/<page>/crops/<breakpoint>/pb-s<n>.png`; QA iterations `artifacts/<page>/pb-s<n>/iter-<k>/`; baselines `artifacts/baselines/<page>/pb-s<n>-<breakpoint>.png`.
- Breakpoint CSS width ranges for scale inference: desktop 1200–1920, tablet 700–1100, mobile 320–480; scales tried 1, 2, 3; no fit → the caller must pass `--width`.
- Standard sanity widths for breakpoints without a design frame: desktop 1440, tablet 834, mobile 390.
- Every section block is rendered with `anchor: "pb-s<n>"`; blocks must declare `"supports": { "anchor": true }` (gate-enforced).
- Pages are written with `post_status: publish`, `post_type: page`, meta `_pb_built = 1`. A page whose stored content hash differs from `state.pages[i].contentHash` (edited in wp-admin) is not overwritten without `--force`. A pre-existing page with the same slug that the builder didn't create (`_pb_built` missing) is not overwritten without `--force`.
- Media import dedupes by SHA-1 of the file, stored as attachment meta `_pb_source_hash`; alt text always set.
- Write scripts set the current user to the first administrator and call `kses_remove_filters()`.
- Render smoke: a block passes when the editor preview REST call returns 200, the frontend render is non-empty and contains `id="pb-gate"`, and no PHP error/warning/notice/deprecation originates from a file inside the block's folder. Errors from other files are reported as `other` and don't fail the gate.
- QA pass rule (verbatim from Stage 3): `mismatch ≤ mismatchMax` AND `heightDelta ≤ heightDeltaMax` AND no `high` discrepancies; `pass` can never be true when `numericPass` is false. `recordVerdict` re-checks this and rejects an inconsistent verdict (`EVERDICT`).
- After a section passes: `status → 'animating'` (Stage 5 consumes it). After `maxIterations` failed iterations: `recordVerdict` returns `capReached: true`; the skill asks the developer (accept / guide / skip).
- Regression thresholds vs baselines: `mismatch ≤ 0.01` and `heightDelta ≤ 0.005`.
- The plan-approval gate is mandatory: no block is built before the developer approves the section plan.

## Review Focus

1. **Developer edited the page in wp-admin between runs** — `page.mjs build` refuses (`EEDITED`) and names the fix (`--force` after asking); integration test in Task 4.
2. **Slug already used by a hand-made page** — refuse without `--force`; integration test in Task 4.
3. **Same image imported twice (re-runs, shared logo)** — one attachment reused; integration test in Task 3.
4. **A forged/inconsistent verdict (pass with failing numbers or a high discrepancy)** — `recordVerdict` throws `EVERDICT`; unit test in Task 6.
5. **Retina/odd-width design exports** — scale inferred from width per breakpoint range, unresolvable widths require `--width`; unit test in Task 1.

---

## File Structure

```
skills/protoblocks-site-builder/scripts/
├── lib/
│   ├── intake.mjs      inferScale, addFrame, cropSections, framesFromUrl — CLI
│   ├── library.mjs     readBlockJson, summarizeBlock, listLibrary, recordUse — CLI
│   ├── gates.mjs       runGates — CLI
│   ├── media.mjs       importMedia, imageAttr — CLI
│   ├── page.mjs        pageSpecFromState, buildPage — CLI
│   ├── qa-input.mjs    STANDARD_WIDTHS, buildCheckInput, prepareCheck, recordVerdict — CLI
│   └── regress.mjs     regress — CLI
└── wp/
    ├── render-block.php
    ├── media.php
    └── page.php
skills/protoblocks-design-breakdown/{SKILL.md, references/intake.md, references/breakdown.md}
skills/protoblocks-section-loop/{SKILL.md, references/build.md, references/verify.md, references/header-footer.md}
tests/unit/{intake,library,page-spec,qa-input}.test.mjs
tests/integration/{gates,media,page,library}.test.mjs
tests/qa/regress.test.mjs
```

---

### Task 1: Design intake (frames + crops)

**Files:**
- Create: `skills/protoblocks-site-builder/scripts/lib/intake.mjs`
- Create: `tests/unit/intake.test.mjs`

**Interfaces:**
- Consumes: `loadState`, `updateState`, `stateDir` (Stage 1 — `stateDir(themeDir)` is exported by `state.mjs`); `cropRanges` (Stage 3, dynamic import of `../qa/segment.mjs`); `shoot` (Stage 3, dynamic import, only for `framesFromUrl`).
- Produces:
  - `BREAKPOINT_RANGES = { desktop: [1200, 1920], tablet: [700, 1100], mobile: [320, 480] }`
  - `inferScale(pixelWidth, breakpoint) => { cssWidth, scale } | null`
  - `imageWidth(file) => number` — reads the PNG IHDR width (bytes 16–19) or JPEG SOF; throws `EIMAGE` for other formats (callers convert to PNG first).
  - `ensurePage(state, slug, title?) => page` (mutates state: creates `{slug, title, status:'planning', postId:null, contentHash:null, design:{frames:[]}, sections:[]}` if absent)
  - `addFrame(themeDir, slug, breakpoint, image, { width } = {}) => frame` where `frame = { breakpoint, width: cssWidth, scale, image: <artifact path>, pixelWidth }`; replaces any existing frame for that breakpoint. Throws `Error` code `ESCALE` when scale can't be inferred and no `width` given.
  - `cropSections(themeDir, slug, ranges) => Promise<{n, breakpoint, file}[]>` — `ranges = { desktop: [{n, y0, y1}], mobile: [...] }` in **image pixels**; creates missing sections (`{n, anchor: 'pb-s<n>', status: 'planned', crops: {}}`) and sets `crops[breakpoint]`.
  - `framesFromUrl(themeDir, slug, url, widths: number[]) => Promise<frame[]>` (desktop for ≥1200, tablet 700–1100, mobile ≤480; scale 1).
  - CLI: `node intake.mjs add-frame <themeDir> <slug> <breakpoint> <image> [--width W] [--title T]`; `node intake.mjs crop <themeDir> <slug> <ranges.json>`; `node intake.mjs from-url <themeDir> <slug> <url> --widths 1440,390`.

- [ ] **Step 1: Failing tests** `tests/unit/intake.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { inferScale, imageWidth, addFrame, ensurePage } from '../../skills/protoblocks-site-builder/scripts/lib/intake.mjs';
import { initState, loadState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';

function png(width, height, file) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  return file;
}

test('inferScale handles 1x, @2x desktop, @3x mobile and rejects odd widths', () => {
  assert.deepEqual(inferScale(1440, 'desktop'), { cssWidth: 1440, scale: 1 });
  assert.deepEqual(inferScale(2880, 'desktop'), { cssWidth: 1440, scale: 2 });
  assert.deepEqual(inferScale(1170, 'mobile'), { cssWidth: 390, scale: 3 });
  assert.deepEqual(inferScale(750, 'mobile'), { cssWidth: 375, scale: 2 });
  assert.deepEqual(inferScale(1668, 'tablet'), { cssWidth: 834, scale: 2 });
  assert.equal(inferScale(5000, 'desktop'), null);
  assert.equal(inferScale(1001, 'mobile'), null);
});

test('imageWidth reads PNG headers', () => {
  const f = png(37, 5, path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pb-in-')), 'a.png'));
  assert.equal(imageWidth(f), 37);
});

test('addFrame copies the image into artifacts and records scale; ESCALE without width', () => {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-in-'));
  initState(theme, { url: 'http://a.local', path: '/x' });
  const src = png(2880, 10, path.join(theme, 'home@2x.png'));
  const f = addFrame(theme, 'home', 'desktop', src, { title: 'Home' });
  assert.equal(f.width, 1440);
  assert.equal(f.scale, 2);
  assert.ok(f.image.endsWith(path.join('artifacts', 'home', 'design', 'desktop.png')));
  assert.ok(fs.existsSync(f.image));
  const st = loadState(theme);
  assert.equal(st.pages[0].slug, 'home');
  assert.equal(st.pages[0].title, 'Home');
  assert.equal(st.pages[0].design.frames.length, 1);
  addFrame(theme, 'home', 'desktop', src);
  assert.equal(loadState(theme).pages[0].design.frames.length, 1, 'replaced, not duplicated');
  const odd = png(1000, 10, path.join(theme, 'odd.png'));
  assert.throws(() => addFrame(theme, 'home', 'desktop', odd), (e) => e.code === 'ESCALE');
  assert.equal(addFrame(theme, 'home', 'desktop', odd, { width: 1000 }).scale, 1);
});

test('ensurePage creates a planning page once', () => {
  const s = { pages: [] };
  ensurePage(s, 'about', 'About');
  ensurePage(s, 'about');
  assert.equal(s.pages.length, 1);
  assert.equal(s.pages[0].status, 'planning');
});
```

- [ ] **Step 2: Run** `npm test` → Expected: FAIL.

- [ ] **Step 3: Implement** `scripts/lib/intake.mjs`

```js
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadState, updateState, stateDir } from './state.mjs';

export const BREAKPOINT_RANGES = { desktop: [1200, 1920], tablet: [700, 1100], mobile: [320, 480] };

export function inferScale(pixelWidth, breakpoint) {
  const range = BREAKPOINT_RANGES[breakpoint];
  if (!range) return null;
  for (const scale of [1, 2, 3]) {
    const css = pixelWidth / scale;
    if (Number.isInteger(css) && css >= range[0] && css <= range[1]) return { cssWidth: css, scale };
  }
  return null;
}

export function imageWidth(file) {
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return buf.readUInt32BE(16);
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return buf.readUInt16BE(i + 7);
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  const e = new Error(`Unsupported image format (convert to PNG): ${file}`);
  e.code = 'EIMAGE';
  throw e;
}

export const artifactsDir = (themeDir) => path.join(stateDir(themeDir), 'artifacts');

export function ensurePage(state, slug, title) {
  let page = state.pages.find((p) => p.slug === slug);
  if (!page) {
    page = { slug, title: title ?? slug, status: 'planning', postId: null, contentHash: null, design: { frames: [] }, sections: [] };
    state.pages.push(page);
  } else if (title) {
    page.title = title;
  }
  page.design ??= { frames: [] };
  page.design.frames ??= [];
  return page;
}

export function addFrame(themeDir, slug, breakpoint, image, { width, title } = {}) {
  const pixelWidth = imageWidth(image);
  let fit = width ? { cssWidth: Number(width), scale: pixelWidth / Number(width) } : inferScale(pixelWidth, breakpoint);
  if (!fit) {
    const e = new Error(`Can't infer the design width of a ${pixelWidth}px ${breakpoint} export. Ask the developer for the frame's CSS width and pass --width.`);
    e.code = 'ESCALE';
    throw e;
  }
  const dest = path.join(artifactsDir(themeDir), slug, 'design', `${breakpoint}${path.extname(image).toLowerCase() || '.png'}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (path.resolve(image) !== path.resolve(dest)) fs.copyFileSync(image, dest);
  const frame = { breakpoint, width: fit.cssWidth, scale: fit.scale, image: dest, pixelWidth };
  updateState(themeDir, (s) => {
    const page = ensurePage(s, slug, title);
    page.design.frames = page.design.frames.filter((f) => f.breakpoint !== breakpoint).concat(frame);
  });
  return frame;
}

export async function cropSections(themeDir, slug, ranges) {
  const { cropRanges } = await import('../qa/segment.mjs');
  const state = loadState(themeDir);
  const page = state.pages.find((p) => p.slug === slug);
  if (!page) throw new Error(`No page "${slug}" in state; add a frame first.`);
  const out = [];
  for (const [bp, list] of Object.entries(ranges)) {
    const frame = page.design.frames.find((f) => f.breakpoint === bp);
    if (!frame) throw new Error(`No ${bp} frame for page "${slug}".`);
    const dir = path.join(artifactsDir(themeDir), slug, 'crops', bp);
    const crops = await cropRanges(frame.image, list.map((r) => ({ name: `pb-s${r.n}`, y0: r.y0, y1: r.y1 })), dir);
    crops.forEach((c, i) => out.push({ n: list[i].n, breakpoint: bp, file: c.file }));
  }
  updateState(themeDir, (s) => {
    const page = s.pages.find((p) => p.slug === slug);
    for (const c of out) {
      let sec = page.sections.find((x) => x.n === c.n);
      if (!sec) { sec = { n: c.n, anchor: `pb-s${c.n}`, status: 'planned', crops: {} }; page.sections.push(sec); }
      sec.crops ??= {};
      sec.crops[c.breakpoint] = c.file;
    }
    page.sections.sort((a, b) => a.n - b.n);
  });
  return out;
}

export async function framesFromUrl(themeDir, slug, url, widths) {
  const { shoot } = await import('../qa/shoot.mjs');
  const frames = [];
  for (const w of widths) {
    const bp = w >= 1200 ? 'desktop' : w >= 700 ? 'tablet' : 'mobile';
    const tmp = path.join(artifactsDir(themeDir), slug, 'design', `${bp}.source.png`);
    await shoot({ url, width: w, fullPage: true, out: tmp });
    frames.push(addFrame(themeDir, slug, bp, tmp, { width: w }));
    fs.rmSync(tmp, { force: true });
  }
  return frames;
}

async function main(argv) {
  const [cmd, themeDir, slug, ...rest] = argv;
  const flags = {};
  const pos = [];
  for (let i = 0; i < rest.length; i++) { if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[++i]; else pos.push(rest[i]); }
  const out = (v) => process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
  if (cmd === 'add-frame') return out(addFrame(themeDir, slug, pos[0], pos[1], { width: flags.width, title: flags.title }));
  if (cmd === 'crop') return out(await cropSections(themeDir, slug, JSON.parse(fs.readFileSync(pos[0], 'utf8'))));
  if (cmd === 'from-url') return out(await framesFromUrl(themeDir, slug, pos[0], String(flags.widths ?? '1440,390').split(',').map(Number)));
  process.stderr.write('Usage: node intake.mjs add-frame <themeDir> <slug> <breakpoint> <image> [--width W] [--title T] | crop <themeDir> <slug> <ranges.json> | from-url <themeDir> <slug> <url> --widths 1440,390\n');
  process.exit(64);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); });
}
```

Note: if `state.mjs` does not export `stateDir`, export it there (it's defined in Stage 1 as `export const stateDir = …`); do not duplicate the path logic.

- [ ] **Step 4: Run** `npm test` → Expected: PASS.

- [ ] **Step 5: Crop round-trip check (needs QA deps)**

Add to `tests/qa/segment.test.mjs` (Stage 3 file) a test that `cropSections` writes `crops/desktop/pb-s1.png` and records `sections[0].crops.desktop`:
```js
qtest('cropSections records crops in state', async () => {
  const { addFrame, cropSections } = await import('../../skills/protoblocks-site-builder/scripts/lib/intake.mjs');
  const { initState, loadState } = await import('../../skills/protoblocks-site-builder/scripts/lib/state.mjs');
  const theme = tmpDir();
  initState(theme, { url: 'http://a.local', path: '/x' });
  const img = await makeImage({ width: 1440, height: 600 }, path.join(theme, 'd.png'));
  addFrame(theme, 'home', 'desktop', img);
  const out = await cropSections(theme, 'home', { desktop: [{ n: 1, y0: 0, y1: 300 }, { n: 2, y0: 300, y1: 600 }] });
  assert.equal(out.length, 2);
  const secs = loadState(theme).pages[0].sections;
  assert.deepEqual(secs.map((s) => s.anchor), ['pb-s1', 'pb-s2']);
  assert.ok(fs.existsSync(secs[1].crops.desktop));
});
```
Run: `npm run test:qa` → Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add skills/protoblocks-site-builder/scripts/lib/intake.mjs tests/unit/intake.test.mjs tests/qa/segment.test.mjs skills/protoblocks-site-builder/scripts/lib/state.mjs
git commit -m "feat(intake): design frames with scale inference and section crops"
```

---

### Task 2: Block render smoke + build gates

**Files:**
- Create: `skills/protoblocks-site-builder/scripts/wp/render-block.php`
- Create: `skills/protoblocks-site-builder/scripts/lib/gates.mjs`
- Create: `tests/integration/fixtures/blocks/pb-gate-ok/{block.json,template.php}`
- Create: `tests/integration/fixtures/blocks/pb-gate-bad/{block.json,template.php}`
- Create: `tests/integration/gates.test.mjs`

**Interfaces:**
- Consumes: `createWp`, `loadRuntime`, `WP_SCRIPTS_DIR` (Stage 2).
- Produces:
  - `render-block.php <slug> <attrsJson>` → `{"ok":bool,"frontend":{"length":int,"hasAnchor":bool},"editor":{"status":int,"message":string|null},"errors":[{"message","file","line","severity"}],"other":[…same…]}` (attrs always get `anchor: "pb-gate"` added).
  - `runGates(wp, { block, attrs = {} }) => { ok, steps: [{ id: 'anchor-support'|'validate'|'cache'|'tailwind'|'render', ok, detail }] }` — stops at the first failing step; `block` is the folder slug (`media-text`), not `proto-blocks/media-text`. `anchor-support` reads `<active theme>/proto-blocks/<block>/block.json`. `tailwind` compiles only when Tailwind is enabled (`tailwind.php status`), else `ok: true, detail: 'disabled'`.
  - CLI: `node gates.mjs <themeDir> <block> [--attrs '<json>']` → prints the result; exit 1 when `ok` is false.

- [ ] **Step 1: Write `scripts/wp/render-block.php`**

```php
<?php
/**
 * Render smoke test for one Proto-Block (frontend + editor preview).
 * Usage: wp eval-file render-block.php <slug> '<attrs json>'
 */
$slug = sanitize_key($args[0] ?? '');
$attrs = json_decode($args[1] ?? '{}', true);
if ($slug === '' || !is_array($attrs)) { fwrite(STDERR, "Usage: render-block.php <slug> '<attrs json>'\n"); exit(1); }
$attrs['anchor'] = 'pb-gate';

$admins = get_users(['role' => 'administrator', 'number' => 1, 'fields' => 'ID']);
wp_set_current_user((int) ($admins[0] ?? 0));

$block_dir = wp_normalize_path(get_stylesheet_directory() . '/proto-blocks/' . $slug . '/');
$errors = [];
$other = [];
$sev = function (int $no): string {
    return in_array($no, [E_WARNING, E_USER_WARNING], true) ? 'warning'
        : (in_array($no, [E_NOTICE, E_USER_NOTICE], true) ? 'notice'
        : (in_array($no, [E_DEPRECATED, E_USER_DEPRECATED], true) ? 'deprecated' : 'error'));
};
set_error_handler(function ($no, $str, $file, $line) use (&$errors, &$other, $block_dir, $sev) {
    $entry = ['message' => $str, 'file' => $file, 'line' => $line, 'severity' => $sev($no)];
    if (str_starts_with(wp_normalize_path($file), $block_dir)) { $errors[] = $entry; } else { $other[] = $entry; }
    return true;
});

$html = '';
try {
    $html = do_blocks(serialize_block(['blockName' => 'proto-blocks/' . $slug, 'attrs' => $attrs, 'innerBlocks' => [], 'innerHTML' => '', 'innerContent' => []]));
} catch (\Throwable $e) {
    $errors[] = ['message' => $e->getMessage(), 'file' => $e->getFile(), 'line' => $e->getLine(), 'severity' => 'error'];
}

$req = new WP_REST_Request('POST', '/proto-blocks/v1/preview');
$req->set_body_params(['template' => $slug, 'attributes' => $attrs]);
$res = rest_do_request($req);
restore_error_handler();

$status = $res->get_status();
$data = $res->get_data();
$message = $status === 200 ? null : (is_array($data) ? ($data['message'] ?? null) : null);
if ($status !== 200 && $message) {
    $errors[] = ['message' => 'editor preview: ' . $message, 'file' => $block_dir . 'template.php', 'line' => 0, 'severity' => 'error'];
}
$frontend = ['length' => strlen(trim($html)), 'hasAnchor' => str_contains($html, 'id="pb-gate"')];
$ok = $status === 200 && $frontend['length'] > 0 && $frontend['hasAnchor'] && count($errors) === 0;

echo wp_json_encode(['ok' => $ok, 'frontend' => $frontend, 'editor' => ['status' => $status, 'message' => $message], 'errors' => $errors, 'other' => array_slice($other, 0, 20)]) . "\n";
```

- [ ] **Step 2: Fixture blocks**

`tests/integration/fixtures/blocks/pb-gate-ok/block.json`:
```json
{
  "$schema": "https://schemas.wp.org/trunk/block.json",
  "apiVersion": 3,
  "name": "proto-blocks/pb-gate-ok",
  "title": "Gate OK",
  "category": "proto-blocks",
  "supports": { "html": false, "anchor": true },
  "protoBlocks": { "version": "1.0", "template": "template.php", "useTailwind": false,
    "fields": { "heading": { "type": "text", "tagName": "h2" } } }
}
```
`tests/integration/fixtures/blocks/pb-gate-ok/template.php`:
```php
<?php $heading = $attributes['heading'] ?? ''; ?>
<section <?php echo get_block_wrapper_attributes(['class' => 'pb-gate-ok']); ?>>
  <h2 data-proto-field="heading"><?php echo esc_html($heading); ?></h2>
</section>
```
`pb-gate-bad/block.json`: same as ok with `"name": "proto-blocks/pb-gate-bad"`, `"title": "Gate Bad"`.
`pb-gate-bad/template.php`:
```php
<?php echo $attributes['missing']['key']; ?>
<section <?php echo get_block_wrapper_attributes(); ?>>bad</section>
```

- [ ] **Step 3: Failing integration test** `tests/integration/gates.test.mjs`

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { itest, testWp, PUBLIC } from './helpers.mjs';
import { runGates } from '../../skills/protoblocks-site-builder/scripts/lib/gates.mjs';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'blocks');

function install(wp, name) {
  const theme = wp.check(['eval', 'echo get_stylesheet_directory();']).trim();
  fs.cpSync(path.join(FIX, name), path.join(theme, 'proto-blocks', name), { recursive: true });
  return theme;
}

itest('gates pass a good block and stop at render for a warning-emitting block', () => {
  const wp = testWp();
  install(wp, 'pb-gate-ok');
  install(wp, 'pb-gate-bad');
  const ok = runGates(wp, { block: 'pb-gate-ok', attrs: { heading: 'Hello' } });
  assert.equal(ok.ok, true, JSON.stringify(ok, null, 2));
  assert.deepEqual(ok.steps.map((s) => s.id), ['anchor-support', 'validate', 'cache', 'tailwind', 'render']);

  const bad = runGates(wp, { block: 'pb-gate-bad' });
  assert.equal(bad.ok, false);
  const render = bad.steps.find((s) => s.id === 'render');
  assert.equal(render.ok, false);
  assert.match(JSON.stringify(render.detail), /Undefined array key/);
});

itest('gates fail fast when the block lacks anchor support', () => {
  const wp = testWp();
  const theme = install(wp, 'pb-gate-ok');
  const dir = path.join(theme, 'proto-blocks', 'pb-gate-noanchor');
  fs.cpSync(path.join(FIX, 'pb-gate-ok'), dir, { recursive: true });
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'block.json'), 'utf8'));
  json.name = 'proto-blocks/pb-gate-noanchor';
  json.supports = { html: false };
  fs.writeFileSync(path.join(dir, 'block.json'), JSON.stringify(json));
  const r = runGates(wp, { block: 'pb-gate-noanchor' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.steps.map((s) => s.id), ['anchor-support']);
  fs.rmSync(dir, { recursive: true, force: true });
});
```

Run: `npm run test:integration` → Expected: FAIL (module missing).

- [ ] **Step 4: Implement** `scripts/lib/gates.mjs`

```js
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWp, loadRuntime, WP_SCRIPTS_DIR } from './wp.mjs';

export function runGates(wp, { block, attrs = {} }) {
  const steps = [];
  const step = (id, ok, detail) => { steps.push({ id, ok, detail }); return ok; };
  const done = () => ({ ok: steps.every((s) => s.ok), steps });

  const themeDir = wp.check(['eval', 'echo get_stylesheet_directory();']).trim();
  const jsonPath = path.join(themeDir, 'proto-blocks', block, 'block.json');
  let json = null;
  try { json = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch (e) { step('anchor-support', false, `Cannot read ${jsonPath}: ${e.message}`); return done(); }
  if (!step('anchor-support', json?.supports?.anchor === true, json?.supports?.anchor === true ? 'supports.anchor true' : 'block.json must declare "supports": { "anchor": true } (QA targets #pb-s<n>)')) return done();

  const v = wp.run(['proto-blocks', 'validate', block, '--format=json']);
  let rows = [];
  try { rows = JSON.parse(v.stdout.trim().split('\n').find((l) => l.startsWith('[')) ?? '[]'); } catch { rows = []; }
  const row = rows.find((r) => r.block === block);
  const validOk = v.code === 0 && row && !['error', 'invalid'].includes(String(row.status).toLowerCase());
  if (!step('validate', !!validOk, row ?? (v.stderr || v.stdout).trim())) return done();

  const c = wp.run(['proto-blocks', 'cache', 'clear']);
  if (!step('cache', c.code === 0, (c.stdout || c.stderr).trim())) return done();

  const tw = path.join(WP_SCRIPTS_DIR, 'tailwind.php');
  const status = wp.evalFile(tw, ['status']);
  if (status.enabled) {
    const r = wp.run(['eval-file', tw, 'compile']);
    const last = r.stdout.trim().split('\n').at(-1) ?? '';
    if (!step('tailwind', r.code === 0, last || r.stderr.trim())) return done();
  } else {
    step('tailwind', true, 'disabled');
  }

  const render = wp.evalFile(path.join(WP_SCRIPTS_DIR, 'render-block.php'), [block, JSON.stringify(attrs)]);
  step('render', render.ok === true, render);
  return done();
}

function main(argv) {
  const [themeDir, block, ...rest] = argv;
  if (!themeDir || !block) { process.stderr.write("Usage: node gates.mjs <themeDir> <block> [--attrs '<json>']\n"); process.exit(64); }
  const i = rest.indexOf('--attrs');
  const r = runGates(createWp(loadRuntime(themeDir)), { block, attrs: i >= 0 ? JSON.parse(rest[i + 1]) : {} });
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  if (!r.ok) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); }
}
```

- [ ] **Step 5: Run** `npm run test:integration` → Expected: PASS. If `wp proto-blocks validate --format=json` prints a status value other than `valid`/`warning`/`error` for these fixtures, record the actual values in the report and adjust only the status mapping.

- [ ] **Step 6: Commit**

```bash
git add skills/protoblocks-site-builder/scripts/wp/render-block.php skills/protoblocks-site-builder/scripts/lib/gates.mjs tests/integration/fixtures/blocks tests/integration/gates.test.mjs
git commit -m "feat(loop): block build gates with PHP render smoke test"
```

---

### Task 3: Media import with dedupe

**Files:**
- Create: `skills/protoblocks-site-builder/scripts/wp/media.php`
- Create: `skills/protoblocks-site-builder/scripts/lib/media.mjs`
- Create: `tests/integration/media.test.mjs`

**Interfaces:**
- Produces:
  - `media.php import <file> <alt> [title]` → `{"id":int,"url":string,"alt":string,"mime":string,"reused":bool}`.
  - `importMedia(wp, file, { alt, title }) => {id, url, alt, mime, reused}` — throws `Error` code `EALT` when `alt` is undefined (empty string allowed only for decorative images, passed explicitly as `''`).
  - `imageAttr(m) => { id, url, alt, caption: '', size: 'full' }` (Proto-Blocks image field shape).
  - CLI: `node media.mjs import <themeDir> <file> --alt "<text>" [--title T]`.

- [ ] **Step 1: Write `scripts/wp/media.php`**

```php
<?php
/**
 * Import a local file into the Media Library once (dedupe by SHA-1).
 * Usage: wp eval-file media.php import <file> <alt> [title]
 */
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/media.php';
require_once ABSPATH . 'wp-admin/includes/image.php';
kses_remove_filters();
$admins = get_users(['role' => 'administrator', 'number' => 1, 'fields' => 'ID']);
wp_set_current_user((int) ($admins[0] ?? 0));

$fail = function (string $m) { fwrite(STDERR, $m . "\n"); exit(1); };
if (($args[0] ?? '') !== 'import') { $fail('Usage: media.php import <file> <alt> [title]'); }
$file = $args[1] ?? '';
$alt = (string) ($args[2] ?? '');
$title = (string) ($args[3] ?? '');
if (!is_readable($file)) { $fail("Cannot read {$file}"); }

$hash = sha1_file($file);
$found = get_posts(['post_type' => 'attachment', 'post_status' => 'inherit', 'numberposts' => 1, 'meta_key' => '_pb_source_hash', 'meta_value' => $hash, 'fields' => 'ids']);
if ($found) {
    $id = (int) $found[0];
    update_post_meta($id, '_wp_attachment_image_alt', $alt);
    echo wp_json_encode(['id' => $id, 'url' => wp_get_attachment_url($id), 'alt' => $alt, 'mime' => get_post_mime_type($id), 'reused' => true]) . "\n";
    return;
}

$tmp = wp_tempnam(basename($file));
copy($file, $tmp);
$id = media_handle_sideload(['name' => basename($file), 'tmp_name' => $tmp], 0, $title !== '' ? $title : null);
if (is_wp_error($id)) { @unlink($tmp); $fail($id->get_error_message()); }
update_post_meta($id, '_pb_source_hash', $hash);
update_post_meta($id, '_wp_attachment_image_alt', $alt);
echo wp_json_encode(['id' => (int) $id, 'url' => wp_get_attachment_url($id), 'alt' => $alt, 'mime' => get_post_mime_type($id), 'reused' => false]) . "\n";
```

- [ ] **Step 2: Implement** `scripts/lib/media.mjs`

```js
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWp, loadRuntime, WP_SCRIPTS_DIR } from './wp.mjs';

export function importMedia(wp, file, { alt, title = '' } = {}) {
  if (alt === undefined) {
    const e = new Error(`Alt text is required for ${file} (pass '' only for purely decorative images).`);
    e.code = 'EALT';
    throw e;
  }
  return wp.evalFile(path.join(WP_SCRIPTS_DIR, 'media.php'), ['import', path.resolve(file), alt, title]);
}

export const imageAttr = (m) => ({ id: m.id, url: m.url, alt: m.alt, caption: '', size: 'full' });

function main(argv) {
  const [cmd, themeDir, file, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 2) flags[rest[i].replace(/^--/, '')] = rest[i + 1];
  if (cmd !== 'import' || !themeDir || !file) { process.stderr.write('Usage: node media.mjs import <themeDir> <file> --alt "<text>" [--title T]\n'); process.exit(64); }
  const m = importMedia(createWp(loadRuntime(themeDir)), file, { alt: flags.alt, title: flags.title });
  process.stdout.write(`${JSON.stringify({ ...m, attr: imageAttr(m) }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); }
}
```

- [ ] **Step 3: Integration test** `tests/integration/media.test.mjs`

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { itest, testWp } from './helpers.mjs';
import { importMedia, imageAttr } from '../../skills/protoblocks-site-builder/scripts/lib/media.mjs';

function tinyPng(file, seed) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(4, 0); ihdr.writeUInt32BE(4, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((4 * 3 + 1) * 4, seed);
  for (let r = 0; r < 4; r++) raw[r * 13] = 0;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  return file;
}

itest('importMedia imports once, reuses on re-import, and requires alt', () => {
  const wp = testWp();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-media-'));
  const file = tinyPng(path.join(dir, `logo-${Date.now()}.png`), Date.now() % 250);
  const a = importMedia(wp, file, { alt: 'Acme logo' });
  const b = importMedia(wp, file, { alt: 'Acme logo (updated)' });
  assert.equal(a.reused, false);
  assert.equal(b.reused, true);
  assert.equal(a.id, b.id);
  assert.equal(wp.check(['post', 'meta', 'get', String(a.id), '_wp_attachment_image_alt']).trim(), 'Acme logo (updated)');
  assert.deepEqual(Object.keys(imageAttr(b)), ['id', 'url', 'alt', 'caption', 'size']);
  assert.throws(() => importMedia(wp, file, {}), (e) => e.code === 'EALT');
});
```

Run: `npm run test:integration` → Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add skills/protoblocks-site-builder/scripts/wp/media.php skills/protoblocks-site-builder/scripts/lib/media.mjs tests/integration/media.test.mjs
git commit -m "feat(loop): media import with SHA-1 dedupe and required alt text"
```

---

### Task 4: Page assembly with edit guard

**Files:**
- Create: `skills/protoblocks-site-builder/scripts/wp/page.php`
- Create: `skills/protoblocks-site-builder/scripts/lib/page.mjs`
- Create: `tests/unit/page-spec.test.mjs`
- Create: `tests/integration/page.test.mjs`

**Interfaces:**
- Consumes: state helpers, `createWp`/`loadRuntime`/`WP_SCRIPTS_DIR`, `refreshMenus` (Stage 2).
- Produces:
  - Page spec (`page.php write <spec.json>` input): `{ postId: int|null, slug, title, expectedHash: string|null, force: bool, blocks: [{ name, attrs, innerRaw?: string }] }`.
  - `page.php write` output: `{ ok: true, postId, url, contentHash, created }` or `{ ok: false, code: 'EEDITED'|'ESLUGTAKEN', message, currentHash? }` (exit 0 in both cases). `page.php hash <postId>` → `{ postId, contentHash }`. `contentHash` = SHA-256 hex of the stored `post_content`.
  - `pageSpecFromState(state, slug, { force = false } = {}) => spec` — sections sorted by `n`, skipping `status: 'skipped'` and sections without `block`; `name` = `proto-blocks/<block>` unless `block` already contains `/`; `attrs` = `{ ...section.attrs, anchor: section.anchor }`; `innerRaw` = `section.inner.join('\n')` when `inner` is non-empty.
  - `buildPage(wp, themeDir, slug, { force = false } = {}) => { postId, url, contentHash, created, refreshedMenus: string[] }` — throws `Error` with `code` `EEDITED` / `ESLUGTAKEN` (message tells the agent to ask the developer, then re-run with `--force`); updates `page.postId`, `page.url`, `page.contentHash`, and `page.status` (`planning` → `building`); runs `refreshMenus` when any menu has a pending link for this slug.
  - CLI: `node page.mjs build <themeDir> <slug> [--force]`.

- [ ] **Step 1: Failing unit test** `tests/unit/page-spec.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageSpecFromState } from '../../skills/protoblocks-site-builder/scripts/lib/page.mjs';

test('pageSpecFromState orders sections, adds anchors, skips skipped/unbuilt', () => {
  const state = { pages: [{ slug: 'home', title: 'Home', postId: 7, contentHash: 'abc', sections: [
    { n: 2, anchor: 'pb-s2', block: 'cta', attrs: { heading: 'Go' }, status: 'done' },
    { n: 1, anchor: 'pb-s1', block: 'hero-split', attrs: {}, inner: ['<!-- wp:paragraph --><p>x</p><!-- /wp:paragraph -->'], status: 'building' },
    { n: 3, anchor: 'pb-s3', block: 'faq', status: 'skipped' },
    { n: 4, anchor: 'pb-s4', status: 'planned' },
  ] }] };
  const spec = pageSpecFromState(state, 'home');
  assert.equal(spec.postId, 7);
  assert.equal(spec.expectedHash, 'abc');
  assert.equal(spec.force, false);
  assert.deepEqual(spec.blocks.map((b) => b.name), ['proto-blocks/hero-split', 'proto-blocks/cta']);
  assert.deepEqual(spec.blocks[1].attrs, { heading: 'Go', anchor: 'pb-s2' });
  assert.match(spec.blocks[0].innerRaw, /wp:paragraph/);
  assert.throws(() => pageSpecFromState(state, 'nope'), /No page "nope"/);
});
```

- [ ] **Step 2: Run** `npm test` → Expected: FAIL.

- [ ] **Step 3: Write `scripts/wp/page.php`**

```php
<?php
/**
 * Assemble a landing page from a block spec.
 * Usage: wp eval-file page.php write <spec.json> | hash <postId>
 */
kses_remove_filters();
$admins = get_users(['role' => 'administrator', 'number' => 1, 'fields' => 'ID']);
wp_set_current_user((int) ($admins[0] ?? 0));
$out = function (array $d) { echo wp_json_encode($d, JSON_UNESCAPED_SLASHES) . "\n"; };
$hash = fn(int $id) => hash('sha256', (string) get_post_field('post_content', $id, 'raw'));

if (($args[0] ?? '') === 'hash') {
    $id = (int) ($args[1] ?? 0);
    $out(['postId' => $id, 'contentHash' => $hash($id)]);
    return;
}
if (($args[0] ?? '') !== 'write') { fwrite(STDERR, "Usage: page.php write <spec.json> | hash <postId>\n"); exit(1); }

$spec = json_decode((string) file_get_contents($args[1] ?? ''), true);
if (!is_array($spec) || empty($spec['slug']) || !isset($spec['blocks'])) { fwrite(STDERR, "Invalid spec.\n"); exit(1); }
$force = !empty($spec['force']);
$post_id = !empty($spec['postId']) ? (int) $spec['postId'] : 0;
if ($post_id && !get_post($post_id)) { $post_id = 0; }

if (!$post_id) {
    $existing = get_page_by_path($spec['slug'], OBJECT, 'page');
    if ($existing && $existing->post_status !== 'trash') {
        if (!get_post_meta($existing->ID, '_pb_built', true) && !$force) {
            $out(['ok' => false, 'code' => 'ESLUGTAKEN', 'message' => "A page with slug \"{$spec['slug']}\" already exists and was not created by the builder (ID {$existing->ID})."]);
            return;
        }
        $post_id = (int) $existing->ID;
    }
}

if ($post_id && !$force && !empty($spec['expectedHash'])) {
    $current = $hash($post_id);
    if ($current !== $spec['expectedHash']) {
        $out(['ok' => false, 'code' => 'EEDITED', 'message' => "Page {$post_id} was edited outside the builder since the last write.", 'currentHash' => $current]);
        return;
    }
}

$blocks = [];
foreach ($spec['blocks'] as $b) {
    $inner = [];
    if (!empty($b['innerRaw'])) {
        $inner = array_values(array_filter(parse_blocks($b['innerRaw']), fn($x) => !empty($x['blockName'])));
    }
    $blocks[] = ['blockName' => $b['name'], 'attrs' => (array) ($b['attrs'] ?? []), 'innerBlocks' => $inner, 'innerHTML' => '', 'innerContent' => array_fill(0, count($inner), null)];
}

$postarr = [
    'post_type' => 'page', 'post_status' => 'publish', 'post_name' => $spec['slug'],
    'post_title' => (string) ($spec['title'] ?? $spec['slug']), 'post_content' => serialize_blocks($blocks),
];
if ($post_id) { $postarr['ID'] = $post_id; }
$id = $post_id ? wp_update_post(wp_slash($postarr), true) : wp_insert_post(wp_slash($postarr), true);
if (is_wp_error($id)) { fwrite(STDERR, $id->get_error_message() . "\n"); exit(1); }
update_post_meta($id, '_pb_built', 1);
clean_post_cache($id);
$out(['ok' => true, 'postId' => (int) $id, 'url' => get_permalink($id), 'contentHash' => $hash((int) $id), 'created' => !$post_id]);
```

- [ ] **Step 4: Implement** `scripts/lib/page.mjs`

```js
#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWp, loadRuntime, WP_SCRIPTS_DIR } from './wp.mjs';
import { loadState, updateState } from './state.mjs';
import { refreshMenus } from './navigation.mjs';

export function pageSpecFromState(state, slug, { force = false } = {}) {
  const page = state.pages.find((p) => p.slug === slug);
  if (!page) throw new Error(`No page "${slug}" in state.`);
  const blocks = [...page.sections]
    .sort((a, b) => a.n - b.n)
    .filter((s) => s.status !== 'skipped' && s.block)
    .map((s) => ({
      name: s.block.includes('/') ? s.block : `proto-blocks/${s.block}`,
      attrs: { ...(s.attrs ?? {}), anchor: s.anchor },
      ...(s.inner?.length ? { innerRaw: s.inner.join('\n') } : {}),
    }));
  return { postId: page.postId ?? null, slug: page.slug, title: page.title ?? page.slug, expectedHash: page.contentHash ?? null, force, blocks };
}

export function buildPage(wp, themeDir, slug, { force = false } = {}) {
  const spec = pageSpecFromState(loadState(themeDir), slug, { force });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-page-'));
  const file = path.join(dir, 'spec.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  let r;
  try { r = wp.evalFile(path.join(WP_SCRIPTS_DIR, 'page.php'), ['write', file]); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  if (!r.ok) {
    const e = new Error(`${r.message} Ask the developer before overwriting; then re-run with --force.`);
    e.code = r.code;
    throw e;
  }
  let pendingHere = false;
  updateState(themeDir, (s) => {
    const page = s.pages.find((p) => p.slug === slug);
    page.postId = r.postId;
    page.url = r.url;
    page.contentHash = r.contentHash;
    if (page.status === 'planning') page.status = 'building';
    pendingHere = Object.values(s.site.navigation?.menus ?? {}).some((m) => (m.pending ?? []).some((p) => p.page === slug));
  });
  const refreshedMenus = pendingHere ? refreshMenus(wp, themeDir).refreshed : [];
  return { postId: r.postId, url: r.url, contentHash: r.contentHash, created: r.created, refreshedMenus };
}

function main(argv) {
  const [cmd, themeDir, slug] = argv;
  if (cmd !== 'build' || !themeDir || !slug) { process.stderr.write('Usage: node page.mjs build <themeDir> <slug> [--force]\n'); process.exit(64); }
  const r = buildPage(createWp(loadRuntime(themeDir)), themeDir, slug, { force: argv.includes('--force') });
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); }
}
```

- [ ] **Step 5: Integration test** `tests/integration/page.test.mjs`

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { itest, testWp } from './helpers.mjs';
import { buildPage } from '../../skills/protoblocks-site-builder/scripts/lib/page.mjs';
import { initState, updateState, loadState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'blocks');

itest('buildPage creates, rebuilds idempotently, guards edits, and refuses foreign slugs', () => {
  const wp = testWp();
  const themeDirWp = wp.check(['eval', 'echo get_stylesheet_directory();']).trim();
  fs.cpSync(path.join(FIX, 'pb-gate-ok'), path.join(themeDirWp, 'proto-blocks', 'pb-gate-ok'), { recursive: true });
  const slug = `pb-page-${Date.now()}`;
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-pagestate-'));
  initState(theme, { url: 'http://127.0.0.1:8881', path: '/x' });
  updateState(theme, (s) => { s.pages.push({ slug, title: 'Itest', status: 'planning', postId: null, contentHash: null, sections: [
    { n: 1, anchor: 'pb-s1', block: 'pb-gate-ok', attrs: { heading: 'One' }, status: 'building' },
  ] }); });

  const a = buildPage(wp, theme, slug);
  assert.equal(a.created, true);
  const html = wp.check(['eval', `echo apply_filters('the_content', get_post_field('post_content', ${a.postId}));`]);
  assert.match(html, /id="pb-s1"/);
  assert.equal(loadState(theme).pages[0].status, 'building');

  const b = buildPage(wp, theme, slug);
  assert.equal(b.created, false);
  assert.equal(b.postId, a.postId);

  wp.check(['post', 'update', String(a.postId), '--post_content=<!-- wp:paragraph --><p>hand edit</p><!-- /wp:paragraph -->']);
  assert.throws(() => buildPage(wp, theme, slug), (e) => e.code === 'EEDITED' && /--force/.test(e.message));
  assert.equal(buildPage(wp, theme, slug, { force: true }).postId, a.postId);

  const foreign = `pb-foreign-${Date.now()}`;
  wp.check(['post', 'create', '--post_type=page', '--post_status=publish', `--post_name=${foreign}`, '--post_title=Client page']);
  updateState(theme, (s) => { s.pages.push({ slug: foreign, title: 'F', status: 'planning', postId: null, contentHash: null, sections: [] }); });
  assert.throws(() => buildPage(wp, theme, foreign), (e) => e.code === 'ESLUGTAKEN');
});
```

Run: `npm test && npm run test:integration` → Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add skills/protoblocks-site-builder/scripts/wp/page.php skills/protoblocks-site-builder/scripts/lib/page.mjs tests/unit/page-spec.test.mjs tests/integration/page.test.mjs
git commit -m "feat(loop): idempotent page assembly with edit and slug guards"
```

---

### Task 5: Block library manifest

**Files:**
- Create: `skills/protoblocks-site-builder/scripts/lib/library.mjs`
- Create: `tests/unit/library.test.mjs`
- Create: `tests/integration/library.test.mjs`

**Interfaces:**
- Produces:
  - `readBlockJson(themeDir, block) => object|null`
  - `summarizeBlock(json) => { name, title, description, fields: {key: type}, controls: {key: type | 'select(a|b|c)'}, useTailwind: bool, innerBlocks: bool }` — `select`/`radio`/`multiselect` controls list option keys; `innerBlocks` true when any field type is `inner-blocks`.
  - `listLibrary(wp, themeDir) => entries[]` — every `proto-blocks/*` block from `wp proto-blocks list --format=json` whose folder exists in `<themeDir>/proto-blocks/`, merged with `state.library[slug]` (`purpose`, `variants`, `usedOn`, `baselines`) when the state file exists; sorted by slug.
  - `recordUse(themeDir, block, pageSlug, { purpose, variants } = {}) => entry` — adds `pageSlug` to `usedOn` once; sets `purpose`/`variants` when given.
  - CLI: `node library.mjs list <themeDir>`; `node library.mjs record <themeDir> <block> <page> [--purpose "<text>"] [--variants a,b]`.

- [ ] **Step 1: Failing unit test** `tests/unit/library.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { summarizeBlock, recordUse } from '../../skills/protoblocks-site-builder/scripts/lib/library.mjs';
import { initState, loadState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';

test('summarizeBlock lists fields, controls with options, inner blocks', () => {
  const s = summarizeBlock({ name: 'proto-blocks/media-text', title: 'Media Text', protoBlocks: { useTailwind: true,
    fields: { heading: { type: 'text' }, body: { type: 'wysiwyg' }, slot: { type: 'inner-blocks' } },
    controls: { imagePosition: { type: 'select', options: [{ key: 'left' }, { key: 'right' }] }, dark: { type: 'toggle' } } } });
  assert.deepEqual(s.fields, { heading: 'text', body: 'wysiwyg', slot: 'inner-blocks' });
  assert.deepEqual(s.controls, { imagePosition: 'select(left|right)', dark: 'toggle' });
  assert.equal(s.innerBlocks, true);
  assert.equal(s.useTailwind, true);
});

test('recordUse adds a page once and stores purpose/variants', () => {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-lib-'));
  initState(theme, { url: 'http://a.local', path: '/x' });
  recordUse(theme, 'media-text', 'home', { purpose: 'image beside copy', variants: ['imagePosition'] });
  recordUse(theme, 'media-text', 'home');
  recordUse(theme, 'media-text', 'about');
  const e = loadState(theme).library['media-text'];
  assert.deepEqual(e.usedOn, ['home', 'about']);
  assert.equal(e.purpose, 'image beside copy');
  assert.deepEqual(e.variants, ['imagePosition']);
});
```

- [ ] **Step 2: Run** `npm test` → Expected: FAIL.

- [ ] **Step 3: Implement** `scripts/lib/library.mjs`

```js
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWp, loadRuntime } from './wp.mjs';
import { loadState, updateState, statePath } from './state.mjs';

export function readBlockJson(themeDir, block) {
  const f = path.join(themeDir, 'proto-blocks', block, 'block.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

export function summarizeBlock(json) {
  const pb = json.protoBlocks ?? {};
  const fields = Object.fromEntries(Object.entries(pb.fields ?? {}).map(([k, v]) => [k, v.type]));
  const controls = Object.fromEntries(Object.entries(pb.controls ?? {}).map(([k, v]) => [
    k, ['select', 'radio', 'multiselect'].includes(v.type) && Array.isArray(v.options) ? `${v.type}(${v.options.map((o) => o.key ?? o.value).join('|')})` : v.type,
  ]));
  return { name: json.name, title: json.title, description: json.description ?? '', fields, controls, useTailwind: !!pb.useTailwind, innerBlocks: Object.values(fields).includes('inner-blocks') };
}

export function listLibrary(wp, themeDir) {
  const out = wp.check(['proto-blocks', 'list', '--format=json']).trim();
  const registered = JSON.parse(out.split('\n').find((l) => l.startsWith('[')) ?? '[]');
  const lib = fs.existsSync(statePath(themeDir)) ? loadState(themeDir).library : {};
  return registered
    .map((r) => r.name.replace(/^proto-blocks\//, ''))
    .filter((slug) => fs.existsSync(path.join(themeDir, 'proto-blocks', slug, 'block.json')))
    .sort()
    .map((slug) => ({ slug, ...summarizeBlock(readBlockJson(themeDir, slug)), purpose: lib[slug]?.purpose ?? '', variants: lib[slug]?.variants ?? [], usedOn: lib[slug]?.usedOn ?? [], baselines: lib[slug]?.baselines ?? [] }));
}

export function recordUse(themeDir, block, pageSlug, { purpose, variants } = {}) {
  let entry;
  updateState(themeDir, (s) => {
    entry = s.library[block] ??= { usedOn: [] };
    entry.usedOn ??= [];
    if (pageSlug && !entry.usedOn.includes(pageSlug)) entry.usedOn.push(pageSlug);
    if (purpose) entry.purpose = purpose;
    if (variants) entry.variants = variants;
  });
  return entry;
}

function main(argv) {
  const [cmd, themeDir, block, page, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 2) flags[rest[i].replace(/^--/, '')] = rest[i + 1];
  const out = (v) => process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
  if (cmd === 'list' && themeDir) return out(listLibrary(createWp(loadRuntime(themeDir)), themeDir));
  if (cmd === 'record' && themeDir && block && page) return out(recordUse(themeDir, block, page, { purpose: flags.purpose, variants: flags.variants?.split(',') }));
  process.stderr.write('Usage: node library.mjs list <themeDir> | record <themeDir> <block> <page> [--purpose T] [--variants a,b]\n');
  process.exit(64);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); }
}
```

- [ ] **Step 4: Integration test** `tests/integration/library.test.mjs`

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { itest, testWp } from './helpers.mjs';
import { listLibrary } from '../../skills/protoblocks-site-builder/scripts/lib/library.mjs';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'blocks');

itest('listLibrary lists theme blocks with their schema summary', () => {
  const wp = testWp();
  const theme = wp.check(['eval', 'echo get_stylesheet_directory();']).trim();
  fs.cpSync(path.join(FIX, 'pb-gate-ok'), path.join(theme, 'proto-blocks', 'pb-gate-ok'), { recursive: true });
  wp.check(['proto-blocks', 'cache', 'clear']);
  const lib = listLibrary(wp, theme);
  const entry = lib.find((e) => e.slug === 'pb-gate-ok');
  assert.ok(entry, JSON.stringify(lib));
  assert.deepEqual(entry.fields, { heading: 'text' });
});
```

Run: `npm test && npm run test:integration` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/protoblocks-site-builder/scripts/lib/library.mjs tests/unit/library.test.mjs tests/integration/library.test.mjs
git commit -m "feat(loop): block library manifest and usage tracking"
```

---

### Task 6: QA input + verdict recording + regressions

**Files:**
- Create: `skills/protoblocks-site-builder/scripts/lib/qa-input.mjs`
- Create: `skills/protoblocks-site-builder/scripts/lib/regress.mjs`
- Create: `tests/unit/qa-input.test.mjs`
- Create: `tests/qa/regress.test.mjs`

**Interfaces:**
- Consumes: state helpers; `artifactsDir` (Task 1); `shoot`, `diffImages` (Stage 3, dynamic imports from `../qa/`).
- Produces:
  - `STANDARD_WIDTHS = { desktop: 1440, tablet: 834, mobile: 390 }`
  - `buildCheckInput(state, themeDir, slug, n) => CheckInput` (Stage 3 shape). Diff breakpoints = page frames whose section has a crop; sanity breakpoints = standard breakpoints without a frame. `iterDir` = `artifacts/<slug>/pb-s<n>/iter-<k>` with `k` = 1 + max `iteration` in `section.qa` (1 when empty). Throws when the page has no `url` (build the page first) or the section has no crops.
  - `prepareCheck(themeDir, slug, n) => { input: <path to input.json>, iteration }` — writes `<iterDir>/input.json`, sets `section.status = 'verifying'`.
  - `validateVerdict(verdict) => string[]` — errors when `pass` is true but `numericPass` is false, any discrepancy has `severity: 'high'`, or any diff breakpoint has `numericPass: false`.
  - `recordVerdict(themeDir, slug, n, verdictFile) => { pass, iteration, capReached, status }` — throws `Error` code `EVERDICT` when `validateVerdict` returns errors; appends one `section.qa` entry per breakpoint `{ iteration, breakpoint, mode, mismatch?, heightDelta?, pass, verdict: <file> }`; on pass: `status = 'animating'`, copies each diff breakpoint's render (`<iterDir>/<bp>-render.png`) to `artifacts/baselines/<slug>/pb-s<n>-<bp>.png` and upserts `library[block].baselines` entries `{ page, anchor, breakpoint, file, width, scale }`; on fail: `status = 'building'`, `capReached = iteration >= site.qa.maxIterations`.
  - `regress(themeDir, block, { browser } = {}) => Promise<{ block, results: [{ page, anchor, breakpoint, mismatch, heightDelta, pass }], pass }>` — for each baseline: shoot `<page url>#anchor` element at baseline width/scale into a temp file, diff against the baseline; pass when `mismatch ≤ 0.01` and `heightDelta ≤ 0.005`.
  - CLIs: `node qa-input.mjs prepare <themeDir> <slug> <n>`; `node qa-input.mjs record <themeDir> <slug> <n> <verdict.json>`; `node regress.mjs <themeDir> <block>` (exit 1 when not pass).

- [ ] **Step 1: Failing unit tests** `tests/unit/qa-input.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCheckInput, prepareCheck, recordVerdict, validateVerdict } from '../../skills/protoblocks-site-builder/scripts/lib/qa-input.mjs';
import { initState, updateState, loadState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';

function setup() {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-qi-'));
  initState(theme, { url: 'http://a.local', path: '/x', qa: { maxIterations: 2 } });
  updateState(theme, (s) => {
    s.pages.push({ slug: 'home', status: 'building', url: 'http://a.local/home/', postId: 3, contentHash: 'h',
      design: { frames: [{ breakpoint: 'desktop', width: 1440, scale: 2, image: '/d.png' }] },
      sections: [{ n: 1, anchor: 'pb-s1', block: 'hero', status: 'building', crops: { desktop: '/c/pb-s1.png' }, qa: [] }] });
  });
  return theme;
}

const verdict = (pass, extra = {}) => ({ pass, anchor: 'pb-s1', numericPass: pass,
  breakpoints: [{ name: 'desktop', mode: 'diff', mismatch: pass ? 0.03 : 0.2, heightDelta: 0.01, numericPass: pass }, { name: 'mobile', mode: 'sanity', ok: true }],
  discrepancies: pass ? [] : [{ breakpoint: 'desktop', area: 'h1', issue: 'x', severity: 'high', fix: 'y' }], artifacts: [], ...extra });

test('buildCheckInput: diff for framed breakpoints, sanity for the rest, iteration numbering', () => {
  const theme = setup();
  const input = buildCheckInput(loadState(theme), theme, 'home', 1);
  assert.equal(input.url, 'http://a.local/home/');
  assert.equal(input.anchor, 'pb-s1');
  assert.deepEqual(input.qa, { mismatchMax: 0.08, heightDeltaMax: 0.03 });
  assert.deepEqual(input.breakpoints[0], { name: 'desktop', width: 1440, scale: 2, design: '/c/pb-s1.png', masks: [] });
  assert.deepEqual(input.breakpoints.slice(1).map((b) => [b.name, b.width, b.sanityOnly]), [['tablet', 834, true], ['mobile', 390, true]]);
  assert.ok(input.iterDir.endsWith(path.join('artifacts', 'home', 'pb-s1', 'iter-1')));
});

test('validateVerdict rejects pass with failing numbers or high discrepancies', () => {
  assert.deepEqual(validateVerdict(verdict(true)), []);
  assert.ok(validateVerdict({ ...verdict(true), numericPass: false }).length);
  assert.ok(validateVerdict({ ...verdict(true), discrepancies: [{ severity: 'high' }] }).length);
});

test('recordVerdict: fail → building and cap; pass → animating with baselines', () => {
  const theme = setup();
  const { input } = prepareCheck(theme, 'home', 1);
  const iterDir = path.dirname(input);
  fs.writeFileSync(path.join(iterDir, 'verdict.json'), JSON.stringify(verdict(false)));
  const r1 = recordVerdict(theme, 'home', 1, path.join(iterDir, 'verdict.json'));
  assert.deepEqual([r1.pass, r1.iteration, r1.capReached, r1.status], [false, 1, false, 'building']);

  const p2 = prepareCheck(theme, 'home', 1);
  assert.equal(p2.iteration, 2);
  const dir2 = path.dirname(p2.input);
  fs.writeFileSync(path.join(dir2, 'verdict.json'), JSON.stringify(verdict(false)));
  assert.equal(recordVerdict(theme, 'home', 1, path.join(dir2, 'verdict.json')).capReached, true);

  const p3 = prepareCheck(theme, 'home', 1);
  const dir3 = path.dirname(p3.input);
  fs.writeFileSync(path.join(dir3, 'desktop-render.png'), 'png');
  fs.writeFileSync(path.join(dir3, 'verdict.json'), JSON.stringify(verdict(true)));
  const r3 = recordVerdict(theme, 'home', 1, path.join(dir3, 'verdict.json'));
  assert.equal(r3.status, 'animating');
  const st = loadState(theme);
  assert.equal(st.pages[0].sections[0].qa.filter((q) => q.iteration === 3).length, 2);
  assert.equal(st.library.hero.baselines[0].breakpoint, 'desktop');
  assert.ok(fs.existsSync(st.library.hero.baselines[0].file));

  fs.writeFileSync(path.join(dir3, 'forged.json'), JSON.stringify({ ...verdict(true), numericPass: false }));
  assert.throws(() => recordVerdict(theme, 'home', 1, path.join(dir3, 'forged.json')), (e) => e.code === 'EVERDICT');
});
```

- [ ] **Step 2: Run** `npm test` → Expected: FAIL.

- [ ] **Step 3: Implement** `scripts/lib/qa-input.mjs`

```js
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadState, updateState, DEFAULT_QA } from './state.mjs';
import { artifactsDir } from './intake.mjs';

export const STANDARD_WIDTHS = { desktop: 1440, tablet: 834, mobile: 390 };

const findSection = (state, slug, n) => {
  const page = state.pages.find((p) => p.slug === slug);
  if (!page) throw new Error(`No page "${slug}" in state.`);
  const section = page.sections.find((s) => s.n === Number(n));
  if (!section) throw new Error(`No section ${n} on page "${slug}".`);
  return { page, section };
};

export function buildCheckInput(state, themeDir, slug, n) {
  const { page, section } = findSection(state, slug, n);
  if (!page.url) throw new Error(`Page "${slug}" has no URL yet — run page.mjs build first.`);
  if (!section.crops || !Object.keys(section.crops).length) throw new Error(`Section ${n} has no design crops — run intake.mjs crop first.`);
  const qa = { ...DEFAULT_QA, ...(state.site.qa ?? {}) };
  const frames = page.design?.frames ?? [];
  const breakpoints = [];
  for (const f of frames) {
    if (section.crops[f.breakpoint]) breakpoints.push({ name: f.breakpoint, width: f.width, scale: f.scale, design: section.crops[f.breakpoint], masks: section.masks?.[f.breakpoint] ?? [] });
  }
  for (const [name, width] of Object.entries(STANDARD_WIDTHS)) {
    if (!breakpoints.some((b) => b.name === name)) breakpoints.push({ name, width, sanityOnly: true });
  }
  const iteration = 1 + Math.max(0, ...(section.qa ?? []).map((q) => q.iteration ?? 0));
  return {
    url: page.url,
    anchor: section.anchor,
    iterDir: path.join(artifactsDir(themeDir), slug, section.anchor, `iter-${iteration}`),
    qa: { mismatchMax: qa.mismatchMax, heightDeltaMax: qa.heightDeltaMax },
    breakpoints,
  };
}

export function prepareCheck(themeDir, slug, n) {
  const input = buildCheckInput(loadState(themeDir), themeDir, slug, n);
  fs.mkdirSync(input.iterDir, { recursive: true });
  const file = path.join(input.iterDir, 'input.json');
  fs.writeFileSync(file, `${JSON.stringify(input, null, 2)}\n`);
  updateState(themeDir, (s) => { findSection(s, slug, n).section.status = 'verifying'; });
  return { input: file, iteration: Number(path.basename(input.iterDir).replace('iter-', '')) };
}

export function validateVerdict(v) {
  const errors = [];
  if (typeof v?.pass !== 'boolean') errors.push('verdict.pass must be boolean');
  if (v?.pass) {
    if (v.numericPass !== true) errors.push('pass is true but numericPass is not');
    if ((v.discrepancies ?? []).some((d) => d.severity === 'high')) errors.push('pass is true but a high-severity discrepancy exists');
    if ((v.breakpoints ?? []).some((b) => b.mode === 'diff' && b.numericPass === false)) errors.push('pass is true but a diff breakpoint failed its thresholds');
  }
  return errors;
}

export function recordVerdict(themeDir, slug, n, verdictFile) {
  const verdict = JSON.parse(fs.readFileSync(verdictFile, 'utf8'));
  const errors = validateVerdict(verdict);
  if (errors.length) {
    const e = new Error(`Inconsistent verdict ${verdictFile}:\n- ${errors.join('\n- ')}`);
    e.code = 'EVERDICT';
    throw e;
  }
  const iterDir = path.dirname(verdictFile);
  const iteration = Number(path.basename(iterDir).replace('iter-', ''));
  let result;
  updateState(themeDir, (s) => {
    const { page, section } = findSection(s, slug, n);
    section.qa ??= [];
    for (const b of verdict.breakpoints ?? []) {
      section.qa.push({ iteration, breakpoint: b.name, mode: b.mode, ...(b.mode === 'diff' ? { mismatch: b.mismatch, heightDelta: b.heightDelta } : {}), pass: verdict.pass, verdict: verdictFile });
    }
    if (verdict.pass) {
      section.status = 'animating';
      const lib = s.library[section.block] ??= { usedOn: [] };
      lib.baselines ??= [];
      for (const b of (verdict.breakpoints ?? []).filter((x) => x.mode === 'diff')) {
        const src = path.join(iterDir, `${b.name}-render.png`);
        if (!fs.existsSync(src)) continue;
        const dest = path.join(artifactsDir(themeDir), 'baselines', slug, `${section.anchor}-${b.name}.png`);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        const frame = (page.design?.frames ?? []).find((f) => f.breakpoint === b.name) ?? {};
        lib.baselines = lib.baselines.filter((x) => !(x.page === slug && x.anchor === section.anchor && x.breakpoint === b.name));
        lib.baselines.push({ page: slug, anchor: section.anchor, breakpoint: b.name, file: dest, width: frame.width ?? STANDARD_WIDTHS[b.name], scale: frame.scale ?? 1 });
      }
    } else {
      section.status = 'building';
    }
    const max = s.site.qa?.maxIterations ?? DEFAULT_QA.maxIterations;
    result = { pass: verdict.pass, iteration, capReached: !verdict.pass && iteration >= max, status: section.status };
  });
  return result;
}

function main(argv) {
  const [cmd, themeDir, slug, n, file] = argv;
  const out = (v) => process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
  if (cmd === 'prepare' && themeDir && slug && n) return out(prepareCheck(themeDir, slug, n));
  if (cmd === 'record' && themeDir && slug && n && file) return out(recordVerdict(themeDir, slug, n, file));
  process.stderr.write('Usage: node qa-input.mjs prepare <themeDir> <slug> <n> | record <themeDir> <slug> <n> <verdict.json>\n');
  process.exit(64);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); }
}
```

- [ ] **Step 4: Implement** `scripts/lib/regress.mjs`

```js
#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadState } from './state.mjs';

export const REGRESSION = { mismatchMax: 0.01, heightDeltaMax: 0.005 };

export async function regress(themeDir, block, { browser } = {}) {
  const { shoot } = await import('../qa/shoot.mjs');
  const { diffImages } = await import('../qa/diff.mjs');
  const { launchBrowser } = await import('../qa/browser.mjs');
  const state = loadState(themeDir);
  const baselines = state.library[block]?.baselines ?? [];
  const own = !browser;
  const b = browser ?? await launchBrowser();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-regress-'));
  const results = [];
  try {
    for (const base of baselines) {
      const page = state.pages.find((p) => p.slug === base.page);
      if (!page?.url) { results.push({ page: base.page, anchor: base.anchor, breakpoint: base.breakpoint, pass: false, error: 'page has no url' }); continue; }
      try {
        const out = path.join(tmp, `${base.page}-${base.anchor}-${base.breakpoint}.png`);
        await shoot({ url: page.url, selector: `#${base.anchor}`, width: base.width, scale: base.scale, out, browser: b });
        const d = await diffImages({ design: base.file, render: out });
        results.push({ page: base.page, anchor: base.anchor, breakpoint: base.breakpoint, mismatch: d.mismatch, heightDelta: d.heightDelta, pass: d.mismatch <= REGRESSION.mismatchMax && d.heightDelta <= REGRESSION.heightDeltaMax });
      } catch (e) {
        results.push({ page: base.page, anchor: base.anchor, breakpoint: base.breakpoint, pass: false, error: `${e.code ? `[${e.code}] ` : ''}${e.message}` });
      }
    }
  } finally {
    if (own) await b.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { block, results, pass: results.every((r) => r.pass) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const [themeDir, block] = process.argv.slice(2);
  if (!themeDir || !block) { process.stderr.write('Usage: node regress.mjs <themeDir> <block>\n'); process.exit(64); }
  regress(themeDir, block).then((r) => { process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); if (!r.pass) process.exit(1); })
    .catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1); });
}
```

- [ ] **Step 5: QA test** `tests/qa/regress.test.mjs`

```js
import assert from 'node:assert/strict';
import path from 'node:path';
import { qtest, tmpDir, serveFixtures, QA_DIR } from './helpers.mjs';

qtest('regress passes against its own baseline and fails against a different one', async () => {
  const { regress } = await import('../../skills/protoblocks-site-builder/scripts/lib/regress.mjs');
  const { initState, updateState } = await import('../../skills/protoblocks-site-builder/scripts/lib/state.mjs');
  const { shoot } = await import(path.join(QA_DIR, 'shoot.mjs'));
  const srv = await serveFixtures();
  try {
    const theme = tmpDir();
    initState(theme, { url: srv.url, path: '/x' });
    const url = `${srv.url}/section.html`;
    const good = (await shoot({ url, selector: '#pb-s1', width: 1440, out: path.join(theme, 'base1.png') })).out;
    const other = (await shoot({ url, selector: '#pb-s2', width: 1440, out: path.join(theme, 'base2.png') })).out;
    updateState(theme, (s) => {
      s.pages.push({ slug: 'fx', status: 'building', url, sections: [] });
      s.library.hero = { usedOn: ['fx'], baselines: [{ page: 'fx', anchor: 'pb-s1', breakpoint: 'desktop', file: good, width: 1440, scale: 1 }] };
      s.library.cta = { usedOn: ['fx'], baselines: [{ page: 'fx', anchor: 'pb-s1', breakpoint: 'desktop', file: other, width: 1440, scale: 1 }] };
    });
    assert.equal((await regress(theme, 'hero')).pass, true);
    assert.equal((await regress(theme, 'cta')).pass, false);
  } finally { await srv.close(); }
});
```

Run: `npm test && npm run test:qa` → Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add skills/protoblocks-site-builder/scripts/lib/qa-input.mjs skills/protoblocks-site-builder/scripts/lib/regress.mjs tests/unit/qa-input.test.mjs tests/qa/regress.test.mjs
git commit -m "feat(loop): QA input/verdict plumbing with integrity check and regressions"
```

---

### Task 7: `protoblocks-design-breakdown` skill

**Files:**
- Create: `skills/protoblocks-design-breakdown/SKILL.md`
- Create: `skills/protoblocks-design-breakdown/references/intake.md`
- Create: `skills/protoblocks-design-breakdown/references/breakdown.md`

**Interfaces:**
- Consumes (documents exact CLI usage): `intake.mjs add-frame|crop|from-url`, `qa/segment.mjs analyze`, `library.mjs list`, `state.mjs get/set`, `media.mjs import`.
- Produces: the approved section plan in state: each `pages[i].sections[j]` gets `label`, `decision` (`new|reuse|extend`), `block` (slug), `notes`, and the page gets `status: 'building'` only after approval is recorded at `pages[i].plan = { approvedAt: <ISO>, by: 'developer' }`.

- [ ] **Step 1: Write `SKILL.md`** (≤ ~7 KB; frontmatter + body)

```markdown
---
name: protoblocks-design-breakdown
description: Use when a design (image, screenshot, PDF page, Figma frame, Penpot board, or live URL) must be turned into a plan of Proto-Blocks sections for a WordPress page - normalizes frames, segments and crops sections, maps each to reuse/extend/new blocks against the theme's block library, and gets the developer's approval. Normally invoked by protoblocks-site-builder.
---
```
Body sections, in this order, written in full:
1. **Scripts** — `PB="${CLAUDE_SKILL_DIR}/../protoblocks-site-builder/scripts"`; `THEME` from the build state (`site.theme.slug` → `<publicPath>/wp-content/themes/<slug>`).
2. **Step 1 — Intake to frames** — one paragraph per source pointing to `references/intake.md`; always end with `node "$PB/lib/intake.mjs" add-frame "$THEME" <page> <breakpoint> <png>`; `ESCALE` → ask the developer for the frame's CSS width once; desktop frame required, others optional.
3. **Step 2 — Segment** — `node "$PB/qa/segment.mjs" analyze <desktop frame>`; treat `background` cuts as strong boundaries and `gap` cuts as candidates; open the frame image and confirm each band by eye; header and footer bands are the first/last bands that contain logo + nav / legal + links. Map mobile bands to desktop sections by order and content. Write `ranges.json` (image pixels) and run `intake.mjs crop`.
4. **Step 3 — Model each section** — follow `references/breakdown.md`: pattern label, content model (fewest richest regions; repeater vs gallery vs wysiwyg vs inner-blocks — read `protoblocks` skill `references/composition.md`), variants.
5. **Step 4 — Match the library** — `node "$PB/lib/library.mjs" list "$THEME"`; decision rules (reuse / extend additive-only / new), intra-page merge, generic naming. Header/footer map to `site-header`/`site-footer` (shared parts): on later pages they are `reuse` and only verified.
6. **Step 5 — Plan gate (mandatory)** — present the plan table:
   `| # | Section | Crop | Decision | Block | Fields / controls | Notes |`
   with crop paths; list assets that will be cropped from the design ("replace with originals"); then STOP and wait for approval. Record decisions with `state.mjs set` (one `set` per section field, or `updateState` via a short node -e), then `pages.<i>.plan` = `{"approvedAt":"<ISO>","by":"developer"}` and page `status` `"building"`.
7. **Iron rules** — never build before approval; never name blocks after pages; never extend a block in a way that changes existing instances' output; copy text exactly from structured sources (Figma/Penpot/URL), never paraphrase design copy.

- [ ] **Step 2: Write `references/intake.md`**

Content (≤ ~250 lines), one section per source with exact calls:
- **Image / screenshot / PDF**: PDF → render the page to PNG first (`sips -s format png in.pdf --out out.png` on macOS, or ask for a PNG); JPEG → convert with `sips -s format png`; scale detection rules (Global Constraints ranges) and when to ask.
- **Figma** (Figma MCP): `get_metadata` on the page/frame URL to find top-level frames per breakpoint; `get_screenshot` per frame (save PNG to a temp path, then `add-frame`); `get_design_context` per top-level child for exact text and styles; `get_variable_defs` for tokens (hand to `protoblocks-site-setup` tokens step); `download_assets` for images/icons → import via `media.mjs import` with alt text. Note top-level children usually equal sections → use their y/height (× scale) as crop ranges instead of segmentation.
- **Penpot** (Penpot MCP): read `high_level_overview` first; `export_shape` per board (PNG) → `add-frame`; `execute_code` to list board children with y/height and text content; library colors/typographies for tokens.
- **Live URL**: `intake.mjs from-url <THEME> <page> <url> --widths 1440,390`; DOM text via a short Playwright script or `shoot` + manual reading.
- **MCP unavailable**: say which server failed; offer the exported-image path; never guess content.
- **Assets** table: source → how to get originals → fallback (crop from frame with `segment.mjs crop` + list in "replace with originals"; icons recreated as inline SVG); every imported asset needs alt text; masks: add cropped/placeholder regions to `sections[j].masks.<bp>` (`[{x,y,w,h}]` in crop pixel coords) so QA ignores them.

- [ ] **Step 3: Write `references/breakdown.md`**

Content (≤ ~300 lines):
- Pattern catalog table (pattern → typical content model → typical controls): hero (split / centered / background media), logo wall (gallery control), feature grid (repeater of icon+title+text; columns control), media-text (image + wysiwyg; imagePosition control), stats (repeater value+label), testimonial(s) (repeater or single), pricing (repeater of plans with features list wysiwyg; highlight toggle), FAQ (repeater q/a → accordion with Interactivity API), CTA band, content/rich text (inner-blocks), team grid, timeline/steps, contact/form embed, footer/header.
- Band rules: a section = a full-width band with its own background or a clear vertical gap; never split one visual band; never merge bands with different backgrounds.
- Decision rules with examples for reuse / extend / new, the "additive extend" test (new control defaults to current output → existing pages unchanged; regressions verify), intra-page merge, and when NOT to merge (structurally different on mobile).
- Naming rules (generic, kebab-case, ≤ 3 words; good/bad examples).
- Shared micro-elements: buttons, eyebrows, section headings → token-based classes in the theme (documented in the plan's Notes), not blocks.
- The plan table format with a filled example for a 6-section landing page.

- [ ] **Step 4: Verify**

Run: `head -4 skills/protoblocks-design-breakdown/SKILL.md && wc -c skills/protoblocks-design-breakdown/SKILL.md`
Expected: frontmatter present; SKILL.md ≤ ~7 KB. Cross-check every command against the CLIs in Tasks 1, 5 and Stage 3 (`node <cli>` without args prints usage).

- [ ] **Step 5: Commit**

```bash
git add skills/protoblocks-design-breakdown
git commit -m "docs(breakdown): design intake and section breakdown skill"
```

---

### Task 8: `protoblocks-section-loop` skill

**Files:**
- Create: `skills/protoblocks-section-loop/SKILL.md`
- Create: `skills/protoblocks-section-loop/references/build.md`
- Create: `skills/protoblocks-section-loop/references/verify.md`
- Create: `skills/protoblocks-section-loop/references/header-footer.md`
- Modify: `skills/protoblocks-site-builder/SKILL.md` (pointer to breakdown + section loop)

**Interfaces:**
- Consumes (documents exact usage): `gates.mjs`, `media.mjs`, `page.mjs build`, `library.mjs record`, `qa-input.mjs prepare|record`, `regress.mjs`, `parts.mjs` + `navigation.mjs` (Stage 2), the `visual-qa` subagent (Stage 3).
- Produces: the per-section procedure Stage 5 extends with the animate step (this task leaves an "Animate" heading that says "handled by protoblocks-motion (Stage 5): when status is `animating`, load that skill").

- [ ] **Step 1: Write `SKILL.md`** (≤ ~8 KB)

```markdown
---
name: protoblocks-section-loop
description: Use when building, verifying and fixing one Proto-Blocks section of a planned page until it visually matches its design crop - authoring the block, passing build gates, assembling the page, dispatching the visual-qa subagent, recording verdicts, and handling the iteration cap. Normally invoked by protoblocks-site-builder for each section in order.
---
```
Body sections, written in full:
1. **Scripts & state** — `PB`, `THEME`, page slug, section `n`; read the section from state first; resume rules by `status` (`planned|building` → Build; `verifying` → re-run Verify from `prepare`; `animating` → Animate; `done|skipped` → next section).
2. **Build** (details in `references/build.md`):
   - Load the `protoblocks` skill for authoring rules (always).
   - decision `new` → `wp proto-blocks create <block> --dir=theme`, then author block.json/template.php/CSS; `extend` → add the variant control with a default that reproduces current output; `reuse` → no block changes.
   - Assets: `media.mjs import` (alt required) → `imageAttr` objects in `section.attrs`.
   - Write `section.block`, `section.attrs`, `section.inner` via state.
   - Gates: `node "$PB/lib/gates.mjs" "$THEME" <block> --attrs '<attrs>'` — fix and re-run until `ok`.
   - `node "$PB/lib/page.mjs" build "$THEME" <page>`; `EEDITED`/`ESLUGTAKEN` → ask the developer before `--force`.
   - `node "$PB/lib/library.mjs" record "$THEME" <block> <page> --purpose "<one line>"`.
   - extend → `node "$PB/lib/regress.mjs" "$THEME" <block>`; failures → fix the block until previous pages are unchanged.
   - Commit in the theme fork: `git -C "$THEME" add -A && git -C "$THEME" commit -m "feat(block): <block>"` (skip if nothing changed).
3. **Verify** (details in `references/verify.md`):
   - `node "$PB/lib/qa-input.mjs" prepare "$THEME" <page> <n>` → input path.
   - Dispatch the `visual-qa` subagent (Claude Code: Agent tool, subagent type `protoblocks-skill:visual-qa`; elsewhere: run `scripts/qa/check-section.mjs` yourself and judge the composites with the same rubric) with: "CheckInput: <path>".
   - `node "$PB/lib/qa-input.mjs" record "$THEME" <page> <n> <iterDir>/verdict.json`.
   - pass → status `animating` → Animate. fail → apply the verdict's fixes (highest severity first), re-run gates + page build, Verify again. `capReached` → show the developer the latest composite path(s) and the open discrepancies and ask: accept (set status `animating` and note "accepted by developer" in `section.notes`), guide (apply their direction, keep iterating), or skip (status `skipped`).
4. **Animate** — "When status is `animating`, load the `protoblocks-motion` skill." (Stage 5 fills this.)
5. **Iron rules** — never mark a section passing without a recorded verdict; never edit `verdict.json`; never lower QA thresholds to get a pass (only the developer may change `site.qa`); never `--force` without the developer's OK; one section at a time, in plan order.

- [ ] **Step 2: Write `references/build.md`**

Content (≤ ~250 lines): authoring checklist for builder blocks — `supports.anchor: true` (gate), `get_block_wrapper_attributes()` on the root, Tailwind with theme tokens (`text-h1`, `bg-accent`, `font-display`, `rounded-card`) and responsive prefixes (`md:`, `lg:`) matched to the design's breakpoints, vanilla CSS in `style.css` scoped under the block class when Tailwind is awkward, `data-proto-field` on every editable element even when empty, image attr shape `{id,url,alt,caption,size}`, `loading="lazy"` except the first section's hero image (`fetchpriority="high"`), no hard-coded copy in templates (copy lives in attributes), container widths from the design (`max-w-[1200px] mx-auto px-6` style, recorded once per site in `state.site.tokens.spacing` if repeated); gate failures table (step → typical cause → fix); `section.inner` raw block markup examples (core/paragraph, core/buttons) for inner-blocks slots; how to set attrs via state (`node "$PB/lib/state.mjs" set "$THEME" pages.<i>.sections.<j>.attrs '<json>'`).

- [ ] **Step 3: Write `references/verify.md`**

Content (≤ ~200 lines): the verify loop as a numbered procedure; how to read a verdict (fields), fix strategy by discrepancy type (spacing → padding/margin tokens; type → text token/weight; layout → grid/flex structure; color → token; height delta → line-height/padding/image aspect), masks for cropped/placeholder assets (`sections[j].masks.<bp>`), when the diff is noisy because of real-vs-placeholder images (mask, don't chase), the cap conversation script, regression procedure for `extend`.

- [ ] **Step 4: Write `references/header-footer.md`**

Content (≤ ~150 lines): header/footer are sections of the first page (label `header`/`footer`, blocks `site-header`/`site-footer`) built through the same loop, with these differences: block has an `inner-blocks` field holding `core/navigation {"ref":<id>}` (from `site.navigation.menus.<key>.id`), mobile overlay styled in the block CSS against `.wp-block-navigation__responsive-container` / `.wp-block-navigation__responsive-container-open`; after the block passes QA on the page, write the parts: `node "$PB/lib/parts.mjs" overrides "$THEME"` (ask before `remove-override --confirm`), then `parts.mjs write "$THEME" header <file>` where the file content is the `partMarkup` output; then remove the header/footer sections from the page spec (set their `status` to `done` and remove their `block` from the page by setting `"inPart": true` — `page.mjs` skips sections whose `inPart` is true) and rebuild the page so they render once from the template parts; re-verify the page's first content section still passes.
  **Note for the implementer:** `pageSpecFromState` (Task 4) must also skip sections with `inPart: true` — add that filter and a unit test case in `tests/unit/page-spec.test.mjs` as part of this task.

- [ ] **Step 5: Add pointers in `skills/protoblocks-site-builder/SKILL.md`**

After the site-setup pointer: "**Each page** — `protoblocks-design-breakdown` (frames → crops → plan → approval), then `protoblocks-section-loop` for every section in plan order (build → gates → page → visual-qa → record; animate via `protoblocks-motion`)."

- [ ] **Step 6: Verify**

Run: `npm test` → Expected: PASS (including the new `inPart` unit case).
Run: `head -4 skills/protoblocks-section-loop/SKILL.md` → frontmatter present.

- [ ] **Step 7: Commit**

```bash
git add skills/protoblocks-section-loop skills/protoblocks-site-builder/SKILL.md skills/protoblocks-site-builder/scripts/lib/page.mjs tests/unit/page-spec.test.mjs
git commit -m "docs(loop): section build/verify loop skill with header/footer parts flow"
```

---

## Self-review notes

- Spec §5.1 intake (Task 1 + Task 7 refs), §5.2 assets (Task 3 + refs), §5.3 breakdown + §5.4 plan gate (Task 7), §6.1 build gates + page assembly (Tasks 2, 4), §6.2 verify loop, cap, regressions (Task 6, Task 8), §4 step 6 header/footer through the loop (Task 8 header-footer.md + `inPart`), §10 guards (EEDITED, ESLUGTAKEN, EVERDICT).
- Cross-stage names: `stateDir` (Stage 1, exported), `artifactsDir` (Task 1), `checkSection` input shape (Stage 3) produced by `buildCheckInput`, `refreshMenus` (Stage 2), `cropRanges`/`shoot`/`diffImages`/`launchBrowser` (Stage 3).
