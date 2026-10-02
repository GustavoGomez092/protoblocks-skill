import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { nextAction, summarize, ACTIONS, assertAction, setupGaps } from '../../skills/protoblocks-site-builder/scripts/lib/status.mjs';
import { initState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';

const SCRIPT = new URL('../../skills/protoblocks-site-builder/scripts/lib/status.mjs', import.meta.url).pathname;
// A finished setup: tokens, menus and the header part are recorded.
const SETUP = { tokens: {}, navigation: { menus: { primary: { id: 1 } } }, parts: { header: { writtenAt: 'x' } } };
const base = (pages) => ({ schemaVersion: 1, site: { url: 'http://a.local', path: '/x', theme: { slug: 'acme' }, ...SETUP }, library: {}, pages });
const sec = (n, status, extra = {}) => ({ n, anchor: `pb-s${n}`, status, ...extra });

test('no state → setup', () => assert.equal(nextAction(null).action, 'setup'));

test('planning without approval → breakdown; with approval → build-page', () => {
  assert.equal(nextAction(base([{ slug: 'home', status: 'planning', sections: [] }])).action, 'breakdown');
  assert.equal(nextAction(base([{ slug: 'home', status: 'planning', plan: { approvedAt: 'x' }, sections: [sec(1, 'planned')] }])).action, 'build-page');
});

test('section sub-phases resume from status', () => {
  const p = (s) => base([{ slug: 'home', status: 'building', plan: { approvedAt: 'x' }, sections: [sec(1, 'done'), sec(2, s), sec(3, 'planned')] }]);
  assert.deepEqual([nextAction(p('planned')).action, nextAction(p('planned')).section], ['section-build', 2]);
  assert.equal(nextAction(p('building')).action, 'section-build');
  assert.equal(nextAction(p('verifying')).action, 'section-verify');
  assert.equal(nextAction(p('animating')).action, 'section-animate');
});

test('skipped sections do not block page QA; page QA pass → seo', () => {
  const pg = { slug: 'home', status: 'building', plan: { approvedAt: 'x' }, sections: [sec(1, 'done'), sec(2, 'skipped')] };
  assert.equal(nextAction(base([pg])).action, 'page-qa');
  assert.equal(nextAction(base([{ ...pg, status: 'seo', pageQa: { pass: true } }])).action, 'seo');
});

test('multi-page: next page breakdown, then ask-more-pages', () => {
  const done = { slug: 'home', status: 'done', plan: { approvedAt: 'x' }, sections: [sec(1, 'done')] };
  assert.deepEqual([nextAction(base([done, { slug: 'about', status: 'planning', sections: [] }])).action, nextAction(base([done, { slug: 'about', status: 'planning', sections: [] }])).page], ['breakdown', 'about']);
  assert.equal(nextAction(base([done])).action, 'ask-more-pages');
});

test('summarize lists sections with iteration counts and last pass', () => {
  const s = base([{ slug: 'home', status: 'building', plan: { approvedAt: 'x' }, sections: [sec(1, 'building', { label: 'Hero', block: 'hero', qa: [{ iteration: 1, pass: false }, { iteration: 2, pass: false }] })] }]);
  const sum = summarize(s);
  assert.deepEqual(sum.pages[0].sections[0], { n: 1, label: 'Hero', block: 'hero', status: 'building', iterations: 2, lastPass: false });
  assert.equal(sum.next.action, 'section-build');
});

test('each action carries page, section and why where applicable', () => {
  const bp = nextAction(base([{ slug: 'home', status: 'planning', plan: { approvedAt: 'x' }, sections: [sec(1, 'planned')] }]));
  assert.deepEqual([bp.action, bp.page, typeof bp.why], ['build-page', 'home', 'string']);
  const sv = nextAction(base([{ slug: 'home', status: 'building', sections: [sec(1, 'verifying')] }]));
  assert.deepEqual([sv.action, sv.page, sv.section], ['section-verify', 'home', 1]);
  const sa = nextAction(base([{ slug: 'home', status: 'building', sections: [sec(1, 'animating')] }]));
  assert.deepEqual([sa.action, sa.page, sa.section], ['section-animate', 'home', 1]);
  const qa = nextAction(base([{ slug: 'home', status: 'building', sections: [sec(1, 'done')] }]));
  assert.deepEqual([qa.action, qa.page], ['page-qa', 'home']);
});

test('sections out of order by n: lowest open n is chosen', () => {
  const pg = { slug: 'home', status: 'building', plan: { approvedAt: 'x' }, sections: [sec(3, 'planned'), sec(1, 'done'), sec(2, 'verifying')] };
  const r = nextAction(base([pg]));
  assert.deepEqual([r.action, r.section], ['section-verify', 2]);
  assert.deepEqual(summarize(base([pg])).pages[0].sections.map((s) => s.n), [1, 2, 3]);
});

test('seo page with a reopened section goes back to that section before seo; planned does not count', () => {
  const pg = (s2) => ({ slug: 'home', status: 'seo', sections: [sec(1, 'done'), sec(2, s2)] });
  for (const [st, action] of [['building', 'section-build'], ['verifying', 'section-verify'], ['animating', 'section-animate']]) {
    const r = nextAction(base([pg(st)]));
    assert.deepEqual([r.action, r.page, r.section], [action, 'home', 2]);
    assert.match(r.why, /reopened/);
  }
  assert.equal(nextAction(base([pg('planned')])).action, 'seo');
  assert.equal(nextAction(base([pg('skipped')])).action, 'seo');
});

test('a done page with a reopened section is resumed before the next page', () => {
  const home = { slug: 'home', status: 'done', sections: [sec(1, 'done'), sec(2, 'verifying')] };
  const about = { slug: 'about', status: 'planning', sections: [] };
  assert.deepEqual([nextAction(base([home, about])).action, nextAction(base([home, about])).page], ['section-verify', 'home']);
  assert.equal(nextAction(base([{ ...home, sections: [sec(1, 'done')] }])).action, 'ask-more-pages');
});

test('page QA not passed with all sections closed stays page-qa; pass flag false does not skip', () => {
  const pg = { slug: 'home', status: 'building', sections: [sec(1, 'done')], pageQa: { pass: false } };
  assert.equal(nextAction(base([pg])).action, 'page-qa');
  assert.equal(nextAction(base([{ ...pg, pageQa: { pass: true } }])).action, 'seo');
});

test('empty pages array → ask-more-pages', () => {
  const r = nextAction(base([]));
  assert.equal(r.action, 'ask-more-pages');
  assert.equal(r.page, undefined);
});

test('summarize: no qa entries gives 0 iterations and null lastPass; last pass true', () => {
  const s = base([{ slug: 'home', status: 'building', sections: [sec(1, 'planned'), sec(2, 'done', { qa: [{ iteration: 1, pass: false }, { iteration: 1, pass: false }, { iteration: 2, pass: true }] })] }]);
  const [a, b] = summarize(s).pages[0].sections;
  assert.deepEqual([a.iterations, a.lastPass, a.label, a.block], [0, null, null, null]);
  assert.deepEqual([b.iterations, b.lastPass], [2, true]);
  assert.deepEqual(summarize(s).site, { url: 'http://a.local', theme: 'acme' });
});

test('CLI: missing state file prints setup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-'));
  const r = spawnSync('node', [SCRIPT, dir], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).next.action, 'setup');
});

