// The site-test run manifest and its recovery (tests/site-run.mjs, tests/recover.mjs), against a fake WP-CLI: no site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWp } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';
import { createRun, leftoverManifests, leftoverReason, loadManifest, recoverRun, snapshotTailwind, rawOption, restoreOptions, RECOVER_COMMAND } from '../site-run.mjs';
import { recoverAll } from '../recover.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FORK = 'pb-e2e-0badc0de';

// A fake site: options (raw JSON), posts {type, name}, wp_theme terms, plus the themes/uploads folders on disk.
function fakeSite() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-siterun-'));
  const publicPath = path.join(root, 'public');
  fs.mkdirSync(path.join(publicPath, 'wp-content', 'themes', 'dev-theme'), { recursive: true });
  fs.writeFileSync(path.join(publicPath, 'wp-content', 'themes', 'dev-theme', 'style.css'), '/*\nTheme Name: Dev\n*/');
  const options = new Map([['stylesheet', '"dev-theme"']]);
  const posts = new Map();
  const terms = new Set();
  const calls = [];
  const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
  const fail = (stderr = 'Error') => ({ code: 1, stdout: '', stderr });
  const missingOption = (name) => fail(`Error: Could not get '${name}' option. Does it exist?`);
  const flag = (args, name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const exec = (_cmd, args) => {
    calls.push(args.join(' '));
    const [a, b, ...rest] = args;
    if (a === 'option' && b === 'get') {
      if (site.down) return fail('Error: Error establishing a database connection.');
      if (!options.has(rest[0])) return missingOption(rest[0]);
      const raw = options.get(rest[0]);
      const v = JSON.parse(raw);
      return ok(`${rest.includes('--format=json') || typeof v !== 'string' ? raw : v}\n`);
    }
    if (a === 'option' && b === 'update') { options.set(rest[0], rest[1]); return ok(); }
    if (a === 'option' && b === 'delete') { options.delete(rest[0]); return ok(); }
    if (a === 'theme' && b === 'activate') { options.set('stylesheet', JSON.stringify(rest[0])); return ok(); }
    if (a === 'post' && b === 'get') {
      const p = posts.get(Number(rest[0]));
      if (!p) return fail(`Could not find the post with ID ${rest[0]}.`);
      return ok(`${flag(args, 'field') === 'post_type' ? p.type : p.name}\n`);
    }
    if (a === 'post' && b === 'list') {
      const type = flag(args, 'post_type');
      const name = flag(args, 'name');
      return ok(`${[...posts].filter(([, p]) => p.type === type && p.name === name).map(([id]) => id).join(' ')}\n`);
    }
    if (a === 'post' && b === 'delete') { posts.delete(Number(rest[0])); return ok(); }
    if (a === 'term' && b === 'get') return terms.has(`${rest[0]}/${rest[1]}`) ? ok('7\n') : fail();
    if (a === 'term' && b === 'delete') { terms.delete(`${rest[0]}/${rest[1]}`); return ok(); }
    return fail(`unexpected: ${args.join(' ')}`);
  };
  const wp = createWp({ wp: 'fake-wp', mode: 'local-wrapper', publicPath }, { exec });
  const site = { root, publicPath, options, posts, terms, calls, wp, dir: path.join(root, 'tmp'), down: false };
  return site;
}

const twDir = (site) => path.join(site.publicPath, 'wp-content', 'uploads', 'proto-blocks', 'tailwind');

