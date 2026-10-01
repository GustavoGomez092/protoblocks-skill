# Stage 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the foundation of the site builder: shared scripts package, the resumable state file library + CLI, Local-site detection + WP-CLI wrapper, preflight checks, the orchestrator skill skeleton, and a refreshed `protoblocks` docs hub.

**Architecture:** All bundled tools live in `skills/protoblocks-site-builder/scripts/` as dependency-free Node ESM modules (`lib/`) that double as CLIs. Unit tests live in `tests/unit/` and run with `node --test`. Docs are Markdown skills.

**Tech Stack:** Node ≥ 18 (ESM, `node:test`, `node:assert/strict`, no npm dependencies in this stage), Bash for nothing new, Markdown skills.

**Spec:** `docs/superpowers/specs/2026-10-01-site-builder-design.md` (§2.1, §2.3, §3, §9, §10, §11, §12 stage 1)

## Global Constraints

- Local sites only; typical host Local by Flywheel on macOS.
- Proto-Blocks plugin minimum version: `2.10.1`.
- Node minimum: 18. Scripts in `lib/` use only Node built-ins.
- State file: `wp-content/themes/<theme-fork>/.protoblocks/build.json`; artifacts in `.protoblocks/artifacts/` (gitignored); backup `build.json.bak` written before every save.
- Site-level runtime files (WP-CLI wrapper, preflight report): `<wp-content>/.protoblocks/` (spec §3 says "cached in site state"; the theme fork may not exist at preflight time, so the site-level folder holds them and `state.site` copies the values once the fork exists).
- QA defaults: `mismatchMax 0.08`, `heightDeltaMax 0.03`, `maxIterations 5`.
- Every CLI prints machine-readable JSON on stdout; human errors on stderr; non-zero exit on failure.
- Never mutate the developer's existing Local sites in tests. Read-only commands only (`option get`, `plugin list`).
- Deviation from spec, recorded: `scripts/lib/local-site.sh` is implemented as `scripts/lib/local-site.mjs` (JSON parsing of `sites.json` needs a real parser; Node is already a hard requirement).

## Review Focus

1. **Paths with spaces** (`~/Local Sites/…`, `~/Library/Application Support/…`) — the generated `wp` wrapper must quote every path; test in Task 3.
2. **Site halted in Local** — detection must return a clear "start the site in Local" error, not hang or fall through to a MySQL connection timeout; test in Task 3 and Task 4.
3. **Crash mid-write of the state file** — saves are atomic (tmp + rename) with `.bak`; a corrupt `build.json` is reported with a restore hint and `restore` recovers the backup; tests in Task 2.
4. **CWD deep inside a site or reached via a symlink** — site matching uses `realpath` prefix matching on the site root; test in Task 3.
5. **CWD in no site and no `--site` given** — detection errors with the list of available site names so the agent can ask; test in Task 3.

---

## File Structure

```
skills/protoblocks-site-builder/
├── SKILL.md                              orchestrator skeleton (preflight + state usage)
├── references/
│   ├── state-schema.md                   human-readable schema + CLI usage
│   └── local-sites.md                    how Local detection + wrapper work, troubleshooting
└── scripts/
    ├── package.json                      {"type":"module"}; no deps yet
    └── lib/
        ├── state.mjs                     schema, validate, load/save/restore/init, get/set/append, CLI
        ├── local-site.mjs                Local sites.json parsing, php/phar/socket resolution, wrapper, CLI
        ├── exec.mjs                      spawnSync wrapper returning {code, stdout, stderr}
        └── preflight.mjs                 runs checks, writes preflight.json, CLI
tests/unit/
├── state.test.mjs
├── local-site.test.mjs
└── preflight.test.mjs
package.json                              repo root: "test": "node --test tests/unit/"
skills/protoblocks/                       docs hub refresh (Task 6)
```

---

### Task 1: Scripts package + test harness

**Files:**
- Create: `package.json` (repo root)
- Create: `skills/protoblocks-site-builder/scripts/package.json`
- Create: `skills/protoblocks-site-builder/scripts/lib/exec.mjs`
- Create: `tests/unit/exec.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `exec(cmd: string, args: string[], opts?: {cwd?: string, env?: object, input?: string, timeout?: number}) => {code: number, stdout: string, stderr: string}` — never throws; spawn errors (ENOENT) return `code: 127` and the error message in `stderr`.

- [ ] **Step 1: Write root `package.json`**

```json
{
  "name": "protoblocks-skill-dev",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/unit/"
  },
  "engines": { "node": ">=18" }
}
```

- [ ] **Step 2: Write scripts `package.json`**

`skills/protoblocks-site-builder/scripts/package.json`:
```json
{
  "name": "protoblocks-site-builder-scripts",
  "private": true,
  "type": "module",
  "engines": { "node": ">=18" }
}
```

- [ ] **Step 3: Append to `.gitignore`**

```
tests/.site/
tests/.tmp/
skills/protoblocks-site-builder/scripts/node_modules/
```

- [ ] **Step 4: Write the failing test** `tests/unit/exec.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exec } from '../../skills/protoblocks-site-builder/scripts/lib/exec.mjs';

test('exec captures stdout and exit code', () => {
  const r = exec(process.execPath, ['-e', 'process.stdout.write("hi"); process.exit(3)']);
  assert.equal(r.code, 3);
  assert.equal(r.stdout, 'hi');
});

