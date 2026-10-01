import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureManagedBlock, installThemeAssets, MANAGED_START } from '../../skills/protoblocks-site-builder/scripts/lib/theme-assets.mjs';

test('ensureManagedBlock appends once and normalizes on repeat', () => {
  const once = ensureManagedBlock("<?php\nrequire 'x.php';\n");
  assert.equal(once.split(MANAGED_START).length - 1, 1);
  assert.equal(ensureManagedBlock(once), once);
  const tampered = once.replace("glob(", "glob_TAMPERED(");
  assert.equal(ensureManagedBlock(tampered), once);
  assert.match(once, /require_once \$pb_file;/);
});

test('installThemeAssets copies pb-* files only and updates functions.php', () => {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-theme-'));
  const assets = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-assets-'));
  fs.writeFileSync(path.join(theme, 'functions.php'), '<?php\n');
  fs.mkdirSync(path.join(assets, 'inc'), { recursive: true });
  fs.mkdirSync(path.join(assets, 'assets/js'), { recursive: true });
  fs.writeFileSync(path.join(assets, 'inc/pb-assets.php'), '<?php // a');
  fs.writeFileSync(path.join(assets, 'assets/js/pb-motion.js'), '// m');
  fs.writeFileSync(path.join(assets, 'assets/js/README.md'), 'no');
  const r = installThemeAssets(theme, assets);
  assert.deepEqual(r.copied.sort(), ['assets/js/pb-motion.js', 'inc/pb-assets.php']);
  assert.equal(r.functionsUpdated, true);
  assert.ok(!fs.existsSync(path.join(theme, 'assets/js/README.md')));
  assert.equal(installThemeAssets(theme, assets).functionsUpdated, false);
});

import { MANAGED_END } from '../../skills/protoblocks-site-builder/scripts/lib/theme-assets.mjs';

const BROKEN = /broken protoblocks managed block.*nothing was changed/;

function fixture(functionsSrc) {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-theme-'));
  const assets = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-assets-'));
  if (functionsSrc !== null) fs.writeFileSync(path.join(theme, 'functions.php'), functionsSrc);
  fs.mkdirSync(path.join(assets, 'inc'), { recursive: true });
  fs.writeFileSync(path.join(assets, 'inc/pb-assets.php'), '<?php // a');
  return { theme, assets };
}

test('ensureManagedBlock throws EMANAGEDBLOCK when start has no end', () => {
  const src = `<?php\n${MANAGED_START}\nmy_code();\n`;
  assert.throws(() => ensureManagedBlock(src), (e) => e.code === 'EMANAGEDBLOCK' && BROKEN.test(e.message));
});

test('ensureManagedBlock throws EMANAGEDBLOCK when end precedes start', () => {
  const src = `<?php\n${MANAGED_END}\nmine();\n${MANAGED_START}\nmore();\n`;
  assert.throws(() => ensureManagedBlock(src), (e) => e.code === 'EMANAGEDBLOCK');
});

test('installThemeAssets on a broken block changes nothing', () => {
  const src = `<?php\n${MANAGED_START}\nmy_code();\n`;
  const { theme, assets } = fixture(src);
  assert.throws(() => installThemeAssets(theme, assets), (e) => e.code === 'EMANAGEDBLOCK');
  assert.equal(fs.readFileSync(path.join(theme, 'functions.php'), 'utf8'), src);
  assert.ok(!fs.existsSync(path.join(theme, 'inc')));
});

test('ensureManagedBlock inserts before a closing ?> and stays idempotent', () => {
  const once = ensureManagedBlock("<?php\nfoo();\n?>\n");
  assert.ok(once.indexOf(MANAGED_END) < once.lastIndexOf('?>'));
  assert.match(once.trimEnd(), /\?>$/);
  assert.equal(once.split('?>').length - 1, 1);
  assert.equal(ensureManagedBlock(once), once);
});

test('installThemeAssets without functions.php throws ENOFUNCTIONS and copies nothing', () => {
  const { theme, assets } = fixture(null);
  assert.throws(() => installThemeAssets(theme, assets), (e) => e.code === 'ENOFUNCTIONS');
  assert.ok(!fs.existsSync(path.join(theme, 'inc')));
});
