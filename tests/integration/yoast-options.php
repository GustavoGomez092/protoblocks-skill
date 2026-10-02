<?php
/**
 * Test helper: snapshot and restore the Yoast options skills/.../yoast.php can touch.
 * Usage: wp eval-file yoast-options.php snapshot | set <json file>
 * Both print the resulting options as one JSON line.
 */
const PB_TEST_YOAST_OPTIONS = ['company_or_person', 'company_name', 'company_logo', 'company_logo_id', 'facebook_site', 'twitter_site', 'other_social_urls'];
$read = function () {
    $o = [];
    foreach (PB_TEST_YOAST_OPTIONS as $k) { $o[$k] = WPSEO_Options::get($k); }
    return $o;
};
if (($args[0] ?? '') === 'set') {
    $in = json_decode((string) file_get_contents((string) ($args[1] ?? '')), true);
    if (!is_array($in)) { fwrite(STDERR, "bad options file\n"); exit(1); }
    foreach (PB_TEST_YOAST_OPTIONS as $k) { if (array_key_exists($k, $in)) { WPSEO_Options::set($k, $in[$k]); } }
} elseif (($args[0] ?? '') !== 'snapshot') { fwrite(STDERR, "usage: snapshot | set <file>\n"); exit(1); }
echo wp_json_encode($read(), JSON_UNESCAPED_SLASHES) . "\n";