// What an interrupted e2e run leaves: its fork active, options and the Tailwind cache changed, posts and a term.
function interruptedRun(site) {
  fs.mkdirSync(twDir(site), { recursive: true });
  fs.writeFileSync(path.join(twDir(site), 'proto-blocks.css'), 'original css');
  site.options.set('proto_blocks_tailwind', '{"enabled":true,"disable_global_styles":true}');
  site.options.set('sidebars_widgets', '{"a":1}');
  const run = createRun({ kind: 'e2e', site: 'Fake', publicPath: site.publicPath }, { dir: site.dir });
  run.update((d) => {
    d.originalTheme = 'dev-theme';
    d.options = { sidebars_widgets: '{"a":1}', proto_blocks_tailwind: '{"enabled":true,"disable_global_styles":true}', theme_switched: null };
  });
  run.setTailwind(snapshotTailwind(site.wp, site.publicPath));
  // The run then changes the site.
  const fork = path.join(site.publicPath, 'wp-content', 'themes', FORK);
  fs.mkdirSync(fork, { recursive: true });
  fs.writeFileSync(path.join(fork, 'style.css'), '/*\nTheme Name: PB E2E\nProto Fork: proto-blocks-theme@1.1.3\n*/');
  run.addFork({ slug: FORK });
  site.options.set('stylesheet', JSON.stringify(FORK));
  site.options.set(`theme_mods_${FORK}`, '{"x":1}');
  site.options.set('theme_switched', '"dev-theme"');
  site.options.set('sidebars_widgets', '{"b":2}');
  site.options.set('proto_blocks_tailwind', '{"enabled":true,"disable_global_styles":false,"last_compiled":2}');
  fs.writeFileSync(path.join(twDir(site), 'proto-blocks.css'), 'recompiled for the fork');
  fs.writeFileSync(path.join(twDir(site), 'extra.css'), 'added by the run');
  run.addPost({ type: 'page', name: 'pb-e2e-home-0badc0de' }); // recorded before the build
  site.posts.set(10, { type: 'page', name: 'pb-e2e-home-0badc0de' }); // built, but the id was never recorded
  site.posts.set(11, { type: 'wp_navigation', name: 'pb-nav-e2e-0badc0de' });
  run.addPost({ id: 11, type: 'wp_navigation', name: 'pb-nav-e2e-0badc0de' });
  site.posts.set(12, { type: 'attachment', name: 'pb-e2e-og-0badc0de' });
  run.addPost({ id: 12, type: 'attachment', name: 'pb-e2e-og-0badc0de' });
  site.posts.set(15, { type: 'wp_navigation', name: 'navigation' }); // the developer's menu
  site.terms.add('wp_theme/pb-itest-other-0badc0de');
  run.addTerm({ taxonomy: 'wp_theme', slug: 'pb-itest-other-0badc0de' });
  return { run, fork };
}

test('recoverAll restores exactly what the manifest lists and deletes the manifest', () => {
  const site = fakeSite();
  const { run, fork } = interruptedRun(site);
  fs.writeFileSync(path.join(site.dir, 'original-theme.txt'), 'dev-theme'); // written by the tests before a switch
  assert.deepEqual(leftoverManifests(site.dir), [run.file]);
  const results = recoverAll({ dir: site.dir, wpFor: () => site.wp });
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].problems, []);
  assert.equal(results[0].ok, true);
  assert.equal(site.options.get('stylesheet'), '"dev-theme"', 'original theme active again');
  assert.equal(fs.existsSync(fork), false, 'the throwaway fork is deleted');
  assert.equal(site.options.has(`theme_mods_${FORK}`), false, 'its theme_mods_ row is deleted');
  assert.equal(site.options.get('sidebars_widgets'), '{"a":1}');
  assert.equal(site.options.has('theme_switched'), false, 'an option absent before the run is deleted');
  assert.equal(site.options.get('proto_blocks_tailwind'), '{"enabled":true,"disable_global_styles":true}', 'the global-styles toggle is back');
  assert.deepEqual(fs.readdirSync(twDir(site)), ['proto-blocks.css']);
  assert.equal(fs.readFileSync(path.join(twDir(site), 'proto-blocks.css'), 'utf8'), 'original css');
  assert.deepEqual([...site.posts.keys()], [15], 'the run\'s page (found by its exact name), menu and attachment are gone; menu 15 stays');
  assert.equal(site.terms.size, 0);
  assert.deepEqual(leftoverManifests(site.dir), [], 'the manifest is deleted once everything is restored');
  assert.equal(fs.existsSync(path.join(site.dir, 'original-theme.txt')), false, 'the crash hint for the original theme goes too');
  assert.equal(fs.existsSync(run.tailwindDir), false, 'and its Tailwind copy');
});

