#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWp, loadThemeRuntime, WP_SCRIPTS_DIR } from './wp.mjs';
import { loadState, updateState } from './state.mjs';
import { refreshMenus } from './navigation.mjs';
import { assertSlug } from './slugs.mjs';

const SCRIPT = path.join(WP_SCRIPTS_DIR, 'page.php');
const fail = (code, message) => Object.assign(new Error(message), { code });
const FORCE_NOTE = 'Note: --force also publishes the page if it is a draft, pending or private.';
const USAGE = 'Usage: node page.mjs build <themeDir> <slug> [--force]\n';

export const backupsDir = (themeDir) => path.join(themeDir, '.protoblocks', 'artifacts', 'backups');

export function pageSpecFromState(state, slug, { force = false } = {}) {
  assertSlug(slug, 'page slug'); // page.php re-checks with sanitize_title (defence in depth)
  const page = state.pages.find((p) => p.slug === slug);
  if (!page) throw fail('ENOPAGE', `No page "${slug}" in state.`);
  const blocks = [...page.sections]
    .sort((a, b) => a.n - b.n)
    // planned = not built yet (the plan may already name its block); inPart = rendered by a template part.
    .filter((s) => s.status !== 'skipped' && s.status !== 'planned' && !s.inPart && s.block)
    .map((s) => ({
      name: s.block.includes('/') ? s.block : `proto-blocks/${s.block}`,
      attrs: { ...(s.attrs ?? {}), anchor: s.anchor },
      ...(s.inner?.length ? { innerRaw: s.inner.join('\n') } : {}),
    }));
  return { postId: page.postId ?? null, slug: page.slug, title: page.title ?? page.slug, expectedHash: page.contentHash ?? null, lastWritten: page.written ?? null, force, blocks };
}

const check = (out) => {
  if (out?.error) throw fail(out.error.code ?? 'EPAGE', out.error.message);
  return out;
};
// The spec travels as a JSON payload file (wp.evalFilePayload): free text never reaches WP-CLI's argv.
const callPayload = (wp, command, spec) => check(wp.evalFilePayload(SCRIPT, command, spec));
const getPost = (wp, postId) => check(wp.evalFile(SCRIPT, ['get', String(postId)]));

/**
 * Backup design: a WordPress revision is not reliable (revisions can be disabled, and none is made when the content
 * is unchanged), so JS always writes the current post_content to a file before overwriting anything that is not
 * exactly what the builder last wrote, plus a .json sidecar with the post's title, slug and status (the .html holds
 * content only). page.php also saves a revision as a bonus (backupRevisionId). The returned hash is what the backup
 * contains; write refuses with ESTALE if the post no longer has it.
 */
function backUp(themeDir, wp, slug, postId) {
  const cur = getPost(wp, postId);
  const dir = backupsDir(themeDir);
  const at = new Date().toISOString();
  const file = path.join(dir, `${slug}-${postId}-${at.replace(/[:.]/g, '-')}.html`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, cur.content, { flag: 'wx' });
    fs.writeFileSync(file.replace(/\.html$/, '.json'), `${JSON.stringify({ postId, title: cur.title, slug: cur.slug, status: cur.status, contentHash: cur.contentHash, at }, null, 2)}\n`, { flag: 'wx' });
  } catch (e) {
    throw fail('EBACKUP', `Could not save a backup of page ${postId} to ${file} (${e.message}); nothing was overwritten.`);
  }
  return { file, hash: cur.contentHash };
}