test('CLI: existing state prints summary; no arg exits 64', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-'));
  initState(dir, { url: 'http://a.local', path: '/x', theme: { slug: 'acme' }, ...SETUP });
  const r = spawnSync('node', [SCRIPT, dir], { encoding: 'utf8' });
  const out = JSON.parse(r.stdout);
  assert.deepEqual([out.site.theme, out.next.action], ['acme', 'ask-more-pages']);
  assert.equal(spawnSync('node', [SCRIPT], { encoding: 'utf8' }).status, 64);
});

test('building page with zero sections → breakdown', () => {
  const r = nextAction(base([{ slug: 'home', status: 'building', plan: { approvedAt: 'x' }, sections: [] }]));
  assert.deepEqual(r, { action: 'breakdown', page: 'home', why: 'building page has no sections' });
});

test('planning page with approved plan but zero sections → breakdown', () => {
  const r = nextAction(base([{ slug: 'home', status: 'planning', plan: { approvedAt: 'x' }, sections: [] }]));
  assert.deepEqual(r, { action: 'breakdown', page: 'home', why: 'approved plan has no sections' });
});

test('summarize ignores null / iteration-less qa entries', () => {
  const s = base([{ slug: 'home', status: 'building', sections: [sec(1, 'building', { qa: [null, { iteration: 1, pass: false }, {}, { iteration: 2, pass: true }, null] })] }]);
  const [x] = summarize(s).pages[0].sections;
  assert.deepEqual([x.iterations, x.lastPass], [2, true]);
});

