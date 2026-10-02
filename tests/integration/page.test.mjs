import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { itest, testWp, SITE_URL, useItestTheme, restoreTheme } from './helpers.mjs';
import { createWp, WP_SCRIPTS_DIR } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';
import { buildPage } from '../../skills/protoblocks-site-builder/scripts/lib/page.mjs';
import { initState, updateState, loadState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'blocks');
const PAGE_PHP = path.join(WP_SCRIPTS_DIR, 'page.php');

// Safety: this file only ever deletes post ids it created itself (collected in `created`), in finally, never by
// query, name or pattern. All slugs are unique per run.
const run = crypto.randomBytes(4).toString('hex');
const pageSlug = (n) => `pb-itest-page-${run}-${n}`;
const foreignSlug = (n) => `pb-itest-foreign-${run}-${n}`;
const cleanup = (wp, created) => { if (created.length) wp.run(['post', 'delete', ...created.map(String), '--force']); };

function newTheme(pages) {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-pagestate-'));
  initState(theme, { url: SITE_URL, path: '/x' });
  updateState(theme, (s) => { s.pages.push(...pages); });
  return theme;
}
const statePage = (slug, sections = [{ n: 1, anchor: 'pb-s1', block: 'pb-gate-ok', attrs: { heading: 'One' }, status: 'building' }], extra = {}) =>
  ({ slug, title: 'Itest', status: 'planning', postId: null, contentHash: null, sections, ...extra });
