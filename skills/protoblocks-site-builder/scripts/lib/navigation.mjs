#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWp, loadThemeRuntime, WP_SCRIPTS_DIR } from './wp.mjs';
import { loadState, updateState, setPath, getPath, statePath } from './state.mjs';

const SCRIPT = path.join(WP_SCRIPTS_DIR, 'navigation.php');

// Keys become state paths (site.navigation.menus.<key>) and post slugs (pb-nav-<key>).
const KEY_RE = /^[a-z0-9][a-z0-9_-]*$/;
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const NAV_BACKUP_DIR = (themeDir) => path.join(themeDir, '.protoblocks', 'artifacts', 'backups');

function codeError(code, message, extra = {}) {
  return Object.assign(new Error(message), { code }, extra);
}

function checkKey(key) {
  if (typeof key !== 'string' || !KEY_RE.test(key) || RESERVED_KEYS.has(key)) {
    throw codeError('ENAVKEY', `Invalid menu key ${JSON.stringify(key ?? null)}: start with a lowercase letter or digit, then lowercase letters, digits, "-" or "_".`);
  }
}

// navigation.php reports typed failures on stderr as "[ECODE] message"; surface the code.
const PHP_CODE_RE = /^\[(E[A-Z]{3,})\]\s*(.*)$/m;
function callNav(wp, cmd, data) {
  try {
    return wp.evalFilePayload(SCRIPT, cmd, data);
  } catch (err) {
    const m = PHP_CODE_RE.exec(err?.result?.stderr ?? '');
    if (!m) throw err;
    throw codeError(m[1], m[2].trim() || m[1], { cause: err });
  }
}

/**
 * Create or replace the wp_navigation post `pb-nav-<key>` from `spec`.
 * An existing menu is only overwritten when its content still hashes to `expectHash` (what protoblocks
 * last wrote) or already equals the new content; otherwise it was edited elsewhere (Site Editor) and the
 * call fails with EEDITED. `force` overwrites anyway after saving the current content under `backupDir`.
 */
export function upsertMenu(wp, key, spec, { expectHash = null, force = false, backupDir } = {}) {
  checkKey(key);
  let backup;
  if (force) {
    if (!backupDir) throw codeError('EUSAGE', 'upsertMenu force needs a backupDir to save the current menu first.');
    const current = callNav(wp, 'get', { key });
    if (current?.id && current.content) {
      fs.mkdirSync(backupDir, { recursive: true });
      backup = path.join(backupDir, `nav-${key}-${new Date().toISOString().replace(/[:.]/g, '-')}.html`);
      fs.writeFileSync(backup, current.content);
    }
  }
  let result;
  try {
    result = callNav(wp, 'upsert', { key, spec, expectHash, force });
  } catch (err) {
    if (err.code !== 'EEDITED') throw err;
    throw codeError('EEDITED', `${err.message} The menu was edited in the Site Editor (or elsewhere) after protoblocks last wrote it; upserting would discard those edits, so nothing was changed. Either keep the Site Editor version (leave this menu alone, or change the spec to match it), or, with the developer's OK, re-run with --force: it first saves the current menu to .protoblocks/artifacts/backups/nav-${key}-<timestamp>.html in the theme, then overwrites it.`, { cause: err });
  }
  return backup ? { ...result, backup } : result;
}

function record(themeDir, key, spec, result) {
  if (!fs.existsSync(statePath(themeDir))) return;
  updateState(themeDir, (s) => {
    setPath(s, `site.navigation.menus.${result.key}`, { id: result.id, spec, pending: result.pending, contentHash: result.contentHash });
  });
}

/**
 * For every menu with pending links, patch ONLY the placeholder custom links whose page now exists
 * (navigation.php `refresh` parses the saved blocks), so Site Editor edits elsewhere in the menu survive.
 * Pending links that are no longer in the menu (removed in the Site Editor) are dropped and reported as `missing`.
 * The stored contentHash only advances when the menu was untouched before the patch (previousHash matches).
 */
export function refreshMenus(wp, themeDir) {
  const menus = loadState(themeDir).site.navigation?.menus ?? {};
  const refreshed = [];
  const out = {};
  for (const [key, m] of Object.entries(menus)) {
    if (!m.pending?.length) continue;
    checkKey(key);
    const r = callNav(wp, 'refresh', { key, pending: m.pending });
    // Advance the stored hash only if the menu was untouched since protoblocks wrote it. If it was edited in
    // the Site Editor, keep the old hash so the next plain upsert still refuses with EEDITED.
    const untouched = r.previousHash !== undefined && r.previousHash === m.contentHash;
    updateState(themeDir, (s) => {
      setPath(s, `site.navigation.menus.${key}`, { ...m, id: r.id, pending: r.pending, contentHash: untouched ? r.contentHash : m.contentHash });
    });
    refreshed.push(key);
    out[key] = { id: r.id, patched: r.patched, pending: r.pending, missing: r.missing };
  }
  return { refreshed, menus: out };
}

const USAGE = 'Usage: node navigation.mjs upsert <themeDir> <key> <spec.json> [--force] | refresh <themeDir>\n';

function main(argv) {
  const force = argv.includes('--force');
  const [cmd, themeDir, key, file] = argv.filter((a) => a !== '--force');
  if (!themeDir || !['upsert', 'refresh'].includes(cmd) || (cmd === 'upsert' && !(key && file))) {
    process.stderr.write(USAGE);
    process.exit(64);
  }
  const wp = createWp(loadThemeRuntime(themeDir));
  if (cmd === 'refresh') { process.stdout.write(`${JSON.stringify(refreshMenus(wp, themeDir), null, 2)}\n`); return; }
  const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
  const hasState = fs.existsSync(statePath(themeDir));
  const expectHash = hasState ? getPath(loadState(themeDir), `site.navigation.menus.${key}.contentHash`) ?? null : null;
  const result = upsertMenu(wp, key, spec, { expectHash, force, backupDir: NAV_BACKUP_DIR(themeDir) });
  record(themeDir, key, spec, result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); }
}
