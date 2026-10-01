# Stage 2 — Site Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything the builder needs to turn a bare local WordPress into a ready Proto-Blocks block-theme site: a WP-CLI runner, a Local test-site harness, plugin install/activation, theme fetch + fork, managed theme assets, design tokens → Tailwind/theme.json, block-theme navigation menus, template-part writing with Site Editor override detection, a one-shot setup CLI, and the `protoblocks-site-setup` skill.

**Architecture:** Node ESM CLIs in `skills/protoblocks-site-builder/scripts/lib/` orchestrate WP-CLI through one runner (`wp.mjs`). WordPress-side logic lives in small PHP files in `scripts/wp/` executed with `wp eval-file <file> <args…>`; each prints exactly one JSON line as its last stdout line. Pure functions (release picking, token rendering, header rewriting, block attribute serialization) are unit tested; WordPress-touching code is integration tested against the developer's Local site "Proto Blocks" (http://proto-blocks.local) via `tests/integration/helpers.mjs`.

**Tech Stack:** Node ≥ 18 built-ins (`fetch`, `node:test`), system `unzip` and `git`, Local by Flywheel's PHP + WP-CLI phar (via the Stage 1 wrapper).

**Spec:** `docs/superpowers/specs/2026-10-01-site-builder-design.md` (§4 Site setup, §3 runtime, §10 error handling, §11 testing)

**Builds on Stage 1:** `lib/exec.mjs` (`exec(cmd,args,opts) → {code,stdout,stderr}`), `lib/state.mjs` (`initState, loadState, updateState, setPath, statePath`), `lib/preflight.mjs` (`runPreflight`, `findWpRoot`, `compareVersions`; writes `<wp-content>/.protoblocks/preflight.json` with `{ok, mode, wp, url, publicPath, localSite, runtimeDir, checks}`), `lib/local-site.mjs`.

## Global Constraints

- Local sites only. Never run write commands against a site other than the one preflight resolved (in tests: the Local site "Proto Blocks", which the developer authorized for all testing).
- Proto-Blocks: install the **highest `vX.Y.Z` release** of `GustavoGomez092/Proto-Blocks` that has a `.zip` asset. Never use `/releases/latest` — the repo's `latest` tag is stale (points at 2.10.0 while 2.10.1 exists).
- Theme: `GustavoGomez092/proto-blocks-theme`, same release-picking rule; zip root folder is `proto-theme/`; original text domain `proto-theme`.
- wordpress.org plugins: `wordpress-seo`, `safe-svg`, `duplicate-post`. Wordfence is skipped locally.
- Options: `proto_blocks_wizard_completed = true`, `proto_blocks_component_style = 'tailwind'`, Tailwind enabled via `ProtoBlocks\Core\Plugin::getInstance()->getTailwindManager()->updateSettings(['enabled' => true])`; compile via `->compile()` (returns `['success'=>bool,'message'=>string]`). Permalinks `/%postname%/`.
- Theme fork lives at `wp-content/themes/<slug>/`; its `style.css` carries a `Proto Fork: proto-blocks-theme@<version>` header line (the fork marker). An existing folder without the marker is never overwritten without explicit `--force` (spec §10 destructive-action rule). An existing fork is reused.
- Template-part DB overrides (`wp_template_part` posts) are removed only with explicit `--confirm`.
- Navigation uses `wp_navigation` posts + `core/navigation-link` / `core/navigation-submenu` blocks; never `register_nav_menus` / classic menus. Internal page links use `kind: post-type`, `type: page`, `id`. Upsert key: post slug `pb-nav-<key>`.
- PHP scripts that write content call `kses_remove_filters()` first (WP-CLI runs without a user; kses would mangle block markup).
- Every `scripts/wp/*.php` prints exactly one JSON object as the last line of stdout; errors go to STDERR with exit code 1.
- Every CLI prints JSON on stdout; errors on stderr; non-zero exit on failure.
- Unit tests: `npm test` (`node --test tests/unit/*.test.mjs`). Integration tests: `npm run test:integration` (`node --test --test-concurrency=1 tests/integration/*.test.mjs`), auto-skip when the Local site isn't running. Theme-mutating tests use `useItestTheme()`/`restoreTheme()` (never write into the developer's active `proto-blocks-theme` git checkout); created posts/pages/menus use unique slugs and are deleted at the end of each test.

## Review Focus

1. **Stale `latest` release tag** — picking must choose the highest semver `v*` tag with a zip, ignoring `latest`, drafts and prereleases; unit test in Task 2.
2. **Running setup twice** — no duplicate navigation posts, no duplicate managed block in `functions.php`, fork reused, plugins left alone; integration tests in Tasks 3, 4, 5, 7.
3. **A non-fork theme folder already using the slug** — refuse with `EFORKEXISTS` unless `--force`; integration test in Task 4.
4. **Menu links to pages that don't exist yet** — written as custom links, reported `pending`, converted to `post-type` links on refresh once the page exists; integration test in Task 7.
5. **Site Editor saved a DB copy of the header part** — detected; removal refused without `--confirm`; integration test in Task 8.

---

## File Structure

```
skills/protoblocks-site-builder/scripts/
├── lib/
│   ├── wp.mjs              WP-CLI runner (run/check/evalFile) + loadRuntime(dir)
│   ├── releases.mjs        pickRelease(list) + fetchLatestRelease(repo)
│   ├── download.mjs        download(url, dest) + unzip(zip, destDir)
│   ├── setup-plugins.mjs   ensurePlugins(wp) + CLI
│   ├── theme-fork.mjs      slugify, rewriteStyleHeader, forkMarker, rewriteTextDomain, forkTheme + CLI
│   ├── theme-assets.mjs    ensureManagedBlock, installThemeAssets + CLI
│   ├── tokens.mjs          validateTokens, renderTailwindTheme, mergeThemeJson, rewriteFontImport, applyTokens + CLI
│   ├── blocks.mjs          serializeAttrs(attrs) (WordPress-compatible block comment attrs)
│   ├── navigation.mjs      upsertMenu, refreshMenus + CLI
│   ├── parts.mjs           partMarkup, writePart, listOverrides, removeOverride + CLI
│   └── setup-site.mjs      one-shot steps 1–3 (plugins, fork, assets, state) + CLI
├── wp/
│   ├── tailwind.php        enable | compile | status
│   ├── navigation.php      upsert <key> <spec.json> | get <key>
│   └── parts.php           overrides | remove-override <slug>
└── theme-assets/
    └── inc/pb-assets.php   enqueues assets/js/pb-*.js after the theme's animation globals
skills/protoblocks-site-setup/
├── SKILL.md
└── references/
    ├── tokens.md           extracting tokens from a design + tokens.json format
    └── navigation.md       menu spec format, pending links, header/footer parts
tests/
├── unit/{releases,theme-fork,theme-assets,tokens,blocks,parts}.test.mjs
└── integration/
    ├── helpers.mjs         Local test-site runtime, skip logic, pb-itest theme helpers
    └── {wp,setup-plugins,theme-fork,theme-assets,tokens,navigation,parts}.test.mjs
```

---

### Task 1: WP-CLI runner + Local test-site harness

**Files:**
- Create: `skills/protoblocks-site-builder/scripts/lib/wp.mjs`
- Create: `tests/integration/helpers.mjs`
- Create: `tests/integration/wp.test.mjs`
- Create: `tests/unit/wp.test.mjs`
- Modify: `package.json` (add the `test:integration` script)

**Interfaces:**
- Consumes: `exec` (Stage 1), `findWpRoot` (Stage 1 `preflight.mjs`), `resolveLocalSite`, `writeWrapper` (Stage 1 `local-site.mjs`).
- Produces:
  - `class WpError extends Error { code = 'EWP'; args: string[]; result: {code,stdout,stderr} }`
  - `createWp({ wp, mode, publicPath }, { exec }?) => Wp` where
    `Wp = { run(args, opts?) => {code,stdout,stderr}, check(args, opts?) => stdout (throws WpError), evalFile(file, args?) => object (parsed last stdout line; throws WpError), wp, mode, publicPath }`. In `native` mode every call is prefixed with `--path=<publicPath>`; in `local-wrapper` mode the wrapper already carries `--path`.
  - `loadRuntime(dir) => { wp, mode, publicPath, url, localSite }`. It finds the WP root from `dir` (works from inside a theme folder) and reads `<root>/wp-content/.protoblocks/preflight.json`. When that file is missing, or records `ok: false`, it throws `Error` with `code: 'ENORUNTIME'` and message `Run preflight first: node preflight.mjs`.
  - `WP_SCRIPTS_DIR`: absolute path of `scripts/wp/`.
  - **Test site = the developer's Local site "Proto Blocks"** (http://proto-blocks.local), overridable with env `PB_TEST_SITE`. The developer authorized all testing there. Its active theme is a git checkout `proto-blocks-theme` that tests must **never write into**.
  - `tests/integration/helpers.mjs` exports:
    - `TEST_SITE`: string.
    - `haveSite`: boolean, true when the Local site resolves and is running.
    - `PUBLIC`: the site's `app/public`.
    - `SITE_URL`: from `wp option get siteurl`.
    - `runtime`: `{wp: <tests/.tmp/wp-test-site wrapper>, mode: 'local-wrapper', publicPath: PUBLIC, url: SITE_URL}`.
    - `itest(name, fn)`: `test`, or `test.skip` with reason `start the Local site "<TEST_SITE>"`.
    - `testWp()`.
    - `ORIGINAL_THEME`: the stylesheet active when the helpers module loaded.
    - `useItestTheme(wp) => Promise<themeDir>`: ensures the throwaway fork `wp-content/themes/pb-itest` exists. Until Task 4 exists, it creates it by copying the active theme folder **excluding `.git`**. After Task 4 it uses `forkTheme`, with the copy kept as a fallback when `theme-fork.mjs` is missing. It then activates `pb-itest` and returns its path.
    - `restoreTheme(wp)`: re-activates `ORIGINAL_THEME`.
  - Every integration test that changes theme files or activates another theme must call `useItestTheme` and `restoreTheme(wp)` in a `finally`. Tests create posts/pages with unique slugs (`pb-<name>-<Date.now()>`) and delete them at the end.

- [ ] **Step 1: Add the script to root `package.json`**

Add `"test:integration": "node --test --test-concurrency=1 tests/integration/*.test.mjs"` to `scripts`. Keep the existing `test` script unchanged.

- [ ] **Step 2: Write `tests/integration/helpers.mjs`**

```js
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createWp } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';
import { resolveLocalSite, writeWrapper } from '../../skills/protoblocks-site-builder/scripts/lib/local-site.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TEST_SITE = process.env.PB_TEST_SITE ?? 'Proto Blocks';
const resolved = resolveLocalSite({ query: TEST_SITE });
const WRAPPER = path.join(REPO, 'tests', '.tmp', 'wp-test-site');
if (resolved.ok) writeWrapper(WRAPPER, resolved.site);

export const haveSite = resolved.ok;
export const PUBLIC = resolved.ok ? resolved.site.publicPath : '';
const boot = resolved.ok ? createWp({ wp: WRAPPER, mode: 'local-wrapper', publicPath: PUBLIC }) : null;
export const SITE_URL = boot ? boot.check(['option', 'get', 'siteurl']).trim() : '';
export const ORIGINAL_THEME = boot ? boot.check(['option', 'get', 'stylesheet']).trim() : '';
export const runtime = { wp: WRAPPER, mode: 'local-wrapper', publicPath: PUBLIC, url: SITE_URL };
export const itest = (name, fn) => (haveSite ? test(name, fn) : test.skip(`${name} (start the Local site "${TEST_SITE}")`, fn));
export const testWp = () => createWp(runtime);

export async function useItestTheme(wp) {
  const themes = path.join(PUBLIC, 'wp-content', 'themes');
  const dir = path.join(themes, 'pb-itest');
  if (!fs.existsSync(path.join(dir, 'style.css'))) {
    let forked = false;
    try {
      const { fetchThemeZip, forkTheme } = await import('../../skills/protoblocks-site-builder/scripts/lib/theme-fork.mjs');
      const { zipFile, forkedFrom } = await fetchThemeZip();
      forkTheme({ wp, themesDir: themes, name: 'PB Itest', slug: 'pb-itest', zipFile, forkedFrom });
      forked = true;
    } catch { /* theme-fork.mjs not available yet (before Stage 2 Task 4) */ }
    if (!forked) {
      fs.cpSync(path.join(themes, ORIGINAL_THEME), dir, { recursive: true, filter: (src) => !src.split(path.sep).includes('.git') });
    }
  }
  wp.check(['theme', 'activate', 'pb-itest']);
  return dir;
}

export const restoreTheme = (wp) => wp.check(['theme', 'activate', ORIGINAL_THEME]);
```

