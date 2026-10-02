import sharp from 'sharp';

export async function loadRaw(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export async function rawToPng(raw, file) {
  await sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } }).png().toFile(file);
  return file;
}

export async function resizeToWidth(raw, width) {
  if (raw.width === width) return raw;
  const { data, info } = await sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
    .resize({ width, kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export function cropRaw(raw, { x, y, w, h }) {
  const x0 = Math.max(0, Math.min(raw.width, Math.round(x)));
  const y0 = Math.max(0, Math.min(raw.height, Math.round(y)));
  const cw = Math.max(0, Math.min(raw.width - x0, Math.round(w)));
  const ch = Math.max(0, Math.min(raw.height - y0, Math.round(h)));
  const data = Buffer.alloc(cw * ch * 4);
  for (let row = 0; row < ch; row++) {
    const start = ((y0 + row) * raw.width + x0) * 4;
    raw.data.copy(data, row * cw * 4, start, start + cw * 4);
  }
  return { data, width: cw, height: ch };
}
