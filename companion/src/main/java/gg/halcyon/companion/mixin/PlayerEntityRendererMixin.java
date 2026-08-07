package gg.halcyon.companion.mixin;

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
 * Puts the Halcyon cape on the player.
 *
 * <p>The render state carries the skin textures the renderer is about to use, so swapping the cape
 * entry there is enough: no model, no feature renderer and no vanilla behaviour has to change. Only
 * the local player is touched, because the backend hands cosmetics out per account.
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

		Identifier cape = HalcyonCosmetics.get().capeTexture();
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
