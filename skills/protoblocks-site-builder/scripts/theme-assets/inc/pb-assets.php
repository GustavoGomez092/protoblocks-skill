<?php
/**
 * Managed by protoblocks-site-builder — overwritten on every install. Do not edit.
 * Enqueues assets/js/pb-*.js after the theme's animation globals.
 */
if (!defined('ABSPATH')) {
    exit;
}

add_action('wp_enqueue_scripts', function () {
    $dir = get_stylesheet_directory() . '/assets/js';
    $url = get_stylesheet_directory_uri() . '/assets/js';
    $deps = array_values(array_filter(
        ['proto-gsap', 'proto-scroll-trigger', 'proto-split-text', 'proto-init'],
        fn($handle) => wp_script_is($handle, 'registered')
    ));
    foreach ((glob($dir . '/pb-*.js') ?: []) as $file) {
        $name = basename($file, '.js');
        wp_enqueue_script($name, $url . '/' . $name . '.js', $deps, (string) filemtime($file), true);
    }
}, 20);