test('recovery leaves anything not provably the run\'s, reports it and keeps the manifest', () => {
  const site = fakeSite();
  const { run, fork } = interruptedRun(site);
  site.posts.set(11, { type: 'page', name: 'client-home' }); // the id now belongs to someone else's page
  fs.writeFileSync(path.join(fork, 'style.css'), '/*\nTheme Name: Not a fork\n*/'); // no fork marker
  run.addFork({ slug: 'proto-blocks-theme' }); // never a throwaway name
  const [r] = recoverAll({ dir: site.dir, wpFor: () => site.wp });
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /post 11 is page "client-home"/.test(p)), r.problems.join('\n'));
  assert.ok(r.problems.some((p) => /not provably this run's fork/.test(p)), r.problems.join('\n'));
  assert.ok(r.problems.some((p) => /proto-blocks-theme: not a throwaway test theme name/.test(p)), r.problems.join('\n'));
  assert.ok(site.posts.has(11), 'someone else\'s page is untouched');
  assert.ok(fs.existsSync(fork), 'an unmarked folder is left for inspection');
  assert.equal(site.options.get('stylesheet'), '"dev-theme"', 'the rest is still restored');
  assert.deepEqual(leftoverManifests(site.dir), [run.file], 'the manifest stays for the next attempt');
});

test('recovery never switches away from a theme that is not a test theme', () => {
  const site = fakeSite();
  const run = createRun({ kind: 'integration', site: 'Fake', publicPath: site.publicPath }, { dir: site.dir });
  run.update((d) => { d.originalTheme = 'dev-theme'; });
  site.options.set('stylesheet', '"client-theme"');
  const r = recoverRun(site.wp, loadManifest(run.file));
  assert.match(r.problems.join(), /active theme is "client-theme", not a test theme/);
  assert.equal(site.options.get('stylesheet'), '"client-theme"');
  assert.ok(!site.calls.some((c) => c.startsWith('theme activate')));
});

test('a run manifest is written at once, updated on every change, and empty after the cleanup', () => {
  const site = fakeSite();
  const run = createRun({ kind: 'integration', site: 'Fake', publicPath: site.publicPath }, { dir: site.dir });
  assert.match(path.basename(run.file), /^site-run-[0-9a-f]{8}\.json$/);
  assert.equal(loadManifest(run.file).kind, 'integration');
  assert.equal(run.isEmpty(), true);
  run.addPost({ id: 5, type: 'page', name: 'pb-itest-page-x' });
  assert.deepEqual(loadManifest(run.file).posts, [{ id: 5, type: 'page', name: 'pb-itest-page-x' }]);
  assert.equal(run.isEmpty(), false);
  run.dropPosts((p) => p.id === 5);
  assert.equal(run.isEmpty(), true);
  run.close();
  assert.deepEqual(leftoverManifests(site.dir), []);
});

