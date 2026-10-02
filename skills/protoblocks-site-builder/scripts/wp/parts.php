<?php
/**
 * Template-part DB overrides (Site Editor saved copies) for the active theme.
 * Usage: wp eval-file parts.php overrides <theme>
 *        wp eval-file parts.php preview <theme> <slug>
 *        wp eval-file parts.php remove-override <theme> <slug> confirm <expectedId>
 * <theme> must equal get_stylesheet(). Slugs are validated, never normalized.
 * remove-override moves the single matching post to Trash (recoverable).
 */
$fail = function (string $code, string $msg) {
    fwrite(STDERR, "[{$code}] {$msg}\n");
    exit(1);
};
// The filter may only make the trash guard stricter: the result is min(constant, filtered value),
// so a filter can never enable trashing when EMPTY_TRASH_DAYS is 0 (wp_trash_post would force-delete).
if (!function_exists('protoblocks_parts_trash_days')) {
    function protoblocks_parts_trash_days(int $constant): int {
        return min($constant, (int) apply_filters('protoblocks_parts_trash_days', $constant));
    }
}
$cmd = $args[0] ?? '';
$theme = $args[1] ?? '';
if (!in_array($cmd, ['overrides', 'preview', 'remove-override'], true)) {
    $fail('EUSAGE', "Unknown command: {$cmd}");
}
if ($theme !== get_stylesheet()) {
    $fail('ETHEMEMISMATCH', 'Requested theme "' . $theme . '" is not the active theme "' . get_stylesheet() . '".');
}

$rows = function (?string $slug) use ($theme) {
    $posts = get_posts([
        'post_type' => 'wp_template_part', 'numberposts' => -1,
        'post_status' => ['auto-draft', 'draft', 'publish'],
        'tax_query' => [['taxonomy' => 'wp_theme', 'field' => 'name', 'terms' => $theme]],
    ]);
    // Filter in PHP: WP_Query drops tax_query when `name` is set, which would match other themes' parts.
    $posts = array_values(array_filter($posts, fn($p) => has_term($theme, 'wp_theme', $p) && ($slug === null || $p->post_name === $slug)));
    return array_map(fn($p) => ['id' => (int) $p->ID, 'slug' => $p->post_name, 'theme' => implode(',', wp_get_post_terms($p->ID, 'wp_theme', ['fields' => 'names'])), 'modified' => $p->post_modified_gmt], $posts);
};

if ($cmd === 'overrides') {
    echo wp_json_encode($rows(null)) . "\n";
    return;
}

$slug = $args[2] ?? '';
if ($slug === '' || sanitize_title($slug) !== $slug) {
    $fail('ESLUG', 'Invalid slug ' . wp_json_encode($slug) . '.');
}
$found = $rows($slug);
if (count($found) > 1) {
    $fail('EAMBIGUOUS', 'More than one match: IDs ' . implode(', ', wp_list_pluck($found, 'id')));
}
if (count($found) === 1) {
    // Resolve the way core does and require the same post.
    $tpl = get_block_template($theme . '//' . $slug, 'wp_template_part');
    if (!$tpl || $tpl->source !== 'custom' || $tpl->theme !== $theme || (int) $tpl->wp_id !== $found[0]['id']) {
        $fail('ETHEMEMISMATCH', 'Core does not resolve "' . $slug . '" to post ' . $found[0]['id'] . ' for theme "' . $theme . '"; refusing.');
    }
}
if ($cmd === 'preview') {
    echo wp_json_encode($found) . "\n";
    return;
}

if (($args[3] ?? '') !== 'confirm') {
    $fail('ECONFIRM', 'remove-override requires the explicit argument "confirm".');
}
$expect = $args[4] ?? '';
if (!ctype_digit($expect) || (int) $expect <= 0) {
    $fail('ECONFIRM', 'remove-override requires the previewed post ID as the last argument.');
}
if (count($found) === 1 && $found[0]['id'] !== (int) $expect) {
    $fail('ESTALE', 'Saved part is now ID ' . $found[0]['id'] . ', not the previewed ' . (int) $expect . '; nothing removed.');
}
if ($found) {
    // wp_trash_post force-deletes when trash is disabled; never allow that.
    $trash_days = protoblocks_parts_trash_days(defined('EMPTY_TRASH_DAYS') ? (int) EMPTY_TRASH_DAYS : 0);
    if ($trash_days <= 0) {
        $fail('ENOTRASH', 'Trash is disabled, so removal would permanently delete the saved copy. Remove it manually: Site Editor -> template part -> Clear customizations.');
    }
}
$removed = [];
foreach ($found as $r) {
    if (wp_trash_post($r['id'])) { $removed[] = $r['id']; }
}
echo wp_json_encode(['removed' => $removed, 'records' => $found]) . "\n";