- [ ] **Step 3: Write failing unit tests** `tests/unit/wp.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWp, loadRuntime, WpError } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';

test('native mode prefixes --path; wrapper mode does not', () => {
  const calls = [];
  const exec = (cmd, args) => { calls.push([cmd, args]); return { code: 0, stdout: 'x', stderr: '' }; };
  createWp({ wp: 'wp', mode: 'native', publicPath: '/s' }, { exec }).run(['option', 'get', 'siteurl']);
  createWp({ wp: '/w/wp', mode: 'local-wrapper', publicPath: '/s' }, { exec }).run(['option', 'get', 'siteurl']);
  assert.deepEqual(calls[0], ['wp', ['--path=/s', 'option', 'get', 'siteurl']]);
  assert.deepEqual(calls[1], ['/w/wp', ['option', 'get', 'siteurl']]);
});

test('check throws WpError carrying stderr', () => {
  const exec = () => ({ code: 1, stdout: '', stderr: 'Error: boom' });
  const wp = createWp({ wp: 'wp', mode: 'local-wrapper', publicPath: '/s' }, { exec });
  assert.throws(() => wp.check(['plugin', 'list']), (e) => e instanceof WpError && /boom/.test(e.message) && e.code === 'EWP');
});

test('evalFile parses the last JSON line, ignoring PHP notices above it', () => {
  const exec = () => ({ code: 0, stdout: 'Notice: something\n{"ok":true,"n":2}\n', stderr: '' });
  const wp = createWp({ wp: 'wp', mode: 'local-wrapper', publicPath: '/s' }, { exec });
  assert.deepEqual(wp.evalFile('/x.php', ['a']), { ok: true, n: 2 });
});

test('evalFile without JSON output throws WpError', () => {
  const exec = () => ({ code: 0, stdout: 'not json\n', stderr: '' });
  const wp = createWp({ wp: 'wp', mode: 'local-wrapper', publicPath: '/s' }, { exec });
  assert.throws(() => wp.evalFile('/x.php'), WpError);
});

test('loadRuntime reads preflight.json from inside a theme folder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-rt-'));
  fs.writeFileSync(path.join(root, 'wp-config.php'), '<?php');
  fs.mkdirSync(path.join(root, 'wp-content/.protoblocks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'wp-content/themes/acme'), { recursive: true });
  fs.writeFileSync(path.join(root, 'wp-content/.protoblocks/preflight.json'),
    JSON.stringify({ ok: true, wp: '/w/wp', mode: 'local-wrapper', publicPath: root, url: 'http://a.local', localSite: null }));
  const rt = loadRuntime(path.join(root, 'wp-content/themes/acme'));
  assert.equal(rt.wp, '/w/wp');
  assert.equal(rt.url, 'http://a.local');
});

test('loadRuntime refuses a failed preflight report', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-rt-'));
  fs.writeFileSync(path.join(root, 'wp-config.php'), '<?php');
  fs.mkdirSync(path.join(root, 'wp-content/.protoblocks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'wp-content/.protoblocks/preflight.json'), JSON.stringify({ ok: false, wp: null }));
  assert.throws(() => loadRuntime(root), (e) => e.code === 'ENORUNTIME' && /failed/.test(e.message));
});

test('loadRuntime without preflight throws ENORUNTIME', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-rt-'));
  fs.writeFileSync(path.join(root, 'wp-config.php'), '<?php');
  assert.throws(() => loadRuntime(root), (e) => e.code === 'ENORUNTIME');
});
```

- [ ] **Step 4: Run to verify failure**

Run `npm test`. Expected: FAIL (cannot find `wp.mjs`).

- [ ] **Step 5: Implement** `skills/protoblocks-site-builder/scripts/lib/wp.mjs`

```js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec as realExec } from './exec.mjs';
import { findWpRoot } from './preflight.mjs';

export const WP_SCRIPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'wp');

export class WpError extends Error {
  constructor(args, result) {
    super(`wp ${args.join(' ')} failed (exit ${result.code}): ${(result.stderr || result.stdout || '').trim().slice(0, 2000)}`);
    this.code = 'EWP';
    this.args = args;
    this.result = result;
  }
}

export function createWp({ wp, mode, publicPath }, { exec = realExec } = {}) {
  const base = mode === 'native' ? [`--path=${publicPath}`] : [];
  const run = (args, opts = {}) => exec(wp, [...base, ...args], opts);
  const check = (args, opts) => {
    const r = run(args, opts);
    if (r.code !== 0) throw new WpError(args, r);
    return r.stdout;
  };
  const evalFile = (file, args = []) => {
    const full = ['eval-file', file, ...args];
    const out = check(full);
    const last = out.trim().split('\n').filter(Boolean).at(-1) ?? '';
    try {
      return JSON.parse(last);
    } catch {
      throw new WpError(full, { code: 0, stdout: out, stderr: 'eval-file did not print JSON on its last line' });
    }
  };
  return { run, check, evalFile, wp, mode, publicPath };
}

export function loadRuntime(dir) {
  const root = findWpRoot(dir);
  const file = root && path.join(root, 'wp-content', '.protoblocks', 'preflight.json');
  if (!file || !fs.existsSync(file)) {
    const e = new Error('Run preflight first: node preflight.mjs');
    e.code = 'ENORUNTIME';
    throw e;
  }
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (r.ok !== true || !r.wp) {
    const e = new Error('The last preflight failed; fix its checks and re-run: node preflight.mjs');
    e.code = 'ENORUNTIME';
    throw e;
  }
  return { wp: r.wp, mode: r.mode, publicPath: r.publicPath, url: r.url, localSite: r.localSite ?? null };
}
```

- [ ] **Step 6: Run unit tests**

Run `npm test`. Expected: PASS.

- [ ] **Step 7: Integration test** `tests/integration/wp.test.mjs`

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { itest, testWp, SITE_URL, PUBLIC, useItestTheme, restoreTheme, ORIGINAL_THEME } from './helpers.mjs';

itest('runner talks to the Local test site', () => {
  assert.match(SITE_URL, /^https?:\/\//);
  assert.equal(testWp().check(['option', 'get', 'siteurl']).trim(), SITE_URL);
});

itest('useItestTheme activates a throwaway copy and restoreTheme puts the original back', async () => {
  const wp = testWp();
  try {
    const dir = await useItestTheme(wp);
    assert.equal(wp.check(['option', 'get', 'stylesheet']).trim(), 'pb-itest');
    assert.ok(!fs.existsSync(path.join(dir, '.git')), 'never copies the developer git checkout');
  } finally {
    restoreTheme(wp);
  }
  assert.equal(wp.check(['option', 'get', 'stylesheet']).trim(), ORIGINAL_THEME);
  assert.ok(fs.existsSync(path.join(PUBLIC, 'wp-content/themes', ORIGINAL_THEME)));
});
```

Run `npm run test:integration`. Expected: PASS. If the Local site isn't running, the tests skip; then start it, or report that in the task report.

- [ ] **Step 8: Commit**

```bash
git add package.json skills/protoblocks-site-builder/scripts/lib/wp.mjs tests/unit/wp.test.mjs tests/integration
git commit -m "feat(wp): WP-CLI runner and Local test-site harness"
```

---

### Task 2: Release picking + download/unzip

**Files:**
- Create: `skills/protoblocks-site-builder/scripts/lib/releases.mjs`
- Create: `skills/protoblocks-site-builder/scripts/lib/download.mjs`
- Create: `tests/unit/releases.test.mjs`

**Interfaces:**
- Produces:
  - `pickRelease(releases: GitHubRelease[]) => { tag, version, zipUrl } | null` — highest `^v\d+\.\d+\.\d+$` tag, not draft, not prerelease, having an asset whose name ends in `.zip`.
  - `fetchLatestRelease(repo: 'owner/name', { fetchImpl = fetch } = {}) => Promise<{tag, version, zipUrl}>` — GETs `https://api.github.com/repos/${repo}/releases?per_page=30` with headers `Accept: application/vnd.github+json`, `User-Agent: protoblocks-site-builder`; throws `Error` (code `ERELEASE`) when the HTTP status isn't OK or nothing qualifies.
  - `download(url, dest, { fetchImpl = fetch } = {}) => Promise<string>` (dest path; creates parent dirs; throws on non-OK).
  - `unzip(zipFile, destDir, { exec } = {}) => string[]` (top-level entries in destDir after extraction; throws `Error` code `EUNZIP` on failure). Uses system `unzip -q -o`.

- [ ] **Step 1: Write failing tests** `tests/unit/releases.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pickRelease, fetchLatestRelease } from '../../skills/protoblocks-site-builder/scripts/lib/releases.mjs';
import { unzip } from '../../skills/protoblocks-site-builder/scripts/lib/download.mjs';

const rel = (tag, assets = [`x-${tag}.zip`], extra = {}) => ({
  tag_name: tag, draft: false, prerelease: false,
  assets: assets.map((n) => ({ name: n, browser_download_url: `https://dl/${tag}/${n}` })), ...extra,
});

test('pickRelease ignores the stale "latest" tag and picks the highest semver', () => {
  const list = [rel('latest', ['proto-blocks-2.10.0.zip']), rel('v2.9.1'), rel('v2.10.1'), rel('v2.10.0')];
  assert.deepEqual(pickRelease(list), { tag: 'v2.10.1', version: '2.10.1', zipUrl: 'https://dl/v2.10.1/x-v2.10.1.zip' });
});

test('pickRelease skips drafts, prereleases and releases without a zip', () => {
  const list = [rel('v3.0.0', [], {}), rel('v2.11.0', undefined, { draft: true }), rel('v2.10.5', undefined, { prerelease: true }), rel('v2.10.2')];
  assert.equal(pickRelease(list).tag, 'v2.10.2');
});

test('pickRelease returns null when nothing qualifies', () => {
  assert.equal(pickRelease([rel('latest')]), null);
});

test('fetchLatestRelease uses the releases list endpoint and errors clearly', async () => {
  let url;
  const ok = async (u) => { url = u; return { ok: true, json: async () => [rel('v1.1.3')] }; };
  const r = await fetchLatestRelease('o/n', { fetchImpl: ok });
  assert.equal(r.version, '1.1.3');
  assert.match(url, /\/repos\/o\/n\/releases\?per_page=30$/);
  const bad = async () => ({ ok: false, status: 403, statusText: 'rate limited', json: async () => ({}) });
  await assert.rejects(fetchLatestRelease('o/n', { fetchImpl: bad }), (e) => e.code === 'ERELEASE' && /403/.test(e.message));
});

