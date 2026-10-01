# Stage 3 — QA Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The measurement layer of the build/verify loop: a QA package (Playwright + sharp + pixelmatch), element/full-page screenshots with animations off, a perceptual diff with masks and a design|render|heatmap composite, a responsive sanity checker, a design band segmenter + cropper, a one-call `check-section` runner, and the `visual-qa` subagent that turns measurements into a verdict JSON.

**Architecture:** `skills/protoblocks-site-builder/scripts/qa/` is its own npm package (deps installed on demand by the developer/agent; preflight already reports it). Small modules with one job each: `image.mjs` (raw pixel I/O), `diff.mjs`, `browser.mjs` (shared page setup), `shoot.mjs`, `sanity.mjs`, `segment.mjs`, `check-section.mjs`. Every module exports functions and doubles as a CLI printing JSON. Tests live in `tests/qa/` (they need the QA deps) and generate their image fixtures with sharp at runtime; browser tests serve local fixture HTML with `node:http`.

**Tech Stack:** Node ≥ 18 ESM; `playwright@^1.63.0` (Chromium), `sharp@^0.35.5`, `pixelmatch@^7.2.0`.

**Spec:** `docs/superpowers/specs/2026-10-01-site-builder-design.md` (§6.2 Visual QA, §5.3 step 1 segmentation, §2.1 subagent)

**Builds on:** Stage 1 (`exec.mjs`, `state.mjs`, `preflight.mjs` — its `playwright` check looks for `scripts/qa/node_modules/playwright`). Stage 2 (theme intro overlay is suppressed via `sessionStorage.protoIntroShown = 'true'`; theme hides it with `.proto-intro`).

## Global Constraints

- QA defaults (from state `site.qa`): `mismatchMax 0.08`, `heightDeltaMax 0.03`, `maxIterations 5`.
- Pass rule: `mismatch ≤ mismatchMax` AND `heightDelta ≤ heightDeltaMax` AND no `high` severity discrepancies. A section cannot pass when its numbers fail (`numericPass: false`), regardless of judgement.
- Screenshots for visual QA: viewport width = design width, `deviceScaleFactor` = design scale, `reducedMotion: 'reduce'`, intro overlay suppressed (`sessionStorage.protoIntroShown = 'true'` + `.proto-intro{display:none!important}`), admin bar hidden, wait for fonts + network idle + images, `ignoreHTTPSErrors: true`.
- Diff: render is resized to the design's pixel width; comparison is top-aligned over the overlapping height; `heightDelta = |renderH − designH| / designH`; masks are rectangles in design pixel coordinates excluded from both images and from the denominator; pixelmatch `threshold 0.1`, `includeAA: false`.
- Composite: three panels left→right `design | render | heatmap`, each scaled to ≤ 800 px wide, 16 px white gutters.
- Uncaught page errors (`pageerror`) make `numericPass` false; `console.error` messages are reported but don't flip it.
- Artifacts: `<theme>/.protoblocks/artifacts/<page>/<anchor>/iter-<n>/` (gitignored by the state init).
- The `visual-qa` subagent never edits theme or site files; it only runs QA scripts, reads images, and writes `verdict.json` in the iteration folder.
- QA package deps are installed with `npm install` inside `scripts/qa/` and Chromium with `npx playwright install chromium`; `package-lock.json` is committed.
- QA tests: `npm run test:qa` (`node --test --test-concurrency=1 tests/qa/*.test.mjs`); they skip with a clear reason when `scripts/qa/node_modules` is missing.

## Review Focus

1. **Render taller/shorter than the design** — diff must not crash or silently crop; it reports `heightDelta` and compares only the overlap; test in Task 2.
2. **Retina designs (@2x) vs 1x renders** — render resized to design width before comparing; test in Task 2 (render half the width of the design).
3. **Anchor not on the page** (section never inserted, wrong anchor) — `shoot` throws `ENOSELECTOR` with the URL and selector, and `check-section` reports it as a failed breakpoint instead of crashing the run; tests in Tasks 3 and 6.
4. **Lazy-loaded images below the fold** — screenshots wait until images are loaded (scroll-through + `complete` check); fixture test in Task 3 uses `loading="lazy"`.
5. **Full-width background images touching the page edge** — segmentation uses edge colour per row and requires a background change to persist ≥ `minBand` rows, so an image edge doesn't create a spurious cut; test in Task 5.

---

## File Structure

```
skills/protoblocks-site-builder/scripts/qa/
├── package.json / package-lock.json
├── image.mjs          loadRaw, rawToPng, resizeToWidth, cropRaw
├── diff.mjs           compareRaw, diffImages (+ composite) — CLI
├── browser.mjs        launchBrowser, openPage (shared context setup)
├── shoot.mjs          shoot — CLI
├── sanity.mjs         sanity — CLI
├── segment.mjs        rowBackgrounds, findCuts, cropRanges — CLI analyze|crop
└── check-section.mjs  checkSection — CLI
agents/visual-qa.md    plugin subagent
tests/qa/
├── helpers.mjs        haveQaDeps, qtest, makeImage, serveFixtures
├── fixtures/          section.html, broken.html
└── {image,diff,shoot,sanity,segment,check-section}.test.mjs
```

---

### Task 1: QA package + image helpers

**Files:**
- Create: `skills/protoblocks-site-builder/scripts/qa/package.json` (+ generated `package-lock.json`)
- Create: `skills/protoblocks-site-builder/scripts/qa/image.mjs`
- Create: `tests/qa/helpers.mjs`
- Create: `tests/qa/image.test.mjs`
- Modify: root `package.json` (add `"test:qa": "node --test --test-concurrency=1 tests/qa/*.test.mjs"`)
- Modify: `.gitignore` (ensure `skills/protoblocks-site-builder/scripts/qa/node_modules/` is ignored — Stage 1 ignored `scripts/node_modules/`, add this path too)

**Interfaces:**
- Produces:
  - `Raw = { data: Buffer /* RGBA */, width: number, height: number }`
  - `loadRaw(file) => Promise<Raw>`; `rawToPng(raw, file) => Promise<string>`; `resizeToWidth(raw, width) => Promise<Raw>`; `cropRaw(raw, {x, y, w, h}) => Raw` (sync, clamps to bounds).
  - `tests/qa/helpers.mjs`: `QA_DIR`, `haveQaDeps`, `qtest(name, fn)`, `makeImage({width, height, bg, rects: [{x,y,w,h,color}]}, file) => Promise<string>` (color as `[r,g,b]`), `tmpDir(prefix) => string`, `serveFixtures() => Promise<{url, close}>` (serves `tests/qa/fixtures/` over `node:http` on a random port).

- [ ] **Step 1: Write `scripts/qa/package.json` and install**

```json
{
  "name": "protoblocks-qa",
  "private": true,
  "type": "module",
  "engines": { "node": ">=18" },
  "dependencies": {
    "pixelmatch": "^7.2.0",
    "playwright": "^1.63.0",
    "sharp": "^0.35.5"
  }
}
```
Run: `cd skills/protoblocks-site-builder/scripts/qa && npm install && npx playwright install chromium`
Expected: install succeeds; `node_modules/playwright` exists.