test('nextAction and summarize do not mutate their input', () => {
  const s = base([{ slug: 'home', status: 'building', plan: { approvedAt: 'x' }, sections: [sec(3, 'planned'), sec(1, 'done', { qa: [{ iteration: 1, pass: true }] })] }]);
  const before = structuredClone(s);
  nextAction(s); summarize(s);
  assert.deepEqual(s, before);
});

test('CLI: nonexistent themeDir exits 1 with ENOTHEME', () => {
  const r = spawnSync('node', [SCRIPT, '/nonexistent/theme-dir-xyz'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^\[ENOTHEME\] \/nonexistent\/theme-dir-xyz is not a directory/);
});

test('CLI: corrupt build.json exits 1 with EPARSE', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-'));
  fs.mkdirSync(path.join(dir, '.protoblocks'));
  fs.writeFileSync(path.join(dir, '.protoblocks', 'build.json'), '{not json');
  const r = spawnSync('node', [SCRIPT, dir], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^\[EPARSE\]/);
});

// The orchestrator docs cannot drift from the state machine: ACTIONS is exactly what nextAction returns, and every
// action has its own row in the SKILL.md action table and its own section in references/pipeline.md.
test('ACTIONS lists exactly the actions nextAction returns', () => {
  const pg = (status, sections, extra = {}) => ({ slug: 'home', status, sections, ...extra });
  const states = [
    null,
    base([]),
    base([pg('planning', [])]),
    base([pg('planning', [sec(1, 'planned')], { plan: { approvedAt: 'x' } })]),
    ...['planned', 'building', 'verifying', 'animating'].map((st) => base([pg('building', [sec(1, st)], { plan: { approvedAt: 'x' } })])),
    base([pg('building', [sec(1, 'done')], { plan: { approvedAt: 'x' } })]),
    base([pg('seo', [sec(1, 'done')], { pageQa: { pass: true } })]),
    base([pg('building', [sec(1, 'done', { anchor: 'pb-header' })], { plan: { approvedAt: 'x' } })]),
  ];
  assert.deepEqual([...new Set(states.map((s) => nextAction(s).action))].sort(), [...ACTIONS].sort());
  assert.ok(Object.isFrozen(ACTIONS));
});

