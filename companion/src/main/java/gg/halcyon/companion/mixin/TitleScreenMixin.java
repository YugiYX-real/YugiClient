package gg.halcyon.companion.mixin;

import gg.halcyon.companion.HalcyonConfig;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.TitleScreen;
import net.minecraft.text.Style;
import net.minecraft.text.Text;
import net.minecraft.text.TextColor;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Brands the main menu with the Halcyon header.
 *
 * <p>The header is drawn after the vanilla screen so the menu buttons keep working exactly as they
 * do in vanilla; only the empty band across the top of the panorama is claimed.
 */
@Mixin(TitleScreen.class)
public abstract class TitleScreenMixin {
	private static final int HEADER_HEIGHT = 34;

	private static final int HEADER_BACKDROP = 0x99070710;

	private static final int CAPTION_COLOR = 0xFF9AA0B5;

	@Inject(method = "render", at = @At("TAIL"))
	private void halcyon$brandMainMenu(
			DrawContext context, int mouseX, int mouseY, float deltaTicks, CallbackInfo info) {
		HalcyonConfig config = HalcyonConfig.get();
		if (!config.mainMenuBranding) {
			return;
		}

		MinecraftClient client = MinecraftClient.getInstance();
		if (client == null || client.textRenderer == null) {
			return;
		}

		int width = context.getScaledWindowWidth();
		context.fill(0, 0, width, HEADER_HEIGHT, HEADER_BACKDROP);

		Style wordmarkStyle =
				Style.EMPTY.withBold(true).withColor(TextColor.fromRgb(config.badgeRgb()));
		Text wordmark = Text.literal("HALCYON").setStyle(wordmarkStyle);
		int wordmarkWidth = client.textRenderer.getWidth(wordmark);
		context.drawTextWithShadow(
				client.textRenderer, wordmark, (width - wordmarkWidth) / 2, 7, 0xFFFFFFFF);

		Text caption = Text.literal("Premium Minecraft by YugiYX");
		int captionWidth = client.textRenderer.getWidth(caption);
		context.drawTextWithShadow(
				client.textRenderer, caption, (width - captionWidth) / 2, 20, CAPTION_COLOR);
	}
}
