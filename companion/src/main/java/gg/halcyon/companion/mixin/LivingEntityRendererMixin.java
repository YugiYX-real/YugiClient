package gg.halcyon.companion.mixin;

import gg.halcyon.companion.HalcyonCosmeticFeature;
import net.minecraft.client.render.entity.LivingEntityRenderer;
import net.minecraft.client.render.entity.PlayerEntityRenderer;
import net.minecraft.client.render.entity.feature.FeatureRenderer;
import net.minecraft.client.render.entity.feature.FeatureRendererContext;
import net.minecraft.client.render.entity.model.PlayerEntityModel;
import net.minecraft.client.render.entity.state.PlayerEntityRenderState;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Hangs the Halcyon cosmetic renderer on every player renderer.
 *
 * <p>Both the normal and the slim player renderer run through this constructor, so one hook covers
 * them both. Vanilla adds its own features after this point, which means the cosmetic panel is
 * submitted before armour and capes and blends behind them.
 */
@Mixin(LivingEntityRenderer.class)
public abstract class LivingEntityRendererMixin {
	@Shadow
	protected abstract boolean addFeature(FeatureRenderer feature);

	@SuppressWarnings("unchecked")
	@Inject(method = "<init>", at = @At("RETURN"))
	private void halcyon$addCosmetics(CallbackInfo info) {
		if (!((Object) this instanceof PlayerEntityRenderer)) {
			return;
		}
		addFeature(
				new HalcyonCosmeticFeature(
						(FeatureRendererContext<PlayerEntityRenderState, PlayerEntityModel>)
								(Object) this));
	}
}
