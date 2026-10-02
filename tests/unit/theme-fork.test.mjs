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

test('partial copy cleanup: removes theme dir if cp throws', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-fail-test-'));
  const themesDir = path.join(root, 'themes');
  fs.mkdirSync(themesDir);

  try {
    // Create a valid theme zip
    const zipDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-zip-'));
    try {
      const srcTheme = path.join(zipDir, 'proto-theme');
      fs.mkdirSync(srcTheme);
      fs.writeFileSync(path.join(srcTheme, 'style.css'), '/*\nTheme Name: Test\nText Domain: proto-theme\n*/');
      fs.writeFileSync(path.join(srcTheme, 'functions.php'), "<?php\n__('test', 'proto-theme');");

      // Build the zip
      const { execSync } = await import('node:child_process');
      const zipPath = path.join(zipDir, 'cp-test.zip');
      execSync(`cd ${zipDir} && zip -r cp-test.zip proto-theme`, { stdio: 'ignore' });

      // Mock cp that creates the dir but then throws
      const failingCp = (src, dest, opts) => {
        fs.mkdirSync(dest, { recursive: true });
        fs.writeFileSync(path.join(dest, 'partial.txt'), 'partial copy');
        const err = new Error('copy failed (simulated)');
        err.code = 'ECPCOPY';
        throw err;
      };

      const mockWp = { check: () => '' };
      const partialDir = path.join(themesDir, 'partial');

      // Call forkTheme with failing cp
      assert.throws(
        () => forkTheme({ wp: mockWp, themesDir, name: 'Partial', slug: 'partial', zipFile: zipPath, forkedFrom: 'test@1.0', cp: failingCp }),
        (e) => e.code === 'ECPCOPY'
      );

      // The partial directory must be removed after cp fails
      assert.ok(!fs.existsSync(partialDir), 'themesDir/partial must be removed if copy fails');
      assert.ok(!fs.existsSync(path.join(partialDir, 'partial.txt')), 'partial copy file must not exist');
    } finally {
      fs.rmSync(zipDir, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('slugify format: rejects invalid formats', () => {
  const invalidCases = ['-start', 'end-', 'UPPER', 'a_b'];
  for (const slug of invalidCases) {
    assert.throws(
      () => forkTheme({ wp: { check: () => '' }, themesDir: '/tmp', name: 'Test', slug, force: true, zipFile: '', forkedFrom: '', exec: () => ({ code: 0, stdout: '' }) }),
      (e) => e.code === 'ESLUG',
      `slug "${slug}" must be rejected with ESLUG`
    );
  }
});

const FORK_MOD = '../../skills/protoblocks-site-builder/scripts/lib/theme-fork.mjs';

async function withTmpRoot(fn) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-themezip-test-'));
  try { await fn(tmpRoot); } finally { fs.rmSync(tmpRoot, { recursive: true, force: true }); }
}

test('fetchThemeZip cleanup: no temp dir created if fetchRelease throws', async () => {
  await withTmpRoot(async (tmpRoot) => {
    const { fetchThemeZip } = await import(FORK_MOD);
    const fetchRelease = () => { const err = new Error('release fetch failed'); err.code = 'ERELEASE'; throw err; };
    await assert.rejects(() => fetchThemeZip({ fetchRelease, tmpRoot }), (e) => e.code === 'ERELEASE');
    assert.deepEqual(fs.readdirSync(tmpRoot), []);
  });
});

test('fetchThemeZip cleanup: removes dir if downloadImpl throws', async () => {
  await withTmpRoot(async (tmpRoot) => {
    const { fetchThemeZip } = await import(FORK_MOD);
    const fetchRelease = () => Promise.resolve({ version: '1.0.0', zipUrl: 'https://example.com/test.zip' });
    const downloadImpl = () => { const err = new Error('download failed'); err.code = 'EDOWNLOAD'; throw err; };
    await assert.rejects(() => fetchThemeZip({ fetchRelease, downloadImpl, tmpRoot }), (e) => e.code === 'EDOWNLOAD');
    assert.deepEqual(fs.readdirSync(tmpRoot), []);
  });
});

test('fetchThemeZip success: zipFile lives in tmpRoot and cleanup() empties it', async () => {
  await withTmpRoot(async (tmpRoot) => {
    const { fetchThemeZip } = await import(FORK_MOD);
    const fetchRelease = () => Promise.resolve({ version: '1.0.0', zipUrl: 'https://example.com/test.zip' });
    const downloadImpl = async (_url, dest) => { fs.writeFileSync(dest, 'zip'); return dest; };
    const { zipFile, forkedFrom, cleanup } = await fetchThemeZip({ fetchRelease, downloadImpl, tmpRoot });
    assert.ok(fs.existsSync(zipFile));
    assert.ok(path.resolve(zipFile).startsWith(path.resolve(tmpRoot) + path.sep));
    assert.equal(forkedFrom, 'proto-blocks-theme@1.0.0');
    cleanup();
    assert.deepEqual(fs.readdirSync(tmpRoot), []);
  });
});

// ---- I1: forks are always reused; refork/backup instead of delete ----
import { execSync, spawnSync as spawn } from 'node:child_process';
import { exec as realExec } from '../../skills/protoblocks-site-builder/scripts/lib/exec.mjs';

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-fork-i1-'));
  const wpContent = path.join(root, 'wp-content');
  const themesDir = path.join(wpContent, 'themes');
  fs.mkdirSync(themesDir, { recursive: true });
  const src = path.join(root, 'zipsrc', 'proto-theme');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'style.css'), '/*\nTheme Name: Proto-theme\nVersion: 1.1.3\nText Domain: proto-theme\n*/\nbody{}');
  fs.writeFileSync(path.join(src, 'functions.php'), "<?php\n__('x', 'proto-theme');\n");
  const zipFile = path.join(root, 'theme.zip');
  execSync(`cd "${path.dirname(src)}" && zip -qr "${zipFile}" proto-theme`);
  const calls = [];
  const wp = { check: (args) => { calls.push(args.join(' ')); return ''; } };
  const noGit = () => ({ code: 1, stdout: '', stderr: '' });
  const mkFork = (slug, extra = 'mine') => {
    const d = path.join(themesDir, slug);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'style.css'), `/*\nTheme Name: Acme\nText Domain: ${slug}\nProto Fork: proto-blocks-theme@1.0.0\n*/`);
    fs.writeFileSync(path.join(d, 'work.txt'), extra);
    return d;
  };
  const backups = () => { const b = path.join(wpContent, '.protoblocks', 'backups'); return fs.existsSync(b) ? fs.readdirSync(b).map((n) => path.join(b, n)) : []; };
  return { root, wpContent, themesDir, zipFile, wp, calls, noGit, mkFork, backups };
}
const base = (s, over = {}) => ({ wp: s.wp, themesDir: s.themesDir, name: 'Acme', slug: 'acme', forkedFrom: 'proto-blocks-theme@2.0.0', exec: s.noGit, ...over });

