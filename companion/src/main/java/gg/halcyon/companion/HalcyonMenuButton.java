package gg.halcyon.companion;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.Click;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.narration.NarrationMessageBuilder;
import net.minecraft.client.gui.widget.ClickableWidget;
import net.minecraft.text.Text;

/**
 * A flat Halcyon button.
 *
 * <p>The vanilla pressable widget draws its own sprite and marks the renderer as final, so a custom
 * look has to be built straight on top of the clickable widget. Everything is painted with plain
 * rectangles, which keeps the widget resolution independent and free of texture assets.
 */
public class HalcyonMenuButton extends ClickableWidget {
	private static final int SURFACE = 0xB2121323;

	private static final int SURFACE_HOVERED = 0xE61C1D34;

	private static final int LABEL = 0xFFE9E9F6;

	private final Runnable action;

	private final boolean primary;

	public HalcyonMenuButton(
			int x, int y, int width, int height, Text message, boolean primary, Runnable action) {
		super(x, y, width, height, message);
		this.primary = primary;
		this.action = action;
	}

	@Override
	protected void renderWidget(DrawContext context, int mouseX, int mouseY, float deltaTicks) {
		int left = getX();
		int top = getY();
		int right = left + getWidth();
		int bottom = top + getHeight();
		boolean hovered = isHovered();
		int accent = 0xFF000000 | HalcyonConfig.get().badgeRgb();

		context.fill(left, top, right, bottom, hovered ? SURFACE_HOVERED : SURFACE);
		context.fill(left, top, left + (primary ? 3 : 2), bottom, accent);

		if (hovered) {
			context.fill(left, top, right, top + 1, accent);
			context.fill(left, bottom - 1, right, bottom, accent);
		}

		MinecraftClient client = MinecraftClient.getInstance();
		if (client != null && client.textRenderer != null) {
			int textY = top + (getHeight() - 8) / 2;
			context.drawCenteredTextWithShadow(
					client.textRenderer,
					getMessage(),
					left + getWidth() / 2,
					textY,
					hovered ? accent : LABEL);
		}
	}

	@Override
	public void onClick(Click click, boolean doubled) {
		action.run();
	}

	@Override
	protected void appendClickableNarrations(NarrationMessageBuilder builder) {
		appendDefaultNarrations(builder);
	}
}