test('exec returns 127 for a missing binary instead of throwing', () => {
  const r = exec('definitely-not-a-binary-xyz', []);
  assert.equal(r.code, 127);
  assert.match(r.stderr, /ENOENT|not found/i);
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `exec.mjs`.

- [ ] **Step 6: Implement** `skills/protoblocks-site-builder/scripts/lib/exec.mjs`

```js
import { spawnSync } from 'node:child_process';

/**
 * Run a command synchronously. Never throws.
 * @returns {{code:number, stdout:string, stderr:string}}
 */
export function exec(cmd, args = [], opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    input: opts.input,
    timeout: opts.timeout ?? 120000,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) {
    return { code: r.error.code === 'ENOENT' ? 127 : 1, stdout: '', stderr: String(r.error.message) };
  }
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
```

- [ ] **Step 7: Run tests**

Run: `npm test`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add package.json .gitignore skills/protoblocks-site-builder/scripts tests/unit/exec.test.mjs
git commit -m "chore: scripts package, exec helper and unit test harness"
```

---

### Task 2: State library + CLI

**Files:**
- Create: `skills/protoblocks-site-builder/scripts/lib/state.mjs`
- Create: `tests/unit/state.test.mjs`

**Interfaces:**
- Produces (all exported from `state.mjs`):
  - `SCHEMA_VERSION = 1`
  - `DEFAULT_QA = { mismatchMax: 0.08, heightDeltaMax: 0.03, maxIterations: 5 }`
  - `SECTION_STATUS = ['planned','building','verifying','animating','done','skipped']`
  - `PAGE_STATUS = ['planning','building','seo','done']`
  - `class StateError extends Error { code: 'ENOSTATE'|'EPARSE'|'EINVALID'|'EEXISTS'|'ENOBACKUP' }`
  - `statePath(themeDir) => string` (`<themeDir>/.protoblocks/build.json`)
  - `validate(value) => string[]` (empty = valid)
  - `initState(themeDir, site: object) => state` (throws `EEXISTS` if present; writes `.protoblocks/.gitignore` containing `artifacts/` and `build.json.bak`)
  - `loadState(themeDir) => state`
  - `saveState(themeDir, state) => void` (validate → copy existing to `.bak` → write tmp → rename)
  - `restoreState(themeDir) => state` (validates `.bak`, copies over `build.json`)
  - `updateState(themeDir, fn: (state) => state|void) => state`
  - `getPath(obj, dotted: string) => any` (segments split on `.`; numeric segments index arrays)
  - `setPath(obj, dotted, value) => obj` (creates intermediate objects)
  - `appendPath(obj, dotted, value) => obj` (target must be an array or missing → created)
- CLI: `node state.mjs <init|get|set|append|validate|restore> <themeDir> [path] [json]`

- [ ] **Step 1: Write the failing tests** `tests/unit/state.test.mjs`

```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  initState, loadState, saveState, restoreState, updateState, validate,
  getPath, setPath, appendPath, statePath, StateError, DEFAULT_QA,
} from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';

const CLI = new URL('../../skills/protoblocks-site-builder/scripts/lib/state.mjs', import.meta.url).pathname;
let theme;
const site = { url: 'http://acme.local', path: '/x/app/public', wp: { mode: 'local-wrapper', wrapper: '/x/wp' } };

beforeEach(() => { theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-state-')); });

test('initState writes a valid state with QA defaults and a gitignore', () => {
  const s = initState(theme, site);
  assert.deepEqual(s.site.qa, DEFAULT_QA);
  assert.deepEqual(s.pages, []);
  assert.deepEqual(validate(loadState(theme)), []);
  const gi = fs.readFileSync(path.join(theme, '.protoblocks/.gitignore'), 'utf8');
  assert.match(gi, /artifacts\//);
});

test('initState refuses to overwrite', () => {
  initState(theme, site);
  assert.throws(() => initState(theme, site), (e) => e instanceof StateError && e.code === 'EEXISTS');
});

test('validate reports enum and required errors with paths', () => {
  const s = initState(theme, site);
  s.pages.push({ slug: 'home', status: 'building', sections: [{ n: 1, anchor: 'pb-s1', status: 'finished' }] });
  delete s.site.url;
  const errors = validate(s);
  assert.ok(errors.some((e) => e.startsWith('$.site.url: required')), errors.join('\n'));
  assert.ok(errors.some((e) => e.startsWith('$.pages[0].sections[0].status: must be one of')), errors.join('\n'));
});

test('saveState refuses invalid state and leaves file untouched', () => {
  initState(theme, site);
  const before = fs.readFileSync(statePath(theme), 'utf8');
  assert.throws(() => saveState(theme, { schemaVersion: 1 }), (e) => e.code === 'EINVALID');
  assert.equal(fs.readFileSync(statePath(theme), 'utf8'), before);
});

test('saveState keeps a .bak of the previous version', () => {
  initState(theme, site);
  updateState(theme, (s) => { s.site.url = 'http://changed.local'; });
  const bak = JSON.parse(fs.readFileSync(statePath(theme) + '.bak', 'utf8'));
  assert.equal(bak.site.url, 'http://acme.local');
  assert.equal(loadState(theme).site.url, 'http://changed.local');
});

test('corrupt state reports EPARSE with a restore hint and restore recovers', () => {
  initState(theme, site);
  updateState(theme, (s) => { s.site.url = 'http://v2.local'; });
  fs.writeFileSync(statePath(theme), '{"schemaVersion": 1, "site": {'); // simulated crash
  assert.throws(() => loadState(theme), (e) => e.code === 'EPARSE' && /restore/.test(e.message));
  const restored = restoreState(theme);
  assert.equal(restored.site.url, 'http://acme.local');
  assert.equal(loadState(theme).site.url, 'http://acme.local');
});

test('loadState on missing file throws ENOSTATE', () => {
  assert.throws(() => loadState(theme), (e) => e.code === 'ENOSTATE');
});

test('getPath/setPath/appendPath handle objects and arrays', () => {
  const o = { pages: [{ sections: [{ status: 'planned' }] }] };
  assert.equal(getPath(o, 'pages.0.sections.0.status'), 'planned');
  setPath(o, 'pages.0.sections.0.status', 'done');
  assert.equal(o.pages[0].sections[0].status, 'done');
  setPath(o, 'library.media-text.purpose', 'two-column');
  assert.equal(o.library['media-text'].purpose, 'two-column');
  appendPath(o, 'pages.0.sections.0.qa', { iteration: 1 });
  assert.deepEqual(o.pages[0].sections[0].qa, [{ iteration: 1 }]);
  assert.equal(getPath(o, 'nope.deeper'), undefined);
});

test('CLI init/set/append/get round-trip', () => {
  const siteFile = path.join(theme, 'site.json');
  fs.writeFileSync(siteFile, JSON.stringify(site));
  execFileSync(process.execPath, [CLI, 'init', theme, siteFile]);
  execFileSync(process.execPath, [CLI, 'append', theme, 'pages', JSON.stringify({ slug: 'home', status: 'planning', sections: [] })]);
  execFileSync(process.execPath, [CLI, 'set', theme, 'pages.0.status', '"building"']);
  const out = execFileSync(process.execPath, [CLI, 'get', theme, 'pages.0.status'], { encoding: 'utf8' });
  assert.equal(JSON.parse(out), 'building');
});

test('CLI set with an invalid value exits non-zero and explains why', () => {
  const siteFile = path.join(theme, 'site.json');
  fs.writeFileSync(siteFile, JSON.stringify(site));
  execFileSync(process.execPath, [CLI, 'init', theme, siteFile]);
  const r = spawnSync(process.execPath, [CLI, 'set', theme, 'site.wp.mode', '"docker"'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /\$\.site\.wp\.mode: must be one of/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — cannot find module `state.mjs`.

- [ ] **Step 3: Implement** `skills/protoblocks-site-builder/scripts/lib/state.mjs`

```js
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const SCHEMA_VERSION = 1;
export const DEFAULT_QA = Object.freeze({ mismatchMax: 0.08, heightDeltaMax: 0.03, maxIterations: 5 });
export const SECTION_STATUS = ['planned', 'building', 'verifying', 'animating', 'done', 'skipped'];
export const PAGE_STATUS = ['planning', 'building', 'seo', 'done'];
const DECISIONS = ['new', 'reuse', 'extend'];

export class StateError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

const str = { type: 'string' };
const obj = { type: 'object' };
const arr = { type: 'array' };

export const schema = {
  type: 'object',
  required: ['schemaVersion', 'site', 'library', 'pages'],
  properties: {
    schemaVersion: { type: 'integer', enum: [SCHEMA_VERSION] },
    site: {
      type: 'object',
      required: ['url', 'path'],
      properties: {
        localSiteId: str, path: str, url: str,
        wp: { type: 'object', required: ['mode'], properties: { mode: { type: 'string', enum: ['local-wrapper', 'native'] }, wrapper: str } },
        theme: { type: 'object', properties: { slug: str, forkedFrom: str } },
        tokens: obj, motionProfile: obj, navigation: obj, parts: obj,
        qa: { type: 'object', properties: { mismatchMax: { type: 'number' }, heightDeltaMax: { type: 'number' }, maxIterations: { type: 'integer' } } },
      },
    },
    library: {
      type: 'object',
      additionalProperties: { type: 'object', properties: { purpose: str, usedOn: { type: 'array', items: str }, variants: { type: 'array', items: str } } },
    },
    pages: {
      type: 'array',
      items: {
        type: 'object',
        required: ['slug', 'status', 'sections'],
        properties: {
          slug: str, title: str,
          postId: { type: ['integer', 'null'] },
          status: { type: 'string', enum: PAGE_STATUS },
          contentHash: { type: ['string', 'null'] },
          design: obj, seo: obj,
          sections: {
            type: 'array',
            items: {
              type: 'object',
              required: ['n', 'anchor', 'status'],
              properties: {
                n: { type: 'integer' }, anchor: str, label: str, block: str,
                decision: { type: 'string', enum: DECISIONS },
                attrs: obj, inner: arr, crops: obj, qa: arr, motion: obj,
                status: { type: 'string', enum: SECTION_STATUS },
              },
            },
          },
        },
      },
    },
  },
};

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function matchesType(v, t) {
  const actual = typeOf(v);
  return [].concat(t).some((x) => x === actual || (x === 'number' && actual === 'integer'));
}

function check(value, s, at, errors) {
  if (s.type && !matchesType(value, s.type)) {
    errors.push(`${at}: expected ${[].concat(s.type).join('|')}, got ${typeOf(value)}`);
    return;
  }
  if (s.enum && !s.enum.includes(value)) {
    errors.push(`${at}: must be one of ${s.enum.join(', ')} (got ${JSON.stringify(value)})`);
  }
  if (typeOf(value) === 'object') {
    for (const k of s.required ?? []) if (!(k in value)) errors.push(`${at}.${k}: required`);
    for (const [k, v] of Object.entries(value)) {
      const sub = s.properties?.[k] ?? s.additionalProperties;
      if (sub && typeof sub === 'object') check(v, sub, `${at}.${k}`, errors);
    }
  }
  if (typeOf(value) === 'array' && s.items) value.forEach((v, i) => check(v, s.items, `${at}[${i}]`, errors));
}

export function validate(value) {
  const errors = [];
  check(value, schema, '$', errors);
  return errors;
}

export const stateDir = (themeDir) => path.join(themeDir, '.protoblocks');
export const statePath = (themeDir) => path.join(stateDir(themeDir), 'build.json');

function assertValid(state) {
  const errors = validate(state);
  if (errors.length) throw new StateError(`State invalid:\n- ${errors.join('\n- ')}`, 'EINVALID');
}

function parseFile(file, hint) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new StateError(`State file ${file} is not valid JSON (${e.message}). ${hint}`, 'EPARSE');
  }
}

export function loadState(themeDir) {
  const file = statePath(themeDir);
  if (!fs.existsSync(file)) throw new StateError(`No state file at ${file}. Run: node state.mjs init <themeDir> <site.json>`, 'ENOSTATE');
  const data = parseFile(file, `Recover the last good copy with: node state.mjs restore ${themeDir}`);
  assertValid(data);
  return data;
}

export function saveState(themeDir, state) {
  assertValid(state);
  const file = statePath(themeDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export function restoreState(themeDir) {
  const file = statePath(themeDir);
  const bak = `${file}.bak`;
  if (!fs.existsSync(bak)) throw new StateError(`No backup at ${bak}`, 'ENOBACKUP');
  const data = parseFile(bak, 'The backup is also corrupt; inspect it by hand.');
  assertValid(data);
  fs.copyFileSync(bak, file);
  return data;
}

export function initState(themeDir, site) {
  if (fs.existsSync(statePath(themeDir))) throw new StateError(`State already exists at ${statePath(themeDir)}`, 'EEXISTS');
  const state = { schemaVersion: SCHEMA_VERSION, site: { ...site, qa: { ...DEFAULT_QA, ...(site.qa ?? {}) } }, library: {}, pages: [] };
  saveState(themeDir, state);
  fs.writeFileSync(path.join(stateDir(themeDir), '.gitignore'), 'artifacts/\nbuild.json.bak\nbuild.json.tmp-*\n');
  return state;
}

export function updateState(themeDir, fn) {
  const state = loadState(themeDir);
  const next = fn(state) ?? state;
  saveState(themeDir, next);
  return next;
}

const segs = (dotted) => (dotted === '' ? [] : dotted.split('.'));
const key = (container, s) => (Array.isArray(container) && /^\d+$/.test(s) ? Number(s) : s);

export function getPath(o, dotted) {
  let cur = o;
  for (const s of segs(dotted)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = cur[key(cur, s)];
  }
  return cur;
}

export function setPath(o, dotted, value) {
  const parts = segs(dotted);
  if (!parts.length) throw new StateError('setPath needs a non-empty path', 'EINVALID');
  let cur = o;
  for (const s of parts.slice(0, -1)) {
    const k = key(cur, s);
    if (cur[k] === undefined || cur[k] === null) cur[k] = {};
    cur = cur[k];
  }
  cur[key(cur, parts.at(-1))] = value;
  return o;
}

export function appendPath(o, dotted, value) {
  const existing = getPath(o, dotted);
  if (existing === undefined) return setPath(o, dotted, [value]);
  if (!Array.isArray(existing)) throw new StateError(`${dotted} is not an array`, 'EINVALID');
  existing.push(value);
  return o;
}

function main(argv) {
  const [cmd, themeDir, p, json] = argv;
  const out = (v) => process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
  if (!cmd || !themeDir) {
    process.stderr.write('Usage: node state.mjs <init|get|set|append|validate|restore> <themeDir> [path] [json]\n');
    process.exit(64);
  }
  switch (cmd) {
    case 'init': return out(initState(themeDir, JSON.parse(fs.readFileSync(p, 'utf8'))));
    case 'get': return out(getPath(loadState(themeDir), p ?? ''));
    case 'set': return out(getPath(updateState(themeDir, (s) => { setPath(s, p, JSON.parse(json)); }), p));
    case 'append': return out(getPath(updateState(themeDir, (s) => { appendPath(s, p, JSON.parse(json)); }), p));
    case 'validate': loadState(themeDir); return out({ valid: true });
    case 'restore': return out(restoreState(themeDir));
    default:
      process.stderr.write(`Unknown command: ${cmd}\n`);
      process.exit(64);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) {
    process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS (all state + exec tests).

- [ ] **Step 5: Commit**

```bash
git add skills/protoblocks-site-builder/scripts/lib/state.mjs tests/unit/state.test.mjs
git commit -m "feat(state): resumable build state library and CLI"
```

---

### Task 3: Local site detection + WP-CLI wrapper

**Files:**
- Create: `skills/protoblocks-site-builder/scripts/lib/local-site.mjs`
- Create: `tests/unit/local-site.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (exported):
  - `localPaths(env = process.env) => { appSupport: string, resources: string }` — overridable via `PB_LOCAL_APP_SUPPORT`, `PB_LOCAL_RESOURCES`; defaults `~/Library/Application Support/Local` and `/Applications/Local.app/Contents/Resources/extraResources`.
  - `readSites(appSupport, home) => Site[]` where `Site = { id, name, domain, rootPath, publicPath, phpVersion, running: boolean }` (`running` from `site-statuses.json`).
  - `findSiteForDir(sites, dir) => Site|null` (realpath prefix match on `rootPath`).
  - `findSiteByQuery(sites, q) => Site|null` (exact id, case-insensitive name, or domain).
  - `platformKey(platform = process.platform, arch = process.arch) => 'darwin-arm64'|'darwin'|'linux'`
  - `phpBinary(appSupport, version, platform?) => string|null`
  - `socketPath(appSupport, id) => string`
  - `wpCliPhar(resources) => string`
  - `resolveLocalSite({ cwd, query, env }) => { ok: true, site: ResolvedSite } | { ok: false, error: string, sites?: string[] }` where `ResolvedSite = Site & { phpBin, socket, phar }`.
  - `wrapperScript({ phpBin, socket, phar, publicPath }) => string`
  - `writeWrapper(file, resolvedSite) => string` (path written, mode 0755)
- CLI: `node local-site.mjs detect [--cwd D] [--site Q]` → prints `{ok, site|error, sites}`; `node local-site.mjs wrapper --out FILE [--cwd D] [--site Q]` → writes wrapper, prints `{ok, wrapper}`.

- [ ] **Step 1: Write the failing tests** `tests/unit/local-site.test.mjs`

```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readSites, findSiteForDir, findSiteByQuery, phpBinary, resolveLocalSite, wrapperScript, writeWrapper, platformKey,
} from '../../skills/protoblocks-site-builder/scripts/lib/local-site.mjs';

let home, appSupport, resources, env;

function touch(p) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, ''); }

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-home-'));
  appSupport = path.join(home, 'Library/Application Support/Local');
  resources = path.join(home, 'Local.app/extraResources');
  env = { HOME: home, PB_LOCAL_APP_SUPPORT: appSupport, PB_LOCAL_RESOURCES: resources };
  fs.mkdirSync(appSupport, { recursive: true });
  fs.writeFileSync(path.join(appSupport, 'sites.json'), JSON.stringify({
    aaa111: { id: 'aaa111', name: 'Acme Co', domain: 'acme.local', path: '~/Local Sites/acme', services: { php: { version: '8.4.10' } } },
    bbb222: { id: 'bbb222', name: 'Halted', domain: 'halted.local', path: '~/Local Sites/halted', services: { php: { version: '8.2.27' } } },
  }));
  fs.writeFileSync(path.join(appSupport, 'site-statuses.json'), JSON.stringify({ aaa111: 'running', bbb222: 'halted' }));
  touch(path.join(appSupport, `lightning-services/php-8.4.10+0/bin/${platformKey()}/bin/php`));
  touch(path.join(appSupport, `lightning-services/php-8.2.27+1/bin/${platformKey()}/bin/php`));
  touch(path.join(appSupport, 'run/aaa111/mysql/mysqld.sock'));
  touch(path.join(resources, 'bin/wp-cli/wp-cli.phar'));
  fs.mkdirSync(path.join(home, 'Local Sites/acme/app/public/wp-content/themes/x'), { recursive: true });
  fs.mkdirSync(path.join(home, 'Local Sites/halted/app/public'), { recursive: true });
});

test('readSites expands ~ and reads running status', () => {
  const sites = readSites(appSupport, home);
  const acme = sites.find((s) => s.id === 'aaa111');
  assert.equal(acme.rootPath, path.join(home, 'Local Sites/acme'));
  assert.equal(acme.publicPath, path.join(home, 'Local Sites/acme/app/public'));
  assert.equal(acme.running, true);
  assert.equal(sites.find((s) => s.id === 'bbb222').running, false);
});

test('findSiteForDir matches a deep subdirectory and a symlinked path', () => {
  const sites = readSites(appSupport, home);
  const deep = path.join(home, 'Local Sites/acme/app/public/wp-content/themes/x');
  assert.equal(findSiteForDir(sites, deep).id, 'aaa111');
  const link = path.join(home, 'acme-link');
  fs.symlinkSync(path.join(home, 'Local Sites/acme'), link);
  assert.equal(findSiteForDir(sites, path.join(link, 'app')).id, 'aaa111');
  assert.equal(findSiteForDir(sites, home), null);
});

test('findSiteByQuery matches id, name (case-insensitive) and domain', () => {
  const sites = readSites(appSupport, home);
  assert.equal(findSiteByQuery(sites, 'aaa111').id, 'aaa111');
  assert.equal(findSiteByQuery(sites, 'acme co').id, 'aaa111');
  assert.equal(findSiteByQuery(sites, 'acme.local').id, 'aaa111');
  assert.equal(findSiteByQuery(sites, 'nope'), null);
});

test('phpBinary picks the lightning-services build for the site version', () => {
  assert.equal(
    phpBinary(appSupport, '8.4.10'),
    path.join(appSupport, `lightning-services/php-8.4.10+0/bin/${platformKey()}/bin/php`),
  );
  assert.equal(phpBinary(appSupport, '7.4.1'), null);
});

test('resolveLocalSite resolves a running site from cwd', () => {
  const r = resolveLocalSite({ cwd: path.join(home, 'Local Sites/acme/app/public'), env });
  assert.equal(r.ok, true);
  assert.equal(r.site.socket, path.join(appSupport, 'run/aaa111/mysql/mysqld.sock'));
  assert.equal(r.site.phar, path.join(resources, 'bin/wp-cli/wp-cli.phar'));
});

test('resolveLocalSite on a halted site says to start it in Local', () => {
  const r = resolveLocalSite({ cwd: path.join(home, 'Local Sites/halted'), env });
  assert.equal(r.ok, false);
  assert.match(r.error, /Start the site "Halted" in Local/);
});

test('resolveLocalSite outside any site lists available site names', () => {
  const r = resolveLocalSite({ cwd: home, env });
  assert.equal(r.ok, false);
  assert.deepEqual(r.sites.sort(), ['Acme Co', 'Halted']);
  assert.match(r.error, /--site/);
});

test('resolveLocalSite with no Local install reports not-local', () => {
  const r = resolveLocalSite({ cwd: home, env: { ...env, PB_LOCAL_APP_SUPPORT: path.join(home, 'nope') } });
  assert.equal(r.ok, false);
  assert.equal(r.notLocal, true);
});

test('wrapperScript single-quotes every path (spaces safe)', () => {
  const s = wrapperScript({
    phpBin: "/a b/php", socket: "/c d/mysqld.sock", phar: "/e f/wp-cli.phar", publicPath: "/g h/it's/public",
  });
  assert.match(s, /^#!\/bin\/sh\n/);
  assert.ok(s.includes(`exec '/a b/php'`));
  assert.ok(s.includes(`-d 'mysqli.default_socket=/c d/mysqld.sock'`));
  assert.ok(s.includes(`'/e f/wp-cli.phar'`));
  assert.ok(s.includes(`'--path=/g h/it'\\''s/public'`));
  assert.ok(s.trimEnd().endsWith('"$@"'));
});

test('writeWrapper writes an executable file', () => {
  const r = resolveLocalSite({ cwd: path.join(home, 'Local Sites/acme'), env });
  const out = path.join(home, 'out/wp');
  writeWrapper(out, r.site);
  assert.ok(fs.statSync(out).mode & 0o100);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — cannot find module `local-site.mjs`.

- [ ] **Step 3: Implement** `skills/protoblocks-site-builder/scripts/lib/local-site.mjs`

```js
#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function localPaths(env = process.env) {
  const home = env.HOME ?? os.homedir();
  return {
    appSupport: env.PB_LOCAL_APP_SUPPORT ?? path.join(home, 'Library/Application Support/Local'),
    resources: env.PB_LOCAL_RESOURCES ?? '/Applications/Local.app/Contents/Resources/extraResources',
  };
}

const expandHome = (p, home) => (p.startsWith('~/') ? path.join(home, p.slice(2)) : p);
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

export function readSites(appSupport, home) {
  const sites = readJson(path.join(appSupport, 'sites.json'), null);
  if (!sites) return [];
  const statuses = readJson(path.join(appSupport, 'site-statuses.json'), {});
  return Object.values(sites).map((s) => {
    const rootPath = expandHome(s.path, home);
    return {
      id: s.id,
      name: s.name,
      domain: s.domain,
      rootPath,
      publicPath: path.join(rootPath, 'app/public'),
      phpVersion: s.services?.php?.version ?? null,
      running: statuses[s.id] === 'running',
    };
  });
}

export function findSiteForDir(sites, dir) {
  const d = real(dir);
  return sites.find((s) => {
    const root = real(s.rootPath);
    return d === root || d.startsWith(root + path.sep);
  }) ?? null;
}

export function findSiteByQuery(sites, q) {
  const lq = q.toLowerCase();
  return sites.find((s) => s.id === q || s.name?.toLowerCase() === lq || s.domain?.toLowerCase() === lq) ?? null;
}

export function platformKey(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin') return arch === 'arm64' ? 'darwin-arm64' : 'darwin';
  return 'linux';
}

export function phpBinary(appSupport, version, platform = platformKey()) {
  const dir = path.join(appSupport, 'lightning-services');
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { return null; }
  const matches = entries.filter((e) => e.startsWith(`php-${version}+`)).sort().reverse();
  for (const m of matches) {
    const bin = path.join(dir, m, 'bin', platform, 'bin', 'php');
    if (fs.existsSync(bin)) return bin;
  }
  return null;
}

export const socketPath = (appSupport, id) => path.join(appSupport, 'run', id, 'mysql', 'mysqld.sock');
export const wpCliPhar = (resources) => path.join(resources, 'bin', 'wp-cli', 'wp-cli.phar');

export function resolveLocalSite({ cwd = process.cwd(), query, env = process.env } = {}) {
  const { appSupport, resources } = localPaths(env);
  const home = env.HOME ?? os.homedir();
  if (!fs.existsSync(path.join(appSupport, 'sites.json'))) {
    return { ok: false, notLocal: true, error: `Local by Flywheel not found (${appSupport}/sites.json missing).` };
  }
  const sites = readSites(appSupport, home);
  const names = sites.map((s) => s.name);
  const site = query ? findSiteByQuery(sites, query) : findSiteForDir(sites, cwd);
  if (!site) {
    const why = query ? `No Local site matches "${query}".` : `The current directory is not inside a Local site.`;
    return { ok: false, sites: names, error: `${why} Re-run with --site "<name>". Available: ${names.join(', ')}` };
  }
  const socket = socketPath(appSupport, site.id);
  if (!site.running || !fs.existsSync(socket)) {
    return { ok: false, sites: names, error: `Start the site "${site.name}" in Local, then re-run.` };
  }
  const phpBin = phpBinary(appSupport, site.phpVersion);
  if (!phpBin) return { ok: false, error: `Local's PHP ${site.phpVersion} binary not found under ${appSupport}/lightning-services.` };
  const phar = wpCliPhar(resources);
  if (!fs.existsSync(phar)) return { ok: false, error: `Local's WP-CLI not found at ${phar}. Is Local installed in /Applications?` };
  return { ok: true, site: { ...site, phpBin, socket, phar } };
}

const q = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;

export function wrapperScript({ phpBin, socket, phar, publicPath }) {
  return [
    '#!/bin/sh',
    '# Generated by protoblocks-site-builder. Runs WP-CLI against a Local by Flywheel site.',
    `exec ${q(phpBin)} -d ${q(`mysqli.default_socket=${socket}`)} -d ${q(`pdo_mysql.default_socket=${socket}`)} -d memory_limit=512M ${q(phar)} ${q(`--path=${publicPath}`)} "$@"`,
    '',
  ].join('\n');
}

export function writeWrapper(file, site) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, wrapperScript(site), { mode: 0o755 });
  fs.chmodSync(file, 0o755);
  return file;
}

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[++i];
    else a._.push(argv[i]);
  }
  return a;
}

function main(argv) {
  const a = parseArgs(argv);
  const r = resolveLocalSite({ cwd: a.cwd ?? process.cwd(), query: a.site });
  if (a._[0] === 'wrapper') {
    if (!a.out) { process.stderr.write('wrapper requires --out FILE\n'); process.exit(64); }
    if (!r.ok) { process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); process.exit(2); }
    writeWrapper(a.out, r.site);
    process.stdout.write(`${JSON.stringify({ ok: true, wrapper: a.out, site: r.site }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  if (!r.ok) process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) main(process.argv.slice(2));
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Read-only smoke test against a real running Local site (if one exists)**

Run:
```bash
node skills/protoblocks-site-builder/scripts/lib/local-site.mjs detect --site "Proto Blocks"
node skills/protoblocks-site-builder/scripts/lib/local-site.mjs wrapper --site "Proto Blocks" --out tests/.tmp/wp
tests/.tmp/wp option get siteurl
```
Expected: JSON with `ok: true`; last command prints the site URL (e.g. `http://proto-blocks.local`). If no running Local site exists, record "skipped: no running Local site" in the task report. Do not run any write command.

- [ ] **Step 6: Commit**

```bash
git add skills/protoblocks-site-builder/scripts/lib/local-site.mjs tests/unit/local-site.test.mjs
git commit -m "feat(local): Local by Flywheel site detection and WP-CLI wrapper"
```

---

### Task 4: Preflight

**Files:**
- Create: `skills/protoblocks-site-builder/scripts/lib/preflight.mjs`
- Create: `tests/unit/preflight.test.mjs`

**Interfaces:**
- Consumes: `exec` (Task 1); `resolveLocalSite`, `writeWrapper` (Task 3).
- Produces:
  - `MIN_PROTO_BLOCKS = '2.10.1'`
  - `compareVersions(a, b) => -1|0|1`
  - `findWpRoot(dir) => string|null` (walks up to the dir containing `wp-config.php`)
  - `runPreflight({ cwd, site, path, env, exec, nodeVersion, qaDir }) => Report`
    `Report = { ok: boolean, mode: 'local-wrapper'|'native'|null, wp: string|null, url: string|null, publicPath: string|null, localSite: object|null, runtimeDir: string|null, checks: Check[] }`
    `Check = { id: string, status: 'pass'|'warn'|'fail', detail: string, fix?: string }`
    Check ids: `site`, `wp-cli`, `proto-blocks`, `yoast`, `permalinks`, `block-theme`, `node`, `playwright`.
    `ok` is false iff any check has `status: 'fail'`.
  - Side effect: when `wp` resolves, writes `<publicPath>/wp-content/.protoblocks/preflight.json` (and, in local mode, the wrapper at `<publicPath>/wp-content/.protoblocks/wp`).
- CLI: `node preflight.mjs [--cwd D] [--site Q] [--path P]` → prints the Report JSON; exit 0 if ok, 2 otherwise.

- [ ] **Step 1: Write the failing tests** `tests/unit/preflight.test.mjs`

```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPreflight, compareVersions, findWpRoot } from '../../skills/protoblocks-site-builder/scripts/lib/preflight.mjs';

let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-pre-'));
  fs.mkdirSync(path.join(root, 'public/wp-content'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public/wp-config.php'), '<?php');
});

// Fake `wp` responses keyed by the joined args (after the wp binary).
function fakeExec(responses, { wpOnPath = true } = {}) {
  return (cmd, args) => {
    if (cmd === 'wp' && !wpOnPath) return { code: 127, stdout: '', stderr: 'ENOENT' };
    const keyArgs = args.filter((a) => !a.startsWith('--path='));
    const k = keyArgs.join(' ');
    if (k in responses) return { code: 0, stdout: responses[k], stderr: '' };
    return { code: 1, stdout: '', stderr: `unexpected: ${k}` };
  };
}

const healthy = {
  'option get siteurl': 'http://acme.local\n',
  'plugin get proto-blocks --field=status': 'active\n',
  'plugin get proto-blocks --field=version': '2.10.1\n',
  'plugin get wordpress-seo --field=status': 'active\n',
  'option get permalink_structure': '/%postname%/\n',
  'eval echo wp_is_block_theme() ? "1" : "0";': '1',
};

const notLocalEnv = (r) => ({ HOME: r, PB_LOCAL_APP_SUPPORT: path.join(r, 'no-local') });

test('compareVersions', () => {
  assert.equal(compareVersions('2.10.1', '2.9.9'), 1);
  assert.equal(compareVersions('2.10.1', '2.10.1'), 0);
  assert.equal(compareVersions('2.4', '2.10.1'), -1);
});

test('findWpRoot walks up to wp-config.php', () => {
  const deep = path.join(root, 'public/wp-content/themes/x');
  fs.mkdirSync(deep, { recursive: true });
  assert.equal(findWpRoot(deep), path.join(root, 'public'));
  assert.equal(findWpRoot(os.tmpdir()), null);
});

test('healthy native site passes and writes preflight.json', () => {
  const r = runPreflight({
    cwd: path.join(root, 'public'), env: notLocalEnv(root), exec: fakeExec(healthy), nodeVersion: '20.1.0', qaDir: root,
  });
  assert.equal(r.mode, 'native');
  assert.equal(r.url, 'http://acme.local');
  assert.equal(r.ok, true, JSON.stringify(r.checks, null, 2));
  assert.equal(r.checks.find((c) => c.id === 'playwright').status, 'warn');
  const saved = JSON.parse(fs.readFileSync(path.join(root, 'public/wp-content/.protoblocks/preflight.json'), 'utf8'));
  assert.equal(saved.url, 'http://acme.local');
});

test('old Proto-Blocks is a warn with an update fix', () => {
  const r = runPreflight({
    cwd: path.join(root, 'public'), env: notLocalEnv(root), nodeVersion: '20.1.0', qaDir: root,
    exec: fakeExec({ ...healthy, 'plugin get proto-blocks --field=version': '2.4.0\n' }),
  });
  const c = r.checks.find((x) => x.id === 'proto-blocks');
  assert.equal(c.status, 'warn');
  assert.match(c.fix, /setup-site|update/i);
});

test('Node below 18 fails', () => {
  const r = runPreflight({ cwd: path.join(root, 'public'), env: notLocalEnv(root), exec: fakeExec(healthy), nodeVersion: '16.20.0', qaDir: root });
  assert.equal(r.ok, false);
  assert.equal(r.checks.find((c) => c.id === 'node').status, 'fail');
});

test('wp-cli failure fails with a fix and skips wp-dependent checks', () => {
  const r = runPreflight({
    cwd: path.join(root, 'public'), env: notLocalEnv(root), nodeVersion: '20.1.0', qaDir: root, exec: fakeExec({}, { wpOnPath: false }),
  });
  assert.equal(r.ok, false);
  const c = r.checks.find((x) => x.id === 'wp-cli');
  assert.equal(c.status, 'fail');
  assert.ok(c.fix);
  assert.equal(r.checks.find((x) => x.id === 'proto-blocks'), undefined);
});

test('no WordPress found anywhere fails the site check', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-empty-'));
  const r = runPreflight({ cwd: empty, env: notLocalEnv(empty), exec: fakeExec(healthy), nodeVersion: '20.1.0', qaDir: empty });
  assert.equal(r.ok, false);
  assert.equal(r.checks.find((c) => c.id === 'site').status, 'fail');
});

test('halted Local site fails with the start-in-Local message', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-home-'));
  const appSupport = path.join(home, 'Local');
  fs.mkdirSync(appSupport, { recursive: true });
  fs.writeFileSync(path.join(appSupport, 'sites.json'), JSON.stringify({ h1: { id: 'h1', name: 'Halted', domain: 'h.local', path: '~/sites/h', services: { php: { version: '8.4.10' } } } }));
  fs.writeFileSync(path.join(appSupport, 'site-statuses.json'), JSON.stringify({ h1: 'halted' }));
  fs.mkdirSync(path.join(home, 'sites/h/app/public'), { recursive: true });
  const r = runPreflight({
    cwd: path.join(home, 'sites/h/app/public'), env: { HOME: home, PB_LOCAL_APP_SUPPORT: appSupport },
    exec: fakeExec(healthy), nodeVersion: '20.1.0', qaDir: home,
  });
  assert.equal(r.ok, false);
  assert.match(r.checks.find((c) => c.id === 'site').detail, /Start the site "Halted" in Local/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — cannot find module `preflight.mjs`.

- [ ] **Step 3: Implement** `skills/protoblocks-site-builder/scripts/lib/preflight.mjs`

```js
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { exec as realExec } from './exec.mjs';
import { resolveLocalSite, writeWrapper } from './local-site.mjs';

export const MIN_PROTO_BLOCKS = '2.10.1';
const DEFAULT_QA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'qa');

export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

export function findWpRoot(dir) {
  let cur = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(cur, 'wp-config.php'))) return cur;
    for (const sub of ['app/public', 'public']) {
      if (fs.existsSync(path.join(cur, sub, 'wp-config.php'))) return path.join(cur, sub);
    }
    const up = path.dirname(cur);
    if (up === cur) return null;
    cur = up;
  }
}

export function runPreflight({
  cwd = process.cwd(), site, path: wpPath, env = process.env, exec = realExec,
  nodeVersion = process.versions.node, qaDir = DEFAULT_QA_DIR,
} = {}) {
  const checks = [];
  const add = (id, status, detail, fix) => checks.push({ id, status, detail, ...(fix ? { fix } : {}) });
  const report = { ok: false, mode: null, wp: null, url: null, publicPath: null, localSite: null, runtimeDir: null, checks };

  // 1. Node (independent of the site)
  const major = parseInt(nodeVersion.split('.')[0], 10);
  if (major >= 18) add('node', 'pass', `Node ${nodeVersion}`);
  else add('node', 'fail', `Node ${nodeVersion} is too old`, 'Install Node 18 or newer (e.g. `brew install node`).');

  // 2. Resolve the site: Local first, then native.
  let wpCmd = null;
  let wpArgs = [];
  const local = wpPath ? { ok: false, notLocal: true } : resolveLocalSite({ cwd, query: site, env });
  if (local.ok) {
    report.mode = 'local-wrapper';
    report.localSite = { id: local.site.id, name: local.site.name, domain: local.site.domain, rootPath: local.site.rootPath };
    report.publicPath = local.site.publicPath;
    report.runtimeDir = path.join(report.publicPath, 'wp-content', '.protoblocks');
    wpCmd = writeWrapper(path.join(report.runtimeDir, 'wp'), local.site);
    add('site', 'pass', `Local site "${local.site.name}" (${local.site.domain})`);
  } else if (!local.notLocal && (site || local.sites?.length) && !findWpRoot(cwd)) {
    add('site', 'fail', local.error, 'Start the site in Local or pass --site "<name>".');
  } else if (!local.notLocal && /Start the site/.test(local.error ?? '')) {
    add('site', 'fail', local.error, 'Start the site in Local, then re-run preflight.');
  } else {
    const rootDir = wpPath ? path.resolve(wpPath) : findWpRoot(cwd);
    if (!rootDir) {
      add('site', 'fail', `No WordPress install found from ${cwd}${local.error && !local.notLocal ? ` (${local.error})` : ''}`,
        'cd into the site (folder containing wp-config.php) or pass --path / --site.');
    } else {
      report.mode = 'native';
      report.publicPath = rootDir;
      report.runtimeDir = path.join(rootDir, 'wp-content', '.protoblocks');
      wpCmd = 'wp';
      wpArgs = [`--path=${rootDir}`];
      add('site', 'pass', `WordPress at ${rootDir}`);
    }
  }

  const wp = (...args) => exec(wpCmd, [...wpArgs, ...args]);

  // 3. WP-CLI reachability
  if (wpCmd) {
    const r = wp('option', 'get', 'siteurl');
    if (r.code === 0 && r.stdout.trim()) {
      report.wp = wpCmd === 'wp' ? 'wp' : wpCmd;
      report.url = r.stdout.trim();
      add('wp-cli', 'pass', `siteurl ${report.url}`);
    } else {
      add('wp-cli', 'fail', (r.stderr || r.stdout).trim().slice(0, 500) || 'WP-CLI failed',
        report.mode === 'native'
          ? 'Install WP-CLI (`brew install wp-cli`) or run from Local\'s "Open site shell".'
          : 'Make sure the site is running in Local; then re-run preflight.');
    }
  }

  // 4. WordPress-dependent checks
  if (report.url) {
    const status = wp('plugin', 'get', 'proto-blocks', '--field=status');
    const version = wp('plugin', 'get', 'proto-blocks', '--field=version');
    if (status.code !== 0) {
      add('proto-blocks', 'warn', 'Proto-Blocks is not installed', 'Run /protoblocks:setup-site (installs the latest release).');
    } else if (status.stdout.trim() !== 'active') {
      add('proto-blocks', 'warn', `Proto-Blocks is ${status.stdout.trim()}`, 'Run /protoblocks:setup-site (activates it).');
    } else if (compareVersions(version.stdout.trim(), MIN_PROTO_BLOCKS) < 0) {
      add('proto-blocks', 'warn', `Proto-Blocks ${version.stdout.trim()} < ${MIN_PROTO_BLOCKS}`, 'Run /protoblocks:setup-site to update to the latest release.');
    } else {
      add('proto-blocks', 'pass', `Proto-Blocks ${version.stdout.trim()} active`);
    }

    const yoast = wp('plugin', 'get', 'wordpress-seo', '--field=status');
    if (yoast.code === 0 && yoast.stdout.trim() === 'active') add('yoast', 'pass', 'Yoast SEO active');
    else add('yoast', 'warn', 'Yoast SEO not active', 'Run /protoblocks:setup-site (installs Yoast SEO).');

    const perma = wp('option', 'get', 'permalink_structure');
    if (perma.code === 0 && perma.stdout.trim()) add('permalinks', 'pass', perma.stdout.trim());
    else add('permalinks', 'warn', 'Plain permalinks', 'Run /protoblocks:setup-site (sets /%postname%/).');

    const bt = wp('eval', 'echo wp_is_block_theme() ? "1" : "0";');
    if (bt.code === 0 && bt.stdout.trim() === '1') add('block-theme', 'pass', 'Active theme is a block theme');
    else add('block-theme', 'warn', 'Active theme is not a block theme', 'Run /protoblocks:setup-site (installs the proto-blocks-theme fork).');
  }

  // 5. Playwright (only needed for QA stages)
  const pw = path.join(qaDir, 'node_modules', 'playwright');
  if (fs.existsSync(pw)) add('playwright', 'pass', 'Playwright installed');
  else add('playwright', 'warn', 'Playwright not installed (needed for visual QA)', `cd "${qaDir}" && npm install && npx playwright install chromium`);

  report.ok = !checks.some((c) => c.status === 'fail');

  if (report.runtimeDir && report.url) {
    fs.mkdirSync(report.runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(report.runtimeDir, 'preflight.json'), `${JSON.stringify({ ...report, at: new Date().toISOString() }, null, 2)}\n`);
  }
  return report;
}

function main(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
  const r = runPreflight({ cwd: a.cwd ?? process.cwd(), site: a.site, path: a.path });
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  if (!r.ok) process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) main(process.argv.slice(2));
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS. If the "no WordPress found" or "halted Local" tests fail because of the branching order in step 2 of `runPreflight`, fix the branching (not the tests): the rules are (a) Local match + running → local-wrapper; (b) Local match + halted → fail with the Local message; (c) otherwise fall back to native via `--path` or `findWpRoot(cwd)`; (d) nothing found → fail `site`, including the Local error text when Local exists.

- [ ] **Step 5: Read-only smoke test against a real running Local site (if available)**

Run: `node skills/protoblocks-site-builder/scripts/lib/preflight.mjs --site "Proto Blocks"`
Expected: JSON with `mode: "local-wrapper"`, `wp-cli` pass, `url` set. Preflight writes only `wp-content/.protoblocks/{wp,preflight.json}` in that site; delete that `.protoblocks` folder afterwards (`rm -rf "<publicPath>/wp-content/.protoblocks"`) so the developer's site is left untouched. If no running Local site exists, record "skipped".

- [ ] **Step 6: Commit**

```bash
git add skills/protoblocks-site-builder/scripts/lib/preflight.mjs tests/unit/preflight.test.mjs
git commit -m "feat(preflight): site, WP-CLI, plugin and tooling checks"
```

---

### Task 5: Orchestrator skill skeleton + references

**Files:**
- Create: `skills/protoblocks-site-builder/SKILL.md`
- Create: `skills/protoblocks-site-builder/references/state-schema.md`
- Create: `skills/protoblocks-site-builder/references/local-sites.md`

**Interfaces:**
- Consumes: CLIs from Tasks 2–4 (exact usage strings above).
- Produces: the skill entry point later stages extend (Stage 7 rewrites the pipeline section in full).

- [ ] **Step 1: Write `SKILL.md`**

Frontmatter (description must start with "Use when", third person, ≤ 1024 chars total frontmatter):
```markdown
---
name: protoblocks-site-builder
description: Use when turning a design (image, screenshot, Figma, Penpot, or URL) into a WordPress site or landing page built from Proto-Blocks on a local site (Local by Flywheel) — runs preflight, keeps a resumable build state, and drives site setup, section breakdown, build/visual-QA/animation loops, and Yoast SEO.
---
```

Body sections (write them in full, concise imperative prose):
1. **Overview** — what the builder does in 3 sentences; local sites only; base theme `proto-blocks-theme`; Proto-Blocks ≥ 2.10.1.
2. **Script location** — "All tools live in `scripts/` next to this file: `PB="${CLAUDE_SKILL_DIR}/scripts"` (Claude Code substitutes `${CLAUDE_SKILL_DIR}` in skill bodies; in other agents use this skill's base directory). Call them as `node "$PB/lib/<tool>.mjs" …`. Other protoblocks-* skills reach them at `${CLAUDE_SKILL_DIR}/../protoblocks-site-builder/scripts/`; plugin commands and agents use `${CLAUDE_PLUGIN_ROOT}/skills/protoblocks-site-builder/scripts/`."
3. **Step 1 — Preflight (always first)** — command `node "$PB/lib/preflight.mjs" [--site "<Local site name>"]`; how to read the report (`fail` → stop and relay `fix` verbatim; `warn` → note, setup will fix); `site` fail listing sites → ask the developer which one; afterwards use `report.wp` as the WP-CLI command for every WordPress call (never bare `wp` in local-wrapper mode).
4. **Step 2 — Build state** — where it lives; `init` once the theme fork exists; every phase reads state first and writes outcomes immediately; CLI cheat-sheet (`get/set/append/validate/restore`) with two real examples:
   `node "$PB/lib/state.mjs" set "$THEME" pages.0.sections.2.status '"done"'` and
   `node "$PB/lib/state.mjs" append "$THEME" pages.0.sections.2.qa '{"iteration":1,"breakpoint":"desktop","mismatch":0.12,"heightDelta":0.02,"pass":false}'`.
   On `EPARSE`/`EINVALID`: run `restore`, never re-`init` over existing state.
5. **Iron rules** — never claim a section passes without a recorded QA verdict in state; never overwrite a theme fork, a page edited in wp-admin, or a template-part DB override without explicit confirmation; never run write commands against a site other than the one preflight resolved.
6. **References** — `references/state-schema.md`, `references/local-sites.md`.

- [ ] **Step 2: Write `references/state-schema.md`**

Content: the full annotated JSON example from spec §2.3 (copy it), followed by a table of enums (`site.wp.mode`, page `status` = `planning|building|seo|done`, section `status` = `planned|building|verifying|animating|done|skipped`, section `decision` = `new|reuse|extend`), the QA defaults, the file locations (`build.json`, `build.json.bak`, `.gitignore`, `artifacts/`), and the CLI usage with every subcommand and its exit behavior.

- [ ] **Step 3: Write `references/local-sites.md`**

Content:
- How Local stores sites (`~/Library/Application Support/Local/sites.json`, `site-statuses.json`, `lightning-services/php-<ver>+<n>/bin/<platform>/bin/php`, `run/<id>/mysql/mysqld.sock`, `/Applications/Local.app/Contents/Resources/extraResources/bin/wp-cli/wp-cli.phar`).
- Why plain `wp` fails outside Local's site shell (DB_HOST `localhost` → default MySQL socket, which Local doesn't use).
- What the wrapper does (exact generated command shape).
- Native mode (Local "Open site shell", or non-Local local installs).
- Runtime folder `<wp-content>/.protoblocks/` (wrapper + preflight.json) vs theme state folder.
- Troubleshooting table: halted site; PHP binary missing (site PHP version changed → re-run preflight); `Error establishing a database connection` (stale wrapper after Local restart changed nothing but site was stopped → start site); overrides `PB_LOCAL_APP_SUPPORT` / `PB_LOCAL_RESOURCES` for non-default installs.

