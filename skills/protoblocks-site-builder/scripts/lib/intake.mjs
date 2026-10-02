#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadState, updateState, stateDir } from './state.mjs';
import { assertSlug } from './slugs.mjs';
import { PART_ANCHORS } from './plan.mjs';

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
  const bad = (msg) => { const e = new Error(`${msg}: ${file}`); e.code = 'EIMAGE'; return e; };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    if (buf.length < 24) throw bad('Truncated or corrupt image');
    if (buf.toString('latin1', 12, 16) !== 'IHDR') throw bad('Truncated or corrupt image (no IHDR chunk)');
    return buf.readUInt32BE(16);
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 3 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (i + 9 > buf.length) throw bad('Truncated or corrupt image');
        return buf.readUInt16BE(i + 7);
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    throw bad('Truncated or corrupt image');
  }
  const e = new Error(`Unsupported image format (convert to PNG): ${file}`);
  e.code = 'EIMAGE';
  throw e;
}

export const artifactsDir = (themeDir) => path.join(stateDir(themeDir), 'artifacts');

function assertBreakpoint(breakpoint) {
  if (typeof breakpoint !== 'string' || !Object.hasOwn(BREAKPOINT_RANGES, breakpoint)) {
    throw Object.assign(new Error(`Unknown breakpoint ${JSON.stringify(breakpoint ?? null)}; use one of ${Object.keys(BREAKPOINT_RANGES).join(', ')}.`), { code: 'EINPUT' });
  }
  return breakpoint;
}

