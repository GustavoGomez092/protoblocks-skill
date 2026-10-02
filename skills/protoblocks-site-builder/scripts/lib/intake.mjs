#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadState, updateState, stateDir } from './state.mjs';

export const BREAKPOINT_RANGES = { desktop: [1200, 1920], tablet: [700, 1100], mobile: [320, 480] };

export function inferScale(pixelWidth, breakpoint) {
  const range = BREAKPOINT_RANGES[breakpoint];
  if (!range) return null;
  for (const scale of [1, 2, 3]) {
    const css = pixelWidth / scale;
    if (Number.isInteger(css) && css >= range[0] && css <= range[1]) return { cssWidth: css, scale };
  }
  return null;
}

export function imageWidth(file) {
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return buf.readUInt32BE(16);
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return buf.readUInt16BE(i + 7);
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  const e = new Error(`Unsupported image format (convert to PNG): ${file}`);
  e.code = 'EIMAGE';
  throw e;
}

export const artifactsDir = (themeDir) => path.join(stateDir(themeDir), 'artifacts');

export function ensurePage(state, slug, title) {
  let page = state.pages.find((p) => p.slug === slug);
  if (!page) {
    page = { slug, title: title ?? slug, status: 'planning', postId: null, contentHash: null, design: { frames: [] }, sections: [] };
    state.pages.push(page);
  } else if (title) {
    page.title = title;
  }
  page.design ??= { frames: [] };
  page.design.frames ??= [];
  return page;
}

export function addFrame(themeDir, slug, breakpoint, image, { width, title } = {}) {
  const pixelWidth = imageWidth(image);
  let fit = width ? { cssWidth: Number(width), scale: pixelWidth / Number(width) } : inferScale(pixelWidth, breakpoint);
  if (!fit) {
    const e = new Error(`Can't infer the design width of a ${pixelWidth}px ${breakpoint} export. Ask the developer for the frame's CSS width and pass --width.`);
    e.code = 'ESCALE';
    throw e;
  }
  const dest = path.join(artifactsDir(themeDir), slug, 'design', `${breakpoint}${path.extname(image).toLowerCase() || '.png'}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (path.resolve(image) !== path.resolve(dest)) fs.copyFileSync(image, dest);
  const frame = { breakpoint, width: fit.cssWidth, scale: fit.scale, image: dest, pixelWidth };
  updateState(themeDir, (s) => {
    const page = ensurePage(s, slug, title);
    page.design.frames = page.design.frames.filter((f) => f.breakpoint !== breakpoint).concat(frame);
  });
  return frame;
}

export async function cropSections(themeDir, slug, ranges) {
  const { cropRanges } = await import('../qa/segment.mjs');
  const state = loadState(themeDir);
  const page = state.pages.find((p) => p.slug === slug);
  if (!page) throw new Error(`No page "${slug}" in state; add a frame first.`);
  const out = [];
  for (const [bp, list] of Object.entries(ranges)) {
    const frame = page.design.frames.find((f) => f.breakpoint === bp);
    if (!frame) throw new Error(`No ${bp} frame for page "${slug}".`);
    const dir = path.join(artifactsDir(themeDir), slug, 'crops', bp);
    const crops = await cropRanges(frame.image, list.map((r) => ({ name: `pb-s${r.n}`, y0: r.y0, y1: r.y1 })), dir);
    crops.forEach((c, i) => out.push({ n: list[i].n, breakpoint: bp, file: c.file }));
  }
  updateState(themeDir, (s) => {
    const page = s.pages.find((p) => p.slug === slug);
    for (const c of out) {
      let sec = page.sections.find((x) => x.n === c.n);
      if (!sec) { sec = { n: c.n, anchor: `pb-s${c.n}`, status: 'planned', crops: {} }; page.sections.push(sec); }
      sec.crops ??= {};
      sec.crops[c.breakpoint] = c.file;
    }
    page.sections.sort((a, b) => a.n - b.n);
  });
  return out;
}

export async function framesFromUrl(themeDir, slug, url, widths) {
  const { shoot } = await import('../qa/shoot.mjs');
  const frames = [];
  for (const w of widths) {
    const bp = w >= 1200 ? 'desktop' : w >= 700 ? 'tablet' : 'mobile';
    const tmp = path.join(artifactsDir(themeDir), slug, 'design', `${bp}.source.png`);
    await shoot({ url, width: w, fullPage: true, out: tmp });
    frames.push(addFrame(themeDir, slug, bp, tmp, { width: w }));
    fs.rmSync(tmp, { force: true });
  }
  return frames;
}

async function main(argv) {
  const [cmd, themeDir, slug, ...rest] = argv;
  const flags = {};
  const pos = [];
  for (let i = 0; i < rest.length; i++) { if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[++i]; else pos.push(rest[i]); }
  const out = (v) => process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
  if (cmd === 'add-frame') return out(addFrame(themeDir, slug, pos[0], pos[1], { width: flags.width, title: flags.title }));
  if (cmd === 'crop') return out(await cropSections(themeDir, slug, JSON.parse(fs.readFileSync(pos[0], 'utf8'))));
  if (cmd === 'from-url') return out(await framesFromUrl(themeDir, slug, pos[0], String(flags.widths ?? '1440,390').split(',').map(Number)));
  process.stderr.write('Usage: node intake.mjs add-frame <themeDir> <slug> <breakpoint> <image> [--width W] [--title T] | crop <themeDir> <slug> <ranges.json> | from-url <themeDir> <slug> <url> --widths 1440,390\n');
  process.exit(64);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); });
}