- [ ] **Step 4: Verify**

Run: `head -5 skills/protoblocks-site-builder/SKILL.md && wc -c skills/protoblocks-site-builder/SKILL.md`
Expected: frontmatter with `name` and `description`; SKILL.md under ~6 KB. Check every command in the docs against the actual CLI argument shapes in Tasks 2–4 (run `node state.mjs` with no args to see usage).

- [ ] **Step 5: Commit**

```bash
git add skills/protoblocks-site-builder/SKILL.md skills/protoblocks-site-builder/references
git commit -m "docs(site-builder): orchestrator skeleton, state schema and Local site references"
```

---

### Task 6: Docs hub refresh (`protoblocks` skill)

**Files:**
- Modify: `skills/protoblocks/SKILL.md`
- Modify: `skills/protoblocks/references/cli-and-hooks.md`
- Modify: `skills/protoblocks/references/troubleshooting.md`
- Modify: `skills/protoblocks/references/styling.md`
- Modify: `skills/protoblocks/references/examples.md`
- Create: `skills/protoblocks/references/theme.md`

**Source of truth:** the plugin repo at `/Volumes/Content/projects/proto-blocks/proto-blocks` (v2.10.1) and the theme repo (clone `https://github.com/GustavoGomez092/proto-blocks-theme` into `tests/.tmp/proto-blocks-theme` if not present). **Verify every claim below against source before writing it; if source disagrees, follow source and note the discrepancy in the commit message.**

