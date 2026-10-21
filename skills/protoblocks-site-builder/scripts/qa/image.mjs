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

/**
 * Crops the top of `file` at its full width to the aspect of `width`:`height` (4:3 for a theme screenshot: a
 * 1440-wide frame gives 1440x1080 from y 0), pads a shorter image with its bottom-left colour, resizes the crop to
 * exactly `width` x `height` and writes `out` as PNG.
 */
export async function cropTopToSize(file, out, { width, height }) {
  const meta = await sharp(file).metadata();
  const source = { width: meta.width ?? 0, height: meta.height ?? 0 };
  const cropHeight = Math.round((source.width * height) / width);
  let buf;
  if (source.height >= cropHeight) {
    buf = await sharp(file).extract({ left: 0, top: 0, width: source.width, height: cropHeight }).png().toBuffer();
  } else {
    const raw = await loadRaw(file);
    const i = (raw.height - 1) * raw.width * 4;
    const [r, g, b] = raw.data.subarray(i, i + 3);
    buf = await sharp(file).extend({ top: 0, left: 0, right: 0, bottom: cropHeight - source.height, background: { r, g, b, alpha: 1 } }).png().toBuffer();
  }
  await sharp(buf).resize(width, height, { fit: 'fill' }).png().toFile(out);
  return { out, source, crop: { width: source.width, height: cropHeight }, width, height };
}
