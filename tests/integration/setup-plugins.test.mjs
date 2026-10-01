import assert from 'node:assert/strict';
import path from 'node:path';
import { itest, testWp } from './helpers.mjs';
import { ensurePlugins } from '../../skills/protoblocks-site-builder/scripts/lib/setup-plugins.mjs';
import { WP_SCRIPTS_DIR } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';

itest('ensurePlugins installs, configures, and is idempotent', async () => {
  const wp = testWp();
  const first = await ensurePlugins(wp);
  for (const slug of ['proto-blocks', 'wordpress-seo', 'safe-svg', 'duplicate-post']) {
    assert.equal(wp.check(['plugin', 'get', slug, '--field=status']).trim(), 'active', slug);
    assert.ok(first.plugins.find((p) => p.slug === slug), `${slug} reported`);
  }
  assert.equal(wp.check(['option', 'get', 'permalink_structure']).trim(), '/%postname%/');
  assert.equal(wp.check(['option', 'get', 'proto_blocks_wizard_completed']).trim(), '1');
  assert.equal(wp.evalFile(path.join(WP_SCRIPTS_DIR, 'tailwind.php'), ['status']).enabled, true);

  const second = await ensurePlugins(wp);
  assert.ok(second.plugins.every((p) => p.action === 'ok'), JSON.stringify(second.plugins));
  assert.deepEqual(second.options, []);
});
