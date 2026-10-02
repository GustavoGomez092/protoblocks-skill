#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWp, loadRuntime, WP_SCRIPTS_DIR } from './wp.mjs';
import { fetchLatestRelease } from './releases.mjs';
import { compareVersions } from './preflight.mjs';

export const WPORG_PLUGINS = ['wordpress-seo', 'safe-svg', 'duplicate-post'];
const PROTO_BLOCKS_REPO = 'GustavoGomez092/Proto-Blocks';

// `wp plugin install` downloads and unpacks; the default 120 s exec timeout is too short on slow links.
export const INSTALL_TIMEOUT_MS = 600000;
const ACTIVE = new Set(['active', 'active-network']);

function pluginState(wp, slug) {
  const s = wp.run(['plugin', 'get', slug, '--field=status']);
  if (s.code !== 0) return { installed: false };
  const v = wp.run(['plugin', 'get', slug, '--field=version']);
  return { installed: true, active: ACTIVE.has(s.stdout.trim()), version: v.stdout.trim() };
}

function pluginError(code, message) {
  return Object.assign(new Error(message), { code });
}

// WordPress deletes the old plugin folder before unpacking an update, and that delete follows symlinks:
// a symlinked or git-managed (development) checkout would be wiped, .git included. Refuse those outright.
function assertReplaceablePluginDir(wp, slug) {
  const dir = wp.check(['plugin', 'path', slug, '--dir']).trim();
  if (!dir) throw pluginError('EPLUGINDEV', `Could not resolve the ${slug} plugin folder; refusing to replace it.`);
  let st;
  try { st = fs.lstatSync(dir); } catch { st = null; }
  if (st?.isSymbolicLink()) {
    throw pluginError('EPLUGINDEV', `${dir} is a symlink (a development checkout?). Updating would delete the files it points to; update it yourself (e.g. git pull) instead.`);
  }
  if (fs.existsSync(path.join(dir, '.git'))) {
    throw pluginError('EPLUGINDEV', `${dir} is a git checkout. Updating would delete it, .git included; update it yourself (e.g. git pull) instead.`);
  }
  return dir;
}

function activateIfNeeded(wp, slug, st, extra = {}) {
  if (st.active) return { slug, action: 'ok', version: st.version, ...extra };
  wp.check(['plugin', 'activate', slug]);
  return { slug, action: 'activated', version: st.version, ...extra };
}

/**
 * Installs/activates Proto-Blocks and the wordpress.org plugins, then sets the Proto-Blocks options.
 * An installed plugin is never replaced unless `updatePlugins` is true, and even then never when its
 * folder is a symlink or git checkout (EPLUGINDEV). A newer release is reported as `updateAvailable`.
 */
export async function ensurePlugins(wp, { fetchRelease = fetchLatestRelease, updatePlugins = false } = {}) {
  const plugins = [];
  const warnings = [];

  let rel = null;
  let releaseError = null;
  try {
    rel = await fetchRelease(PROTO_BLOCKS_REPO);
  } catch (e) {
    if (e.code !== 'ERELEASE') throw e;
    releaseError = e;
  }

  const pb = pluginState(wp, 'proto-blocks');
  if (releaseError) {
    // Offline: an installed copy is used as-is; with nothing installed there is nothing to fall back to.
    if (!pb.installed) throw releaseError;
    plugins.push(activateIfNeeded(wp, 'proto-blocks', pb, { warning: `could not check for updates: ${releaseError.message}` }));
  } else if (!pb.installed) {
    wp.check(['plugin', 'install', rel.zipUrl, '--activate'], { timeout: INSTALL_TIMEOUT_MS });
    plugins.push({ slug: 'proto-blocks', action: 'installed', version: rel.version });
  } else if (compareVersions(pb.version, rel.version) < 0 && updatePlugins) {
    assertReplaceablePluginDir(wp, 'proto-blocks');
    wp.check(['plugin', 'install', rel.zipUrl, '--force', '--activate'], { timeout: INSTALL_TIMEOUT_MS });
    plugins.push({ slug: 'proto-blocks', action: 'updated', version: rel.version, previousVersion: pb.version });
  } else {
    const newer = compareVersions(pb.version, rel.version) < 0 ? { updateAvailable: rel.version } : {};
    plugins.push(activateIfNeeded(wp, 'proto-blocks', pb, newer));
  }

  for (const slug of WPORG_PLUGINS) {
    const st = pluginState(wp, slug);
    if (!st.installed) {
      wp.check(['plugin', 'install', slug, '--activate'], { timeout: INSTALL_TIMEOUT_MS });
      plugins.push({ slug, action: 'installed' });
    } else {
      plugins.push(activateIfNeeded(wp, slug, st));
    }
  }

  const options = [];

  // Check and update proto_blocks_wizard_completed
  const wizardCurrent = wp.run(['option', 'get', 'proto_blocks_wizard_completed']).stdout.trim();
  if (wizardCurrent !== '1') {
    wp.check(['option', 'update', 'proto_blocks_wizard_completed', '1']);
    options.push('proto_blocks_wizard_completed');
  }

  // Check current Tailwind state before enabling
  let tailwindCurrentState = null;
  try {
    tailwindCurrentState = wp.evalFile(path.join(WP_SCRIPTS_DIR, 'tailwind.php'), ['status']);
  } catch {
    // tailwind.php status failed, assume not configured
  }

  const tailwindEnabled = tailwindCurrentState?.enabled === true;
  const componentStyleCurrent = wp.run(['option', 'get', 'proto_blocks_component_style']).stdout.trim();

  // Enable Tailwind only if not already enabled or component_style isn't tailwind
  if (!tailwindEnabled || componentStyleCurrent !== 'tailwind') {
    wp.evalFile(path.join(WP_SCRIPTS_DIR, 'tailwind.php'), ['enable']);
    if (!tailwindEnabled) {
      options.push('proto_blocks_tailwind.enabled');
    }
    if (componentStyleCurrent !== 'tailwind') {
      options.push('proto_blocks_component_style');
    }
  }

  // Permalinks: only replace plain (empty) permalinks; a custom structure is the developer's choice.
  const permalink = wp.run(['option', 'get', 'permalink_structure']);
  const permalinkCurrent = permalink.code === 0 ? permalink.stdout.trim() : '';
  if (permalinkCurrent === '') {
    wp.check(['rewrite', 'structure', '/%postname%/']);
    options.push('permalink_structure');
  } else if (permalinkCurrent !== '/%postname%/') {
    warnings.push(`permalink_structure is "${permalinkCurrent}" (custom); left unchanged. Pages are built for /%postname%/ links; change it in Settings > Permalinks if needed.`);
  }

  return { plugins, options, ...(warnings.length ? { warnings } : {}) };
}

async function main(argv) {
  const cwdIdx = argv.indexOf('--cwd');
  const rt = loadRuntime(cwdIdx >= 0 ? argv[cwdIdx + 1] : process.cwd());
  const result = await ensurePlugins(createWp(rt), { updatePlugins: argv.includes('--update-plugins') });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); });
}