test('unzip extracts and lists top-level entries', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-zip-'));
  fs.mkdirSync(path.join(dir, 'src/proto-theme'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/proto-theme/style.css'), '/* x */');
  execFileSync('zip', ['-qr', path.join(dir, 't.zip'), 'proto-theme'], { cwd: path.join(dir, 'src') });
  assert.deepEqual(unzip(path.join(dir, 't.zip'), path.join(dir, 'out')), ['proto-theme']);
  assert.ok(fs.existsSync(path.join(dir, 'out/proto-theme/style.css')));
});
```

- [ ] **Step 2: Run** `npm test` → Expected: FAIL (modules missing).

- [ ] **Step 3: Implement** `releases.mjs`

```js
import { compareVersions } from './preflight.mjs';

const SEMVER_TAG = /^v(\d+\.\d+\.\d+)$/;

export function pickRelease(releases) {
  const candidates = releases
    .filter((r) => !r.draft && !r.prerelease && SEMVER_TAG.test(r.tag_name ?? ''))
    .map((r) => ({ r, version: r.tag_name.match(SEMVER_TAG)[1], zip: (r.assets ?? []).find((a) => a.name?.endsWith('.zip')) }))
    .filter((c) => c.zip)
    .sort((a, b) => compareVersions(b.version, a.version));
  const best = candidates[0];
  return best ? { tag: best.r.tag_name, version: best.version, zipUrl: best.zip.browser_download_url } : null;
}

export async function fetchLatestRelease(repo, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases?per_page=30`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'protoblocks-site-builder' },
  });
  if (!res.ok) {
    const e = new Error(`GitHub releases for ${repo}: HTTP ${res.status} ${res.statusText ?? ''}`.trim());
    e.code = 'ERELEASE';
    throw e;
  }
  const picked = pickRelease(await res.json());
  if (!picked) {
    const e = new Error(`No vX.Y.Z release with a .zip asset found for ${repo}`);
    e.code = 'ERELEASE';
    throw e;
  }
  return picked;
}
```

- [ ] **Step 4: Implement** `download.mjs`

```js
import fs from 'node:fs';
import path from 'node:path';
import { exec as realExec } from './exec.mjs';

export async function download(url, dest, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'protoblocks-site-builder' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed ${url}: HTTP ${res.status}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

export function unzip(zipFile, destDir, { exec = realExec } = {}) {
  fs.mkdirSync(destDir, { recursive: true });
  const r = exec('unzip', ['-q', '-o', zipFile, '-d', destDir]);
  if (r.code !== 0) {
    const e = new Error(`unzip ${zipFile} failed: ${r.stderr.trim()}`);
    e.code = 'EUNZIP';
    throw e;
  }
  return fs.readdirSync(destDir).filter((n) => !n.startsWith('__MACOSX') && !n.startsWith('.'));
}
```

- [ ] **Step 5: Run** `npm test` → Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add skills/protoblocks-site-builder/scripts/lib/releases.mjs skills/protoblocks-site-builder/scripts/lib/download.mjs tests/unit/releases.test.mjs
git commit -m "feat(setup): semver release picking and download/unzip helpers"
```

---

### Task 3: Plugins, options, Tailwind enablement

**Files:**
- Create: `skills/protoblocks-site-builder/scripts/wp/tailwind.php`
- Create: `skills/protoblocks-site-builder/scripts/lib/setup-plugins.mjs`
- Create: `tests/integration/setup-plugins.test.mjs`

**Interfaces:**
- Consumes: `createWp`, `WP_SCRIPTS_DIR`, `loadRuntime` (Task 1); `fetchLatestRelease` (Task 2); `compareVersions` (Stage 1).
- Produces:
  - `tailwind.php` args: `enable` → `{"enabled":true,"settings":{…}}`; `compile` → `{"success":bool,"message":string}` (exit 1 when `success` false); `status` → settings object.
  - `WPORG_PLUGINS = ['wordpress-seo', 'safe-svg', 'duplicate-post']`
  - `ensurePlugins(wp, { fetchRelease = fetchLatestRelease } = {}) => Promise<{ plugins: {slug, action: 'installed'|'updated'|'activated'|'ok', version?}[], options: string[] }>`
  - CLI: `node setup-plugins.mjs [--cwd D]` → prints the result JSON.

- [ ] **Step 1: Write `scripts/wp/tailwind.php`**

```php
<?php
/**
 * Proto-Blocks Tailwind control. Usage: wp eval-file tailwind.php <enable|compile|status>
 * Prints one JSON line.
 */
if (!class_exists('\ProtoBlocks\Core\Plugin')) {
    fwrite(STDERR, "Proto-Blocks is not active.\n");
    exit(1);
}
$manager = \ProtoBlocks\Core\Plugin::getInstance()->getTailwindManager();
$cmd = $args[0] ?? 'status';

switch ($cmd) {
    case 'enable':
        $manager->updateSettings(['enabled' => true]);
        update_option('proto_blocks_component_style', 'tailwind');
        echo wp_json_encode(['enabled' => true, 'settings' => $manager->getSettings()]) . "\n";
        break;
    case 'compile':
        $result = $manager->compile();
        echo wp_json_encode($result) . "\n";
        if (empty($result['success'])) {
            exit(1);
        }
        break;
    case 'status':
        echo wp_json_encode($manager->getSettings()) . "\n";
        break;
    default:
        fwrite(STDERR, "Unknown command: {$cmd}\n");
        exit(1);
}
```

- [ ] **Step 2: Write the failing integration test** `tests/integration/setup-plugins.test.mjs`

```js
import assert from 'node:assert/strict';
import path from 'node:path';
import { itest, testWp } from './helpers.mjs';
import { ensurePlugins } from '../../skills/protoblocks-site-builder/scripts/lib/setup-plugins.mjs';
import { WP_SCRIPTS_DIR } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';

itest('ensurePlugins installs, configures, and is idempotent', async () => {
  const wp = testWp();
  const first = await ensurePlugins(wp);
  for (const slug of ['proto-blocks', 'wordpress-seo', 'safe-svg', 'duplicate-post']) {
    assert.equal(wp.check(['plugin', 'get', slug, '--field=status']).trim(), 'active', slug);
    assert.ok(first.plugins.find((p) => p.slug === slug), `${slug} reported`);
  }
  assert.equal(wp.check(['option', 'get', 'permalink_structure']).trim(), '/%postname%/');
  assert.equal(wp.check(['option', 'get', 'proto_blocks_wizard_completed']).trim(), '1');
  assert.equal(wp.evalFile(path.join(WP_SCRIPTS_DIR, 'tailwind.php'), ['status']).enabled, true);

  const second = await ensurePlugins(wp);
  assert.ok(second.plugins.every((p) => p.action === 'ok'), JSON.stringify(second.plugins));
});
```

Run: `npm run test:integration` → Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `setup-plugins.mjs`

```js
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWp, loadRuntime, WP_SCRIPTS_DIR } from './wp.mjs';
import { fetchLatestRelease } from './releases.mjs';
import { compareVersions } from './preflight.mjs';

export const WPORG_PLUGINS = ['wordpress-seo', 'safe-svg', 'duplicate-post'];
const PROTO_BLOCKS_REPO = 'GustavoGomez092/Proto-Blocks';

function pluginState(wp, slug) {
  const s = wp.run(['plugin', 'get', slug, '--field=status']);
  if (s.code !== 0) return { installed: false };
  const v = wp.run(['plugin', 'get', slug, '--field=version']);
  return { installed: true, active: s.stdout.trim() === 'active', version: v.stdout.trim() };
}

export async function ensurePlugins(wp, { fetchRelease = fetchLatestRelease } = {}) {
  const plugins = [];

  const rel = await fetchRelease(PROTO_BLOCKS_REPO);
  const pb = pluginState(wp, 'proto-blocks');
  if (!pb.installed || compareVersions(pb.version, rel.version) < 0) {
    wp.check(['plugin', 'install', rel.zipUrl, '--force', '--activate']);
    plugins.push({ slug: 'proto-blocks', action: pb.installed ? 'updated' : 'installed', version: rel.version });
  } else if (!pb.active) {
    wp.check(['plugin', 'activate', 'proto-blocks']);
    plugins.push({ slug: 'proto-blocks', action: 'activated', version: pb.version });
  } else {
    plugins.push({ slug: 'proto-blocks', action: 'ok', version: pb.version });
  }

  for (const slug of WPORG_PLUGINS) {
    const st = pluginState(wp, slug);
    if (!st.installed) {
      wp.check(['plugin', 'install', slug, '--activate']);
      plugins.push({ slug, action: 'installed' });
    } else if (!st.active) {
      wp.check(['plugin', 'activate', slug]);
      plugins.push({ slug, action: 'activated', version: st.version });
    } else {
      plugins.push({ slug, action: 'ok', version: st.version });
    }
  }

  const options = [];
  wp.check(['option', 'update', 'proto_blocks_wizard_completed', '1']);
  options.push('proto_blocks_wizard_completed');
  wp.evalFile(path.join(WP_SCRIPTS_DIR, 'tailwind.php'), ['enable']);
  options.push('proto_blocks_tailwind.enabled');
  if (wp.run(['option', 'get', 'permalink_structure']).stdout.trim() !== '/%postname%/') {
    wp.check(['rewrite', 'structure', '/%postname%/']);
    options.push('permalink_structure');
  }
  return { plugins, options };
}

async function main(argv) {
  const cwdIdx = argv.indexOf('--cwd');
  const rt = loadRuntime(cwdIdx >= 0 ? argv[cwdIdx + 1] : process.cwd());
  const result = await ensurePlugins(createWp(rt));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); });
}
```

- [ ] **Step 4: Run** `npm run test:integration` → Expected: PASS (needs network for GitHub + wordpress.org).

- [ ] **Step 5: Commit**

```bash
git add skills/protoblocks-site-builder/scripts/wp/tailwind.php skills/protoblocks-site-builder/scripts/lib/setup-plugins.mjs tests/integration/setup-plugins.test.mjs
git commit -m "feat(setup): install/activate required plugins, enable Tailwind, set permalinks"
```

---

### Task 4: Theme fetch + fork

**Files:**
- Create: `skills/protoblocks-site-builder/scripts/lib/theme-fork.mjs`
- Create: `tests/unit/theme-fork.test.mjs`
- Create: `tests/integration/theme-fork.test.mjs`

**Interfaces:**
- Consumes: `createWp`, `loadRuntime` (Task 1); `fetchLatestRelease` (Task 2); `download`, `unzip` (Task 2); `exec` (Stage 1).
- Produces:
  - `THEME_REPO = 'GustavoGomez092/proto-blocks-theme'`
  - `slugify(name) => string` (lowercase, `[^a-z0-9]+` → `-`, trimmed, ≤ 40 chars; throws `Error` code `ESLUG` when empty)
  - `forkMarker(styleCss) => string|null` (value of the `Proto Fork:` header)
  - `rewriteStyleHeader(styleCss, { name, slug, forkedFrom }) => string` — sets `Theme Name`, `Text Domain`, `Version: 1.0.0`, `Description: <name> — built with Proto-Blocks (forked from <forkedFrom>).`, and inserts `Proto Fork: <forkedFrom>` after `Text Domain` (replaces it if already present).
  - `rewriteTextDomain(src, slug) => string` — replaces every `'proto-theme'` (single-quoted literal) with `'<slug>'`.
  - `class ForkError extends Error { code: 'EFORKEXISTS'|'ENOTHEME' }`
  - `forkTheme({ wp, themesDir, name, slug?, force?, zipFile, forkedFrom }) => { themeDir, slug, reused: boolean, forkedFrom }` — synchronous; activates the theme in all cases; `git init` + initial commit when the folder is new and `git` exists.
  - CLI: `node theme-fork.mjs --name "Acme Co" [--slug acme] [--force] [--cwd D]` (downloads the latest theme release itself).

- [ ] **Step 1: Write failing unit tests** `tests/unit/theme-fork.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, forkMarker, rewriteStyleHeader, rewriteTextDomain } from '../../skills/protoblocks-site-builder/scripts/lib/theme-fork.mjs';

const STYLE = `/*
Theme Name: Proto-theme
Theme URI:
Description: A batteries-included block-theme starter for Proto-Blocks development.
Version: 1.1.3
Text Domain: proto-theme
Tags: block-theme
*/
body{}`;

test('slugify', () => {
  assert.equal(slugify('Acme Co — Website!'), 'acme-co-website');
  assert.throws(() => slugify('!!!'), (e) => e.code === 'ESLUG');
});

test('rewriteStyleHeader sets identity and the fork marker', () => {
  const out = rewriteStyleHeader(STYLE, { name: 'Acme Co', slug: 'acme-co', forkedFrom: 'proto-blocks-theme@1.1.3' });
  assert.match(out, /^Theme Name: Acme Co$/m);
  assert.match(out, /^Text Domain: acme-co$/m);
  assert.match(out, /^Version: 1\.0\.0$/m);
  assert.match(out, /^Description: Acme Co — built with Proto-Blocks \(forked from proto-blocks-theme@1\.1\.3\)\.$/m);
  assert.equal(forkMarker(out), 'proto-blocks-theme@1.1.3');
  assert.ok(out.endsWith('body{}'));
  const again = rewriteStyleHeader(out, { name: 'Acme Co', slug: 'acme-co', forkedFrom: 'proto-blocks-theme@1.1.4' });
  assert.equal(again.match(/^Proto Fork:/gm).length, 1);
  assert.equal(forkMarker(again), 'proto-blocks-theme@1.1.4');
});

test('forkMarker is null for a non-fork theme', () => {
  assert.equal(forkMarker(STYLE), null);
});

test('rewriteTextDomain replaces only the quoted literal', () => {
  const src = `__('Proto Blocks', 'proto-theme'); $x = "proto-theme-dev"; 'id' => 'proto-theme',`;
  assert.equal(rewriteTextDomain(src, 'acme'), `__('Proto Blocks', 'acme'); $x = "proto-theme-dev"; 'id' => 'acme',`);
});
```

- [ ] **Step 2: Run** `npm test` → Expected: FAIL.

- [ ] **Step 3: Implement** `theme-fork.mjs`

```js
#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { exec as realExec } from './exec.mjs';
import { createWp, loadRuntime } from './wp.mjs';
import { fetchLatestRelease } from './releases.mjs';
import { download, unzip } from './download.mjs';

export const THEME_REPO = 'GustavoGomez092/proto-blocks-theme';

export class ForkError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

export function slugify(name) {
  const s = String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  if (!s) { const e = new Error(`Cannot derive a theme slug from "${name}"`); e.code = 'ESLUG'; throw e; }
  return s;
}

export function forkMarker(css) {
  const m = css.match(/^Proto Fork:\s*(.+?)\s*$/m);
  return m ? m[1] : null;
}

