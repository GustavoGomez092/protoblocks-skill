#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadRaw, cropRaw, rawToPng } from './image.mjs';

const TOL = 12;
const px = (raw, x, y) => { const i = (y * raw.width + x) * 4; return [raw.data[i], raw.data[i + 1], raw.data[i + 2]]; };
const dist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
const mean = (cs) => [0, 1, 2].map((k) => Math.round(cs.reduce((s, c) => s + c[k], 0) / cs.length));

export function rowBackgrounds(raw, { edge = 4 } = {}) {
  const rows = [];
  for (let y = 0; y < raw.height; y++) {
    const left = mean(Array.from({ length: edge }, (_, i) => px(raw, i, y)));
    const right = mean(Array.from({ length: edge }, (_, i) => px(raw, raw.width - 1 - i, y)));
    const color = dist(left, right) <= TOL ? mean([left, right]) : null;
    let uniform = !!color;
    for (let x = 0; uniform && x < raw.width; x += 2) if (dist(px(raw, x, y), color) > TOL) uniform = false;
    rows.push({ color, uniform });
  }
  return rows;
}

const MAX_INTERRUPT = 3; // rows of the other kind tolerated inside a run (text / anti-aliasing touching the edge)

// Split rows into runs of "null" (edges disagree: photo/gradient) or one solid colour.
function buildRuns(rows, tolerance) {
  const sameState = (a, b) => (a.color === null ? b.color === null : b.color !== null && dist(a.color, b.color) <= tolerance);
  const stack = [];
  let y = 0;
  while (y < rows.length) {
    const color = rows[y].color;
    let end = y + 1;
    while (end < rows.length && (color === null ? rows[end].color === null : rows[end].color !== null && dist(rows[end].color, color) <= tolerance)) end++;
    let run = { start: y, end, color };
    const prev = stack[stack.length - 2];
    const top = stack[stack.length - 1];
    if (prev && top.end - top.start <= MAX_INTERRUPT && sameState(prev, run)) {
      stack.length -= 2; // absorb the short interruption: prev + top + run become one run
      run = { start: prev.start, end, color: prev.color };
    }
    stack.push(run);
    y = end;
  }
  return stack;
}

export function findCuts(raw, { tolerance = TOL, minBand = 40, minGap = 24 } = {}) {
  const rows = rowBackgrounds(raw);
  const cuts = [];
  const runs = buildRuns(rows, tolerance).filter((r) => r.end - r.start >= minBand);
  // State starts from the first substantial run (row 0 when it is substantial), solid or null.
  let bandColor = runs.length ? runs[0].color : (rows.find((r) => r.color)?.color ?? [255, 255, 255]);
  const bandColors = [bandColor];
  for (const r of runs.slice(1)) {
    const changed = bandColor === null || r.color === null ? !(bandColor === null && r.color === null) : dist(r.color, bandColor) > tolerance;
    if (!changed) continue;
    cuts.push({ y: r.start, kind: 'background', from: bandColor, to: r.color });
    bandColor = r.color;
    bandColors.push(bandColor);
  }
  const edges = [0, ...cuts.map((c) => c.y), raw.height];
  const bands = edges.slice(0, -1).map((y0, i) => ({ y0, y1: edges[i + 1], bg: bandColors[i] }));
  for (const band of bands) {
    if (band.bg === null) continue; // photo band: no uniform rows, no gap candidates
    let runStart = null;
    for (let yy = band.y0; yy <= band.y1; yy++) {
      const u = yy < band.y1 && rows[yy].uniform;
      if (u && runStart === null) runStart = yy;
      if (!u && runStart !== null) {
        const len = yy - runStart;
        if (len >= minGap && runStart > band.y0 && yy < band.y1) cuts.push({ y: runStart + Math.floor(len / 2), kind: 'gap', gap: len });
        runStart = null;
      }
    }
  }
  cuts.sort((a, b) => a.y - b.y);
  return { width: raw.width, height: raw.height, cuts, bands };
}

function rangeError(r, why) {
  const e = new Error(`Invalid crop range ${JSON.stringify(r?.name ?? null)}: ${why} (${JSON.stringify(r)})`);
  e.code = 'ERANGES';
  return e;
}

function normalizeRange(r, raw) {
  if (typeof r?.name !== 'string' || !/^[A-Za-z0-9_-]+$/.test(r.name)) throw rangeError(r, 'name must match [A-Za-z0-9_-]+');
  const x0 = r.x0 ?? 0; const x1 = r.x1 ?? raw.width;
  for (const [k, v] of [['y0', r.y0], ['y1', r.y1], ['x0', x0], ['x1', x1]]) {
    if (!Number.isInteger(v)) throw rangeError(r, `${k} must be an integer`);
  }
  if (r.y0 >= r.y1) throw rangeError(r, 'y0 must be less than y1');
  if (x0 >= x1) throw rangeError(r, 'x0 must be less than x1');
  if (r.y0 < 0 || r.y1 > raw.height || x0 < 0 || x1 > raw.width) {
    throw rangeError(r, `out of bounds for ${raw.width}x${raw.height} image`);
  }
  return { name: r.name, x0, x1, y0: r.y0, y1: r.y1 };
}

export async function cropRanges(image, ranges, outDir) {
  if (!Array.isArray(ranges)) throw rangeError(null, 'ranges must be an array');
  const raw = await loadRaw(image);
  const norm = ranges.map((r) => normalizeRange(r, raw)); // validate everything before writing anything
  fs.mkdirSync(outDir, { recursive: true });
  const out = [];
  for (const r of norm) {
    const crop = cropRaw(raw, { x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0 });
    const file = path.join(outDir, `${r.name}.png`);
    await rawToPng(crop, file);
    out.push({ name: r.name, file, width: crop.width, height: crop.height });
  }
  return out;
}

async function main(argv) {
  const [cmd, image, ...rest] = argv;
  const a = {};
  const usage = () => { process.stderr.write('Usage: node segment.mjs analyze <image> | crop <image> --ranges <json> --out <dir>\n'); process.exit(64); };
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i].startsWith('--') || rest[i + 1] === undefined || rest[i + 1].startsWith('--')) return usage();
    a[rest[i].slice(2)] = rest[i + 1];
  }
  if (cmd === 'analyze' && image) return process.stdout.write(`${JSON.stringify(findCuts(await loadRaw(image)), null, 2)}\n`);
  if (cmd === 'crop' && image && a.ranges && a.out) {
    let ranges;
    try { ranges = JSON.parse(a.ranges); } catch (e) { throw new Error(`--ranges is not valid JSON: ${e.message}`); }
    if (!Array.isArray(ranges)) throw new Error('--ranges must be a JSON array of {name, y0, y1, x0?, x1?}');
    return process.stdout.write(`${JSON.stringify(await cropRanges(image, ranges, a.out), null, 2)}\n`);
  }
  return usage();
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1); });
}