- [ ] **Step 1: Version + description in `SKILL.md`**

- "Current plugin version: 2.10.0." → "2.10.1".
- Replace the description with: `Use when building, scaffolding, or debugging WordPress Gutenberg blocks with the Proto-Blocks plugin - blocks defined in block.json with a protoBlocks config and rendered by a PHP template.php using data-proto-* attributes, with fields, controls, repeaters, inner blocks, and optional Tailwind. For turning a whole design into pages or a site, use protoblocks-site-builder.`
- Add `references/theme.md` to the Detailed References list: "`references/theme.md` — the proto-blocks-theme starter: builder canvas, Taxi page transitions (wrapper, lifecycle events, script re-run rules), animation globals, token file, required plugins."

- [ ] **Step 2: Gotchas — verify then add**

Verify each in source, then add to `troubleshooting.md` (symptom → cause → fix rows) and the pointed file:
1. `wp proto-blocks create --dir=plugin` writes to `wp-content/plugins/proto-blocks-custom/`, which is not a discovery path (check `includes/CLI/Commands.php` and `includes/Blocks/Discovery.php`). Fix: use `--dir=theme` (default) or add the path via `proto_blocks_paths`. Add to `cli-and-hooks.md` under `create`.
2. Inner-blocks spelling: editor recognizes only `inner-blocks` (`src/editor/fields/render.tsx`); the PHP `SchemaValidator` lists `innerblocks`, so `wp proto-blocks validate` may warn about the correct `inner-blocks` spelling. Guidance: keep `inner-blocks`; ignore that specific warning. (Check `includes/Schema/SchemaValidator.php` for the exact current behavior first — if fixed in 2.10.1, skip this item.)
3. The bundled `hero` example echoes `$content`; nested blocks render empty on the frontend. Use `$innerBlocksContent ?? ''`. Add a caution to `examples.md` in the hero row (verify `examples/hero/template.php`).
4. No Tailwind WP-CLI command; compile with `wp eval 'ProtoBlocks\Core\Plugin::getInstance()->getTailwindManager()->compile();'` (verify method names in `includes/Core/Plugin.php` and `includes/Tailwind/Manager.php`). Add to `cli-and-hooks.md` and `styling.md`.
5. Tailwind v4 input has no default brand tokens: `primary-*`/`secondary-*` classes used by `tl-*` examples need tokens in the active theme's `tailwind-theme.css` (`@theme {}`); path filter `proto_blocks_theme_css_path` (verify `ConfigEditor.php`). Add to `styling.md`.

