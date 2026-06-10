# Proto-Blocks Skill

A [skill](https://docs.anthropic.com/en/docs/claude-code/skills) that teaches an AI coding agent how to build WordPress Gutenberg blocks with the [Proto-Blocks](https://github.com/GustavoGomez092/Proto-Blocks) plugin — PHP-template blocks defined in `block.json` with `data-proto-*` fields, controls, repeaters, inner blocks, and optional Tailwind. With it installed, you can ask your agent for "a Proto-Blocks testimonial block" or "a Tailwind hero with an image control" and get clean, idiomatic, correct-by-construction code.

It is delivered as a Claude Code plugin (auto-discovered skill) and is grounded in the Proto-Blocks plugin source + README, structured for progressive disclosure: a small always-loaded `SKILL.md` plus focused reference files the agent reads only when relevant.

> **Two pieces, don't confuse them.** This repo is the *skill* (how an agent builds blocks). The blocks it produces run on the **Proto-Blocks WordPress plugin**, which must be installed and active in your WordPress site — get it from [GustavoGomez092/Proto-Blocks](https://github.com/GustavoGomez092/Proto-Blocks). Requirements there: WordPress 6.3+, PHP 8.0+.

---

## Install

### Claude Code (recommended)

Add this repo as a plugin marketplace, then install the plugin:

```
/plugin marketplace add GustavoGomez092/protoblocks-skill
/plugin install protoblocks-skill@protoblocks
```

- `protoblocks-skill` is the plugin name; `protoblocks` is the marketplace name (both defined in `.claude-plugin/`).
- Or run `/plugin`, open **Browse marketplaces → protoblocks**, and install from the menu.
- Restart Claude Code if prompted. That's it — no build step, no dependencies.

### Manual (any Claude environment)

Copy the skill folder into your personal skills directory:

```bash
git clone https://github.com/GustavoGomez092/protoblocks-skill.git
cp -r protoblocks-skill/skills/protoblocks ~/.claude/skills/protoblocks
```

### Other agent environments

The skill is plain Markdown and portable. Tool names inside use Claude Code conventions, but the knowledge applies anywhere:

- **Codex / OpenAI agents:** copy `skills/protoblocks/` into `~/.agents/skills/protoblocks/`.
- **GitHub Copilot CLI:** install the plugin from this marketplace (skills are auto-discovered) the same way as Claude Code.
- **Gemini CLI / others:** point the agent at `skills/protoblocks/SKILL.md` and let it open the `references/*.md` files on demand, or paste `SKILL.md` into context.

---

## Verify it's installed

In Claude Code:

```
/plugin
```

`protoblocks-skill` should appear under installed plugins. You can also just ask: *"List your available skills"* — `protoblocks` should be listed.

---

## Updating (if already installed)

The skill is distributed from a git marketplace, so updating is two steps: refresh the marketplace, then pull the new plugin version.

### Claude Code

```
/plugin marketplace update protoblocks      # fetch latest commits from the marketplace repo
/plugin uninstall protoblocks-skill@protoblocks
/plugin install protoblocks-skill@protoblocks
/reload-plugins                             # activate the update (no full restart needed)
```

There is no single `/plugin update` command today — reinstalling is the supported way to move to the latest version. After it completes, Claude Code prompts for `/reload-plugins` (run it if not prompted).

**Prefer hands-off?** Enable auto-update for the marketplace: run `/plugin` → **Marketplaces** tab → select `protoblocks` → **Enable auto-update**. Claude Code then refreshes the marketplace and updates installed plugins at startup, prompting `/reload-plugins` when something changed.

> Use the `plugin@marketplace` form (`protoblocks-skill@protoblocks`) for `install`/`uninstall`, and the bare marketplace name (`protoblocks`) for `marketplace update`.

> **Maintainers — bump the version every release.** The install cache is keyed by the `version` in `.claude-plugin/plugin.json` **and** `.claude-plugin/marketplace.json`. If you push content changes without bumping that version, `marketplace update` + reinstall sees "already at 1.x" and keeps serving the **stale cached copy** — the new content never lands. Bump both `version` fields (e.g. `1.0.0` → `1.1.0`) in the same commit as any skill content change.

### Manual install

If you copied the skill into `~/.claude/skills/` instead of using the marketplace, update by re-pulling and re-copying:

```bash
git clone https://github.com/GustavoGomez092/protoblocks-skill.git
rm -rf ~/.claude/skills/protoblocks
cp -r protoblocks-skill/skills/protoblocks ~/.claude/skills/protoblocks
```

(Or `git pull` in your existing clone, then re-run the `cp -r` step.)

---

## Uninstall

### Claude Code

```
/plugin uninstall protoblocks-skill@protoblocks
/plugin marketplace remove protoblocks      # optional: also remove the marketplace
```

Or remove both via the `/plugin` menu.

### Manual

```bash
rm -rf ~/.claude/skills/protoblocks
```

---

## Using it

**As a user:** just describe what you want — the agent loads the skill automatically when your request is about Proto-Blocks. Examples:

- "Create a Proto-Blocks pricing table with 3 plans and a highlight toggle."
- "Add a repeater of logos to my block."
- "My inner blocks render empty on the frontend — why?"
- "Convert this card to use Tailwind."

If the agent doesn't pick it up, nudge it: *"Use the protoblocks skill."*

**For LLMs / agents:** when a task involves Proto-Blocks, load the skill and **start at `SKILL.md`** (overview, anatomy, quick-reference tables, iron rules), then open only the reference files you need. For building a new block, begin with `references/authoring-workflow.md`; to choose how to model content, read `references/composition.md`; to find a starting point for a common module, use `references/recipes.md`.

---

## What's inside

```
protoblocks-skill/
├── .claude-plugin/
│   ├── marketplace.json          # marketplace metadata
│   └── plugin.json               # plugin metadata
└── skills/
    └── protoblocks/
        ├── SKILL.md              # always-loaded: overview, anatomy, quick reference, iron rules
        └── references/           # loaded on demand
            ├── authoring-workflow.md   # ← start here to build a block (end-to-end)
            ├── recipes.md              # "I want to build X" → fields/controls/pattern
            ├── composition.md          # discrete fields vs wysiwyg vs inner-blocks vs repeater
            ├── schema.md               # block.json / protoBlocks schema + validation
            ├── fields.md               # field types, value shapes, custom fields
            ├── controls.md             # control types, conditional visibility
            ├── templates.md            # template vars, data-proto-*, escaping
            ├── repeaters.md            # repeater markup, ids, min/max, nesting
            ├── styling.md              # vanilla CSS vs Tailwind, themed colors, theme tokens
            ├── interactivity.md        # viewScript/module, Interactivity API (full accordion + tabs)
            ├── previews.md             # inserter thumbnails (Preview Capture / preview.png)
            ├── examples.md             # 9-block gallery, capability matrix, canonical samples
            ├── cli-and-hooks.md        # WP-CLI, hooks, discovery, category, admin, debug
            └── troubleshooting.md      # symptom → cause → fix
```

## What it covers

- All field types (text, wysiwyg, image, video, link, repeater, inner-blocks) — config, value shapes, sanitization, custom field registration.
- All control types (text, textarea, select, toggle, checkbox, range, number, color, color-palette, radio, image, video) + conditional rendering & composition (`conditions.visible`).
- The full `block.json` / `protoBlocks` schema, defaults, and validation (errors vs warnings).
- Template authoring: variables, the `data-proto-*` system, escaping, editor-preview detection, caching.
- Repeaters (ids, min/max, nested object sub-fields) and inner blocks (correct hyphenated type + `$innerBlocksContent`).
- Composition judgment (avoiding field proliferation), an authoring workflow, and recipes for ~14 module types.
- Styling: vanilla CSS vs Tailwind (automatic compilation, dev/prod modes), themed colors, `tailwind-theme.css` `@theme` tokens, scoped preflight.
- Frontend interactivity: plain JS, ES modules, and the WordPress Interactivity API — with the complete Accordion and a Tabs pattern inline — plus loading JS in the editor for third-party embeds (e.g. HubSpot forms) via `enqueue_block_assets`.
- WP-CLI, hooks/filters, block discovery, category, preview capture, demo blocks, debug mode, troubleshooting.

## Keeping it in sync

When the Proto-Blocks plugin gains field/control types, schema keys, CLI commands, or features, update the relevant `references/*.md` and `SKILL.md` quick-reference tables. The plugin's `examples/` folder is always the authoritative source for working block code.

## License

MIT. (The Proto-Blocks WordPress plugin it documents is GPL-2.0-or-later.)