- [ ] **Step 2: Write `tests/qa/helpers.mjs`**

```js
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const QA_DIR = path.resolve(HERE, '../../skills/protoblocks-site-builder/scripts/qa');
export const haveQaDeps = fs.existsSync(path.join(QA_DIR, 'node_modules', 'playwright')) && fs.existsSync(path.join(QA_DIR, 'node_modules', 'sharp'));
export const qtest = (name, fn) => (haveQaDeps ? test(name, fn) : test.skip(`${name} (run npm install in scripts/qa first)`, fn));
export const tmpDir = (prefix = 'pb-qa-') => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

export async function makeImage({ width, height, bg = [255, 255, 255], rects = [] }, file) {
  const { default: sharp } = await import(path.join(QA_DIR, 'node_modules', 'sharp', 'lib', 'index.js'));
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...bg, 255], i * 4);
  for (const r of rects) {
    for (let y = r.y; y < Math.min(height, r.y + r.h); y++) {
      for (let x = r.x; x < Math.min(width, r.x + r.w); x++) data.set([...r.color, 255], (y * width + x) * 4);
    }
  }
  await sharp(data, { raw: { width, height, channels: 4 } }).png().toFile(file);
  return file;
}

export function serveFixtures() {
  const root = path.join(HERE, 'fixtures');
  const server = http.createServer((req, res) => {
    const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    const type = p.endsWith('.html') ? 'text/html' : p.endsWith('.png') ? 'image/png' : p.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) });
  }));
}
```

- [ ] **Step 3: Write failing test** `tests/qa/image.test.mjs`

```js
import assert from 'node:assert/strict';
import path from 'node:path';
import { qtest, makeImage, tmpDir, QA_DIR } from './helpers.mjs';

qtest('loadRaw / resizeToWidth / cropRaw / rawToPng', async () => {
  const { loadRaw, resizeToWidth, cropRaw, rawToPng } = await import(path.join(QA_DIR, 'image.mjs'));
  const dir = tmpDir();
  const file = await makeImage({ width: 200, height: 100, bg: [255, 255, 255], rects: [{ x: 0, y: 0, w: 100, h: 100, color: [255, 0, 0] }] }, path.join(dir, 'a.png'));
  const raw = await loadRaw(file);
  assert.equal(raw.width, 200);
  assert.equal(raw.height, 100);
  assert.deepEqual([...raw.data.subarray(0, 4)], [255, 0, 0, 255]);
  const half = await resizeToWidth(raw, 100);
  assert.equal(half.width, 100);
  assert.equal(half.height, 50);
  const crop = cropRaw(raw, { x: 150, y: 90, w: 100, h: 100 });
  assert.equal(crop.width, 50);
  assert.equal(crop.height, 10);
  assert.deepEqual([...crop.data.subarray(0, 4)], [255, 255, 255, 255]);
  const out = await rawToPng(crop, path.join(dir, 'c.png'));
  assert.equal((await loadRaw(out)).width, 50);
});
```

- [ ] **Step 4: Run** `npm run test:qa` → Expected: FAIL (`image.mjs` missing).

- [ ] **Step 5: Implement** `scripts/qa/image.mjs`

```js
import sharp from 'sharp';

export async function loadRaw(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export async function rawToPng(raw, file) {
  await sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } }).png().toFile(file);
  return file;
}

export async function resizeToWidth(raw, width) {
  if (raw.width === width) return raw;
  const { data, info } = await sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
    .resize({ width, kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export function cropRaw(raw, { x, y, w, h }) {
  const x0 = Math.max(0, Math.min(raw.width, Math.round(x)));
  const y0 = Math.max(0, Math.min(raw.height, Math.round(y)));
  const cw = Math.max(0, Math.min(raw.width - x0, Math.round(w)));
  const ch = Math.max(0, Math.min(raw.height - y0, Math.round(h)));
  const data = Buffer.alloc(cw * ch * 4);
  for (let row = 0; row < ch; row++) {
    const start = ((y0 + row) * raw.width + x0) * 4;
    raw.data.copy(data, row * cw * 4, start, start + cw * 4);
  }
  return { data, width: cw, height: ch };
}
```

- [ ] **Step 6: Run** `npm run test:qa` → Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add .gitignore package.json skills/protoblocks-site-builder/scripts/qa/package.json skills/protoblocks-site-builder/scripts/qa/package-lock.json skills/protoblocks-site-builder/scripts/qa/image.mjs tests/qa/helpers.mjs tests/qa/image.test.mjs
git commit -m "feat(qa): QA package and raw image helpers"
```

---

### Task 2: Perceptual diff + composite

**Files:**
- Create: `skills/protoblocks-site-builder/scripts/qa/diff.mjs`
- Create: `tests/qa/diff.test.mjs`

**Interfaces:**
- Consumes: `loadRaw`, `rawToPng`, `resizeToWidth`, `cropRaw` (Task 1).
- Produces:
  - `MASK_COLOR = [255, 0, 255]`
  - `compareRaw(design: Raw, render: Raw, { threshold = 0.1, masks = [] }) => { mismatch, heightDelta, diffPixels, comparedPixels, width, designHeight, renderHeight, heatmap: Raw }` — requires equal widths (throws `Error` code `EWIDTH` otherwise).
  - `diffImages({ design, render, out?, masks?, threshold? }) => Promise<{ mismatch, heightDelta, diffPixels, comparedPixels, width, designHeight, renderHeight, composite?: string }>` — `mismatch`/`heightDelta` rounded to 4 decimals.
  - CLI: `node diff.mjs --design d.png --render r.png [--out composite.png] [--masks '<json>'] [--threshold 0.1]`.

- [ ] **Step 1: Failing tests** `tests/qa/diff.test.mjs`

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { qtest, makeImage, tmpDir, QA_DIR } from './helpers.mjs';

const load = () => import(path.join(QA_DIR, 'diff.mjs'));

qtest('identical images have zero mismatch', async () => {
  const { diffImages } = await load();
  const d = tmpDir();
  const spec = { width: 300, height: 200, rects: [{ x: 20, y: 20, w: 100, h: 40, color: [0, 0, 0] }] };
  const a = await makeImage(spec, path.join(d, 'a.png'));
  const b = await makeImage(spec, path.join(d, 'b.png'));
  const r = await diffImages({ design: a, render: b, out: path.join(d, 'c.png') });
  assert.equal(r.mismatch, 0);
  assert.equal(r.heightDelta, 0);
  assert.ok(fs.existsSync(r.composite));
});

qtest('a moved block produces mismatch proportional to changed pixels', async () => {
  const { diffImages } = await load();
  const d = tmpDir();
  const a = await makeImage({ width: 100, height: 100, rects: [{ x: 0, y: 0, w: 10, h: 10, color: [0, 0, 0] }] }, path.join(d, 'a.png'));
  const b = await makeImage({ width: 100, height: 100, rects: [{ x: 50, y: 50, w: 10, h: 10, color: [0, 0, 0] }] }, path.join(d, 'b.png'));
  const r = await diffImages({ design: a, render: b });
  assert.equal(r.diffPixels, 200);
  assert.equal(r.mismatch, 0.02);
});

qtest('masks exclude regions from score and denominator', async () => {
  const { diffImages } = await load();
  const d = tmpDir();
  const a = await makeImage({ width: 100, height: 100, rects: [{ x: 0, y: 0, w: 10, h: 10, color: [0, 0, 0] }] }, path.join(d, 'a.png'));
  const b = await makeImage({ width: 100, height: 100 }, path.join(d, 'b.png'));
  const r = await diffImages({ design: a, render: b, masks: [{ x: 0, y: 0, w: 20, h: 20 }] });
  assert.equal(r.diffPixels, 0);
  assert.equal(r.comparedPixels, 100 * 100 - 400);
});

qtest('taller render: heightDelta reported, overlap compared, no crash', async () => {
  const { diffImages } = await load();
  const d = tmpDir();
  const a = await makeImage({ width: 100, height: 100 }, path.join(d, 'a.png'));
  const b = await makeImage({ width: 100, height: 120 }, path.join(d, 'b.png'));
  const r = await diffImages({ design: a, render: b, out: path.join(d, 'c.png') });
  assert.equal(r.heightDelta, 0.2);
  assert.equal(r.mismatch, 0);
  assert.equal(r.renderHeight, 120);
});

qtest('half-width render is scaled up to the design width (retina design)', async () => {
  const { diffImages } = await load();
  const d = tmpDir();
  const a = await makeImage({ width: 200, height: 200, rects: [{ x: 0, y: 0, w: 100, h: 200, color: [0, 0, 255] }] }, path.join(d, 'a.png'));
  const b = await makeImage({ width: 100, height: 100, rects: [{ x: 0, y: 0, w: 50, h: 100, color: [0, 0, 255] }] }, path.join(d, 'b.png'));
  const r = await diffImages({ design: a, render: b });
  assert.equal(r.width, 200);
  assert.equal(r.heightDelta, 0);
  assert.ok(r.mismatch < 0.02, `mismatch ${r.mismatch}`);
});

qtest('compareRaw rejects different widths', async () => {
  const { compareRaw } = await load();
  const raw = (w) => ({ data: Buffer.alloc(w * 4 * 2), width: w, height: 2 });
  assert.throws(() => compareRaw(raw(2), raw(3)), (e) => e.code === 'EWIDTH');
});
```

