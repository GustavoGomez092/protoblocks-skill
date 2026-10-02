import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';
import {
  validateTokens, renderTailwindTheme, mergeThemeJson, googleFontsUrl, rewriteFontImport, applyTokens, runApply,
  rewriteBodyFont, bodyFontSlug, presetVar, parseFontFaces, selfHostFonts, FONTS_DIR,
} from '../../skills/protoblocks-site-builder/scripts/lib/tokens.mjs';

const tokens = {
  colors: { ink: '#111111', accent: '#ff5a1f' },
  fonts: { sans: { family: 'Inter', google: [700, 400, 400] }, display: { family: 'DM Serif Display', google: [400] } },
  type: { h1: { size: '64px', lineHeight: '1.05', letterSpacing: '-0.02em', fontWeight: '700' }, 'body-md': '16px' },
  radii: { card: '16px' },
  shadows: { soft: '0 6px 16px rgba(0,0,0,0.08)' },
  spacing: { section: 'clamp(64px, 10vw, 120px)' },
};

test('validateTokens accepts good tokens and reports bad ones with paths', () => {
  assert.deepEqual(validateTokens(tokens), []);
  const errs = validateTokens({ colors: { Accent: 'blue;}', ok: '#fff' }, type: { h1: '64' }, shadows: { x: 'a}b' } });
  assert.ok(errs.some((e) => e.startsWith('colors.Accent:')), errs.join('\n'));
  assert.ok(errs.some((e) => e.startsWith('type.h1:')), errs.join('\n'));
  assert.ok(errs.some((e) => e.startsWith('shadows.x:')), errs.join('\n'));
  assert.ok(validateTokens({}).some((e) => e.startsWith('colors:')));
});

test('validateTokens rejects CSS injection characters ; { } in every group', () => {
  const bad = (t) => validateTokens({ colors: { a: '#000' }, ...t });
  assert.ok(bad({ colors: { a: 'rgb(0,0,0);}' } }).some((e) => e.startsWith('colors.a:')));
  assert.ok(bad({ colors: { a: 'rgb(0;0,0)' } }).some((e) => e.startsWith('colors.a:')));
  assert.ok(bad({ shadows: { s: '0 0 1px red; x' } }).some((e) => e.startsWith('shadows.s:')));
  assert.ok(bad({ shadows: { s: '0 0 {1px}' } }).some((e) => e.startsWith('shadows.s:')));
  assert.ok(bad({ radii: { r: 'calc(1px;2px)' } }).some((e) => e.startsWith('radii.r:')));
  assert.ok(bad({ spacing: { s: 'clamp(1px}' } }).some((e) => e.startsWith('spacing.s:')));
  assert.ok(bad({ fonts: { f: { family: 'Inter; x' } } }).some((e) => e.startsWith('fonts.f:')));
  assert.ok(bad({ fonts: { f: { family: 'Inter', fallback: 'serif}' } } }).some((e) => e.startsWith('fonts.f:')));
  assert.ok(bad({ type: { t: { size: '1px', letterSpacing: '1px;' } } }).some((e) => e.startsWith('type.t:')));
  assert.ok(bad({ type: { t: { size: '1px', lineHeight: '1;}' } } }).some((e) => e.startsWith('type.t:')));
});

test('validateTokens rejects names that are not kebab-case in every group', () => {
  for (const name of ['Bad', 'a_b', 'a b', '-a', 'a--b', 'a.b']) {
    assert.ok(validateTokens({ colors: { [name]: '#000' } }).some((e) => e.startsWith(`colors.${name}: invalid name`)), name);
  }
  assert.ok(validateTokens({ colors: { a: '#000' }, radii: { Big: '1px' } }).some((e) => e.includes('radii.Big: invalid name')));
  assert.ok(validateTokens({ colors: { a: '#000' }, type: { H1: '1px' } }).some((e) => e.includes('type.H1: invalid name')));
  assert.ok(validateTokens({ colors: { a: '#000' }, fonts: { Sans: { family: 'X' } } }).some((e) => e.includes('fonts.Sans: invalid name')));
  assert.deepEqual(validateTokens({ colors: { 'a-b-2': '#000' } }), []);
});

