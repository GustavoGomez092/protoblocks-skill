import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { itest, testWp, PUBLIC, restoreTheme, ORIGINAL_THEME } from './helpers.mjs';
import { forkTheme, fetchThemeZip, forkMarker } from '../../skills/protoblocks-site-builder/scripts/lib/theme-fork.mjs';

// SAFETY: creates only pb-itest-fork-<hex> (a fork) and pb-itest-foreign-<hex> (a foreign folder), restores
// the original theme in `finally`, then deletes exactly those two folders after checking they sit directly
// in the themes dir under their unique names (and that the fork carries the marker).
const themesDir = path.join(PUBLIC, 'wp-content/themes');
// Never throws: cleanup must not mask the test's original error.
const hasMarker = (d) => { try { return Boolean(forkMarker(fs.readFileSync(path.join(d, 'style.css'), 'utf8'))); } catch { return false; } };

itest('forkTheme forks, activates, reuses (even with force), and refuses foreign folders', async () => {
  const wp = testWp();
  const hex = crypto.randomBytes(4).toString('hex');
  const slug = `pb-itest-fork-${hex}`;
  const foreign = `pb-itest-foreign-${hex}`;
  const dir = path.join(themesDir, slug);
  const foreignDir = path.join(themesDir, foreign);
  const { zipFile, forkedFrom, cleanup } = await fetchThemeZip();
  let err;
  try {
    const first = forkTheme({ wp, themesDir, name: 'PB Itest', slug, zipFile, forkedFrom });
    assert.equal(first.reused, false);
    assert.equal(wp.check(['option', 'get', 'stylesheet']).trim(), slug);
    const style = fs.readFileSync(path.join(dir, 'style.css'), 'utf8');
    assert.equal(forkMarker(style), forkedFrom);
    assert.match(fs.readFileSync(path.join(dir, 'functions.php'), 'utf8'), new RegExp(`'${slug}'`));
    assert.equal(wp.check(['eval', 'echo wp_is_block_theme() ? "1" : "0";']).trim(), '1');

    fs.writeFileSync(path.join(dir, 'pb-itest-sentinel.txt'), 'keep');
    const second = forkTheme({ wp, themesDir, name: 'PB Itest', slug, force: true });
    assert.equal(second.reused, true, 'an existing fork is reused even with force and without a zip');
    assert.equal(fs.readFileSync(path.join(dir, 'pb-itest-sentinel.txt'), 'utf8'), 'keep');

    fs.mkdirSync(foreignDir);
    fs.writeFileSync(path.join(foreignDir, 'style.css'), '/*\nTheme Name: Client\n*/');
    assert.throws(() => forkTheme({ wp, themesDir, name: 'x', slug: foreign, zipFile, forkedFrom }), (e) => e.code === 'EFORKEXISTS');
    assert.equal(fs.readFileSync(path.join(foreignDir, 'style.css'), 'utf8'), '/*\nTheme Name: Client\n*/', 'foreign folder untouched');
  } catch (e) {
    err = e;
  } finally {
    cleanup();
    const problems = [];
    try { restoreTheme(wp); } catch (e) { problems.push(`restoreTheme failed: ${e.message}`); }
    const active = wp.run(['option', 'get', 'stylesheet']).stdout.trim();
    for (const [d, needMarker] of [[dir, true], [foreignDir, false]]) {
      if (!fs.existsSync(d)) continue;
      const ok = active === ORIGINAL_THEME && path.dirname(d) === themesDir && new RegExp(`^pb-itest-(fork|foreign)-${hex}$`).test(path.basename(d))
        && !fs.lstatSync(d).isSymbolicLink()
        && (!needMarker || hasMarker(d));
      if (ok) fs.rmSync(d, { recursive: true, force: true });
      else problems.push(`left in place for inspection: ${d}`);
    }
    if (problems.length) console.error(problems.join('\n'));
    if (!err && problems.length) err = new Error(problems.join('\n'));
  }
  if (err) throw err;
  assert.deepEqual(fs.readdirSync(themesDir).filter((n) => n.includes(hex)), []);
});
