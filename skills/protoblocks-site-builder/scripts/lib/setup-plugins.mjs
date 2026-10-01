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
    // Offline mode: if proto-blocks not installed, rethrow
    if (!pb.installed) throw releaseError;
    // If installed, activate if needed and report with warning
    if (!pb.active) {
      wp.check(['plugin', 'activate', 'proto-blocks']);
      plugins.push({ slug: 'proto-blocks', action: 'activated', version: pb.version, warning: `could not check for updates: ${releaseError.message}` });
    } else {
      plugins.push({ slug: 'proto-blocks', action: 'ok', version: pb.version, warning: `could not check for updates: ${releaseError.message}` });
    }
  } else {
    if (!pb.installed || compareVersions(pb.version, rel.version) < 0) {
      wp.check(['plugin', 'install', rel.zipUrl, '--force', '--activate']);
      plugins.push({ slug: 'proto-blocks', action: pb.installed ? 'updated' : 'installed', version: rel.version });
    } else if (!pb.active) {
      wp.check(['plugin', 'activate', 'proto-blocks']);
      plugins.push({ slug: 'proto-blocks', action: 'activated', version: pb.version });
    } else {
      plugins.push({ slug: 'proto-blocks', action: 'ok', version: pb.version });
    }
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

  // Check and update permalink_structure
  const permalinkCurrent = wp.run(['option', 'get', 'permalink_structure']).stdout.trim();
  if (permalinkCurrent !== '/%postname%/') {
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
