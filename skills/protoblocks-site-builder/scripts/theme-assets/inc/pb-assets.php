<?php
/**
 * Managed by protoblocks-site-builder — overwritten on every install. Do not edit.
 * Enqueues assets/js/pb-*.js after the theme's animation globals, and assets/css/pb-*.css after WordPress' global
 * styles (when they are on; Proto-Blocks can disable them).
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

    // global-styles is registered at priority 10 of this hook (wp_enqueue_global_styles), unless disabled.
    $css_dir = get_stylesheet_directory() . '/assets/css';
    $css_url = get_stylesheet_directory_uri() . '/assets/css';
    $css_deps = wp_style_is('global-styles', 'registered') ? ['global-styles'] : [];
    foreach ((glob($css_dir . '/pb-*.css') ?: []) as $file) {
        $name = basename($file, '.css');
        wp_enqueue_style($name, $css_url . '/' . $name . '.css', $css_deps, (string) filemtime($file));
    }
}, 20);
