<?php
/**
 * Render smoke test for one Proto-Block (frontend + editor preview).
 * Usage: wp eval-file render-block.php render <payload.json>   payload: {"block": "<slug>", "attrs": {...}}
 * The attrs travel in a file (wp.evalFilePayload): free text never reaches WP-CLI argv.
 */
$payload = (($args[0] ?? '') === 'render' && isset($args[1])) ? json_decode((string) @file_get_contents($args[1]), true) : null;
$slug = is_array($payload) && is_string($payload['block'] ?? null) ? sanitize_key($payload['block']) : '';
$attrs = is_array($payload) ? ($payload['attrs'] ?? []) : null;
if ($slug === '' || $slug !== ($payload['block'] ?? null) || !is_array($attrs)) { fwrite(STDERR, "Usage: render-block.php render <payload.json> ({\"block\":\"<slug>\",\"attrs\":{}})\n"); exit(1); }
$attrs['anchor'] = 'pb-gate';

$admins = get_users(['role' => 'administrator', 'number' => 1, 'fields' => 'ID']);
if (empty($admins)) { echo wp_json_encode(['ok' => false, 'environment' => 'no administrator user found']) . "\n"; exit(0); }
wp_set_current_user((int) $admins[0]);

$block_dir = wp_normalize_path(get_stylesheet_directory() . '/proto-blocks/' . $slug . '/');
// PHP reports resolved paths, so a symlinked theme or block folder must match by its real path too.
$real = realpath($block_dir);
$block_real = $real !== false ? wp_normalize_path($real . '/') : $block_dir;
$errors = [];
$other = [];
$sev = function (int $no): string {
    return in_array($no, [E_WARNING, E_USER_WARNING], true) ? 'warning'
        : (in_array($no, [E_NOTICE, E_USER_NOTICE], true) ? 'notice'
        : (in_array($no, [E_DEPRECATED, E_USER_DEPRECATED], true) ? 'deprecated' : 'error'));
};
set_error_handler(function ($no, $str, $file, $line) use (&$errors, &$other, $block_dir, $block_real, $sev) {
    $entry = ['message' => $str, 'file' => $file, 'line' => $line, 'severity' => $sev($no)];
    $f = wp_normalize_path($file);
    if (str_starts_with($f, $block_dir) || str_starts_with($f, $block_real)) { $errors[] = $entry; } else { $other[] = $entry; }
    return true;
});

// An uncatchable fatal (E_ERROR, OOM) kills the process, and WP's own fatal handler then replaces the cause with a
// generic "critical error" page via wp_die(). No shutdown function or output-buffer callback of ours runs after
// that exit, so let PHP write the real "Fatal error: <message> in <file> on line <n>" to stdout; gates.mjs parses it.
ini_set('display_errors', '1');
ini_set('html_errors', '0');

$html = '';
try {
    $html = do_blocks(serialize_block(['blockName' => 'proto-blocks/' . $slug, 'attrs' => $attrs, 'innerBlocks' => [], 'innerHTML' => '', 'innerContent' => []]));
} catch (\Throwable $e) {
    $errors[] = ['message' => $e->getMessage(), 'file' => $e->getFile(), 'line' => $e->getLine(), 'severity' => 'error'];
}

try {
    $req = new WP_REST_Request('POST', '/proto-blocks/v1/preview');
    $req->set_body_params(['template' => $slug, 'attributes' => $attrs]);
    $res = rest_do_request($req);
} finally {
    restore_error_handler();
}

$status = $res->get_status();
$data = $res->get_data();
$message = $status === 200 ? null : (is_array($data) ? ($data['message'] ?? null) : null);
if ($status !== 200 && $message) {
    $errors[] = ['message' => 'editor preview: ' . $message, 'file' => $block_dir . 'template.php', 'line' => 0, 'severity' => 'error'];
}
$frontend = ['length' => strlen(trim($html)), 'hasAnchor' => str_contains($html, 'id="pb-gate"')];
$ok = $status === 200 && $frontend['length'] > 0 && $frontend['hasAnchor'] && count($errors) === 0;

echo wp_json_encode(['ok' => $ok, 'frontend' => $frontend, 'editor' => ['status' => $status, 'message' => $message], 'errors' => $errors, 'other' => array_slice($other, 0, 20)]) . "\n";