test('an existing fork is reused even with force: true, and needs no zip', () => {
  const s = sandbox();
  const d = s.mkFork('acme');
  const r = forkTheme(base(s, { force: true, zipFile: undefined }));
  assert.equal(r.reused, true);
  assert.equal(fs.readFileSync(path.join(d, 'work.txt'), 'utf8'), 'mine');
  assert.deepEqual(s.calls, ['theme activate acme']);
  assert.deepEqual(s.backups(), []);
});

test('refork must name the slug (ERFORK) and is checked before anything else', () => {
  const s = sandbox();
  const d = s.mkFork('acme');
  const failWp = { check: () => { throw new Error('wp must not be called'); } };
  assert.throws(() => forkTheme(base(s, { wp: failWp, refork: 'other', zipFile: s.zipFile })), (e) => e.code === 'ERFORK');
  assert.throws(() => forkTheme(base(s, { wp: failWp, refork: true, zipFile: s.zipFile })), (e) => e.code === 'ERFORK');
  assert.equal(fs.readFileSync(path.join(d, 'work.txt'), 'utf8'), 'mine');
});

test('refork moves the old fork to wp-content/.protoblocks/backups and forks fresh', () => {
  const s = sandbox();
  s.mkFork('acme');
  const r = forkTheme(base(s, { refork: 'acme', zipFile: s.zipFile }));
  assert.equal(r.reused, false);
  const [bak] = s.backups();
  assert.ok(bak, 'backup dir exists');
  assert.equal(r.backup, bak);
  assert.match(path.basename(bak), /^acme-\d{4}-\d{2}-\d{2}T/);
  assert.equal(fs.readFileSync(path.join(bak, 'work.txt'), 'utf8'), 'mine', 'old fork preserved in the backup');
  assert.equal(fs.existsSync(path.join(s.themesDir, 'acme', 'work.txt')), false);
  assert.equal(forkMarker(fs.readFileSync(path.join(s.themesDir, 'acme', 'style.css'), 'utf8')), 'proto-blocks-theme@2.0.0');
});

