#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWp, loadRuntime, WP_SCRIPTS_DIR } from './wp.mjs';

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

export function runGates(wp, { block, attrs = {} }) {
  const steps = [];
  const step = (id, ok, detail) => { steps.push({ id, ok, detail }); return ok; };
  const done = () => ({ ok: steps.every((s) => s.ok), steps });

  const themeDir = wp.check(['eval', 'echo get_stylesheet_directory();']).trim();
  const jsonPath = path.join(themeDir, 'proto-blocks', block, 'block.json');
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
    render = wp.evalFile(path.join(WP_SCRIPTS_DIR, 'render-block.php'), [block, JSON.stringify(attrs)]);
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

function main(argv) {
  const [themeDir, block, ...rest] = argv;
  if (!themeDir || !block) { process.stderr.write("Usage: node gates.mjs <themeDir> <block> [--attrs '<json>']\n"); process.exit(64); }
  const i = rest.indexOf('--attrs');
  const r = runGates(createWp(loadRuntime(themeDir)), { block, attrs: i >= 0 ? JSON.parse(rest[i + 1]) : {} });
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  if (!r.ok) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); }
}
