// The one slug rule for page slugs and block names: lowercase letters and digits, separated by single dashes.
// It is also what WordPress' sanitize_title() leaves unchanged for ASCII input; page.php keeps that check as
// defence in depth. Validate before any file or state write, so a slug can never become a path segment like "..".
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const isSlug = (value) => typeof value === 'string' && SLUG_RE.test(value);

export function assertSlug(value, what = 'slug', code = 'EINPUT') {
  if (!isSlug(value)) {
    throw Object.assign(new Error(`Invalid ${what} ${JSON.stringify(value ?? null)}: use lowercase letters and digits separated by single dashes (e.g. "about-us").`), { code });
  }
  return value;
}

/**
 * Block names: "<slug>" or "<namespace>/<slug>", each part a slug. A bare slug means "proto-blocks/<slug>".
 * Shared by plan.mjs, page.mjs, gates.mjs and parts.mjs.
 */
export function parseBlockName(value, what = 'block name', code = 'EINPUT') {
  const parts = typeof value === 'string' ? value.split('/') : [];
  if (!parts.length || parts.length > 2 || !parts.every(isSlug)) {
    throw Object.assign(new Error(`Invalid ${what} ${JSON.stringify(value ?? null)}: use "<slug>" or "<namespace>/<slug>" (lowercase letters and digits separated by single dashes).`), { code });
  }
  const [namespace, slug] = parts.length === 2 ? parts : ['proto-blocks', parts[0]];
  return { namespace, slug, name: `${namespace}/${slug}` };
}
