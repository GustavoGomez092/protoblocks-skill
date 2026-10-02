import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensurePlugins, WPORG_PLUGINS } from '../../skills/protoblocks-site-builder/scripts/lib/setup-plugins.mjs';

class FakeExec {
  constructor() {
    this.calls = [];
    this.responses = new Map();
  }

  record(argsPattern, response) {
    this.responses.set(argsPattern, response);
    return this;
  }

  exec(cmd, args, opts = {}) {
    const argsStr = args.join(' ');
    this.calls.push({ cmd, args, argsStr, opts });

    // Try exact match first
    if (this.responses.has(argsStr)) {
      const response = this.responses.get(argsStr);
      if (response instanceof Error) throw response;
      return response;
    }

    // Try pattern matching for common commands
    if (argsStr.includes('eval-file') && argsStr.includes('tailwind.php')) {
      if (argsStr.includes('enable')) {
        const response = this.responses.get('eval-file tailwind.php enable');
        if (response) {
          if (response instanceof Error) throw response;
          return response;
        }
      }
      if (argsStr.includes('status')) {
        const response = this.responses.get('eval-file tailwind.php status');
        if (response) {
          if (response instanceof Error) throw response;
          return response;
        }
      }
    }
    if (argsStr.includes('option get')) {
      const optionName = args[args.indexOf('get') + 1];
      const key = `option get ${optionName}`;
      if (this.responses.has(key)) {
        const response = this.responses.get(key);
        if (response instanceof Error) throw response;
        return response;
      }
    }

    return { code: 1, stdout: '', stderr: 'unknown command' };
  }

  assertCalled(argsPattern) {
    const found = this.calls.some((c) => c.argsStr.includes(argsPattern));
    assert.ok(found, `Expected call with "${argsPattern}", got: ${this.calls.map((c) => c.argsStr).join('; ')}`);
  }

  assertNotCalled(argsPattern) {
    const found = this.calls.some((c) => c.argsStr.includes(argsPattern));
    assert.ok(!found, `Should not call "${argsPattern}", but got: ${this.calls.map((c) => c.argsStr).join('; ')}`);
  }
}

function fakeWp(fakeExec) {
  return {
    run: (args, opts) => fakeExec.exec('wp', args, opts),
    check: (args, opts) => {
      const r = fakeExec.exec('wp', args, opts);
      if (r.code !== 0) {
        const e = new Error(`wp ${args.join(' ')} failed`);
        e.code = 'EWP';
        e.args = args;
        e.result = r;
        throw e;
      }
      return r.stdout;
    },
    evalFile: (file, args = []) => {
      const result = fakeExec.exec('wp', ['eval-file', file, ...args]);
      if (result.code !== 0) {
        const e = new Error(`wp eval-file failed`);
        e.code = 'EWP';
        throw e;
      }
      const last = result.stdout.trim().split('\n').filter(Boolean).at(-1) ?? '';
      try {
        return JSON.parse(last);
      } catch {
        throw new Error('eval-file did not return JSON');
      }
    },
  };
}

function setupCommonResponses(fake, tailwindEnabled = false) {
  // Default responses for wordpress.org plugins
  fake.record('plugin get wordpress-seo --field=status', { code: 0, stdout: 'active\n', stderr: '' });
  fake.record('plugin get wordpress-seo --field=version', { code: 0, stdout: '21.0\n', stderr: '' });
  fake.record('plugin get safe-svg --field=status', { code: 0, stdout: 'active\n', stderr: '' });
  fake.record('plugin get safe-svg --field=version', { code: 0, stdout: '2.0.0\n', stderr: '' });
  fake.record('plugin get duplicate-post --field=status', { code: 0, stdout: 'active\n', stderr: '' });
  fake.record('plugin get duplicate-post --field=version', { code: 0, stdout: '4.5.0\n', stderr: '' });

  // Default responses for options
  fake.record('option get proto_blocks_wizard_completed', { code: 0, stdout: '1\n', stderr: '' });
  fake.record('option get proto_blocks_component_style', tailwindEnabled ? { code: 0, stdout: 'tailwind\n', stderr: '' } : { code: 1, stdout: '', stderr: '' });
  fake.record('option get permalink_structure', { code: 0, stdout: '/%postname%/\n', stderr: '' });

  // Tailwind responses
  fake.record('eval-file tailwind.php status', { code: 0, stdout: JSON.stringify({ enabled: tailwindEnabled }) + '\n', stderr: '' });
  fake.record('eval-file tailwind.php enable', { code: 0, stdout: '{"enabled":true}\n', stderr: '' });
}

