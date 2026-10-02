#!/usr/bin/env node
// Restores the Local test site after an interrupted site-test run: reads every tests/.tmp/site-run-*.json and undoes
// exactly what it lists (tests/site-run.mjs recoverRun). Run it only under the site lock:
//   tests/pb-site-test.sh <worktree> test:recover
// A manifest is deleted once everything it lists is restored; otherwise it is kept and the problems are printed
// (exit 1). Nothing outside a manifest is ever touched.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { leftoverManifests, loadManifest, recoverRun, TMP, RECOVER_COMMAND } from './site-run.mjs';
import { createWp } from '../skills/protoblocks-site-builder/scripts/lib/wp.mjs';
import { resolveLocalSite, writeWrapper } from '../skills/protoblocks-site-builder/scripts/lib/local-site.mjs';

/** WP-CLI for the site a manifest was written on (re-resolved through Local; refuses a different install). */
export function siteWp(m, { dir = TMP } = {}) {
  const r = resolveLocalSite({ query: m.site });
  if (!r.ok) throw Object.assign(new Error(`cannot reach the Local site "${m.site}": ${r.error}`), { code: 'ESITE' });
  if (path.resolve(r.site.publicPath) !== path.resolve(m.publicPath)) {
    throw Object.assign(new Error(`the Local site "${m.site}" is at ${r.site.publicPath}, but the manifest was written for ${m.publicPath}`), { code: 'ESITE' });
  }
  const wrapper = path.join(dir, 'wp-test-site');
  writeWrapper(wrapper, r.site);
  return createWp({ wp: wrapper, mode: 'local-wrapper', publicPath: m.publicPath });
}

/** Recovers every manifest in `dir`; `wpFor(manifest)` gives its WP-CLI. Returns one result per manifest. */
export function recoverAll({ dir = TMP, wpFor = (m) => siteWp(m, { dir }) } = {}) {
  const results = [];
  for (const file of leftoverManifests(dir)) {
    let m;
    try { m = loadManifest(file); } catch (e) { results.push({ file, ok: false, done: [], problems: [e.message] }); continue; }
    let r;
    try { r = recoverRun(wpFor(m), m, { tmpDir: dir }); } catch (e) { r = { done: [], problems: [e.message] }; }
    const ok = r.problems.length === 0;
    if (ok) {
      if (m.tailwind?.copyDir) fs.rmSync(m.tailwind.copyDir, { recursive: true, force: true });
      fs.rmSync(file, { force: true });
    }
    results.push({ file, kind: m.kind ?? null, startedAt: m.startedAt ?? null, ok, ...r });
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  if (process.env.PB_SITE_LOCK !== '1') {
    process.stderr.write(`recover.mjs changes the Local test site: run it under the site lock:\n  ${RECOVER_COMMAND}\n`);
    process.exit(2);
  }
  const results = recoverAll();
  process.stdout.write(`${JSON.stringify(results.length ? results : { recovered: [], note: `no site-run manifest in ${TMP}` }, null, 2)}\n`);
  if (results.some((r) => !r.ok)) process.exit(1);
}
