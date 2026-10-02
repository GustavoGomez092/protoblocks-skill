<?php
/**
 * E2E fixture block: hero.
 *
 * @var array         $attributes Block attributes.
 * @var WP_Block|null $block      Block instance (null in the editor preview).
 */
$heading = $attributes['heading'] ?? '';
$text    = $attributes['text'] ?? '';
$cta     = $attributes['cta'] ?? array();

// Motion attributes only on the frontend: the editor preview renders without $block.
$is_preview = ! isset( $block ) || $block === null;
$pb_motion  = function ( $preset, $opts = array() ) use ( $is_preview ) {
	if ( $is_preview ) {
		return '';
	}
	$out = 'data-pb-motion="' . esc_attr( $preset ) . '"';
	if ( ! in_array( $preset, array( 'parallax', 'marquee' ), true ) ) {
		$out .= ' data-proto-animate="manual"';
	}
	foreach ( $opts as $k => $v ) {
		$out .= ' data-pb-' . sanitize_key( $k ) . '="' . esc_attr( $v ) . '"';
	}
	return $out;
};
?>
<section <?php echo get_block_wrapper_attributes( array( 'class' => 'pb-e2e-hero' ) ); ?>>
	<div class="pb-e2e-hero__inner">
		<h1 class="pb-e2e-hero__title" <?php echo $pb_motion( 'split-lines' ); ?> data-proto-field="heading"><?php echo esc_html( $heading ); ?></h1>
		<p class="pb-e2e-hero__text" data-proto-field="text"><?php echo esc_html( $text ); ?></p>
		<div class="pb-e2e-hero__actions" <?php echo $pb_motion( 'fade-up', array( 'delay' => 0.15 ) ); ?>>
			<a class="pb-e2e-hero__cta" data-proto-field="cta" href="<?php echo esc_url( $cta['url'] ?? '#' ); ?>"><?php echo esc_html( $cta['text'] ?? '' ); ?></a>
		</div>
	</div>
</section>
