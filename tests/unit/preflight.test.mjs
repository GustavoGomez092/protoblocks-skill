import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { platformKey } from '../../skills/protoblocks-site-builder/scripts/lib/local-site.mjs';
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

const PB_KEY = 'plugin get proto-blocks --fields=status,version --format=json';
const pbJson = (status, version) => JSON.stringify({ status, version });

const healthy = {
  'option get siteurl': 'http://acme.local\n',
  [PB_KEY]: pbJson('active', '2.10.1'),
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
    exec: fakeExec({ ...healthy, [PB_KEY]: pbJson('active', '2.4.0') }),
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

test('explicit --site with typo never falls back to native, fails with check name instruction', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-typo-'));
  const appSupport = path.join(home, 'Local');
  fs.mkdirSync(appSupport, { recursive: true });
  fs.writeFileSync(path.join(appSupport, 'sites.json'), JSON.stringify({ a1: { id: 'a1', name: 'Acme', domain: 'acme.local', path: '~/sites/acme', services: { php: { version: '8.4.10' } } } }));
  fs.writeFileSync(path.join(appSupport, 'site-statuses.json'), JSON.stringify({ a1: 'running' }));
  const acmePath = path.join(home, 'sites/acme/app/public');
  fs.mkdirSync(acmePath, { recursive: true });
  fs.writeFileSync(path.join(acmePath, 'wp-config.php'), '<?php');

  const calls = [];
  const recordingExec = (cmd, args) => {
    calls.push({ cmd, args: args.filter((a) => !a.startsWith('--path=')) });
    return { code: 127, stdout: '', stderr: 'command not found' };
  };

  const r = runPreflight({
    cwd: acmePath,
    env: { HOME: home, PB_LOCAL_APP_SUPPORT: appSupport },
    site: 'typo',
    exec: recordingExec,
    nodeVersion: '20.1.0',
    qaDir: home,
  });
  assert.equal(r.ok, false);
  const siteCheck = r.checks.find((c) => c.id === 'site');
  assert.equal(siteCheck.status, 'fail');
  assert.match(siteCheck.detail, /No Local site matches/);
  assert.match(siteCheck.fix, /check the name/i);
  assert.ok(!siteCheck.fix.includes('--site'), 'fix should not suggest --site when --site was already passed');
  assert.equal(calls.length, 0, 'wp should not have been called when --site lookup failed');
});

test('halted Local site with wp-config.php in cwd fails without wp calls', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-halted-wp-'));
  const appSupport = path.join(home, 'Local');
  fs.mkdirSync(appSupport, { recursive: true });
  fs.writeFileSync(path.join(appSupport, 'sites.json'), JSON.stringify({ h1: { id: 'h1', name: 'Halted', domain: 'h.local', path: '~/sites/h', services: { php: { version: '8.4.10' } } } }));
  fs.writeFileSync(path.join(appSupport, 'site-statuses.json'), JSON.stringify({ h1: 'halted' }));
  const publicPath = path.join(home, 'sites/h/app/public');
  fs.mkdirSync(publicPath, { recursive: true });
  fs.writeFileSync(path.join(publicPath, 'wp-config.php'), '<?php');

  const calls = [];
  const recordingExec = (cmd, args) => {
    calls.push({ cmd, args });
    return { code: 0, stdout: 'http://example.local\n', stderr: '' };
  };

  const r = runPreflight({
    cwd: publicPath,
    env: { HOME: home, PB_LOCAL_APP_SUPPORT: appSupport },
    exec: recordingExec,
    nodeVersion: '20.1.0',
    qaDir: home,
  });
  assert.equal(r.ok, false);
  const siteCheck = r.checks.find((c) => c.id === 'site');
  assert.equal(siteCheck.status, 'fail');
  assert.match(siteCheck.detail, /Start the site "Halted" in Local/);
  assert.equal(calls.length, 0, 'wp should not have been called when site is halted');
});

test('active proto-blocks with empty version warns with version unknown', () => {
  const r = runPreflight({
    cwd: path.join(root, 'public'),
    env: notLocalEnv(root),
    nodeVersion: '20.1.0',
    qaDir: root,
    exec: fakeExec({
      ...healthy,
      [PB_KEY]: pbJson('active', '')
    }),
  });
  const c = r.checks.find((x) => x.id === 'proto-blocks');
  assert.equal(c.status, 'warn');
  assert.match(c.detail, /Proto-Blocks active.*version unknown/i);
  assert.match(c.fix, /setup-site/i);
});