test('(a) Proto-Blocks missing: install from GitHub', async () => {
  const fake = new FakeExec();
  const zipUrl = 'https://github.com/GustavoGomez092/Proto-Blocks/releases/download/v3.0.0/proto-blocks.zip';

  fake.record('plugin get proto-blocks --field=status', { code: 1, stdout: '', stderr: 'not found' });
  fake.record(`plugin install ${zipUrl} --activate`, { code: 0, stdout: '', stderr: '' });
  setupCommonResponses(fake);

  const result = await ensurePlugins(fakeWp(fake), {
    fetchRelease: async () => ({ version: '3.0.0', zipUrl }),
  });

  assert.equal(result.plugins[0].slug, 'proto-blocks');
  assert.equal(result.plugins[0].action, 'installed');
  assert.equal(result.plugins[0].version, '3.0.0');
  fake.assertCalled('plugin install');
});

test('(b) Proto-Blocks installed but older: reports updateAvailable and never reinstalls', async () => {
  const fake = new FakeExec();
  const zipUrl = 'https://github.com/GustavoGomez092/Proto-Blocks/releases/download/v3.0.0/proto-blocks.zip';

  fake.record('plugin get proto-blocks --field=status', { code: 0, stdout: 'active\n', stderr: '' });
  fake.record('plugin get proto-blocks --field=version', { code: 0, stdout: '2.10.1\n', stderr: '' });
  fake.record(`plugin install ${zipUrl} --force --activate`, { code: 0, stdout: '', stderr: '' });
  setupCommonResponses(fake);

  const result = await ensurePlugins(fakeWp(fake), {
    fetchRelease: async () => ({ version: '3.0.0', zipUrl }),
  });

  assert.equal(result.plugins[0].action, 'ok');
  assert.equal(result.plugins[0].version, '2.10.1');
  assert.equal(result.plugins[0].updateAvailable, '3.0.0');
  fake.assertNotCalled('plugin install');
  fake.assertNotCalled('--force');
});

test('(c) Proto-Blocks installed current but inactive: activate', async () => {
  const fake = new FakeExec();
  const zipUrl = 'https://github.com/GustavoGomez092/Proto-Blocks/releases/download/v3.0.0/proto-blocks.zip';

  fake.record('plugin get proto-blocks --field=status', { code: 0, stdout: 'inactive\n', stderr: '' });
  fake.record('plugin get proto-blocks --field=version', { code: 0, stdout: '3.0.0\n', stderr: '' });
  fake.record('plugin activate proto-blocks', { code: 0, stdout: '', stderr: '' });
  setupCommonResponses(fake);

  const result = await ensurePlugins(fakeWp(fake), {
    fetchRelease: async () => ({ version: '3.0.0', zipUrl }),
  });

  assert.equal(result.plugins[0].action, 'activated');
  fake.assertCalled('plugin activate proto-blocks');
});

test('(d) Proto-Blocks current and active: no action', async () => {
  const fake = new FakeExec();
  const zipUrl = 'https://github.com/GustavoGomez092/Proto-Blocks/releases/download/v3.0.0/proto-blocks.zip';

  fake.record('plugin get proto-blocks --field=status', { code: 0, stdout: 'active\n', stderr: '' });
  fake.record('plugin get proto-blocks --field=version', { code: 0, stdout: '3.0.0\n', stderr: '' });
  setupCommonResponses(fake);

  const result = await ensurePlugins(fakeWp(fake), {
    fetchRelease: async () => ({ version: '3.0.0', zipUrl }),
  });

  assert.equal(result.plugins[0].action, 'ok');
  fake.assertNotCalled('plugin install');
  fake.assertNotCalled('plugin activate proto-blocks');
});

