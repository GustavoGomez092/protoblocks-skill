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

function validateSlug(slug) {
  if (typeof slug !== 'string' || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug) || slug.length > 40) {
    const e = new Error(`Invalid theme slug "${slug}". Must start and end with alphanumeric, contain only lowercase letters, numbers, and hyphens, and be 1-40 characters.`);
    e.code = 'ESLUG';
    throw e;
  }
}

export function forkMarker(css) {
  const m = css.match(/^Proto Fork:\s*(.+?)\s*$/m);
  return m ? m[1] : null;
}

export function rewriteStyleHeader(css, { name, slug, forkedFrom }) {
  let out = css
    .replace(/^Theme Name:.*$/m, `Theme Name: ${name}`)
    .replace(/^Version:.*$/m, 'Version: 1.0.0')
    .replace(/^Description:.*$/m, `Description: ${name} — built with Proto-Blocks (forked from ${forkedFrom}).`);

  // Handle Text Domain: if missing, add it before closing */ with Proto Fork marker
  if (/^Text Domain:.*$/m.test(out)) {
    out = out.replace(/^Text Domain:.*$/m, `Text Domain: ${slug}`);
  } else {
    // Find the closing */ and insert Text Domain and Proto Fork before it
    out = out.replace(/(\*\/)/, `Text Domain: ${slug}\nProto Fork: ${forkedFrom}\n$1`);
  }

  // Handle Proto Fork marker
  if (/^Proto Fork:.*$/m.test(out)) {
    out = out.replace(/^Proto Fork:.*$/m, `Proto Fork: ${forkedFrom}`);
  } else {
    // Only add if not already present via Text Domain insertion
    if (!out.match(/^Proto Fork:/m)) {
      out = out.replace(/^(Text Domain:.*)$/m, `$1\nProto Fork: ${forkedFrom}`);
    }
  }

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

function insideGitWorkTree(dir, exec) {
  const r = exec('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir });
  return r.code === 0 && r.stdout.trim() === 'true';
}

function gitInit(themeDir, forkedFrom, exec) {
  if (exec('git', ['--version']).code !== 0 || fs.existsSync(path.join(themeDir, '.git'))) return false;
  // A themes dir that already lives in a repo (e.g. a versioned wp-content) must not get a nested repo.
  if (insideGitWorkTree(path.dirname(themeDir), exec)) return false;
  exec('git', ['init', '-q'], { cwd: themeDir });
  exec('git', ['add', '-A'], { cwd: themeDir });
  const hasIdentity = exec('git', ['config', 'user.email'], { cwd: themeDir }).stdout.trim() !== '';
  const id = hasIdentity ? [] : ['-c', 'user.name=protoblocks', '-c', 'user.email=protoblocks@localhost'];
  return exec('git', [...id, 'commit', '-q', '-m', `chore: fork ${forkedFrom}`], { cwd: themeDir }).code === 0;
}

/**
 * What already sits at <themesDir>/<slug>: 'none', 'symlink' (never replaced), 'fork' (has the
 * Proto Fork marker; always reused unless re-forked) or 'foreign' (only replaced with force).
 */
export function inspectThemeDir(themeDir) {
  let st;
  try { st = fs.lstatSync(themeDir); } catch { return { kind: 'none', marker: null }; }
  const style = path.join(themeDir, 'style.css');
  const marker = fs.existsSync(style) ? forkMarker(fs.readFileSync(style, 'utf8')) : null;
  if (st.isSymbolicLink()) return { kind: 'symlink', marker };
  return { kind: marker ? 'fork' : 'foreign', marker };
}

export const backupRoot = (themesDir) => path.join(path.dirname(path.resolve(themesDir)), '.protoblocks', 'backups');

// Move (never delete) a folder we are about to replace into <wp-content>/.protoblocks/backups/<slug>-<ISO ts>/.
function moveToBackup(themesDir, slug, themeDir) {
  const root = backupRoot(themesDir);
  fs.mkdirSync(root, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let dest = path.join(root, `${slug}-${stamp}`);
  for (let i = 2; fs.existsSync(dest); i++) dest = path.join(root, `${slug}-${stamp}-${i}`);
  fs.renameSync(themeDir, dest);
  return dest;
}

/**
 * Forks proto-blocks-theme into <themesDir>/<slug> and activates it.
 * - An existing fork (marker present) is ALWAYS reused, whatever `force` says; no zip is needed then.
 * - `force` only replaces a foreign (non-fork) folder; `refork: '<slug>'` replaces an existing fork.
 * - A replaced folder is moved to <wp-content>/.protoblocks/backups/<slug>-<ts>/ (reported as `backup`),
 *   and moved back if the new fork cannot be set up. A symlinked folder is never replaced (ESYMLINK).
 */
export function forkTheme({ wp, themesDir, name, slug = slugify(name), force = false, refork, zipFile, forkedFrom, exec = realExec, cp = fs.cpSync }) {
  // Validate slug format first, before any other processing
  validateSlug(slug);
  if (refork !== undefined && refork !== slug) {
    throw new ForkError(`--refork must repeat the theme slug exactly ("${slug}"), got ${JSON.stringify(refork)}; nothing was changed.`, 'ERFORK');
  }

  const themeDir = path.join(themesDir, slug);

  // Verify themeDir is directly in themesDir, not in subdirectories
  if (path.dirname(path.resolve(themeDir)) !== path.resolve(themesDir)) {
    const e = new Error(`Theme directory escape attempt: ${slug}`);
    e.code = 'ESLUG';
    throw e;
  }

  const existing = inspectThemeDir(themeDir);
  // Reusing never writes over anything, so a fork (even a symlinked one) is reused whatever `force` says.
  if (existing.marker && refork === undefined) {
    wp.check(['theme', 'activate', slug]);
    return { themeDir, slug, reused: true, forkedFrom: existing.marker };
  }
  if (existing.kind === 'symlink' && (force || refork !== undefined)) {
    throw new ForkError(`wp-content/themes/${slug} is a symlink (a development checkout?); it is never replaced. Use another --slug.`, 'ESYMLINK');
  }
  if ((existing.kind === 'foreign' || existing.kind === 'symlink') && !force) {
    throw new ForkError(`wp-content/themes/${slug} already exists and is not a protoblocks fork. Ask the developer; re-run with --force to replace it (the folder is moved to wp-content/.protoblocks/backups/, not deleted), or pick another --slug.`, 'EFORKEXISTS');
  }

  // Extract and validate the zip before moving any existing folder.
  let backup = null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-theme-'));
  try {
    const entries = unzip(zipFile, tmp);
    const src = entries.map((e) => path.join(tmp, e)).find((p) => fs.existsSync(path.join(p, 'style.css')));
    if (!src) throw new ForkError(`No theme folder with style.css inside ${zipFile}`, 'ENOTHEME');

    if (existing.kind !== 'none') backup = moveToBackup(themesDir, slug, themeDir);

    try {
      cp(src, themeDir, { recursive: true });
    } catch (err) {
      rollback(themeDir, backup);
      throw err;
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  try {
    const stylePath = path.join(themeDir, 'style.css');
    fs.writeFileSync(stylePath, rewriteStyleHeader(fs.readFileSync(stylePath, 'utf8'), { name, slug, forkedFrom }));
    for (const f of textDomainFiles(themeDir)) fs.writeFileSync(f, rewriteTextDomain(fs.readFileSync(f, 'utf8'), slug));

    gitInit(themeDir, forkedFrom, exec);
    wp.check(['theme', 'activate', slug]);
  } catch (err) {
    rollback(themeDir, backup);
    throw err;
  }

  return { themeDir, slug, reused: false, forkedFrom, ...(backup ? { backup } : {}) };
}

// Remove only the folder this call created, then put the moved-away original back.
function rollback(themeDir, backup) {
  if (fs.existsSync(themeDir)) fs.rmSync(themeDir, { recursive: true, force: true });
  if (backup && fs.existsSync(backup)) fs.renameSync(backup, themeDir);
}

export async function fetchThemeZip({ fetchRelease = fetchLatestRelease, downloadImpl = download, tmpRoot = os.tmpdir() } = {}) {
  const rel = await fetchRelease(THEME_REPO);
  const zipDir = fs.mkdtempSync(path.join(tmpRoot, 'pb-themezip-'));
  try {
    const zipFile = path.join(zipDir, `proto-theme-${rel.version}.zip`);
    await downloadImpl(rel.zipUrl, zipFile);
    return {
      zipFile,
      forkedFrom: `proto-blocks-theme@${rel.version}`,
      cleanup: () => { if (fs.existsSync(zipDir)) fs.rmSync(zipDir, { recursive: true, force: true }); }
    };
  } catch (err) {
    // Clean up zipDir if download fails
    if (fs.existsSync(zipDir)) fs.rmSync(zipDir, { recursive: true, force: true });
    throw err;
  }
}

async function main(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--force') a.force = true;
    else if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[++i];
  }
  if (!a.name) { process.stderr.write('Usage: node theme-fork.mjs --name "<Project>" [--slug s] [--force] [--refork <slug>] [--cwd D]\n'); process.exit(64); }
  const rt = loadRuntime(a.cwd ?? process.cwd());
  const themesDir = path.join(rt.publicPath, 'wp-content', 'themes');
  const slug = a.slug ?? slugify(a.name);
  const opts = { wp: createWp(rt), themesDir, name: a.name, slug, force: !!a.force, refork: a.refork };
  // A reusable fork needs no download, so re-runs work offline.
  if (inspectThemeDir(path.join(themesDir, slug)).marker && a.refork === undefined) {
    process.stdout.write(`${JSON.stringify(forkTheme(opts), null, 2)}\n`);
    return;
  }
  const { zipFile, forkedFrom, cleanup } = await fetchThemeZip();
  try {
    const r = forkTheme({ ...opts, zipFile, forkedFrom });
    process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  } finally {
    cleanup();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); });
}
