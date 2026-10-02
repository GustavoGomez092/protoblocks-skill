---
description: Run the Yoast SEO step (infer, apply, audit, fix) for a built page
argument-hint: "<page slug>"
---
Load the `protoblocks-site-builder` skill. Page: $ARGUMENTS

Shell variables do not persist between Bash commands: start every command with the literal `PB="${CLAUDE_PLUGIN_ROOT}/skills/protoblocks-site-builder/scripts"; THEME="<fork dir>";` (or use full paths).

1. Run preflight (`node "${CLAUDE_PLUGIN_ROOT}/skills/protoblocks-site-builder/scripts/lib/preflight.mjs"`) and find the theme with `node "${CLAUDE_PLUGIN_ROOT}/skills/protoblocks-site-builder/scripts/lib/status.mjs" --root "<report.publicPath>"`.
2. Look the page up by slug in state. The page status must be `seo` or `done`; otherwise report that the page is not ready (`record-audit` would refuse later) and run `status.mjs` for `next.action` instead. If any of its sections is open (`building`, `verifying`, `animating`), do NOT proceed to SEO: `seo.mjs record-audit` refuses with `[ESTATUS]` while a section is open. Report the open sections and run the section loop first (`status.mjs` gives `next.action`). Run the SEO apply step on such a page only if the developer asked for it explicitly, and say that `record-audit` stays blocked until the sections close.
3. Otherwise load `protoblocks-seo` and run it for the page (also for a page already `done`: re-applying sets it back to `seo`). Follow its question list (what the developer wants to provide, noindex, and so on); never add `--force` or `--force-organization` without the developer's explicit OK, and on `[EEDITED]` show what changed and ask first.
