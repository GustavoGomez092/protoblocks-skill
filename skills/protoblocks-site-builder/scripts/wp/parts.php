<?php
/**
 * Template-part DB overrides (Site Editor saved copies) for the active theme.
 * Usage: wp eval-file parts.php overrides
 *        wp eval-file parts.php remove-override <slug>
 */
$cmd = $args[0] ?? '';
$theme = get_stylesheet();
$query = function (?string $slug) use ($theme) {
    $q = [
        'post_type' => 'wp_template_part', 'numberposts' => -1,
        'post_status' => ['publish', 'draft', 'auto-draft', 'private'],
        'tax_query' => [['taxonomy' => 'wp_theme', 'field' => 'name', 'terms' => $theme]],
    ];
    // Filter by slug in PHP: WP_Query drops tax_query when `name` is set, which would match other themes' parts.
    $posts = get_posts($q);
    return $slug === null ? $posts : array_values(array_filter($posts, fn($p) => $p->post_name === $slug));
};

if ($cmd === 'overrides') {
    $out = array_map(fn($p) => ['id' => (int) $p->ID, 'slug' => $p->post_name, 'theme' => $theme, 'modified' => $p->post_modified_gmt], $query(null));
    echo wp_json_encode(array_values($out)) . "\n";
    return;
}
if ($cmd === 'remove-override') {
    $slug = sanitize_title($args[1] ?? '');
    if ($slug === '') { fwrite(STDERR, "Missing slug.\n"); exit(1); }
    $removed = [];
    foreach ($query($slug) as $p) {
        if (wp_delete_post($p->ID, true)) { $removed[] = (int) $p->ID; }
    }
    echo wp_json_encode(['removed' => $removed]) . "\n";
    return;
}
fwrite(STDERR, "Unknown command: {$cmd}\n");
exit(1);