test('(e) WordPress.org plugin inactive: activate', async () => {
  const fake = new FakeExec();
  const zipUrl = 'https://github.com/GustavoGomez092/Proto-Blocks/releases/download/v3.0.0/proto-blocks.zip';

  fake.record('plugin get proto-blocks --field=status', { code: 0, stdout: 'active\n', stderr: '' });
  fake.record('plugin get proto-blocks --field=version', { code: 0, stdout: '3.0.0\n', stderr: '' });
  setupCommonResponses(fake);
  // Override wordpress-seo to be inactive
  fake.record('plugin get wordpress-seo --field=status', { code: 0, stdout: 'inactive\n', stderr: '' });
  fake.record('plugin activate wordpress-seo', { code: 0, stdout: '', stderr: '' });

  const result = await ensurePlugins(fakeWp(fake), {
    fetchRelease: async () => ({ version: '3.0.0', zipUrl }),
  });

  const seoPlugin = result.plugins.find((p) => p.slug === 'wordpress-seo');
  assert.equal(seoPlugin.action, 'activated');
  fake.assertCalled('plugin activate wordpress-seo');
});

test('(f) plugin install fails: reject with WpError', async () => {
  const fake = new FakeExec();
  const zipUrl = 'https://github.com/GustavoGomez092/Proto-Blocks/releases/download/v3.0.0/proto-blocks.zip';

  fake.record('plugin get proto-blocks --field=status', { code: 1, stdout: '', stderr: 'not found' });
  fake.record(`plugin install ${zipUrl} --activate`, { code: 1, stdout: '', stderr: 'Download failed' });

  await assert.rejects(
    () => ensurePlugins(fakeWp(fake), {
      fetchRelease: async () => ({ version: '3.0.0', zipUrl }),
    }),
    (e) => e.code === 'EWP'
  );
});

test('(g) permalink_structure already set: no rewrite call', async () => {
  const fake = new FakeExec();
  const zipUrl = 'https://github.com/GustavoGomez092/Proto-Blocks/releases/download/v3.0.0/proto-blocks.zip';

  fake.record('plugin get proto-blocks --field=status', { code: 0, stdout: 'active\n', stderr: '' });
  fake.record('plugin get proto-blocks --field=version', { code: 0, stdout: '3.0.0\n', stderr: '' });
  setupCommonResponses(fake);

  await ensurePlugins(fakeWp(fake), {
    fetchRelease: async () => ({ version: '3.0.0', zipUrl }),
  });

  fake.assertNotCalled('rewrite structure');
});

test('all current: options empty, no tailwind enable call', async () => {
  const fake = new FakeExec();
  const zipUrl = 'https://github.com/GustavoGomez092/Proto-Blocks/releases/download/v3.0.0/proto-blocks.zip';

  fake.record('plugin get proto-blocks --field=status', { code: 0, stdout: 'active\n', stderr: '' });
  fake.record('plugin get proto-blocks --field=version', { code: 0, stdout: '3.0.0\n', stderr: '' });
  setupCommonResponses(fake, true); // Tailwind already enabled

  const result = await ensurePlugins(fakeWp(fake), {
    fetchRelease: async () => ({ version: '3.0.0', zipUrl }),
  });

  assert.deepEqual(result.options, []);
  fake.assertNotCalled('eval-file tailwind.php enable');
});

