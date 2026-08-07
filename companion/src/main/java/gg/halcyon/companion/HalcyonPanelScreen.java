package gg.halcyon.companion;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Style;
import net.minecraft.text.Text;
import net.minecraft.text.TextColor;

/**
 * The Halcyon panel, opened in game with right shift and from the title screen.
 *
 * <p>It is deliberately small: the things a player wants mid game are the cosmetics and the
 * switches for the overlay and the badges.
 */
public class HalcyonPanelScreen extends Screen {
	private static final int CAPTION = 0xFF9AA0B5;

	private static final int LABEL = 0xFFE9E9F6;

	private final Screen parent;

	public HalcyonPanelScreen(Screen parent) {
		super(Text.literal("Halcyon"));
		this.parent = parent;
	}

	@Override
	protected void init() {
		MinecraftClient client = MinecraftClient.getInstance();
		HalcyonConfig config = HalcyonConfig.get();

		int width = Math.max(180, Math.min(240, this.width / 3));
		int left = (this.width - width) / 2;
		int height = 22;
		int gap = 6;
		int top = Math.max(58, this.height / 2 - 82);

		addDrawableChild(new HalcyonMenuButton(
				left,
				top,
				width,
				height,
				Text.literal("Cosmetics"),
				true,
				() -> client.setScreen(new HalcyonCosmeticsScreen(this))));

		top += height + gap;
		addDrawableChild(new HalcyonMenuButton(
				left,
				top,
				width,
				height,
				Text.literal("Overlay: " + state(config.hudEnabled)),
				false,
				() -> {
					config.hudEnabled = !config.hudEnabled;
					config.save();
					rebuild();
				}));

		top += height + gap;
		addDrawableChild(new HalcyonMenuButton(
				left,
				top,
				width,
				height,
				Text.literal("Name badges: " + state(config.badgeEnabled)),
				false,
				() -> {
					config.badgeEnabled = !config.badgeEnabled;
					config.save();
					rebuild();
				}));

		top += height + gap;
		addDrawableChild(new HalcyonMenuButton(
				left,
				top,
				width,
				height,
				Text.literal("Custom menu: " + state(config.mainMenuBranding)),
				false,
				() -> {
					config.mainMenuBranding = !config.mainMenuBranding;
					config.save();
					rebuild();
				}));

		top += height + gap + 6;
		addDrawableChild(new HalcyonMenuButton(
				left, top, width, height, Text.literal("Back"), false, this::close));
	}

	private void rebuild() {
		this.clearChildren();
		this.init();
	}

	private static String state(boolean value) {
		return value ? "on" : "off";
	}

	@Override
	public void render(DrawContext context, int mouseX, int mouseY, float deltaTicks) {
		super.render(context, mouseX, mouseY, deltaTicks);

		HalcyonConfig config = HalcyonConfig.get();
		Text wordmark = Text.literal("HALCYON")
				.setStyle(Style.EMPTY.withBold(true).withColor(TextColor.fromRgb(config.badgeRgb())));

		context.drawCenteredTextWithShadow(this.textRenderer, wordmark, this.width / 2, 22, LABEL);
		context.drawCenteredTextWithShadow(
				this.textRenderer,
				Text.literal("Right shift opens this menu"),
				this.width / 2,
				36,
				CAPTION);
	}

	@Override
	public void close() {
		MinecraftClient client = MinecraftClient.getInstance();
		if (client != null) {
			client.setScreen(parent);
		}
	}
}
