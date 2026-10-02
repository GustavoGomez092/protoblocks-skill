<?php $heading = $attributes['heading'] ?? ''; ?>
<section <?php echo get_block_wrapper_attributes(['class' => 'pb-gate-ok']); ?>>
  <h2 data-proto-field="heading"><?php echo esc_html($heading); ?></h2>
</section>
