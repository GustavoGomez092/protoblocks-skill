import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readSites, findSiteForDir, findSiteByQuery, phpBinary, resolveLocalSite, wrapperScript, writeWrapper, platformKey,
} from '../../skills/protoblocks-site-builder/scripts/lib/local-site.mjs';

let home, appSupport, resources, env;

function touch(p) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, ''); }

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-home-'));
  appSupport = path.join(home, 'Library/Application Support/Local');
  resources = path.join(home, 'Local.app/extraResources');
  env = { HOME: home, PB_LOCAL_APP_SUPPORT: appSupport, PB_LOCAL_RESOURCES: resources };
  fs.mkdirSync(appSupport, { recursive: true });
  fs.writeFileSync(path.join(appSupport, 'sites.json'), JSON.stringify({
    aaa111: { id: 'aaa111', name: 'Acme Co', domain: 'acme.local', path: '~/Local Sites/acme', services: { php: { version: '8.4.10' } } },
    bbb222: { id: 'bbb222', name: 'Halted', domain: 'halted.local', path: '~/Local Sites/halted', services: { php: { version: '8.2.27' } } },
  }));
  fs.writeFileSync(path.join(appSupport, 'site-statuses.json'), JSON.stringify({ aaa111: 'running', bbb222: 'halted' }));
  touch(path.join(appSupport, `lightning-services/php-8.4.10+0/bin/${platformKey()}/bin/php`));
  touch(path.join(appSupport, `lightning-services/php-8.2.27+1/bin/${platformKey()}/bin/php`));
  touch(path.join(appSupport, 'run/aaa111/mysql/mysqld.sock'));
  touch(path.join(resources, 'bin/wp-cli/wp-cli.phar'));
  fs.mkdirSync(path.join(home, 'Local Sites/acme/app/public/wp-content/themes/x'), { recursive: true });
  fs.mkdirSync(path.join(home, 'Local Sites/halted/app/public'), { recursive: true });
});

test('readSites expands ~ and reads running status', () => {
  const sites = readSites(appSupport, home);
  const acme = sites.find((s) => s.id === 'aaa111');
  assert.equal(acme.rootPath, path.join(home, 'Local Sites/acme'));
  assert.equal(acme.publicPath, path.join(home, 'Local Sites/acme/app/public'));
  assert.equal(acme.running, true);
  assert.equal(sites.find((s) => s.id === 'bbb222').running, false);
});

test('findSiteForDir matches a deep subdirectory and a symlinked path', () => {
  const sites = readSites(appSupport, home);
  const deep = path.join(home, 'Local Sites/acme/app/public/wp-content/themes/x');
  assert.equal(findSiteForDir(sites, deep).id, 'aaa111');
  const link = path.join(home, 'acme-link');
  fs.symlinkSync(path.join(home, 'Local Sites/acme'), link);
  assert.equal(findSiteForDir(sites, path.join(link, 'app')).id, 'aaa111');
  assert.equal(findSiteForDir(sites, home), null);
});

test('findSiteByQuery matches id, name (case-insensitive) and domain', () => {
  const sites = readSites(appSupport, home);
  assert.equal(findSiteByQuery(sites, 'aaa111').id, 'aaa111');
  assert.equal(findSiteByQuery(sites, 'acme co').id, 'aaa111');
  assert.equal(findSiteByQuery(sites, 'acme.local').id, 'aaa111');
  assert.equal(findSiteByQuery(sites, 'nope'), null);
});

test('phpBinary picks the lightning-services build for the site version', () => {
  assert.equal(
    phpBinary(appSupport, '8.4.10'),
    path.join(appSupport, `lightning-services/php-8.4.10+0/bin/${platformKey()}/bin/php`),
  );
  assert.equal(phpBinary(appSupport, '7.4.1'), null);
});

test('resolveLocalSite resolves a running site from cwd', () => {
  const r = resolveLocalSite({ cwd: path.join(home, 'Local Sites/acme/app/public'), env });
  assert.equal(r.ok, true);
  assert.equal(r.site.socket, path.join(appSupport, 'run/aaa111/mysql/mysqld.sock'));
  assert.equal(r.site.phar, path.join(resources, 'bin/wp-cli/wp-cli.phar'));
});

test('resolveLocalSite on a halted site says to start it in Local', () => {
  const r = resolveLocalSite({ cwd: path.join(home, 'Local Sites/halted'), env });
  assert.equal(r.ok, false);
  assert.equal(r.halted, true);
  assert.match(r.error, /Start the site "Halted" in Local/);
});

test('resolveLocalSite outside any site lists available site names', () => {
  const r = resolveLocalSite({ cwd: home, env });
  assert.equal(r.ok, false);
  assert.deepEqual(r.sites.sort(), ['Acme Co', 'Halted']);
  assert.match(r.error, /--site/);
});

test('resolveLocalSite with no Local install reports not-local', () => {
  const r = resolveLocalSite({ cwd: home, env: { ...env, PB_LOCAL_APP_SUPPORT: path.join(home, 'nope') } });
  assert.equal(r.ok, false);
  assert.equal(r.notLocal, true);
});

test('wrapperScript single-quotes every path (spaces safe)', () => {
  const s = wrapperScript({
    phpBin: "/a b/php", socket: "/c d/mysqld.sock", phar: "/e f/wp-cli.phar", publicPath: "/g h/it's/public",
  });
  assert.match(s, /^#!\/bin\/sh\n/);
  assert.ok(s.includes(`exec '/a b/php'`));
  assert.ok(s.includes(`-d 'mysqli.default_socket=/c d/mysqld.sock'`));
  assert.ok(s.includes(`'/e f/wp-cli.phar'`));
  assert.ok(s.includes(`'--path=/g h/it'\\''s/public'`));
  assert.ok(s.trimEnd().endsWith('"$@"'));
});

test('writeWrapper writes an executable file', () => {
  const r = resolveLocalSite({ cwd: path.join(home, 'Local Sites/acme'), env });
  const out = path.join(home, 'out/wp');
  writeWrapper(out, r.site);
  assert.ok(fs.statSync(out).mode & 0o100);
});
