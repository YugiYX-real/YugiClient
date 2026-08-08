package gg.halcyon.companion.mixin;

import gg.halcyon.companion.HalcyonCosmeticFeature;
import gg.halcyon.companion.HalcyonCosmetics;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.render.entity.PlayerEntityRenderer;
import net.minecraft.client.render.entity.state.PlayerEntityRenderState;
import net.minecraft.entity.PlayerLikeEntity;
import net.minecraft.entity.player.SkinTextures;
import net.minecraft.util.AssetInfo;
import net.minecraft.util.Identifier;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Puts the Halcyon cape on the player and marks whose render state wears our cosmetics.
 *
 * <p>The cape slot expects a vanilla cape sheet, so only cosmetics of the cape kind are allowed to
 * take it over. Wings, backpacks, hats and every other kind are square pictures and are drawn by
 * {@link HalcyonCosmeticFeature} instead, which is why they used to come out as a smeared cape.
 */
@Mixin(PlayerEntityRenderer.class)
public abstract class PlayerEntityRendererMixin {
	@Inject(method = "updateRenderState", at = @At("TAIL"))
	private void halcyon$wearCape(
			PlayerLikeEntity entity,
			PlayerEntityRenderState state,
			float tickDelta,
			CallbackInfo info) {
		MinecraftClient client = MinecraftClient.getInstance();
		if (client == null || client.player == null) {
			return;
		}
		if ((Object) entity != (Object) client.player) {
			return;
		}

		HalcyonCosmeticFeature.mark(state);

		HalcyonCosmetics cosmetics = HalcyonCosmetics.get();
		String worn = cosmetics.equippedIn("back");
		if (worn == null || worn.isEmpty() || !"cape".equals(cosmetics.kindOf(worn))) {
			return;
		}

		Identifier cape = cosmetics.capeTexture();
		if (cape == null) {
			return;
		}

		SkinTextures current = state.skinTextures;
		if (current == null) {
			return;
		}

		state.skinTextures = new SkinTextures(
				current.body(),
				new AssetInfo.TextureAssetInfo(cape, cape),
				current.elytra(),
				current.model(),
				current.secure());
		state.capeVisible = true;
	}
}
