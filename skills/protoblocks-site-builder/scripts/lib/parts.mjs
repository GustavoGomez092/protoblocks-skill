#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWp, loadThemeRuntime, WP_SCRIPTS_DIR } from './wp.mjs';
import { assertFork } from './guards.mjs';
import { blockComment } from './blocks.mjs';
import { loadState, getSection } from './state.mjs';
import { assertSlug, parseBlockName } from './slugs.mjs';

const SCRIPT = path.join(WP_SCRIPTS_DIR, 'parts.php');
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const THEME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function partMarkup({ block, attrs = {}, navRef, innerRaw }) {
  if (navRef !== undefined && !(Number.isInteger(navRef) && navRef > 0)) throw new Error(`navRef must be a positive integer, got ${String(navRef)}`);
  if (navRef !== undefined && innerRaw !== undefined) throw new Error('Pass navRef or innerRaw, not both');
  const inner = navRef === undefined ? innerRaw : blockComment('navigation', { ref: navRef });
  return `${blockComment(block, attrs, inner)}\n`;
}

export function writePart(themeDir, slug, markup) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) throw new Error(`Invalid part slug "${slug}"`);
  assertFork(themeDir);
  const file = path.join(themeDir, 'parts', `${slug}.html`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, markup);
  return file;
}

const shq = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;

// The WP-CLI command preflight resolved (Local's wrapper, or `wp --path=...`), quoted for a shell.
export const wpShellCommand = (rt) => (rt.mode === 'native' ? `wp --path=${shq(rt.publicPath)}` : shq(rt.wp));

// WP-CLI has no `post untrash`; wp_untrash_post restores to draft, so republish to make the override live again.
export const recoveryCommand = (id, wpCmd = 'wp') => `${wpCmd} eval 'wp_untrash_post(${id});' && ${wpCmd} post update ${id} --post_status=publish`;

function fail(code, message, extra = {}) {
  const e = new Error(message);
  e.code = code;
  Object.assign(e, extra);
  throw e;
}
const checkTheme = (theme) => { if (typeof theme !== 'string' || !THEME_RE.test(theme)) fail('ETHEME', `Invalid theme slug ${JSON.stringify(theme)}`); };
const checkSlug = (slug) => { if (typeof slug !== 'string' || !SLUG_RE.test(slug)) fail('ESLUG', `Invalid part slug ${JSON.stringify(slug)} (lowercase letters, digits and single hyphens only)`); };

// parts.php reports typed failures on stderr as "[ECODE] message" (or "ECODE: message"); surface the code.
const PHP_CODE_RE = /^\[?(E[A-Z]{3,})(?:\]|:)\s*(.*)$/m;
function callParts(wp, args) {
  try {
    return wp.evalFile(SCRIPT, args);
  } catch (err) {
    const stderr = err?.result?.stderr ?? '';
    const m = PHP_CODE_RE.exec(stderr);
    if (!m) throw err;
    const e = new Error(`${m[2]}`.trim() || m[1], { cause: err });
    e.code = m[1];
    throw e;
  }
}

export function listOverrides(wp, theme) {
  checkTheme(theme);
  return callParts(wp, ['overrides', theme]);
}

export function removeOverride(wp, theme, slug, { confirm, expectId, wpCmd = 'wp' } = {}) {
  checkTheme(theme);
  checkSlug(slug);
  const rows = callParts(wp, ['preview', theme, slug]);
  const ids = rows.map((r) => r.id);
  if (rows.some((r) => r.theme !== theme)) fail('ETHEMEMISMATCH', `Preview returned rows outside theme "${theme}": ${JSON.stringify(rows)}`, { rows });
  if (rows.length > 1) fail('EAMBIGUOUS', `More than one saved "${slug}" part matched (IDs ${ids.join(', ')}). Resolve in wp-admin; nothing was removed.`, { rows });
  if (rows.length === 0) return { removed: [], records: [], recovery: [] };
  const [row] = rows;
  if (confirm !== true || !Number.isInteger(expectId) || expectId <= 0) {
    fail('ECONFIRM', `The Site Editor has a saved copy of the "${slug}" part. Removing it (to Trash) discards edits made there. Would remove: ${JSON.stringify(rows)}. Ask the developer, then re-run with --confirm --id ${row.id}. Recover later with: ${recoveryCommand(row.id, wpCmd)}`, { rows });
  }
  if (expectId !== row.id) fail('ESTALE', `The saved "${slug}" part is now ID ${row.id}, not the previewed ${expectId}. Re-run the preview and confirm again; nothing was removed.`, { rows });
  const res = callParts(wp, ['remove-override', theme, slug, 'confirm', String(expectId)]);
  return { ...res, recovery: res.removed.map((id) => recoveryCommand(id, wpCmd)) };
}

