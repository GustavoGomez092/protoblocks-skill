<?php
/**
 * Managed by protoblocks-site-builder — overwritten on every install. Do not edit.
 * Prints the pb-motion anti-flash CSS and the site motion profile in <head>.
 */
if (!defined('ABSPATH')) {
    exit;
}

add_action('wp_head', function () {
    if (is_admin()) {
        return;
    }
    $defaults = ['duration' => 0.7, 'ease' => 'power2.out', 'stagger' => 0.08, 'distance' => 24];
    $profile = $defaults;
    $file = get_stylesheet_directory() . '/inc/pb-motion-profile.json';
    if (is_readable($file)) {
        $data = json_decode((string) file_get_contents($file), true);
        if (is_array($data)) {
            $picked = array_intersect_key($data, $defaults);
            $scalar = true;
            foreach ($picked as $value) {
                if (!is_scalar($value)) {
                    $scalar = false;
                    break;
                }
            }
            if ($scalar) {
                $profile = array_merge($defaults, $picked);
            }
        }
    }
    $profile = [
        'duration' => (float) $profile['duration'],
        'ease'     => (string) $profile['ease'],
        'stagger'  => (float) $profile['stagger'],
        'distance' => (float) $profile['distance'],
    ];
    // Anti-flash: reveal elements start hidden, only when motion is wanted and JS runs. html.pb-motion-js is added
    // here, in <head>, before anything is painted; with JS off it never is, so nothing is hidden (this replaces a
    // <noscript> fallback, whose contents Taxi parses as live elements on a page swap). <html> survives swaps, so
    // a swapped-in section is hidden the instant it exists. Failsafe: if the runtime has not started (no
    // html.pb-motion-on) 4 s after the element is styled, e.g. a JS-delaying optimizer holds it or it failed to
    // load, a one-frame animation pins opacity 1. pb-motion.js adds pb-motion-on first thing when it runs.
    echo "<script>document.documentElement.classList.add('pb-motion-js');</script>\n";
    echo '<style id="pb-motion-css">@media (prefers-reduced-motion: no-preference){'
        . 'html.pb-motion-js [data-pb-motion][data-proto-animate="manual"]{opacity:0}'
        . 'html.pb-motion-js:not(.pb-motion-on) [data-pb-motion][data-proto-animate="manual"]{animation:pb-motion-failsafe 0s linear 4s forwards}'
        . '}@keyframes pb-motion-failsafe{to{opacity:1}}</style>' . "\n";
    echo '<script id="pb-motion-profile">window.pbMotionProfile='
        . wp_json_encode($profile, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT)
        . ';</script>' . "\n";
}, 2);
