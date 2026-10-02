# Build state schema

## Files

| Path (under `wp-content/themes/<fork>/.protoblocks/`) | Purpose |
|---|---|
| `build.json` | The state. Versioned with the theme repo. |
| `build.json.bak` | Last valid copy, refreshed on each write. Used by `restore`. |
| `build.json.lock` | Write lock (stale after 30 s). Ignored by git. |
| `.gitignore` | Created by `init`: `artifacts/`, `build.json.bak`, `build.json.lock`, `build.json.tmp-*`. |
| `artifacts/` | Design crops, screenshots, composites. Not versioned. |

## Shape

Required: `schemaVersion` (1), `site.url`, `site.path`, `library`, `pages`; each page needs `slug`, `status`, `sections`; each section `n`, `anchor`, `status`. Other keys are free-form.

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
    "navigation": { "menus": { "primary": { "id": 123, "spec": { "title": "Primary", "items": […] }, "pending": [{ "label": "Pricing", "page": "pricing" }], "contentHash": "<sha256>" } } },
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

## `site.navigation.menus.<key>`

Written by `navigation.mjs` (`upsert` and `refresh`); one entry per menu key (`^[a-z0-9][a-z0-9_-]*$`, the `wp_navigation` post slug is `pb-nav-<key>`).

| Field | Meaning |
|---|---|
| `id` | `wp_navigation` post ID (the header/footer part references it as `ref`). |
| `spec` | The spec last passed to `upsert` (`{ title?, items }`). `refresh` keeps it. |
| `pending` | `[{ label, page }]` page links still written as placeholder custom links (page missing or unpublished). |
| `contentHash` | sha256 of the menu's `post_content` as protoblocks last wrote it. `upsert` refuses (`[EEDITED]`) when the live menu no longer matches (edited in the Site Editor) unless `--force`. |

`site.url` must equal the URL of the site the tools run against; otherwise setup and the tokens/navigation/parts CLIs refuse with `[EWRONGSITE]` (the state belongs to another site).

## Plan fields (written by `protoblocks-design-breakdown`)

Free-form keys (not schema-enforced), set at the plan gate after the developer approves:

| Path | Meaning |
|---|---|
| `pages[i].plan` | `{ "approvedAt": "<ISO timestamp>", "by": "developer" }`. Must exist before the page `status` becomes `building`. |
| `pages[i].notes.shellCap` | String note that the theme's 1440px shell cap in `style.css` was changed for a wider desktop frame. |
| `sections[j].label` | Human label, e.g. "Hero". |
| `sections[j].decision` | `new`, `reuse` or `extend` (enum-checked). |
| `sections[j].block` | Block slug the section uses. |
| `sections[j].notes` | Plan notes (shared classes, assets to replace, etc.). |
| `sections[j].masks.<bp>` | Regions visual QA ignores: `[{ "x", "y", "w", "h" }]` in crop pixel coordinates of that breakpoint's crop. |

Find pages by `slug` and sections by `n`, not by array position.

## Enums and defaults

| Field | Values |
|---|---|
| `site.wp.mode` | `local-wrapper`, `native` |
| page `status` | `planning`, `building`, `seo`, `done` |
| section `status` | `planned`, `building`, `verifying`, `animating`, `done`, `skipped` |
| section `decision` | `new`, `reuse`, `extend` |

QA defaults (filled by `init` when `site.qa` is absent or partial): `mismatchMax` 0.08, `heightDeltaMax` 0.03, `maxIterations` 5.

## CLI

`node "$PB/lib/state.mjs" <cmd> <themeDir> [path] [json]`. Paths are dotted; array indexes are numbers (`pages.0.sections.2.qa`). Output is JSON on stdout.

| Command | Behavior |
|---|---|
| `init <themeDir> <site.json>` | Creates `build.json` from the `site` object (a file path, not inline JSON) plus QA defaults, and `.gitignore`. Fails `[EEXISTS]` if state exists. |
| `get <themeDir> [path]` | Prints the value; no path prints everything; missing path prints `null`. |
| `set <themeDir> <path> <json>` | Sets a value (creates intermediate objects), prints the new value. |
| `append <themeDir> <path> <json>` | Pushes onto an array (creates it if absent); `[EINVALID]` if not an array. |
| `validate <themeDir>` | Prints `{"valid": true}` or fails. |
| `restore <themeDir>` | Replaces `build.json` with the valid `build.json.bak`. `[ENOBACKUP]` if none. |

Exit codes: 0 success, 1 error (message `[CODE] ...` on stderr), 64 usage error. Error codes: `ENOSTATE`, `EEXISTS`, `EPARSE` (not JSON), `EINVALID` (schema violation, including a rejected `set`/`append`), `EVALUE` (the `<json>` argument is not valid JSON), `ENOBACKUP`, `ELOCKED` (lock held over 10 s). `set`/`append` take the lock, validate the result, and write atomically, so a rejected write leaves state unchanged.

**Recovery guidance.** Run `restore` only when the file on disk is bad: `[EPARSE]`, or `[EINVALID]` from `get`/`validate`. A rejected `set`/`append` (`[EINVALID]`, or `[EVALUE]` for a malformed JSON argument) leaves state unchanged: fix the value and retry, and do not `restore`, because that would roll back the previous good write. `set` also rejects a non-numeric key on an array, an index past the array length (use `append` or index = length), and the segments `__proto__`, `constructor`, `prototype`.
