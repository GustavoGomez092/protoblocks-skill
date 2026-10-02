<?php
/**
 * E2E fixture block: site header.
 *
 * @var array $attributes Block attributes.
 */
$logo = $attributes['logo'] ?? '';
?>
<header <?php echo get_block_wrapper_attributes( array( 'class' => 'pb-e2e-header' ) ); ?>>
	<div class="pb-e2e-header__inner">
		<span class="pb-e2e-header__logo" data-proto-field="logo"><?php echo esc_html( $logo ); ?></span>
		<div class="pb-e2e-header__nav" data-proto-inner-blocks><?php echo $innerBlocksContent ?? ''; ?></div>
	</div>
</header>
