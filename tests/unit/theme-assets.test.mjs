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
