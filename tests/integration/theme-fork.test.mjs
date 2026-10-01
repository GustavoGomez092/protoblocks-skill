import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { itest, testWp, PUBLIC, restoreTheme } from './helpers.mjs';
import { forkTheme, fetchThemeZip, forkMarker } from '../../skills/protoblocks-site-builder/scripts/lib/theme-fork.mjs';

const themesDir = path.join(PUBLIC, 'wp-content/themes');

itest('forkTheme forks, activates, reuses, and refuses foreign folders', async () => {
  const wp = testWp();
  const { zipFile, forkedFrom } = await fetchThemeZip();
  fs.rmSync(path.join(themesDir, 'pb-itest'), { recursive: true, force: true });
  try {
  const first = forkTheme({ wp, themesDir, name: 'PB Itest', slug: 'pb-itest', zipFile, forkedFrom });
  assert.equal(first.reused, false);
  assert.equal(wp.check(['option', 'get', 'stylesheet']).trim(), 'pb-itest');
  const style = fs.readFileSync(path.join(themesDir, 'pb-itest/style.css'), 'utf8');
  assert.equal(forkMarker(style), forkedFrom);
  assert.match(fs.readFileSync(path.join(themesDir, 'pb-itest/functions.php'), 'utf8'), /'pb-itest'/);
  assert.equal(wp.check(['eval', 'echo wp_is_block_theme() ? "1" : "0";']).trim(), '1');

  const second = forkTheme({ wp, themesDir, name: 'PB Itest', slug: 'pb-itest', zipFile, forkedFrom });
  assert.equal(second.reused, true);

  fs.mkdirSync(path.join(themesDir, 'pb-foreign'), { recursive: true });
  fs.writeFileSync(path.join(themesDir, 'pb-foreign/style.css'), '/*\nTheme Name: Client\n*/');
  assert.throws(() => forkTheme({ wp, themesDir, name: 'x', slug: 'pb-foreign', zipFile, forkedFrom }), (e) => e.code === 'EFORKEXISTS');
  assert.ok(fs.existsSync(path.join(themesDir, 'pb-foreign/style.css')), 'foreign folder untouched');
  fs.rmSync(path.join(themesDir, 'pb-foreign'), { recursive: true, force: true });
  } finally { restoreTheme(wp); }
});