test('only component_style differs: only report that option', async () => {
  const fake = new FakeExec();
  const zipUrl = 'https://github.com/GustavoGomez092/Proto-Blocks/releases/download/v3.0.0/proto-blocks.zip';

  fake.record('plugin get proto-blocks --field=status', { code: 0, stdout: 'active\n', stderr: '' });
  fake.record('plugin get proto-blocks --field=version', { code: 0, stdout: '3.0.0\n', stderr: '' });
  // Tailwind enabled, but component_style not set
  fake.record('eval-file tailwind.php status', { code: 0, stdout: '{"enabled":true}\n', stderr: '' });
  fake.record('option get proto_blocks_wizard_completed', { code: 0, stdout: '1\n', stderr: '' });
  fake.record('option get proto_blocks_component_style', { code: 1, stdout: '', stderr: '' }); // Not set
  fake.record('option get permalink_structure', { code: 0, stdout: '/%postname%/\n', stderr: '' });
  fake.record('plugin get wordpress-seo --field=status', { code: 0, stdout: 'active\n', stderr: '' });
  fake.record('plugin get wordpress-seo --field=version', { code: 0, stdout: '21.0\n', stderr: '' });
  fake.record('plugin get safe-svg --field=status', { code: 0, stdout: 'active\n', stderr: '' });
  fake.record('plugin get safe-svg --field=version', { code: 0, stdout: '2.0.0\n', stderr: '' });
  fake.record('plugin get duplicate-post --field=status', { code: 0, stdout: 'active\n', stderr: '' });
  fake.record('plugin get duplicate-post --field=version', { code: 0, stdout: '4.5.0\n', stderr: '' });
  fake.record('eval-file tailwind.php enable', { code: 0, stdout: '{"enabled":true}\n', stderr: '' });

  const result = await ensurePlugins(fakeWp(fake), {
    fetchRelease: async () => ({ version: '3.0.0', zipUrl }),
  });

  assert.deepEqual(result.options, ['proto_blocks_component_style']);
});

test('offline tolerance: installed and active with warning', async () => {
  const fake = new FakeExec();

  fake.record('plugin get proto-blocks --field=status', { code: 0, stdout: 'active\n', stderr: '' });
  fake.record('plugin get proto-blocks --field=version', { code: 0, stdout: '2.10.1\n', stderr: '' });
  setupCommonResponses(fake, true); // Tailwind already enabled

  const error = new Error('Network error');
  error.code = 'ERELEASE';

  const result = await ensurePlugins(fakeWp(fake), {
    fetchRelease: async () => { throw error; },
  });

  const pbPlugin = result.plugins.find((p) => p.slug === 'proto-blocks');
  assert.equal(pbPlugin.action, 'ok');
  assert.equal(pbPlugin.version, '2.10.1');
  assert.ok(pbPlugin.warning);
  assert.match(pbPlugin.warning, /could not check for updates/);
  assert.deepEqual(result.options, []);
});

test('offline tolerance: installed but inactive, activate and warn', async () => {
  const fake = new FakeExec();

  fake.record('plugin get proto-blocks --field=status', { code: 0, stdout: 'inactive\n', stderr: '' });
  fake.record('plugin get proto-blocks --field=version', { code: 0, stdout: '2.10.1\n', stderr: '' });
  fake.record('plugin activate proto-blocks', { code: 0, stdout: '', stderr: '' });
  setupCommonResponses(fake, true); // Tailwind already enabled

  const error = new Error('Network error');
  error.code = 'ERELEASE';

  const result = await ensurePlugins(fakeWp(fake), {
    fetchRelease: async () => { throw error; },
  });

  const pbPlugin = result.plugins.find((p) => p.slug === 'proto-blocks');
  assert.equal(pbPlugin.action, 'activated');
  assert.equal(pbPlugin.version, '2.10.1');
  assert.ok(pbPlugin.warning);
  assert.match(pbPlugin.warning, /could not check for updates/);
});

test('offline tolerance: not installed, rethrow', async () => {
  const fake = new FakeExec();

  fake.record('plugin get proto-blocks --field=status', { code: 1, stdout: '', stderr: 'not found' });

  const error = new Error('Network error');
  error.code = 'ERELEASE';

  await assert.rejects(
    () => ensurePlugins(fakeWp(fake), {
      fetchRelease: async () => { throw error; },
    }),
    (e) => e.code === 'ERELEASE'
  );
});

