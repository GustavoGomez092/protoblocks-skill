<?php
/**
 * Block-theme navigation menus (wp_navigation posts).
 * Usage: wp eval-file navigation.php upsert <key> <spec.json>
 *        wp eval-file navigation.php get <key>
 */
kses_remove_filters();

$pb_fail = function (string $msg) { fwrite(STDERR, $msg . "\n"); exit(1); };
$cmd = $args[0] ?? '';
$key = sanitize_key($args[1] ?? '');
if ($key === '') { $pb_fail('Missing menu key.'); }
$slug = 'pb-nav-' . $key;

function pb_nav_find(string $slug) {
    $found = get_posts([
        'post_type' => 'wp_navigation', 'name' => $slug, 'numberposts' => 1,
        'post_status' => ['publish', 'draft', 'private'],
    ]);
    return $found ? $found[0] : null;
}

function pb_nav_link_attrs(array $item, array &$pending): array {
    $attrs = ['label' => (string) ($item['label'] ?? '')];
    if (!empty($item['page'])) {
        $page = get_page_by_path((string) $item['page'], OBJECT, 'page');
        if ($page && $page->post_status !== 'trash') {
            return $attrs + ['type' => 'page', 'id' => (int) $page->ID, 'url' => get_permalink($page), 'kind' => 'post-type'];
        }
        $pending[] = ['label' => $attrs['label'], 'page' => (string) $item['page']];
        return $attrs + ['url' => home_url('/' . trim((string) $item['page'], '/') . '/'), 'kind' => 'custom'];
    }
    $attrs += ['url' => (string) ($item['url'] ?? '#'), 'kind' => 'custom'];
    if (!empty($item['opensInNewTab'])) { $attrs['opensInNewTab'] = true; }
    return $attrs;
}

function pb_nav_block(array $item, array &$pending): array {
    $attrs = pb_nav_link_attrs($item, $pending);
    if (!empty($item['children']) && is_array($item['children'])) {
        $inner = [];
        foreach ($item['children'] as $child) { $inner[] = pb_nav_block($child, $pending); }
        return ['blockName' => 'core/navigation-submenu', 'attrs' => $attrs, 'innerBlocks' => $inner,
                'innerHTML' => '', 'innerContent' => array_fill(0, count($inner), null)];
    }
    return ['blockName' => 'core/navigation-link', 'attrs' => $attrs, 'innerBlocks' => [], 'innerHTML' => '', 'innerContent' => []];
}

if ($cmd === 'get') {
    $post = pb_nav_find($slug);
    echo wp_json_encode(['id' => $post ? (int) $post->ID : null, 'content' => $post ? $post->post_content : '']) . "\n";
    return;
}

if ($cmd !== 'upsert') { $pb_fail("Unknown command: {$cmd}"); }
$file = $args[2] ?? '';
$spec = is_readable($file) ? json_decode((string) file_get_contents($file), true) : null;
if (!is_array($spec) || !isset($spec['items']) || !is_array($spec['items'])) { $pb_fail("Spec file {$file} must be JSON with an items array."); }

$pending = [];
$blocks = [];
foreach ($spec['items'] as $item) { $blocks[] = pb_nav_block($item, $pending); }

$existing = pb_nav_find($slug);
$postarr = [
    'post_type' => 'wp_navigation', 'post_status' => 'publish', 'post_name' => $slug,
    'post_title' => (string) ($spec['title'] ?? ucfirst($key)), 'post_content' => serialize_blocks($blocks),
];
if ($existing) { $postarr['ID'] = $existing->ID; }
$id = $existing ? wp_update_post(wp_slash($postarr), true) : wp_insert_post(wp_slash($postarr), true);
if (is_wp_error($id)) { $pb_fail($id->get_error_message()); }

echo wp_json_encode(['id' => (int) $id, 'key' => $key, 'created' => !$existing, 'pending' => $pending]) . "\n";
