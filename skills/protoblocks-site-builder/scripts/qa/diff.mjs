#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import pixelmatch from 'pixelmatch';
import sharp from 'sharp';
import { loadRaw, resizeToWidth, cropRaw } from './image.mjs';

export const MASK_COLOR = [255, 0, 255];
const round4 = (n) => Math.round(n * 10000) / 10000;

export function normalizeMasks(masks) {
  const out = [];
  for (const m of masks) {
    if (![m?.x, m?.y, m?.w, m?.h].every(Number.isFinite)) continue;
    const x = Math.floor(m.x);
    const y = Math.floor(m.y);
    const w = Math.ceil(m.x + m.w) - x;
    const h = Math.ceil(m.y + m.h) - y;
    if (w > 0 && h > 0) out.push({ x, y, w, h });
  }
  return out;
}

function paintMasks(raw, masks) {
  const seen = new Uint8Array(raw.width * raw.height);
  let count = 0;
  for (const m of masks) {
    for (let y = Math.max(0, m.y); y < Math.min(raw.height, m.y + m.h); y++) {
      for (let x = Math.max(0, m.x); x < Math.min(raw.width, m.x + m.w); x++) {
        const i = y * raw.width + x;
        raw.data.set([...MASK_COLOR, 255], i * 4);
        if (!seen[i]) { seen[i] = 1; count++; }
      }
    }
  }
  return count;
}

export function compareRaw(design, render, { threshold = 0.1, masks = [] } = {}) {
  if (design.width !== render.width) {
    const e = new Error(`compareRaw needs equal widths (${design.width} vs ${render.width})`);
    e.code = 'EWIDTH';
    throw e;
  }
  const width = design.width;
  const height = Math.min(design.height, render.height);
  const a = cropRaw(design, { x: 0, y: 0, w: width, h: height });
  const b = cropRaw(render, { x: 0, y: 0, w: width, h: height });
  const norm = normalizeMasks(masks);
  const masked = paintMasks(a, norm);
  paintMasks(b, norm);
  const heat = Buffer.alloc(width * height * 4);
  const comparedPixels = width * height - masked;
  const fullyMasked = comparedPixels <= 0;
  const diffPixels = fullyMasked || !height ? 0 : pixelmatch(a.data, b.data, heat, width, height, { threshold, includeAA: false, alpha: 0.25, diffColor: [255, 0, 0] });
  return {
    mismatch: fullyMasked ? 1 : diffPixels / comparedPixels,
    fullyMasked,
    heightDelta: design.height ? Math.abs(render.height - design.height) / design.height : 0,
    diffPixels,
    comparedPixels,
    width,
    designHeight: design.height,
    renderHeight: render.height,
    heatmap: { data: heat, width, height },
  };
}

async function panel(raw, maxWidth) {
  const img = sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } });
  const scaled = raw.width > maxWidth ? img.resize({ width: maxWidth }) : img;
  const { data, info } = await scaled.png().toBuffer({ resolveWithObject: true });
  return { input: data, width: info.width, height: info.height };
}

export async function writeComposite(design, render, heatmap, out, { maxPanel = 800, gutter = 16 } = {}) {
  const panels = [await panel(design, maxPanel), await panel(render, maxPanel), await panel(heatmap, maxPanel)];
  const width = panels.reduce((s, p) => s + p.width, 0) + gutter * 4;
  const height = Math.max(...panels.map((p) => p.height)) + gutter * 2;
  let left = gutter;
  const composites = panels.map((p) => { const c = { input: p.input, left, top: gutter }; left += p.width + gutter; return c; });
  await sharp({ create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).composite(composites).png().toFile(out);
  return out;
}

export async function diffImages({ design, render, out, masks = [], threshold = 0.1 }) {
  const d = await loadRaw(design);
  const r = await resizeToWidth(await loadRaw(render), d.width);
  const result = compareRaw(d, r, { threshold, masks });
  const { heatmap, ...rest } = result;
  const report = { ...rest, mismatch: round4(rest.mismatch), heightDelta: round4(rest.heightDelta) };
  if (out) report.composite = await writeComposite(d, r, heatmap, out);
  return report;
}

async function main(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
  if (!a.design || !a.render) { process.stderr.write('Usage: node diff.mjs --design d.png --render r.png [--out c.png] [--masks json] [--threshold 0.1]\n'); process.exit(64); }
  let masks = [];
  if (a.masks) {
    try { masks = JSON.parse(a.masks); } catch (err) { const e = new Error(`--masks is not valid JSON: ${err.message}`); e.code = 'EMASKS'; throw e; }
    if (!Array.isArray(masks)) { const e = new Error('--masks must be a JSON array'); e.code = 'EMASKS'; throw e; }
  }
  const r = await diffImages({ design: a.design, render: a.render, out: a.out, masks, threshold: a.threshold ? Number(a.threshold) : 0.1 });
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); });
}
