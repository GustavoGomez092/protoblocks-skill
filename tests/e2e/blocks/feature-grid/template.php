<?php
/**
 * E2E fixture block: feature grid.
 *
 * @var array         $attributes Block attributes.
 * @var WP_Block|null $block      Block instance (null in the editor preview).
 */
$heading    = $attributes['heading'] ?? '';
$cards      = $attributes['cards'] ?? array();
$is_preview = ! isset( $block ) || $block === null;
if ( empty( $cards ) && $is_preview ) {
	$cards = array( array( 'id' => 'preview-1', 'title' => 'Feature', 'text' => 'Describe the feature.' ) );
}
?>
<section <?php echo get_block_wrapper_attributes( array( 'class' => 'pb-e2e-features' ) ); ?>>
	<div class="pb-e2e-features__inner">
		<h2 class="pb-e2e-features__title" data-proto-field="heading"><?php echo esc_html( $heading ); ?></h2>
		<div class="pb-e2e-features__grid" data-proto-repeater="cards">
			<?php foreach ( $cards as $card ) : ?>
			<div class="pb-e2e-features__card" data-proto-repeater-item>
				<h3 class="pb-e2e-features__card-title" data-proto-field="title"><?php echo esc_html( $card['title'] ?? '' ); ?></h3>
				<p class="pb-e2e-features__card-text" data-proto-field="text"><?php echo esc_html( $card['text'] ?? '' ); ?></p>
			</div>
			<?php endforeach; ?>
		</div>
	</div>
</section>
