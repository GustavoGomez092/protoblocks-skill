<?php
/**
 * Assemble a landing page from a block spec.
 * Usage: wp eval-file page.php plan <spec.json> | write <spec.json> | get <postId> | hash <postId>
 * The spec is a file so free text never travels as WP-CLI argv.
 * Prints one JSON line: the result, or {"error":{"code","message"}} for real errors (EINPUT, ENOTPAGE, EUSAGE, EWRITE).
 * Guard outcomes (EEDITED, ESLUGTAKEN, EFOREIGN) are not errors: plan returns them as `guard`, write as {ok:false,...}.
 */
kses_remove_filters();
$admins = get_users(['role' => 'administrator', 'number' => 1, 'fields' => 'ID']);
wp_set_current_user((int) ($admins[0] ?? 0));
$out = function (array $d) { echo wp_json_encode($d, JSON_UNESCAPED_SLASHES) . "\n"; };
$fail = function (string $code, string $m) use ($out) { $out(['error' => ['code' => $code, 'message' => $m]]); exit(0); };
$hash = fn(int $id) => hash('sha256', (string) get_post_field('post_content', $id, 'raw'));
$cmd = $args[0] ?? '';

if ($cmd === 'hash' || $cmd === 'get') {
    $id = (int) ($args[1] ?? 0);
    $post = $id ? get_post($id) : null;
    if (!$post) { $fail('EINPUT', "No post with ID {$id}."); }
    if ($cmd === 'hash') { $out(['postId' => $id, 'contentHash' => $hash($id)]); return; }
    $out(['postId' => $id, 'postType' => $post->post_type, 'status' => $post->post_status, 'title' => $post->post_title, 'slug' => $post->post_name, 'built' => (bool) get_post_meta($id, '_pb_built', true),
          'content' => (string) get_post_field('post_content', $id, 'raw'), 'contentHash' => $hash($id)]);
    return;
}
if (!in_array($cmd, ['plan', 'write'], true)) { $fail('EUSAGE', 'Usage: page.php plan|write <spec.json> | get|hash <postId>'); }

$spec = json_decode((string) @file_get_contents($args[1] ?? ''), true);
if (!is_array($spec)) { $fail('EINPUT', 'The spec file is missing or is not a JSON object.'); }

// ---- validation ------------------------------------------------------------------------------------------------
$slug = $spec['slug'] ?? null;
if (!is_string($slug) || $slug === '' || sanitize_title($slug) !== $slug) { $fail('EINPUT', 'slug must be a non-empty string that equals sanitize_title(slug) (lowercase letters, digits, "-").'); }
if (isset($spec['title']) && !is_string($spec['title'])) { $fail('EINPUT', 'title must be a string.'); }
if (isset($spec['postId']) && !is_int($spec['postId'])) { $fail('EINPUT', 'postId must be an integer or null.'); }
if (!isset($spec['blocks']) || !is_array($spec['blocks']) || !array_is_list($spec['blocks'])) { $fail('EINPUT', 'blocks must be a list.'); }
foreach ($spec['blocks'] as $i => $b) {
    if (!is_array($b) || !is_string($b['name'] ?? null) || !preg_match('/^[a-z0-9-]+\/[a-z0-9-]+$/', $b['name'])) {
        $fail('EINPUT', "blocks[{$i}].name must match ^[a-z0-9-]+/[a-z0-9-]+\$ (got " . wp_json_encode($b['name'] ?? null) . ').');
    }
    $attrs = $b['attrs'] ?? [];
    if (!is_array($attrs) || ($attrs && array_is_list($attrs))) { $fail('EINPUT', "blocks[{$i}].attrs must be an object."); }
    if (isset($b['innerRaw']) && !is_string($b['innerRaw'])) { $fail('EINPUT', "blocks[{$i}].innerRaw must be a string."); }
}

// ---- resolve the existing post and apply the guards ---------------------------------------------------------------
$force = !empty($spec['force']);
$expected = !empty($spec['expectedHash']) ? (string) $spec['expectedHash'] : null;
$target = null;
$via_state = false;
if (!empty($spec['postId'])) {
    $p = get_post((int) $spec['postId']);
    if ($p && $p->post_type !== 'page') { $fail('ENOTPAGE', "Post {$p->ID} is a \"{$p->post_type}\", not a page; refusing to write a page over it."); }
    if ($p && $p->post_status !== 'trash') { $target = $p; $via_state = true; }
}
if (!$target) {
    $p = get_page_by_path($slug, OBJECT, 'page');
    if ($p && $p->post_status !== 'trash') { $target = $p; }
}

$guard = null;
$publishes = $target && in_array($target->post_status, ['draft', 'pending', 'private', 'future'], true)
    ? " It is {$target->post_status}; --force would also publish it." : '';
$current = $target ? $hash((int) $target->ID) : null;
if ($target && !$force) {
    if (!get_post_meta($target->ID, '_pb_built', true)) {
        $guard = $via_state
            ? ['code' => 'EFOREIGN', 'message' => "Page {$target->ID} (slug \"{$target->post_name}\", {$target->post_status}) was not created by the builder, but the build state points at it.{$publishes}"]
            : ['code' => 'ESLUGTAKEN', 'message' => "A page with slug \"{$slug}\" already exists ({$target->post_status}) and was not created by the builder (ID {$target->ID}).{$publishes}"];
    } elseif ($expected !== null && $current !== $expected) {
        $guard = ['code' => 'EEDITED', 'message' => "Page {$target->ID} was edited outside the builder since the last write.{$publishes}", 'currentHash' => $current];
    }
}