// ---- C1: never overwrite an installed plugin automatically ----
const ZIP = 'https://github.com/GustavoGomez092/Proto-Blocks/releases/download/v3.0.0/proto-blocks.zip';
const rel = async () => ({ version: '3.0.0', zipUrl: ZIP });
const olderInstalled = (fake, status = 'active') => {
  fake.record('plugin get proto-blocks --field=status', { code: 0, stdout: `${status}\n`, stderr: '' });
  fake.record('plugin get proto-blocks --field=version', { code: 0, stdout: '2.10.1\n', stderr: '' });
  setupCommonResponses(fake, true);
};
const pluginDir = (fake, dir) => fake.record('plugin path proto-blocks --dir', { code: 0, stdout: `${dir}\n`, stderr: '' });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pb-plugdir-'));

test('older + inactive without opt-in: activates in place, reports updateAvailable, no install', async () => {
  const fake = new FakeExec();
  olderInstalled(fake, 'inactive');
  fake.record('plugin activate proto-blocks', { code: 0, stdout: '', stderr: '' });
  const r = await ensurePlugins(fakeWp(fake), { fetchRelease: rel });
  assert.deepEqual(r.plugins[0], { slug: 'proto-blocks', action: 'activated', version: '2.10.1', updateAvailable: '3.0.0' });
  fake.assertNotCalled('plugin install');
});

test('updatePlugins opt-in on a plain plugin folder: force-installs with a long timeout', async () => {
  const fake = new FakeExec();
  olderInstalled(fake);
  const dir = tmp();
  pluginDir(fake, dir);
  fake.record(`plugin install ${ZIP} --force --activate`, { code: 0, stdout: '', stderr: '' });
  const r = await ensurePlugins(fakeWp(fake), { fetchRelease: rel, updatePlugins: true });
  assert.equal(r.plugins[0].action, 'updated');
  assert.equal(r.plugins[0].version, '3.0.0');
  const call = fake.calls.find((c) => c.argsStr.startsWith('plugin install'));
  assert.ok(call.opts?.timeout >= 600000, `timeout ${call.opts?.timeout}`);
});

test('updatePlugins opt-in refuses a symlinked plugin folder (EPLUGINDEV) and installs nothing', async () => {
  const fake = new FakeExec();
  olderInstalled(fake);
  const real = tmp();
  const link = path.join(tmp(), 'proto-blocks');
  fs.symlinkSync(real, link);
  pluginDir(fake, link);
  await assert.rejects(ensurePlugins(fakeWp(fake), { fetchRelease: rel, updatePlugins: true }), (e) => e.code === 'EPLUGINDEV' && e.message.includes(link));
  fake.assertNotCalled('plugin install');
});

test('updatePlugins opt-in refuses a plugin folder that is a git checkout (EPLUGINDEV)', async () => {
  const fake = new FakeExec();
  olderInstalled(fake);
  const dir = tmp();
  fs.mkdirSync(path.join(dir, '.git'));
  pluginDir(fake, dir);
  await assert.rejects(ensurePlugins(fakeWp(fake), { fetchRelease: rel, updatePlugins: true }), (e) => e.code === 'EPLUGINDEV');
  fake.assertNotCalled('plugin install');
});

test('updatePlugins opt-in with a current plugin does nothing', async () => {
  const fake = new FakeExec();
  fake.record('plugin get proto-blocks --field=status', { code: 0, stdout: 'active\n', stderr: '' });
  fake.record('plugin get proto-blocks --field=version', { code: 0, stdout: '3.0.0\n', stderr: '' });
  setupCommonResponses(fake, true);
  const r = await ensurePlugins(fakeWp(fake), { fetchRelease: rel, updatePlugins: true });
  assert.deepEqual(r.plugins[0], { slug: 'proto-blocks', action: 'ok', version: '3.0.0' });
  fake.assertNotCalled('plugin install');
  fake.assertNotCalled('plugin path');
});

