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

test('slug traversal protection: validates slug before any operation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slug-test-'));
  const themesDir = path.join(root, 'themes');
  fs.mkdirSync(themesDir);

  // Create sentinels that must NOT be deleted
  const xDir = path.join(root, 'x');
  fs.mkdirSync(xDir);
  fs.writeFileSync(path.join(xDir, 'keep.txt'), 'must-keep');
  fs.writeFileSync(path.join(root, 'keep.txt'), 'must-keep');

  try {
    // Use a mock wp that throws if called (to verify validation happens before wp calls)
    const failWp = { check: () => { throw new Error('must not call wp.check if slug is invalid'); } };
    const failExec = () => { throw new Error('must not call exec if slug is invalid'); };

    // Each invalid slug must throw ESLUG before making any wp calls or file ops
    for (const slug of ['../x', '..', 'a/b']) {
      assert.throws(
        () => forkTheme({ wp: failWp, themesDir, name: 'Test', slug, force: true, zipFile: '/dev/null', forkedFrom: 'test@1.0', exec: failExec }),
        (e) => e.code === 'ESLUG',
        `slug "${slug}" must be rejected with ESLUG before any operation`
      );
    }

    // Verify sentinels still exist (not deleted by force)
    assert.ok(fs.existsSync(path.join(xDir, 'keep.txt')), 'root/x/keep.txt must not be deleted');
    assert.ok(fs.existsSync(path.join(root, 'keep.txt')), 'root/keep.txt must not be deleted');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
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

test('validate zip and find theme BEFORE removing existing folder', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-test-'));
  const themesDir = path.join(root, 'themes');
  fs.mkdirSync(themesDir);

  // Create a foreign (non-forked) theme that should not be deleted
  const acmeDir = path.join(themesDir, 'acme');
  fs.mkdirSync(acmeDir);
  const styleFile = path.join(acmeDir, 'style.css');
  const originalContent = '/*\nTheme Name: Client Theme\nText Domain: client\n*/';
  fs.writeFileSync(styleFile, originalContent);

  try {
    // Create a bad zip with no style.css in root folder
    const badZipDir = fs.mkdtempSync(path.join(os.tmpdir(), 'badzip-'));
    try {
      // Create zip with bad/readme.txt (no proto-theme/ folder with style.css)
      const { execSync } = await import('node:child_process');
      fs.mkdirSync(path.join(badZipDir, 'bad'));
      fs.writeFileSync(path.join(badZipDir, 'bad', 'readme.txt'), 'no style.css here');
      const zipPath = path.join(badZipDir, 'bad.zip');
      execSync(`cd ${badZipDir} && zip -r bad.zip bad`, { stdio: 'ignore' });

      const mockWp = { check: () => '' };

      // This must throw ENOTHEME AND leave the existing foreign folder untouched
      assert.throws(
        () => forkTheme({ wp: mockWp, themesDir, name: 'Test', slug: 'acme', force: true, zipFile: zipPath, forkedFrom: 'test@1.0' }),
        (e) => e.code === 'ENOTHEME',
        'must throw ENOTHEME for zip without style.css'
      );

      // Verify the foreign folder still exists with original content
      assert.ok(fs.existsSync(styleFile), 'acme/style.css must still exist');
      const content = fs.readFileSync(styleFile, 'utf8');
      assert.equal(content, originalContent, 'acme/style.css must have original content (not deleted)');
    } finally {
      fs.rmSync(badZipDir, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('failed activation rolls back: removes new theme folder and rethrows error', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-test-'));
  const themesDir = path.join(root, 'themes');
  fs.mkdirSync(themesDir);

  try {
    // Create a minimal valid theme zip
    const zipDir = fs.mkdtempSync(path.join(os.tmpdir(), 'valid-zip-'));
    try {
      const themeDir = path.join(zipDir, 'proto-theme');
      fs.mkdirSync(themeDir);
      fs.writeFileSync(path.join(themeDir, 'style.css'), '/*\nTheme Name: Test\nText Domain: proto-theme\n*/');
      fs.writeFileSync(path.join(themeDir, 'functions.php'), "<?php\n__('test', 'proto-theme');");

      // Build the zip
      const { execSync } = await import('node:child_process');
      const zipPath = path.join(zipDir, 'valid.zip');
      execSync(`cd ${zipDir} && zip -r valid.zip proto-theme`, { stdio: 'ignore' });

      // Mock wp that throws on activation
      const failingWp = {
        check: (cmd) => {
          if (cmd[0] === 'theme' && cmd[1] === 'activate') {
            const err = new Error('activation failed (simulated)');
            err.code = 'WPFAIL';
            throw err;
          }
          return '';
        }
      };

      const freshThemeDir = path.join(themesDir, 'fresh');

      // Call forkTheme - it should create the folder, but then fail on activation and remove it
      assert.throws(
        () => forkTheme({ wp: failingWp, themesDir, name: 'Fresh', slug: 'fresh', zipFile: zipPath, forkedFrom: 'test@1.0' }),
        (e) => e.code === 'WPFAIL'
      );

      // The theme folder must be removed after the error
      assert.ok(!fs.existsSync(freshThemeDir), 'themesDir/fresh must be removed after activation failure');
    } finally {
      fs.rmSync(zipDir, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
