<?php
/**
 * Yoast SEO writer.
 * Usage: wp eval-file yoast.php apply <spec.json path> | get <postId> | site
 * The spec is a file so free text never travels as WP-CLI argv.
 * Prints one JSON line: the result, or {"error":{"code","message"}} (exit 0, like media.php; the JS caller throws
 * the typed code, because a non-zero exit would reach it as an untyped WpError). Codes: EYOAST, EUSAGE, EINPUT, ENOPOST, EMETA.
 * Every input is validated before anything is written.
 */
$fail = function (string $code, string $m) {
    echo wp_json_encode(['error' => ['code' => $code, 'message' => $m]]) . "\n";
    exit(0);
};
$out = function ($d) { echo wp_json_encode($d, JSON_UNESCAPED_SLASHES) . "\n"; };
if (!class_exists('WPSEO_Meta') || !class_exists('WPSEO_Options')) { $fail('EYOAST', 'Yoast SEO is not active.'); }
$admins = get_users(['role' => 'administrator', 'number' => 1, 'fields' => 'ID']);
wp_set_current_user((int) ($admins[0] ?? 0));

const PB_YOAST_META_KEYS = ['focuskw', 'title', 'metadesc', 'opengraph-title', 'opengraph-description', 'opengraph-image-id', 'twitter-title', 'twitter-description', 'twitter-image-id', 'schema_page_type'];
const PB_SCHEMA_PAGE_TYPES = ['WebPage', 'ItemPage', 'AboutPage', 'FAQPage', 'QAPage', 'ProfilePage', 'ContactPage', 'MedicalWebPage', 'CollectionPage', 'CheckoutPage', 'RealEstateListing', 'SearchResultsPage'];
// Theme Yoast extension (proto-blocks-theme inc/proto-yoast-jsonld.php): post meta holding one JSON string.
const PB_JSONLD_META_KEY = '_proto_jsonld';

$cmd = $args[0] ?? '';
$positive = function ($v): int { return (is_int($v) || (is_string($v) && ctype_digit($v))) && (int) $v > 0 ? (int) $v : 0; };
$https = function ($u): bool { return is_string($u) && (parse_url($u, PHP_URL_SCHEME) === 'https') && (string) parse_url($u, PHP_URL_HOST) !== ''; };
$host_is = function (string $host, string $domain): bool { $host = strtolower($host); return $host === $domain || str_ends_with($host, '.' . $domain); };

if ($cmd === 'site') {
    // What %%sitename%% and %%sep%% render to on this site, so the title length can be checked for real.
    if (count($args) !== 1) { $fail('EUSAGE', 'Usage: yoast.php site'); }
    $seps = WPSEO_Option_Titles::get_instance()->get_separator_options();
    $key = (string) WPSEO_Options::get('separator', 'sc-dash');
    $out(['siteName' => html_entity_decode((string) get_bloginfo('name'), ENT_QUOTES, 'UTF-8'), 'sep' => html_entity_decode((string) ($seps[$key] ?? '-'), ENT_QUOTES, 'UTF-8')]);
    return;
}
if ($cmd === 'get') {
    if (count($args) !== 2) { $fail('EUSAGE', 'Usage: yoast.php get <postId>'); }
    $id = $positive($args[1]);
    if (!$id) { $fail('EINPUT', 'postId must be a positive integer'); }
    if (!get_post($id)) { $fail('ENOPOST', "Post {$id} does not exist"); }
    $keys = ['focuskw', 'title', 'metadesc', 'opengraph-title', 'opengraph-description', 'opengraph-image', 'opengraph-image-id', 'twitter-title', 'twitter-description', 'twitter-image', 'twitter-image-id', 'schema_page_type'];
    $data = [];
    foreach ($keys as $k) { $data[$k] = WPSEO_Meta::get_value($k, $id); }
    $data['jsonld'] = json_decode((string) get_post_meta($id, PB_JSONLD_META_KEY, true), true);
    $data['organizationName'] = WPSEO_Options::get('company_name', '');
    $data['thumbnailId'] = (int) get_post_thumbnail_id($id);
    $out($data);
    return;
}
if ($cmd !== 'apply' || count($args) !== 2) { $fail('EUSAGE', 'Usage: yoast.php apply <spec.json> | get <postId> | site'); }

// ---- parse and validate everything first ----
$raw = is_readable((string) $args[1]) && is_file((string) $args[1]) ? file_get_contents((string) $args[1]) : false;
$spec = $raw === false ? null : json_decode($raw, true);
if (!is_array($spec)) { $fail('EINPUT', 'The spec file is missing, unreadable or not valid JSON'); }
$id = $positive($spec['postId'] ?? null);
if (!$id) { $fail('EINPUT', 'postId must be a positive integer'); }
if (!get_post($id)) { $fail('ENOPOST', "Post {$id} does not exist"); }

$meta = $spec['meta'] ?? [];
if (!is_array($meta)) { $fail('EINPUT', 'meta must be an object'); }
foreach ($meta as $key => $value) {
    if (!in_array($key, PB_YOAST_META_KEYS, true)) { $fail('EINPUT', 'Unknown meta key: ' . (string) $key); }
    if ($value === null || $value === '') { continue; }
    if (!is_string($value) && !is_int($value)) { $fail('EINPUT', "meta.{$key} must be a string or integer"); }
    if (in_array($key, ['opengraph-image-id', 'twitter-image-id'], true) && (!$positive($value) || !wp_get_attachment_url((int) $value))) { $fail('EINPUT', "meta.{$key} is not an existing attachment id"); }
    if ($key === 'schema_page_type' && !in_array($value, PB_SCHEMA_PAGE_TYPES, true)) { $fail('EINPUT', 'schema_page_type is not a supported page type'); }
}