const mkForeign = (wp, created, slug, { type = 'page', status = 'publish', content = '<p>client original</p>' } = {}) => {
  const id = Number(wp.check(['post', 'create', `--post_type=${type}`, `--post_status=${status}`, `--post_name=${slug}`, '--post_title=Client page', `--post_content=${content}`, '--porcelain']).trim());
  created.push(id);
  return id;
};
const content = (wp, id) => wp.check(['post', 'get', String(id), '--field=post_content']).replace(/\n$/, '');
const php = (wp, cmd, spec) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-pagephp-'));
  const file = path.join(dir, 'spec.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  try { return wp.evalFile(PAGE_PHP, [cmd, file]); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};
const blk = { name: 'proto-blocks/pb-gate-ok', attrs: { anchor: 'pb-s1' } };
const good = (slug) => ({ postId: null, slug, title: 'T', expectedHash: null, force: false, blocks: [blk] });

itest('buildPage creates, rebuilds idempotently, guards hand edits, and force saves a backup', async () => {
  const wp = testWp();
  const created = [];
  const themeDirWp = await useItestTheme(wp);
  try {
    fs.cpSync(path.join(FIX, 'pb-gate-ok'), path.join(themeDirWp, 'proto-blocks', 'pb-gate-ok'), { recursive: true });
    const slug = pageSlug(1);
    const theme = newTheme([statePage(slug)]);

    const a = buildPage(wp, theme, slug);
    created.push(a.postId);
    assert.equal(a.created, true);
    assert.equal(a.slug, slug);
    assert.equal(a.backupRevisionId, null);
    assert.equal(a.backupFile, null);
    const html = wp.check(['eval', `echo apply_filters('the_content', get_post_field('post_content', ${a.postId}));`]);
    assert.match(html, /id="pb-s1"/);
    assert.equal(wp.check(['post', 'meta', 'get', String(a.postId), '_pb_built']).trim(), '1');
    assert.equal(loadState(theme).pages[0].status, 'building');

    const b = buildPage(wp, theme, slug);
    assert.equal(b.created, false);
    assert.equal(b.postId, a.postId);
    assert.equal(b.backupFile, null, 'rebuilding the builder\'s own content needs no file backup');

    const hand = '<!-- wp:paragraph --><p>hand edit</p><!-- /wp:paragraph -->';
    wp.check(['post', 'update', String(a.postId), `--post_content=${hand}`]);
    assert.throws(() => buildPage(wp, theme, slug), (e) => e.code === 'EEDITED' && /--force/.test(e.message) && e.message.includes('backups'));
    assert.equal(content(wp, a.postId), hand, 'guard must not touch the post');
    assert.equal(fs.existsSync(path.join(theme, '.protoblocks', 'artifacts', 'backups')), false);

    const f = buildPage(wp, theme, slug, { force: true });
    assert.equal(f.postId, a.postId);
    assert.ok(f.backupFile && fs.existsSync(f.backupFile));
    assert.equal(fs.readFileSync(f.backupFile, 'utf8'), hand);
    assert.match(content(wp, a.postId), /pb-gate-ok/);
    if (f.backupRevisionId !== null) assert.equal(content(wp, f.backupRevisionId), hand);
  } finally {
    cleanup(wp, created);
    restoreTheme(wp);
  }
});

itest('foreign and non-page posts: ESLUGTAKEN, EFOREIGN, ENOTPAGE; force overwrites recoverably', async () => {
  const wp = testWp();
  const created = [];
  try {
    // publish, draft and private foreign pages are all treated as foreign
    for (const [i, status] of ['publish', 'draft', 'private'].entries()) {
      const slug = foreignSlug(`s${i}`);
      const id = mkForeign(wp, created, slug, { status });
      const theme = newTheme([statePage(slug, [])]);
      assert.throws(() => buildPage(wp, theme, slug), (e) => e.code === 'ESLUGTAKEN' && /--force/.test(e.message), status);
      assert.equal(content(wp, id), '<p>client original</p>');
    }

    // force on a foreign page: overwritten, original saved to a file
    const slugF = foreignSlug('force');
    const idF = mkForeign(wp, created, slugF);
    const themeF = newTheme([statePage(slugF)]);
    const r = buildPage(wp, themeF, slugF, { force: true });
    assert.equal(r.postId, idF);
    assert.equal(fs.readFileSync(r.backupFile, 'utf8'), '<p>client original</p>');
    assert.match(content(wp, idF), /pb-gate-ok/);
    assert.equal(wp.check(['post', 'meta', 'get', String(idF), '_pb_built']).trim(), '1');

    // stale/hand-edited state points at someone else's page: EFOREIGN, never silently overwritten
    const slugE = foreignSlug('byid');
    const idE = mkForeign(wp, created, slugE);
    const themeE = newTheme([statePage(slugE, undefined, { postId: idE, contentHash: 'stale' })]);
    assert.throws(() => buildPage(wp, themeE, slugE), (e) => e.code === 'EFOREIGN' && /--force/.test(e.message));
    assert.equal(content(wp, idE), '<p>client original</p>');

    // a post that is not a page: ENOTPAGE even with force
    const slugN = foreignSlug('post');
    const idN = mkForeign(wp, created, slugN, { type: 'post' });
    const themeN = newTheme([statePage(slugN, undefined, { postId: idN })]);
    assert.throws(() => buildPage(wp, themeN, slugN), (e) => e.code === 'ENOTPAGE');
    assert.throws(() => buildPage(wp, themeN, slugN, { force: true }), (e) => e.code === 'ENOTPAGE');
    assert.equal(content(wp, idN), '<p>client original</p>');
  } finally {
    cleanup(wp, created);
  }
});

itest('trashed pages are never reused or overwritten', async () => {
  const wp = testWp();
  const created = [];
  try {
    const slug = pageSlug('trash');
    const theme = newTheme([statePage(slug)]);
    const a = buildPage(wp, theme, slug);
    created.push(a.postId);
    wp.check(['post', 'delete', String(a.postId)]); // moves to trash
    assert.equal(wp.check(['post', 'get', String(a.postId), '--field=post_status']).trim(), 'trash');
    const trashedContent = content(wp, a.postId);

    // state still points at the trashed id
    const b = buildPage(wp, theme, slug);
    created.push(b.postId);
    assert.equal(b.created, true);
    assert.notEqual(b.postId, a.postId);
    assert.equal(content(wp, a.postId), trashedContent);
    assert.equal(wp.check(['post', 'get', String(a.postId), '--field=post_status']).trim(), 'trash');
    assert.equal(b.backupFile, null);

    // state lost its postId: slug lookup must not resurrect the trashed page either
    wp.check(['post', 'delete', String(b.postId)]);
    updateState(theme, (s) => { s.pages[0].postId = null; s.pages[0].contentHash = null; });
    const c = buildPage(wp, theme, slug);
    created.push(c.postId);
    assert.equal(c.created, true);
    assert.ok(![a.postId, b.postId].includes(c.postId));
    assert.equal(wp.check(['post', 'get', String(c.postId), '--field=post_status']).trim(), 'publish');
  } finally {
    cleanup(wp, created);
  }
});

itest('page.php validates the spec (EINPUT) and warns about dropped freeform HTML', async () => {
  const wp = testWp();
  const created = [];
  try {
    const slug = pageSlug('input');
    const bad = {
      'block name without namespace': { ...good(slug), blocks: [{ name: 'nocolon', attrs: {} }] },
      'block name with uppercase/space': { ...good(slug), blocks: [{ name: 'proto-blocks/Bad Name', attrs: {} }] },
      'attrs a list': { ...good(slug), blocks: [{ ...blk, attrs: [1, 2] }] },
      'attrs a string': { ...good(slug), blocks: [{ ...blk, attrs: 'x' }] },
      'innerRaw not a string': { ...good(slug), blocks: [{ ...blk, innerRaw: 5 }] },
      'blocks not a list': { ...good(slug), blocks: { a: blk } },
      'slug not sanitized (space)': { ...good(slug), slug: 'Bad Slug' },
      'slug not sanitized (slash)': { ...good(slug), slug: 'a/b' },
      'slug empty': { ...good(slug), slug: '' },
    };
    for (const [why, spec] of Object.entries(bad)) {
      for (const cmd of ['plan', 'write']) {
        const out = php(wp, cmd, spec);
        assert.equal(out.error?.code, 'EINPUT', `${cmd}: ${why} -> ${JSON.stringify(out)}`);
      }
    }
    assert.equal(wp.check(['post', 'list', '--post_type=page', `--name=${slug}`, '--post_status=any', '--format=ids']).trim(), '');

    const w = php(wp, 'write', { ...good(slug), blocks: [{ ...blk, innerRaw: '<p>loose</p><!-- wp:paragraph --><p>kept</p><!-- /wp:paragraph -->' }] });
    created.push(w.postId);
    assert.equal(w.ok, true);
    assert.ok(w.warnings.some((x) => /pb-s1/.test(x) && /freeform|non-block/i.test(x)), JSON.stringify(w.warnings));
    const stored = content(wp, w.postId);
    assert.match(stored, /kept/);
    assert.doesNotMatch(stored, /loose/);

    // clean innerRaw (blocks only, whitespace between) is not a warning
    const w2 = php(wp, 'write', { ...good(slug), postId: w.postId, expectedHash: w.contentHash, blocks: [{ ...blk, innerRaw: '<!-- wp:paragraph --><p>a</p><!-- /wp:paragraph -->\n\n<!-- wp:paragraph --><p>b</p><!-- /wp:paragraph -->' }] });
    assert.equal(w2.ok, true);
    assert.deepEqual(w2.warnings, []);
  } finally {
    cleanup(wp, created);
  }
});
