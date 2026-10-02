<?php
/**
 * Yoast SEO writer.
 * Usage: wp eval-file yoast.php apply <spec.json path> | get <postId> | site
 * `get` (and `stored` in the apply result) are the raw per-page values as stored (no Yoast defaults; '' when unset),
 * so the caller can tell values set in wp-admin from the values it applied; `jsonld` is the stored JSON string.
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

// The raw stored values of everything apply writes (keys as in PB_YOAST_META_KEYS, plus the image URLs and jsonld).
$read_live = function (int $id): array {
    $data = [];
    foreach (array_merge(PB_YOAST_META_KEYS, ['opengraph-image', 'twitter-image']) as $k) {
        $v = get_post_meta($id, WPSEO_Meta::$meta_prefix . $k, true);
        $data[$k] = is_scalar($v) ? (string) $v : '';
    }
    $data['jsonld'] = (string) get_post_meta($id, PB_JSONLD_META_KEY, true);
    return $data;
};

$cmd = $args[0] ?? '';
$positive = function ($v): int { return (is_int($v) || (is_string($v) && ctype_digit($v))) && (int) $v > 0 ? (int) $v : 0; };
$https = function ($u): bool { return is_string($u) && (parse_url($u, PHP_URL_SCHEME) === 'https') && (string) parse_url($u, PHP_URL_HOST) !== ''; };
$host_is = function (string $host, string $domain): bool { $host = strtolower($host); return $host === $domain || str_ends_with($host, '.' . $domain); };

if ($cmd === 'site') {
    // What %%sitename%% and %%sep%% render to on this site, so the title length can be checked for real.
    if (count($args) !== 1) { $fail('EUSAGE', 'Usage: yoast.php site'); }
    // Yoast's own map when available; otherwise (or if its API changed) a built-in copy of it.
    $seps = [];
    if (class_exists('WPSEO_Option_Titles') && method_exists('WPSEO_Option_Titles', 'get_instance')) {
        $inst = WPSEO_Option_Titles::get_instance();
        if (is_object($inst) && method_exists($inst, 'get_separator_options')) { $seps = $inst->get_separator_options(); }
    }
    if (!is_array($seps) || !$seps) {
        $seps = ['sc-dash' => '-', 'sc-ndash' => '–', 'sc-mdash' => '—', 'sc-colon' => ':', 'sc-middot' => '·', 'sc-bull' => '•', 'sc-star' => '*', 'sc-smstar' => '⋆', 'sc-pipe' => '|', 'sc-tilde' => '~', 'sc-laquo' => '«', 'sc-raquo' => '»', 'sc-lt' => '>', 'sc-gt' => '<'];  // Yoast really maps sc-lt to '>' and sc-gt to '<'
    }
    $key = (string) WPSEO_Options::get('separator', 'sc-dash');
    // The site Organization as apply would find it, so the caller knows whether it will be kept before importing a logo.
    $organization = ['represents' => (string) WPSEO_Options::get('company_or_person', ''), 'name' => (string) WPSEO_Options::get('company_name', ''), 'logoId' => (int) WPSEO_Options::get('company_logo_id', 0)];
    $out(['siteName' => html_entity_decode((string) get_bloginfo('name'), ENT_QUOTES, 'UTF-8'), 'sep' => html_entity_decode(is_string($seps[$key] ?? null) ? $seps[$key] : '-', ENT_QUOTES, 'UTF-8'), 'organization' => $organization]);
    return;
}
if ($cmd === 'get') {
    if (count($args) !== 2) { $fail('EUSAGE', 'Usage: yoast.php get <postId>'); }
    $id = $positive($args[1]);
    if (!$id) { $fail('EINPUT', 'postId must be a positive integer'); }
    if (!get_post($id)) { $fail('ENOPOST', "Post {$id} does not exist"); }
    $data = ['postId' => $id] + $read_live($id);
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
        $json = wp_json_encode($jsonld, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
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

// Yoast caches the logo's attachment meta in company_logo_meta and serves the cache before company_logo_id
// (wordpress-seo 28.6 src/helpers/image-helper.php:376-387, get_attachment_meta_from_settings). Yoast's own settings
// writer clears it after changing the logo (src/actions/configuration/first-time-configuration-action.php:75), so do the
// same whenever the logo is written or cleared, or the Organization schema keeps showing the previous logo.
$set_logo = function (int $logo_id) {
    WPSEO_Options::set('company_logo_id', $logo_id);
    WPSEO_Options::set('company_logo', $logo_id ? (string) wp_get_attachment_url($logo_id) : '');
    WPSEO_Options::set('company_logo_meta', false);
};

$org_state = 'skipped';
if ($org !== null) {
    $force = !empty($spec['forceOrganization']);
    // Only an unconfigured Company site is filled in; a Person site (or any named organization) is kept unless forced.
    $unconfigured = WPSEO_Options::get('company_or_person', '') === 'company' && WPSEO_Options::get('company_name', '') === '';
    if ($unconfigured || $force) {
        WPSEO_Options::set('company_or_person', 'company');
        WPSEO_Options::set('company_name', (string) $org['name']);
        if (!empty($org['logoId'])) {
            $set_logo((int) $org['logoId']);
        } elseif ($force) {
            $set_logo(0);
        }
        // Forced: the supplied socials replace the old ones. Otherwise they merge: an empty Facebook / Twitter field is
        // filled, everything else is added to the existing other URLs (no duplicates).
        if ($force) {
            WPSEO_Options::set('facebook_site', '');
            WPSEO_Options::set('twitter_site', '');
            $facebook = '';
            $twitter = '';
            $others = [];
        } else {
            $facebook = (string) WPSEO_Options::get('facebook_site', '');
            $twitter = (string) WPSEO_Options::get('twitter_site', '');
            $others = array_values(array_filter((array) WPSEO_Options::get('other_social_urls', []), 'is_string'));
        }
        foreach ($socials as $s) {
            $host = (string) parse_url($s, PHP_URL_HOST);
            $path = trim((string) parse_url($s, PHP_URL_PATH), '/');
            $is_twitter = ($host_is($host, 'twitter.com') || $host_is($host, 'x.com')) && $path !== '';
            $handle = $is_twitter ? explode('/', $path)[0] : '';
            // The first Facebook / Twitter URL fills its empty dedicated field; any further ones stay as other URLs.
            if ($host_is($host, 'facebook.com') && $facebook === '') { WPSEO_Options::set('facebook_site', $s); $facebook = $s; }
            elseif ($is_twitter && $twitter === '') { WPSEO_Options::set('twitter_site', $handle); $twitter = $handle; }
            elseif ($s !== $facebook && !($is_twitter && $handle === $twitter) && !in_array($s, $others, true)) { $others[] = $s; }
        }
        if ($socials || $force) { WPSEO_Options::set('other_social_urls', $others); }
        $org_state = 'set';
    } else {
        $org_state = 'kept';
    }
}

wp_update_post(['ID' => $id]);
$out(['postId' => $id, 'written' => $written, 'featuredImageSet' => $featured, 'organization' => $org_state, 'stored' => $read_live($id)]);
