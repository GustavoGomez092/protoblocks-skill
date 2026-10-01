# Proto-Blocks Site Builder — Design

**Date:** 2026-10-01
**Status:** Draft for review
**Repo:** `protoblocks-skill` (Claude Code plugin; target version 2.0.0)

## 1. Purpose

Grow the `protoblocks-skill` plugin from a Proto-Blocks documentation skill into:

1. **The documentation hub** for Proto-Blocks (existing skill, refreshed).
2. **A design-to-WordPress site builder**: given a design (image, section screenshot, Figma, Penpot, live URL), it sets up a block-theme site, builds header/footer with block-theme navigation, breaks the design into Proto-Blocks sections, builds each section, verifies it visually against the design, animates it, assembles landing pages, and finishes each page with a Yoast SEO pass.

### Success criteria

- A developer points the agent at a running Local by Flywheel site and a design; the agent produces a published landing page whose sections each passed visual QA at every provided breakpoint, are animated consistently, and whose SEO metadata is complete (provided or inferred and flagged).
- The block library grows reusably: later pages reuse/extend existing blocks instead of duplicating them.
- Long builds survive context compaction and new sessions via a resumable state file.
- The agent never claims a section passes without a recorded QA verdict.

### Constraints and assumptions

- **Local sites only.** The agent has full filesystem access to the site and WP-CLI. Typical host: Local by Flywheel on macOS. Other local setups work when `wp` already runs in the shell.
- User is a developer building client sites locally.
- Base theme: [`proto-blocks-theme`](https://github.com/GustavoGomez092/proto-blocks-theme) (block theme, Tailwind v4 tokens, GSAP/SplitText/ScrollTrigger/Lenis/Lottie globals, Taxi.js page transitions, builder-canvas page template, Yoast as required plugin).
- Plugin: [`Proto-Blocks`](https://github.com/GustavoGomez092/Proto-Blocks) v2.10.1+. It has no block-theme, navigation, template-part, or SEO integration — the skill supplies all of that.
- Navigation uses block-theme `wp_navigation` posts + `core/navigation`, never classic `wp_nav_menu`/`register_nav_menus`.
- Tooling is delivered as **bundled scripts** (PHP via `wp eval-file`, Node/Playwright), not a new MCP server and not new plugin WP-CLI commands.

### Non-goals

- Deploying to staging/production (theme repo already has WP Engine workflows).
- Classic themes, page builders, or non-Proto-Blocks block authoring.
- Remote/managed hosts.
- WooCommerce/shop templates.

## 2. Architecture

### 2.1 Packaging

One Claude Code plugin, multiple focused skills, slash commands, and one subagent.

```
protoblocks-skill/
├── .claude-plugin/plugin.json, marketplace.json      (versions bumped together → 2.0.0)
├── skills/
│   ├── protoblocks/                  docs hub (existing; refreshed)
│   │   └── references/ … + theme.md (new)
│   ├── protoblocks-site-builder/      orchestrator
│   │   ├── SKILL.md                   pipeline, gates, resume logic
│   │   ├── references/                state-schema.md, local-sites.md, pipeline.md
│   │   └── scripts/                   ALL bundled tools (shared by every skill)
│   │       ├── lib/                   local-site.sh (detect site, build wp wrapper), state.mjs
│   │       ├── wp/                    *.php for `wp eval-file`
│   │       ├── qa/                    *.mjs (Playwright, diff, audits) + package.json
│   │       └── theme-assets/          pb-motion.js, pb-schema.php (installed into theme fork)
│   ├── protoblocks-site-setup/        plugins, theme fetch+fork, tokens, nav, header/footer
│   ├── protoblocks-design-breakdown/  intake adapters, segmentation, block mapping, plan gate
│   ├── protoblocks-section-loop/      build → verify → animate per section
│   ├── protoblocks-motion/            motion vocabulary + profile + custom motion rules
│   └── protoblocks-seo/               Yoast meta, JSON-LD, OG image, audit + fix
├── commands/
│   ├── setup-site.md                  /protoblocks:setup-site
│   ├── build-page.md                  /protoblocks:build-page <design>
│   ├── seo.md                         /protoblocks:seo <page>
│   └── resume.md                      /protoblocks:resume
├── agents/
│   └── visual-qa.md                   screenshot + diff + judgement → verdict JSON
├── tests/                             script unit tests, integration harness, fixtures
└── docs/superpowers/specs|plans/
```

**Script path resolution.** Phase skills reference the shared scripts as `../protoblocks-site-builder/scripts/` relative to their own base directory. This works both as an installed plugin and as a manual copy of the whole `skills/` folder. Commands and the subagent use `${CLAUDE_PLUGIN_ROOT}/skills/protoblocks-site-builder/scripts/`.

**Why multiple skills:** precise triggering (docs questions don't load the builder), small always-loaded `SKILL.md` files, and phases runnable standalone ("just run SEO on /pricing").

**Why a subagent for visual QA:** each QA call involves several images; isolating it keeps screenshot context out of the main loop, which must survive 10+ sections × iterations × breakpoints. The subagent returns only a verdict JSON.

### 2.2 Pipeline

```
Preflight ─► Intake (design → frames) ─► Site setup (once/site; tokens + header/footer from these frames)
   ─► Breakdown ─► [plan approval]
   ─► for each section: build ─► visual QA ⟲ fix (≤5) ─► animate ─► motion QA ─► done
   ─► page QA (full page + a11y) ─► SEO ─► [add to menu?] ─► [another page?] ─► loop to intake
```

Site setup's design-dependent steps (tokens, navigation, header/footer) consume the frames of the first page's design; setup steps 1–3 need no design and can run standalone via `/protoblocks:setup-site`. On later pages, setup is skipped and the header/footer bands are only verified against the existing parts.

The orchestrator (`protoblocks-site-builder`) owns the pipeline and delegates each phase to its skill. Each step's outcome is written to the state file before moving on.

### 2.3 State file

Location: `wp-content/themes/<theme-fork>/.protoblocks/build.json` (versioned with the theme repo). Artifacts (design crops, screenshots, composites): `.protoblocks/artifacts/` (gitignored).

Shape (full JSON Schema in `references/state-schema.md`):

```jsonc
{
  "schemaVersion": 1,
  "site": {
    "localSiteId": "…", "path": ".../app/public", "url": "https://acme.local",
    "wp": { "mode": "local-wrapper|native", "wrapper": ".protoblocks/wp" },
    "theme": { "slug": "acme", "forkedFrom": "proto-blocks-theme@1.1.3" },
    "tokens": { "colors": {…}, "fonts": {…}, "type": {…}, "radii": {…}, "shadows": {…} },
    "motionProfile": { "name": "subtle", "duration": 0.7, "ease": "power2.out", "stagger": 0.08 },
    "qa": { "mismatchMax": 0.08, "heightDeltaMax": 0.03, "maxIterations": 5 },
    "navigation": { "primary": 123, "footer": [124, 125], "pendingLinks": [{ "label": "Pricing", "page": "pricing" }] },
    "parts": { "header": { "block": "site-header", "status": "done" }, "footer": { … } }
  },
  "library": {
    "media-text": { "purpose": "…", "fields": […], "controls": […], "variants": ["imagePosition"], "usedOn": ["home", "about"], "baseline": "artifacts/…png" }
  },
  "pages": [{
    "slug": "home", "postId": 42, "status": "building|seo|done",
    "design": { "source": "figma|penpot|image|url", "ref": "…", "frames": [{ "breakpoint": "desktop", "width": 1440, "scale": 2, "image": "…" }] },
    "contentHash": "sha256 of last post_content written",
    "sections": [{
      "n": 1, "anchor": "pb-s1", "label": "Hero", "decision": "new|reuse|extend",
      "block": "hero-split", "attrs": {…}, "inner": [],
      "crops": { "desktop": "…", "mobile": "…" },
      "qa": [{ "iteration": 1, "breakpoint": "desktop", "mismatch": 0.14, "heightDelta": 0.05, "pass": false }],
      "motion": { "presets": ["split-lines", "fade-up"], "check": "pass" },
      "status": "planned|building|verifying|animating|done|skipped"
    }],
    "seo": { "focusKeyword": { "value": "…", "inferred": true, "why": "…" }, … , "audit": {…} }
  }]
}
```

`scripts/lib/state.mjs` reads, validates against the schema, backs up (`build.json.bak`), and writes. All state mutations go through it.

## 3. Preflight

`scripts/lib/local-site.sh`, results cached in `site` state.

1. **Native check:** if `wp option get siteurl` works in the current shell (Local "Open site shell" or non-Local setup), use native mode.
2. **Local detection:** read `~/Library/Application Support/Local/sites.json`; pick the site whose `path/app/public` contains the CWD, else list sites and ask.
3. **Wrapper:** write `.protoblocks/wp` that runs Local's bundled PHP binary with `-d mysqli.default_socket=<~/Library/Application Support/Local/run/<siteId>/mysql/mysqld.sock>` and WP-CLI with `--path=<app/public>`. Verify with `wp option get siteurl`. Socket missing → stop: "Start the site in Local, then re-run."
4. **Environment checks:** Proto-Blocks active and ≥ 2.10.1; pretty permalinks; Node ≥ 18; Playwright Chromium (offer `npm install` + `npx playwright install chromium` inside `scripts/qa/`). Site URL from `sites.json`; Playwright uses `ignoreHTTPSErrors`.

## 4. Site setup (`protoblocks-site-setup`, `/protoblocks:setup-site`)

Every step is idempotent and recorded in state.

1. **Plugins:** install/activate Proto-Blocks (latest GitHub release zip), `wordpress-seo`, `safe-svg`, `duplicate-post`. Skip Wordfence locally. Set `proto_blocks_wizard_completed`, enable Tailwind (`proto_blocks_tailwind['enabled']`), set permalink structure `/%postname%/` and flush.
2. **Theme fork:** download latest `proto-blocks-theme` release zip → extract to `themes/<project-slug>/` → rewrite `Theme Name`, `Text Domain`, slug references → activate → `git init` + initial commit. Existing fork → reuse; never overwrite without explicit confirmation.
3. **Install theme assets:** copy `pb-motion.js` → `assets/js/`, `pb-schema.php` → `inc/`, add enqueue/require lines to `functions.php` (guarded, idempotent), add `.protoblocks/artifacts/` to the fork's `.gitignore`.
4. **Design tokens:** extract palette, fonts, type scale, radii, shadows — Figma/Penpot variables when available, otherwise vision over frames. Write `tailwind-theme.css` `@theme`; mirror colors/fonts into `theme.json` (palette, fontFamilies) so core blocks and navigation match; wire fonts (Google Fonts import or local `fontFace`); compile Tailwind via `wp eval 'ProtoBlocks\Core\Plugin::getInstance()->getTailwindManager()->compile();'`.
5. **Navigation** (`scripts/wp/navigation.php`): create/update `wp_navigation` posts ("Primary", one per footer column/utility menu) whose content is `core/navigation-link` / `core/navigation-submenu` blocks. Internal links use `kind: post-type`, `type: page`, `id`. Links to not-yet-built pages are stored in `navigation.pendingLinks` and patched when the page is created.
6. **Header/footer:** built as proto-blocks `site-header` and `site-footer`, going through the same section loop (build → QA → animate). Each has an `inner-blocks` slot containing `core/navigation {"ref": <id>}` (layout controlled by the design, menus editable in the Site Editor). Mobile overlay styled in the block CSS against core navigation classes. `scripts/wp/parts.php` rewrites `parts/header.html` / `parts/footer.html` to contain only those blocks; if a `wp_template_part` DB override exists, it warns and removes it only after confirmation.

## 5. Design intake and breakdown (`protoblocks-design-breakdown`)

### 5.1 Intake adapters → normalized frames

| Source | How | Text source |
|---|---|---|
| Image/PDF | copy to artifacts; detect @2x from width (2880→1440) or ask once | vision |
| Figma | Figma MCP: `get_metadata`, `get_screenshot` per frame, `get_design_context`, `get_variable_defs`, `download_assets` | exact |
| Penpot | Penpot MCP: `export_shape` per board, `execute_code` for structure/text | exact |
| Live URL | Playwright full-page screenshot per breakpoint + DOM text extraction | exact |

Output: `frames[] = {breakpoint, width, scale, image, structure?}`. Desktop required; tablet/mobile optional.

If a required MCP server is unavailable, the agent says so and offers to proceed with an exported image instead.

### 5.2 Assets

- Figma/Penpot: export real assets via MCP.
- Image input: use a user-supplied assets folder if given; otherwise crop photos/logos from the design and recreate icons as inline SVG. Every cropped asset is listed in the page's "replace with originals" list and masked in QA scoring.
- All media imported by `scripts/wp/media.php` (dedupe by file hash, sets alt text, returns `{id, url, alt}`).

### 5.3 Breakdown

1. **Bands:** from frame structure when known; otherwise `qa/segment.mjs` proposes horizontal cut lines from background/whitespace changes and the agent confirms/adjusts by vision. Mobile frames matched to desktop sections by order and content.
2. **Site parts:** header/footer bands map to the shared site parts; built once, later pages only verify against them.
3. **Content model per section:** pattern label (hero, logo wall, feature grid, media-text, stats, testimonial, pricing, FAQ, CTA, …) and content model per `protoblocks/references/composition.md` — fewest, richest regions; repeating items → repeater (or `gallery` control when images are the layout); free copy → wysiwyg; mixed nested content → inner-blocks.
4. **Library match:** manifest = `wp proto-blocks list --format=json` + `library` state.
   - **reuse** — same structure, different content.
   - **extend** — a variant control covers the difference. Only additive: new controls default to current behavior; triggers regression re-shoot of every page in `usedOn`.
   - **new** — structurally distinct.
5. **Intra-page merge:** same-structure sections on one page → one block with a control.
6. **Naming:** generic reusable slugs (`media-text`, `feature-grid`), never page-specific. Repeated micro-elements (buttons, eyebrows, section headings) become shared token classes/styles, not blocks.

### 5.4 Plan gate

The agent presents a plan table (section, crop reference, decision, fields/controls, notes) and **waits for approval**. The approved plan is written to state; building starts only after that.

## 6. Section loop (`protoblocks-section-loop`)

### 6.1 Build

- Loads the `protoblocks` docs skill for authoring rules.
- New/extended block: scaffold with `wp proto-blocks create <name> --dir=theme`, then author `block.json`, `template.php`, CSS. Default styling: Tailwind with theme tokens; vanilla CSS allowed.
- Gates, in order: `wp proto-blocks validate <name>` → `wp proto-blocks cache clear` → Tailwind compile → PHP render smoke test via `POST /proto-blocks/v1/preview` (fails on PHP warnings/fatals).
- Page assembly: `scripts/wp/page.php` takes the page spec from state and writes `post_content` via `serialize_blocks()` as an admin user (avoids kses stripping). Each section block gets `anchor: pb-s{n}`. Rebuild is idempotent. If the stored `contentHash` doesn't match current `post_content` (edited in wp-admin), it refuses to overwrite until the user confirms.
- Pages are **published** (local only), so anonymous Playwright sees exactly the visitor render.

### 6.2 Visual QA (`agents/visual-qa.md`)

Invoked per section per iteration with: section anchor, page URL, design crops per breakpoint, mask regions, thresholds.

- `qa/shoot.mjs`: viewport = design width, DPR = design scale, `reducedMotion: 'reduce'` (presets, plugin reveal, Lenis honour it), intro overlay suppressed, waits for fonts + network idle, element screenshot of `#pb-s{n}`, captures console errors.
- `qa/diff.mjs` (pixelmatch + sharp): normalize widths; report `heightDelta` separately; score overlap with anti-aliasing tolerance and masks; write composite `design | render | heatmap`.
- Subagent reviews the composite and returns only:
  ```json
  { "pass": false, "mismatch": 0.11, "heightDelta": 0.02,
    "discrepancies": [{ "area": "headline", "issue": "font-size ~48px vs ~56px", "severity": "high", "fix": "use text-h1 token" }] }
  ```
- **Pass rule:** `mismatch ≤ qa.mismatchMax` (default 0.08) AND `heightDelta ≤ qa.heightDeltaMax` (default 0.03) AND no `high` severity discrepancies.
- **Loop:** main agent applies fixes → re-QA. After `qa.maxIterations` (default 5) it shows the composite and asks: accept / guide / skip. Every iteration is logged in state.
- **Breakpoints:** provided frames → strict diff. Not provided → `qa/sanity.mjs` (horizontal overflow, overlapping elements, text < 14px, tap targets < 44px, broken images) + vision sanity pass, no diff score.
- **Regressions:** extending a block re-shoots every page in `library[block].usedOn` and diffs against stored baselines.

### 6.3 Animate (`protoblocks-motion`)

- **Runtime** (`theme-assets/pb-motion.js`, installed once): declarative presets via `data-pb-motion` — `fade-up`, `stagger-children`, `split-lines`, `split-chars`, `clip-reveal`, `scale-in`, `parallax`, `counter`, `marquee` — with `data-pb-delay`, `data-pb-stagger`, `data-pb-start` options. Built on theme globals (GSAP, ScrollTrigger, SplitText). Marks elements `data-proto-animate="manual"` so the plugin's no-JS fallback and watchdog still apply. Inits on `proto:page-ready`, tears down on `proto:page-leave` (Taxi). Reduced motion → final state instantly.
- **Motion profile:** chosen once per site (subtle / expressive / bold → durations, eases, stagger), stored in state; user motion notes override.
- Templates only add attributes; bespoke `view.js` only when the vocabulary can't express the design's intent.
- `qa/motion-check.mjs`: motion on, scroll through section; settled frame vs reduced-motion screenshot ≤ 2% mismatch; CLS ≈ 0; no console errors; Taxi navigate away and back → re-init without duplicate triggers.

### 6.4 Section done

Mark `status: done` in state; commit in the theme fork (`feat(block): <name>` / `feat(page): <slug> section <n>`).

## 7. Page completion

- **Full-page QA** at each provided breakpoint: full-page screenshot vs full design (catches inter-section spacing/rhythm).
- **Accessibility:** axe-core via Playwright; fix serious/critical; list the rest.
- Then SEO (§8), then: "Add this page to the primary menu?" → "Any other landing pages to build?" → back to §5 with the grown library. Pending nav links for the new page are patched.

## 8. SEO (`protoblocks-seo`, `/protoblocks:seo <page>`)

- **Inputs:** developer brief (focus keyword, title, description, audience, OG image, business info). Missing values are **inferred** from rendered page text, hero copy, site name, header/footer; each inferred value stored with `inferred: true` and a one-line rationale.
- **Yoast post meta** (`scripts/wp/yoast.php`): `_yoast_wpseo_focuskw`, `_yoast_wpseo_title` (with `%%sep%% %%sitename%%`), `_yoast_wpseo_metadesc`, `_yoast_wpseo_opengraph-title|description|image|image-id`, `_yoast_wpseo_twitter-title|description|image`, `_yoast_wpseo_schema_page_type`. Site-level Organization (`wpseo_titles`: company name/logo; `wpseo_social` profiles) only when empty. Then `wp yoast index`.
- **JSON-LD:** Yoast graph is the backbone. `inc/pb-schema.php` (installed in setup) merges per-page `_pb_schema` post meta into the graph via `wpseo_schema_graph_pieces`, `@id`-linked to Yoast's WebPage. The agent builds `_pb_schema` from sections: FAQ items → FAQPage; Service/Product/Event/Review/HowTo when content warrants.
- **OG image:** provided → import; else `qa/og-image.mjs` renders the hero at 1200px and frames 1200×630 → import → set as OG image and as featured image if none.
- **Audit + fix** (`qa/seo-audit.mjs` on rendered HTML): one H1; heading order; keyword in title/H1/first paragraph/meta description/slug; title ≤ 60 chars; description 120–156 chars; all images have alt; ≥ 1 internal link; JSON-LD parses and has required props; OG tags present and image 1200×630 reachable; canonical present. Content fixes go through the page spec + rebuild; any section whose markup changed re-runs visual QA.
- **Report:** table of final values and audit results; inferred values marked for review.

## 9. Docs hub refresh (`protoblocks`)

- Bump to plugin v2.10.1.
- Add gotchas found while mapping the plugin:
  - `wp proto-blocks create --dir=plugin` writes to `plugins/proto-blocks-custom`, which isn't a discovery path.
  - Editor recognizes `inner-blocks`; PHP validator expects `innerblocks` → `validate` warns on the correct spelling.
  - The bundled `hero` example echoes `$content` (renders empty nested blocks on the frontend).
  - Tailwind has no CLI command; compile via `wp eval`.
  - Tailwind v4 input has no default brand tokens; `primary-*` classes need `tailwind-theme.css` tokens.
- New `references/theme.md`: proto-blocks-theme — builder canvas, Taxi wrapper + lifecycle events + script reload rules, animation globals, token file, required plugins.
- Description narrowed so the docs skill triggers on block authoring/debugging and defers site-building requests to `protoblocks-site-builder`.
- Fix version drift: `marketplace.json` (1.2.0) and `plugin.json` (1.3.0) both → 2.0.0.

## 10. Error handling

| Situation | Behavior |
|---|---|
| Preflight failure | Stop with an actionable fix ("start the site in Local", "install Node 18+") |
| WP-CLI / Tailwind / PHP render error | Surface verbatim; treat as a build failure inside the loop |
| MCP server (Figma/Penpot) unavailable | Say so; offer image-export path |
| State file invalid | Restore from `.bak` or stop; never silently reinitialize |
| QA iteration cap reached | Show composite; ask accept / guide / skip |
| Destructive action (template-part override removal, overwrite page edited in wp-admin, overwrite theme fork) | Require explicit confirmation |
| Missing assets | Proceed with crops/placeholders, mask in QA, list in "replace with originals" |

## 11. Testing

- **Script unit tests** (`node:test`): `diff.mjs` and `segment.mjs` against fixture images with known answers; `seo-audit.mjs` against fixture HTML; `state.mjs` schema validation and backup/restore.
- **PHP integration tests:** harness against a throwaway Local site named by `PROTOBLOCKS_TEST_SITE`: idempotent setup, navigation create/patch, parts rewrite, page rebuild round-trip + hash guard, media dedupe, Yoast meta write + schema merge.
- **Skill behavior tests** (writing-skills style): subagent pressure scenarios with/without the skill. Required behaviors: pauses for plan approval; resumes from state; never skips QA or reports a pass without a verdict; asks at iteration cap; asks before destructive actions; flags inferred SEO values.
- **Fixtures:** 2–3 sample designs in `tests/fixtures/designs/` (image input; one with desktop+mobile) for end-to-end dry runs.

## 12. Delivery stages

Each stage is independently usable and gets its own implementation plan.

1. **Foundation:** plugin restructure (skills/commands/agents layout), docs hub refresh, state schema + `state.mjs`, preflight + `local-site.sh`.
2. **Site setup:** plugins, theme fetch/fork, theme assets install, tokens, navigation, parts rewrite.
3. **QA tooling:** `shoot`, `diff`, `sanity`, `segment`, `visual-qa` subagent + unit tests.
4. **Breakdown + section loop:** intake adapters, plan gate, block build gates, `page.php`, `media.php`, header/footer via loop.
5. **Motion:** `pb-motion.js` runtime, motion skill, `motion-check`.
6. **SEO:** `yoast.php`, `pb-schema.php`, `og-image`, `seo-audit`, SEO skill + command.
7. **Orchestration:** orchestrator skill, commands, resume, full-page QA + a11y, multi-page loop, end-to-end dry runs on fixtures.
