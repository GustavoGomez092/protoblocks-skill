# Changelog

## 2.3.0

Site setup

- `setup-site.mjs --theme-name "<display name>"` sets the fork's `Theme Name:` and `Description:` (default: the project name) and is re-runnable on an existing fork: a later run with `--theme-name` renames the theme without re-forking. Recorded as `site.theme.displayName`. The site-setup and site-builder skills ask for the display name when it differs from the project name.
- Theme screenshot: `theme-screenshot.mjs "$THEME" <page>` crops the top of the page's desktop frame (full width, 4:3) to `$THEME/screenshot.png` at 1200x900 and records `site.theme.screenshot`. It runs right after the first page's frames are intaken, before tokens; `status.mjs` treats setup as unfinished until it exists.
- Per-site block category: the fork's `functions.php` filters `proto_blocks_category_slug` / `proto_blocks_category_title` are rewritten to the theme slug and "<display name> blocks" (`--category-title` overrides), recorded as `site.theme.category`. Block scaffolding uses that slug and the build gates check every `block.json` `"category"` against it (falling back to `proto-blocks` when state has none).

Full-bleed sections

- The managed `pb-shell.css` lifts the base theme's 1440px cap and side gutters from `main`: every Proto-Blocks section is a full-bleed band with its own inner container, so pages span any viewport width. The "Shell cap" guidance (raising `max-width: 1440px` in the fork's `style.css` for wider frames) is gone; `notes.shellCap` in old builds is tolerated.
- Visual QA adds the `wide` sanity breakpoint (1920px, no design frame): a section narrower than the viewport fails `widthDelta`/`numericPass`. Page QA runs a 1920px wide pass and fails the page (`wide.boxed`) when any section does not span the viewport; such a failure cannot be accepted as a design difference.

## 2.2.1

Previous release (see the git history).
