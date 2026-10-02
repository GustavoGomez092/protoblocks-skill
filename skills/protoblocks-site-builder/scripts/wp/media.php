<?php
/**
 * Import a local file into the Media Library once (dedupe by SHA-1).
 * Usage: wp eval-file media.php import <base64url JSON {file, alt, title}>
 * The payload is a single argument so alt/title text can never be parsed as WP-CLI flags.
 * Prints one JSON line: the result, or {"error":{"code","message"[, "id"]}}.
 */
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/media.php';
require_once ABSPATH . 'wp-admin/includes/image.php';
kses_remove_filters();
$admins = get_users(['role' => 'administrator', 'number' => 1, 'fields' => 'ID']);
wp_set_current_user((int) ($admins[0] ?? 0));

$fail = function (string $code, string $m, ?int $id = null) {
    $e = ['code' => $code, 'message' => $m];
    if ($id) { $e['id'] = $id; }
    echo wp_json_encode(['error' => $e]) . "\n";
    exit(0);
};
if (($args[0] ?? '') !== 'import' || count($args) !== 2) { $fail('EUSAGE', 'Usage: media.php import <base64url JSON>'); }
$b64 = strtr((string) $args[1], '-_', '+/');
$raw = base64_decode($b64, true);
$p = $raw === false ? null : json_decode($raw, true);
if (!is_array($p) || !is_string($p['file'] ?? null) || !is_string($p['alt'] ?? null) || !is_string($p['title'] ?? '')) { $fail('EUSAGE', 'Invalid payload'); }
$file = $p['file'];
$alt = $p['alt'];
$title = (string) ($p['title'] ?? '');
if (strlen($alt) > 4000 || mb_strlen($alt) > 1000) { $fail('EALT', 'Alt text is longer than 1000 characters'); }
if (!path_is_absolute($file)) { $fail('EUSAGE', 'The file path must be absolute'); }
if (mb_strlen($title) > 200) { $fail('ETITLE', 'Title is longer than 200 characters'); }
if (!is_file($file) || !is_readable($file)) { $fail('EFILE', "Cannot read {$file}"); }

$result = function (int $id, string $alt, bool $reused) {
    return ['id' => $id, 'url' => wp_get_attachment_url($id), 'alt' => $alt, 'mime' => get_post_mime_type($id), 'reused' => $reused];
};
$set_meta = function (int $id, string $key, string $value): bool {
    // update_post_meta returns false both on failure and when the value is unchanged; verify by reading back.
    update_post_meta($id, $key, wp_slash($value));
    return (string) get_post_meta($id, $key, true) === $value;
};

$hash = sha1_file($file);
$found = get_posts(['post_type' => 'attachment', 'post_status' => 'inherit', 'numberposts' => -1, 'meta_key' => '_pb_source_hash', 'meta_value' => $hash, 'fields' => 'ids']);
foreach ($found as $cand) {
    $path = get_attached_file((int) $cand);
    if ($path && is_readable($path)) {
        if (!$set_meta((int) $cand, '_wp_attachment_image_alt', $alt)) { $fail('EMETA', 'Could not update alt text on the reused attachment', (int) $cand); }
        echo wp_json_encode($result((int) $cand, $alt, true)) . "\n";
        return;
    }
}
// Only stale matches (file missing on disk) remain: import fresh, then move the hash to the new attachment.

$tmp = wp_tempnam(basename($file));
if (!$tmp || !copy($file, $tmp)) { if ($tmp) { @unlink($tmp); } $fail('ESIDELOAD', 'Could not stage the file for import'); }
// Locale-independent type check: WP's own allow-list (incl. upload_mimes filters) and content sniffing.
$ft = wp_check_filetype_and_ext($tmp, basename($file), null);
if (empty($ft['type']) || empty($ft['ext'])) {
    @unlink($tmp);
    $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
    $fail('ETYPE', $ext === 'svg'
        ? 'SVG uploads are disabled on this site; convert to PNG or inline the SVG in the template'
        : 'file type not allowed on this site: ' . $ext);
}
$id = media_handle_sideload(['name' => basename($file), 'tmp_name' => $tmp], 0, $title !== '' ? $title : null);
if (is_wp_error($id)) {
    @unlink($tmp);
    // Fallback only; the check above is the locale-independent one.
    $code = preg_match('/file type|not allowed to upload/i', $id->get_error_message()) ? 'ETYPE' : 'ESIDELOAD';
    $fail($code, $id->get_error_message());
}
$id = (int) $id;
if (!$set_meta($id, '_pb_source_hash', $hash)) { $fail('EMETA', 'Could not store the source hash', $id); }
foreach ($found as $stale) { delete_post_meta((int) $stale, '_pb_source_hash'); }
if (!$set_meta($id, '_wp_attachment_image_alt', $alt)) { $fail('EMETA', 'Could not store the alt text', $id); }
echo wp_json_encode($result($id, $alt, false)) . "\n";