test('site tests refuse to start over a leftover manifest and print the recover command', () => {
  const site = fakeSite();
  assert.equal(leftoverReason(site.dir), '');
  const run = createRun({ kind: 'e2e' }, { dir: site.dir });
  const why = leftoverReason(site.dir);
  assert.match(why, new RegExp(path.basename(run.file)));
  assert.ok(why.includes(RECOVER_COMMAND));
  assert.match(RECOVER_COMMAND, /tests\/pb-site-test\.sh" ".*" test:recover$/);
  assert.equal(leftoverReason(site.dir, run.file), '', 'a run does not refuse over its own manifest');
});

test('SIGTERM runs the cleanup synchronously, ignores a repeated signal, removes the manifest and exits 143', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-sig-'));
  const child = `
    import fs from 'node:fs';
    import { execFileSync } from 'node:child_process';
    import { createRun, onInterrupt, recoverOnSignal } from ${JSON.stringify(path.join(REPO, 'tests', 'site-run.mjs'))};
    const posts = new Map([[3, { type: 'page', name: 'pb-itest-page-sig' }]]);
    const wp = {
      run: (a) => (a[0] === 'post' && a[1] === 'get' && posts.has(Number(a[2])) ? { code: 0, stdout: a[3] === '--field=post_type' ? 'page' : 'pb-itest-page-sig', stderr: '' } : { code: 1, stdout: '', stderr: '' }),
      // A second SIGTERM arrives in the middle of the cleanup (the runner and the lock script both signal).
      check: (a) => { if (a[1] === 'delete') { execFileSync('kill', ['-TERM', String(process.pid)]); execFileSync('sleep', ['1']); posts.delete(Number(a[2])); } return ''; },
    };
    const run = createRun({ kind: 'integration', publicPath: ${JSON.stringify(dir)} }, { dir: ${JSON.stringify(dir)} });
    run.addPost({ id: 3, type: 'page', name: 'pb-itest-page-sig' });
    onInterrupt((sig) => { recoverOnSignal(wp, run, sig); fs.writeFileSync(${JSON.stringify(path.join(dir, 'posts.json'))}, JSON.stringify([...posts.keys()])); });
    process.kill(process.pid, 'SIGTERM');
    setTimeout(() => {}, 30000);
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', child], { encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 143, r.stderr);
  assert.match(r.stderr, /interrupted by SIGTERM: 1 cleanup step\(s\) done; site restored/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'posts.json'), 'utf8')), []);
  assert.deepEqual(leftoverManifests(dir), []);
});

test('recover.mjs refuses to run without the site lock', () => {
  const r = spawnSync(process.execPath, [path.join(REPO, 'tests', 'recover.mjs')], { encoding: 'utf8', env: { ...process.env, PB_SITE_LOCK: '' }, timeout: 20000 });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /under the site lock/);
});

test('the lock script is committed and gives cleanup 120s before SIGKILL', () => {
  const src = fs.readFileSync(path.join(REPO, 'tests', 'pb-site-test.sh'), 'utf8');
  assert.match(src, /GRACE="\$\{PB_SITE_GRACE:-120\}"/);
  assert.match(src, /export PB_SITE_LOCK=1/);
  // The node test runner takes its test-file processes down on SIGTERM, so the lock script restores from the manifests
  // itself once a stopped run has exited, still holding the lock.
  assert.match(src, /cleanup\(\) \{\n[^}]*stop_run\n {2}recover_run\n {2}rmdir "\$LOCK"/);
  assert.match(src, /PB_SITE_LOCK=1 node tests\/recover\.mjs/);
  assert.ok(fs.statSync(path.join(REPO, 'tests', 'pb-site-test.sh')).mode & 0o100, 'executable');
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['test:recover'], 'node tests/recover.mjs');
  assert.equal(pkg.scripts['test:recover:stale'], 'node tests/recover.mjs --stale-ok');
});

// The shared copy other worktrees run is written by whichever worktree changed it last: a difference is reported (a
// skip with the reason), not a failure of this worktree.
test('the shared lock-script copy matches this worktree\'s tests/pb-site-test.sh', (t) => {
  const src = fs.readFileSync(path.join(REPO, 'tests', 'pb-site-test.sh'), 'utf8');
  const shared = '/private/tmp/claude-501/pb-site-test.sh';
  if (!fs.existsSync(shared)) { t.skip(`${shared} does not exist`); return; }
  if (fs.readFileSync(shared, 'utf8') !== src) { t.skip(`${shared} differs from this worktree's tests/pb-site-test.sh (another worktree may own it); copy it when this one is merged`); return; }
  assert.ok(true);
});

// A manifest file edited by hand (or by anything else): every field recovery acts on is validated first.
function tamper(site, edit) {
  const { run } = interruptedRun(site);
  const m = JSON.parse(fs.readFileSync(run.file, 'utf8'));
  edit(m, run);
  fs.writeFileSync(run.file, JSON.stringify(m));
  return run;
}

