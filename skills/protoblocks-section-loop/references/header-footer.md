# Header and footer

Header and footer are sections of the first page (labels `header` and `footer`, blocks `site-header` and `site-footer`) with the fixed anchors `pb-header` and `pb-footer` (set at intake/plan time, never `pb-s<n>`). On the first page they go through the same Build and Verify loop as every other section. Once, after the last section of the first page has passed, they are moved into the theme's template parts (steps 1-8 below) so they render once for every page. On later pages they are `reuse` with `inPart: true` (recorded by `plan.mjs record`): nothing to build, `page.mjs` leaves them out, and they are only verified, through the part's anchor (`#pb-header`, `#pb-footer`). `PB`, `THEME` as in `SKILL.md`.

## Differences from other sections

- The block has an `inner-blocks` field. Its content is a navigation block that references the menu: `<!-- wp:navigation {"ref":<id>} /-->`, with `<id>` from `site.navigation.menus.<key>.id` (`node "$PB/lib/state.mjs" get "$THEME" site.navigation.menus.primary.id`). Put it in `section.inner`. `protoblocks-site-setup` Step 3 creates the menus; if the id is `null`, run it first.
- Style the mobile menu in the block CSS against `.wp-block-navigation__responsive-container` (the overlay) and `.wp-block-navigation__responsive-container-open` (the hamburger). Verify the mobile breakpoint, not only desktop.
- A sticky header is a block control (`sticky`), not custom JS.

## Two renders until `inPart` (expected)

The theme's `templates/page.html` (and `index`, `single`) include the `header` and `footer` template parts, wrapped in `<header>` / `<footer>` (`tagName`). So while the block is still a page section, the page shows it twice: once from the section, once from the template part. The part at this point is whatever site setup left: the theme's stock header (logo, title, navigation) or the navigation-only part from `protoblocks-site-setup` Step 4.

- This is expected during verification. Visual QA crops by the section's anchor (`#pb-header`), so the section's own screenshot is unaffected. The duplicate chrome above the page content can still shift nothing in the crop, but it makes the page look doubled to a human: tell the developer it is temporary.
- Duplicate ids: the setup-time part carries no `anchor` (its markup is navigation only, for example `{"sticky":true}`), so only the section owns `pb-header`. Never put the anchor into a part before the block has passed QA as a section. Only step 3 below puts the anchor into the part, and step 4 removes the section from the page in the same pass, so the id exists once.
- The loop's part supersedes the setup-time part: after the `site-header` / `site-footer` block passes QA, `parts.mjs write` replaces `parts/header.html` / `parts/footer.html`.

## Moving them into the parts (once, after the last section of the first page passed)

Run steps 1-8 once, when every section of the first page has passed Verify (header and footer included, as normal sections). Doing it earlier shifts the page under sections still being verified.

1. List Site Editor copies that would shadow the file: `node "$PB/lib/parts.mjs" overrides "$THEME"` (`[]` means none).
2. If a `header` (or `footer`) copy exists, show the developer what would be discarded and ask. Run the preview once: `node "$PB/lib/parts.mjs" remove-override "$THEME" header` prints `[ECONFIRM]` with the id. Only after their explicit OK: `node "$PB/lib/parts.mjs" remove-override "$THEME" header --confirm --id <n>`. The copy goes to Trash, not deleted; relay the printed recovery command. `[ESTALE]` means the id changed: preview again. `[EAMBIGUOUS]` or `[ETHEMEMISMATCH]`: nothing removed; tell the developer. `[ENOTRASH]`: Trash is disabled so removal would be permanent; ask the developer to use "Clear customizations" on the part in the Site Editor.
3. Generate the part markup from state (a pure command, no WordPress needed): `--from-state` takes the section's `block`, `attrs`, its `anchor` (`pb-header` / `pb-footer`) and its `inner` (the navigation block with the menu `ref`), so nothing is hand-copied:
   ```bash
   node "$PB/lib/parts.mjs" markup "$THEME" --from-state <page> <n> > "$THEME/.protoblocks/header.html"
   node "$PB/lib/parts.mjs" write "$THEME" header "$THEME/.protoblocks/header.html"
   ```
   Repeat for `footer` (its own `n`, `footer.html`). `[ENOSECTION]` / `[ENOPAGE]`: wrong page or `n`; `[EINPUT]` "no block yet": the section was never built. The part keeps the anchor, so the header still renders with `id="pb-header"` and can be verified by `qa-input.mjs`.
4. Mark the section as rendered by the part, in one atomic write (look up by slug and `n`; set `inPart` and `status` together). `page.mjs` skips sections with `inPart: true`:

<!-- test:run -->
```bash
PAGE=home SECTION=1 THEME="$THEME" PB="$PB" node --input-type=module -e '
const { updateState } = await import(process.env.PB + "/lib/state.mjs");
updateState(process.env.THEME, (s) => {
  const page = s.pages.find((p) => p.slug === process.env.PAGE);
  if (!page) throw new Error("No page " + process.env.PAGE);
  const sec = page.sections.find((x) => x.n === Number(process.env.SECTION));
  if (!sec) throw new Error("No section n=" + process.env.SECTION);
  sec.inPart = true;
  sec.status = "done";
});
'
node "$PB/lib/state.mjs" validate "$THEME"
```

5. Rebuild so they render once, from the parts: `node "$PB/lib/page.mjs" build "$THEME" <page>` (`ESTALE`: re-run, never `--force`).
6. Re-verify three things, each with `qa-input.mjs prepare` / visual-qa / `record` on the same anchors: the header (`pb-header`, now rendered by the part), the footer (`pb-footer`), and the first content section. A section already `done` is re-verified like any other: `prepare` sets it `verifying`, and a pass puts it back to `done` (not `animating`).
7. If a re-verification fails after `inPart` (for example a pixel shift because the template wraps the part in `<header>` / `<footer>`, or the page now has a different top offset), fix it in the block CSS or in the part markup (regenerate with `markup`, `write`, rebuild) and re-verify. Do not unset `inPart` to chase it, and do not lower thresholds. The iteration cap applies as usual (`verify.md`).
8. Refresh menus that link to pages built since: `node "$PB/lib/navigation.mjs" refresh "$THEME"`. It keeps Site Editor edits; it patches only pending placeholder links. `page.mjs build` already runs it when a menu has a pending link to the page.

## Later pages

`plan.mjs record` stores the header and footer of a later page as `reuse`, `inPart: true`, anchors `pb-header` / `pb-footer`, status `building`, `prevStatus: "done"` (a pass returns them to `done`; they are never animated again). A row without `part` on a section cropped as the header or footer counts as that part. Skip Build for them except `library.mjs record` (so `usedOn` lists the page); `page.mjs build` leaves them out. Verify them like any section once the page is built: `prepare` targets `#pb-header` / `#pb-footer`, which the parts render.

## Notes

- Never write `parts/*.html` by hand around the tool; `parts.mjs write` checks the fork.
- Editing the header later: change the block, re-run gates, regenerate and rewrite the part, run `node "$PB/lib/regress.mjs" "$THEME" site-header` (every page shows it), then re-check one content section.
