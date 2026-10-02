# Header and footer

Header and footer are sections of the first page (labels `header` and `footer`, blocks `site-header` and `site-footer`). They go through the same Build and Verify loop, then are moved into the theme's template parts so they render once for every page. On later pages they are `reuse` and only verified.

## Differences from other sections

- The block has an `inner-blocks` field. Its content is a navigation block that references the menu: `<!-- wp:navigation {"ref":<id>} /-->`, with `<id>` from `site.navigation.menus.<key>.id` (read it: `node "$PB/lib/state.mjs" get "$THEME" site.navigation.menus.primary.id`). Put it in `section.inner`. `protoblocks-site-setup` creates the menus; if `null`, run its Step 3 first.
- Style the mobile menu in the block CSS against `.wp-block-navigation__responsive-container` (the overlay) and `.wp-block-navigation__responsive-container-open` (the hamburger). Verify the mobile breakpoint, not only desktop.
- A sticky header is a block control (`sticky`), not custom JS.

## After the block passes QA on the page

1. List Site Editor copies that would shadow the file:
   `node "$PB/lib/parts.mjs" overrides "$THEME"` (`[]` means none).
2. If a `header` (or `footer`) copy exists, show the developer what would be discarded and ask. Run the preview once: `node "$PB/lib/parts.mjs" remove-override "$THEME" header` prints `[ECONFIRM]` with the id. Only after their explicit OK: `node "$PB/lib/parts.mjs" remove-override "$THEME" header --confirm --id <n>`. The copy goes to Trash, not deleted; relay the printed recovery command. `[ESTALE]` means the id changed: preview again. `[EAMBIGUOUS]` or `[ETHEMEMISMATCH]`: nothing removed; tell the developer. `[ENOTRASH]`: Trash is disabled so removal would be permanent; ask the developer to use "Clear customizations" on the part in the Site Editor.
3. Write the part. The file content is the `partMarkup` output (the shape is in `protoblocks-site-setup/references/navigation.md`): the block comment wrapping the `core/navigation` ref, with the same attrs the section used:
   `node "$PB/lib/parts.mjs" write "$THEME" header header.html`
   (then the same for `footer footer.html`).
4. Mark the section as rendered by the part so the page stops outputting it. Set `inPart` true and status `done`:
   `node "$PB/lib/state.mjs" set "$THEME" pages.<i>.sections.<j>.inPart true`
   `node "$PB/lib/state.mjs" set "$THEME" pages.<i>.sections.<j>.status '"done"'`
   `page.mjs` skips sections with `inPart: true` (it renders them from the template parts, once).
5. Rebuild: `node "$PB/lib/page.mjs" build "$THEME" <page>`. Then re-verify the first content section (`prepare`, visual-qa, `record`): removing the in-page header shifts nothing only if the part renders identically, so the section must still pass.
6. After header and footer exist, refresh menus that link to pages built since: `node "$PB/lib/navigation.mjs" refresh "$THEME"`. It keeps Site Editor edits; it patches only pending placeholder links. `page.mjs build` already runs it when a menu has a pending link to the page.

## Notes

- Never write `parts/*.html` by hand around the tool; `parts.mjs write` validates the active theme.
- Anchors `pb-s1` and the footer's anchor no longer exist on the page once `inPart` is set; verify them before moving them.
- Editing the header later: change the block, re-run gates, rewrite the part with `parts.mjs write`, re-check one content section.