export function ensurePage(state, slug, title) {
  assertSlug(slug, 'page slug');
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

/**
 * Records a design frame. The copied file keeps the source extension: downstream code must read `frame.image` and never assume `.png`.
 */
export function addFrame(themeDir, slug, breakpoint, image, { width, title } = {}) {
  // Both become path segments of the copied frame: validate before reading or writing anything.
  assertSlug(slug, 'page slug');
  assertBreakpoint(breakpoint);
  const pixelWidth = imageWidth(image);
  let fit;
  if (width !== undefined && width !== null && width !== '') {
    const w = Number(width);
    fit = Number.isFinite(w) && Number.isInteger(w) && w > 0 ? { cssWidth: w, scale: pixelWidth / w } : null;
  } else {
    fit = inferScale(pixelWidth, breakpoint);
  }
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

function validateRanges(ranges) {
  const bad = (msg) => { const e = new Error(`Invalid crop ranges: ${msg}`); e.code = 'ERANGES'; return e; };
  if (!ranges || typeof ranges !== 'object') throw bad('expected { breakpoint: [{n, y0, y1}] }');
  for (const [bp, list] of Object.entries(ranges)) {
    if (!BREAKPOINT_RANGES[bp]) throw bad(`unknown breakpoint "${bp}"`);
    if (!Array.isArray(list)) throw bad(`${bp} must be an array`);
    const seen = new Set();
    for (const r of list) {
      if (!r || !Number.isInteger(r.n) || r.n <= 0) throw bad(`${bp}: n must be a positive integer (${JSON.stringify(r)})`);
      if (!Number.isInteger(r.y0) || !Number.isInteger(r.y1) || r.y0 < 0 || r.y0 >= r.y1) throw bad(`${bp}: need integers 0 <= y0 < y1 (${JSON.stringify(r)})`);
      if (seen.has(r.n)) throw bad(`${bp}: n ${r.n} appears twice (one crop per section per breakpoint)`);
      seen.add(r.n);
      if (r.part !== undefined && !Object.hasOwn(PART_ANCHORS, r.part)) throw bad(`${bp}: part must be "header" or "footer" (${JSON.stringify(r)})`);
    }
  }
  // A part names one section: the same n on every breakpoint, and that n is never another part.
  const partOfN = new Map();
  const nOfPart = new Map();
  for (const [bp, list] of Object.entries(ranges)) {
    for (const r of list) {
      if (r.part === undefined) continue;
      if (partOfN.has(r.n) && partOfN.get(r.n) !== r.part) throw bad(`${bp}: section ${r.n} is both ${partOfN.get(r.n)} and ${r.part}`);
      if (nOfPart.has(r.part) && nOfPart.get(r.part) !== r.n) throw bad(`${bp}: the ${r.part} is section ${nOfPart.get(r.part)} elsewhere, not ${r.n}`);
      partOfN.set(r.n, r.part);
      nOfPart.set(r.part, r.n);
    }
  }
  return partOfN;
}

// Anchor of section n: header/footer get the fixed part anchors, an existing section keeps its anchor, else pb-s<n>.
function anchorFor(page, n, part) {
  if (part) {
    const anchor = PART_ANCHORS[part];
    const clash = page.sections.find((x) => x.n !== n && x.anchor === anchor);
    if (clash) throw Object.assign(new Error(`Invalid crop ranges: section ${clash.n} already has the anchor ${anchor}; only one ${part} per page`), { code: 'ERANGES' });
    return anchor;
  }
  return page.sections.find((x) => x.n === n)?.anchor ?? `pb-s${n}`;
}

export async function cropSections(themeDir, slug, ranges) {
  assertSlug(slug, 'page slug');
  const partOfN = validateRanges(ranges);
  const state = loadState(themeDir);
  const page = state.pages.find((p) => p.slug === slug);
  if (!page) throw new Error(`No page "${slug}" in state; add a frame first.`);
  const anchors = new Map();
  for (const list of Object.values(ranges)) for (const r of list) anchors.set(r.n, anchorFor(page, r.n, partOfN.get(r.n)));
  const { cropRanges } = await import('../qa/segment.mjs');
  const out = [];
  const spans = new Map(); // `${n}:${bp}` -> {y0, y1}, the crop range in frame pixels (page QA translates masks with it)
  for (const [bp, list] of Object.entries(ranges)) {
    const frame = page.design.frames.find((f) => f.breakpoint === bp);
    if (!frame) throw new Error(`No ${bp} frame for page "${slug}".`);
    const dir = path.join(artifactsDir(themeDir), slug, 'crops', bp);
    const crops = await cropRanges(frame.image, list.map((r) => ({ name: anchors.get(r.n), y0: r.y0, y1: r.y1 })), dir);
    crops.forEach((c, i) => {
      out.push({ n: list[i].n, anchor: anchors.get(list[i].n), breakpoint: bp, file: c.file });
      spans.set(`${list[i].n}:${bp}`, { y0: list[i].y0, y1: list[i].y1 });
    });
  }
  updateState(themeDir, (s) => {
    const page = s.pages.find((p) => p.slug === slug);
    if (!page) throw new Error(`No page "${slug}" in state; add a frame first.`);
    for (const c of out) {
      let sec = page.sections.find((x) => x.n === c.n);
      if (!sec) { sec = { n: c.n, anchor: c.anchor, status: 'planned', crops: {} }; page.sections.push(sec); }
      if (partOfN.has(c.n)) sec.anchor = c.anchor;
      sec.crops ??= {};
      sec.crops[c.breakpoint] = c.file;
      sec.ranges = { ...(sec.ranges ?? {}), [c.breakpoint]: spans.get(`${c.n}:${c.breakpoint}`) };
    }
    page.sections.sort((a, b) => a.n - b.n);
  });
  return out;
}

export async function framesFromUrl(themeDir, slug, url, widths) {
  assertSlug(slug, 'page slug');
  const valid = (Array.isArray(widths) ? widths : []).filter((w) => Number.isFinite(w) && w > 0);
  if (!valid.length) { const e = new Error('No valid widths given (need positive numbers, e.g. 1440,390).'); e.code = 'EWIDTHS'; throw e; }
  const { shoot } = await import('../qa/shoot.mjs');
  const frames = [];
  for (const w of valid) {
    const bp = w >= 1200 ? 'desktop' : w >= 700 ? 'tablet' : 'mobile';
    const tmp = path.join(artifactsDir(themeDir), slug, 'design', `${bp}.source.png`);
    try {
      await shoot({ url, width: w, fullPage: true, out: tmp });
      frames.push(addFrame(themeDir, slug, bp, tmp, { width: w }));
    } finally {
      fs.rmSync(tmp, { force: true });
    }
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
