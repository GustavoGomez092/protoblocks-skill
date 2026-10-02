# Local by Flywheel sites

Shell variables do not persist between Bash commands: start each command with the `PB=...; THEME=...;` line from SKILL.md (Scripts).

## Where Local keeps things

| What | Path |
|---|---|
| Site registry | `~/Library/Application Support/Local/sites.json` |
| Running/stopped status | `~/Library/Application Support/Local/site-statuses.json` |
| PHP binaries | `~/Library/Application Support/Local/lightning-services/php-<ver>+<n>/bin/<platform>/bin/php` (`<platform>` = `darwin-arm64`, `darwin`, or `linux`) |
| MySQL socket | `~/Library/Application Support/Local/run/<siteId>/mysql/mysqld.sock` |
| WP-CLI | `/Applications/Local.app/Contents/Resources/extraResources/bin/wp-cli/wp-cli.phar` |
| WordPress root | `<site path>/app/public` |

## Why plain `wp` fails

Local sites use `DB_HOST = localhost`. PHP then connects through the default MySQL socket, which Local does not use (each site has its own socket under `run/<siteId>/`). Outside Local's "Open site shell", `wp` fails with `Error establishing a database connection`.

## The wrapper

In `local-wrapper` mode preflight writes `<wp-content>/.protoblocks/wp`, a shell script that runs Local's PHP with the site's socket and Local's WP-CLI:

```sh
#!/bin/sh
export PHPRC='<appSupport>/run/<siteId>/conf/php'
export WP_CLI_CONFIG_PATH='<extraResources>/bin/wp-cli/config.yaml'
export MAGICK_CODER_MODULE_PATH='<php-dir>/bin/<platform>/ImageMagick/modules-Q16/coders'
exec '<php>' -d 'mysqli.default_socket=<socket>' -d 'pdo_mysql.default_socket=<socket>' -d memory_limit=512M '<wp-cli.phar>' '--path=<app/public>' "$@"
```

The three `export` lines mirror Local's own site shell (`ssh-entry/*.sh`) and are emitted only when the target exists. Without `PHPRC`, imagick/opcache are not loaded, so media subsizes would differ from php-fpm. Use it exactly like `wp`: `"$WP" option get siteurl`, with `WP` set to `report.wp`. To regenerate it alone: `node "$PB/lib/local-site.mjs" wrapper --site "<name>" --out <file>`. To inspect resolution without writing: `node "$PB/lib/local-site.mjs" detect [--site "<name>"] [--cwd <dir>]` (prints JSON, exits 2 on failure).

## Native mode

Used when no Local site matches and a WordPress install is found from the current directory (or `--path`): Local's "Open site shell", or a non-Local local install. `report.wp` is `wp` and preflight appends `--path=<root>` itself, so pass `--path` to your own calls too.

## Two `.protoblocks` folders

- `<wp-content>/.protoblocks/` - runtime: `wp` wrapper and `preflight.json`. Machine-specific; regenerate at will.
- `<theme>/.protoblocks/` - build state: `build.json`, `build.json.bak`, `artifacts/`. Belongs to the theme fork.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `halted: true`, "Start the site ... in Local" | Site stopped or socket missing. Start it in Local, re-run preflight. |
| "Local's PHP <ver> binary not found" | Site's PHP version changed or was uninstalled. Re-run preflight after Local finishes updating. |
| `Error establishing a database connection` | Site was stopped, or the wrapper is stale. Start the site, re-run preflight (rewrites the wrapper). |
| "Local's WP-CLI not found" / "Local by Flywheel not found" | Non-default install location. Set `PB_LOCAL_RESOURCES` (the `extraResources` dir) and/or `PB_LOCAL_APP_SUPPORT` (the Local data dir). |
| "No Local site matches" / "not inside a Local site" | Run from inside the site folder or pass `--site "<name>"`. |
