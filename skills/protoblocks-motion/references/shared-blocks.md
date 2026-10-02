# Motion on shared blocks

Shell variables do not persist between Bash commands: start each command with the `PB=...; THEME=...;` line from SKILL.md (Scripts).


Presets are attributes in the block's `template.php`, so every page that renders the block gets them. `library[block].usedOn` (written by `library.mjs record` in Build) lists those pages; `node "$PB/lib/library.mjs" list "$THEME"` prints it per block (`usedOn`, needs the site running).

## `reuse` sections

The block already has its motion. Do not edit the template: run the motion check for this section and record it with the presets the block already uses (read them from the template's `$pb_motion(...)` calls or from `motion.presets` of a section that used the block before).

## Changing presets on a used block

A `new` or `extend` edit that adds, removes or changes presets on a block used elsewhere changes the motion of every page in `usedOn`. Before committing:

1. List the finished sections that use the block (page slug, anchor, page URL). Set `BLOCK` to the block slug:

<!-- test:run -->
```bash
BLOCK=hero-split
node "$PB/lib/state.mjs" get "$THEME" | node -e '
const s = JSON.parse(require("fs").readFileSync(0, "utf8"));
const block = process.argv[1];
for (const slug of s.library[block]?.usedOn ?? []) {
  const page = s.pages.find((p) => p.slug === slug);
  for (const sec of page?.sections ?? []) if (sec.block === block && sec.status === "done") console.log(slug, sec.anchor, page.url ?? "");
}' "$BLOCK"
```

2. Rebuild each listed page (`page.mjs build`), then run the motion check for each line: `node "$PB/qa/motion-check.mjs" --url <url> --anchor <anchor> --width <w> --out "$THEME/.protoblocks/artifacts/<page>/<anchor>/motion"`.
3. Every check must pass. A failing one is fixed in the block like any motion failure; to record it, set that section back to `animating` (`state.mjs set`) and run the per-section steps for it.

When one page needs different motion from the others, do not fork the template per page: add a block control (the `extend` rule: its default reproduces the current presets) and pass the preset name to `$pb_motion` from the attribute.
