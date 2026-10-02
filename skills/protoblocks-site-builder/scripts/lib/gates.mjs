#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWp, loadRuntime, WP_SCRIPTS_DIR } from './wp.mjs';
import { loadState, getSection } from './state.mjs';
import { assertSlug } from './slugs.mjs';

// The plugin prints the JSON array and may append text ("Success: ...") on the same line;
// earlier output may itself contain "[". Try each "[" start until one parses to an array.
function parseJsonArray(text) {
  for (let start = text.indexOf('['); start >= 0; start = text.indexOf('[', start + 1)) {
    for (let end = text.lastIndexOf(']'); end > start; end = text.lastIndexOf(']', end - 1)) {
      try { const r = JSON.parse(text.slice(start, end + 1)); if (Array.isArray(r)) return r; } catch { /* try a shorter slice */ }
    }
  }
  return [];
}

const realOrSelf = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

/** `--from-state <page> <n>`: the section's block and attrs, looked up by page slug and n. */
export function gateInputFromState(state, page, n) {
  assertSlug(page, 'page slug');
  const { section } = getSection(state, page, n);
  if (typeof section.block !== 'string' || !section.block) throw Object.assign(new Error(`Section ${section.n} on "${page}" has no block yet: write block and attrs to state first.`), { code: 'EINPUT' });
  return { block: section.block, attrs: section.attrs ?? {} };
}

/**
 * themeDir (the CLI's <themeDir>) must be the theme WordPress renders with: the gate reads the block from the active
 * stylesheet directory, so a mismatch would test a different copy of the block (EWRONGTHEME).
 */
export function runGates(wp, { block, attrs = {}, themeDir: expectedTheme } = {}) {
  assertSlug(block, 'block slug');
  const steps = [];
  const step = (id, ok, detail) => { steps.push({ id, ok, detail }); return ok; };
  const done = () => ({ ok: steps.every((s) => s.ok), steps });

  const themeDir = wp.check(['eval', 'echo get_stylesheet_directory();']).trim();
  if (expectedTheme !== undefined && realOrSelf(expectedTheme) !== realOrSelf(themeDir)) {
    throw Object.assign(new Error(`${expectedTheme} is not the active theme: WordPress renders with ${themeDir} (get_stylesheet_directory). Gates would test that theme's copy of "${block}". Activate the fork (wp theme activate <slug>) or pass the active theme's directory.`), { code: 'EWRONGTHEME' });
  }
  // Same lookup order as the plugin's discovery (and library.mjs): block.json, then <name>.json. No containment
  // check here: the block slug is validated, and the plugin itself loads a symlinked block folder.
  const dir = path.join(themeDir, 'proto-blocks', block);
  const jsonPath = [path.join(dir, 'block.json'), path.join(dir, `${block}.json`)].find((f) => fs.existsSync(f)) ?? path.join(dir, 'block.json');
  let json = null;
  try { json = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch (e) { step('anchor-support', false, `Cannot read ${jsonPath}: ${e.message}`); return done(); }
  if (!step('anchor-support', json?.supports?.anchor === true, json?.supports?.anchor === true ? 'supports.anchor true' : 'block.json must declare "supports": { "anchor": true } (QA targets #pb-s<n>)')) return done();

  const v = wp.run(['proto-blocks', 'validate', block, '--format=json']);
  const rows = parseJsonArray(v.stdout);
  const row = rows.find((r) => r.block === block);
  const validOk = v.code === 0 && row && !['error', 'invalid'].includes(String(row.status).toLowerCase());
  if (!step('validate', !!validOk, row ?? (v.stderr || v.stdout).trim())) return done();

  const c = wp.run(['proto-blocks', 'cache', 'clear']);
  if (!step('cache', c.code === 0, (c.stdout || c.stderr).trim())) return done();

  const tw = path.join(WP_SCRIPTS_DIR, 'tailwind.php');
  const status = wp.evalFile(tw, ['status']);
  if (status.enabled) {
    const r = wp.run(['eval-file', tw, 'compile']);
    const last = r.stdout.trim().split('\n').at(-1) ?? '';
    if (!step('tailwind', r.code === 0, last || r.stderr.trim())) return done();
  } else {
    step('tailwind', true, 'disabled');
  }

  let render;
  try {
    // attrs carry free text (copy, URLs): they travel as a JSON payload file, never as WP-CLI argv.
    render = wp.evalFilePayload(path.join(WP_SCRIPTS_DIR, 'render-block.php'), 'render', { block, attrs });
  } catch (e) {
    // An uncatchable PHP fatal (E_ERROR, out of memory) kills the wp process before the normal JSON is printed.
    const r = e.result ?? {};
    const stdout = String(r.stdout ?? '');
    // WP's fatal handler exits before any script-level handler can print JSON, but PHP itself writes
    // "Fatal error: <message> in <file> on line <n>" to stdout (render-block.php enables display_errors).
    const m = stdout.match(/(?:PHP )?(?:Fatal|Parse) error:\s+([\s\S]+?) in (\S[^\n]*?) on line (\d+)/);
    const parsed = m ? { message: m[1], file: m[2], line: Number(m[3]) } : null;
    step('render', false, parsed
      ? { fatal: parsed, raw: stdout.slice(0, 2000) }
      : { fatal: String(r.stderr || stdout || e.message).slice(0, 2000), raw: stdout.slice(0, 2000) });
    return done();
  }
  if (render.environment) { step('render', false, { environment: render.environment }); return done(); }
  step('render', render.ok === true, render);
  return done();
}

const USAGE = "Usage: node gates.mjs <themeDir> <block> [--attrs '<json>'] | <themeDir> --from-state <page> <n>\n";

function main(argv) {
  const [themeDir, ...rest] = argv;
  let input;
  if (rest[0] === '--from-state') {
    if (!themeDir || rest.length !== 3) { process.stderr.write(USAGE); process.exit(64); }
    input = gateInputFromState(loadState(themeDir), rest[1], rest[2]);
  } else {
    const [block, ...flags] = rest;
    if (!themeDir || !block || block.startsWith('--')) { process.stderr.write(USAGE); process.exit(64); }
    const i = flags.indexOf('--attrs');
    let attrs = {};
    if (i >= 0) {
      try { attrs = JSON.parse(flags[i + 1]); } catch (e) { throw Object.assign(new Error(`--attrs is not valid JSON: ${e.message}`), { code: 'EINPUT' }); }
    }
    input = { block, attrs };
  }
  const r = runGates(createWp(loadRuntime(themeDir)), { ...input, themeDir });
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  if (!r.ok) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); }
}
