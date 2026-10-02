#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { shoot } from './shoot.mjs';
import { loadRaw } from './image.mjs';

export const OG_SIZE = { width: 1200, height: 630 };

export async function ogImage({ url, selector, out, browser, imageWaitMs }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-og-'));
  try {
    const tmp = path.join(dir, 'shot.png');
    const shot = await shoot({ url, selector, width: OG_SIZE.width, scale: 1, out: tmp, browser, imageWaitMs });
    let raw = await loadRaw(tmp);
    const source = { width: raw.width, height: raw.height };
    // Padding heuristic: a flat colour sampled from the shot's bottom-left pixel.
    // It suits solid or near-solid heroes; gradients or full-bleed images can show a seam at the padding edge.
    const i = (raw.height - 1) * raw.width * 4;
    const [r, g, b] = raw.data.subarray(i, i + 3);
    const background = { r, g, b, alpha: 1 };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    let buf = fs.readFileSync(tmp);
    // Narrow (boxed) sections: pad to full width first, centred, so the final resize stays a no-op and nothing is stretched.
    if (raw.width < OG_SIZE.width) {
      const left = Math.floor((OG_SIZE.width - raw.width) / 2);
      buf = await sharp(buf).extend({ top: 0, bottom: 0, left, right: OG_SIZE.width - raw.width - left, background }).png().toBuffer();
      raw = { ...raw, width: OG_SIZE.width };
    }
    if (raw.height >= OG_SIZE.height) {
      await sharp(buf).extract({ left: 0, top: 0, width: Math.min(raw.width, OG_SIZE.width), height: OG_SIZE.height }).resize(OG_SIZE.width, OG_SIZE.height, { fit: 'fill' }).png().toFile(out);
    } else {
      // sharp runs resize before extend inside one pipeline, so pad first and resize in a second pass.
      const padded = await sharp(buf).extend({ top: 0, bottom: OG_SIZE.height - raw.height, left: 0, right: 0, background }).png().toBuffer();
      await sharp(padded).resize(OG_SIZE.width, OG_SIZE.height, { fit: 'fill' }).png().toFile(out);
    }
    // imageErrors: broken/stalled images inside the shot section; pageImageWarnings: stalled images elsewhere on the page.
    return { out, width: OG_SIZE.width, height: OG_SIZE.height, source, imageErrors: shot.imageErrors ?? [], pageImageWarnings: shot.pageImageWarnings ?? [] };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * A developer-supplied image that is not 1200x630: cover-fit it (scale to cover, crop centred and top-aligned, the
 * top kept as in generated images) into `out`. A 1200x630 image is left alone: { resized: false } and nothing written.
 */
export async function fitOgImage(input, out) {
  const meta = await sharp(input).metadata();
  const source = { width: meta.width ?? 0, height: meta.height ?? 0 };
  if (source.width === OG_SIZE.width && source.height === OG_SIZE.height) return { resized: false, source };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await sharp(input).resize(OG_SIZE.width, OG_SIZE.height, { fit: 'cover', position: 'top' }).png().toFile(out);
  return { resized: true, out, source, width: OG_SIZE.width, height: OG_SIZE.height };
}

const USAGE = "Usage: node og-image.mjs --url U --selector '#pb-s1' --out og.png\n       node og-image.mjs --fit <supplied image> --out og-supplied.png\n";

async function main(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
  if (a.fit !== undefined) {
    if (!a.fit || !a.out) { process.stderr.write(USAGE); process.exit(64); }
    process.stdout.write(`${JSON.stringify(await fitOgImage(a.fit, a.out), null, 2)}\n`);
    return;
  }
  if (!a.url || !a.selector || !a.out) { process.stderr.write(USAGE); process.exit(64); }
  process.stdout.write(`${JSON.stringify(await ogImage({ url: a.url, selector: a.selector, out: a.out }), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1); });
}