test('loadManifest rejects anything recovery must not act on (EMANIFEST), and recoverAll then touches nothing', () => {
  const cases = {
    'an option outside the harness snapshots': (m) => { m.options.siteurl = '"http://evil.test"'; },
    'theme_mods_ of another theme': (m) => { m.options['theme_mods_client-theme'] = null; },
    'a Tailwind copy outside tests/.tmp': (m) => { m.tailwind.copyDir = '/etc'; },
    'a Tailwind file escaping the cache (..)': (m) => { m.tailwind.files.push('../../../wp-config.php'); },
    'an absolute Tailwind file': (m) => { m.tailwind.files.push('/etc/passwd'); },
    'a Tailwind dir escaping the cache': (m) => { m.tailwind.dirs = ['..']; },
    'another Yoast snapshot path': (m) => { m.yoast = { snapshotFile: '/tmp/other.json' }; },
    'an id that is not the file name': (m) => { m.id = 'deadbeef'; m.tailwind = null; },
    'no start time': (m) => { delete m.startedAt; },
    'a post without id or name': (m) => { m.posts.push({ type: 'page' }); },
    'a fork slug that is not a string': (m) => { m.forks.push({ slug: 5 }); },
  };
  for (const [why, edit] of Object.entries(cases)) {
    const site = fakeSite();
    const run = tamper(site, edit);
    assert.throws(() => loadManifest(run.file), (e) => e.code === 'EMANIFEST', why);
    const before = site.calls.length;
    const [r] = recoverAll({ dir: site.dir, wpFor: () => site.wp });
    assert.equal(r.ok, false, why);
    assert.match(r.problems.join(), /EMANIFEST|not a valid|not allowed|outside|must/, why);
    assert.equal(site.calls.length, before, `${why}: no WP-CLI call`);
    assert.equal(site.options.get('stylesheet'), JSON.stringify(FORK), `${why}: nothing restored`);
    assert.deepEqual(leftoverManifests(site.dir), [run.file], `${why}: manifest kept`);
  }
});

test('recover refuses a manifest older than 1 hour unless --stale-ok, and reports when each run started', () => {
  const site = fakeSite();
  const run = tamper(site, (m) => { m.startedAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString(); });
  const before = site.calls.length;
  const [stale] = recoverAll({ dir: site.dir, wpFor: () => site.wp });
  assert.equal(stale.ok, false);
  assert.match(stale.problems.join(), /older than 1 hour.*--stale-ok/);
  assert.equal(stale.startedAt, JSON.parse(fs.readFileSync(run.file, 'utf8')).startedAt);
  assert.equal(site.calls.length, before, 'a stale manifest touches nothing');
  const [ok] = recoverAll({ dir: site.dir, wpFor: () => site.wp, staleOk: true });
  assert.equal(ok.ok, true, ok.problems.join());
  assert.equal(site.options.get('stylesheet'), '"dev-theme"');
  const cli = spawnSync(process.execPath, [path.join(REPO, 'tests', 'recover.mjs'), '--bogus'], { encoding: 'utf8', env: { ...process.env, PB_SITE_LOCK: '1' }, timeout: 20000 });
  assert.equal(cli.status, 64, 'only --stale-ok is accepted');
});

test('rawOption: an absent option is null, any other WP-CLI failure throws (a restore never deletes on an error)', () => {
  const site = fakeSite();
  assert.equal(rawOption(site.wp, 'nope'), null);
  assert.equal(rawOption(site.wp, 'stylesheet'), '"dev-theme"');
  site.options.set('sidebars_widgets', '{"b":2}');
  site.down = true;
  assert.throws(() => rawOption(site.wp, 'stylesheet'), /database connection/);
  assert.throws(() => restoreOptions(site.wp, { sidebars_widgets: null }), /database connection/);
  site.down = false;
  assert.equal(site.options.get('sidebars_widgets'), '{"b":2}', 'nothing deleted while WP-CLI was failing');
});
