import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { initState, updateState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';
import { markupFromArgs, partMarkup, writePart, removeOverride, listOverrides } from '../../skills/protoblocks-site-builder/scripts/lib/parts.mjs';
import { createWp } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';

test('partMarkup wraps core/navigation inside the proto-block', () => {
  assert.equal(
    partMarkup({ block: 'proto-blocks/site-header', attrs: { sticky: true }, navRef: 12 }),
    '<!-- wp:proto-blocks/site-header {"sticky":true} -->\n<!-- wp:navigation {"ref":12} /-->\n<!-- /wp:proto-blocks/site-header -->\n',
  );
  assert.equal(partMarkup({ block: 'proto-blocks/site-footer' }), '<!-- wp:proto-blocks/site-footer /-->\n');
});

test('partMarkup requires navRef to be a positive integer when given', () => {
  for (const bad of ['12', 0, -3, 1.5, null, NaN]) {
    assert.throws(() => partMarkup({ block: 'proto-blocks/site-footer', navRef: bad }), /navRef/, String(bad));
  }
});

test('writePart writes parts/<slug>.html and rejects bad slugs', () => {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-parts-'));
  fs.writeFileSync(path.join(theme, 'style.css'), '/*\nProto Fork: proto-blocks-theme@1.1.3\n*/');
  const p = writePart(theme, 'header', 'X');
  assert.equal(fs.readFileSync(p, 'utf8'), 'X');
  assert.equal(p, path.join(theme, 'parts/header.html'));
  assert.throws(() => writePart(theme, '../evil', 'X'), /Invalid part slug/);
  assert.throws(() => writePart(theme, 'a/b', 'X'), /Invalid part slug/);
  assert.throws(() => writePart(theme, 'Header', 'X'), /Invalid part slug/);
  for (const bad of ['a--b', '-a', 'a-', '']) assert.throws(() => writePart(theme, bad, 'X'), /Invalid part slug/, bad);
  assert.deepEqual(fs.readdirSync(path.join(theme, 'parts')), ['header.html']);
});

const ROW = { id: 5, slug: 'header', theme: 'pb-itest', modified: '2025-01-01 00:00:00' };
const fakeWp = (rows = [ROW]) => {
  const calls = [];
  return { calls, evalFile: (file, args) => { calls.push(args); return args[0] === 'remove-override' ? { removed: rows.map((r) => r.id), records: rows } : rows; } };
};

test('removeOverride refuses without confirm and previews the exact rows', () => {
  const wp = fakeWp();
  assert.throws(() => removeOverride(wp, 'pb-itest', 'header', {}), (e) => e.code === 'ECONFIRM' && /Site Editor/.test(e.message) && e.message.includes('"id":5') && JSON.stringify(e.rows) === JSON.stringify([ROW]));
  assert.throws(() => removeOverride(wp, 'pb-itest', 'header'), (e) => e.code === 'ECONFIRM');
  assert.ok(wp.calls.length > 0 && wp.calls.every((a) => a[0] === 'preview'), 'only preview calls');
});

test('removeOverride requires confirm === true exactly', () => {
  for (const c of ['true', 1, 'yes', {}]) {
    const wp = fakeWp();
    assert.throws(() => removeOverride(wp, 'pb-itest', 'header', { confirm: c, expectId: 5 }), (e) => e.code === 'ECONFIRM');
    assert.ok(wp.calls.every((a) => a[0] === 'preview'));
  }
});

test('removeOverride with confirm passes theme, slug and an explicit confirm arg, returns records', () => {
  const wp = fakeWp();
  const r = removeOverride(wp, 'pb-itest', 'header', { confirm: true, expectId: 5 });
  assert.deepEqual(wp.calls.at(-1), ['remove-override', 'pb-itest', 'header', 'confirm', '5']);
  assert.deepEqual(r, { removed: [5], records: [ROW], recovery: ["wp eval 'wp_untrash_post(5);' && wp post update 5 --post_status=publish"] });
});

test('removeOverride rejects invalid slugs before any WP call', () => {
  for (const slug of ['Header', '../header', '--confirm', ' header', 'a/b', '', 'a--b', '-a', 'a-']) {
    const wp = { evalFile: () => { throw new Error('must not be called'); } };
    assert.throws(() => removeOverride(wp, 'pb-itest', slug, { confirm: true, expectId: 5 }), (e) => e.code === 'ESLUG', JSON.stringify(slug));
  }
});

test('removeOverride/listOverrides reject invalid theme slugs before any WP call', () => {
  for (const theme of ['', '../x', '.hidden', 'a b', undefined]) {
    const wp = { evalFile: () => { throw new Error('must not be called'); } };
    assert.throws(() => removeOverride(wp, theme, 'header', { confirm: true }), (e) => e.code === 'ETHEME');
    assert.throws(() => listOverrides(wp, theme), (e) => e.code === 'ETHEME');
  }
});

test('listOverrides passes the theme to parts.php', () => {
  const wp = fakeWp();
  assert.deepEqual(listOverrides(wp, 'pb-itest'), [ROW]);
  assert.deepEqual(wp.calls[0], ['overrides', 'pb-itest']);
});

test('removeOverride refuses more than one match (EAMBIGUOUS) and never removes', () => {
  const wp = fakeWp([ROW, { ...ROW, id: 6 }]);
  assert.throws(() => removeOverride(wp, 'pb-itest', 'header', { confirm: true, expectId: 5 }), (e) => e.code === 'EAMBIGUOUS' && /5/.test(e.message) && /6/.test(e.message));
  assert.ok(wp.calls.every((a) => a[0] === 'preview'));
});

test('removeOverride refuses rows that belong to another theme', () => {
  const wp = fakeWp([{ ...ROW, theme: 'twentytwentyfive' }]);
  assert.throws(() => removeOverride(wp, 'pb-itest', 'header', { confirm: true, expectId: 5 }), (e) => e.code === 'ETHEMEMISMATCH');
  assert.ok(wp.calls.every((a) => a[0] === 'preview'));
});

test('ECONFIRM text carries ids, the --id flag and the untrash recovery command', () => {
  const wp = fakeWp();
  assert.throws(() => removeOverride(wp, 'pb-itest', 'header', {}), (e) => e.code === 'ECONFIRM' && /--confirm --id 5/.test(e.message) && /wp_untrash_post\(5\);' && wp post update 5 --post_status=publish/.test(e.message));
});

test('confirm without expectId is refused (preview only)', () => {
  const wp = fakeWp();
  for (const id of [undefined, 0, -1, '5', 1.5, NaN]) {
    assert.throws(() => removeOverride(wp, 'pb-itest', 'header', { confirm: true, expectId: id }), (e) => e.code === 'ECONFIRM', String(id));
  }
  assert.ok(wp.calls.every((a) => a[0] === 'preview'));
});

test('expectId that differs from the previewed row is ESTALE and removes nothing', () => {
  const wp = fakeWp();
  assert.throws(() => removeOverride(wp, 'pb-itest', 'header', { confirm: true, expectId: 6 }), (e) => e.code === 'ESTALE' && /wp-admin|preview/i.test(e.message));
  assert.ok(wp.calls.every((a) => a[0] === 'preview'));
});

test('no matching override: nothing to confirm or remove', () => {
  const wp = fakeWp([]);
  assert.deepEqual(removeOverride(wp, 'pb-itest', 'header', { confirm: true, expectId: 5 }), { removed: [], records: [], recovery: [] });
  assert.ok(wp.calls.every((a) => a[0] === 'preview'));
});

// --- real createWp with a fake exec: PHP failure codes and row themes ---
const rt = { wp: 'wp', mode: 'native', publicPath: '/x' };
const execReturning = (results) => { const calls = []; return { calls, exec: (cmd, args) => { calls.push(args); return results.shift(); } }; };
const ok = (v) => ({ code: 0, stdout: `${JSON.stringify(v)}\n`, stderr: '' });

test('PHP [CODE] and CODE: stderr tokens surface as e.code', () => {
  for (const [stderr, code] of [
    ['[EAMBIGUOUS] More than one match: IDs 1, 2\n', 'EAMBIGUOUS'],
    ['[ETHEMEMISMATCH] nope\n', 'ETHEMEMISMATCH'],
    ['[ESLUG] bad\n', 'ESLUG'],
    ['[ENOTRASH] Trash is disabled\n', 'ENOTRASH'],
    ['ESTALE: changed\n', 'ESTALE'],
    ['Warning: x\n[ESTALE] changed\n', 'ESTALE'],
  ]) {
    const { exec } = execReturning([{ code: 1, stdout: '', stderr }]);
    const wp = createWp(rt, { exec });
    assert.throws(() => listOverrides(wp, 'pb-itest'), (e) => e.code === code && !/^\[/.test(e.message) && e.message.length > 0, stderr);
  }
});

test('other failures keep the EWP code', () => {
  const { exec } = execReturning([{ code: 1, stdout: '', stderr: 'PHP Fatal error: boom' }]);
  assert.throws(() => listOverrides(createWp(rt, { exec }), 'pb-itest'), (e) => e.code === 'EWP');
});

test('a PHP code from the remove step surfaces too (ENOTRASH)', () => {
  const { exec, calls } = execReturning([ok([ROW]), { code: 1, stdout: '', stderr: '[ENOTRASH] Trash is disabled; use Site Editor -> Clear customizations\n' }]);
  assert.throws(() => removeOverride(createWp(rt, { exec }), 'pb-itest', 'header', { confirm: true, expectId: 5 }), (e) => e.code === 'ENOTRASH' && /Clear customizations/.test(e.message));
  assert.equal(calls.length, 2);
});

test('JS refuses a row whose theme (from real terms) differs, via real createWp', () => {
  const { exec, calls } = execReturning([ok([{ ...ROW, theme: 'twentytwentyfive' }])]);
  assert.throws(() => removeOverride(createWp(rt, { exec }), 'pb-itest', 'header', { confirm: true, expectId: 5 }), (e) => e.code === 'ETHEMEMISMATCH');
  assert.equal(calls.length, 1, 'only the preview ran');
  const two = execReturning([ok([{ ...ROW, theme: 'pb-itest,twentytwentyfive' }])]);
  assert.throws(() => removeOverride(createWp(rt, { exec: two.exec }), 'pb-itest', 'header', { confirm: true, expectId: 5 }), (e) => e.code === 'ETHEMEMISMATCH');
});

test('recovery commands use the preflight WP-CLI path, shell-quoted', async () => {
  const { recoveryCommand, wpShellCommand } = await import('../../skills/protoblocks-site-builder/scripts/lib/parts.mjs');
  const wrapper = wpShellCommand({ wp: '/Users/me/Local Sites/acme/app/public/wp-content/.protoblocks/wp', mode: 'local-wrapper', publicPath: '/p' });
  assert.equal(wrapper, "'/Users/me/Local Sites/acme/app/public/wp-content/.protoblocks/wp'");
  assert.equal(wpShellCommand({ wp: 'wp', mode: 'native', publicPath: "/s/it's" }), "wp --path='/s/it'\\''s'");
  assert.equal(recoveryCommand(7, wrapper), `${wrapper} eval 'wp_untrash_post(7);' && ${wrapper} post update 7 --post_status=publish`);
  const wp = fakeWp();
  assert.throws(() => removeOverride(wp, 'pb-itest', 'header', { wpCmd: wrapper }), (e) => e.code === 'ECONFIRM' && e.message.includes(`${wrapper} eval 'wp_untrash_post(5);'`));
  assert.deepEqual(removeOverride(fakeWp(), 'pb-itest', 'header', { confirm: true, expectId: 5, wpCmd: wrapper }).recovery, [recoveryCommand(5, wrapper)]);
});

test('parts CLI prints usage and exits 64 on missing or unknown arguments', async () => {
  const { spawnSync } = await import('node:child_process');
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../skills/protoblocks-site-builder/scripts/lib/parts.mjs');
  for (const args of [[], ['__pbx__', '/tmp'], ['write', '/tmp'], ['remove-override', '/tmp']]) {
    const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 64, args.join(' '));
    assert.match(r.stderr, /Usage: node parts\.mjs/);
  }
});

test('markupFromArgs builds part markup, namespacing bare block slugs and keeping the anchor attr', () => {
  assert.equal(
    markupFromArgs(['site-header', '--attrs', '{"anchor":"pb-s1","sticky":true}', '--nav-ref', '15']),
    '<!-- wp:proto-blocks/site-header {"anchor":"pb-s1","sticky":true} -->\n<!-- wp:navigation {"ref":15} /-->\n<!-- /wp:proto-blocks/site-header -->\n',
  );
  assert.equal(markupFromArgs(['acme/x']), '<!-- wp:acme/x /-->\n');
});

test('markupFromArgs validates its inputs', () => {
  const code = (args) => { try { markupFromArgs(args); } catch (e) { return e.code; } return null; };
  assert.equal(code(['site-header', '--attrs', '{nope']), 'EINPUT');
  assert.equal(code(['site-header', '--attrs', '[1]']), 'EINPUT');
  assert.equal(code(['Bad Block']), 'EINPUT');
  for (const bad of ['0', '-2', '1.5', 'abc', '']) assert.equal(code(['site-header', '--nav-ref', bad]), 'ENAVREF', bad);
  assert.equal(code([]), 'EUSAGE');
  assert.equal(code(['site-header', '--bogus', '1']), 'EUSAGE');
  assert.equal(code(['site-header', '--attrs']), 'EUSAGE');
});

test('parts.mjs markup runs as a CLI without a WordPress runtime', () => {
  const script = path.resolve('skills/protoblocks-site-builder/scripts/lib/parts.mjs');
  const run = (...a) => spawnSync(process.execPath, [script, 'markup', ...a], { encoding: 'utf8', cwd: os.tmpdir() });
  const ok = run('site-footer', '--attrs', '{"anchor":"pb-s9"}', '--nav-ref', '3');
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /wp:proto-blocks\/site-footer \{"anchor":"pb-s9"\}/);
  assert.match(ok.stdout, /wp:navigation \{"ref":3\}/);
  const badJson = run('site-footer', '--attrs', '{x');
  assert.equal(badJson.status, 1);
  assert.match(badJson.stderr, /\[EINPUT\]/);
  assert.match(run('site-footer', '--nav-ref', 'x').stderr, /\[ENAVREF\]/);
  assert.equal(run().status, 64);
  assert.equal(run('site-footer', '--wat').status, 64);
});

function stateTheme() {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-markup-'));
  initState(t, { url: 'http://a.local', path: '/x' });
  updateState(t, (s) => {
    s.pages.push({ slug: 'other', status: 'building', sections: [{ n: 1, anchor: 'pb-s1', status: 'done', block: 'cta' }] });
    s.pages.push({ slug: 'home', status: 'building', sections: [
      { n: 2, anchor: 'pb-s2', status: 'building', block: 'hero' },
      { n: 1, anchor: 'pb-header', status: 'done', block: 'site-header', attrs: { sticky: true, cta: 'Book "now" -- <b>' }, inner: ['<!-- wp:navigation {"ref":15} /-->'] },
      { n: 3, anchor: 'pb-s3', status: 'planned' },
    ] });
  });
  return t;
}

test('markup --from-state reads block, attrs, anchor and inner from state (page by slug, section by n)', () => {
  const t = stateTheme();
  const out = markupFromArgs([t, '--from-state', 'home', '1']);
  assert.equal(out, markupFromArgs(['site-header', '--attrs', JSON.stringify({ sticky: true, cta: 'Book "now" -- <b>', anchor: 'pb-header' }), '--nav-ref', '15']));
  const script = path.resolve('skills/protoblocks-site-builder/scripts/lib/parts.mjs');
  const cli = spawnSync(process.execPath, [script, 'markup', t, '--from-state', 'home', '1'], { encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(cli.stdout, out);
});

test('markup --from-state errors: unknown page/section, no block yet, mixing with --attrs', () => {
  const t = stateTheme();
  const code = (args) => { try { markupFromArgs(args); } catch (e) { return e.code; } return null; };
  assert.equal(code([t, '--from-state', 'nope', '1']), 'ENOPAGE');
  assert.equal(code([t, '--from-state', 'home', '9']), 'ENOSECTION');
  assert.equal(code([t, '--from-state', 'home', '3']), 'EINPUT');
  assert.equal(code([t, '--from-state', 'home', 'x']), 'EINPUT');
  assert.equal(code([t, '--from-state', 'home']), 'EUSAGE');
  assert.equal(code([t, '--from-state', 'home', '1', '--attrs', '{}']), 'EUSAGE');
});
