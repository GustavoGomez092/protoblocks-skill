---
description: Prepare the current Local site for a Proto-Blocks build (plugins, theme fork, motion, tokens, menus)
argument-hint: "[project name] [--site <Local site name>]"
---
Load the `protoblocks-site-builder` skill. Arguments: $ARGUMENTS

Shell variables do not persist between Bash commands: start every command with the literal `PB="${CLAUDE_PLUGIN_ROOT}/skills/protoblocks-site-builder/scripts"; THEME="<fork dir>";` (or use full paths).

1. Run preflight: `node "${CLAUDE_PLUGIN_ROOT}/skills/protoblocks-site-builder/scripts/lib/preflight.mjs"`, adding `--site "<name>"` if one was given above. Follow the skill's loop step 1 for failures.
2. Find the theme with `node "${CLAUDE_PLUGIN_ROOT}/skills/protoblocks-site-builder/scripts/lib/status.mjs" --root "<report.publicPath>"`, then run `status.mjs` on it.
3. Perform only the `setup` action, with the `protoblocks-site-setup` skill: plugins, theme fork, motion install. If setup was already started, `why` names the missing steps: do only those. Ask the project name if it was not given. Follow the skill's question list; never add `--force`, `--refork` or `--update-plugins` without the developer's explicit OK for that action.
4. If a design was provided, also intake its frames, apply tokens, navigation and the header/footer parts as the skill's `setup` row says. Otherwise stop after the fork and report the theme path and what is needed next (a design).