if ($cmd === 'plan') {
    $out(['target' => $target ? ['postId' => (int) $target->ID, 'hash' => $current, 'built' => (bool) get_post_meta($target->ID, '_pb_built', true), 'status' => $target->post_status] : null,
          'guard' => $guard, 'needsBackup' => $target !== null && $current !== $expected]);
    return;
}
if ($guard) { $out(['ok' => false] + $guard); return; }
// The caller backed up (or planned against) a specific content hash; if the post moved on since, re-plan and re-back-up.
if ($target && !empty($spec['backedUpHash']) && $current !== (string) $spec['backedUpHash']) {
    $out(['ok' => false, 'code' => 'ESTALE', 'message' => "Page {$target->ID} changed after the backup was taken (it was {$spec['backedUpHash']}, is now {$current})."]);
    return;
}

// ---- build the content --------------------------------------------------------------------------------------------
$warnings = [];
$blocks = [];
foreach ($spec['blocks'] as $i => $b) {
    $inner = [];
    if (!empty($b['innerRaw'])) {
        $label = $b['attrs']['anchor'] ?? "blocks[{$i}]";
        foreach (parse_blocks($b['innerRaw']) as $x) {
            if (!empty($x['blockName'])) { $inner[] = $x; continue; }
            if (trim((string) ($x['innerHTML'] ?? '')) !== '') {
                $snippet = mb_substr(trim(preg_replace('/\s+/', ' ', wp_strip_all_tags($x['innerHTML']))), 0, 60);
                $warnings[] = "Section {$label}: innerRaw contains non-block (freeform) HTML, which was dropped (starts: \"{$snippet}\"). Wrap it in a block such as core/html or core/paragraph.";
            }
        }
    }
    $blocks[] = ['blockName' => $b['name'], 'attrs' => (array) ($b['attrs'] ?? []), 'innerBlocks' => $inner, 'innerHTML' => '', 'innerContent' => array_fill(0, count($inner), null)];
}

$title = (string) ($spec['title'] ?? $slug);
$name = $slug;
$status = 'publish';
$last = is_array($spec['lastWritten'] ?? null) ? $spec['lastWritten'] : null;
$kept = ['title' => null, 'slug' => null];
if ($target) {
    // Never silently revert the developer's choices. title/slug: if the post differs from what the builder last
    // wrote, keep the developer's value (force does not change this; force is about content). status: a builder page
    // is always published, so draft/pending/private/future means the developer unpublished it; stay that way unless forced.
    if ($last && isset($last['title']) && $target->post_title !== $last['title']) {
        $kept['title'] = ['developer' => $target->post_title, 'builder' => $last['title'], 'wanted' => (string) ($spec['title'] ?? $slug)]; $title = $target->post_title;
    }
    if ($last && isset($last['slug']) && $target->post_name !== $last['slug']) {
        $kept['slug'] = ['developer' => $target->post_name, 'builder' => $last['slug']]; $name = $target->post_name;
    }
    if (in_array($target->post_status, ['draft', 'pending', 'private', 'future'], true)) {
        if ($force) { $warnings[] = "Page {$target->ID} was {$target->post_status}; --force republished it."; }
        else { $status = $target->post_status; $warnings[] = "Page {$target->ID} is {$target->post_status} (set by the developer); it stays {$target->post_status}. Re-run with --force, after asking the developer, to publish it."; }
    }
}
$postarr = [
    'post_type' => 'page', 'post_status' => $status, 'post_name' => $name,
    'post_title' => $title, 'post_content' => serialize_blocks($blocks),
];
$backup_rev = null;
if ($target) {
    $postarr['ID'] = (int) $target->ID;
    // Only when the content actually changes (an idempotent rebuild must not add revisions).
    if ($current !== hash('sha256', $postarr['post_content'])) {
        $rev = wp_save_post_revision((int) $target->ID); // null when revisions are off or nothing changed
        $backup_rev = is_int($rev) && $rev > 0 ? $rev : null;
    }
}
// Nothing to change at all: skip the update so an idempotent rebuild leaves the post (and its revisions) untouched.
$unchanged = $target && $current === hash('sha256', $postarr['post_content']) && $target->post_title === $title
    && $target->post_name === $name && $target->post_status === $status;
$id = $unchanged ? (int) $target->ID : ($target ? wp_update_post(wp_slash($postarr), true) : wp_insert_post(wp_slash($postarr), true));
if (is_wp_error($id) || !$id) { $fail('EWRITE', is_wp_error($id) ? $id->get_error_message() : 'The page could not be written.'); }
update_post_meta($id, '_pb_built', 1);
clean_post_cache($id);
$out(['ok' => true, 'postId' => (int) $id, 'slug' => get_post_field('post_name', $id), 'url' => get_permalink($id), 'contentHash' => $hash((int) $id),
      'created' => $target === null, 'backupRevisionId' => $backup_rev, 'warnings' => $warnings, 'kept' => $kept,
      // What the builder itself wrote (a kept developer value stays at the builder's previous value, so it keeps being detected).
      'written' => ['title' => $kept['title'] ? $last['title'] : get_post_field('post_title', $id, 'raw'),
                    'slug' => $kept['slug'] ? $last['slug'] : get_post_field('post_name', $id), 'postStatus' => get_post_status($id)]]);