- [ ] **Step 3: Write `references/theme.md`**

Sections, sourced from the theme README/files (keep ≤ 150 lines):
- What it is; fork-per-project model; requirements (WP 6.9+, PHP 8.0+); TGMPA required plugins (Safe SVG, Yoast SEO, Yoast Duplicate Post, Proto-Blocks; Wordfence recommended).
- Layout: `templates/{index,page,single}.html`, `parts/{header,footer}.html`, `proto-blocks/`, `tailwind-theme.css`, `theme.json`, `scripts/`, `inc/`.
- Builder canvas: pages use `page.html`; title moved to the "Page Title" panel.
- Taxi page transitions: required `<div data-taxi><div data-taxi-view>` wrapper around `<main>` with parts outside; `proto-blocks-*` scripts re-run automatically via `data-taxi-reload`; `viewScriptModule`/Interactivity API modules do NOT re-run → use `proto:page-ready` / `proto:page-leave` events (`e.detail.container`); `window.protoTaxi.addTransition`; PHP filters `proto_taxi_enabled`, `proto_taxi_reload_handles`, `proto_taxi_denied_handles`, `proto_taxi_ignore_urls`; pretty permalinks required.
- Animation globals table (`gsap`, `SplitText`, `ScrollTrigger`, `lottie`, `Lenis`, `window.__protoLenis`) with versions from the README.
- Tokens: `tailwind-theme.css` `@theme` naming → utility classes; reload editor after edits.
- Intro overlay + favicon (one paragraph).

- [ ] **Step 4: Verify**

Run: `grep -n "2.10.0" -r skills/protoblocks || echo "no stale version"` → Expected: `no stale version`.
Run: `grep -c "theme.md" skills/protoblocks/SKILL.md` → Expected: ≥ 1.

- [ ] **Step 5: Commit**

```bash
git add skills/protoblocks
git commit -m "docs(protoblocks): refresh to plugin 2.10.1, add gotchas and theme reference"
```

---

## Self-review notes

- Spec §2.3 state (Task 2), §3 preflight (Tasks 3–4), §9 docs refresh (Task 6), §2.1 packaging skeleton (Tasks 1, 5) covered. Version bump to 2.0.0 and README are deferred to Stage 7 (shipping), per spec §12.
- Names used across tasks: `exec`, `resolveLocalSite`, `writeWrapper`, `runPreflight`, `findWpRoot`, `compareVersions`, `initState/loadState/saveState/restoreState/updateState/getPath/setPath/appendPath` — consistent.
