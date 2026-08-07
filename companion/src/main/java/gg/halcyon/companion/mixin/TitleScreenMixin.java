package gg.halcyon.companion.mixin;

import gg.halcyon.companion.HalcyonBackend;
import gg.halcyon.companion.HalcyonConfig;
import gg.halcyon.companion.HalcyonMenuBackground;
import gg.halcyon.companion.HalcyonMenuButton;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gl.RenderPipelines;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.TitleScreen;
import net.minecraft.client.gui.screen.multiplayer.MultiplayerScreen;
import net.minecraft.client.gui.screen.option.OptionsScreen;
import net.minecraft.client.gui.screen.world.SelectWorldScreen;
import net.minecraft.text.Style;
import net.minecraft.text.Text;
import net.minecraft.text.TextColor;
import net.minecraft.util.Identifier;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Replaces the vanilla title screen with the Halcyon menu.
 *
 * <p>The panorama is replaced by a picture of your choosing, the button column is rebuilt with
 * Halcyon widgets, and the header carries the wordmark. The vanilla destinations are reused rather
 * than reimplemented, so singleplayer, multiplayer and options behave exactly as they always did.
 */
@Mixin(TitleScreen.class)
public abstract class TitleScreenMixin extends Screen {
	private static final int HEADER_HEIGHT = 38;

	private static final int HEADER_BACKDROP = 0xB2070710;

	private static final int SCRIM = 0x59060612;

	private static final int CAPTION = 0xFF9AA0B5;

	private static final int FOOTER = 0xFF7B819A;

	protected TitleScreenMixin(Text title) {
		super(title);
	}

	@Inject(method = "init", at = @At("TAIL"))
	private void halcyon$buildMenu(CallbackInfo info) {
		if (!HalcyonConfig.get().mainMenuBranding) {
			return;
		}

		MinecraftClient client = MinecraftClient.getInstance();
		if (client == null) {
			return;
		}

		this.clearChildren();

		int buttonWidth = Math.max(200, Math.min(280, this.width / 3));
		int buttonHeight = 26;
		int gap = 7;
		int left = (this.width - buttonWidth) / 2;
		int top = Math.max(HEADER_HEIGHT + 34, this.height / 2 - 44);

		addDrawableChild(new HalcyonMenuButton(
				left,
				top,
				buttonWidth,
				buttonHeight,
				Text.translatable("menu.singleplayer"),
				true,
				() -> client.setScreen(new SelectWorldScreen(this))));

		top += buttonHeight + gap;
		addDrawableChild(new HalcyonMenuButton(
				left,
				top,
				buttonWidth,
				buttonHeight,
				Text.translatable("menu.multiplayer"),
				false,
				() -> client.setScreen(new MultiplayerScreen(this))));

		top += buttonHeight + gap;
		addDrawableChild(new HalcyonMenuButton(
				left,
				top,
				buttonWidth,
				buttonHeight,
				Text.translatable("menu.options"),
				false,
				() -> client.setScreen(new OptionsScreen(this, client.options))));

		top += buttonHeight + gap;
		addDrawableChild(new HalcyonMenuButton(
				left,
				top,
				buttonWidth,
				buttonHeight,
				Text.translatable("menu.quit"),
				false,
				client::scheduleStop));
	}

	@Inject(method = "renderBackground", at = @At("HEAD"), cancellable = true)
	private void halcyon$renderBackground(
			DrawContext context, int mouseX, int mouseY, float deltaTicks, CallbackInfo info) {
		if (!HalcyonConfig.get().mainMenuBranding) {
			return;
		}

		int width = context.getScaledWindowWidth();
		int height = context.getScaledWindowHeight();
		Identifier picture = HalcyonMenuBackground.texture();

		if (picture != null) {
			int pictureWidth = Math.max(1, HalcyonMenuBackground.imageWidth());
			int pictureHeight = Math.max(1, HalcyonMenuBackground.imageHeight());
			context.drawTexture(
					RenderPipelines.GUI_TEXTURED,
					picture,
					0,
					0,
					0.0F,
					0.0F,
					width,
					height,
					pictureWidth,
					pictureHeight,
					pictureWidth,
					pictureHeight);
			context.fill(0, 0, width, height, SCRIM);
		} else {
			halcyon$paintGradient(context, width, height);
		}

		info.cancel();
	}

	@Inject(method = "render", at = @At("TAIL"))
	private void halcyon$brandMenu(
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
		int height = context.getScaledWindowHeight();
		int accent = 0xFF000000 | config.badgeRgb();

		context.fill(0, 0, width, HEADER_HEIGHT, HEADER_BACKDROP);
		context.fill(0, HEADER_HEIGHT, width, HEADER_HEIGHT + 1, accent);

		Text wordmark = Text.literal("HALCYON")
				.setStyle(Style.EMPTY.withBold(true).withColor(TextColor.fromRgb(config.badgeRgb())));
		context.drawCenteredTextWithShadow(client.textRenderer, wordmark, width / 2, 9, 0xFFFFFFFF);

		String message = HalcyonBackend.get().menuMessage();
		Text caption = message == null || message.isBlank()
				? Text.literal("Premium Minecraft by YugiYX")
				: Text.literal(message);
		context.drawCenteredTextWithShadow(client.textRenderer, caption, width / 2, 23, CAPTION);

		int online = HalcyonBackend.get().onlineCount();
		if (online > 0) {
			Text presence = Text.literal(online + " playing with Halcyon");
			context.drawTextWithShadow(client.textRenderer, presence, 6, height - 12, FOOTER);
		}
	}

	/** Painted fallback for when no background picture has been placed. */
	private void halcyon$paintGradient(DrawContext context, int width, int height) {
		int bands = 48;
		for (int index = 0; index < bands; index++) {
			int top = height * index / bands;
			int bottom = height * (index + 1) / bands;
			float ratio = (float) index / (float) (bands - 1);
			int red = (int) (9.0F + ratio * 11.0F);
			int green = (int) (9.0F + ratio * 8.0F);
			int blue = (int) (20.0F + ratio * 26.0F);
			context.fill(0, top, width, bottom, 0xFF000000 | (red << 16) | (green << 8) | blue);
		}
	}
}