- [ ] **Step 2: Run** `npm run test:qa` → Expected: FAIL.

- [ ] **Step 3: Implement** `scripts/qa/diff.mjs`

```js
#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import pixelmatch from 'pixelmatch';
import sharp from 'sharp';
import { loadRaw, resizeToWidth, cropRaw, rawToPng } from './image.mjs';

export const MASK_COLOR = [255, 0, 255];
const round4 = (n) => Math.round(n * 10000) / 10000;

function paintMasks(raw, masks) {
  const seen = new Uint8Array(raw.width * raw.height);
  let count = 0;
  for (const m of masks) {
    for (let y = Math.max(0, m.y); y < Math.min(raw.height, m.y + m.h); y++) {
      for (let x = Math.max(0, m.x); x < Math.min(raw.width, m.x + m.w); x++) {
        const i = y * raw.width + x;
        raw.data.set([...MASK_COLOR, 255], i * 4);
        if (!seen[i]) { seen[i] = 1; count++; }
      }
    }
  }
  return count;
}

export function compareRaw(design, render, { threshold = 0.1, masks = [] } = {}) {
  if (design.width !== render.width) {
    const e = new Error(`compareRaw needs equal widths (${design.width} vs ${render.width})`);
    e.code = 'EWIDTH';
    throw e;
  }
  const width = design.width;
  const height = Math.min(design.height, render.height);
  const a = cropRaw(design, { x: 0, y: 0, w: width, h: height });
  const b = cropRaw(render, { x: 0, y: 0, w: width, h: height });
  const masked = paintMasks(a, masks);
  paintMasks(b, masks);
  const heat = Buffer.alloc(width * height * 4);
  const diffPixels = pixelmatch(a.data, b.data, heat, width, height, { threshold, includeAA: false, alpha: 0.25, diffColor: [255, 0, 0] });
  const comparedPixels = width * height - masked;
  return {
    mismatch: comparedPixels ? diffPixels / comparedPixels : 0,
    heightDelta: design.height ? Math.abs(render.height - design.height) / design.height : 0,
    diffPixels,
    comparedPixels,
    width,
    designHeight: design.height,
    renderHeight: render.height,
    heatmap: { data: heat, width, height },
  };
}

async function panel(raw, maxWidth) {
  const img = sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } });
  const scaled = raw.width > maxWidth ? img.resize({ width: maxWidth }) : img;
  const { data, info } = await scaled.png().toBuffer({ resolveWithObject: true });
  return { input: data, width: info.width, height: info.height };
}

export async function writeComposite(design, render, heatmap, out, { maxPanel = 800, gutter = 16 } = {}) {
  const panels = [await panel(design, maxPanel), await panel(render, maxPanel), await panel(heatmap, maxPanel)];
  const width = panels.reduce((s, p) => s + p.width, 0) + gutter * 4;
  const height = Math.max(...panels.map((p) => p.height)) + gutter * 2;
  let left = gutter;
  const composites = panels.map((p) => { const c = { input: p.input, left, top: gutter }; left += p.width + gutter; return c; });
  await sharp({ create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).composite(composites).png().toFile(out);
  return out;
}

export async function diffImages({ design, render, out, masks = [], threshold = 0.1 }) {
  const d = await loadRaw(design);
  const r = await resizeToWidth(await loadRaw(render), d.width);
  const result = compareRaw(d, r, { threshold, masks });
  const { heatmap, ...rest } = result;
  const report = { ...rest, mismatch: round4(rest.mismatch), heightDelta: round4(rest.heightDelta) };
  if (out) report.composite = await writeComposite(d, r, heatmap, out);
  return report;
}

async function main(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
  if (!a.design || !a.render) { process.stderr.write('Usage: node diff.mjs --design d.png --render r.png [--out c.png] [--masks json] [--threshold 0.1]\n'); process.exit(64); }
  const r = await diffImages({ design: a.design, render: a.render, out: a.out, masks: a.masks ? JSON.parse(a.masks) : [], threshold: a.threshold ? Number(a.threshold) : 0.1 });
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); });
}
```

