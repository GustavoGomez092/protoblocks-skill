# Admin screens, WP-CLI and REST for the content model

Everything the Proto-Blocks admin can change is a file in the theme, so an agent normally **writes the files** and uses the screens, CLI and REST to check its work. Block commands (`list`, `create`, `cache`, `export`, `tailwind`) are in `cli-and-hooks.md`. Plugin docs (Proto-Blocks repo): `docs/cli.md`, `docs/rest-api.md`.

## Admin screens (Proto Blocks menu, `manage_options`)

| Screen | `admin.php?page=` | What it does |
|---|---|---|
| Blocks | `proto-blocks` | Discovered blocks, template cache clear, Example Blocks switch. |
| Post Types | `proto-blocks-post-types` | Every registered type tagged by origin (Proto-Blocks file / PHP / plugin / core), counts, "Declared twice" badge. Create, edit (form over `type.jsonc`, comments kept), delete (type the slug), Scaffold templates. Confirms before a save that affects existing posts. |
| Taxonomies | `proto-blocks-taxonomies` | Same for taxonomies. |
| Fields | `proto-blocks-fields` | Every field group with origin and status (`active`, `unrenderable`, `skipped-acf`). Visual builder: field rows (drag or keyboard reorder), type settings, location and condition builders, a JSONC pane, Save to file. ACF's own groups are listed read-only. |
| Options Pages | `proto-blocks-options-pages` | Declared settings pages (plus other plugins' pages, read-only); edits `page.jsonc`; "Create file" for a PHP page; delete keeps saved values. |
| Redirects | `proto-blocks-redirects` | Tabs: Redirects (rules across groups, hits, Test box), 404s (Add redirect, Ignore), Log, Import / Export (CSV, JSON, Apache, Nginx, `_redirects`, plugin importers), Settings. Writes `redirects.jsonc` and `settings.jsonc`. Paused banner while the Redirection plugin is active. See `redirects.md`. |
| Scripts | `proto-blocks-scripts` | List with H/B/F location badges, code editors, placement builder. Read-only without `unfiltered_html`. See `scripts.md`. |
| each settings page | its own slug (`theme-settings`) | The values form (tabs, child pages), saved through REST under the page's capability. |
| Tailwind Settings / System Status / Preview Capture / Setup Wizard | `proto-blocks-settings` / `-system` / `-previews` / `-wizard` | Unchanged tools. |

Post edit screens, term edit forms and user profiles show the matching field groups as boxes (block editor, classic editor and Elementor alike).

**Read-only mode.** With `DISALLOW_FILE_MODS` or `DISALLOW_FILE_EDIT`, an unwritable theme folder, or (multisite) a user who is not a network admin, every screen renders with write controls disabled and a banner naming the reason. There is no database fallback.

### UI or files?

| Task | Agent does |
|---|---|
| Declare or change types, taxonomies, groups, settings pages | Write the JSONC files (reviewable diff, comments, git). |
| Rename a type/taxonomy slug that has content | `wp proto-blocks type rename ... --yes --migrate`, never a folder move. |
| Delete a declaration that has content | Ask the developer first; content is never deleted but becomes unreachable. |
| Let a client admin edit the model later | Point them at the screens: they write the same files. |
| Check that a box, form or settings page renders and saves | Open the screen in a browser (logged in) or use the REST checks below. |
| Template scaffolding | `wp proto-blocks type scaffold <slug>` (or the button). |

After someone edits in the UI, re-read the file before you edit it again: the screen rewrites it (comments outside an edited array survive; comments inside an edited array in `page.jsonc` are lost).

## WP-CLI (`wp proto-blocks ...`)

Run with the site's resolved WP-CLI (`report.wp` in the site builder). Commands that write files need file mods allowed; they write into the active theme.

```bash
# Validation (blocks + every declaration; exits 1 on any error, warnings do not fail)
wp proto-blocks validate [--format=table|json]          # json: {"blocks": [...], "declarations": [{kind, slug, level, code, message, source}]}
wp proto-blocks validate <block>                        # one block only, no declarations

# Post types
wp proto-blocks type list [--format=table|json|csv]     # slug, name, origin, source, override, double, posts
wp proto-blocks type create "<Name>" [--slug=<slug>] [--plural=<plural>] [--json]
wp proto-blocks type scaffold <slug> [--taxonomies]     # block themes only; never overwrites
wp proto-blocks type validate [<slug>] [--format=table|json]
wp proto-blocks type rename <old> <new> [--yes] [--migrate]   # no --yes: prints the plan only

# Taxonomies (same flags, no scaffold)
wp proto-blocks taxonomy list|create|validate|rename

# Field groups
wp proto-blocks fields list [--format=table|json|csv]   # key, title, source, path, fields, location, status
wp proto-blocks fields validate [<path>...]             # no path: every group (+ wide_location warnings); paths: just those files

# Settings pages
wp proto-blocks options list [--format=table|json|csv]  # slug, title, menu, capability, storage, origin
wp proto-blocks options create "<Title>" [--slug=<slug>] [--menu=<menu>] [--capability=<cap>] [--storage-option=<name>]

# Redirects (redirects.md)
wp proto-blocks redirect list | add /old /new --code=301 | delete <id> | enable <id> | disable <id>
wp proto-blocks redirect group list | create "Legacy" | enable|disable|delete <slug>
wp proto-blocks redirect validate | test /old [--logged-in] | prune | db install|status|drop --yes
wp proto-blocks redirect import file.csv --dry-run | import-plugin redirection --dry-run | export --format=apache -
wp proto-blocks redirect log [--404 --limit=20 --clear]

# Scripts (scripts.md)
wp proto-blocks script list | create "GTM" | validate | enable gtm | disable gtm | delete gtm --confirm=gtm
```

Common finding codes: `double_declaration`, `declared_too_late`, `name_required`, `slug_mismatch`, `schema_invalid`, `invalid_jsonc` (with line and column), `both_extensions`, `icon_invalid`, `unknown_type`, `unsupported_location_rule`, `missing_location`, `duplicate_group_key`, `broken_override`, `wide_location`, `shared_storage`, `protected_meta_key`; redirects: `invalid_regex`, `unanchored_regex`, `invalid_target`, `invalid_code`, `self_redirect`, `redirect_chain`, `duplicate_rule`, `use_when_server`, `invalid_header`, `monitor_unwritable`; scripts: `php_in_snippet`, `invalid_snippet_file`, `snippet_file_missing`, `missing_body_open`.

Checking values from the CLI (the getter escapes, exactly as a template sees it):

```bash
wp eval 'echo wp_json_encode(proto_field("subtitle", 42));'
wp eval 'echo wp_json_encode(proto_fields("option:theme-settings"));'
wp post meta get 42 agenda --format=json
```

Seeding values: plain text works as is (`wp post meta update 42 subtitle "Opening night"`; arrays with `--format=json`). WP-CLI runs as user 0, which lacks `unfiltered_html`: markup is stripped and `code`/`password` values are refused. Add `--user=<admin login>` for those.

## REST routes (namespace `proto-blocks/v1`)

Admin routes need `manage_options`; writes also need file mods and, on multisite, a network admin. Cookie requests need the `wp_rest` nonce. From the CLI the easiest authenticated call is an internal request:

```bash
wp eval --user=admin 'echo wp_json_encode(rest_do_request(new WP_REST_Request("GET", "/proto-blocks/v1/admin/types"))->get_data());'
```

| Route | Use during QA |
|---|---|
| `GET admin/types`, `GET admin/types/<slug>` | Registered types with origin, source, counts, issues. |
| `GET admin/redirects`, `GET admin/redirects/test?url=` | Groups, rules, hits, issues; which rule fires for a URL (trace). |
| `GET admin/scripts`, `GET admin/scripts/<slug>` | Scripts with locations, origin, issues; one script with its snippet texts. |
| `POST admin/types/<slug>/scaffold` body `{"taxonomies": bool}` | Scaffold templates (same as the CLI). |
| `GET admin/taxonomies`, `GET admin/taxonomies/<slug>` | Taxonomies. |
| `GET admin/fields` | Every group: `origin`, `status` (`active` / `unrenderable` / `skipped-acf`), `issues`, `editable`, `readOnlyReason`; also `acfActive`, `createTarget`. |
| `GET admin/fields/<key>` | One group with its file and the choices the builder offers. |
| `POST admin/fields/validate` body `{"text": "<file text>", "kind": "field-group"\|"type"\|"taxonomy"}` | Validate a group text without writing it. |
| `GET admin/options-pages`, `GET admin/options-pages/<slug>` | Declared settings pages and the menu around them (never option values). |
| `GET admin/schema-files/<kind>/<slug>` | A declaration file's text, hash and data (`kind`: `type`, `taxonomy`, `options`, `field-group`). |
| `POST`/`PUT admin/schema-files/<kind>/<slug>` body `{"text", "hash", "acknowledge": []}` | What the UI saves through: validates, confines to the theme, atomic write. `409 proto_blocks_conflict` = the file changed since `hash`; `409 proto_blocks_needs_confirmation` = content guardrails (resend with their codes in `acknowledge` only with the developer's OK). |
| `DELETE admin/schema-files/<kind>/<slug>?confirm=<slug>` | Delete a declaration folder (the typed slug confirms). |
| `GET options/<slug>` | A settings page's values (`values`, `trusted`, `readOnly`), gated on that page's own capability. |
| `POST options/<slug>` | The settings page's Save. |
| `/wp/v2/<rest_base>/<id>` → `meta` | Post fields exposed in REST (`show_in_rest`). |

Agents write files directly rather than POSTing to `schema-files`; the route matters when testing the UI's save path. Note that direct file writes skip the content guardrails, so check counts first (`type list`).