export function buildPage(wp, themeDir, slug, { force = false } = {}) {
  const state = loadState(themeDir);
  const spec = pageSpecFromState(state, slug, { force });
  // The plan gate in code: nothing is assembled before the developer approved the section plan (--force does not bypass it).
  const approved = state.pages.find((p) => p.slug === slug)?.plan?.approvedAt;
  if (typeof approved !== 'string' || !approved) {
    throw fail('ENOPLAN', `Page "${slug}" has no approved section plan (pages[].plan.approvedAt). Present the plan to the developer and record it after approval (protoblocks-design-breakdown, plan gate) before building.`);
  }
  const dir = backupsDir(themeDir);
  const planned = callPayload(wp, 'plan', spec);
  if (planned.guard) {
    throw fail(planned.guard.code,
      `${planned.guard.message} Ask the developer before overwriting; then re-run with --force. ${FORCE_NOTE} `
      + `Overwriting first saves the current content to ${path.join(dir, `${slug}-<postId>-<timestamp>.html`)} (and as a WordPress revision when revisions are on).`);
  }
  const backup = planned.needsBackup && planned.target ? backUp(themeDir, wp, slug, planned.target.postId) : null;
  const backupFile = backup?.file ?? null;
  // The hash the overwrite is allowed to replace: the backed-up content, or (nothing to back up) the planned one.
  const backedUpHash = backup?.hash ?? planned.target?.hash ?? null;
  const r = callPayload(wp, 'write', { ...spec, backedUpHash });
  if (!r.ok) {
    if (r.code === 'ESTALE') throw fail('ESTALE', `${r.message} Nothing was overwritten; re-run the build to take a fresh backup and plan.`);
    throw fail(r.code, `${r.message} Ask the developer before overwriting; then re-run with --force. ${FORCE_NOTE} Overwriting first saves the current content to ${path.join(dir, `${slug}-<postId>-<timestamp>.html`)}.`);
  }
  const warnings = [...(r.warnings ?? [])];
  if (backupFile && planned.target?.built && spec.expectedHash == null) {
    warnings.push(`Page ${planned.target.postId} was built by the builder but state had no stored content hash (an untracked built page), so its current content was overwritten. Backup: ${backupFile}`);
  }
  const idx = loadState(themeDir).pages.findIndex((p) => p.slug === slug);
  const recipe = (field) => `To get the builder's ${field} back, either rename the page in wp-admin to match, or clear it in state: node state.mjs set "${themeDir}" pages.${idx}.written.${field} null (then rebuild).`;
  if (r.kept?.title) warnings.push(`Kept the developer's page title "${r.kept.title.developer}" (the builder last wrote "${r.kept.title.builder}"; state asks for "${r.kept.title.wanted}"). ${recipe('title')}`);
  if (r.kept?.slug) warnings.push(`Kept the developer's page slug "${r.kept.slug.developer}" (the builder last wrote "${r.kept.slug.builder}"). ${recipe('slug')}`);
  if (r.slug && r.slug !== slug && !r.kept?.slug) warnings.push(`WordPress gave the page the slug "${r.slug}" instead of the requested "${slug}" (the requested one was unavailable).`);

  let pendingHere = false;
  updateState(themeDir, (s) => {
    const page = s.pages.find((p) => p.slug === slug);
    page.postId = r.postId;
    page.url = r.url;
    page.contentHash = r.contentHash;
    page.written = r.written;
    if (page.status === 'planning') page.status = 'building';
    pendingHere = Object.values(s.site.navigation?.menus ?? {}).some((m) => (m.pending ?? []).some((p) => p.page === slug));
  });
  let refreshedMenus = [];
  let menuRefreshError = null;
  if (pendingHere) {
    try { refreshedMenus = refreshMenus(wp, themeDir).refreshed; } catch (e) {
      menuRefreshError = `The page was written, but refreshing the menus failed: ${e.message}. Run: node navigation.mjs refresh ${themeDir}`;
    }
  }
  return {
    postId: r.postId, slug: r.slug ?? slug, url: r.url, contentHash: r.contentHash, created: r.created,
    backupRevisionId: r.backupRevisionId ?? null, backupFile, warnings, refreshedMenus, menuRefreshError,
  };
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const flags = rest.filter((a) => a.startsWith('--'));
  const pos = rest.filter((a) => !a.startsWith('--'));
  if (cmd !== 'build' || pos.length !== 2 || flags.some((f) => f !== '--force')) { process.stderr.write(USAGE); process.exit(64); }
  const [themeDir, slug] = pos;
  const r = buildPage(createWp(loadThemeRuntime(themeDir)), themeDir, slug, { force: flags.includes('--force') });
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); }
}