- [ ] **Step 4: Run** `npm run test:qa` → Expected: PASS. (If the "moved block" test's exact `diffPixels` differs by a few pixels due to anti-alias detection on hard edges, keep `includeAA: false` and assert the exact value the implementation produces only if it is within 190–210 — document the observed number in the report; do not loosen other tests.)

- [ ] **Step 5: Commit**

```bash
git add skills/protoblocks-site-builder/scripts/qa/diff.mjs tests/qa/diff.test.mjs
git commit -m "feat(qa): perceptual diff with masks, height delta and composite"
```

---

### Task 3: Browser setup + screenshots

**Files:**
- Create: `skills/protoblocks-site-builder/scripts/qa/browser.mjs`
- Create: `skills/protoblocks-site-builder/scripts/qa/shoot.mjs`
- Create: `tests/qa/fixtures/section.html`
- Create: `tests/qa/shoot.test.mjs`

**Interfaces:**
- Produces:
  - `launchBrowser() => Promise<Browser>` (Chromium, headless).
  - `openPage(browser, { url, width, height = 900, scale = 1, reducedMotion = true }) => Promise<{ page, context, errors: { console: string[], page: string[] } }>` — sets intro-skip init script, ignores HTTPS errors, navigates with `waitUntil: 'networkidle'` (60 s), injects the hide stylesheet, awaits `document.fonts.ready`, scrolls through the page to trigger lazy loading, waits for all images to finish, scrolls back to top, waits 300 ms.
  - `shoot({ url, selector?, width, height?, scale?, reducedMotion?, fullPage?, out, browser? }) => Promise<{ out, url, selector, width, scale, box, consoleErrors: string[], pageErrors: string[] }>` — throws `Error` code `ENOSELECTOR` when `selector` matches nothing.
  - CLI: `node shoot.mjs --url U --width W --out F [--selector S] [--scale 2] [--full-page] [--motion]` (`--motion` = reduced motion off).

- [ ] **Step 1: Fixture** `tests/qa/fixtures/section.html`

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>fixture</title>
<style>
  body { margin: 0; font-family: Arial, sans-serif; }
  section { height: 400px; display: flex; align-items: center; justify-content: center; }
  #pb-s1 { background: #1e3a8a; color: #fff; }
  #pb-s2 { background: #f1f5f9; }
  .tall { height: 1600px; }
  .proto-intro { position: fixed; inset: 0; background: red; }
  @media (prefers-reduced-motion: no-preference) { #pb-s1 h1 { opacity: 0.2; } }
</style></head>
<body>
  <div class="proto-intro"></div>
  <section id="pb-s1"><h1>Hello fixture</h1></section>
  <div class="tall"></div>
  <section id="pb-s2"><img loading="lazy" width="200" height="100" alt="lazy" src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='100'><rect width='200' height='100' fill='%23ef4444'/></svg>"></section>
</body></html>
```

- [ ] **Step 2: Failing test** `tests/qa/shoot.test.mjs`

```js
import assert from 'node:assert/strict';
import path from 'node:path';
import { qtest, tmpDir, serveFixtures, QA_DIR } from './helpers.mjs';

qtest('shoot captures an element at the design width with motion reduced and intro hidden', async () => {
  const { shoot } = await import(path.join(QA_DIR, 'shoot.mjs'));
  const { loadRaw } = await import(path.join(QA_DIR, 'image.mjs'));
  const srv = await serveFixtures();
  try {
    const d = tmpDir();
    const r = await shoot({ url: `${srv.url}/section.html`, selector: '#pb-s1', width: 1440, scale: 1, out: path.join(d, 's1.png') });
    const raw = await loadRaw(r.out);
    assert.equal(raw.width, 1440);
    assert.equal(raw.height, 400);
    assert.deepEqual([...raw.data.subarray(0, 3)], [0x1e, 0x3a, 0x8a], 'top-left is section bg, not the red intro overlay');
    assert.deepEqual(r.pageErrors, []);

    const lazy = await shoot({ url: `${srv.url}/section.html`, selector: '#pb-s2', width: 1440, out: path.join(d, 's2.png') });
    const lraw = await loadRaw(lazy.out);
    const cx = Math.round(lraw.width / 2); const cy = Math.round(lraw.height / 2);
    assert.deepEqual([...lraw.data.subarray((cy * lraw.width + cx) * 4, (cy * lraw.width + cx) * 4 + 3)], [0xef, 0x44, 0x44], 'lazy image loaded');

    const retina = await shoot({ url: `${srv.url}/section.html`, selector: '#pb-s1', width: 1440, scale: 2, out: path.join(d, 'r.png') });
    assert.equal((await loadRaw(retina.out)).width, 2880);
  } finally { await srv.close(); }
});

qtest('shoot throws ENOSELECTOR for a missing anchor', async () => {
  const { shoot } = await import(path.join(QA_DIR, 'shoot.mjs'));
  const srv = await serveFixtures();
  try {
    await assert.rejects(
      shoot({ url: `${srv.url}/section.html`, selector: '#pb-s9', width: 800, out: path.join(tmpDir(), 'x.png') }),
      (e) => e.code === 'ENOSELECTOR' && /#pb-s9/.test(e.message),
    );
  } finally { await srv.close(); }
});
```

- [ ] **Step 3: Run** `npm run test:qa` → Expected: FAIL.

- [ ] **Step 4: Implement** `scripts/qa/browser.mjs`

```js
import { chromium } from 'playwright';

const HIDE_CSS = '.proto-intro{display:none!important}#wpadminbar{display:none!important}html{margin-top:0!important}';

export const launchBrowser = () => chromium.launch({ headless: true });

export async function openPage(browser, { url, width, height = 900, scale = 1, reducedMotion = true }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
    ignoreHTTPSErrors: true,
  });
  await context.addInitScript(() => { try { sessionStorage.setItem('protoIntroShown', 'true'); } catch {} });
  const page = await context.newPage();
  const errors = { console: [], page: [] };
  page.on('console', (m) => { if (m.type() === 'error') errors.console.push(m.text()); });
  page.on('pageerror', (e) => errors.page.push(String(e.message ?? e)));
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.addStyleTag({ content: HIDE_CSS });
  await page.evaluate(async () => {
    await document.fonts.ready;
    const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    await Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); })));
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
  return { page, context, errors };
}
```

- [ ] **Step 5: Implement** `scripts/qa/shoot.mjs`

```js
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser, openPage } from './browser.mjs';

export async function shoot({ url, selector, width, height = 900, scale = 1, reducedMotion = true, fullPage = false, out, browser }) {
  const own = !browser;
  const b = browser ?? await launchBrowser();
  try {
    const { page, context, errors } = await openPage(b, { url, width, height, scale, reducedMotion });
    try {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      let box = null;
      if (selector) {
        const loc = page.locator(selector).first();
        if (await loc.count() === 0) {
          const e = new Error(`Selector ${selector} not found on ${url}`);
          e.code = 'ENOSELECTOR';
          throw e;
        }
        await loc.scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        await loc.screenshot({ path: out });
        box = await loc.boundingBox();
      } else {
        await page.screenshot({ path: out, fullPage });
      }
      return { out, url, selector: selector ?? null, width, scale, box, consoleErrors: errors.console, pageErrors: errors.page };
    } finally {
      await context.close();
    }
  } finally {
    if (own) await b.close();
  }
}

