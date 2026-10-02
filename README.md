# Proto-Blocks Skill

A Claude Code plugin that is both a docs hub and a design-to-WordPress site builder. Its docs-hub [skill](https://docs.anthropic.com/en/docs/claude-code/skills) teaches an AI coding agent how to build WordPress Gutenberg blocks with the [Proto-Blocks](https://github.com/GustavoGomez092/Proto-Blocks) plugin — PHP-template blocks defined in `block.json` with `data-proto-*` fields, controls, repeaters, inner blocks, and optional Tailwind. With it installed, you can ask your agent for "a Proto-Blocks testimonial block" or "a Tailwind hero with an image control" and get clean, idiomatic, correct-by-construction code.

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

Seven skills, four commands and one agent.

### Skills

| Skill | What it does |
|---|---|
| `protoblocks` | The docs hub: how to build, scaffold and debug Proto-Blocks (`block.json`, `template.php`, fields, controls, repeaters, inner blocks, Tailwind, interactivity). |
| `protoblocks-site-builder` | The orchestrator: runs preflight, keeps a resumable build state, and drives the whole design-to-page pipeline below. |
| `protoblocks-site-setup` | Prepares the Local site: installs Proto-Blocks and Yoast, forks and activates `proto-blocks-theme`, applies design tokens, creates navigation menus, wires header/footer parts. |
| `protoblocks-design-breakdown` | Normalizes a design (image, PDF, Figma, Penpot, URL), crops its sections, maps each to reuse/extend/new blocks and gets your approval of the plan. |
| `protoblocks-section-loop` | Builds one section, runs the build gates, dispatches visual QA and fixes until it matches its crop (with an iteration cap). |
| `protoblocks-motion` | Adds GSAP scroll/entrance motion through the theme's `pb-motion` data-attribute presets, then verifies it. |
| `protoblocks-seo` | Sets Yoast SEO data (focus keyword, title, description, social, schema), then audits the rendered page. |

### Commands

| Command | Use it to |
|---|---|
| `/protoblocks-skill:setup-site` | Prepare the current Local site (plugins, theme fork, motion, tokens, menus). |
| `/protoblocks-skill:build-page` | Build a landing page from a design path, Figma/Penpot link or URL. |
| `/protoblocks-skill:seo` | Run the Yoast SEO step (infer, apply, audit, fix) for a built page. |
| `/protoblocks-skill:resume` | Resume an interrupted build from its saved state. |

### Agent

`protoblocks-skill:visual-qa` verifies one built section against its design crops. It runs the screenshot, diff and sanity scripts, looks at the design/render/heatmap composites and returns only a verdict. It measures and judges; it never fixes. The section loop dispatches it once per section per iteration.

## Site builder

### Requirements

- [Local by Flywheel](https://localwp.com/) or any local WordPress with WP-CLI.
- Node 18 or newer.
- Proto-Blocks 2.10.1 or newer (setup installs it).
- A fork of `proto-blocks-theme` (setup creates and activates it).
- Yoast SEO (setup installs it).

### First run

```
/protoblocks-skill:build-page ~/Desktop/home.png
```

The builder runs this pipeline:

1. **Preflight**: finds the Local site and checks tools.
2. **Setup**: plugins, theme fork, tokens, navigation, header/footer parts.
3. **Breakdown**: crops the design into sections and proposes a plan. **Nothing is built until you approve the plan.**
4. **Per section**: build the block, then visual QA, then motion.
5. **Header/footer**: moves the design's header and footer into the theme parts.
6. **Full-page QA**: whole-page visual check plus accessibility.
7. **Yoast SEO**: infers and applies SEO data, audits the rendered page, fixes failures.
8. **Menu and more pages**: asks whether to add the page to the primary menu and whether you have other landing pages to build.

Install the QA dependencies once (screenshots and diffs):

```bash
cd skills/protoblocks-site-builder/scripts/qa && npm install
```

### State and resume

Build state lives in the theme fork at `.protoblocks/build.json`. If a session is interrupted, run `/protoblocks-skill:resume`: it re-runs preflight, reads the state and continues from the next action.

### Safety rails

- Work only touches the site that preflight resolved.
- Anything overwritten with a forced write is backed up first.
- If you edited a page, menu or its SEO in WordPress, the builder stops with `EEDITED` and asks before overwriting.
- Approvals (the plan, a section, a page) are recorded only after you have seen the preview.
- Theme forks are always reused, never recreated.

### Tests for this repo

| Script | What |
|---|---|
| `npm test` | Pure unit tests; no site needed. |
| `npm run test:qa` | QA scripts against fixture pages. |
| `npm run test:integration` | WP-CLI, PHP writers and theme forks on a Local site. |
| `npm run test:integration:page` | The page integration test only. |
| `npm run test:e2e` | The whole pipeline, design to finished page. |

The integration and e2e tests touch a real Local site, so run them only through the lock script. See [tests/README.md](tests/README.md).

## Docs hub

The `protoblocks` skill is a small always-loaded `SKILL.md` plus `references/*.md` files the agent reads on demand (authoring workflow, recipes, composition, schema, fields, controls, templates, repeaters, styling, interactivity, previews, examples, CLI and hooks, troubleshooting). It covers every field and control type, the full `block.json` schema, template authoring, repeaters, inner blocks, Tailwind, the Interactivity API and WP-CLI.

## Keeping it in sync

When the Proto-Blocks plugin gains field/control types, schema keys, CLI commands, or features, update the relevant `references/*.md` and `SKILL.md` quick-reference tables. The plugin's `examples/` folder is always the authoritative source for working block code.

## License

MIT. (The Proto-Blocks WordPress plugin it documents is GPL-2.0-or-later.)
