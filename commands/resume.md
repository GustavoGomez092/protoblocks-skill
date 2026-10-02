---
description: Resume an interrupted Proto-Blocks site build from its saved state
---
Load the `protoblocks-site-builder` skill.

Shell variables do not persist between Bash commands: start every command with the literal `PB="${CLAUDE_PLUGIN_ROOT}/skills/protoblocks-site-builder/scripts"; THEME="<fork dir>";` (or use full paths).

1. Run preflight: `node "${CLAUDE_PLUGIN_ROOT}/skills/protoblocks-site-builder/scripts/lib/preflight.mjs"` (add `--site "<name>"` if it lists several sites and the developer chose one).
2. Find the theme from preflight's `publicPath`: `node "${CLAUDE_PLUGIN_ROOT}/skills/protoblocks-site-builder/scripts/lib/status.mjs" --root "<publicPath>"`. Do not guess the active theme. `themeDir` set: that is THEME. `themeDir: null`: nothing was built yet, so say so and offer `/protoblocks-skill:setup-site`. A `themes` list: ask the developer which fork, then run `status.mjs` with that theme folder.
3. Summarize where the build is in one short table (pages, status, open sections, `next`), then continue with `next.action` as the skill's actions table says. Follow the skill's question list; never add `--force` (or `--confirm`, `--refork`) without the developer's explicit OK for that action.