function localFixture({ php = true, running = true, wpConfig = true } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-fx-'));
  const appSupport = path.join(home, 'Library/Application Support/Local');
  const resources = path.join(home, 'Local.app/extraResources');
  const touch = (p) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, ''); };
  fs.mkdirSync(appSupport, { recursive: true });
  fs.writeFileSync(path.join(appSupport, 'sites.json'), JSON.stringify({ a1: { id: 'a1', name: 'Acme', domain: 'acme.local', path: '~/Local Sites/acme', services: { php: { version: '8.4.10' } } } }));
  fs.writeFileSync(path.join(appSupport, 'site-statuses.json'), JSON.stringify({ a1: running ? 'running' : 'halted' }));
  touch(path.join(appSupport, 'run/a1/mysql/mysqld.sock'));
  fs.mkdirSync(path.join(appSupport, 'run/a1/conf/php'), { recursive: true });
  if (php) touch(path.join(appSupport, `lightning-services/php-8.4.10+0/bin/${platformKey()}/bin/php`));
  touch(path.join(resources, 'bin/wp-cli/wp-cli.phar'));
  const publicPath = path.join(home, 'Local Sites/acme/app/public');
  fs.mkdirSync(publicPath, { recursive: true });
  if (wpConfig) fs.writeFileSync(path.join(publicPath, 'wp-config.php'), '<?php');
  const env = { HOME: home, PB_LOCAL_APP_SUPPORT: appSupport, PB_LOCAL_RESOURCES: resources };
  return { home, appSupport, publicPath, env };
}

function recordingExec(responses) {
  const calls = [];
  const fn = (cmd, args) => {
    calls.push({ cmd, args });
    const k = args.filter((a) => !a.startsWith('--path=')).join(' ');
    if (k in responses) return { code: 0, stdout: responses[k], stderr: '' };
    return { code: 1, stdout: '', stderr: `unexpected: ${k}` };
  };
  fn.calls = calls;
  return fn;
}

test('running Local site uses the wrapper for every wp call and records localSite', () => {
  const fx = localFixture();
  const exec = recordingExec(healthy);
  const r = runPreflight({ cwd: fx.publicPath, env: fx.env, exec, nodeVersion: '20.1.0', qaDir: fx.home });
  assert.equal(r.mode, 'local-wrapper');
  assert.equal(r.ok, true, JSON.stringify(r.checks, null, 2));
  const wrapper = path.join(fx.publicPath, 'wp-content/.protoblocks/wp');
  assert.equal(r.wp, wrapper);
  assert.ok(fs.existsSync(wrapper));
  assert.ok(exec.calls.length > 0);
  assert.ok(exec.calls.every((c) => c.cmd === wrapper), 'every exec used the wrapper');
  const saved = JSON.parse(fs.readFileSync(path.join(fx.publicPath, 'wp-content/.protoblocks/preflight.json'), 'utf8'));
  assert.equal(saved.localSite.id, 'a1');
  assert.equal(saved.ok, true);
});

test('explicit --site without Local installed fails the site check and runs no wp', () => {
  const exec = recordingExec(healthy);
  const r = runPreflight({ cwd: path.join(root, 'public'), env: notLocalEnv(root), site: 'Acme', exec, nodeVersion: '20.1.0', qaDir: root });
  assert.equal(r.ok, false);
  const c = r.checks.find((x) => x.id === 'site');
  assert.equal(c.status, 'fail');
  assert.match(c.detail, /--site.*needs Local by Flywheel/);
  assert.match(c.detail, /--path/);
  assert.equal(exec.calls.length, 0);
});

test('matched Local site with missing PHP binary fails site, no native fallback', () => {
  const fx = localFixture({ php: false });
  const exec = recordingExec(healthy);
  const r = runPreflight({ cwd: fx.publicPath, env: fx.env, exec, nodeVersion: '20.1.0', qaDir: fx.home });
  assert.equal(r.ok, false);
  assert.equal(r.mode, null);
  const c = r.checks.find((x) => x.id === 'site');
  assert.equal(c.status, 'fail');
  assert.match(c.detail, /PHP/);
  assert.match(c.detail, /binary not found/);
  assert.doesNotMatch(c.fix, /brew install wp-cli/);
  assert.equal(exec.calls.length, 0);
});

test('a failing run overwrites an earlier ok preflight.json with ok:false', () => {
  const opts = { cwd: path.join(root, 'public'), env: notLocalEnv(root), nodeVersion: '20.1.0', qaDir: root };
  const file = path.join(root, 'public/wp-content/.protoblocks/preflight.json');
  runPreflight({ ...opts, exec: fakeExec(healthy) });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).ok, true);
  const r = runPreflight({ ...opts, exec: fakeExec({}, { wpOnPath: false }) });
  assert.equal(r.ok, false);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).ok, false);
});
