import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';
import {
  validateTokens, renderTailwindTheme, mergeThemeJson, googleFontsUrl, rewriteFontImport, applyTokens, runApply,
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

test('google fonts url and import rewrite', () => {
  assert.equal(googleFontsUrl(tokens), 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=DM+Serif+Display:wght@400&display=swap');
  const style = '/*\nTheme Name: X\n*/\n\n/* Optional web font — swap or remove. */\n@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap");\nbody{}';
  const out = rewriteFontImport(style, tokens);
  assert.equal(out.match(/@import url/g).length, 1);
  assert.ok(out.includes('family=DM+Serif+Display'));
  const none = rewriteFontImport(style, { colors: { a: '#000' } });
  assert.ok(!none.includes('@import url'));
  const inserted = rewriteFontImport('/*\nTheme Name: X\n*/\nbody{}', tokens);
  assert.match(inserted, /\*\/\n@import url\("https:\/\/fonts\.googleapis\.com/);
});

test('rewriteFontImport collapses several existing Google imports into exactly one', () => {
  const imp = (f) => `@import url("https://fonts.googleapis.com/css2?family=${f}&display=swap");\n`;
  const style = `/*\nTheme Name: X\n*/\n${imp('A')}${imp('B')}${imp('C')}body{}`;
  const out = rewriteFontImport(style, tokens);
  assert.equal(out.match(/@import url/g).length, 1);
  assert.ok(out.includes('family=DM+Serif+Display'));
  assert.ok(!out.includes('family=A&') && !out.includes('family=B&') && !out.includes('family=C&'));
  assert.ok(out.endsWith('body{}'));
  // removal of all imports when no google fonts, including repeated ones
  const none = rewriteFontImport(style, { colors: { a: '#000' }, fonts: { s: { family: 'Local' } } });
  assert.ok(!none.includes('@import'));
  assert.ok(none.includes('body{}'));
  // idempotent: re-running keeps exactly one import
  assert.equal(rewriteFontImport(out, tokens), out);
});

test('applyTokens writes three files, and writes nothing when invalid', () => {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-tok-'));
  fs.writeFileSync(path.join(theme, 'style.css'), '/*\nTheme Name: X\n*/\nbody{}');
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
  const files = { 'style.css': '/*\nTheme Name: X\n*/\nbody{}', 'theme.json': '{"version":3,"settings":{}}', 'tailwind-theme.css': '@theme {}' };
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
  assert.deepEqual(e({ family: 'A', fallback: '"Helvetica Neue", Arial, sans-serif' }), []);
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
    fs.writeFileSync(path.join(theme, 'style.css'), '/*\nTheme Name: X\n*/\nbody{}');
    fs.writeFileSync(path.join(theme, 'theme.json'), '{"version":3}');
    fs.writeFileSync(path.join(theme, 'tailwind-theme.css'), '@theme {}');
    fs.rmSync(path.join(theme, missing));
    assert.throws(() => applyTokens(theme, tokens), /ENOENT/);
    assert.equal(fs.readFileSync(path.join(theme, 'tailwind-theme.css'), 'utf8'), '@theme {}', missing);
    assert.deepEqual(fs.readdirSync(theme).filter((f) => f.endsWith('.tmp')), []);
  }
});

test('applyTokens leaves no .tmp files after success', () => {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-tok-'));
  fs.writeFileSync(path.join(theme, 'style.css'), '/*\nTheme Name: X\n*/\nbody{}');
  fs.writeFileSync(path.join(theme, 'theme.json'), '{"version":3}');
  applyTokens(theme, tokens);
  assert.deepEqual(fs.readdirSync(theme).filter((f) => f.endsWith('.tmp')), []);
});

test('runApply saves state only after a successful compile', () => {
  const mk = () => {
    const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-tok-'));
    fs.writeFileSync(path.join(theme, 'style.css'), '/*\nTheme Name: X\n*/\nbody{}');
    fs.writeFileSync(path.join(theme, 'theme.json'), '{"version":3}');
    initState(theme, { url: 'http://x.test', path: '/x' });
    return theme;
  };
  const stateFile = (th) => fs.readFileSync(path.join(th, '.protoblocks', 'build.json'), 'utf8');

  const bad = mk();
  const before = stateFile(bad);
  assert.throws(() => runApply(bad, tokens, { compile: () => ({ success: false, message: 'tailwind exploded' }) }), /tailwind exploded/);
  assert.equal(stateFile(bad), before, 'state untouched on failed compile');
  assert.ok(fs.existsSync(path.join(bad, 'tailwind-theme.css')), 'files were written before compile');

  const good = mk();
  const r = runApply(good, tokens, { compile: () => ({ success: true }) });
  assert.deepEqual(r.compiled, { success: true });
  assert.deepEqual(JSON.parse(stateFile(good)).site.tokens.colors, tokens.colors);

  const skipped = mk();
  runApply(skipped, tokens, { compile: null });
  assert.deepEqual(JSON.parse(stateFile(skipped)).site.tokens.colors, tokens.colors);
});

test('applyTokens stages via .tmp files: a failing staged write leaves every target untouched', () => {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-tok-'));
  const files = { 'style.css': '/*\nTheme Name: X\n*/\nbody{}', 'theme.json': '{"version":3}', 'tailwind-theme.css': '@theme {}' };
  for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(theme, f), c);
  fs.mkdirSync(path.join(theme, 'style.css.tmp')); // makes staging the last file fail
  assert.throws(() => applyTokens(theme, tokens));
  for (const [f, c] of Object.entries(files)) assert.equal(fs.readFileSync(path.join(theme, f), 'utf8'), c, f);
});
