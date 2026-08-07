package gg.halcyon.companion;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gl.RenderPipelines;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Style;
import net.minecraft.text.Text;
import net.minecraft.text.TextColor;
import net.minecraft.util.Identifier;

import java.util.List;

/**
 * Browses the capes the owner handed out and puts one on.
 *
 * <p>Only cosmetics the backend granted to this account show up here, and the backend refuses an
 * equip request for anything else, so the list is the truth rather than a suggestion.
 */
public class HalcyonCosmeticsScreen extends Screen {
	private static final int PANEL = 0xB2121323;

	private static final int LABEL = 0xFFE9E9F6;

	private static final int CAPTION = 0xFF9AA0B5;

	private static final int FOOTER = 0xFF7B819A;

	private static final int PREVIEW_WIDTH = 70;

	private static final int PREVIEW_HEIGHT = 112;

	private final Screen parent;

	private List<HalcyonCosmetics.Cape> capes = List.of();

	private int index;

	public HalcyonCosmeticsScreen(Screen parent) {
		super(Text.literal("Halcyon cosmetics"));
		this.parent = parent;
	}

	@Override
	protected void init() {
		MinecraftClient client = MinecraftClient.getInstance();
		HalcyonCosmetics cosmetics = HalcyonCosmetics.get();

		capes = cosmetics.unlocked();
		if (index >= capes.size()) {
			index = 0;
		}

		int center = this.width / 2;
		int height = 20;
		int rowOne = this.height - 58;
		int rowTwo = this.height - 30;

		addDrawableChild(new HalcyonMenuButton(
				center - 150, rowOne, 44, height, Text.literal("<"), false, () -> step(-1)));

		addDrawableChild(new HalcyonMenuButton(
				center - 100, rowOne, 200, height, wearLabel(), true, this::wear));

		addDrawableChild(new HalcyonMenuButton(
				center + 106, rowOne, 44, height, Text.literal(">"), false, () -> step(1)));

		addDrawableChild(new HalcyonMenuButton(
				center - 150, rowTwo, 147, height, Text.literal("Refresh"), false, () -> {
					cosmetics.refresh(client);
					rebuild();
				}));

		addDrawableChild(new HalcyonMenuButton(
				center + 3, rowTwo, 147, height, Text.literal("Back"), false, this::close));
	}

	private void rebuild() {
		this.clearChildren();
		this.init();
	}

	private HalcyonCosmetics.Cape selected() {
		if (capes.isEmpty()) {
			return null;
		}
		return capes.get(Math.floorMod(index, capes.size()));
	}

	private void step(int delta) {
		if (capes.isEmpty()) {
			return;
		}
		index = Math.floorMod(index + delta, capes.size());
		rebuild();
	}

	private Text wearLabel() {
		HalcyonCosmetics.Cape cape = selected();
		if (cape == null) {
			return Text.literal("Nothing to wear yet");
		}
		return Text.literal(
				cape.id().equals(HalcyonCosmetics.get().equippedId()) ? "Take off" : "Wear this cape");
	}

	private void wear() {
		HalcyonCosmetics.Cape cape = selected();
		if (cape == null) {
			return;
		}

		MinecraftClient client = MinecraftClient.getInstance();
		HalcyonCosmetics cosmetics = HalcyonCosmetics.get();
		cosmetics.equip(client, cape.id().equals(cosmetics.equippedId()) ? "" : cape.id());
		rebuild();
	}

	@Override
	public void render(DrawContext context, int mouseX, int mouseY, float deltaTicks) {
		super.render(context, mouseX, mouseY, deltaTicks);

		HalcyonCosmetics cosmetics = HalcyonCosmetics.get();
		int accent = 0xFF000000 | HalcyonConfig.get().badgeRgb();
		Text title = Text.literal("COSMETICS")
				.setStyle(Style.EMPTY.withBold(true).withColor(TextColor.fromRgb(HalcyonConfig.get().badgeRgb())));

		context.drawCenteredTextWithShadow(this.textRenderer, title, this.width / 2, 18, LABEL);

		HalcyonCosmetics.Cape cape = selected();
		if (cape == null) {
			context.drawCenteredTextWithShadow(
					this.textRenderer,
					Text.literal("You do not have any capes yet"),
					this.width / 2,
					this.height / 2 - 12,
					LABEL);
			context.drawCenteredTextWithShadow(
					this.textRenderer,
					Text.literal("Only YugiYX can hand out Halcyon cosmetics"),
					this.width / 2,
					this.height / 2 + 2,
					CAPTION);
			footer(context, cosmetics);
			return;
		}

		int left = (this.width - PREVIEW_WIDTH) / 2;
		int top = 46;
		context.fill(left - 8, top - 8, left + PREVIEW_WIDTH + 8, top + PREVIEW_HEIGHT + 8, PANEL);
		context.fill(left - 8, top - 8, left - 5, top + PREVIEW_HEIGHT + 8, accent);

		Identifier texture = cosmetics.texture(cape.id());
		if (texture == null) {
			context.drawCenteredTextWithShadow(
					this.textRenderer,
					Text.literal("loading"),
					this.width / 2,
					top + PREVIEW_HEIGHT / 2 - 4,
					CAPTION);
		} else {
			// A cape sheet keeps the visible side at the very top left, and larger sheets are the
			// same layout at a bigger scale, so every coordinate is multiplied by the same factor.
			int sheetWidth = cosmetics.textureWidth(cape.id());
			int sheetHeight = cosmetics.textureHeight(cape.id());
			int scale = Math.max(1, sheetWidth / 64);

			context.drawTexture(
					RenderPipelines.GUI_TEXTURED,
					texture,
					left,
					top,
					(float) scale,
					(float) scale,
					PREVIEW_WIDTH,
					PREVIEW_HEIGHT,
					10 * scale,
					16 * scale,
					sheetWidth,
					sheetHeight);
		}

		int textTop = top + PREVIEW_HEIGHT + 16;
		context.drawCenteredTextWithShadow(
				this.textRenderer, Text.literal(cape.name()), this.width / 2, textTop, LABEL);

		String detail = cape.rarity().isEmpty() ? "" : cape.rarity().toUpperCase();
		if (!cape.description().isEmpty()) {
			detail = detail.isEmpty() ? cape.description() : detail + "  " + cape.description();
		}
		if (!detail.isEmpty()) {
			context.drawCenteredTextWithShadow(
					this.textRenderer, Text.literal(detail), this.width / 2, textTop + 12, CAPTION);
		}

		if (cape.id().equals(cosmetics.equippedId())) {
			context.drawCenteredTextWithShadow(
					this.textRenderer,
					Text.literal("Currently worn"),
					this.width / 2,
					textTop + 24,
					accent);
		}

		context.drawCenteredTextWithShadow(
				this.textRenderer,
				Text.literal((Math.floorMod(index, capes.size()) + 1) + " of " + capes.size()),
				this.width / 2,
				top - 20,
				FOOTER);

		footer(context, cosmetics);
	}

	private void footer(DrawContext context, HalcyonCosmetics cosmetics) {
		String status = cosmetics.status();
		if (!status.isEmpty()) {
			context.drawTextWithShadow(
					this.textRenderer, Text.literal(status), 8, this.height - 12, FOOTER);
		}
	}

	@Override
	public void close() {
		MinecraftClient client = MinecraftClient.getInstance();
		if (client != null) {
			client.setScreen(parent);
		}
	}
}
