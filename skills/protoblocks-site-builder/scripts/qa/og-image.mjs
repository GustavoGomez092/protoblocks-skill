#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { shoot } from './shoot.mjs';
import { loadRaw } from './image.mjs';

export const OG_SIZE = { width: 1200, height: 630 };

export async function ogImage({ url, selector, out, browser }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-og-'));
  try {
    const tmp = path.join(dir, 'shot.png');
    const shot = await shoot({ url, selector, width: OG_SIZE.width, scale: 1, out: tmp, browser });
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
    return { out, width: OG_SIZE.width, height: OG_SIZE.height, source, imageErrors: shot.imageErrors ?? [] };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
  if (!a.url || !a.selector || !a.out) { process.stderr.write("Usage: node og-image.mjs --url U --selector '#pb-s1' --out og.png\n"); process.exit(64); }
  process.stdout.write(`${JSON.stringify(await ogImage({ url: a.url, selector: a.selector, out: a.out }), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1); });
}
