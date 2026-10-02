#!/usr/bin/env node
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { exec as realExec } from './exec.mjs';
import { resolveLocalSite, writeWrapper } from './local-site.mjs';

export const MIN_PROTO_BLOCKS = '2.10.1';
const DEFAULT_QA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'qa');
// Oldest supported Node: the QA dependencies (sharp, playwright) need 20.9.
export const MIN_NODE = '20.9';
export const nodeOk = (version) => compareVersions(String(version).replace(/^v/, ''), MIN_NODE) >= 0;
// The visual-QA scripts' dependencies (scripts/qa/package.json), resolved from the QA folder itself.
export const QA_PACKAGES = ['sharp', 'pixelmatch', 'playwright', '@axe-core/playwright'];

/**
 * The QA dependencies as Node resolves them from `qaDir`, plus Playwright's Chromium build on disk. `resolve`,
 * `chromiumPath` and `exists` are injectable (tests). Returns a preflight check; its fix is the absolute install command.
 */
export function checkQaDeps(qaDir, {
  resolve = (name) => createRequire(path.join(path.resolve(qaDir), 'package.json')).resolve(name),
  chromiumPath = () => createRequire(path.join(path.resolve(qaDir), 'package.json'))('playwright').chromium.executablePath(),
  exists = fs.existsSync,
} = {}) {
  const abs = path.resolve(qaDir);
  const fix = `cd "${abs}" && npm install && npx playwright install chromium`;
  const missing = QA_PACKAGES.filter((name) => { try { resolve(name); return false; } catch { return true; } });
  if (missing.length) return { id: 'qa-deps', status: 'warn', detail: `QA dependencies missing: ${missing.join(', ')} (needed for visual QA; install once, and again after every plugin update)`, fix };
  let exe = '';
  try { exe = chromiumPath() ?? ''; } catch { exe = ''; }
  if (!exe || !exists(exe)) return { id: 'qa-deps', status: 'warn', detail: `Playwright's Chromium is not installed${exe ? ` (${exe})` : ''} (needed for visual QA)`, fix };
  return { id: 'qa-deps', status: 'pass', detail: `QA dependencies and Chromium installed in ${abs}` };
}

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
  nodeVersion = process.versions.node, qaDir = DEFAULT_QA_DIR, qaDeps = {},
} = {}) {
  const checks = [];
  const add = (id, status, detail, fix) => checks.push({ id, status, detail, ...(fix ? { fix } : {}) });
  const report = { ok: false, mode: null, wp: null, url: null, publicPath: null, localSite: null, runtimeDir: null, checks };

  // 1. Node (independent of the site)
  if (nodeOk(nodeVersion)) add('node', 'pass', `Node ${nodeVersion}`);
  else add('node', 'fail', `Node ${nodeVersion} is too old`, `Install Node ${MIN_NODE} or newer (e.g. \`brew install node\`).`);

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
  } else if (site && local.notLocal) {
    // Explicit --site can only be honoured through Local; never fall back to native.
    add('site', 'fail', '`--site` needs Local by Flywheel; use `--path` for non-Local installs', 'Install/start Local, or pass --path <wp root> for a non-Local install.');
  } else if (site && !local.ok) {
    // Explicit --site was passed but lookup/resolution failed; never fall back to native.
    const fixText = local.halted
      ? 'Start the site in Local, then re-run preflight.'
      : local.matched
        ? 'Fix the PHP version/installation for this site in Local (or start the site), then re-run preflight.'
        : 'Check the name with `node local-site.mjs detect`, or start the site in Local.';
    add('site', 'fail', local.error, fixText);
  } else if (local.matched) {
    // The directory belongs to a Local site that cannot be resolved; never run bare `wp` inside it.
    add('site', 'fail', local.error, local.halted
      ? 'Start the site in Local, then re-run preflight.'
      : 'Fix the site in Local (PHP version/installation), or start it, then re-run preflight.');
  } else if (!local.notLocal && local.sites?.length && !findWpRoot(cwd)) {
    add('site', 'fail', local.error, 'Start the site in Local or pass --site "<name>".');
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
      report.wp = wpCmd;
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
    const pb = wp('plugin', 'get', 'proto-blocks', '--fields=status,version', '--format=json');
    let pbInfo = null;
    if (pb.code === 0) { try { pbInfo = JSON.parse(pb.stdout); } catch { pbInfo = null; } }
    if (pb.code !== 0) {
      add('proto-blocks', 'warn', 'Proto-Blocks is not installed', 'Run /protoblocks-skill:setup-site (installs the latest release).');
    } else if (!pbInfo || pbInfo.status !== 'active') {
      add('proto-blocks', 'warn', `Proto-Blocks is ${pbInfo?.status ?? 'in an unknown state'}`, 'Run /protoblocks-skill:setup-site (activates it).');
    } else {
      const ver = String(pbInfo.version ?? '').trim();
      if (!ver) {
        add('proto-blocks', 'warn', 'Proto-Blocks active (version unknown)', 'Run /protoblocks-skill:setup-site to ensure the latest version.');
      } else if (compareVersions(ver, MIN_PROTO_BLOCKS) < 0) {
        add('proto-blocks', 'warn', `Proto-Blocks ${ver} < ${MIN_PROTO_BLOCKS}`, 'Run /protoblocks-skill:setup-site to update to the latest release.');
      } else {
        add('proto-blocks', 'pass', `Proto-Blocks ${ver} active`);
      }
    }

    const yoast = wp('plugin', 'get', 'wordpress-seo', '--field=status');
    if (yoast.code === 0 && yoast.stdout.trim() === 'active') add('yoast', 'pass', 'Yoast SEO active');
    else add('yoast', 'warn', 'Yoast SEO not active', 'Run /protoblocks-skill:setup-site (installs Yoast SEO).');

    const perma = wp('option', 'get', 'permalink_structure');
    if (perma.code === 0 && perma.stdout.trim()) add('permalinks', 'pass', perma.stdout.trim());
    else add('permalinks', 'warn', 'Plain permalinks', 'Run /protoblocks-skill:setup-site (sets /%postname%/).');

    const bt = wp('eval', 'echo wp_is_block_theme() ? "1" : "0";');
    if (bt.code === 0 && bt.stdout.trim() === '1') add('block-theme', 'pass', 'Active theme is a block theme');
    else add('block-theme', 'warn', 'Active theme is not a block theme', 'Run /protoblocks-skill:setup-site (installs the proto-blocks-theme fork).');
  }

  // 5. QA dependencies and Chromium (only needed for the QA stages; a warn: ask, then install before breakdown)
  const qa = checkQaDeps(qaDir, qaDeps);
  add(qa.id, qa.status, qa.detail, qa.fix);

  report.ok = !checks.some((c) => c.status === 'fail');

  if (report.runtimeDir) {
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
