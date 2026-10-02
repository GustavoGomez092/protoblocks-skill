<?php
/**
 * E2E fixture block: call-to-action band.
 *
 * @var array $attributes Block attributes.
 */
$heading = $attributes['heading'] ?? '';
$text    = $attributes['text'] ?? '';
$cta     = $attributes['cta'] ?? array();
?>
<section <?php echo get_block_wrapper_attributes( array( 'class' => 'pb-e2e-cta' ) ); ?>>
	<div class="pb-e2e-cta__inner">
		<h2 class="pb-e2e-cta__title" data-proto-field="heading"><?php echo esc_html( $heading ); ?></h2>
		<p class="pb-e2e-cta__text" data-proto-field="text"><?php echo esc_html( $text ); ?></p>
		<div class="pb-e2e-cta__actions">
			<a class="pb-e2e-cta__button" data-proto-field="cta" href="<?php echo esc_url( $cta['url'] ?? '#' ); ?>"><?php echo esc_html( $cta['text'] ?? '' ); ?></a>
		</div>
	</div>
</section>
