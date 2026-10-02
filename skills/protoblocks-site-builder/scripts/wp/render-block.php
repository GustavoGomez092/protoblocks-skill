<?php
/**
 * Render smoke test for one Proto-Block (frontend + editor preview).
 * Usage: wp eval-file render-block.php <slug> '<attrs json>'
 */
$slug = sanitize_key($args[0] ?? '');
$attrs = json_decode($args[1] ?? '{}', true);
if ($slug === '' || !is_array($attrs)) { fwrite(STDERR, "Usage: render-block.php <slug> '<attrs json>'\n"); exit(1); }
$attrs['anchor'] = 'pb-gate';

$admins = get_users(['role' => 'administrator', 'number' => 1, 'fields' => 'ID']);
wp_set_current_user((int) ($admins[0] ?? 0));

$block_dir = wp_normalize_path(get_stylesheet_directory() . '/proto-blocks/' . $slug . '/');
$errors = [];
$other = [];
$sev = function (int $no): string {
    return in_array($no, [E_WARNING, E_USER_WARNING], true) ? 'warning'
        : (in_array($no, [E_NOTICE, E_USER_NOTICE], true) ? 'notice'
        : (in_array($no, [E_DEPRECATED, E_USER_DEPRECATED], true) ? 'deprecated' : 'error'));
};
set_error_handler(function ($no, $str, $file, $line) use (&$errors, &$other, $block_dir, $sev) {
    $entry = ['message' => $str, 'file' => $file, 'line' => $line, 'severity' => $sev($no)];
    if (str_starts_with(wp_normalize_path($file), $block_dir)) { $errors[] = $entry; } else { $other[] = $entry; }
    return true;
});

$html = '';
try {
    $html = do_blocks(serialize_block(['blockName' => 'proto-blocks/' . $slug, 'attrs' => $attrs, 'innerBlocks' => [], 'innerHTML' => '', 'innerContent' => []]));
} catch (\Throwable $e) {
    $errors[] = ['message' => $e->getMessage(), 'file' => $e->getFile(), 'line' => $e->getLine(), 'severity' => 'error'];
}

$req = new WP_REST_Request('POST', '/proto-blocks/v1/preview');
$req->set_body_params(['template' => $slug, 'attributes' => $attrs]);
$res = rest_do_request($req);
restore_error_handler();

$status = $res->get_status();
$data = $res->get_data();
$message = $status === 200 ? null : (is_array($data) ? ($data['message'] ?? null) : null);
if ($status !== 200 && $message) {
    $errors[] = ['message' => 'editor preview: ' . $message, 'file' => $block_dir . 'template.php', 'line' => 0, 'severity' => 'error'];
}
$frontend = ['length' => strlen(trim($html)), 'hasAnchor' => str_contains($html, 'id="pb-gate"')];
$ok = $status === 200 && $frontend['length'] > 0 && $frontend['hasAnchor'] && count($errors) === 0;

echo wp_json_encode(['ok' => $ok, 'frontend' => $frontend, 'editor' => ['status' => $status, 'message' => $message], 'errors' => $errors, 'other' => array_slice($other, 0, 20)]) . "\n";
