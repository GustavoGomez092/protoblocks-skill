import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { slugify, forkMarker, rewriteStyleHeader, rewriteTextDomain, ForkError, forkTheme } from '../../skills/protoblocks-site-builder/scripts/lib/theme-fork.mjs';

const STYLE = `/*
Theme Name: Proto-theme
Theme URI:
Description: A batteries-included block-theme starter for Proto-Blocks development.
Version: 1.1.3
Text Domain: proto-theme
Tags: block-theme
*/
body{}`;

test('slugify', () => {
  assert.equal(slugify('Acme Co — Website!'), 'acme-co-website');
  assert.throws(() => slugify('!!!'), (e) => e.code === 'ESLUG');
});

test('rewriteStyleHeader sets identity and the fork marker', () => {
  const out = rewriteStyleHeader(STYLE, { name: 'Acme Co', slug: 'acme-co', forkedFrom: 'proto-blocks-theme@1.1.3' });
  assert.match(out, /^Theme Name: Acme Co$/m);
  assert.match(out, /^Text Domain: acme-co$/m);
  assert.match(out, /^Version: 1\.0\.0$/m);
  assert.match(out, /^Description: Acme Co — built with Proto-Blocks \(forked from proto-blocks-theme@1\.1\.3\)\.$/m);
  assert.equal(forkMarker(out), 'proto-blocks-theme@1.1.3');
  assert.ok(out.endsWith('body{}'));
  const again = rewriteStyleHeader(out, { name: 'Acme Co', slug: 'acme-co', forkedFrom: 'proto-blocks-theme@1.1.4' });
  assert.equal(again.match(/^Proto Fork:/gm).length, 1);
  assert.equal(forkMarker(again), 'proto-blocks-theme@1.1.4');
});

test('forkMarker is null for a non-fork theme', () => {
  assert.equal(forkMarker(STYLE), null);
});

test('rewriteTextDomain replaces only the quoted literal', () => {
  const src = `__('Proto Blocks', 'proto-theme'); $x = "proto-theme-dev"; 'id' => 'proto-theme',`;
  assert.equal(rewriteTextDomain(src, 'acme'), `__('Proto Blocks', 'acme'); $x = "proto-theme-dev"; 'id' => 'acme',`);
});

test('forkTheme rejects invalid explicit slugs', () => {
  const themesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
  try {
    const mockWp = { check: () => '' };
    const mockExec = () => ({ code: 0, stdout: '' });

    const invalidSlugs = ['../x', '..', 'a/b', '-start', 'end-'];
    for (const slug of invalidSlugs) {
      assert.throws(() => forkTheme({ wp: mockWp, themesDir, name: 'Test', slug, zipFile: '', forkedFrom: '', exec: mockExec }),
        (e) => e.code === 'ESLUG', `should reject slug: ${slug}`);
    }
  } finally {
    fs.rmSync(themesDir, { recursive: true, force: true });
  }
});

test('forkTheme with --force does not delete when slug validation fails', () => {
  const themesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
  const sentinel = path.join(themesDir, 'sentinel');
  fs.writeFileSync(sentinel, 'test');
  try {
    const mockWp = { check: () => '' };
    const mockExec = () => ({ code: 0, stdout: '' });

    assert.throws(() => forkTheme({ wp: mockWp, themesDir, name: 'Test', slug: '../x', zipFile: '', forkedFrom: '', force: true, exec: mockExec }),
      (e) => e.code === 'ESLUG');
    assert.ok(fs.existsSync(sentinel), 'sentinel not deleted when slug validation fails');
  } finally {
    fs.rmSync(themesDir, { recursive: true, force: true });
  }
});

test('rewriteStyleHeader appends Text Domain and Proto Fork before closing */ if missing', () => {
  const styleNoTextDomain = `/*
Theme Name: Proto-theme
Version: 1.1.3
Tags: block-theme
*/
body{}`;

  const out = rewriteStyleHeader(styleNoTextDomain, { name: 'Acme Co', slug: 'acme-co', forkedFrom: 'proto-blocks-theme@1.1.3' });
  assert.match(out, /^Text Domain: acme-co$/m);
  assert.match(out, /^Proto Fork: proto-blocks-theme@1.1\.3$/m);
  assert.ok(out.includes('*/'), 'closing */ present');
});
