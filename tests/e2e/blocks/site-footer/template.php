<?php
/**
 * E2E fixture block: site footer.
 *
 * @var array $attributes Block attributes.
 */
$copyright = $attributes['copyright'] ?? '';
?>
<footer <?php echo get_block_wrapper_attributes( array( 'class' => 'pb-e2e-footer' ) ); ?>>
	<div class="pb-e2e-footer__inner">
		<p class="pb-e2e-footer__copy" data-proto-field="copyright"><?php echo esc_html( $copyright ); ?></p>
		<div class="pb-e2e-footer__nav" data-proto-inner-blocks><?php echo $innerBlocksContent ?? ''; ?></div>
	</div>
</footer>