export function rewriteStyleHeader(css, { name, slug, forkedFrom }) {
  let out = css
    .replace(/^Theme Name:.*$/m, `Theme Name: ${name}`)
    .replace(/^Text Domain:.*$/m, `Text Domain: ${slug}`)
    .replace(/^Version:.*$/m, 'Version: 1.0.0')
    .replace(/^Description:.*$/m, `Description: ${name} — built with Proto-Blocks (forked from ${forkedFrom}).`);
  if (/^Proto Fork:.*$/m.test(out)) out = out.replace(/^Proto Fork:.*$/m, `Proto Fork: ${forkedFrom}`);
  else out = out.replace(/^(Text Domain:.*)$/m, `$1\nProto Fork: ${forkedFrom}`);
  return out;
}

export const rewriteTextDomain = (src, slug) => src.replaceAll("'proto-theme'", `'${slug}'`);

function textDomainFiles(themeDir) {
  const files = [path.join(themeDir, 'functions.php')];
  for (const sub of ['inc', 'assets/editor']) {
    const dir = path.join(themeDir, sub);
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (/\.(php|js)$/.test(f)) files.push(path.join(dir, f));
  }
  return files.filter((f) => fs.existsSync(f));
}

function gitInit(themeDir, forkedFrom, exec) {
  if (exec('git', ['--version']).code !== 0 || fs.existsSync(path.join(themeDir, '.git'))) return false;
  exec('git', ['init', '-q'], { cwd: themeDir });
  exec('git', ['add', '-A'], { cwd: themeDir });
  const hasIdentity = exec('git', ['config', 'user.email'], { cwd: themeDir }).stdout.trim() !== '';
  const id = hasIdentity ? [] : ['-c', 'user.name=protoblocks', '-c', 'user.email=protoblocks@localhost'];
  return exec('git', [...id, 'commit', '-q', '-m', `chore: fork ${forkedFrom}`], { cwd: themeDir }).code === 0;
}

export function forkTheme({ wp, themesDir, name, slug = slugify(name), force = false, zipFile, forkedFrom, exec = realExec }) {
  const themeDir = path.join(themesDir, slug);
  if (fs.existsSync(themeDir)) {
    const style = path.join(themeDir, 'style.css');
    const marker = fs.existsSync(style) ? forkMarker(fs.readFileSync(style, 'utf8')) : null;
    if (marker && !force) {
      wp.check(['theme', 'activate', slug]);
      return { themeDir, slug, reused: true, forkedFrom: marker };
    }
    if (!force) {
      throw new ForkError(`wp-content/themes/${slug} already exists and is not a protoblocks fork. Ask the developer; re-run with --force to replace it (this deletes that folder).`, 'EFORKEXISTS');
    }
    fs.rmSync(themeDir, { recursive: true, force: true });
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-theme-'));
  const entries = unzip(zipFile, tmp);
  const src = entries.map((e) => path.join(tmp, e)).find((p) => fs.existsSync(path.join(p, 'style.css')));
  if (!src) throw new ForkError(`No theme folder with style.css inside ${zipFile}`, 'ENOTHEME');
  fs.cpSync(src, themeDir, { recursive: true });
  fs.rmSync(tmp, { recursive: true, force: true });

  const stylePath = path.join(themeDir, 'style.css');
  fs.writeFileSync(stylePath, rewriteStyleHeader(fs.readFileSync(stylePath, 'utf8'), { name, slug, forkedFrom }));
  for (const f of textDomainFiles(themeDir)) fs.writeFileSync(f, rewriteTextDomain(fs.readFileSync(f, 'utf8'), slug));

  gitInit(themeDir, forkedFrom, exec);
  wp.check(['theme', 'activate', slug]);
  return { themeDir, slug, reused: false, forkedFrom };
}

export async function fetchThemeZip({ fetchRelease = fetchLatestRelease } = {}) {
  const rel = await fetchRelease(THEME_REPO);
  const zipFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pb-themezip-')), `proto-theme-${rel.version}.zip`);
  await download(rel.zipUrl, zipFile);
  return { zipFile, forkedFrom: `proto-blocks-theme@${rel.version}` };
}

async function main(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--force') a.force = true;
    else if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[++i];
  }
  if (!a.name) { process.stderr.write('Usage: node theme-fork.mjs --name "<Project>" [--slug s] [--force] [--cwd D]\n'); process.exit(64); }
  const rt = loadRuntime(a.cwd ?? process.cwd());
  const { zipFile, forkedFrom } = await fetchThemeZip();
  const r = forkTheme({ wp: createWp(rt), themesDir: path.join(rt.publicPath, 'wp-content', 'themes'), name: a.name, slug: a.slug, force: !!a.force, zipFile, forkedFrom });
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); });
}
```

- [ ] **Step 4: Run** `npm test` → Expected: PASS.

- [ ] **Step 5: Write the integration test** `tests/integration/theme-fork.test.mjs`

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { itest, testWp, PUBLIC, restoreTheme } from './helpers.mjs';
import { forkTheme, fetchThemeZip, forkMarker } from '../../skills/protoblocks-site-builder/scripts/lib/theme-fork.mjs';

const themesDir = path.join(PUBLIC, 'wp-content/themes');

itest('forkTheme forks, activates, reuses, and refuses foreign folders', async () => {
  const wp = testWp();
  const { zipFile, forkedFrom } = await fetchThemeZip();
  fs.rmSync(path.join(themesDir, 'pb-itest'), { recursive: true, force: true });
  try {
  const first = forkTheme({ wp, themesDir, name: 'PB Itest', slug: 'pb-itest', zipFile, forkedFrom });
  assert.equal(first.reused, false);
  assert.equal(wp.check(['option', 'get', 'stylesheet']).trim(), 'pb-itest');
  const style = fs.readFileSync(path.join(themesDir, 'pb-itest/style.css'), 'utf8');
  assert.equal(forkMarker(style), forkedFrom);
  assert.match(fs.readFileSync(path.join(themesDir, 'pb-itest/functions.php'), 'utf8'), /'pb-itest'/);
  assert.equal(wp.check(['eval', 'echo wp_is_block_theme() ? "1" : "0";']).trim(), '1');

  const second = forkTheme({ wp, themesDir, name: 'PB Itest', slug: 'pb-itest', zipFile, forkedFrom });
  assert.equal(second.reused, true);

  fs.mkdirSync(path.join(themesDir, 'pb-foreign'), { recursive: true });
  fs.writeFileSync(path.join(themesDir, 'pb-foreign/style.css'), '/*\nTheme Name: Client\n*/');
  assert.throws(() => forkTheme({ wp, themesDir, name: 'x', slug: 'pb-foreign', zipFile, forkedFrom }), (e) => e.code === 'EFORKEXISTS');
  assert.ok(fs.existsSync(path.join(themesDir, 'pb-foreign/style.css')), 'foreign folder untouched');
  fs.rmSync(path.join(themesDir, 'pb-foreign'), { recursive: true, force: true });
  } finally { restoreTheme(wp); }
});
```

