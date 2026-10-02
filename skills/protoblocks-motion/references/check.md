# Motion check: result and fixes

`qa/motion-check.mjs` loads the page twice: reduced motion (the reference frame, as in Verify) and motion on. It scrolls slowly through the anchor, waits for every reveal element to report `done`, stops continuous presets (`parallax`, `marquee`) at rest (they never settle), then compares the settled anchor with the reduced one. On a Taxi page it also navigates away and back twice.

## Result

| Field | Pass rule |
|---|---|
| `settledMismatch` | at most 0.02 (settled frame vs reduced frame) |
| `settledHeightDelta` | must be 0 |
| `cls` | at most 0.01: `clsMotion` (layout shifts with a source in the anchor, motion page) minus `clsBaseline` (same measure on the reduced page: font swaps, late images, load-time scripts) |
| `clsPage` | information: every shift on the motion page |
| `unsettled` | empty: `[data-pb-motion][data-proto-animate]` elements not `done` within 6 s |
| `imageErrors` | empty: anchor images broken or stalled (`pageImageWarnings` elsewhere do not fail) |
| `pageErrors` | empty: uncaught page errors |
| `taxi` | `checked` only when the page has Taxi and ScrollTrigger: `before` equals `after` (trigger counts after each round trip), `duplicates` and `unsettled` empty, no `error`. `retries` is information. |

## Fix by symptom

- `settledMismatch` or `settledHeightDelta`: residue. A CSS transform or clip-path on the animated element (presets clear them: use a wrapper), a bespoke infinite loop (use `marquee`), a scrub or pin. See `presets.md`.
- `cls`: layout properties animated (height, margin) or a parent resized on reveal; use transform and opacity only.
- `unsettled`: a preset element never finished; check it is visible, not `display:none`, and has a sane `data-pb-delay`/`data-pb-start`.
- `taxi` mismatch, `duplicates`, `error`: bespoke JS not tearing down or initialising twice (`custom-motion.md`); `ETAXI` in `taxi.error` is a navigation failure of the page, not of the preset.
- `imageErrors`: not a motion problem; fix the image as in the section loop.
