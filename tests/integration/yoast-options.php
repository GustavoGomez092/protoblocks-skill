<?php
/**
 * Test helper: snapshot and restore the Yoast options skills/.../yoast.php can touch.
 * Usage: wp eval-file yoast-options.php snapshot | set <flat json file> | restore <snapshot json file>
 * `set` seeds some of the 7 organization/social keys; `restore` puts the full snapshot back.
 * All commands print the resulting snapshot as one JSON line:
 * {"options": {the 7 keys}, "wpseo_titles": {...whole option}, "wpseo_social": {...whole option}}
 */
const PB_TEST_YOAST_OPTIONS = ['company_or_person', 'company_name', 'company_logo', 'company_logo_id', 'facebook_site', 'twitter_site', 'other_social_urls'];
$read = function () {
    $o = [];
    foreach (PB_TEST_YOAST_OPTIONS as $k) { $o[$k] = WPSEO_Options::get($k); }
    return ['options' => $o, 'wpseo_titles' => get_option('wpseo_titles'), 'wpseo_social' => get_option('wpseo_social')];
};
$load = function () use ($args) {
    $in = json_decode((string) @file_get_contents((string) ($args[1] ?? '')), true);
    if (!is_array($in)) { fwrite(STDERR, "bad options file\n"); exit(1); }
    return $in;
};
$cmd = $args[0] ?? '';
if ($cmd === 'set') {
    $in = $load();
    foreach (array_merge(PB_TEST_YOAST_OPTIONS, ['separator']) as $k) { if (array_key_exists($k, $in)) { WPSEO_Options::set($k, $in[$k]); } }  // `separator` lives in wpseo_titles, which `restore` covers
} elseif ($cmd === 'restore') {
    $in = $load();
    foreach (['wpseo_titles', 'wpseo_social'] as $opt) { if (is_array($in[$opt] ?? null)) { update_option($opt, $in[$opt]); } }
    foreach (PB_TEST_YOAST_OPTIONS as $k) { if (array_key_exists($k, $in['options'] ?? [])) { WPSEO_Options::set($k, $in['options'][$k]); } }
} elseif ($cmd !== 'snapshot') { fwrite(STDERR, "usage: snapshot | set <file> | restore <file>\n"); exit(1); }
echo wp_json_encode($read(), JSON_UNESCAPED_SLASHES) . "\n";
