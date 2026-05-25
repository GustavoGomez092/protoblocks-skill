# Block Preview Images (inserter thumbnails)

Each block can show a thumbnail in the editor's block inserter. The image is the file `preview.png` (or `.jpg`/`.jpeg`/`.webp`) in the block's folder — the schema reader auto-detects it and exposes it as the block's `previewImage`. There are two ways to produce it.

## Option A — generate automatically (Preview Capture)

The plugin ships an admin tool that screenshots every registered block for you.

1. In wp-admin, open **Proto Blocks → Preview Capture**.
2. The page lists all registered blocks with their current preview status.
3. Run the capture. For each block it:
   - renders the block in a hidden iframe (block + theme/plugin styles only),
   - rasterizes that iframe to a PNG (via `html2canvas-pro`),
   - POSTs the PNG to a REST endpoint that writes `preview.png` into the block's folder.
4. The inserter picks up the new `preview.png` automatically (the schema reader detects it).

This is the recommended path: it keeps thumbnails in sync with how the block actually renders, including any preview/placeholder content your template seeds when empty (see `templates.md`). Re-run it after you change a block's markup or styling.

**Make the captured image look good:** because capture renders the block with no content unless your template provides defaults, seed representative placeholder content under an editor-preview check so the thumbnail isn't blank:

```php
$is_preview = ! isset($block) || $block === null;
if (empty($attributes['items']) && $is_preview) {
    $attributes['items'] = [
        ['id' => 'p1', 'title' => 'Example heading', 'content' => 'Example copy...'],
    ];
}
```

## Option B — drop in your own image

Place a hand-made `preview.png` (~400px wide) directly in the block folder:

```
my-block/
├── block.json
├── template.php
└── preview.png      ← used as the inserter thumbnail
```

Use this when you want a polished, art-directed thumbnail rather than a literal render, or when the block is hard to capture meaningfully (e.g. it depends on runtime data).

## Notes

- Supported formats: `preview.png`, `.jpg`, `.jpeg`, `.webp`. PNG is the default produced by Preview Capture.
- The capture admin page requires `manage_options` capability.
- If a block shows no thumbnail: confirm the file exists in the block folder with a supported extension, and clear the cache (`wp proto-blocks cache clear`) so the schema is re-read.
