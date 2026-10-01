<?php
/**
 * Proto-Blocks Tailwind control. Usage: wp eval-file tailwind.php <enable|compile|status>
 * Prints one JSON line.
 */
if (!class_exists('\ProtoBlocks\Core\Plugin')) {
    fwrite(STDERR, "Proto-Blocks is not active.\n");
    exit(1);
}
$manager = \ProtoBlocks\Core\Plugin::getInstance()->getTailwindManager();
$cmd = $args[0] ?? 'status';

switch ($cmd) {
    case 'enable':
        $manager->updateSettings(['enabled' => true]);
        update_option('proto_blocks_component_style', 'tailwind');
        echo wp_json_encode(['enabled' => true, 'settings' => $manager->getSettings()]) . "\n";
        break;
    case 'compile':
        $result = $manager->compile();
        echo wp_json_encode($result) . "\n";
        if (empty($result['success'])) {
            exit(1);
        }
        break;
    case 'status':
        echo wp_json_encode($manager->getSettings()) . "\n";
        break;
    default:
        fwrite(STDERR, "Unknown command: {$cmd}\n");
        exit(1);
}
