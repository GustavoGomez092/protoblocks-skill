// Run manifests for the site tests (integration + e2e), so an interrupted run can be cleaned up exactly.
//
// A site test writes tests/.tmp/site-run-<hex>.json before it changes anything and updates it after every change: the
// original theme, the option snapshots (raw JSON, null = absent), the Proto-Blocks Tailwind cache (a byte copy on disk
// next to the manifest), the Yoast crash snapshot, and every post, term and throwaway theme folder it created. On
// SIGTERM/SIGINT (the lock script's watchdog, Ctrl-C) the test runs `recoverRun` synchronously on its own manifest; a
// manifest left behind (SIGKILL, a failed cleanup) makes every site test refuse to start until `tests/recover.mjs`
// (`tests/pb-site-test.sh <worktree> test:recover`) has restored what it lists. Recovery deletes and restores only
// what a manifest names, with the same guards as the tests' own cleanup; never by pattern.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { forkMarker } from '../skills/protoblocks-site-builder/scripts/lib/theme-fork.mjs';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TMP = path.join(REPO, 'tests', '.tmp');
export const LOCK_SCRIPT = path.join(REPO, 'tests', 'pb-site-test.sh');
export const RECOVER_COMMAND = `"${LOCK_SCRIPT}" "${REPO}" test:recover`;
export const YOAST_OPTIONS_PHP = path.join(REPO, 'tests', 'integration', 'yoast-options.php');
const MANIFEST = /^site-run-[0-9a-f]{8}\.json$/;

// Throwaway theme folders a run may create (and recovery may delete): unique per run.
export const THROWAWAY_FORK = /^pb-(e2e|itest-fork|itest-setup)-[0-9a-f]{8}$/;
const THROWAWAY_FOREIGN = /^pb-itest-foreign-[0-9a-f]{8}$/;
// Themes a test activates: the shared pb-itest fixture or a throwaway fork. Recovery only switches away from these.
const TEST_THEME = /^pb-(itest|e2e-[0-9a-f]{8}|itest-fork-[0-9a-f]{8}|itest-setup-[0-9a-f]{8})$/;
// wp_theme terms the parts test creates for a made-up theme.
const THROWAWAY_TERM = /^pb-itest-other-[0-9a-f]{8}$/;

/** Manifests left by earlier runs (not `except`). */
export const leftoverManifests = (dir = TMP, except = null) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => MANIFEST.test(n)).map((n) => path.join(dir, n)).filter((f) => f !== except).sort() : []);

/** '' when no manifest is left over, else why site tests must not start, with the recover command. */
export function leftoverReason(dir = TMP, except = null) {
  const left = leftoverManifests(dir, except);
  if (!left.length) return '';
  return `an interrupted site-test run left ${left.map((f) => path.basename(f)).join(', ')} in ${dir}: the site may still hold its theme switch, options or posts. Restore it first:\n  ${RECOVER_COMMAND}`;
}

const emptyRecord = () => ({ originalTheme: null, options: {}, tailwind: null, yoast: null, posts: [], terms: [], forks: [] });

