import { compareVersions } from './preflight.mjs';

const SEMVER_TAG = /^v(\d+\.\d+\.\d+)$/;

export function pickRelease(releases) {
  const candidates = releases
    .filter((r) => !r.draft && !r.prerelease && SEMVER_TAG.test(r.tag_name ?? ''))
    .map((r) => ({ r, version: r.tag_name.match(SEMVER_TAG)[1], zip: (r.assets ?? []).find((a) => a.name?.endsWith('.zip')) }))
    .filter((c) => c.zip)
    .sort((a, b) => compareVersions(b.version, a.version));
  const best = candidates[0];
  return best ? { tag: best.r.tag_name, version: best.version, zipUrl: best.zip.browser_download_url } : null;
}

export async function fetchLatestRelease(repo, { fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(`https://api.github.com/repos/${repo}/releases?per_page=30`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'protoblocks-site-builder' },
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    const e = new Error(`GitHub releases for ${repo}: ${err.message}`);
    e.code = 'ERELEASE';
    throw e;
  }
  if (!res.ok) {
    const e = new Error(`GitHub releases for ${repo}: HTTP ${res.status} ${res.statusText ?? ''}`.trim());
    e.code = 'ERELEASE';
    throw e;
  }
  let body;
  try {
    body = await res.json();
  } catch (err) {
    const e = new Error(`GitHub releases for ${repo}: invalid response body`);
    e.code = 'ERELEASE';
    throw e;
  }
  if (!Array.isArray(body)) {
    const e = new Error(`GitHub releases for ${repo}: expected array, got ${typeof body}`);
    e.code = 'ERELEASE';
    throw e;
  }
  const picked = pickRelease(body);
  if (!picked) {
    const e = new Error(`No vX.Y.Z release with a .zip asset found for ${repo}`);
    e.code = 'ERELEASE';
    throw e;
  }
  return picked;
}
