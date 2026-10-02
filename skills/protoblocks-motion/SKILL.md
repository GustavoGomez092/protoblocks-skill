---
name: protoblocks-motion
description: Use when adding scroll/entrance animation to a verified Proto-Blocks section or choosing a site's motion style - applies the pb-motion GSAP preset vocabulary via data attributes, keeps motion consistent with the site profile, writes bespoke view.js only when presets can't express the intent, and verifies with the motion check. Normally invoked by protoblocks-section-loop when a section reaches status "animating".
---

# Proto-Blocks Motion

Adds GSAP motion to a section that already passed visual QA. The theme runtime `pb-motion.js` does the work from `data-pb-*` attributes; sections only add attributes. Motion never changes the end state: the settled frame must equal the reduced-motion frame.

```bash
PB="${CLAUDE_SKILL_DIR}/../protoblocks-site-builder/scripts"
```

`THEME` is the fork directory. Failures print `[CODE] message` on stderr (`EPROFILE`, `EMOTION`, `ENOSECTION`: `protoblocks-site-setup/references/errors.md`).

## Once per site

`setup-site.mjs` already copied the runtime; `install` is idempotent and adds the default profile if none exists:

```bash
node "$PB/lib/motion.mjs" install "$THEME"
```

Pick the profile from the design's personality or the developer's motion notes: calm or corporate `subtle` (default), product or marketing `expressive`, editorial or brand-heavy `bold`. Ask the developer when the design gives no signal.

<!-- test:run -->
```bash
node "$PB/lib/motion.mjs" profile "$THEME" expressive
```

A custom profile is JSON: `profile "$THEME" '{"duration":0.8,"ease":"power2.out","stagger":0.1,"distance":32}'`. It is stored in `inc/pb-motion-profile.json` and `site.motionProfile`; the profile applies site-wide, so set it before animating the first section.

## Per section

Motion attributes live in the block's `template.php`, so they are a property of the block on every page that uses it.

- `reuse` section: keep the block's existing motion (no template edit); only run the check (step 4) and record (step 6) with the presets the block already uses.
- Changing presets on a block whose `library[block].usedOn` lists other pages changes their motion too: re-run the motion check for every usedOn page with a `done` section using the block (recipe: `references/shared-blocks.md`), or expose the motion as a block control whose default keeps the current presets.

1. Choose presets (`references/presets.md`): one hero-level effect for the heading (e.g. `split-lines`), one supporting effect for the content group (e.g. `fade-up`, `stagger-children`), `counter` for stats, at most 3 distinct presets per section. Nothing on body paragraphs over ~3 lines; never navigation links or form inputs. Design motion notes come first. Header and footer: no motion.
2. Edit `template.php`. Attributes only on the frontend. The plugin does NOT provide `$is_preview`; define it (`$block` is null in the editor preview) and add one helper (a closure, never a named function: several instances would redeclare it):

```php
$is_preview = ! isset( $block ) || $block === null;
$pb_motion  = function ( $preset, $opts = array() ) use ( $is_preview ) {
	if ( $is_preview ) { return ''; }
	$out = 'data-pb-motion="' . esc_attr( $preset ) . '"';
	if ( ! in_array( $preset, array( 'parallax', 'marquee' ), true ) ) { $out .= ' data-proto-animate="manual"'; }
	foreach ( $opts as $k => $v ) { $out .= ' data-pb-' . sanitize_key( $k ) . '="' . esc_attr( $v ) . '"'; }
	return $out;
};
```

   Use it on the element: `<h2 <?php echo $pb_motion( 'split-lines' ); ?> data-proto-field="heading">` or `<div <?php echo $pb_motion( 'fade-up', array( 'delay' => 0.15 ) ); ?>>`. Continuous presets (`parallax`, `marquee`) get no `data-proto-animate`.
3. Re-run gates (they render both the frontend and the editor preview), then rebuild the page:
   `node "$PB/lib/gates.mjs" "$THEME" <block> --attrs '<attrs json>'`, then `node "$PB/lib/page.mjs" build "$THEME" <page>`.
4. Verify (the page URL is `page.url` in `state.mjs get "$THEME" pages`; width is the desktop width used in Verify, default 1440):
   `node "$PB/qa/motion-check.mjs" --url <page url> --anchor pb-s<n> --width <w> --out "$THEME/.protoblocks/artifacts/<page>/pb-s<n>/motion"`
   It prints the result and exits 1 unless `pass`; it deletes any earlier `motion-check.json` first. Result fields and limits: `references/check.md`.
5. Fix by symptom (`references/check.md`), then re-run.
6. Record:
   `node "$PB/lib/motion.mjs" record "$THEME" <page> <n> "<out>/motion-check.json" --presets a,b`
   It prints `{pass, attempts, capReached, status}` (also on a failure, which exits 1 with `[EMOTION]` on stderr). It refuses a check of another anchor or page URL, an unknown preset, and a section that is not `animating` (`ESTATUS`). A pass sets the section `done`; a failure sets `motion.check: "fail"` and counts `motion.attempts` (fields: `state-schema.md`). On `capReached: true` (`site.qa.motionMaxAttempts` failed checks, default 3) stop and ask the developer: simplify the motion, accept it (`record ... --accepted`, which notes "motion accepted by developer"), or remove it (revert the attributes, then record a passing check).
7. Commit in the theme fork: `git -C "$THEME" add -A && git -C "$THEME" commit -m "feat(page): <page> section <n>"`.

## Bespoke motion

Only when presets cannot express the intent (SVG drawing, Lottie, cursor effects). Follow `references/custom-motion.md` exactly; bespoke elements use `data-proto-animate="manual"` but never `data-pb-motion`.

## Iron rules

- No motion in the editor preview: attributes only when `$is_preview` is false.
- Never hide content without `data-proto-animate="manual"`; the plugin watchdog is the safety net, not the timing (it forces `done` 1.5 s after the element enters view).
- Transform, opacity and clip-path only. Respect reduced motion (the runtime does; bespoke code must).
- Never edit `pb-motion.js` or `pb-motion.php` (managed, overwritten on install).
- Never record without a passing check unless the developer accepted that exact section.
