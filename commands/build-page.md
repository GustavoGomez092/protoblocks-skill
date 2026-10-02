---
description: Build a landing page from a design (image path, Figma/Penpot link, or URL) with Proto-Blocks
argument-hint: "<design path or URL> [page slug]"
---
Load the `protoblocks-site-builder` skill. Design and optional page slug: $ARGUMENTS

Shell variables do not persist between Bash commands: start every command with the literal `PB="${CLAUDE_PLUGIN_ROOT}/skills/protoblocks-site-builder/scripts"; THEME="<fork dir>";` (or use full paths).

Run the skill's loop: preflight (`node "${CLAUDE_PLUGIN_ROOT}/skills/protoblocks-site-builder/scripts/lib/preflight.mjs"`), find the theme with `status.mjs --root`, then `status.mjs` and do exactly `next.action`. The order is: setup if needed, intake this design as a new page, breakdown (STOP at the plan gate until the developer approves), sections, page QA, SEO, then ask about the menu and more pages. If no page slug was given, propose one and confirm it. Follow the skill's question list exactly; never add `--force` (or `--confirm`, `--refork`) without the developer's explicit OK for that action, and never approve the plan or accept QA differences for the developer.