Run: `npm run test:integration` → Expected: PASS. (The `pb-itest` fork folder is kept for reuse by `useItestTheme`; the developer's original theme is re-activated in `finally`.)

- [ ] **Step 6: Commit**

```bash
git add skills/protoblocks-site-builder/scripts/lib/theme-fork.mjs tests/unit/theme-fork.test.mjs tests/integration/theme-fork.test.mjs
git commit -m "feat(setup): fetch and fork proto-blocks-theme with fork marker and safe reuse"
```

---

### Task 5: Managed theme assets

**Files:**
- Create: `skills/protoblocks-site-builder/scripts/theme-assets/inc/pb-assets.php`
- Create: `skills/protoblocks-site-builder/scripts/lib/theme-assets.mjs`
- Create: `tests/unit/theme-assets.test.mjs`
- Create: `tests/integration/theme-assets.test.mjs`

**Interfaces:**
- Produces:
  - `MANAGED_START = '// >>> protoblocks-site-builder (managed — do not edit between these markers)'`, `MANAGED_END = '// <<< protoblocks-site-builder'`
  - `ensureManagedBlock(functionsPhp: string) => string` — appends the block once; if markers exist, replaces the content between them (normalizes).
  - `DEFAULT_ASSETS_DIR` — absolute path of `scripts/theme-assets/`.
  - `installThemeAssets(themeDir, assetsDir = DEFAULT_ASSETS_DIR) => { copied: string[], functionsUpdated: boolean }` — copies every file under `assetsDir` whose basename starts with `pb-`, preserving relative paths; overwrites (managed files); updates `functions.php`.
  - Later stages add files to `scripts/theme-assets/` (e.g. `assets/js/pb-motion.js`, `inc/pb-schema.php`) and re-run `installThemeAssets`.
  - CLI: `node theme-assets.mjs install <themeDir>`.
  - `pb-assets.php`: enqueues every `assets/js/pb-*.js` with handle `basename` (e.g. `pb-motion`) at `wp_enqueue_scripts` priority 20, footer, deps = those of `proto-gsap`, `proto-scroll-trigger`, `proto-split-text`, `proto-init` that are registered, version = filemtime.

- [ ] **Step 1: Write failing unit tests** `tests/unit/theme-assets.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureManagedBlock, installThemeAssets, MANAGED_START } from '../../skills/protoblocks-site-builder/scripts/lib/theme-assets.mjs';

test('ensureManagedBlock appends once and normalizes on repeat', () => {
  const once = ensureManagedBlock("<?php\nrequire 'x.php';\n");
  assert.equal(once.split(MANAGED_START).length - 1, 1);
  assert.equal(ensureManagedBlock(once), once);
  const tampered = once.replace("glob(", "glob_TAMPERED(");
  assert.equal(ensureManagedBlock(tampered), once);
  assert.match(once, /require_once \$pb_file;/);
});

test('installThemeAssets copies pb-* files only and updates functions.php', () => {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-theme-'));
  const assets = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-assets-'));
  fs.writeFileSync(path.join(theme, 'functions.php'), '<?php\n');
  fs.mkdirSync(path.join(assets, 'inc'), { recursive: true });
  fs.mkdirSync(path.join(assets, 'assets/js'), { recursive: true });
  fs.writeFileSync(path.join(assets, 'inc/pb-assets.php'), '<?php // a');
  fs.writeFileSync(path.join(assets, 'assets/js/pb-motion.js'), '// m');
  fs.writeFileSync(path.join(assets, 'assets/js/README.md'), 'no');
  const r = installThemeAssets(theme, assets);
  assert.deepEqual(r.copied.sort(), ['assets/js/pb-motion.js', 'inc/pb-assets.php']);
  assert.equal(r.functionsUpdated, true);
  assert.ok(!fs.existsSync(path.join(theme, 'assets/js/README.md')));
  assert.equal(installThemeAssets(theme, assets).functionsUpdated, false);
});
```

- [ ] **Step 2: Run** `npm test` → Expected: FAIL.

- [ ] **Step 3: Write `scripts/theme-assets/inc/pb-assets.php`**

```php
<?php
/**
 * Managed by protoblocks-site-builder — overwritten on every install. Do not edit.
 * Enqueues assets/js/pb-*.js after the theme's animation globals.
 */
if (!defined('ABSPATH')) {
    exit;
}

add_action('wp_enqueue_scripts', function () {
    $dir = get_stylesheet_directory() . '/assets/js';
    $url = get_stylesheet_directory_uri() . '/assets/js';
    $deps = array_values(array_filter(
        ['proto-gsap', 'proto-scroll-trigger', 'proto-split-text', 'proto-init'],
        fn($handle) => wp_script_is($handle, 'registered')
    ));
    foreach ((glob($dir . '/pb-*.js') ?: []) as $file) {
        $name = basename($file, '.js');
        wp_enqueue_script($name, $url . '/' . $name . '.js', $deps, (string) filemtime($file), true);
    }
}, 20);
```

- [ ] **Step 4: Implement** `theme-assets.mjs`

```js
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MANAGED_START = '// >>> protoblocks-site-builder (managed — do not edit between these markers)';
export const MANAGED_END = '// <<< protoblocks-site-builder';
export const DEFAULT_ASSETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'theme-assets');

const BLOCK = [
  MANAGED_START,
  "foreach ((glob(__DIR__ . '/inc/pb-*.php') ?: []) as $pb_file) {",
  '    require_once $pb_file;',
  '}',
  MANAGED_END,
].join('\n');

export function ensureManagedBlock(src) {
  const start = src.indexOf(MANAGED_START);
  if (start === -1) return `${src.replace(/\s*$/, '')}\n\n${BLOCK}\n`;
  const end = src.indexOf(MANAGED_END, start);
  const tail = end === -1 ? '' : src.slice(end + MANAGED_END.length);
  return `${src.slice(0, start)}${BLOCK}${tail}`;
}

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p, base) : [path.relative(base, p)];
  });
}

export function installThemeAssets(themeDir, assetsDir = DEFAULT_ASSETS_DIR) {
  const copied = [];
  for (const rel of walk(assetsDir)) {
    if (!path.basename(rel).startsWith('pb-')) continue;
    const dest = path.join(themeDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(assetsDir, rel), dest);
    copied.push(rel.split(path.sep).join('/'));
  }
  const fnFile = path.join(themeDir, 'functions.php');
  const before = fs.readFileSync(fnFile, 'utf8');
  const after = ensureManagedBlock(before);
  if (after !== before) fs.writeFileSync(fnFile, after);
  return { copied, functionsUpdated: after !== before };
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const [cmd, themeDir] = process.argv.slice(2);
  if (cmd !== 'install' || !themeDir) { process.stderr.write('Usage: node theme-assets.mjs install <themeDir>\n'); process.exit(64); }
  process.stdout.write(`${JSON.stringify(installThemeAssets(themeDir), null, 2)}\n`);
}
```

- [ ] **Step 5: Run** `npm test` → Expected: PASS.

- [ ] **Step 6: Integration test** `tests/integration/theme-assets.test.mjs`

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { itest, testWp, useItestTheme, restoreTheme } from './helpers.mjs';
import { installThemeAssets } from '../../skills/protoblocks-site-builder/scripts/lib/theme-assets.mjs';

itest('managed assets load in WordPress and enqueue pb-*.js', async () => {
  const wp = testWp();
  const theme = await useItestTheme(wp);
  try {
  installThemeAssets(theme);
  fs.mkdirSync(path.join(theme, 'assets/js'), { recursive: true });
  fs.writeFileSync(path.join(theme, 'assets/js/pb-itest.js'), '// itest');
  const out = wp.check(['eval', 'do_action("wp_enqueue_scripts"); echo wp_script_is("pb-itest", "enqueued") ? "yes" : "no";']).trim();
  assert.equal(out, 'yes');
  fs.rmSync(path.join(theme, 'assets/js/pb-itest.js'));
  } finally { restoreTheme(wp); }
});
```

Run: `npm run test:integration` → Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add skills/protoblocks-site-builder/scripts/theme-assets skills/protoblocks-site-builder/scripts/lib/theme-assets.mjs tests/unit/theme-assets.test.mjs tests/integration/theme-assets.test.mjs
git commit -m "feat(setup): managed theme assets with idempotent functions.php loader"
```

---

### Task 6: Design tokens → Tailwind, theme.json, fonts

**Files:**
- Create: `skills/protoblocks-site-builder/scripts/lib/tokens.mjs`
- Create: `tests/unit/tokens.test.mjs`
- Create: `tests/integration/tokens.test.mjs`

**Interfaces:**
- Consumes: `createWp`, `loadRuntime`, `WP_SCRIPTS_DIR` (Task 1); `tailwind.php compile` (Task 3); `updateState`, `setPath` (Stage 1).
- Produces:
  - Tokens JSON shape (also documented in `protoblocks-site-setup/references/tokens.md`, Task 9):
    ```json
    {
      "colors":  { "ink": "#111111", "accent": "#ff5a1f" },
      "fonts":   { "sans": { "family": "Inter", "fallback": "ui-sans-serif, system-ui, sans-serif", "google": [400, 500, 700] },
                   "display": { "family": "Fraunces", "google": [600, 700] } },
      "type":    { "h1": { "size": "64px", "lineHeight": "1.05", "letterSpacing": "-0.02em", "fontWeight": "700" }, "body-md": "16px" },
      "radii":   { "card": "16px" },
      "shadows": { "soft": "0 6px 16px rgba(0,0,0,0.08)" },
      "spacing": { "section": "120px" }
    }
    ```
    `colors` required; everything else optional. `fonts.*.google` (array of weights) means "load from Google Fonts".
  - `validateTokens(tokens) => string[]` (errors with dotted paths, e.g. `colors.Accent: invalid name`).
  - `renderTailwindTheme(tokens) => string` — header comment + one `@theme { … }` block; namespaces `--color-*`, `--font-*`, `--text-*` (+ `--text-<k>--line-height|--letter-spacing|--font-weight`), `--radius-*`, `--shadow-*`, `--spacing-*`.
  - `mergeThemeJson(themeJson: object, tokens) => object` — replaces `settings.color.palette`, `settings.typography.fontFamilies`, `settings.typography.fontSizes` (only for provided groups); preserves everything else.
  - `googleFontsUrl(tokens) => string|null`; `rewriteFontImport(styleCss, tokens) => string`.
  - `applyTokens(themeDir, tokens) => { written: string[] }` (throws `Error` code `ETOKENS` listing all validation errors; writes nothing in that case).
  - CLI: `node tokens.mjs apply <themeDir> <tokens.json> [--no-compile]` → validates, applies, compiles Tailwind (unless `--no-compile`), saves `site.tokens` to state when the state file exists, prints `{written, compiled}`.

- [ ] **Step 1: Write failing unit tests** `tests/unit/tokens.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  validateTokens, renderTailwindTheme, mergeThemeJson, googleFontsUrl, rewriteFontImport, applyTokens,
} from '../../skills/protoblocks-site-builder/scripts/lib/tokens.mjs';

const tokens = {
  colors: { ink: '#111111', accent: '#ff5a1f' },
  fonts: { sans: { family: 'Inter', google: [700, 400, 400] }, display: { family: 'DM Serif Display', google: [400] } },
  type: { h1: { size: '64px', lineHeight: '1.05', letterSpacing: '-0.02em', fontWeight: '700' }, 'body-md': '16px' },
  radii: { card: '16px' },
  shadows: { soft: '0 6px 16px rgba(0,0,0,0.08)' },
  spacing: { section: 'clamp(64px, 10vw, 120px)' },
};

test('validateTokens accepts good tokens and reports bad ones with paths', () => {
  assert.deepEqual(validateTokens(tokens), []);
  const errs = validateTokens({ colors: { Accent: 'blue;}', ok: '#fff' }, type: { h1: '64' }, shadows: { x: 'a}b' } });
  assert.ok(errs.some((e) => e.startsWith('colors.Accent:')), errs.join('\n'));
  assert.ok(errs.some((e) => e.startsWith('type.h1:')), errs.join('\n'));
  assert.ok(errs.some((e) => e.startsWith('shadows.x:')), errs.join('\n'));
  assert.ok(validateTokens({}).some((e) => e.startsWith('colors:')));
});

test('renderTailwindTheme emits v4 namespaces', () => {
  const css = renderTailwindTheme(tokens);
  assert.match(css, /@theme \{/);
  assert.match(css, /--color-accent: #ff5a1f;/);
  assert.match(css, /--font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;/);
  assert.match(css, /--text-h1: 64px;\n\s*--text-h1--line-height: 1\.05;\n\s*--text-h1--letter-spacing: -0\.02em;\n\s*--text-h1--font-weight: 700;/);
  assert.match(css, /--text-body-md: 16px;/);
  assert.match(css, /--radius-card: 16px;/);
  assert.match(css, /--shadow-soft: 0 6px 16px rgba\(0,0,0,0\.08\);/);
  assert.match(css, /--spacing-section: clamp\(64px, 10vw, 120px\);/);
});

test('mergeThemeJson replaces token groups and preserves other settings', () => {
  const base = { version: 3, settings: { layout: { contentSize: '720px' }, typography: { fontFamilies: [{ slug: 'old' }] } }, templateParts: [1] };
  const out = mergeThemeJson(base, tokens);
  assert.deepEqual(out.settings.layout, { contentSize: '720px' });
  assert.deepEqual(out.templateParts, [1]);
  assert.deepEqual(out.settings.color.palette[1], { slug: 'accent', name: 'Accent', color: '#ff5a1f' });
  assert.equal(out.settings.typography.fontFamilies[0].fontFamily, '"Inter", ui-sans-serif, system-ui, sans-serif');
  assert.deepEqual(out.settings.typography.fontSizes[0], { slug: 'h1', name: 'H1', size: '64px' });
  assert.equal(base.settings.typography.fontFamilies[0].slug, 'old', 'input not mutated');
});

test('google fonts url and import rewrite', () => {
  assert.equal(googleFontsUrl(tokens), 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=DM+Serif+Display:wght@400&display=swap');
  const style = '/*\nTheme Name: X\n*/\n\n/* Optional web font — swap or remove. */\n@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap");\nbody{}';
  const out = rewriteFontImport(style, tokens);
  assert.equal(out.match(/@import url/g).length, 1);
  assert.ok(out.includes('family=DM+Serif+Display'));
  const none = rewriteFontImport(style, { colors: { a: '#000' } });
  assert.ok(!none.includes('@import url'));
  const inserted = rewriteFontImport('/*\nTheme Name: X\n*/\nbody{}', tokens);
  assert.match(inserted, /\*\/\n@import url\("https:\/\/fonts\.googleapis\.com/);
});

test('applyTokens writes three files, and writes nothing when invalid', () => {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-tok-'));
  fs.writeFileSync(path.join(theme, 'style.css'), '/*\nTheme Name: X\n*/\nbody{}');
  fs.writeFileSync(path.join(theme, 'theme.json'), JSON.stringify({ version: 3, settings: {} }));
  fs.writeFileSync(path.join(theme, 'tailwind-theme.css'), '@theme {}');
  assert.throws(() => applyTokens(theme, { colors: { BAD: 'x' } }), (e) => e.code === 'ETOKENS');
  assert.equal(fs.readFileSync(path.join(theme, 'tailwind-theme.css'), 'utf8'), '@theme {}');
  const r = applyTokens(theme, tokens);
  assert.deepEqual(r.written.sort(), ['style.css', 'tailwind-theme.css', 'theme.json']);
  assert.match(fs.readFileSync(path.join(theme, 'tailwind-theme.css'), 'utf8'), /--color-ink/);
});
```

- [ ] **Step 2: Run** `npm test` → Expected: FAIL.

- [ ] **Step 3: Implement** `tokens.mjs`

```js
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWp, loadRuntime, WP_SCRIPTS_DIR } from './wp.mjs';
import { statePath, updateState, setPath } from './state.mjs';

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const COLOR = /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab|color)\([^;{}]+\)|transparent|currentColor)$/;
const LENGTH = /^(0|-?\d*\.?\d+(px|rem|em|%|vw|vh|ch)|(clamp|calc|min|max)\([^;{}]+\))$/;
const UNITLESS = /^-?\d*\.?\d+$/;
const SAFE = (v) => typeof v === 'string' && v.trim() !== '' && !/[;{}]/.test(v);
const DEFAULT_FALLBACK = 'ui-sans-serif, system-ui, sans-serif';

export function validateTokens(t) {
  const errors = [];
  const group = (key, check) => {
    if (t[key] === undefined) return;
    if (typeof t[key] !== 'object' || t[key] === null || Array.isArray(t[key])) { errors.push(`${key}: must be an object`); return; }
    for (const [name, value] of Object.entries(t[key])) {
      if (!NAME.test(name)) errors.push(`${key}.${name}: invalid name (use lowercase-kebab-case)`);
      const problem = check(value);
      if (problem) errors.push(`${key}.${name}: ${problem}`);
    }
  };
  if (!t.colors || typeof t.colors !== 'object' || !Object.keys(t.colors).length) errors.push('colors: at least one color is required');
  group('colors', (v) => (SAFE(v) && COLOR.test(v.trim()) ? null : `invalid color ${JSON.stringify(v)}`));
  group('fonts', (v) => {
    if (!v || !SAFE(v.family) || /["']/.test(v.family)) return 'needs a "family" string without quotes';
    if (v.fallback !== undefined && !SAFE(v.fallback)) return 'invalid fallback';
    if (v.google !== undefined && !(Array.isArray(v.google) && v.google.every((w) => Number.isInteger(w) && w >= 100 && w <= 900))) return 'google must be an array of weights 100–900';
    return null;
  });
  group('type', (v) => {
    const size = typeof v === 'string' ? v : v?.size;
    if (!SAFE(size) || !LENGTH.test(size)) return `invalid size ${JSON.stringify(size)}`;
    if (typeof v === 'object') {
      if (v.lineHeight !== undefined && !(SAFE(String(v.lineHeight)) && (UNITLESS.test(String(v.lineHeight)) || LENGTH.test(String(v.lineHeight))))) return 'invalid lineHeight';
      if (v.letterSpacing !== undefined && !(SAFE(v.letterSpacing) && LENGTH.test(v.letterSpacing))) return 'invalid letterSpacing';
      if (v.fontWeight !== undefined && !/^[1-9]00$/.test(String(v.fontWeight))) return 'invalid fontWeight';
    }
    return null;
  });
  group('radii', (v) => (SAFE(v) && LENGTH.test(v) ? null : `invalid length ${JSON.stringify(v)}`));
  group('spacing', (v) => (SAFE(v) && LENGTH.test(v) ? null : `invalid length ${JSON.stringify(v)}`));
  group('shadows', (v) => (SAFE(v) ? null : `invalid shadow ${JSON.stringify(v)}`));
  return errors;
}

const fontStack = (f) => `"${f.family}", ${f.fallback ?? DEFAULT_FALLBACK}`;
const title = (k) => k.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

export function renderTailwindTheme(t) {
  const lines = [
    '/*',
    ' * Design tokens — generated by protoblocks-site-builder (tokens.mjs apply).',
    ' * Re-applying tokens overwrites this file. Each token becomes a Tailwind utility',
    ' * (e.g. --color-accent → bg-accent, --text-h1 → text-h1, --radius-card → rounded-card).',
    ' */',
    '@theme {',
  ];
  const section = (label, entries) => { if (entries.length) lines.push(`  /* ${label} */`, ...entries.map((e) => `  ${e}`), ''); };
  section('Colors', Object.entries(t.colors ?? {}).map(([k, v]) => `--color-${k}: ${v};`));
  section('Fonts', Object.entries(t.fonts ?? {}).map(([k, f]) => `--font-${k}: ${fontStack(f)};`));
  section('Type scale', Object.entries(t.type ?? {}).flatMap(([k, v]) => {
    if (typeof v === 'string') return [`--text-${k}: ${v};`];
    const out = [`--text-${k}: ${v.size};`];
    if (v.lineHeight !== undefined) out.push(`--text-${k}--line-height: ${v.lineHeight};`);
    if (v.letterSpacing !== undefined) out.push(`--text-${k}--letter-spacing: ${v.letterSpacing};`);
    if (v.fontWeight !== undefined) out.push(`--text-${k}--font-weight: ${v.fontWeight};`);
    return out;
  }));
  section('Radii', Object.entries(t.radii ?? {}).map(([k, v]) => `--radius-${k}: ${v};`));
  section('Shadows', Object.entries(t.shadows ?? {}).map(([k, v]) => `--shadow-${k}: ${v};`));
  section('Spacing', Object.entries(t.spacing ?? {}).map(([k, v]) => `--spacing-${k}: ${v};`));
  if (lines.at(-1) === '') lines.pop();
  lines.push('}', '');
  return lines.join('\n');
}

export function mergeThemeJson(json, t) {
  const out = structuredClone(json);
  out.settings ??= {};
  if (t.colors) {
    out.settings.color ??= {};
    out.settings.color.palette = Object.entries(t.colors).map(([slug, color]) => ({ slug, name: title(slug), color }));
  }
  if (t.fonts || t.type) out.settings.typography ??= {};
  if (t.fonts) {
    out.settings.typography.fontFamilies = Object.entries(t.fonts).map(([slug, f]) => ({ slug, name: f.family, fontFamily: fontStack(f) }));
  }
  if (t.type) {
    out.settings.typography.fontSizes = Object.entries(t.type).map(([slug, v]) => ({ slug, name: title(slug), size: typeof v === 'string' ? v : v.size }));
  }
  return out;
}

export function googleFontsUrl(t) {
  const fams = Object.values(t.fonts ?? {}).filter((f) => Array.isArray(f.google) && f.google.length);
  if (!fams.length) return null;
  const parts = fams.map((f) => `family=${f.family.trim().replace(/\s+/g, '+')}:wght@${[...new Set(f.google)].sort((a, b) => a - b).join(';')}`);
  return `https://fonts.googleapis.com/css2?${parts.join('&')}&display=swap`;
}