test('fresh installs never pass --force and use a long timeout', async () => {
  const fake = new FakeExec();
  fake.record('plugin get proto-blocks --field=status', { code: 1, stdout: '', stderr: 'not found' });
  fake.record(`plugin install ${ZIP} --activate`, { code: 0, stdout: '', stderr: '' });
  setupCommonResponses(fake, true);
  fake.record('plugin get safe-svg --field=status', { code: 1, stdout: '', stderr: 'not found' });
  fake.record('plugin install safe-svg --activate', { code: 0, stdout: '', stderr: '' });
  await ensurePlugins(fakeWp(fake), { fetchRelease: rel });
  fake.assertNotCalled('--force');
  const installs = fake.calls.filter((c) => c.argsStr.startsWith('plugin install'));
  assert.equal(installs.length, 2);
  for (const c of installs) assert.ok(c.opts?.timeout >= 600000, `${c.argsStr} timeout ${c.opts?.timeout}`);
});

test('active-network counts as active: no re-activation, reported ok', async () => {
  const fake = new FakeExec();
  fake.record('plugin get proto-blocks --field=status', { code: 0, stdout: 'active-network\n', stderr: '' });
  fake.record('plugin get proto-blocks --field=version', { code: 0, stdout: '3.0.0\n', stderr: '' });
  setupCommonResponses(fake, true);
  fake.record('plugin get wordpress-seo --field=status', { code: 0, stdout: 'active-network\n', stderr: '' });
  const r = await ensurePlugins(fakeWp(fake), { fetchRelease: rel });
  assert.equal(r.plugins.find((p) => p.slug === 'proto-blocks').action, 'ok');
  assert.equal(r.plugins.find((p) => p.slug === 'wordpress-seo').action, 'ok');
  fake.assertNotCalled('plugin activate');
});

test('active-network counts as active offline too', async () => {
  const fake = new FakeExec();
  fake.record('plugin get proto-blocks --field=status', { code: 0, stdout: 'active-network\n', stderr: '' });
  fake.record('plugin get proto-blocks --field=version', { code: 0, stdout: '3.0.0\n', stderr: '' });
  setupCommonResponses(fake, true);
  const r = await ensurePlugins(fakeWp(fake), { fetchRelease: async () => { throw Object.assign(new Error('offline'), { code: 'ERELEASE' }); } });
  assert.equal(r.plugins[0].action, 'ok');
  fake.assertNotCalled('plugin activate');
});

test('plain (empty) permalinks are set to /%postname%/', async () => {
  const fake = new FakeExec();
  fake.record('plugin get proto-blocks --field=status', { code: 0, stdout: 'active\n', stderr: '' });
  fake.record('plugin get proto-blocks --field=version', { code: 0, stdout: '3.0.0\n', stderr: '' });
  setupCommonResponses(fake, true);
  fake.record('option get permalink_structure', { code: 0, stdout: '\n', stderr: '' });
  fake.record('rewrite structure /%postname%/', { code: 0, stdout: '', stderr: '' });
  const r = await ensurePlugins(fakeWp(fake), { fetchRelease: rel });
  fake.assertCalled('rewrite structure /%postname%/');
  assert.deepEqual(r.options, ['permalink_structure']);
});

test('a custom permalink structure is left alone and reported as a warning', async () => {
  const fake = new FakeExec();
  fake.record('plugin get proto-blocks --field=status', { code: 0, stdout: 'active\n', stderr: '' });
  fake.record('plugin get proto-blocks --field=version', { code: 0, stdout: '3.0.0\n', stderr: '' });
  setupCommonResponses(fake, true);
  fake.record('option get permalink_structure', { code: 0, stdout: '/blog/%year%/%postname%/\n', stderr: '' });
  const r = await ensurePlugins(fakeWp(fake), { fetchRelease: rel });
  fake.assertNotCalled('rewrite structure');
  assert.deepEqual(r.options, []);
  assert.ok(r.warnings.some((w) => w.includes('/blog/%year%/%postname%/')), JSON.stringify(r.warnings));
});