async function main(argv) {
  const a = { flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--full-page' || argv[i] === '--motion') a.flags.add(argv[i]);
    else a[argv[i].replace(/^--/, '')] = argv[++i];
  }
  if (!a.url || !a.width || !a.out) { process.stderr.write('Usage: node shoot.mjs --url U --width W --out F [--selector S] [--scale 2] [--full-page] [--motion]\n'); process.exit(64); }
  const r = await shoot({ url: a.url, selector: a.selector, width: Number(a.width), scale: a.scale ? Number(a.scale) : 1, fullPage: a.flags.has('--full-page'), reducedMotion: !a.flags.has('--motion'), out: a.out });
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); });
}
```

- [ ] **Step 6: Run** `npm run test:qa` → Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add skills/protoblocks-site-builder/scripts/qa/browser.mjs skills/protoblocks-site-builder/scripts/qa/shoot.mjs tests/qa/fixtures/section.html tests/qa/shoot.test.mjs
git commit -m "feat(qa): deterministic element and full-page screenshots"
```

---

### Task 4: Responsive sanity checks

**Files:**
- Create: `skills/protoblocks-site-builder/scripts/qa/sanity.mjs`
- Create: `tests/qa/fixtures/broken.html`
- Create: `tests/qa/sanity.test.mjs`

**Interfaces:**
- Consumes: `launchBrowser`, `openPage` (Task 3).
- Produces:
  - `sanity({ url, selector?, width, height?, browser?, minFontPx = 14, minTapPx = 44 }) => Promise<{ url, selector, width, ok: boolean, issues: {type: 'overflow'|'small-text'|'tap-target'|'broken-image'|'overlap'|'missing', detail: string}[] }>` — tap targets only checked when `width ≤ 480`; issues de-duplicated, capped at 50.
  - CLI: `node sanity.mjs --url U --width W [--selector S]`.

- [ ] **Step 1: Fixture** `tests/qa/fixtures/broken.html`

```html
<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>
  body { margin: 0; font-family: Arial, sans-serif; }
  #pb-s1 { padding: 16px; }
  .wide { width: 900px; height: 20px; background: #ccc; }
  .tiny { font-size: 10px; }
  .a, .b { position: relative; font-size: 16px; }
  .b { top: -20px; }
  #pb-s2 { padding: 16px; font-size: 16px; }
  #pb-s2 a { display: inline-block; padding: 14px 16px; }
</style></head>
<body>
  <section id="pb-s1">
    <div class="wide"></div>
    <p class="tiny">tiny text</p>
    <a href="#">x</a>
    <img alt="broken" src="/does-not-exist.png" width="50" height="50">
    <p class="a">first line of text</p>
    <p class="b">second line overlapping</p>
  </section>
  <section id="pb-s2"><p>Readable copy that fits.</p><a href="#">A good tap target</a></section>
</body></html>
```

- [ ] **Step 2: Failing test** `tests/qa/sanity.test.mjs`

```js
import assert from 'node:assert/strict';
import path from 'node:path';
import { qtest, serveFixtures, QA_DIR } from './helpers.mjs';

qtest('sanity flags overflow, small text, tap targets, broken images and overlap on mobile', async () => {
  const { sanity } = await import(path.join(QA_DIR, 'sanity.mjs'));
  const srv = await serveFixtures();
  try {
    const r = await sanity({ url: `${srv.url}/broken.html`, selector: '#pb-s1', width: 390 });
    const types = new Set(r.issues.map((i) => i.type));
    for (const t of ['overflow', 'small-text', 'tap-target', 'broken-image', 'overlap']) assert.ok(types.has(t), `missing ${t}: ${JSON.stringify(r.issues)}`);
    assert.equal(r.ok, false);
  } finally { await srv.close(); }
});

qtest('sanity scoped to a clean section reports no section issues', async () => {
  const { sanity } = await import(path.join(QA_DIR, 'sanity.mjs'));
  const srv = await serveFixtures();
  try {
    const r = await sanity({ url: `${srv.url}/broken.html`, selector: '#pb-s2', width: 390 });
    const sectionIssues = r.issues.filter((i) => !i.detail.startsWith('page scrollWidth'));
    assert.deepEqual(sectionIssues, []);
  } finally { await srv.close(); }
});
```

- [ ] **Step 3: Run** `npm run test:qa` → Expected: FAIL.

- [ ] **Step 4: Implement** `scripts/qa/sanity.mjs`

```js
#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { launchBrowser, openPage } from './browser.mjs';

function inspect({ selector, minFontPx, minTapPx, checkTaps }) {
  const root = selector ? document.querySelector(selector) : document.body;
  if (!root) return [{ type: 'missing', detail: `${selector} not found` }];
  const out = [];
  const vw = document.documentElement.clientWidth;
  const desc = (el) => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (el.classList.length ? `.${[...el.classList].slice(0, 2).join('.')}` : '');
  const visible = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  if (document.documentElement.scrollWidth > vw + 1) out.push({ type: 'overflow', detail: `page scrollWidth ${document.documentElement.scrollWidth} > viewport ${vw}` });
  const all = [root, ...root.querySelectorAll('*')].filter(visible);
  for (const el of all) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 && cs.position !== 'fixed') out.push({ type: 'overflow', detail: `${desc(el)} extends to ${Math.round(r.right)}px (viewport ${vw})` });
    if (ownText(el) && parseFloat(cs.fontSize) < minFontPx) out.push({ type: 'small-text', detail: `${desc(el)} font-size ${cs.fontSize}` });
    if (checkTaps && el.matches('a[href],button,[role=button],input,select,textarea') && (r.width < minTapPx || r.height < minTapPx)) out.push({ type: 'tap-target', detail: `${desc(el)} ${Math.round(r.width)}x${Math.round(r.height)}` });
    if (el.tagName === 'IMG' && el.complete && el.naturalWidth === 0) out.push({ type: 'broken-image', detail: el.currentSrc || el.getAttribute('src') || desc(el) });
  }
  const leaves = all.filter(ownText).slice(0, 300);
  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const a = leaves[i]; const b = leaves[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect();
      const ix = Math.max(0, Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left));
      const iy = Math.max(0, Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top));
      const min = Math.min(ra.width * ra.height, rb.width * rb.height);
      if (min && (ix * iy) / min > 0.2) out.push({ type: 'overlap', detail: `${desc(a)} overlaps ${desc(b)}` });
    }
  }
  return out;
}

export async function sanity({ url, selector, width, height = 900, browser, minFontPx = 14, minTapPx = 44 }) {
  const own = !browser;
  const b = browser ?? await launchBrowser();
  try {
    const { page, context } = await openPage(b, { url, width, height });
    try {
      const raw = await page.evaluate(inspect, { selector: selector ?? null, minFontPx, minTapPx, checkTaps: width <= 480 });
      const seen = new Set();
      const issues = raw.filter((i) => { const k = `${i.type}|${i.detail}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 50);
      return { url, selector: selector ?? null, width, ok: issues.length === 0, issues };
    } finally { await context.close(); }
  } finally { if (own) await b.close(); }
}