const IMPORT_RE = /^[ \t]*@import url\("https:\/\/fonts\.googleapis\.com[^"]*"\);[ \t]*\n?/gm;

export function rewriteFontImport(css, t) {
  const url = googleFontsUrl(t);
  const line = url ? `@import url("${url}");\n` : '';
  if (IMPORT_RE.test(css)) {
    IMPORT_RE.lastIndex = 0;
    let first = true;
    return css.replace(IMPORT_RE, () => { const r = first ? line : ''; first = false; return r; });
  }
  if (!line) return css;
  const end = css.indexOf('*/');
  return end === -1 ? `${line}${css}` : `${css.slice(0, end + 2)}\n${line}${css.slice(end + 2).replace(/^\n/, '')}`;
}

export function applyTokens(themeDir, t) {
  const errors = validateTokens(t);
  if (errors.length) {
    const e = new Error(`Invalid tokens:\n- ${errors.join('\n- ')}`);
    e.code = 'ETOKENS';
    throw e;
  }
  const tw = path.join(themeDir, 'tailwind-theme.css');
  const tj = path.join(themeDir, 'theme.json');
  const st = path.join(themeDir, 'style.css');
  fs.writeFileSync(tw, renderTailwindTheme(t));
  fs.writeFileSync(tj, `${JSON.stringify(mergeThemeJson(JSON.parse(fs.readFileSync(tj, 'utf8')), t), null, '\t')}\n`);
  fs.writeFileSync(st, rewriteFontImport(fs.readFileSync(st, 'utf8'), t));
  return { written: ['tailwind-theme.css', 'theme.json', 'style.css'] };
}

function main(argv) {
  const [cmd, themeDir, file] = argv;
  if (cmd !== 'apply' || !themeDir || !file) { process.stderr.write('Usage: node tokens.mjs apply <themeDir> <tokens.json> [--no-compile]\n'); process.exit(64); }
  const t = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { written } = applyTokens(themeDir, t);
  let compiled = null;
  if (!argv.includes('--no-compile')) {
    compiled = createWp(loadRuntime(themeDir)).evalFile(path.join(WP_SCRIPTS_DIR, 'tailwind.php'), ['compile']);
  }
  if (fs.existsSync(statePath(themeDir))) updateState(themeDir, (s) => { setPath(s, 'site.tokens', t); });
  process.stdout.write(`${JSON.stringify({ written, compiled }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); }
}
```

- [ ] **Step 4: Run** `npm test` → Expected: PASS.

- [ ] **Step 5: Integration test** `tests/integration/tokens.test.mjs`

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { itest, testWp, useItestTheme, restoreTheme } from './helpers.mjs';
import { applyTokens } from '../../skills/protoblocks-site-builder/scripts/lib/tokens.mjs';
import { WP_SCRIPTS_DIR } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';

itest('applied tokens reach theme.json and compile with Tailwind', async () => {
  const wp = testWp();
  const theme = await useItestTheme(wp);
  try {
  applyTokens(theme, { colors: { ink: '#101010', accent: '#ff5a1f' }, fonts: { sans: { family: 'Inter', google: [400, 700] } } });
  const palette = JSON.parse(wp.check(['eval', 'echo wp_json_encode(wp_get_global_settings(["color","palette","theme"]));']));
  assert.ok(palette.some((p) => p.slug === 'accent' && p.color === '#ff5a1f'), JSON.stringify(palette));
  const r = wp.evalFile(path.join(WP_SCRIPTS_DIR, 'tailwind.php'), ['compile']);
  assert.equal(r.success, true, JSON.stringify(r));
  } finally { restoreTheme(wp); }
});
```

Run: `npm run test:integration` → Expected: PASS. If Tailwind compile fails because the CLI binary can't be downloaded in this environment, record the exact error in the report and mark the compile assertion as DONE_WITH_CONCERNS — do not weaken the assertion.

- [ ] **Step 6: Commit**

```bash
git add skills/protoblocks-site-builder/scripts/lib/tokens.mjs tests/unit/tokens.test.mjs tests/integration/tokens.test.mjs
git commit -m "feat(setup): design tokens to Tailwind @theme, theme.json and Google Fonts"
```

---

### Task 7: Block-theme navigation menus

**Files:**
- Create: `skills/protoblocks-site-builder/scripts/wp/navigation.php`
- Create: `skills/protoblocks-site-builder/scripts/lib/navigation.mjs`
- Create: `tests/integration/navigation.test.mjs`

**Interfaces:**
- Consumes: `createWp`, `loadRuntime`, `WP_SCRIPTS_DIR` (Task 1); state helpers (Stage 1).
- Produces:
  - Menu spec JSON: `{ "title": "Primary", "items": [ { "label": "Home", "page": "home" }, { "label": "Docs", "url": "https://x", "opensInNewTab": true }, { "label": "Company", "page": "about", "children": [ { "label": "Team", "page": "team" } ] } ] }`
  - `navigation.php upsert <key> <specFile>` → `{"id":int,"key":string,"created":bool,"pending":[{"label","page"}]}`; `navigation.php get <key>` → `{"id":int|null,"content":string}`.
  - `upsertMenu(wp, key, spec) => {id, key, created, pending}`
  - `refreshMenus(wp, themeDir) => {refreshed: string[]}` — re-upserts every menu in `state.site.navigation.menus` whose `pending` is non-empty, storing the new result.
  - State: `site.navigation.menus[<key>] = { id, spec, pending }`.
  - CLI: `node navigation.mjs upsert <themeDir> <key> <spec.json>`; `node navigation.mjs refresh <themeDir>`.

- [ ] **Step 1: Write `scripts/wp/navigation.php`**

```php
<?php
/**
 * Block-theme navigation menus (wp_navigation posts).
 * Usage: wp eval-file navigation.php upsert <key> <spec.json>
 *        wp eval-file navigation.php get <key>
 */
kses_remove_filters();

$pb_fail = function (string $msg) { fwrite(STDERR, $msg . "\n"); exit(1); };
$cmd = $args[0] ?? '';
$key = sanitize_key($args[1] ?? '');
if ($key === '') { $pb_fail('Missing menu key.'); }
$slug = 'pb-nav-' . $key;

function pb_nav_find(string $slug) {
    $found = get_posts([
        'post_type' => 'wp_navigation', 'name' => $slug, 'numberposts' => 1,
        'post_status' => ['publish', 'draft', 'private'],
    ]);
    return $found ? $found[0] : null;
}

function pb_nav_link_attrs(array $item, array &$pending): array {
    $attrs = ['label' => (string) ($item['label'] ?? '')];
    if (!empty($item['page'])) {
        $page = get_page_by_path((string) $item['page'], OBJECT, 'page');
        if ($page && $page->post_status !== 'trash') {
            return $attrs + ['type' => 'page', 'id' => (int) $page->ID, 'url' => get_permalink($page), 'kind' => 'post-type'];
        }
        $pending[] = ['label' => $attrs['label'], 'page' => (string) $item['page']];
        return $attrs + ['url' => home_url('/' . trim((string) $item['page'], '/') . '/'), 'kind' => 'custom'];
    }
    $attrs += ['url' => (string) ($item['url'] ?? '#'), 'kind' => 'custom'];
    if (!empty($item['opensInNewTab'])) { $attrs['opensInNewTab'] = true; }
    return $attrs;
}

function pb_nav_block(array $item, array &$pending): array {
    $attrs = pb_nav_link_attrs($item, $pending);
    if (!empty($item['children']) && is_array($item['children'])) {
        $inner = [];
        foreach ($item['children'] as $child) { $inner[] = pb_nav_block($child, $pending); }
        return ['blockName' => 'core/navigation-submenu', 'attrs' => $attrs, 'innerBlocks' => $inner,
                'innerHTML' => '', 'innerContent' => array_fill(0, count($inner), null)];
    }
    return ['blockName' => 'core/navigation-link', 'attrs' => $attrs, 'innerBlocks' => [], 'innerHTML' => '', 'innerContent' => []];
}

if ($cmd === 'get') {
    $post = pb_nav_find($slug);
    echo wp_json_encode(['id' => $post ? (int) $post->ID : null, 'content' => $post ? $post->post_content : '']) . "\n";
    return;
}

if ($cmd !== 'upsert') { $pb_fail("Unknown command: {$cmd}"); }
$file = $args[2] ?? '';
$spec = is_readable($file) ? json_decode((string) file_get_contents($file), true) : null;
if (!is_array($spec) || !isset($spec['items']) || !is_array($spec['items'])) { $pb_fail("Spec file {$file} must be JSON with an items array."); }

$pending = [];
$blocks = [];
foreach ($spec['items'] as $item) { $blocks[] = pb_nav_block($item, $pending); }

$existing = pb_nav_find($slug);
$postarr = [
    'post_type' => 'wp_navigation', 'post_status' => 'publish', 'post_name' => $slug,
    'post_title' => (string) ($spec['title'] ?? ucfirst($key)), 'post_content' => serialize_blocks($blocks),
];
if ($existing) { $postarr['ID'] = $existing->ID; }
$id = $existing ? wp_update_post(wp_slash($postarr), true) : wp_insert_post(wp_slash($postarr), true);
if (is_wp_error($id)) { $pb_fail($id->get_error_message()); }

echo wp_json_encode(['id' => (int) $id, 'key' => $key, 'created' => !$existing, 'pending' => $pending]) . "\n";
```

- [ ] **Step 2: Implement** `navigation.mjs`

```js
#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWp, loadRuntime, WP_SCRIPTS_DIR } from './wp.mjs';
import { loadState, updateState, setPath, statePath } from './state.mjs';

const SCRIPT = path.join(WP_SCRIPTS_DIR, 'navigation.php');

export function upsertMenu(wp, key, spec) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pb-nav-')), `${key}.json`);
  fs.writeFileSync(file, JSON.stringify(spec));
  try {
    return wp.evalFile(SCRIPT, ['upsert', key, file]);
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
}

function record(themeDir, key, spec, result) {
  if (!fs.existsSync(statePath(themeDir))) return;
  updateState(themeDir, (s) => { setPath(s, `site.navigation.menus.${key}`, { id: result.id, spec, pending: result.pending }); });
}

export function refreshMenus(wp, themeDir) {
  const menus = loadState(themeDir).site.navigation?.menus ?? {};
  const refreshed = [];
  for (const [key, m] of Object.entries(menus)) {
    if (!m.pending?.length) continue;
    record(themeDir, key, m.spec, upsertMenu(wp, key, m.spec));
    refreshed.push(key);
  }
  return { refreshed };
}

function main(argv) {
  const [cmd, themeDir, key, file] = argv;
  if (!themeDir || !['upsert', 'refresh'].includes(cmd)) {
    process.stderr.write('Usage: node navigation.mjs upsert <themeDir> <key> <spec.json> | refresh <themeDir>\n');
    process.exit(64);
  }
  const wp = createWp(loadRuntime(themeDir));
  if (cmd === 'refresh') { process.stdout.write(`${JSON.stringify(refreshMenus(wp, themeDir), null, 2)}\n`); return; }
  const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
  const result = upsertMenu(wp, key, spec);
  record(themeDir, key, spec, result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); }
}
```

- [ ] **Step 3: Write the integration test** `tests/integration/navigation.test.mjs`

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { itest, testWp } from './helpers.mjs';
import { upsertMenu, refreshMenus } from '../../skills/protoblocks-site-builder/scripts/lib/navigation.mjs';
import { initState, loadState, updateState, setPath } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';
import { WP_SCRIPTS_DIR } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';

itest('menus upsert idempotently and pending page links resolve on refresh', () => {
  const wp = testWp();
  wp.run(['post', 'delete', ...wp.check(['post', 'list', '--post_type=page', '--name=pb-nav-later', '--field=ID', '--format=ids']).trim().split(/\s+/).filter(Boolean), '--force']);
  const homeId = wp.check(['post', 'create', '--post_type=page', '--post_status=publish', '--post_title=PB Nav Home', '--post_name=pb-nav-home', '--porcelain']).trim();
  const spec = { title: 'Primary', items: [
    { label: 'Home', page: 'pb-nav-home' },
    { label: 'Later', page: 'pb-nav-later' },
    { label: 'More', url: 'https://example.com', children: [{ label: 'Docs', url: 'https://example.com/docs', opensInNewTab: true }] },
  ] };

  const a = upsertMenu(wp, 'itest', spec);
  const b = upsertMenu(wp, 'itest', spec);
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(a.id, b.id);
  assert.deepEqual(b.pending, [{ label: 'Later', page: 'pb-nav-later' }]);
  const count = wp.check(['post', 'list', '--post_type=wp_navigation', '--name=pb-nav-itest', '--format=count']).trim();
  assert.equal(count, '1');
  const content = wp.evalFile(path.join(WP_SCRIPTS_DIR, 'navigation.php'), ['get', 'itest']).content;
  assert.match(content, new RegExp(`"id":${homeId}`));
  assert.match(content, /"kind":"post-type"/);
  assert.match(content, /wp:navigation-submenu/);

  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-navstate-'));
  initState(theme, { url: 'http://proto-blocks.local', path: '/x' });
  updateState(theme, (s) => { setPath(s, 'site.navigation.menus.itest', { id: b.id, spec, pending: b.pending }); });
  wp.check(['post', 'create', '--post_type=page', '--post_status=publish', '--post_title=PB Nav Later', '--post_name=pb-nav-later', '--porcelain']);
  assert.deepEqual(refreshMenus(wp, theme).refreshed, ['itest']);
  assert.deepEqual(loadState(theme).site.navigation.menus.itest.pending, []);

  // cleanup on the shared Local test site
  for (const name of ['pb-nav-home', 'pb-nav-later']) {
    const ids = wp.check(['post', 'list', '--post_type=page', `--name=${name}`, '--format=ids']).trim().split(/\s+/).filter(Boolean);
    if (ids.length) wp.check(['post', 'delete', ...ids, '--force']);
  }
  wp.check(['post', 'delete', String(b.id), '--force']);
});
```

Run: `npm run test:integration` → Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add skills/protoblocks-site-builder/scripts/wp/navigation.php skills/protoblocks-site-builder/scripts/lib/navigation.mjs tests/integration/navigation.test.mjs
git commit -m "feat(setup): block-theme navigation menus with pending page links"
```

---

### Task 8: Template parts + Site Editor overrides

**Files:**
- Create: `skills/protoblocks-site-builder/scripts/lib/blocks.mjs`
- Create: `skills/protoblocks-site-builder/scripts/wp/parts.php`
- Create: `skills/protoblocks-site-builder/scripts/lib/parts.mjs`
- Create: `tests/unit/blocks.test.mjs`
- Create: `tests/unit/parts.test.mjs`
- Create: `tests/integration/parts.test.mjs`

**Interfaces:**
- Produces:
  - `serializeAttrs(attrs) => string` — JSON like WordPress `serialize_block_attributes()`: `--` → `--`, `<` → `<`, `>` → `>`, `&` → `&`, `\"` → `"`; empty object → `''`.
  - `blockComment(name, attrs, innerMarkup?) => string` — self-closing `<!-- wp:name {attrs} /-->` when `innerMarkup` is undefined; otherwise `<!-- wp:name {attrs} -->\n{inner}\n<!-- /wp:name -->`. Block names without a namespace are written as given (core blocks).
  - `partMarkup({ block, attrs = {}, navRef }) => string` — the proto-block wrapping `core/navigation {"ref":navRef}` when `navRef` is a number, else self-closing.
  - `writePart(themeDir, slug, markup) => string` (path; slug must match `/^[a-z0-9-]+$/`).
  - `parts.php overrides` → `[{id, slug, theme, modified}]` for the active stylesheet; `parts.php remove-override <slug>` → `{removed:int[]}`.
  - `listOverrides(wp) => array`, `removeOverride(wp, slug, { confirm }) => {removed}` — throws `Error` code `ECONFIRM` without `confirm: true`.
  - CLI: `node parts.mjs write <themeDir> <slug> <markupFile>`; `node parts.mjs overrides <themeDir>`; `node parts.mjs remove-override <themeDir> <slug> --confirm`.

- [ ] **Step 1: Failing unit tests**

`tests/unit/blocks.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeAttrs, blockComment } from '../../skills/protoblocks-site-builder/scripts/lib/blocks.mjs';

