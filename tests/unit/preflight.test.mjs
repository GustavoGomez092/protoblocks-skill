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