test('force on a foreign folder moves it to backups instead of deleting it', () => {
  const s = sandbox();
  const d = path.join(s.themesDir, 'acme');
  fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, 'style.css'), '/*\nTheme Name: Client\n*/');
  assert.throws(() => forkTheme(base(s, { zipFile: s.zipFile })), (e) => e.code === 'EFORKEXISTS' && /backups/.test(e.message) && !/deletes/.test(e.message));
  const r = forkTheme(base(s, { force: true, zipFile: s.zipFile }));
  assert.equal(fs.readFileSync(path.join(r.backup, 'style.css'), 'utf8'), '/*\nTheme Name: Client\n*/');
  assert.ok(r.backup.startsWith(path.join(s.wpContent, '.protoblocks', 'backups') + path.sep));
});

test('a symlinked theme folder is never replaced: ESYMLINK for force (foreign) and refork (fork)', () => {
  for (const [kind, over] of [['foreign', { force: true }], ['fork', { refork: 'acme' }], ['foreign', { refork: 'acme', force: true }]]) {
    const s = sandbox();
    const target = path.join(s.root, 'dev-checkout');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'style.css'), kind === 'fork' ? '/*\nProto Fork: proto-blocks-theme@1.0.0\n*/' : '/*\nTheme Name: Dev\n*/');
    fs.mkdirSync(path.join(target, '.git'));
    fs.symlinkSync(target, path.join(s.themesDir, 'acme'));
    assert.throws(() => forkTheme(base(s, { ...over, zipFile: s.zipFile })), (e) => e.code === 'ESYMLINK', `${kind} ${JSON.stringify(over)}`);
    assert.ok(fs.lstatSync(path.join(s.themesDir, 'acme')).isSymbolicLink());
    assert.ok(fs.existsSync(path.join(target, '.git')));
    assert.deepEqual(fs.readdirSync(target).sort(), ['.git', 'style.css']);
    assert.deepEqual(s.backups(), []);
  }
});

test('a symlinked fork is reused (force is ignored for forks); a symlinked foreign folder without force is EFORKEXISTS', () => {
  const s = sandbox();
  const target = path.join(s.root, 'dev-fork');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'style.css'), '/*\nProto Fork: proto-blocks-theme@1.0.0\n*/');
  fs.symlinkSync(target, path.join(s.themesDir, 'acme'));
  assert.equal(forkTheme(base(s, { force: true })).reused, true);
  const f = sandbox();
  const t2 = path.join(f.root, 'dev');
  fs.mkdirSync(t2);
  fs.symlinkSync(t2, path.join(f.themesDir, 'acme'));
  assert.throws(() => forkTheme(base(f, { zipFile: f.zipFile })), (e) => e.code === 'EFORKEXISTS');
});

test('failed activation after refork/force restores the previous folder from the backup', () => {
  const wp = { check: (args) => { if (args[0] === 'theme') throw Object.assign(new Error('nope'), { code: 'WPFAIL' }); return ''; } };
  const s = sandbox();
  s.mkFork('acme');
  assert.throws(() => forkTheme(base(s, { wp, refork: 'acme', zipFile: s.zipFile })), (e) => e.code === 'WPFAIL');
  assert.equal(fs.readFileSync(path.join(s.themesDir, 'acme', 'work.txt'), 'utf8'), 'mine');
  assert.deepEqual(s.backups(), []);
  const f = sandbox();
  const d = path.join(f.themesDir, 'acme');
  fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, 'style.css'), '/*\nTheme Name: Client\n*/');
  assert.throws(() => forkTheme(base(f, { wp, force: true, zipFile: f.zipFile })), (e) => e.code === 'WPFAIL');
  assert.equal(fs.readFileSync(path.join(d, 'style.css'), 'utf8'), '/*\nTheme Name: Client\n*/', 'foreign folder restored');
  assert.deepEqual(f.backups(), []);
});

test('no git init when the themes dir is already inside a git work tree', () => {
  if (realExec('git', ['--version']).code !== 0) return;
  const s = sandbox();
  spawn('git', ['init', '-q'], { cwd: s.root });
  forkTheme(base(s, { zipFile: s.zipFile, exec: realExec }));
  assert.equal(fs.existsSync(path.join(s.themesDir, 'acme', '.git')), false, 'nested repo must not be created');
  const outside = sandbox();
  forkTheme(base(outside, { zipFile: outside.zipFile, exec: realExec }));
  assert.equal(fs.existsSync(path.join(outside.themesDir, 'acme', '.git')), true, 'standalone fork gets its own repo');
});