test('validateTokens rejects invalid lengths and colours, accepts valid ones', () => {
  const e = (t) => validateTokens({ colors: { a: '#000' }, ...t });
  assert.ok(e({ radii: { r: '16' } }).some((x) => x.startsWith('radii.r:')));
  assert.ok(e({ radii: { r: 'big' } }).some((x) => x.startsWith('radii.r:')));
  assert.ok(e({ spacing: { s: '12pt' } }).some((x) => x.startsWith('spacing.s:')));
  assert.ok(e({ type: { t: '64' } }).some((x) => x.startsWith('type.t:')));
  assert.ok(e({ type: { t: { size: '1px', lineHeight: 'tall' } } }).some((x) => x.startsWith('type.t:')));
  assert.ok(e({ type: { t: { size: '1px', letterSpacing: '1' } } }).some((x) => x.startsWith('type.t:')));
  assert.ok(e({ type: { t: { size: '1px', fontWeight: '450' } } }).some((x) => x.startsWith('type.t:')));
  assert.ok(validateTokens({ colors: { a: 'blue' } }).some((x) => x.startsWith('colors.a:')));
  assert.ok(validateTokens({ colors: { a: '#12' } }).some((x) => x.startsWith('colors.a:')));
  assert.ok(validateTokens({ colors: { a: 5 } }).some((x) => x.startsWith('colors.a:')));
  assert.ok(e({ fonts: { f: { family: 'A', google: [50] } } }).some((x) => x.startsWith('fonts.f:')));
  assert.ok(e({ fonts: { f: { family: 'A"B' } } }).some((x) => x.startsWith('fonts.f:')));
  assert.deepEqual(e({ radii: { r: '0', s: '1.5rem', t: '50%' }, spacing: { x: 'calc(1px + 2px)' }, type: { t: { size: '1rem', lineHeight: '24px', fontWeight: 500 } } }), []);
  assert.deepEqual(validateTokens({ colors: { a: 'oklch(0.5 0.2 30)', b: 'transparent', c: '#ff5a1f80', d: 'rgb(0 0 0 / 0.5)' } }), []);
});