async function main(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
  if (!a.url || !a.width) { process.stderr.write('Usage: node sanity.mjs --url U --width W [--selector S]\n'); process.exit(64); }
  process.stdout.write(`${JSON.stringify(await sanity({ url: a.url, selector: a.selector, width: Number(a.width) }), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1); });
}
```

- [ ] **Step 5: Run** `npm run test:qa` → Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add skills/protoblocks-site-builder/scripts/qa/sanity.mjs tests/qa/fixtures/broken.html tests/qa/sanity.test.mjs
git commit -m "feat(qa): responsive sanity checks for inferred breakpoints"
```

---

### Task 5: Design band segmentation + cropping

**Files:**
- Create: `skills/protoblocks-site-builder/scripts/qa/segment.mjs`
- Create: `tests/qa/segment.test.mjs`

**Interfaces:**
- Consumes: `loadRaw`, `cropRaw`, `rawToPng` (Task 1).
- Produces:
  - `rowBackgrounds(raw, { edge = 4 }) => { color: [r,g,b] | null, uniform: boolean }[]` — per row: `color` = mean of the leftmost and rightmost `edge` pixels when the two sides agree within tolerance 12 (else `null`); `uniform` = every 2nd pixel in the row within tolerance 12 of `color`.
  - `findCuts(raw, { tolerance = 12, minBand = 40, minGap = 24 }) => { width, height, cuts: {y, kind: 'background'|'gap', from?, to?, gap?}[], bands: {y0, y1, bg}[] }` — `background` cuts where the row background colour changes and the new colour persists ≥ `minBand` rows; `gap` cuts at the middle of uniform runs ≥ `minGap` rows inside one background band (candidates only); `bands` built from background cuts.
  - `cropRanges(image, ranges: {name, y0, y1, x0?, x1?}[], outDir) => Promise<{name, file, width, height}[]>`
  - CLI: `node segment.mjs analyze <image>`; `node segment.mjs crop <image> --ranges '<json>' --out <dir>`.

- [ ] **Step 1: Failing tests** `tests/qa/segment.test.mjs`

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { qtest, makeImage, tmpDir, QA_DIR } from './helpers.mjs';

const W = 600;
async function fixture(dir) {
  return makeImage({
    width: W, height: 900, bg: [255, 255, 255],
    rects: [
      { x: 200, y: 40, w: 200, h: 60, color: [0, 0, 0] },        // hero heading (white band 0–299)
      { x: 200, y: 200, w: 200, h: 40, color: [0, 0, 0] },       // hero CTA, 100px gap above
      { x: 0, y: 300, w: W, h: 300, color: [242, 242, 242] },    // grey band 300–599
      { x: 100, y: 380, w: 400, h: 140, color: [30, 30, 30] },   // content inside grey band
      { x: 0, y: 650, w: W, h: 3, color: [10, 10, 10] },         // thin full-width rule (3 rows) in last band — must not cut
      { x: 150, y: 700, w: 300, h: 120, color: [0, 0, 0] },      // footer content
    ],
  }, path.join(dir, 'page.png'));
}

qtest('findCuts finds background changes and ignores thin full-width rules', async () => {
  const { findCuts } = await import(path.join(QA_DIR, 'segment.mjs'));
  const { loadRaw } = await import(path.join(QA_DIR, 'image.mjs'));
  const raw = await loadRaw(await fixture(tmpDir()));
  const r = findCuts(raw);
  const bg = r.cuts.filter((c) => c.kind === 'background').map((c) => c.y);
  assert.deepEqual(bg, [300, 600]);
  assert.deepEqual(r.bands.map((b) => [b.y0, b.y1]), [[0, 300], [300, 600], [600, 900]]);
  assert.ok(r.cuts.some((c) => c.kind === 'gap' && c.y > 100 && c.y < 200), JSON.stringify(r.cuts));
});

qtest('cropRanges writes named crops', async () => {
  const { cropRanges } = await import(path.join(QA_DIR, 'segment.mjs'));
  const dir = tmpDir();
  const file = await fixture(dir);
  const out = await cropRanges(file, [{ name: 's1', y0: 0, y1: 300 }, { name: 's2', y0: 300, y1: 600 }], path.join(dir, 'crops'));
  assert.deepEqual(out.map((o) => [o.name, o.width, o.height]), [['s1', W, 300], ['s2', W, 300]]);
  assert.ok(fs.existsSync(out[1].file));
});
```

- [ ] **Step 2: Run** `npm run test:qa` → Expected: FAIL.

- [ ] **Step 3: Implement** `scripts/qa/segment.mjs`

```js
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadRaw, cropRaw, rawToPng } from './image.mjs';

const TOL = 12;
const px = (raw, x, y) => { const i = (y * raw.width + x) * 4; return [raw.data[i], raw.data[i + 1], raw.data[i + 2]]; };
const dist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
const mean = (cs) => [0, 1, 2].map((k) => Math.round(cs.reduce((s, c) => s + c[k], 0) / cs.length));

export function rowBackgrounds(raw, { edge = 4 } = {}) {
  const rows = [];
  for (let y = 0; y < raw.height; y++) {
    const left = mean(Array.from({ length: edge }, (_, i) => px(raw, i, y)));
    const right = mean(Array.from({ length: edge }, (_, i) => px(raw, raw.width - 1 - i, y)));
    const color = dist(left, right) <= TOL ? mean([left, right]) : null;
    let uniform = !!color;
    for (let x = 0; uniform && x < raw.width; x += 2) if (dist(px(raw, x, y), color) > TOL) uniform = false;
    rows.push({ color, uniform });
  }
  return rows;
}

export function findCuts(raw, { tolerance = TOL, minBand = 40, minGap = 24 } = {}) {
  const rows = rowBackgrounds(raw);
  const cuts = [];
  let bandColor = rows.find((r) => r.color)?.color ?? [255, 255, 255];
  let y = 0;
  while (y < rows.length) {
    const c = rows[y].color;
    if (c && dist(c, bandColor) > tolerance) {
      let run = 0;
      while (y + run < rows.length && rows[y + run].color && dist(rows[y + run].color, c) <= tolerance) run++;
      if (run >= minBand) {
        cuts.push({ y, kind: 'background', from: bandColor, to: c });
        bandColor = c;
        y += run;
        continue;
      }
      y += Math.max(1, run);
      continue;
    }
    y++;
  }
  const bgYs = cuts.map((c) => c.y);
  const edges = [0, ...bgYs, raw.height];
  const bands = edges.slice(0, -1).map((y0, i) => ({ y0, y1: edges[i + 1], bg: rows[y0]?.color ?? null }));
  for (const band of bands) {
    let runStart = null;
    for (let yy = band.y0; yy <= band.y1; yy++) {
      const u = yy < band.y1 && rows[yy].uniform;
      if (u && runStart === null) runStart = yy;
      if (!u && runStart !== null) {
        const len = yy - runStart;
        if (len >= minGap && runStart > band.y0 && yy < band.y1) cuts.push({ y: runStart + Math.floor(len / 2), kind: 'gap', gap: len });
        runStart = null;
      }
    }
  }
  cuts.sort((a, b) => a.y - b.y);
  return { width: raw.width, height: raw.height, cuts, bands };
}

export async function cropRanges(image, ranges, outDir) {
  const raw = await loadRaw(image);
  fs.mkdirSync(outDir, { recursive: true });
  const out = [];
  for (const r of ranges) {
    const x0 = r.x0 ?? 0; const x1 = r.x1 ?? raw.width;
    const crop = cropRaw(raw, { x: x0, y: r.y0, w: x1 - x0, h: r.y1 - r.y0 });
    const file = path.join(outDir, `${r.name}.png`);
    await rawToPng(crop, file);
    out.push({ name: r.name, file, width: crop.width, height: crop.height });
  }
  return out;
}

async function main(argv) {
  const [cmd, image, ...rest] = argv;
  const a = {};
  for (let i = 0; i < rest.length; i += 2) a[rest[i].replace(/^--/, '')] = rest[i + 1];
  if (cmd === 'analyze' && image) return process.stdout.write(`${JSON.stringify(findCuts(await loadRaw(image)), null, 2)}\n`);
  if (cmd === 'crop' && image && a.ranges && a.out) return process.stdout.write(`${JSON.stringify(await cropRanges(image, JSON.parse(a.ranges), a.out), null, 2)}\n`);
  process.stderr.write('Usage: node segment.mjs analyze <image> | crop <image> --ranges <json> --out <dir>\n');
  process.exit(64);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1); });
}
```

- [ ] **Step 4: Run** `npm run test:qa` → Expected: PASS. If a gap cut appears outside 100–200 or background cuts are off by a row, fix the algorithm (not the fixture) and explain the change in the report.

- [ ] **Step 5: Commit**

```bash
git add skills/protoblocks-site-builder/scripts/qa/segment.mjs tests/qa/segment.test.mjs
git commit -m "feat(qa): design band segmentation and section cropping"
```

---

### Task 6: `check-section` runner + `visual-qa` subagent

**Files:**
- Create: `skills/protoblocks-site-builder/scripts/qa/check-section.mjs`
- Create: `agents/visual-qa.md`
- Create: `tests/qa/check-section.test.mjs`

**Interfaces:**
- Consumes: `launchBrowser` (Task 3), `shoot` (Task 3), `diffImages` (Task 2), `sanity` (Task 4).
- Produces:
  - Input JSON (`CheckInput`):
    ```json
    {
      "url": "https://acme.local/home/",
      "anchor": "pb-s3",
      "iterDir": "/abs/theme/.protoblocks/artifacts/home/pb-s3/iter-2",
      "qa": { "mismatchMax": 0.08, "heightDeltaMax": 0.03 },
      "breakpoints": [
        { "name": "desktop", "width": 1440, "scale": 2, "design": "/abs/crops/desktop/pb-s3.png", "masks": [] },
        { "name": "mobile", "width": 390, "scale": 3, "design": "/abs/crops/mobile/pb-s3.png" },
        { "name": "tablet", "width": 834, "sanityOnly": true }
      ]
    }
    ```
  - `checkSection(input) => Promise<CheckResult>`:
    ```json
    {
      "anchor": "pb-s3",
      "numericPass": false,
      "results": [
        { "breakpoint": "desktop", "mode": "diff", "mismatch": 0.11, "heightDelta": 0.02, "numericPass": false, "render": "…/desktop-render.png", "composite": "…/desktop-composite.png", "consoleErrors": [], "pageErrors": [] },
        { "breakpoint": "tablet", "mode": "sanity", "ok": true, "issues": [], "render": "…/tablet-render.png", "pageErrors": [] },
        { "breakpoint": "mobile", "mode": "error", "error": "[ENOSELECTOR] Selector #pb-s3 not found on …", "numericPass": false }
      ]
    }
    ```
    `numericPass` (overall) = every `diff` result passes thresholds with no `pageErrors`, every `sanity` result has no `pageErrors`, and no `error` results. `sanity` issues never flip `numericPass` (the subagent judges them). Writes `<iterDir>/result.json`.
  - CLI: `node check-section.mjs <input.json>`.
  - `agents/visual-qa.md`: subagent `visual-qa` (`protoblocks-skill:visual-qa`), input = path to a `CheckInput` JSON, writes `<iterDir>/verdict.json`, final message = the verdict JSON only:
    ```json
    { "pass": false, "anchor": "pb-s3", "numericPass": false,
      "breakpoints": [{ "name": "desktop", "mode": "diff", "mismatch": 0.11, "heightDelta": 0.02, "numericPass": false }],
      "discrepancies": [{ "breakpoint": "desktop", "area": "headline", "issue": "font-size ~48px vs ~56px in design", "severity": "high", "fix": "use text-h1 (64px token) on the h2" }],
      "artifacts": ["…/desktop-composite.png"] }
    ```

- [ ] **Step 1: Failing test** `tests/qa/check-section.test.mjs`

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { qtest, tmpDir, serveFixtures, makeImage, QA_DIR } from './helpers.mjs';

qtest('checkSection passes a matching design, fails a different one, and reports a missing anchor', async () => {
  const { checkSection } = await import(path.join(QA_DIR, 'check-section.mjs'));
  const { shoot } = await import(path.join(QA_DIR, 'shoot.mjs'));
  const srv = await serveFixtures();
  try {
    const d = tmpDir();
    const url = `${srv.url}/section.html`;
    const good = (await shoot({ url, selector: '#pb-s1', width: 1440, out: path.join(d, 'design-good.png') })).out;
    const bad = await makeImage({ width: 1440, height: 520, bg: [255, 255, 255] }, path.join(d, 'design-bad.png'));

    const pass = await checkSection({ url, anchor: 'pb-s1', iterDir: path.join(d, 'i1'), qa: { mismatchMax: 0.08, heightDeltaMax: 0.03 },
      breakpoints: [{ name: 'desktop', width: 1440, scale: 1, design: good }, { name: 'mobile', width: 390, sanityOnly: true }] });
    assert.equal(pass.numericPass, true, JSON.stringify(pass, null, 2));
    assert.ok(fs.existsSync(pass.results[0].composite));
    assert.ok(fs.existsSync(path.join(d, 'i1', 'result.json')));
    assert.equal(pass.results[1].mode, 'sanity');

    const fail = await checkSection({ url, anchor: 'pb-s1', iterDir: path.join(d, 'i2'), qa: { mismatchMax: 0.08, heightDeltaMax: 0.03 },
      breakpoints: [{ name: 'desktop', width: 1440, scale: 1, design: bad }] });
    assert.equal(fail.numericPass, false);
    assert.ok(fail.results[0].heightDelta > 0.03);

    const missing = await checkSection({ url, anchor: 'pb-s9', iterDir: path.join(d, 'i3'), qa: { mismatchMax: 0.08, heightDeltaMax: 0.03 },
      breakpoints: [{ name: 'desktop', width: 1440, scale: 1, design: good }] });
    assert.equal(missing.numericPass, false);
    assert.equal(missing.results[0].mode, 'error');
    assert.match(missing.results[0].error, /ENOSELECTOR/);
  } finally { await srv.close(); }
});
```

- [ ] **Step 2: Run** `npm run test:qa` → Expected: FAIL.

- [ ] **Step 3: Implement** `scripts/qa/check-section.mjs`

```js
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from './browser.mjs';
import { shoot } from './shoot.mjs';
import { diffImages } from './diff.mjs';
import { sanity } from './sanity.mjs';

export async function checkSection({ url, anchor, iterDir, qa, breakpoints }) {
  fs.mkdirSync(iterDir, { recursive: true });
  const selector = `#${anchor}`;
  const browser = await launchBrowser();
  const results = [];
  try {
    for (const bp of breakpoints) {
      const render = path.join(iterDir, `${bp.name}-render.png`);
      try {
        const shot = await shoot({ url, selector, width: bp.width, scale: bp.scale ?? 1, out: render, browser });
        if (bp.sanityOnly || !bp.design) {
          const s = await sanity({ url, selector, width: bp.width, browser });
          results.push({ breakpoint: bp.name, mode: 'sanity', ok: s.ok, issues: s.issues, render, consoleErrors: shot.consoleErrors, pageErrors: shot.pageErrors });
          continue;
        }
        const d = await diffImages({ design: bp.design, render, out: path.join(iterDir, `${bp.name}-composite.png`), masks: bp.masks ?? [] });
        const numericPass = d.mismatch <= qa.mismatchMax && d.heightDelta <= qa.heightDeltaMax && shot.pageErrors.length === 0;
        results.push({ breakpoint: bp.name, mode: 'diff', mismatch: d.mismatch, heightDelta: d.heightDelta, numericPass, render, composite: d.composite, consoleErrors: shot.consoleErrors, pageErrors: shot.pageErrors });
      } catch (e) {
        results.push({ breakpoint: bp.name, mode: 'error', error: `${e.code ? `[${e.code}] ` : ''}${e.message}`, numericPass: false });
      }
    }
  } finally {
    await browser.close();
  }
  const numericPass = results.every((r) => (r.mode === 'diff' ? r.numericPass : r.mode === 'sanity' ? r.pageErrors.length === 0 : false));
  const out = { anchor, url, numericPass, results };
  fs.writeFileSync(path.join(iterDir, 'result.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const file = process.argv[2];
  if (!file) { process.stderr.write('Usage: node check-section.mjs <input.json>\n'); process.exit(64); }
  checkSection(JSON.parse(fs.readFileSync(file, 'utf8')))
    .then((r) => process.stdout.write(`${JSON.stringify(r, null, 2)}\n`))
    .catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1); });
}
```

- [ ] **Step 4: Run** `npm run test:qa` → Expected: PASS.

- [ ] **Step 5: Write `agents/visual-qa.md`**

```markdown
---
name: visual-qa
description: Use to verify one built Proto-Blocks section against its design crops. Runs the screenshot/diff/sanity scripts, inspects the design|render|heatmap composites, and returns only a verdict JSON. Dispatched by protoblocks-section-loop once per section per iteration.
tools: Bash, Read, Write
model: sonnet
---

You are the visual QA gate for one section of a WordPress page built with Proto-Blocks. You measure and judge; you never fix. Do not edit any theme, plugin, or site file.

## Input
The prompt gives you the path to a CheckInput JSON (url, anchor, iterDir, qa thresholds, breakpoints).

## Steps
1. Run: `node "${CLAUDE_PLUGIN_ROOT}/skills/protoblocks-site-builder/scripts/qa/check-section.mjs" "<input.json>"` and read its JSON output (also saved as `<iterDir>/result.json`).
   - If the command itself fails (missing deps), return `{"pass":false,"error":"<stderr>"}` and stop.
2. For every `diff` result, Read its `composite` image. Panels left→right: DESIGN | RENDER | HEATMAP (red = differing pixels).
   For every `sanity` result, Read its `render` image and its `issues`.
   For every `error` result, record a high-severity discrepancy with the error text.
3. List concrete discrepancies. Measure, don't describe vaguely: compare sizes against the panel widths (the design breakpoint width is known), e.g. "headline ~48px vs ~56px", "gap above CTA ~24px vs ~40px", "3 columns vs 4 in design", "button is square vs pill", "background #f8fafc vs #eef2ff".
   Severity:
   - **high** — structure or layout wrong: missing/extra/reordered element, wrong column count or alignment, text wrapping that changes height, wrong colour on a large area, broken image, `pageErrors`, an `error` result, sanity `overflow`/`overlap`.
   - **medium** — sizing/spacing off by more than ~8 px, wrong font weight/size step, visible colour shade difference on small elements, sanity `small-text`/`tap-target`.
   - **low** — anti-aliasing, sub-pixel offsets, image compression.
   Each discrepancy gets a `fix` phrased in block terms (template.php markup, Tailwind class/token, CSS rule, block attribute).
4. `pass` = `numericPass` from the result AND no `high` discrepancies. Never set `pass: true` when `numericPass` is false.
5. Write the verdict to `<iterDir>/verdict.json`, then reply with exactly that JSON and nothing else:

{"pass":false,"anchor":"pb-s3","numericPass":false,"breakpoints":[{"name":"desktop","mode":"diff","mismatch":0.11,"heightDelta":0.02,"numericPass":false}],"discrepancies":[{"breakpoint":"desktop","area":"headline","issue":"font-size ~48px vs ~56px in design","severity":"high","fix":"use text-h1 on the h2"}],"artifacts":["<paths of composites/renders>"]}
```

- [ ] **Step 6: Validate the agent file**

Run: `head -6 agents/visual-qa.md` → Expected: frontmatter with `name: visual-qa`, `tools: Bash, Read, Write`, `model: sonnet`.

- [ ] **Step 7: Commit**

```bash
git add skills/protoblocks-site-builder/scripts/qa/check-section.mjs agents/visual-qa.md tests/qa/check-section.test.mjs
git commit -m "feat(qa): check-section runner and visual-qa subagent"
```

---

## Self-review notes

- Spec §6.2: shoot (Task 3), diff (Task 2), sanity (Task 4), subagent + pass rule (Task 6). Regression re-shoots (§6.2 "Regressions") reuse `shoot` + `diffImages` against stored baselines — orchestrated in Stage 4.
- §5.3 step 1 segmentation (Task 5).
- Interfaces consistent: `loadRaw/rawToPng/resizeToWidth/cropRaw`, `compareRaw/diffImages/writeComposite`, `launchBrowser/openPage`, `shoot`, `sanity`, `rowBackgrounds/findCuts/cropRanges`, `checkSection`.