test('serializeAttrs escapes like WordPress', () => {
  assert.equal(serializeAttrs({}), '');
  assert.equal(serializeAttrs({ a: '--><script>&"' }), '{"a":"\\u002d\\u002d\\u003e\\u003cscript\\u003e\\u0026\\u0022"}');
});

test('blockComment self-closing and wrapping', () => {
  assert.equal(blockComment('navigation', { ref: 5 }), '<!-- wp:navigation {"ref":5} /-->');
  assert.equal(blockComment('proto-blocks/site-header', {}, 'X'), '<!-- wp:proto-blocks/site-header -->\nX\n<!-- /wp:proto-blocks/site-header -->');
});
```

`tests/unit/parts.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { partMarkup, writePart, removeOverride } from '../../skills/protoblocks-site-builder/scripts/lib/parts.mjs';

test('partMarkup wraps core/navigation inside the proto-block', () => {
  assert.equal(
    partMarkup({ block: 'proto-blocks/site-header', attrs: { sticky: true }, navRef: 12 }),
    '<!-- wp:proto-blocks/site-header {"sticky":true} -->\n<!-- wp:navigation {"ref":12} /-->\n<!-- /wp:proto-blocks/site-header -->\n',
  );
  assert.equal(partMarkup({ block: 'proto-blocks/site-footer' }), '<!-- wp:proto-blocks/site-footer /-->\n');
});

test('writePart writes parts/<slug>.html and rejects bad slugs', () => {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-parts-'));
  const p = writePart(theme, 'header', 'X');
  assert.equal(fs.readFileSync(p, 'utf8'), 'X');
  assert.equal(p, path.join(theme, 'parts/header.html'));
  assert.throws(() => writePart(theme, '../evil', 'X'));
});

test('removeOverride refuses without confirm', () => {
  const wp = { evalFile: () => { throw new Error('must not be called'); } };
  assert.throws(() => removeOverride(wp, 'header', {}), (e) => e.code === 'ECONFIRM' && /Site Editor/.test(e.message));
});
```

- [ ] **Step 2: Run** `npm test` → Expected: FAIL.

- [ ] **Step 3: Implement** `blocks.mjs`

```js
export function serializeAttrs(attrs) {
  if (!attrs || !Object.keys(attrs).length) return '';
  return JSON.stringify(attrs)
    .replace(/--/g, '\\u002d\\u002d')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\\"/g, '\\u0022');
}

export function blockComment(name, attrs = {}, innerMarkup) {
  const a = serializeAttrs(attrs);
  const open = `<!-- wp:${name}${a ? ` ${a}` : ''}`;
  if (innerMarkup === undefined) return `${open} /-->`;
  return `${open} -->\n${innerMarkup}\n<!-- /wp:${name} -->`;
}
```

- [ ] **Step 4: Write `scripts/wp/parts.php`**

```php
<?php
/**
 * Template-part DB overrides (Site Editor saved copies) for the active theme.
 * Usage: wp eval-file parts.php overrides
 *        wp eval-file parts.php remove-override <slug>
 */
$cmd = $args[0] ?? '';
$theme = get_stylesheet();
$query = function (?string $slug) use ($theme) {
    $q = [
        'post_type' => 'wp_template_part', 'numberposts' => -1,
        'post_status' => ['publish', 'draft', 'auto-draft', 'private'],
        'tax_query' => [['taxonomy' => 'wp_theme', 'field' => 'name', 'terms' => $theme]],
    ];
    if ($slug !== null) { $q['name'] = $slug; }
    return get_posts($q);
};

if ($cmd === 'overrides') {
    $out = array_map(fn($p) => ['id' => (int) $p->ID, 'slug' => $p->post_name, 'theme' => $theme, 'modified' => $p->post_modified_gmt], $query(null));
    echo wp_json_encode(array_values($out)) . "\n";
    return;
}
if ($cmd === 'remove-override') {
    $slug = sanitize_title($args[1] ?? '');
    if ($slug === '') { fwrite(STDERR, "Missing slug.\n"); exit(1); }
    $removed = [];
    foreach ($query($slug) as $p) {
        if (wp_delete_post($p->ID, true)) { $removed[] = (int) $p->ID; }
    }
    echo wp_json_encode(['removed' => $removed]) . "\n";
    return;
}
fwrite(STDERR, "Unknown command: {$cmd}\n");
exit(1);
```

- [ ] **Step 5: Implement** `parts.mjs`

```js
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWp, loadRuntime, WP_SCRIPTS_DIR } from './wp.mjs';
import { blockComment } from './blocks.mjs';

const SCRIPT = path.join(WP_SCRIPTS_DIR, 'parts.php');

export function partMarkup({ block, attrs = {}, navRef }) {
  const inner = Number.isInteger(navRef) ? blockComment('navigation', { ref: navRef }) : undefined;
  return `${blockComment(block, attrs, inner)}\n`;
}

export function writePart(themeDir, slug, markup) {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`Invalid part slug "${slug}"`);
  const file = path.join(themeDir, 'parts', `${slug}.html`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, markup);
  return file;
}

export const listOverrides = (wp) => wp.evalFile(SCRIPT, ['overrides']);

export function removeOverride(wp, slug, { confirm } = {}) {
  if (!confirm) {
    const e = new Error(`The Site Editor has a saved copy of the "${slug}" part. Removing it discards edits made there. Ask the developer, then re-run with --confirm.`);
    e.code = 'ECONFIRM';
    throw e;
  }
  return wp.evalFile(SCRIPT, ['remove-override', slug]);
}