test('renderTailwindTheme emits v4 namespaces', () => {
  const css = renderTailwindTheme(tokens);
  assert.match(css, /@theme \{/);
  assert.match(css, /--color-accent: #ff5a1f;/);
  assert.match(css, /--font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;/);
  assert.match(css, /--text-h1: 64px;\n\s*--text-h1--line-height: 1\.05;\n\s*--text-h1--letter-spacing: -0\.02em;\n\s*--text-h1--font-weight: 700;/);
  assert.match(css, /--text-body-md: 16px;/);
  assert.match(css, /--radius-card: 16px;/);
  assert.match(css, /--shadow-soft: 0 6px 16px rgba\(0,0,0,0\.08\);/);
  assert.match(css, /--spacing-section: clamp\(64px, 10vw, 120px\);/);
});

test('mergeThemeJson replaces token groups and preserves other settings', () => {
  const base = { version: 3, settings: { layout: { contentSize: '720px' }, typography: { fontFamilies: [{ slug: 'old' }] } }, templateParts: [1] };
  const out = mergeThemeJson(base, tokens);
  assert.deepEqual(out.settings.layout, { contentSize: '720px' });
  assert.deepEqual(out.templateParts, [1]);
  assert.deepEqual(out.settings.color.palette[1], { slug: 'accent', name: 'Accent', color: '#ff5a1f' });
  assert.equal(out.settings.typography.fontFamilies[0].fontFamily, '"Inter", ui-sans-serif, system-ui, sans-serif');
  assert.deepEqual(out.settings.typography.fontSizes[0], { slug: 'h1', name: 'H1', size: '64px' });
  assert.equal(base.settings.typography.fontFamilies[0].slug, 'old', 'input not mutated');
});

test('google fonts url; style.css never imports Google Fonts (fonts are self-hosted)', () => {
  assert.equal(googleFontsUrl(tokens), 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=DM+Serif+Display:wght@400&display=swap');
  const style = '/*\nTheme Name: X\n*/\n\n/* Optional web font — swap or remove. */\n@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap");\nbody{}';
  for (const t of [tokens, { colors: { a: '#000' } }]) {
    const out = rewriteFontImport(style, t);
    assert.ok(!out.includes('@import'), JSON.stringify(t));
    assert.ok(out.endsWith('body{}'));
  }
  assert.equal(rewriteFontImport('/*\nTheme Name: X\n*/\nbody{}', tokens), '/*\nTheme Name: X\n*/\nbody{}', 'no import is inserted');
});

test('rewriteFontImport removes every existing Google import', () => {
  const imp = (f) => `@import url("https://fonts.googleapis.com/css2?family=${f}&display=swap");\n`;
  const style = `/*\nTheme Name: X\n*/\n${imp('A')}${imp('B')}${imp('C')}body{}`;
  const out = rewriteFontImport(style, tokens);
  assert.equal(out, '/*\nTheme Name: X\n*/\nbody{}');
  assert.equal(rewriteFontImport(out, tokens), out, 'idempotent');
});

// What fonts.googleapis.com/css2 answers a modern browser: one @font-face per weight and unicode subset.
const CSS2 = `/* latin-ext */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v18/inter-ext.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5;
}
/* latin */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v18/inter-latin.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131;
}
/* latin */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v18/inter-latin.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131;
}
/* latin */
@font-face {
  font-family: 'DM Serif Display';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/dmserifdisplay/v15/dm.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  src: url(https://evil.example.com/x.woff2) format('woff2');
}
`;

// A fake download.mjs: the css2 response for fonts.googleapis.com, bytes per gstatic URL; records every call.
function fakeDownload({ offline = false, failFile = null } = {}) {
  const calls = [];
  const fn = async (url, dest, opts = {}) => {
    calls.push({ url, dest, opts });
    if (offline) throw Object.assign(new Error(`Download failed ${url}: getaddrinfo ENOTFOUND`), { code: 'EDOWNLOAD' });
    if (failFile && url.includes(failFile)) throw Object.assign(new Error(`Download failed ${url}: HTTP 404`), { code: 'EDOWNLOAD' });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, url.startsWith('https://fonts.googleapis.com/') ? CSS2 : `woff2:${url}`);
    return dest;
  };
  fn.calls = calls;
  return fn;
}
const forkTheme = () => {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-tok-'));
  fs.writeFileSync(path.join(theme, 'style.css'), '/*\nTheme Name: X\nProto Fork: p@1\n*/\n@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap");\nbody {\n  font-family: "Inter", sans-serif;\n}\n');
  fs.writeFileSync(path.join(theme, 'theme.json'), JSON.stringify({ version: 3, settings: { typography: { fontFamilies: [{ slug: 'inter', name: 'Inter', fontFamily: 'Inter' }] } } }));
  fs.writeFileSync(path.join(theme, 'tailwind-theme.css'), '@theme {}');
  return theme;
};

test('parseFontFaces reads family, style, weight, unicode-range and the gstatic woff2 url; other hosts are dropped', () => {
  const faces = parseFontFaces(CSS2);
  assert.equal(faces.length, 4);
  assert.deepEqual(faces[0], { family: 'Inter', style: 'normal', weight: '400', unicodeRange: 'U+0100-02BA, U+02BD-02C5', url: 'https://fonts.gstatic.com/s/inter/v18/inter-ext.woff2' });
  assert.ok(faces.every((f) => f.url.startsWith('https://fonts.gstatic.com/')));
});

test('selfHostFonts fetches css2 through download.mjs as a browser, saves each woff2 once and returns theme.json fontFace entries', async () => {
  const theme = forkTheme();
  const download = fakeDownload();
  const r = await selfHostFonts(theme, tokens, { download });
  assert.deepEqual(r.warnings, []);
  assert.equal(download.calls[0].url, googleFontsUrl(tokens));
  assert.match(download.calls[0].opts.headers['User-Agent'], /Chrome\//, 'a browser UA: Google serves woff2 only to modern browsers');
  assert.ok(download.calls[0].opts.timeoutMs <= 30000, 'bounded: an unreachable Google never stalls apply');
  const gets = download.calls.slice(1).map((c) => c.url);
  assert.equal(gets.length, new Set(gets).size, 'a file shared by several weights is downloaded once');
  assert.equal(gets.length, 3);
  const inter = r.faces.Inter;
  assert.equal(inter.length, 3);
  for (const face of [...inter, ...r.faces['DM Serif Display']]) {
    assert.match(face.src[0], /^file:\.\/assets\/fonts\/[a-z0-9-]+\.woff2$/);
    assert.ok(fs.existsSync(path.join(theme, face.src[0].slice('file:./'.length))), face.src[0]);
    assert.equal(face.fontDisplay, 'swap');
  }
  assert.deepEqual(Object.keys(inter[0]).sort(), ['fontDisplay', 'fontFamily', 'fontStyle', 'fontWeight', 'src', 'unicodeRange']);
  assert.equal(inter[0].fontFamily, 'Inter');
  assert.equal(inter[2].fontWeight, '700');
  assert.equal(FONTS_DIR, 'assets/fonts');
  assert.deepEqual(fs.readdirSync(path.join(theme, FONTS_DIR)).filter((n) => !n.endsWith('.woff2')), [], 'no css or temp file left in the fonts folder');
});

test('runApply self-hosts: theme.json fontFace from file:./assets/fonts, no @import left, fonts listed', async () => {
  const theme = forkTheme();
  initState(theme, { url: 'http://x.test', path: '/x' });
  const r = await runApply(theme, tokens, { compile: null, download: fakeDownload() });
  const style = fs.readFileSync(path.join(theme, 'style.css'), 'utf8');
  assert.ok(!style.includes('fonts.googleapis.com'), style);
  const tj = JSON.parse(fs.readFileSync(path.join(theme, 'theme.json'), 'utf8'));
  const fam = Object.fromEntries(tj.settings.typography.fontFamilies.map((f) => [f.slug, f]));
  assert.equal(fam.sans.fontFace.length, 3);
  assert.equal(fam.display.fontFace[0].src[0].startsWith('file:./assets/fonts/'), true);
  assert.equal(r.fonts.length, 3);
  assert.equal(r.warnings, undefined);
});

test('runApply offline: warns, keeps the fallback stack (no fontFace, no @import) and still applies the tokens', async () => {
  const theme = forkTheme();
  const r = await runApply(theme, tokens, { compile: null, download: fakeDownload({ offline: true }) });
  assert.match(r.warnings.join('\n'), /Google Fonts could not be downloaded.*Inter, DM Serif Display.*fallback/s);
  const tj = JSON.parse(fs.readFileSync(path.join(theme, 'theme.json'), 'utf8'));
  assert.ok(tj.settings.typography.fontFamilies.every((f) => f.fontFace === undefined));
  assert.equal(tj.settings.typography.fontFamilies[0].fontFamily, '"Inter", ui-sans-serif, system-ui, sans-serif');
  assert.ok(!fs.readFileSync(path.join(theme, 'style.css'), 'utf8').includes('@import'));
});

test('runApply: a family whose file fails keeps its fallback; the others are self-hosted', async () => {
  const theme = forkTheme();
  const r = await runApply(theme, tokens, { compile: null, download: fakeDownload({ failFile: 'dmserifdisplay' }) });
  assert.match(r.warnings.join('\n'), /DM Serif Display/);
  const tj = JSON.parse(fs.readFileSync(path.join(theme, 'theme.json'), 'utf8'));
  const fam = Object.fromEntries(tj.settings.typography.fontFamilies.map((f) => [f.slug, f]));
  assert.equal(fam.sans.fontFace.length, 3);
  assert.equal(fam.display.fontFace, undefined);
});

test('runApply validates before any download (ETOKENS, nothing fetched)', async () => {
  const download = fakeDownload();
  await assert.rejects(runApply(forkTheme(), { colors: { BAD: 'x' }, fonts: tokens.fonts }, { compile: null, download }), (e) => e.code === 'ETOKENS');
  assert.equal(download.calls.length, 0);
});

test('applyTokens writes three files, and writes nothing when invalid', () => {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-tok-'));
  fs.writeFileSync(path.join(theme, 'style.css'), '/*\nTheme Name: X\nProto Fork: p@1\n*/\nbody{}');
  fs.writeFileSync(path.join(theme, 'theme.json'), JSON.stringify({ version: 3, settings: {} }));
  fs.writeFileSync(path.join(theme, 'tailwind-theme.css'), '@theme {}');
  assert.throws(() => applyTokens(theme, { colors: { BAD: 'x' } }), (e) => e.code === 'ETOKENS');
  assert.equal(fs.readFileSync(path.join(theme, 'tailwind-theme.css'), 'utf8'), '@theme {}');
  const r = applyTokens(theme, tokens);
  assert.deepEqual(r.written.sort(), ['style.css', 'tailwind-theme.css', 'theme.json']);
  assert.match(fs.readFileSync(path.join(theme, 'tailwind-theme.css'), 'utf8'), /--color-ink/);
});

test('applyTokens on invalid tokens leaves all three files byte-identical and lists every error', () => {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-tok-'));
  const files = { 'style.css': '/*\nTheme Name: X\nProto Fork: p@1\n*/\nbody{}', 'theme.json': '{"version":3,"settings":{}}', 'tailwind-theme.css': '@theme {}' };
  for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(theme, f), c);
  let err;
  try { applyTokens(theme, { colors: { BAD: 'x', ok: '#fff' }, radii: { r: 'nope' } }); } catch (e) { err = e; }
  assert.equal(err?.code, 'ETOKENS');
  assert.match(err.message, /colors\.BAD/);
  assert.match(err.message, /radii\.r/);
  for (const [f, c] of Object.entries(files)) assert.equal(fs.readFileSync(path.join(theme, f), 'utf8'), c, f);
});

test('validateTokens rejects comment, escape, newline, @ and url() payloads naming the field', () => {
  const e = (t) => validateTokens({ colors: { a: '#000' }, ...t });
  const payloads = ['rgb(0 /* )', 'rgb(#fff */ @import url(x) /* )', '0 0 1px red\n--color-evil: red', 'red\\', 'url(x)'];
  for (const p of payloads) {
    assert.ok(validateTokens({ colors: { a: p } }).some((x) => x.startsWith('colors.a:')), `colors ${JSON.stringify(p)}`);
    assert.ok(e({ shadows: { s: p } }).some((x) => x.startsWith('shadows.s:')), `shadows ${JSON.stringify(p)}`);
    assert.ok(e({ radii: { r: p } }).some((x) => x.startsWith('radii.r:')), `radii ${JSON.stringify(p)}`);
    assert.ok(e({ spacing: { r: p } }).some((x) => x.startsWith('spacing.r:')), `spacing ${JSON.stringify(p)}`);
    assert.ok(e({ fonts: { f: { family: 'A', fallback: p } } }).some((x) => x.startsWith('fonts.f:')), `fallback ${JSON.stringify(p)}`);
    assert.ok(e({ type: { t: { size: '1px', lineHeight: p } } }).some((x) => x.startsWith('type.t:')), `lineHeight ${JSON.stringify(p)}`);
    assert.ok(e({ type: { t: { size: '1px', letterSpacing: p } } }).some((x) => x.startsWith('type.t:')), `letterSpacing ${JSON.stringify(p)}`);
  }
  // inner class tightened: hostile chars inside functions rejected even without SAFE-listed tokens
  assert.ok(e({ radii: { r: 'calc(1px "x")' } }).some((x) => x.startsWith('radii.r:')));
  assert.ok(e({ colors: { b: 'rgb(0 0 0 !important)' } }).some((x) => x.startsWith('colors.b:')));
  assert.deepEqual(e({ spacing: { s: 'calc(100% - 2*1rem)' }, colors: { c: 'rgb(0 0 0 / 50%)' } }), []);
});

test('validateTokens restricts font family and fallback', () => {
  const e = (f) => validateTokens({ colors: { a: '#000' }, fonts: { f } });
  for (const family of ['A&display=x\\', 'Inter, Arial', 'Font"Name', '', ' Inter', 'A'.repeat(70)]) {
    assert.ok(e({ family }).some((x) => x.startsWith('fonts.f:')), JSON.stringify(family));
  }
  assert.deepEqual(e({ family: 'DM Serif Display' }), []);
  assert.deepEqual(e({ family: 'Source Sans 3' }), []);
  assert.ok(e({ family: 'A', fallback: 'serif, sans(' }).some((x) => x.startsWith('fonts.f:')));
  assert.ok(e({ family: 'A', fallback: 'serif,' }).some((x) => x.startsWith('fonts.f:')));
  assert.deepEqual(e({ family: 'A', fallback: 'Helvetica Neue, Arial, sans-serif' }), []);
});

test('googleFontsUrl percent-encodes family names', () => {
  const url = googleFontsUrl({ colors: {}, fonts: { f: { family: ' Tricky&Name ', google: [400] } } });
  assert.equal(url, 'https://fonts.googleapis.com/css2?family=Tricky%26Name:wght@400&display=swap');
  assert.equal(googleFontsUrl({ fonts: { f: { family: 'A B', google: [400] } } }), 'https://fonts.googleapis.com/css2?family=A+B:wght@400&display=swap');
});

test('fontStack uses the trimmed family', () => {
  assert.match(renderTailwindTheme({ colors: { a: '#000' }, fonts: { s: { family: ' Inter ' } } }), /--font-s: "Inter", /);
  assert.equal(mergeThemeJson({}, { colors: { a: '#000' }, fonts: { s: { family: ' Inter ' } } }).settings.typography.fontFamilies[0].fontFamily.startsWith('"Inter",'), true);
});

test('validateTokens(null) reports a clear error', () => {
  assert.deepEqual(validateTokens(null), ['tokens: must be an object']);
  assert.deepEqual(validateTokens([]), ['tokens: must be an object']);
});

test('applyTokens throws before writing anything when style.css or theme.json is missing', () => {
  for (const missing of ['style.css', 'theme.json']) {
    const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-tok-'));
    fs.writeFileSync(path.join(theme, 'style.css'), '/*\nTheme Name: X\nProto Fork: p@1\n*/\nbody{}');
    fs.writeFileSync(path.join(theme, 'theme.json'), '{"version":3}');
    fs.writeFileSync(path.join(theme, 'tailwind-theme.css'), '@theme {}');
    fs.rmSync(path.join(theme, missing));
    initState(theme, { url: 'http://x.test', path: '/x' }); // fork guard: build state marks it as a fork
    assert.throws(() => applyTokens(theme, tokens), /ENOENT/);
    assert.equal(fs.readFileSync(path.join(theme, 'tailwind-theme.css'), 'utf8'), '@theme {}', missing);
    assert.deepEqual(fs.readdirSync(theme).filter((f) => f.endsWith('.tmp')), []);
  }
});

test('applyTokens leaves no .tmp files after success', () => {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-tok-'));
  fs.writeFileSync(path.join(theme, 'style.css'), '/*\nTheme Name: X\nProto Fork: p@1\n*/\nbody{}');
  fs.writeFileSync(path.join(theme, 'theme.json'), '{"version":3}');
  applyTokens(theme, tokens);
  assert.deepEqual(fs.readdirSync(theme).filter((f) => f.endsWith('.tmp')), []);
});

test('runApply saves state only after a successful compile', async () => {
  const mk = () => {
    const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-tok-'));
    fs.writeFileSync(path.join(theme, 'style.css'), '/*\nTheme Name: X\nProto Fork: p@1\n*/\nbody{}');
    fs.writeFileSync(path.join(theme, 'theme.json'), '{"version":3}');
    initState(theme, { url: 'http://x.test', path: '/x' });
    return theme;
  };
  const stateFile = (th) => fs.readFileSync(path.join(th, '.protoblocks', 'build.json'), 'utf8');

  const bad = mk();
  const before = stateFile(bad);
  await assert.rejects(runApply(bad, tokens, { compile: () => ({ success: false, message: 'tailwind exploded' }), download: fakeDownload() }), /tailwind exploded/);
  assert.equal(stateFile(bad), before, 'state untouched on failed compile');
  assert.ok(fs.existsSync(path.join(bad, 'tailwind-theme.css')), 'files were written before compile');

  const good = mk();
  const r = await runApply(good, tokens, { compile: () => ({ success: true }), download: fakeDownload() });
  assert.deepEqual(r.compiled, { success: true });
  assert.deepEqual(JSON.parse(stateFile(good)).site.tokens.colors, tokens.colors);

  const skipped = mk();
  await runApply(skipped, tokens, { compile: null, download: fakeDownload() });
  assert.deepEqual(JSON.parse(stateFile(skipped)).site.tokens.colors, tokens.colors);
});

test('applyTokens stages via .tmp files: a failing staged write leaves every target untouched', () => {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-tok-'));
  const files = { 'style.css': '/*\nTheme Name: X\nProto Fork: p@1\n*/\nbody{}', 'theme.json': '{"version":3}', 'tailwind-theme.css': '@theme {}' };
  for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(theme, f), c);
  fs.mkdirSync(path.join(theme, 'style.css.tmp')); // makes staging the last file fail
  assert.throws(() => applyTokens(theme, tokens));
  for (const [f, c] of Object.entries(files)) assert.equal(fs.readFileSync(path.join(theme, f), 'utf8'), c, f);
});

test('fallback items cannot contain quotes; non-generic items are quoted when rendered', () => {
  const e = (fallback) => validateTokens({ colors: { a: '#000' }, fonts: { f: { family: 'A', fallback } } });
  for (const fb of ['"', 'a"b', "x'", '"Helvetica Neue", Arial']) {
    assert.ok(e(fb).some((x) => x.startsWith('fonts.f:')), JSON.stringify(fb));
  }
  const css = renderTailwindTheme({ colors: { a: '#000' }, fonts: { f: { family: 'Inter', fallback: 'Helvetica Neue, Arial, sans-serif' } } });
  assert.match(css, /--font-f: "Inter", "Helvetica Neue", "Arial", sans-serif;/);
  const json = mergeThemeJson({}, { colors: { a: '#000' }, fonts: { f: { family: 'Inter', fallback: 'Helvetica Neue, serif' } } });
  assert.equal(json.settings.typography.fontFamilies[0].fontFamily, '"Inter", "Helvetica Neue", serif');
  for (const g of ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong']) {
    assert.match(renderTailwindTheme({ colors: { a: '#000' }, fonts: { f: { family: 'I', fallback: g } } }), new RegExp(`--font-f: "I", ${g};`), g);
  }
  assert.match(renderTailwindTheme({ colors: { a: '#000' }, fonts: { f: { family: 'Inter' } } }), /--font-f: "Inter", ui-sans-serif, system-ui, sans-serif;/);
});

test('free-text values reject quotes, !, <, >, tab and NUL', () => {
  for (const ch of ['"', "'", '!', '<', '>', '\t', '\0']) {
    const v = `0 0 1px red${ch}x`;
    assert.ok(validateTokens({ colors: { a: '#000' }, shadows: { s: v } }).some((x) => x.startsWith('shadows.s:')), JSON.stringify(ch));
    assert.ok(validateTokens({ colors: { a: '#000' }, shadows: { s: ch } }).some((x) => x.startsWith('shadows.s:')), `alone ${JSON.stringify(ch)}`);
  }
  assert.ok(validateTokens({ colors: { a: '#000' }, shadows: { a: '"' } }).some((x) => x.startsWith('shadows.a:')));
});

test('values must have balanced parentheses that form a single call for colours and lengths', () => {
  const bad = ['rgb(0 0 0))', 'rgb(1)(2)', '(rgb(0 0 0)', 'rgb(0 0 0'];
  for (const v of bad) assert.ok(validateTokens({ colors: { a: v } }).some((x) => x.startsWith('colors.a:')), `color ${v}`);
  for (const v of ['calc(1px))', 'calc(1px)(2px)', 'calc((1px)', 'calc(1px']) {
    assert.ok(validateTokens({ colors: { a: '#000' }, spacing: { s: v } }).some((x) => x.startsWith('spacing.s:')), `spacing ${v}`);
    assert.ok(validateTokens({ colors: { a: '#000' }, radii: { s: v } }).some((x) => x.startsWith('radii.s:')), `radii ${v}`);
    assert.ok(validateTokens({ colors: { a: '#000' }, type: { s: v } }).some((x) => x.startsWith('type.s:')), `type ${v}`);
  }
  for (const v of ['0 0 1px rgba(0,0,0,0.1))', '0 0 (1px', ') 0 0 red', '0 0 1px rgb(0)(', '0 0 1px red)(', ')(']) {
    assert.ok(validateTokens({ colors: { a: '#000' }, shadows: { s: v } }).some((x) => x.startsWith('shadows.s:')), `shadow ${v}`);
  }
  assert.deepEqual(validateTokens({ colors: { a: '#000' }, spacing: { s: 'calc(100% - 2rem)', t: 'clamp(1rem, 2vw, 3rem)', u: 'clamp(1rem, calc(1vw + 2px), min(3rem, 4rem))' },
    shadows: { s: '0 1px 2px rgba(0,0,0,0.1), 0 0 1px rgb(0 0 0 / 0.2)' } }), []);
});

test('shadows are whitelisted: stray punctuation, control and trailing-space values are rejected', () => {
  const sh = (v) => validateTokens({ colors: { a: '#000' }, shadows: { s: v } });
  for (const v of ['0 0 [', '0 0 ]', '0 0 $', '0 0 red;', '0 0 1px red ', ' 0 0 1px red', '0 0 1px \x7f', '0 0 1px =', '0 0 1px ^', '0 0 1px |', '0 0 1px ~', '0 0 1px `', '0 0 1px ?', '0 0 1px :', '0 0 1px &', '0 0 1px *', '0 0 1px é', '0 0 1px  x', '0 0 1px  x', '0 0 1px x', '0 0 1px\vx', '0 0 1px\fx', '0 0 1px​x']) {
    assert.ok(sh(v).some((x) => x.startsWith('shadows.s:')), JSON.stringify(v));
  }
  for (const v of ['0 6px 16px rgba(0,0,0,0.08)', '0 1px 2px rgb(0 0 0 / 0.2), inset 0 0 0 1px #e5e7eb', 'none']) {
    assert.deepEqual(sh(v), [], v);
  }
});

test('non-ASCII, vertical whitespace and other whitespace are rejected in colours, lengths and fallbacks', () => {
  const bad = ['é', ' ', ' ', '\v', '\f', ' ', '\x7f'];
  for (const ch of bad) {
    assert.ok(validateTokens({ colors: { a: `rgb(0${ch}0 0)` } }).some((x) => x.startsWith('colors.a:')), `color ${JSON.stringify(ch)}`);
    assert.ok(validateTokens({ colors: { a: '#000' }, spacing: { s: `calc(1px${ch}+ 2px)` } }).some((x) => x.startsWith('spacing.s:')), `spacing ${JSON.stringify(ch)}`);
    assert.ok(validateTokens({ colors: { a: '#000' }, type: { t: { size: '1px', lineHeight: `calc(1px${ch}+ 2px)` } } }).some((x) => x.startsWith('type.t:')), `lineHeight ${JSON.stringify(ch)}`);
    assert.ok(validateTokens({ colors: { a: '#000' }, fonts: { f: { family: 'A', fallback: `serif,${ch}Arial` } } }).some((x) => x.startsWith('fonts.f:')), `fallback ${JSON.stringify(ch)}`);
  }
  assert.deepEqual(validateTokens({ colors: { a: 'rgb(0 0 0)' }, spacing: { s: 'calc(1px + 2px)' } }), []);
});

test('fuzz: any shadow value that validates renders only well-formed @theme lines', () => {
  const LINE = /^( {2}\/\* [A-Za-z ]+ \*\/| {2}--[a-z0-9-]+: [A-Za-z0-9 .,%#()\-+/"]+;|)$/;
  // calc() legitimately needs `*` in colours/lengths; shadows get the strict set.
  const LINE_CALC = /^( {2}\/\* [A-Za-z ]+ \*\/| {2}--[a-z0-9-]+: [A-Za-z0-9 .,%#()\-+*/"]+;|)$/;
  const probe = (build, re = LINE) => {
    let accepted = 0;
    for (let cp = 0; cp <= 0x2fff; cp += 1) {
      const ch = String.fromCodePoint(cp);
      for (const suffix of ['', ' red', ')']) {
        const t = build(`0 0 1px ${ch}${suffix}`);
        if (validateTokens(t).length) continue;
        accepted += 1;
        const css = renderTailwindTheme(t);
        const body = css.slice(css.indexOf('@theme {') + '@theme {'.length, css.lastIndexOf('}'));
        assert.equal(css.indexOf('}'), css.lastIndexOf('}'), `stray brace for U+${cp.toString(16)}`);
        for (const line of body.split('\n').slice(1)) assert.match(line, re, `U+${cp.toString(16)} suffix ${JSON.stringify(suffix)}: ${JSON.stringify(line)}`);
      }
    }
    return accepted;
  };
  assert.ok(probe((v) => ({ colors: { a: '#000' }, shadows: { s: v } })) > 0, 'some characters should still be accepted');
  probe((v) => ({ colors: { a: v.replace(/^0 0 1px /, 'rgb(0 0 0 / ') + ')' } }), LINE_CALC);
  probe((v) => ({ colors: { a: '#000' }, spacing: { s: v.replace(/^0 0 1px /, 'calc(1px + ') + ')' } }), LINE_CALC);
});

// ---- I3: the design's fonts reach theme.json styles and the fork's style.css ----
const UPSTREAM_STYLE = `/*
Theme Name: Acme
Text Domain: acme
Proto Fork: proto-blocks-theme@1.1.3
*/

/* Optional web font — swap or remove. */
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap");

/* Base typography */
body {
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI",
    Roboto, Helvetica, Arial, sans-serif;
}

.wp-site-blocks {
  display: flex;
}
.editor-styles-wrapper body {
  font-family: serif;
}
`;

test('bodyFontSlug prefers body, then sans, then text/base, then the first font', () => {
  assert.equal(bodyFontSlug({ fonts: { display: { family: 'A' }, sans: { family: 'B' }, body: { family: 'C' } } }), 'body');
  assert.equal(bodyFontSlug({ fonts: { display: { family: 'A' }, sans: { family: 'B' } } }), 'sans');
  assert.equal(bodyFontSlug({ fonts: { display: { family: 'A' }, text: { family: 'B' } } }), 'text');
  assert.equal(bodyFontSlug({ fonts: { display: { family: 'A' }, mono: { family: 'B' } } }), 'display');
  assert.equal(bodyFontSlug({ colors: { a: '#000' } }), null);
});

test('presetVar names presets the way WordPress kebab-cases slugs', () => {
  assert.equal(presetVar('sans'), 'var(--wp--preset--font-family--sans)');
  assert.equal(presetVar('sans2'), 'var(--wp--preset--font-family--sans-2)');
  assert.equal(presetVar('body-text'), 'var(--wp--preset--font-family--body-text)');
});

test('mergeThemeJson sets styles.typography.fontFamily to the body font preset and keeps other styles', () => {
  const base = { version: 3, styles: { color: { text: '#000' }, typography: { lineHeight: '1.5' } } };
  const out = mergeThemeJson(base, tokens);
  assert.equal(out.styles.typography.fontFamily, 'var(--wp--preset--font-family--sans)');
  assert.equal(out.styles.typography.lineHeight, '1.5');
  assert.deepEqual(out.styles.color, { text: '#000' });
  assert.equal(base.styles.typography.fontFamily, undefined, 'input not mutated');
  assert.equal(mergeThemeJson({ version: 3 }, { colors: { a: '#000' } }).styles, undefined, 'no fonts: styles untouched');
});

test('rewriteBodyFont replaces only the top-level body font-family inside a managed region, idempotently', () => {
  const stack = '"Fraunces", ui-serif, serif';
  const once = rewriteBodyFont(UPSTREAM_STYLE, stack);
  assert.equal(once.warning, undefined);
  assert.match(once.css, /body \{\n  font-family: "Fraunces", ui-serif, serif;\n\}/);
  assert.doesNotMatch(once.css, /Roboto, Helvetica/);
  assert.match(once.css, /\.editor-styles-wrapper body \{\n  font-family: serif;/, 'other rules untouched');
  assert.equal(once.css.split('protoblocks: body font').length - 1, 2, 'one start and one end marker');
  assert.equal(rewriteBodyFont(once.css, stack).css, once.css, 'idempotent');
  const changed = rewriteBodyFont(once.css, '"Inter", ui-sans-serif, sans-serif').css;
  assert.match(changed, /font-family: "Inter", ui-sans-serif, sans-serif;/);
  assert.doesNotMatch(changed, /Fraunces/);
  assert.equal(changed.split('protoblocks: body font').length - 1, 2);
  // Everything outside the body rule is byte-identical.
  const strip = (c) => c.replace(/\/\* >>> protoblocks: body font[\s\S]*?<<< protoblocks: body font \*\//, '').replace(/^body \{[^}]*\}/m, '');
  assert.equal(strip(once.css), strip(UPSTREAM_STYLE));
});

test('rewriteBodyFont keeps other declarations in the body rule', () => {
  const r = rewriteBodyFont('body {\n  margin: 0;\n  font-family: Inter;\n  color: red;\n}\n', '"X", serif');
  assert.match(r.css, /margin: 0;\n  font-family: "X", serif;\n  color: red;/);
});

test('rewriteBodyFont without a body font-family rule warns and changes nothing', () => {
  for (const css of ['/*\nTheme Name: X\n*/\nbody{}', '/*\nTheme Name: X\n*/\n.x{font-family:a;}', 'body.home { font-family: a; }']) {
    const r = rewriteBodyFont(css, '"X", serif');
    assert.equal(r.css, css);
    assert.match(r.warning, /body/);
  }
});

test('applyTokens applies the body font to style.css and theme.json; warns when the rule is missing', () => {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-tok-'));
  fs.writeFileSync(path.join(theme, 'style.css'), UPSTREAM_STYLE);
  fs.writeFileSync(path.join(theme, 'theme.json'), '{"version":3}');
  const r = applyTokens(theme, { colors: { a: '#000' }, fonts: { display: { family: 'Fraunces' }, sans: { family: 'Work Sans', google: [400] } } });
  const css = fs.readFileSync(path.join(theme, 'style.css'), 'utf8');
  assert.match(css, /body \{\n  font-family: "Work Sans", ui-sans-serif, system-ui, sans-serif;\n\}/);
  assert.doesNotMatch(css, /fonts\.googleapis\.com/, 'no Google Fonts import: fonts are self-hosted by runApply');
  assert.equal(JSON.parse(fs.readFileSync(path.join(theme, 'theme.json'), 'utf8')).styles.typography.fontFamily, 'var(--wp--preset--font-family--sans)');
  assert.equal(r.warnings, undefined);

  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-tok-'));
  fs.writeFileSync(path.join(bare, 'style.css'), '/*\nTheme Name: X\nProto Fork: p@1\n*/\n.x{}');
  fs.writeFileSync(path.join(bare, 'theme.json'), '{"version":3}');
  const w = applyTokens(bare, { colors: { a: '#000' }, fonts: { sans: { family: 'Inter' } } });
  assert.ok(w.warnings.some((x) => /body/.test(x)), JSON.stringify(w));
});