test('every action has a row in the orchestrator SKILL.md action table and a pipeline.md section', () => {
  const dir = new URL('../../skills/protoblocks-site-builder/', import.meta.url).pathname;
  const skill = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  const table = skill.split(/^## Actions$/m)[1]?.split(/^## /m)[0] ?? '';
  const firstCells = table.split('\n').filter((l) => l.startsWith('| `')).map((l) => l.split('|')[1]);
  const rowActions = firstCells.flatMap((c) => [...c.matchAll(/`([a-z-]+)`/g)].map((m) => m[1]));
  for (const a of ACTIONS) assert.ok(rowActions.includes(a), `SKILL.md "## Actions" table has no row for \`${a}\``);
  for (const a of rowActions) assert.ok(ACTIONS.includes(a), `SKILL.md action table row \`${a}\` is not an action nextAction returns`);
  const pipeline = fs.readFileSync(path.join(dir, 'references', 'pipeline.md'), 'utf8');
  for (const a of ACTIONS) assert.match(pipeline, new RegExp(`^### \`${a}\``, 'm'), `pipeline.md has no "### \`${a}\`" section`);
});

test('setup is incomplete until tokens, menus and the header part are recorded', () => {
  const pages = [{ slug: 'home', status: 'planning', sections: [] }];
  const without = (key) => { const st = base(pages); delete st.site[key]; return st; };
  for (const [key, re] of [['tokens', /site\.tokens/], ['navigation', /site\.navigation\.menus/], ['parts', /site\.parts\.header/]]) {
    const r = nextAction(without(key));
    assert.equal(r.action, 'setup', key);
    assert.match(r.why, re);
  }
  const noMenus = base(pages); noMenus.site.navigation = {};
  assert.equal(nextAction(noMenus).action, 'setup');
  const footerOnly = base(pages); footerOnly.site.parts = { footer: { writtenAt: 'x' } };
  assert.equal(nextAction(footerOnly).action, 'setup');
  assert.deepEqual(setupGaps(base(pages)), []);
  assert.equal(nextAction(base(pages)).action, 'breakdown');
});

test('move-parts: the first page header/footer passed as sections and are not in the parts yet', () => {
  const home = (extra = {}) => ({ slug: 'home', status: 'building', plan: { approvedAt: 'x' }, sections: [sec(1, 'done', { anchor: 'pb-header', ...extra }), sec(2, 'done'), sec(3, 'done', { anchor: 'pb-footer', ...extra })] });
  const r = nextAction(base([home()]));
  assert.deepEqual([r.action, r.page, r.sections], ['move-parts', 'home', [1, 3]]);
  assert.match(r.why, /#pb-header, #pb-footer/);
  assert.equal(nextAction(base([home({ inPart: true })])).action, 'page-qa', 'already in the parts');
  // An open section comes first.
  const open = home(); open.sections[1].status = 'verifying';
  assert.equal(nextAction(base([open])).action, 'section-verify');
  // A later page whose header another page already moved into the part is not asked to move it again.
  const other = { slug: 'about', status: 'done', sections: [sec(1, 'done', { anchor: 'pb-header', inPart: true })] };
  const later = { slug: 'later', status: 'building', sections: [sec(1, 'done', { anchor: 'pb-header' }), sec(2, 'done')] };
  assert.equal(nextAction(base([other, later])).action, 'page-qa');
  // Skipped header: nothing to move.
  assert.equal(nextAction(base([{ ...home(), sections: [sec(1, 'skipped', { anchor: 'pb-header' }), sec(2, 'done')] }])).action, 'page-qa');
});

test('a design without navigation: menus {} with navigation.none true completes setup; {} alone does not', () => {
  const pages = [{ slug: 'home', status: 'planning', sections: [] }];
  const nav = (navigation) => { const st = base(pages); st.site.navigation = navigation; return st; };
  assert.deepEqual(setupGaps(nav({ menus: {}, none: true })), []);
  assert.equal(nextAction(nav({ menus: {}, none: true })).action, 'breakdown');
  for (const n of [{ menus: {} }, { menus: {}, none: 'yes' }, { none: false, menus: {} }]) {
    assert.match(setupGaps(nav(n)).join(), /site\.navigation\.menus/, JSON.stringify(n));
  }
  assert.match(nextAction(nav({ menus: {} })).why, /navigation\.none: true/, 'the why names the explicit no-navigation record');
});

test('setup: the header counts as present when a page has its pb-header section in the part (builds from before site.parts)', () => {
  const st = base([{ slug: 'home', status: 'done', sections: [sec(1, 'done', { anchor: 'pb-header', inPart: true }), sec(2, 'done')] }]);
  delete st.site.parts;
  assert.deepEqual(setupGaps(st), []);
  const notMoved = structuredClone(st); notMoved.pages[0].sections[0].inPart = false;
  assert.match(setupGaps(notMoved).join(), /site\.parts\.header/);
});

test('the why on an seo/done page says whether page QA passed or was accepted', () => {
  const pg = (status, pageQa) => base([{ slug: 'home', status, sections: [sec(1, 'done')], pageQa }]);
  assert.equal(nextAction(pg('seo', { pass: true })).why, 'page QA passed');
  assert.equal(nextAction(pg('seo', { pass: false, accepted: true, note: 'n' })).why, 'page QA differences accepted by the developer');
});

test('page QA accepted by the developer counts as passed; a fail without acceptance does not', () => {
  const pg = (pageQa) => base([{ slug: 'home', status: 'building', sections: [sec(1, 'done')], pageQa }]);
  const r = nextAction(pg({ pass: false, accepted: true, note: 'n' }));
  assert.deepEqual([r.action, r.why], ['seo', 'page QA differences accepted by the developer']);
  assert.equal(nextAction(pg({ pass: false })).action, 'page-qa');
});

test('assertAction rejects an action that is not in ACTIONS (EACTION)', () => {
  assert.throws(() => assertAction({ action: 'deploy' }), (e) => e.code === 'EACTION');
  assert.throws(() => assertAction(undefined), (e) => e.code === 'EACTION');
  assert.deepEqual(assertAction({ action: 'seo' }), { action: 'seo' });
});

test('CLI --root finds the theme with a build state: none, one, several; bad usage exits 64', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'status-root-'));
  const themes = path.join(root, 'wp-content', 'themes');
  fs.mkdirSync(path.join(themes, 'twentytwentyfive'), { recursive: true });
  const run = (...a) => spawnSync('node', [SCRIPT, ...a], { encoding: 'utf8' });
  let r = run('--root', root);
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { themeDir: null, next: { action: 'setup', why: 'no build state yet' } });
  initState(path.join(themes, 'acme'), { url: 'http://a.local', path: root, theme: { slug: 'acme' }, ...SETUP });
  r = run('--root', root);
  const one = JSON.parse(r.stdout);
  assert.deepEqual([one.themeDir, one.site.theme, one.next.action], [path.join(themes, 'acme'), 'acme', 'ask-more-pages']);
  initState(path.join(themes, 'beta'), { url: 'http://a.local', path: root });
  const many = JSON.parse(run('--root', root).stdout);
  assert.equal(many.next, null);
  assert.deepEqual(many.themes.map((t) => path.basename(t.themeDir)), ['acme', 'beta']);
  assert.match(many.why, /ask the developer which one/);
  assert.equal(run('--root').status, 64);
  assert.equal(run('--rooot', root).status, 64);
  assert.equal(run(root, 'extra').status, 64);
  r = run('--root', path.join(root, 'nope'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^\[ENOTHEME\]/);
});

test('docs: site-setup records a design without navigation in a way status accepts, and the header part holds the header block alone', () => {
  const doc = fs.readFileSync(new URL('../../skills/protoblocks-site-setup/SKILL.md', import.meta.url), 'utf8');
  const m = doc.match(/<!-- test:run -->\n```bash\nnode "\$PB\/lib\/state\.mjs" set "\$THEME" site\.navigation '(\{[^']*\})'\n```/);
  assert.ok(m, 'Step 3 has the runnable no-navigation recipe');
  const st = base([]);
  st.site.navigation = JSON.parse(m[1]);
  assert.deepEqual(setupGaps(st), []);
  assert.match(doc, /no navigation/i);
  assert.match(doc, /node "\$PB\/lib\/parts\.mjs" markup site-header` without `--nav-ref`/);
});
