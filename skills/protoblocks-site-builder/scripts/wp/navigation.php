<?php
/**
 * Block-theme navigation menus (wp_navigation posts). All input comes from a JSON payload file
 * (never positional data; see wp.mjs evalFilePayload):
 *   wp eval-file navigation.php get     <payload.json>   {"key"}
 *   wp eval-file navigation.php upsert  <payload.json>   {"key","spec","expectHash","force"}
 *   wp eval-file navigation.php refresh <payload.json>   {"key","pending":[{label,page}]}
 * Failures: "[ECODE] message" on STDERR, exit 1.
 */
kses_remove_filters();

$pb_fail = function (string $code, string $msg) { fwrite(STDERR, "[{$code}] {$msg}\n"); exit(1); };
$cmd = $args[0] ?? '';
if (!in_array($cmd, ['get', 'upsert', 'refresh'], true)) { $pb_fail('EUSAGE', "Unknown command: {$cmd}"); }
$file = $args[1] ?? '';
$payload = is_readable($file) ? json_decode((string) file_get_contents($file), true) : null;
if (!is_array($payload)) { $pb_fail('EUSAGE', "Payload file {$file} must be a JSON object."); }
$raw_key = (string) ($payload['key'] ?? '');
$key = sanitize_key($raw_key);
if ($key === '' || $key !== $raw_key) { $pb_fail('ENAVKEY', 'Invalid menu key ' . wp_json_encode($raw_key) . '.'); }
$slug = 'pb-nav-' . $key;

function pb_nav_find(string $slug) {
    // Trashed posts get a "__trashed" slug suffix; include them so upsert revives instead of duplicating.
    $found = get_posts([
        'post_type' => 'wp_navigation', 'post_name__in' => [$slug, $slug . '__trashed'], 'numberposts' => 5,
        'post_status' => ['publish', 'draft', 'private', 'pending', 'future', 'trash'],
    ]);
    foreach ($found as $post) { if ($post->post_status !== 'trash') { return $post; } }
    return $found ? $found[0] : null;
}

function pb_nav_hash(string $content): string { return hash('sha256', $content); }

// The URL a not-yet-published page link points at until refresh converts it.
function pb_nav_placeholder(string $page): string { return home_url('/' . trim($page, '/') . '/'); }

function pb_nav_published_page(string $page) {
    $p = get_page_by_path($page, OBJECT, 'page');
    return ($p && $p->post_status === 'publish') ? $p : null;
}

function pb_nav_link_attrs(array $item, array &$pending): array {
    $attrs = ['label' => (string) ($item['label'] ?? '')];
    if (!empty($item['page'])) {
        $page = pb_nav_published_page((string) $item['page']);
        if ($page) {
            return $attrs + ['type' => 'page', 'id' => (int) $page->ID, 'url' => get_permalink($page), 'kind' => 'post-type'];
        }
        $pending[] = ['label' => $attrs['label'], 'page' => (string) $item['page']];
        return $attrs + ['url' => pb_nav_placeholder((string) $item['page']), 'kind' => 'custom'];
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

// Walk parsed blocks; convert custom links whose URL is a pending placeholder into page links.
function pb_nav_patch(array &$blocks, array $targets, array &$found, array &$patched): void {
    foreach ($blocks as &$b) {
        if (in_array($b['blockName'] ?? '', ['core/navigation-link', 'core/navigation-submenu'], true)
            && ($b['attrs']['kind'] ?? '') === 'custom' && isset($b['attrs']['url']) && isset($targets[$b['attrs']['url']])) {
            $url = $b['attrs']['url'];
            $found[$url] = true;
            $page = $targets[$url]['post'];
            if ($page) {
                $b['attrs'] = array_merge($b['attrs'], ['type' => 'page', 'id' => (int) $page->ID, 'url' => get_permalink($page), 'kind' => 'post-type']);
                $patched[$url] = true;
            }
        }
        if (!empty($b['innerBlocks'])) { pb_nav_patch($b['innerBlocks'], $targets, $found, $patched); }
    }
    unset($b);
}

$existing = pb_nav_find($slug);

if ($cmd === 'get') {
    echo wp_json_encode([
        'id' => $existing ? (int) $existing->ID : null,
        'content' => $existing ? $existing->post_content : '',
        'contentHash' => $existing ? pb_nav_hash($existing->post_content) : null,
    ]) . "\n";
    return;
}

if ($cmd === 'refresh') {
    if (!$existing) { $pb_fail('ENOMENU', "Menu \"{$key}\" ({$slug}) not found; run upsert again."); }
    $pending = is_array($payload['pending'] ?? null) ? $payload['pending'] : [];
    $targets = [];
    foreach ($pending as $p) {
        $page = (string) ($p['page'] ?? '');
        if ($page === '') { continue; }
        $targets[pb_nav_placeholder($page)] = ['item' => ['label' => (string) ($p['label'] ?? ''), 'page' => $page], 'post' => pb_nav_published_page($page)];
    }
    $blocks = parse_blocks($existing->post_content);
    $found = [];
    $patched_urls = [];
    pb_nav_patch($blocks, $targets, $found, $patched_urls);
    $out = ['patched' => [], 'pending' => [], 'missing' => []];
    foreach ($targets as $url => $t) {
        if (isset($patched_urls[$url])) { $out['patched'][] = $t['item']; }
        elseif (isset($found[$url])) { $out['pending'][] = $t['item']; }
        else { $out['missing'][] = $t['item']; }
    }
    $content = $existing->post_content;
    if ($out['patched']) {
        $content = serialize_blocks($blocks);
        $id = wp_update_post(wp_slash(['ID' => $existing->ID, 'post_content' => $content]), true);
        if (is_wp_error($id)) { $pb_fail('EWP', $id->get_error_message()); }
        $content = get_post($existing->ID)->post_content;
    }
    echo wp_json_encode(['id' => (int) $existing->ID, 'key' => $key] + $out + ['contentHash' => pb_nav_hash($content)]) . "\n";
    return;
}

// upsert
$spec = $payload['spec'] ?? null;
if (!is_array($spec) || !isset($spec['items']) || !is_array($spec['items'])) { $pb_fail('EUSAGE', 'spec must be an object with an items array.'); }

$pending = [];
$blocks = [];
foreach ($spec['items'] as $item) { $blocks[] = pb_nav_block($item, $pending); }
$content = serialize_blocks($blocks);

if ($existing) {
    // Overwrite only what protoblocks wrote last (or an identical menu); anything else was edited elsewhere.
    $current = pb_nav_hash($existing->post_content);
    $expect = isset($payload['expectHash']) && is_string($payload['expectHash']) ? $payload['expectHash'] : null;
    if ($current !== pb_nav_hash($content) && $current !== $expect && empty($payload['force'])) {
        $pb_fail('EEDITED', "Menu \"{$key}\" (wp_navigation {$existing->ID}) changed since protoblocks last wrote it.");
    }
}

$postarr = [
    'post_type' => 'wp_navigation', 'post_status' => 'publish', 'post_name' => $slug,
    'post_title' => (string) ($spec['title'] ?? ucfirst($key)), 'post_content' => $content,
];
if ($existing) { $postarr['ID'] = $existing->ID; }
$id = $existing ? wp_update_post(wp_slash($postarr), true) : wp_insert_post(wp_slash($postarr), true);
if (is_wp_error($id)) { $pb_fail('EWP', $id->get_error_message()); }

echo wp_json_encode([
    'id' => (int) $id, 'key' => $key, 'created' => !$existing, 'pending' => $pending,
    'contentHash' => pb_nav_hash(get_post($id)->post_content),
]) . "\n";