$has_jsonld = array_key_exists('jsonld', $spec);
$jsonld = $spec['jsonld'] ?? null;
if ($has_jsonld && $jsonld !== null) {
    if (!is_array($jsonld) || !array_is_list($jsonld)) { $fail('EINPUT', 'jsonld must be a list of nodes'); }
    foreach ($jsonld as $node) { if (!is_array($node) || array_is_list($node)) { $fail('EINPUT', 'every jsonld node must be an object'); } }
}

$featured_id = $spec['featuredImageId'] ?? null;
if ($featured_id !== null && (!$positive($featured_id) || !wp_get_attachment_url((int) $featured_id))) { $fail('EINPUT', 'featuredImageId is not an existing attachment id'); }

$org = $spec['organization'] ?? null;
$socials = [];
if ($org !== null) {
    if (!is_array($org) || !is_string($org['name'] ?? null) || trim($org['name']) === '') { $fail('EINPUT', 'organization.name must be a non-empty string'); }
    if (!empty($org['logoId']) && (!$positive($org['logoId']) || !wp_get_attachment_url((int) $org['logoId']))) { $fail('EINPUT', 'organization.logoId is not an existing attachment id'); }
    $socials = $org['socials'] ?? [];
    if (!is_array($socials)) { $fail('EINPUT', 'organization.socials must be a list'); }
    foreach ($socials as $s) { if (!$https($s)) { $fail('EINPUT', 'organization.socials must be https URLs'); } }
}

// ---- write ----
$written = [];
foreach ($meta as $key => $value) {
    if ($value === null || $value === '') { continue; }
    if (in_array($key, ['opengraph-image-id', 'twitter-image-id'], true)) {
        $url_key = str_replace('-id', '', $key);
        WPSEO_Meta::set_value($key, (string) (int) $value, $id);
        WPSEO_Meta::set_value($url_key, (string) wp_get_attachment_url((int) $value), $id);
        $written[] = $key;
        $written[] = $url_key;
        continue;
    }
    WPSEO_Meta::set_value($key, (string) $value, $id);
    $written[] = $key;
}

if ($has_jsonld) {
    if ($jsonld) {
        // The theme reads this meta as a JSON string; update_post_meta unslashes, so slash the string first.
        $json = wp_json_encode($jsonld, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
        update_post_meta($id, PB_JSONLD_META_KEY, wp_slash($json));
        if ((string) get_post_meta($id, PB_JSONLD_META_KEY, true) !== $json) { $fail('EMETA', 'Could not store the JSON-LD'); }
        $written[] = PB_JSONLD_META_KEY;
    } else {
        delete_post_meta($id, PB_JSONLD_META_KEY);
    }
}

$featured = false;
if ($featured_id !== null && !get_post_thumbnail_id($id)) {
    $featured = (bool) set_post_thumbnail($id, (int) $featured_id);
}

$org_state = 'skipped';
if ($org !== null) {
    $force = !empty($spec['forceOrganization']);
    // Only an unconfigured Company site is filled in; a Person site (or any named organization) is kept unless forced.
    $unconfigured = WPSEO_Options::get('company_or_person', '') === 'company' && WPSEO_Options::get('company_name', '') === '';
    if ($unconfigured || $force) {
        WPSEO_Options::set('company_or_person', 'company');
        WPSEO_Options::set('company_name', (string) $org['name']);
        if (!empty($org['logoId'])) {
            WPSEO_Options::set('company_logo_id', (int) $org['logoId']);
            WPSEO_Options::set('company_logo', (string) wp_get_attachment_url((int) $org['logoId']));
        } elseif ($force) {
            WPSEO_Options::set('company_logo_id', 0);
            WPSEO_Options::set('company_logo', '');
        }
        if ($force) { WPSEO_Options::set('facebook_site', ''); WPSEO_Options::set('twitter_site', ''); }
        $others = [];
        $have_facebook = false;
        $have_twitter = false;
        foreach ($socials as $s) {
            $host = (string) parse_url($s, PHP_URL_HOST);
            $path = trim((string) parse_url($s, PHP_URL_PATH), '/');
            // The first Facebook / Twitter URL fills its dedicated field; any further ones stay as other URLs.
            if ($host_is($host, 'facebook.com') && !$have_facebook) { WPSEO_Options::set('facebook_site', $s); $have_facebook = true; }
            elseif (($host_is($host, 'twitter.com') || $host_is($host, 'x.com')) && $path !== '' && !$have_twitter) { WPSEO_Options::set('twitter_site', explode('/', $path)[0]); $have_twitter = true; }
            else { $others[] = $s; }
        }
        if ($socials || $force) { WPSEO_Options::set('other_social_urls', $others); }
        $org_state = 'set';
    } else {
        $org_state = 'kept';
    }
}

wp_update_post(['ID' => $id]);
$out(['postId' => $id, 'written' => $written, 'featuredImageSet' => $featured, 'organization' => $org_state]);
