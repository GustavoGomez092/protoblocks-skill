#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWp, loadRuntime, WP_SCRIPTS_DIR } from './wp.mjs';
import { loadState, updateState } from './state.mjs';
import { refreshMenus } from './navigation.mjs';

const SCRIPT = path.join(WP_SCRIPTS_DIR, 'page.php');
const fail = (code, message) => Object.assign(new Error(message), { code });
const USAGE = 'Usage: node page.mjs build <themeDir> <slug> [--force]\n';

export const backupsDir = (themeDir) => path.join(themeDir, '.protoblocks', 'artifacts', 'backups');

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

// The spec travels in a temp file and only `<command> <path>` is argv: free text must never reach WP-CLI's parser.
function callPhp(wp, command, arg) {
  const out = wp.evalFile(SCRIPT, [command, arg]);
  if (out?.error) throw fail(out.error.code ?? 'EPAGE', out.error.message);
  return out;
}

function withSpecFile(spec, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-page-'));
  const file = path.join(dir, 'spec.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  try { return fn(file); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/**
 * Backup design: a WordPress revision is not reliable (revisions can be disabled, and none is made when the content
 * is unchanged), so JS always writes the current post_content to a file before overwriting anything that is not
 * exactly what the builder last wrote. page.php also saves a revision as a bonus (backupRevisionId).
 */
function backUp(themeDir, wp, slug, postId) {
  const cur = callPhp(wp, 'get', String(postId));
  const dir = backupsDir(themeDir);
  const file = path.join(dir, `${slug}-${postId}-${new Date().toISOString().replace(/[:.]/g, '-')}.html`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, cur.content, { flag: 'wx' });
  } catch (e) {
    throw fail('EBACKUP', `Could not save a backup of page ${postId} to ${file} (${e.message}); nothing was overwritten.`);
  }
  return file;
}

export function buildPage(wp, themeDir, slug, { force = false } = {}) {
  const spec = pageSpecFromState(loadState(themeDir), slug, { force });
  const dir = backupsDir(themeDir);
  const planned = withSpecFile(spec, (file) => callPhp(wp, 'plan', file));
  if (planned.guard) {
    throw fail(planned.guard.code,
      `${planned.guard.message} Ask the developer before overwriting; then re-run with --force. `
      + `Overwriting first saves the current content to ${path.join(dir, `${slug}-<postId>-<timestamp>.html`)} (and as a WordPress revision when revisions are on).`);
  }
  const backupFile = planned.needsBackup && planned.target ? backUp(themeDir, wp, slug, planned.target.postId) : null;
  const r = withSpecFile(spec, (file) => callPhp(wp, 'write', file));
  if (!r.ok) {
    throw fail(r.code, `${r.message} Ask the developer before overwriting; then re-run with --force. Overwriting first saves the current content to ${path.join(dir, `${slug}-<postId>-<timestamp>.html`)}.`);
  }
  const warnings = [...(r.warnings ?? [])];
  if (r.slug && r.slug !== slug) warnings.push(`WordPress gave the page the slug "${r.slug}" instead of the requested "${slug}" (the requested one was unavailable).`);

  let pendingHere = false;
  updateState(themeDir, (s) => {
    const page = s.pages.find((p) => p.slug === slug);
    page.postId = r.postId;
    page.url = r.url;
    page.contentHash = r.contentHash;
    if (page.status === 'planning') page.status = 'building';
    pendingHere = Object.values(s.site.navigation?.menus ?? {}).some((m) => (m.pending ?? []).some((p) => p.page === slug));
  });
  let refreshedMenus = [];
  let menuRefreshError = null;
  if (pendingHere) {
    try { refreshedMenus = refreshMenus(wp, themeDir).refreshed; } catch (e) {
      menuRefreshError = `The page was written, but refreshing the menus failed: ${e.message}. Run: node navigation.mjs refresh ${themeDir}`;
    }
  }
  return {
    postId: r.postId, slug: r.slug ?? slug, url: r.url, contentHash: r.contentHash, created: r.created,
    backupRevisionId: r.backupRevisionId ?? null, backupFile, warnings, refreshedMenus, menuRefreshError,
  };
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const flags = rest.filter((a) => a.startsWith('--'));
  const pos = rest.filter((a) => !a.startsWith('--'));
  if (cmd !== 'build' || pos.length !== 2 || flags.some((f) => f !== '--force')) { process.stderr.write(USAGE); process.exit(64); }
  const [themeDir, slug] = pos;
  const r = buildPage(createWp(loadRuntime(themeDir)), themeDir, slug, { force: flags.includes('--force') });
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); }
}