/** Starts a manifest (written immediately) for one run. `base`: kind, site, publicPath, wrapper, ... */
export function createRun(base = {}, { dir = TMP } = {}) {
  const id = crypto.randomBytes(4).toString('hex');
  const file = path.join(dir, `site-run-${id}.json`);
  const data = { version: 1, id, pid: process.pid, startedAt: new Date().toISOString(), ...base, ...emptyRecord() };
  const write = () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(data, null, 2)}\n`);
    fs.renameSync(`${file}.tmp`, file);
  };
  const run = {
    file,
    data,
    tailwindDir: path.join(dir, `site-run-${id}-tailwind`),
    update(fn) { fn(data); write(); return run; },
    addPost(rec) { return run.update((d) => { d.posts.push(rec); }); },
    /** Sets the id of the post recorded by `name`/`type` (created after it was recorded), or records it. */
    setPostId(name, type, id) {
      return run.update((d) => {
        const rec = d.posts.find((p) => p.name === name && p.type === type && p.id == null);
        if (rec) rec.id = Number(id); else d.posts.push({ id: Number(id), type, name });
      });
    },
    dropPosts(pred) { return run.update((d) => { d.posts = d.posts.filter((p) => !pred(p)); }); },
    addTerm(rec) { return run.update((d) => { d.terms.push(rec); }); },
    dropTerms(pred) { return run.update((d) => { d.terms = d.terms.filter((t) => !pred(t)); }); },
    addFork(rec) { return run.update((d) => { d.forks.push(rec); }); },
    dropFork(slug) { return run.update((d) => { d.forks = d.forks.filter((f) => f.slug !== slug); }); },
    /** Records a Tailwind snapshot (from snapshotTailwind) with its files copied next to the manifest. */
    setTailwind(snap) {
      fs.rmSync(run.tailwindDir, { recursive: true, force: true });
      for (const [rel, buf] of Object.entries(snap.files)) {
        fs.mkdirSync(path.dirname(path.join(run.tailwindDir, rel)), { recursive: true });
        fs.writeFileSync(path.join(run.tailwindDir, rel), buf);
      }
      return run.update((d) => { d.tailwind = { copyDir: run.tailwindDir, option: snap.option, dirExisted: snap.dirExisted, parentExisted: snap.parentExisted, dirs: snap.dirs, files: Object.keys(snap.files) }; });
    },
    clearTailwind() { fs.rmSync(run.tailwindDir, { recursive: true, force: true }); return run.update((d) => { d.tailwind = null; }); },
    /** Nothing left to clean up or restore. */
    isEmpty() { return isDeepStrictEqual({ ...emptyRecord(), ...pick(data) }, emptyRecord()); },
    /** Deletes the manifest and its Tailwind copy. */
    close() { fs.rmSync(run.tailwindDir, { recursive: true, force: true }); fs.rmSync(file, { force: true }); },
  };
  write();
  return run;
}
const pick = (d) => Object.fromEntries(Object.keys(emptyRecord()).map((k) => [k, d[k]]));

/** Reads a manifest written by createRun (EMANIFEST when it is not one). */
export function loadManifest(file) {
  let m;
  try { m = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw Object.assign(new Error(`${file}: ${e.message}`), { code: 'EMANIFEST' }); }
  if (m?.version !== 1 || typeof m.id !== 'string' || !Array.isArray(m.posts) || !Array.isArray(m.forks) || typeof m.options !== 'object') {
    throw Object.assign(new Error(`${file} is not a site-run manifest`), { code: 'EMANIFEST' });
  }
  return { ...emptyRecord(), ...m };
}

// ---- Proto-Blocks' Tailwind cache: every file under uploads/proto-blocks/tailwind, its directories, whether the
// directory and its parent existed, and the proto_blocks_tailwind option (null = absent).
export const tailwindDir = (publicPath) => path.join(publicPath, 'wp-content', 'uploads', 'proto-blocks', 'tailwind');
function walkFiles(dir, base = dir, out = {}) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, base, out);
    else if (e.isFile()) out[path.relative(base, p)] = fs.readFileSync(p);
  }
  return out;
}
function walkDirs(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) { const p = path.join(dir, e.name); out.push(p); walkDirs(p, out); }
  return out;
}
export const rawOption = (wp, name) => {
  const r = wp.run(['option', 'get', name, '--format=json']);
  return r.code === 0 ? r.stdout.trim() : null;
};
export function snapshotTailwind(wp, publicPath) {
  const dir = tailwindDir(publicPath);
  const exists = fs.existsSync(dir);
  return {
    parentExisted: fs.existsSync(path.dirname(dir)),
    dirExisted: exists,
    dirs: exists ? walkDirs(dir).map((d) => path.relative(dir, d)) : [],
    files: exists ? walkFiles(dir) : {},
    option: rawOption(wp, 'proto_blocks_tailwind'),
  };
}
/** Puts the cache files, directories and option back to `snap` byte for byte; true when they match afterwards. */
export function restoreTailwind(wp, publicPath, snap) {
  const dir = tailwindDir(publicPath);
  const parent = path.dirname(dir);
  if (fs.existsSync(dir)) {
    // Files this run added (not in the snapshot), then directories it added, deepest first, only when empty.
    for (const rel of Object.keys(walkFiles(dir))) if (!Object.hasOwn(snap.files, rel)) fs.rmSync(path.join(dir, rel));
    for (const d of walkDirs(dir).sort((a, b) => b.length - a.length)) {
      if (!snap.dirs.includes(path.relative(dir, d)) && fs.readdirSync(d).length === 0) fs.rmdirSync(d);
    }
  }
  for (const [rel, buf] of Object.entries(snap.files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), buf);
  }
  // A cache dir (and parent) the run created goes again when empty.
  if (!snap.dirExisted && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  if (!snap.parentExisted && fs.existsSync(parent) && fs.readdirSync(parent).length === 0) fs.rmdirSync(parent);
  const now = rawOption(wp, 'proto_blocks_tailwind');
  if (snap.option === null && now !== null) wp.check(['option', 'delete', 'proto_blocks_tailwind']);
  else if (snap.option !== null && now !== snap.option) wp.check(['option', 'update', 'proto_blocks_tailwind', snap.option, '--format=json']);
  const after = snapshotTailwind(wp, publicPath);
  return after.option === snap.option && after.dirExisted === snap.dirExisted && after.parentExisted === snap.parentExisted
    && isDeepStrictEqual([...after.dirs].sort(), [...snap.dirs].sort())
    && Object.keys(after.files).length === Object.keys(snap.files).length
    && Object.entries(snap.files).every(([n, b]) => after.files[n] && Buffer.compare(after.files[n], b) === 0);
}
/** The manifest's Tailwind record back as a snapshot (files read from the copy on disk). */
export function tailwindFromManifest(rec) {
  const files = {};
  for (const rel of rec.files) files[rel] = fs.readFileSync(path.join(rec.copyDir, rel));
  return { option: rec.option, dirExisted: rec.dirExisted, parentExisted: rec.parentExisted, dirs: rec.dirs, files };
}

/** Puts each option back to its raw snapshot (deleting the ones that were absent); returns the names still different. */
export function restoreOptions(wp, snap) {
  for (const [name, value] of Object.entries(snap)) {
    const now = rawOption(wp, name);
    if (now === value) continue;
    if (value === null) wp.check(['option', 'delete', name]);
    else wp.check(['option', 'update', name, value, '--format=json']);
  }
  return Object.keys(snap).filter((n) => rawOption(wp, n) !== snap[n]);
}

const postField = (wp, id, field) => {
  const r = wp.run(['post', 'get', String(id), `--field=${field}`]);
  return r.code === 0 ? r.stdout.trim() : null;
};
const hasForkMarker = (dir) => {
  try { return Boolean(forkMarker(fs.readFileSync(path.join(dir, 'style.css'), 'utf8'))); } catch { return false; }
};

/**
 * Restores and deletes exactly what manifest `m` lists, synchronously: re-activates the original theme (only away from
 * a test theme), deletes the run's posts (by id, or by exact name and type; a post whose name or type differs is left
 * and reported), its wp_theme terms, its throwaway theme folders (guards: directly in the themes dir, the unique name,
 * a fork marker or build state for forks, not active) and their theme_mods_ rows, then restores the options, the
 * Tailwind cache and the Yoast options. Returns { done, problems }; recovery is complete when `problems` is empty.
 */
export function recoverRun(wp, m, { publicPath = m.publicPath } = {}) {
  const done = [];
  const problems = [];
  const step = (what, fn) => { try { const r = fn(); if (r) done.push(r); } catch (e) { problems.push(`${what}: ${e.message}`); } };
  const themesDir = path.join(publicPath, 'wp-content', 'themes');
  const active = () => wp.check(['option', 'get', 'stylesheet']).trim();

  if (m.originalTheme) {
    step('re-activate the original theme', () => {
      const now = active();
      if (now === m.originalTheme) return null;
      if (!TEST_THEME.test(now)) throw new Error(`the active theme is "${now}", not a test theme; left as is`);
      if (!fs.existsSync(path.join(themesDir, m.originalTheme, 'style.css'))) throw new Error(`the original theme "${m.originalTheme}" is not in ${themesDir}`);
      wp.check(['theme', 'activate', m.originalTheme]);
      return `activated ${m.originalTheme} (was ${now})`;
    });
  }

  for (const rec of m.posts) {
    step(`post ${rec.id ?? rec.name}`, () => {
      const ids = rec.id != null ? [rec.id]
        : wp.check(['post', 'list', `--post_type=${rec.type}`, '--post_status=any', `--name=${rec.name}`, '--format=ids']).trim().split(/\s+/).filter(Boolean).map(Number);
      const out = [];
      for (const id of ids) {
        const type = postField(wp, id, 'post_type');
        if (type === null) continue; // already gone
        const name = postField(wp, id, 'post_name');
        if (type !== rec.type || (rec.name && name !== rec.name && name !== `${rec.name}__trashed`)) {
          problems.push(`post ${id} is ${type} "${name}", not ${rec.type} "${rec.name}": left in place`);
          continue;
        }
        wp.check(['post', 'delete', String(id), '--force']);
        out.push(`deleted ${type} ${id} "${name}"`);
      }
      return out.join('; ') || null;
    });
  }

  for (const t of m.terms) {
    step(`term ${t.taxonomy}/${t.slug}`, () => {
      if (!THROWAWAY_TERM.test(t.slug)) throw new Error('not a throwaway test term; left in place');
      const r = wp.run(['term', 'get', t.taxonomy, t.slug, '--by=slug', '--field=term_id']);
      if (r.code !== 0) return null;
      wp.check(['term', 'delete', t.taxonomy, t.slug, '--by=slug']);
      return `deleted term ${t.taxonomy}/${t.slug}`;
    });
  }

  for (const f of m.forks) {
    step(`theme folder ${f.slug}`, () => {
      const foreign = f.foreign === true;
      if (!(foreign ? THROWAWAY_FOREIGN : THROWAWAY_FORK).test(f.slug)) throw new Error('not a throwaway test theme name; left in place');
      const dir = path.join(themesDir, f.slug);
      const out = [];
      if (fs.existsSync(dir)) {
        const real = fs.realpathSync(dir);
        const ok = !fs.lstatSync(dir).isSymbolicLink() && path.dirname(real) === fs.realpathSync(themesDir) && path.basename(real) === f.slug
          && active() !== f.slug && (foreign || hasForkMarker(real) || fs.existsSync(path.join(real, '.protoblocks', 'build.json')));
        if (!ok) throw new Error(`${dir} is not provably this run's ${foreign ? 'folder' : 'fork'}, or it is active: left for inspection`);
        fs.rmSync(real, { recursive: true, force: true });
        out.push(`deleted ${dir}`);
      }
      if (!foreign && rawOption(wp, `theme_mods_${f.slug}`) !== null) {
        if (active() === f.slug) throw new Error(`theme_mods_${f.slug}: the theme is still active`);
        wp.check(['option', 'delete', `theme_mods_${f.slug}`]);
        out.push(`deleted theme_mods_${f.slug}`);
      }
      return out.join('; ') || null;
    });
  }

  if (Object.keys(m.options).length) {
    step('options', () => {
      const left = restoreOptions(wp, m.options);
      if (left.length) throw new Error(`not restored: ${left.join(', ')}`);
      return `options restored: ${Object.keys(m.options).join(', ')}`;
    });
  }

  if (m.tailwind) {
    step('Proto-Blocks Tailwind cache', () => {
      if (!restoreTailwind(wp, publicPath, tailwindFromManifest(m.tailwind))) throw new Error('cache files or option differ from the snapshot after restore');
      return 'Tailwind cache and option restored';
    });
  }

  if (m.yoast?.snapshotFile && fs.existsSync(m.yoast.snapshotFile)) {
    step('Yoast options', () => {
      const snap = JSON.parse(fs.readFileSync(m.yoast.snapshotFile, 'utf8'));
      const after = wp.evalFile(YOAST_OPTIONS_PHP, ['restore', m.yoast.snapshotFile]);
      if (JSON.stringify(after) !== JSON.stringify(snap)) throw new Error(`not restored exactly; snapshot kept at ${m.yoast.snapshotFile}`);
      fs.rmSync(m.yoast.snapshotFile, { force: true });
      return 'Yoast options restored';
    });
  }
  return { done, problems };
}