function idArg(argv) {
  const i = argv.indexOf('--id');
  return i >= 0 ? Number(argv[i + 1]) : undefined;
}

const USAGE = 'Usage: node parts.mjs write <themeDir> <slug> <markupFile> | overrides <themeDir> | remove-override <themeDir> <slug> [--confirm --id <n>] | markup <block> [--attrs <json>] [--nav-ref <id>] | markup <themeDir> --from-state <page> <n>\n';

/**
 * Pure CLI behind `markup`: parses `<block> [--attrs <json>] [--nav-ref <id>]` and returns partMarkup(...) text.
 * A bare block slug gets the proto-blocks/ namespace. Throws EINPUT (bad block/attrs/nav-ref) or EUSAGE (bad argv).
 */
const nsBlock = (block) => (block.includes('/') ? block : `proto-blocks/${block}`);

// `markup <themeDir> --from-state <page> <n>`: the section's block, attrs (+ its anchor) and inner, straight from state,
// so no JSON is ever hand-copied into a shell command.
function markupFromState(args) {
  const [themeDir, flag, page, n, ...extra] = args;
  if (flag !== '--from-state' || !themeDir || page === undefined || n === undefined || extra.length) throw fail('EUSAGE', USAGE.trim());
  assertSlug(page, 'page slug');
  const { section } = getSection(loadState(themeDir), page, n);
  if (typeof section.block !== 'string' || !section.block) throw fail('EINPUT', `Section ${section.n} on "${page}" has no block yet; build it first.`);
  parseBlockName(section.block, 'block name in state');
  const attrs = { ...(section.attrs ?? {}), anchor: section.anchor };
  const innerRaw = Array.isArray(section.inner) && section.inner.length ? section.inner.join('\n') : undefined;
  return partMarkup({ block: nsBlock(section.block), attrs, innerRaw });
}

export function markupFromArgs(args) {
  if (args.includes('--from-state')) return markupFromState(args);
  const rest = [...args];
  const block = rest.shift();
  if (!block || block.startsWith('--')) throw fail('EUSAGE', USAGE.trim());
  const vals = {};
  while (rest.length) {
    const f = rest.shift();
    if (f !== '--attrs' && f !== '--nav-ref') throw fail('EUSAGE', USAGE.trim());
    const v = rest.shift();
    if (v === undefined) throw fail('EUSAGE', `${f} needs a value`);
    vals[f] = v;
  }
  if (!/^(?:[a-z0-9][a-z0-9-]*\/)?[a-z0-9][a-z0-9-]*$/.test(block)) throw fail('EINPUT', `Invalid block name ${JSON.stringify(block)}`);
  let attrs = {};
  if ('--attrs' in vals) {
    try { attrs = JSON.parse(vals['--attrs']); } catch (e) { throw fail('EINPUT', `--attrs is not valid JSON: ${e.message}`); }
    if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) throw fail('EINPUT', '--attrs must be a JSON object');
  }
  let navRef;
  if ('--nav-ref' in vals) {
    if (!/^[1-9][0-9]*$/.test(vals['--nav-ref'])) throw fail('ENAVREF', `--nav-ref must be a positive integer (the menu id), got ${JSON.stringify(vals['--nav-ref'])}`);
    navRef = Number(vals['--nav-ref']);
  }
  return partMarkup({ block: nsBlock(block), attrs, navRef });
}

function main(argv) {
  if (argv[0] === 'markup') {
    try { return process.stdout.write(markupFromArgs(argv.slice(1))); } catch (e) {
      if (e.code === 'EUSAGE') { process.stderr.write(`${e.message}\n`); process.exit(64); }
      throw e;
    }
  }
  const [cmd, themeDir, slug, file] = argv;
  const usage = () => {
    process.stderr.write(USAGE);
    process.exit(64);
  };
  if (!['write', 'overrides', 'remove-override'].includes(cmd) || !themeDir) return usage();
  if (cmd === 'write' && (!slug || !file)) return usage();
  if (cmd === 'remove-override' && !slug) return usage();
  const theme = themeDir ? path.basename(path.resolve(themeDir)) : '';
  const out = (v) => process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
  const rt = loadThemeRuntime(themeDir);
  if (cmd === 'write') return out({ written: writePart(themeDir, slug, fs.readFileSync(file, 'utf8')) });
  const wp = createWp(rt);
  if (cmd === 'overrides') return out(listOverrides(wp, theme));
  if (cmd === 'remove-override') return out(removeOverride(wp, theme, slug, { confirm: argv.includes('--confirm'), expectId: idArg(argv), wpCmd: wpShellCommand(rt) }));
  return usage();
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) {
    process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`);
    if (e.rows) process.stdout.write(`${JSON.stringify(e.rows, null, 2)}\n`);
    process.exit(1);
  }
}
