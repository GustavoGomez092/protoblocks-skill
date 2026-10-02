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