/**
 * On SIGTERM/SIGINT runs `cleanup(signal)` once, synchronously, then exits 143/130. Repeated signals during the cleanup
 * are ignored (the node test runner and the lock script may both send one). Returns a function that removes the handlers.
 */
export function onInterrupt(cleanup, { exit = (code) => process.exit(code) } = {}) {
  let busy = false;
  const handler = (sig) => {
    if (busy) return;
    busy = true;
    try { cleanup(sig); } catch (e) { process.stderr.write(`site-test cleanup after ${sig} failed: ${e.message}\n`); }
    exit(sig === 'SIGINT' ? 130 : 143);
  };
  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);
  return () => { process.off('SIGTERM', handler); process.off('SIGINT', handler); };
}

/** Recovery of one manifest on signal: recoverRun, then the manifest goes when nothing is left, else it stays. */
export function recoverOnSignal(wp, run, sig) {
  const r = recoverRun(wp, run.data);
  process.stderr.write(`site-test interrupted by ${sig}: ${r.done.length} cleanup step(s) done${r.problems.length ? `; NOT cleaned:\n  ${r.problems.join('\n  ')}\nmanifest kept: ${run.file}\nrun: ${RECOVER_COMMAND}` : '; site restored'}\n`);
  if (!r.problems.length) run.close();
  return r;
}
