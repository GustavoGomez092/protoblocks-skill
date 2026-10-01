import assert from 'node:assert/strict';
import { test } from 'node:test';
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
    this.calls.push({ cmd, args, argsStr });

    // Try exact match first
    if (this.responses.has(argsStr)) {
      const response = this.responses.get(argsStr);
      if (response instanceof Error) throw response;
      return response;
    }

    // Try pattern matching for common commands
    if (argsStr.includes('eval-file') && argsStr.includes('tailwind.php enable')) {
      const response = this.responses.get('eval-file tailwind.php enable');
      if (response) {
        if (response instanceof Error) throw response;
        return response;
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

function setupCommonResponses(fake) {
  // Default responses for wordpress.org plugins
  fake.record('plugin get wordpress-seo --field=status', { code: 0, stdout: 'active\n', stderr: '' });
  fake.record('plugin get wordpress-seo --field=version', { code: 0, stdout: '21.0\n', stderr: '' });
  fake.record('plugin get safe-svg --field=status', { code: 0, stdout: 'active\n', stderr: '' });
  fake.record('plugin get safe-svg --field=version', { code: 0, stdout: '2.0.0\n', stderr: '' });
  fake.record('plugin get duplicate-post --field=status', { code: 0, stdout: 'active\n', stderr: '' });
  fake.record('plugin get duplicate-post --field=version', { code: 0, stdout: '4.5.0\n', stderr: '' });

  // Default responses for options
  fake.record('option get proto_blocks_wizard_completed', { code: 0, stdout: '1\n', stderr: '' });
  fake.record('option get proto_blocks_component_style', { code: 1, stdout: '', stderr: '' });
  fake.record('option get permalink_structure', { code: 0, stdout: '/%postname%/\n', stderr: '' });

  // Tailwind enable response
  fake.record('eval-file tailwind.php enable', { code: 0, stdout: '{"enabled":true}\n', stderr: '' });
}

test('(a) Proto-Blocks missing: install from GitHub', async () => {
  const fake = new FakeExec();
  const zipUrl = 'https://github.com/GustavoGomez092/Proto-Blocks/releases/download/v3.0.0/proto-blocks.zip';

  fake.record('plugin get proto-blocks --field=status', { code: 1, stdout: '', stderr: 'not found' });
  fake.record(`plugin install ${zipUrl} --force --activate`, { code: 0, stdout: '', stderr: '' });
  setupCommonResponses(fake);

  const result = await ensurePlugins(fakeWp(fake), {
    fetchRelease: async () => ({ version: '3.0.0', zipUrl }),
  });

  assert.equal(result.plugins[0].slug, 'proto-blocks');
  assert.equal(result.plugins[0].action, 'installed');
  assert.equal(result.plugins[0].version, '3.0.0');
  fake.assertCalled('plugin install');
});

test('(b) Proto-Blocks installed but older: update', async () => {
  const fake = new FakeExec();
  const zipUrl = 'https://github.com/GustavoGomez092/Proto-Blocks/releases/download/v3.0.0/proto-blocks.zip';

  fake.record('plugin get proto-blocks --field=status', { code: 0, stdout: 'active\n', stderr: '' });
  fake.record('plugin get proto-blocks --field=version', { code: 0, stdout: '2.10.1\n', stderr: '' });
  fake.record(`plugin install ${zipUrl} --force --activate`, { code: 0, stdout: '', stderr: '' });
  setupCommonResponses(fake);

  const result = await ensurePlugins(fakeWp(fake), {
    fetchRelease: async () => ({ version: '3.0.0', zipUrl }),
  });

  assert.equal(result.plugins[0].action, 'updated');
  fake.assertCalled('plugin install');
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
  fake.record(`plugin install ${zipUrl} --force --activate`, { code: 1, stdout: '', stderr: 'Download failed' });

  try {
    await ensurePlugins(fakeWp(fake), {
      fetchRelease: async () => ({ version: '3.0.0', zipUrl }),
    });
    assert.fail('should reject');
  } catch (e) {
    assert.equal(e.code, 'EWP');
  }
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

test('offline tolerance: if fetchRelease fails and proto-blocks installed, activate and warn', async () => {
  const fake = new FakeExec();

  fake.record('plugin get proto-blocks --field=status', { code: 0, stdout: 'inactive\n', stderr: '' });
  fake.record('plugin get proto-blocks --field=version', { code: 0, stdout: '2.10.1\n', stderr: '' });
  fake.record('plugin activate proto-blocks', { code: 0, stdout: '', stderr: '' });
  setupCommonResponses(fake);

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

test('offline tolerance: if fetchRelease fails and proto-blocks not installed, rethrow', async () => {
  const fake = new FakeExec();

  fake.record('plugin get proto-blocks --field=status', { code: 1, stdout: '', stderr: 'not found' });

  const error = new Error('Network error');
  error.code = 'ERELEASE';

  try {
    await ensurePlugins(fakeWp(fake), {
      fetchRelease: async () => { throw error; },
    });
    assert.fail('should rethrow ERELEASE');
  } catch (e) {
    assert.equal(e.code, 'ERELEASE');
  }
});
