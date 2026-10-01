#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { exec as realExec } from './exec.mjs';
import { createWp, loadRuntime } from './wp.mjs';
import { fetchLatestRelease } from './releases.mjs';
import { download, unzip } from './download.mjs';

export const THEME_REPO = 'GustavoGomez092/proto-blocks-theme';

export class ForkError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

export function slugify(name) {
  const s = String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  if (!s) { const e = new Error(`Cannot derive a theme slug from "${name}"`); e.code = 'ESLUG'; throw e; }
  return s;
}

export function forkMarker(css) {
  const m = css.match(/^Proto Fork:\s*(.+?)\s*$/m);
  return m ? m[1] : null;
}

export function rewriteStyleHeader(css, { name, slug, forkedFrom }) {
  let out = css
    .replace(/^Theme Name:.*$/m, `Theme Name: ${name}`)
    .replace(/^Text Domain:.*$/m, `Text Domain: ${slug}`)
    .replace(/^Version:.*$/m, 'Version: 1.0.0')
    .replace(/^Description:.*$/m, `Description: ${name} — built with Proto-Blocks (forked from ${forkedFrom}).`);
  if (/^Proto Fork:.*$/m.test(out)) out = out.replace(/^Proto Fork:.*$/m, `Proto Fork: ${forkedFrom}`);
  else out = out.replace(/^(Text Domain:.*)$/m, `$1\nProto Fork: ${forkedFrom}`);
  return out;
}

export const rewriteTextDomain = (src, slug) => src.replaceAll("'proto-theme'", `'${slug}'`);

function textDomainFiles(themeDir) {
  const files = [path.join(themeDir, 'functions.php')];
  for (const sub of ['inc', 'assets/editor']) {
    const dir = path.join(themeDir, sub);
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (/\.(php|js)$/.test(f)) files.push(path.join(dir, f));
  }
  return files.filter((f) => fs.existsSync(f));
}

function gitInit(themeDir, forkedFrom, exec) {
  if (exec('git', ['--version']).code !== 0 || fs.existsSync(path.join(themeDir, '.git'))) return false;
  exec('git', ['init', '-q'], { cwd: themeDir });
  exec('git', ['add', '-A'], { cwd: themeDir });
  const hasIdentity = exec('git', ['config', 'user.email'], { cwd: themeDir }).stdout.trim() !== '';
  const id = hasIdentity ? [] : ['-c', 'user.name=protoblocks', '-c', 'user.email=protoblocks@localhost'];
  return exec('git', [...id, 'commit', '-q', '-m', `chore: fork ${forkedFrom}`], { cwd: themeDir }).code === 0;
}

export function forkTheme({ wp, themesDir, name, slug = slugify(name), force = false, zipFile, forkedFrom, exec = realExec }) {
  const themeDir = path.join(themesDir, slug);
  if (fs.existsSync(themeDir)) {
    const style = path.join(themeDir, 'style.css');
    const marker = fs.existsSync(style) ? forkMarker(fs.readFileSync(style, 'utf8')) : null;
    if (marker && !force) {
      wp.check(['theme', 'activate', slug]);
      return { themeDir, slug, reused: true, forkedFrom: marker };
    }
    if (!force) {
      throw new ForkError(`wp-content/themes/${slug} already exists and is not a protoblocks fork. Ask the developer; re-run with --force to replace it (this deletes that folder).`, 'EFORKEXISTS');
    }
    fs.rmSync(themeDir, { recursive: true, force: true });
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-theme-'));
  const entries = unzip(zipFile, tmp);
  const src = entries.map((e) => path.join(tmp, e)).find((p) => fs.existsSync(path.join(p, 'style.css')));
  if (!src) throw new ForkError(`No theme folder with style.css inside ${zipFile}`, 'ENOTHEME');
  fs.cpSync(src, themeDir, { recursive: true });
  fs.rmSync(tmp, { recursive: true, force: true });

  const stylePath = path.join(themeDir, 'style.css');
  fs.writeFileSync(stylePath, rewriteStyleHeader(fs.readFileSync(stylePath, 'utf8'), { name, slug, forkedFrom }));
  for (const f of textDomainFiles(themeDir)) fs.writeFileSync(f, rewriteTextDomain(fs.readFileSync(f, 'utf8'), slug));

  gitInit(themeDir, forkedFrom, exec);
  wp.check(['theme', 'activate', slug]);
  return { themeDir, slug, reused: false, forkedFrom };
}

export async function fetchThemeZip({ fetchRelease = fetchLatestRelease } = {}) {
  const rel = await fetchRelease(THEME_REPO);
  const zipFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pb-themezip-')), `proto-theme-${rel.version}.zip`);
  await download(rel.zipUrl, zipFile);
  return { zipFile, forkedFrom: `proto-blocks-theme@${rel.version}` };
}

async function main(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--force') a.force = true;
    else if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[++i];
  }
  if (!a.name) { process.stderr.write('Usage: node theme-fork.mjs --name "<Project>" [--slug s] [--force] [--cwd D]\n'); process.exit(64); }
  const rt = loadRuntime(a.cwd ?? process.cwd());
  const { zipFile, forkedFrom } = await fetchThemeZip();
  const r = forkTheme({ wp: createWp(rt), themesDir: path.join(rt.publicPath, 'wp-content', 'themes'), name: a.name, slug: a.slug, force: !!a.force, zipFile, forkedFrom });
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); });
}
