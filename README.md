# Proto-Blocks Skill

A Claude Code [skill](https://docs.anthropic.com/en/docs/claude-code/skills) for building WordPress Gutenberg blocks with the [Proto-Blocks](https://github.com/GustavoGomez092/Proto-Blocks) plugin — PHP-template blocks defined in `block.json` with `data-proto-*` fields, controls, repeaters, inner blocks, and optional Tailwind.

This skill replaces the older `proto-blocks-mcp` server. All of its guidance now lives here as a progressively-disclosed skill: a concise always-loaded `SKILL.md` plus focused reference files Claude reads only when relevant. Content is derived directly from the Proto-Blocks plugin source, not from the MCP.

## What's inside

```
protoblocks-skill/
├── .claude-plugin/
│   ├── marketplace.json     # marketplace metadata
│   └── plugin.json          # plugin metadata
└── skills/
    └── protoblocks/
        ├── SKILL.md         # overview, anatomy, quick reference, iron rules
        └── references/
            ├── schema.md            # block.json / protoBlocks schema + validation
            ├── fields.md            # field types, value shapes, custom fields
            ├── controls.md          # control types, conditional visibility
            ├── templates.md         # template vars, data-proto-*, escaping
            ├── repeaters.md         # repeater markup, ids, min/max, nesting
            ├── styling.md           # vanilla CSS, Tailwind scoping, theme styles
            ├── interactivity.md     # view.js, ES modules, Interactivity API
            ├── examples.md          # bundled examples + canonical samples
            ├── cli-and-hooks.md     # WP-CLI, hooks, discovery, admin
            └── troubleshooting.md   # symptom → cause → fix
```

## Installing

As a plugin marketplace in Claude Code:

```
/plugin marketplace add GustavoGomez092/protoblocks-skill
/plugin install protoblocks-skill@protoblocks
```

Or copy the skill into your skills directory:

```bash
cp -r skills/protoblocks ~/.claude/skills/protoblocks
```

## When it activates

Claude loads the skill when you're creating, scaffolding, or debugging Proto-Blocks blocks — e.g. "make a Proto-Blocks testimonial block", "my repeater items won't render", "add a Tailwind hero block with an image control".

## Keeping it accurate

The skill is grounded in the Proto-Blocks plugin source. When the plugin gains field/control types, schema keys, or CLI commands, update the relevant `references/*.md` (and `SKILL.md` quick-reference tables) to match. The bundled `examples/` folder in the plugin is always the authoritative source for working block code.

## License

MIT
