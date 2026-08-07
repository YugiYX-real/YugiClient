package gg.halcyon.companion.mixin;

import gg.halcyon.companion.HalcyonConfig;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.SplashOverlay;
import net.minecraft.text.Style;
import net.minecraft.text.Text;
import net.minecraft.text.TextColor;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Paints the Halcyon loading screen over the vanilla resource reload overlay.
 *
 * <p>The paint happens at the tail of the vanilla draw call, so the Mojang screen underneath is
 * covered rather than fought with. Nothing here is required: if the injection ever misses, the
 * vanilla screen simply shows through.
 */
@Mixin(SplashOverlay.class)
public abstract class SplashOverlayMixin {
	private static final int BACKDROP = 0xFF0B0B12;

	private static final int CAPTION_COLOR = 0xFF9AA0B5;

	@Inject(method = "render", at = @At("TAIL"))
	private void halcyon$paintSplash(
			DrawContext context, int mouseX, int mouseY, float deltaTicks, CallbackInfo info) {
		HalcyonConfig config = HalcyonConfig.get();
		if (!config.splashEnabled) {
			return;
		}

		MinecraftClient client = MinecraftClient.getInstance();
		if (client == null || client.textRenderer == null) {
			return;
		}

		int width = context.getScaledWindowWidth();
		int height = context.getScaledWindowHeight();
		context.fill(0, 0, width, height, BACKDROP);

		Style wordmarkStyle =
				Style.EMPTY.withBold(true).withColor(TextColor.fromRgb(config.badgeRgb()));
		Text wordmark = Text.literal("HALCYON").setStyle(wordmarkStyle);
		int wordmarkWidth = client.textRenderer.getWidth(wordmark);
		context.drawTextWithShadow(
				client.textRenderer, wordmark, (width - wordmarkWidth) / 2, height / 2 - 14, 0xFFFFFFFF);

		Text caption = Text.literal("Preparing your game");
		int captionWidth = client.textRenderer.getWidth(caption);
		context.drawTextWithShadow(
				client.textRenderer, caption, (width - captionWidth) / 2, height / 2 + 4, CAPTION_COLOR);
	}
}