function main(argv) {
  const [cmd, themeDir, slug, file] = argv;
  const out = (v) => process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
  if (cmd === 'write') return out({ written: writePart(themeDir, slug, fs.readFileSync(file, 'utf8')) });
  const wp = createWp(loadRuntime(themeDir));
  if (cmd === 'overrides') return out(listOverrides(wp));
  if (cmd === 'remove-override') return out(removeOverride(wp, slug, { confirm: argv.includes('--confirm') }));
  process.stderr.write('Usage: node parts.mjs write <themeDir> <slug> <markupFile> | overrides <themeDir> | remove-override <themeDir> <slug> --confirm\n');
  process.exit(64);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); }
}
```

- [ ] **Step 6: Run** `npm test` → Expected: PASS.

- [ ] **Step 7: Integration test** `tests/integration/parts.test.mjs`

```js
import assert from 'node:assert/strict';
import { itest, testWp, useItestTheme, restoreTheme } from './helpers.mjs';
import { listOverrides, removeOverride } from '../../skills/protoblocks-site-builder/scripts/lib/parts.mjs';

// Runs on the throwaway pb-itest theme only — never touch the developer's real Site Editor overrides.
itest('detects a Site Editor header override and removes it only with confirm', async () => {
  const wp = testWp();
  await useItestTheme(wp);
  try {
  const theme = wp.check(['option', 'get', 'stylesheet']).trim();
  assert.equal(theme, 'pb-itest');
  for (const o of listOverrides(wp)) removeOverride(wp, o.slug, { confirm: true });
  const id = wp.check(['post', 'create', '--post_type=wp_template_part', '--post_status=publish', '--post_name=header', '--post_title=Header', '--post_content=<!-- wp:paragraph --><p>edited</p><!-- /wp:paragraph -->', '--porcelain']).trim();
  wp.check(['post', 'term', 'set', id, 'wp_theme', theme]);

  const found = listOverrides(wp);
  assert.deepEqual(found.map((o) => o.slug), ['header']);
  assert.throws(() => removeOverride(wp, 'header', {}), (e) => e.code === 'ECONFIRM');
  assert.equal(listOverrides(wp).length, 1, 'still there without confirm');
  assert.deepEqual(removeOverride(wp, 'header', { confirm: true }).removed, [Number(id)]);
  assert.equal(listOverrides(wp).length, 0);
  } finally { restoreTheme(wp); }
});
```

Run: `npm run test:integration` → Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add skills/protoblocks-site-builder/scripts/lib/blocks.mjs skills/protoblocks-site-builder/scripts/lib/parts.mjs skills/protoblocks-site-builder/scripts/wp/parts.php tests/unit/blocks.test.mjs tests/unit/parts.test.mjs tests/integration/parts.test.mjs
git commit -m "feat(setup): template part writing and Site Editor override detection"
```

---

### Task 9: One-shot setup CLI + `protoblocks-site-setup` skill

**Files:**
- Create: `skills/protoblocks-site-builder/scripts/lib/setup-site.mjs`
- Create: `skills/protoblocks-site-setup/SKILL.md`
- Create: `skills/protoblocks-site-setup/references/tokens.md`
- Create: `skills/protoblocks-site-setup/references/navigation.md`
- Modify: `skills/protoblocks-site-builder/SKILL.md` (add a "Site setup" pointer section)

**Interfaces:**
- Consumes: `runPreflight` (Stage 1), `createWp` (Task 1), `ensurePlugins` (Task 3), `fetchThemeZip`, `forkTheme`, `slugify` (Task 4), `installThemeAssets` (Task 5), `initState`, `updateState`, `setPath`, `statePath` (Stage 1).
- Produces:
  - `setupSite({ cwd, site, name, slug, force }) => Promise<{ preflight, plugins, theme: {themeDir, slug, reused, forkedFrom}, assets, stateFile }>` — runs preflight (stops with `Error` code `EPREFLIGHT` listing failing checks), plugins, fork, assets; then `initState` (if no state) with `{ url, path: publicPath, localSiteId?, wp: { mode, wrapper? }, theme: { slug, forkedFrom } }`, or updates `site.theme` when state exists.
  - CLI: `node setup-site.mjs --name "<Project>" [--slug s] [--site "<Local site>"] [--force] [--cwd D]` → prints the result JSON (exit 1 on error, message on stderr).

- [ ] **Step 1: Implement** `setup-site.mjs`

```js
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runPreflight } from './preflight.mjs';
import { createWp } from './wp.mjs';
import { ensurePlugins } from './setup-plugins.mjs';
import { fetchThemeZip, forkTheme } from './theme-fork.mjs';
import { installThemeAssets } from './theme-assets.mjs';
import { initState, updateState, setPath, statePath } from './state.mjs';

export async function setupSite({ cwd = process.cwd(), site, name, slug, force = false }) {
  const preflight = runPreflight({ cwd, site });
  const fatal = preflight.checks.filter((c) => c.status === 'fail');
  if (fatal.length) {
    const e = new Error(`Preflight failed:\n${fatal.map((c) => `- ${c.id}: ${c.detail}${c.fix ? ` → ${c.fix}` : ''}`).join('\n')}`);
    e.code = 'EPREFLIGHT';
    throw e;
  }
  const wp = createWp(preflight);
  const plugins = await ensurePlugins(wp);
  const { zipFile, forkedFrom } = await fetchThemeZip();
  const theme = forkTheme({ wp, themesDir: path.join(preflight.publicPath, 'wp-content', 'themes'), name, slug, force, zipFile, forkedFrom });
  const assets = installThemeAssets(theme.themeDir);

  const siteState = {
    url: preflight.url,
    path: preflight.publicPath,
    wp: preflight.mode === 'local-wrapper' ? { mode: 'local-wrapper', wrapper: preflight.wp } : { mode: 'native' },
    theme: { slug: theme.slug, forkedFrom: theme.forkedFrom },
    ...(preflight.localSite ? { localSiteId: preflight.localSite.id } : {}),
  };
  if (fs.existsSync(statePath(theme.themeDir))) {
    updateState(theme.themeDir, (s) => { setPath(s, 'site.theme', siteState.theme); setPath(s, 'site.url', siteState.url); });
  } else {
    initState(theme.themeDir, siteState);
  }
  return { preflight: { mode: preflight.mode, url: preflight.url, checks: preflight.checks }, plugins, theme, assets, stateFile: statePath(theme.themeDir) };
}

async function main(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--force') a.force = true;
    else if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[++i];
  }
  if (!a.name) { process.stderr.write('Usage: node setup-site.mjs --name "<Project>" [--slug s] [--site "<Local site>"] [--force] [--cwd D]\n'); process.exit(64); }
  const r = await setupSite({ cwd: a.cwd ?? process.cwd(), site: a.site, name: a.name, slug: a.slug, force: !!a.force });
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); });
}
```

- [ ] **Step 2: Smoke-test against the Local test site**

Run (from the repo root):
```bash
ORIG=$(tests/.tmp/wp-test-site option get stylesheet)
node skills/protoblocks-site-builder/scripts/lib/setup-site.mjs --name "PB Smoke" --slug pb-smoke --site "Proto Blocks"
node skills/protoblocks-site-builder/scripts/lib/setup-site.mjs --name "PB Smoke" --slug pb-smoke --site "Proto Blocks"
tests/.tmp/wp-test-site theme activate "$ORIG"
rm -rf "$(tests/.tmp/wp-test-site eval 'echo get_theme_root();')/pb-smoke"
```
(`tests/.tmp/wp-test-site` is written by the integration helpers; if it's missing, run `npm run test:integration` once.)
Expected: the first run prints JSON with `theme.slug: "pb-smoke"`, a `stateFile` path, and all four plugins `ok` or `installed`. The second run prints `theme.reused: true`. Afterwards the developer's original theme must be active again (`option get stylesheet` = `$ORIG`) and the `pb-smoke` folder removed. Include all of that output in the report.

- [ ] **Step 3: Write `skills/protoblocks-site-setup/SKILL.md`**

Frontmatter:
```markdown
---
name: protoblocks-site-setup
description: Use when preparing a local WordPress site for a Proto-Blocks build - installing Proto-Blocks/Yoast, forking and activating proto-blocks-theme, applying design tokens to Tailwind and theme.json, creating block-theme navigation menus, or wiring header/footer template parts. Normally invoked by protoblocks-site-builder.
---
```
Body (concise, imperative; ≤ ~6 KB):
1. **Scripts** — `PB="${CLAUDE_SKILL_DIR}/../protoblocks-site-builder/scripts"`.
2. **Order** — preflight → `setup-site.mjs` (plugins, fork, assets, state) → tokens → navigation → header/footer (built through the section loop in later stages; this skill only writes the parts).
3. **Step: one-shot setup** — command; how to name the project (ask for the client/project name if unknown; slug derived); `EFORKEXISTS` → ask the developer before `--force`; result → `THEME=<theme.themeDir>` for all later commands.
4. **Step: tokens** — "Read `references/tokens.md`, extract tokens from the design, write `tokens.json` into `$THEME/.protoblocks/`, run `node "$PB/lib/tokens.mjs" apply "$THEME" "$THEME/.protoblocks/tokens.json"`." Validation errors → fix the JSON, never hand-edit `tailwind-theme.css`.
5. **Step: navigation** — read `references/navigation.md`; one spec per menu (`primary`, `footer-<n>`); `node "$PB/lib/navigation.mjs" upsert "$THEME" primary spec.json`; pending links are normal; after creating pages run `refresh`.
6. **Step: header/footer parts** — overrides check first (`parts.mjs overrides "$THEME"`); non-empty → ask the developer, only then `remove-override … --confirm`; write markup with `parts.mjs write` (markup = `partMarkup` shape: proto-block wrapping `core/navigation {"ref":<menu id>}`); never use `register_nav_menus` or classic menus.
7. **Iron rules** — never `--force` or `--confirm` without the developer's explicit OK; never edit vendored theme `scripts/`; managed files (`inc/pb-*.php`, `assets/js/pb-*.js`, the functions.php managed block) are overwritten by `theme-assets.mjs install`.

- [ ] **Step 4: Write `references/tokens.md`**

Content: the tokens JSON shape (copy from Task 6 Interfaces) with a field table; extraction procedure — Figma: `get_variable_defs` first, then styles from `get_design_context`; Penpot: library colors/typographies via `execute_code`; image-only: sample dominant colors from the frames (background, text, primary CTA, accents), estimate type scale from measured cap heights at the design width, round to the nearest 2px; naming rules (semantic names: `ink`, `paper`, `accent`, `muted`, `surface`; type keys `display`, `h1`–`h4`, `body-lg`, `body-md`, `body-sm`, `eyebrow`); Google Fonts rule (only fonts available on Google Fonts get `google`; otherwise list in the report as "supply font files"); what `apply` writes and how utilities are named (`bg-accent`, `text-h1`, `font-display`, `rounded-card`, `shadow-soft`, `p-section`).

- [ ] **Step 5: Write `references/navigation.md`**

Content: menu spec format (copy from Task 7 Interfaces) with examples for a primary menu with a dropdown and a footer column; keys (`primary`, `footer-1`…, `utility`); how pending links work and when to run `refresh`; how menus surface in the Site Editor (Appearance → Editor → Navigation); header/footer part markup produced by `partMarkup` with an example; why not classic menus (block themes ignore `register_nav_menus` locations); override handling flow.

- [ ] **Step 6: Add a pointer to `skills/protoblocks-site-builder/SKILL.md`**

After the build-state section add: "**Site setup** — after preflight, run the `protoblocks-site-setup` skill (one-shot `setup-site.mjs`, then tokens, navigation, header/footer parts). It creates the theme fork and initializes the build state."

- [ ] **Step 7: Verify**

Run: `npm test && npm run test:integration` → Expected: all PASS.
Run: `head -4 skills/protoblocks-site-setup/SKILL.md` → frontmatter present.

- [ ] **Step 8: Commit**

```bash
git add skills/protoblocks-site-builder/scripts/lib/setup-site.mjs skills/protoblocks-site-setup skills/protoblocks-site-builder/SKILL.md
git commit -m "feat(setup): one-shot setup CLI and protoblocks-site-setup skill"
```

---

## Self-review notes

- Spec §4 steps 1–6 → Tasks 3, 4, 5, 6, 7, 8 (+ Task 9 orchestration). Header/footer *blocks* (`site-header`/`site-footer`) are built through the section loop in Stage 4; this stage provides navigation + part writing + override handling.
- §10 destructive actions: fork overwrite (`--force`, Task 4), part override removal (`--confirm`, Task 8).
- §11 integration harness: Task 1.
- Names consistent: `createWp`, `loadRuntime`, `WP_SCRIPTS_DIR`, `fetchLatestRelease`, `pickRelease`, `fetchThemeZip`, `forkTheme`, `installThemeAssets`, `applyTokens`, `upsertMenu`, `refreshMenus`, `partMarkup`, `writePart`, `listOverrides`, `removeOverride`, `setupSite`.
