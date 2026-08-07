package gg.halcyon.companion;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gl.RenderPipelines;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Style;
import net.minecraft.text.Text;
import net.minecraft.text.TextColor;
import net.minecraft.util.Identifier;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * The wardrobe.
 *
 * <p>Everything the owner handed out is shown at once in a grid rather than one at a time, with a
 * row of tabs across the top for the kinds that are owned, so a collection of capes, wings and
 * hats stays browsable as it grows. One cosmetic per slot can be worn, which is why putting wings
 * on does not take a hat off.
 *
 * <p>Only cosmetics the backend granted to this account appear here, and the backend refuses an
 * equip request for anything else, so the grid is the truth rather than a suggestion.
 */
public class HalcyonCosmeticsScreen extends Screen {
	private static final int PANEL = 0xB2121323;

	private static final int TILE = 0x99101024;

	private static final int LABEL = 0xFFE9E9F6;

	private static final int CAPTION = 0xFF9AA0B5;

	private static final int FOOTER = 0xFF7B819A;

	private static final int COLUMNS = 5;

	private static final int ROWS = 3;

	private static final int TILE_WIDTH = 62;

	private static final int TILE_HEIGHT = 74;

	private static final int GAP = 8;

	private static final int GRID_TOP = 74;

	/** One drawn cell, remembered so the picture can be painted over its button. */
	private record Cell(int x, int y, HalcyonCosmetics.Cape cosmetic) {}

	private final Screen parent;

	private final List<Cell> cells = new ArrayList<>();

	private List<HalcyonCosmetics.Cape> shown = List.of();

	private String filter = "";

	private int page;

	public HalcyonCosmeticsScreen(Screen parent) {
		super(Text.literal("Halcyon cosmetics"));
		this.parent = parent;
	}

	@Override
	protected void init() {
		MinecraftClient client = MinecraftClient.getInstance();
		HalcyonCosmetics cosmetics = HalcyonCosmetics.get();
		cells.clear();

		shown = cosmetics.unlocked(filter);
		int perPage = COLUMNS * ROWS;
		int pages = Math.max(1, (shown.size() + perPage - 1) / perPage);
		if (page >= pages) {
			page = pages - 1;
		}

		tabs(cosmetics);
		grid(cosmetics, perPage);

		int center = this.width / 2;
		int bottom = this.height - 28;
		int wide = 96;

		addDrawableChild(new HalcyonMenuButton(
				center - wide - wide / 2 - GAP,
				bottom,
				wide,
				20,
				Text.literal("Previous"),
				false,
				() -> turn(-1, pages)));

		addDrawableChild(new HalcyonMenuButton(
				center - wide / 2, bottom, wide, 20, Text.literal("Refresh"), false, () -> {
					cosmetics.refresh(client);
					rebuild();
				}));

		addDrawableChild(new HalcyonMenuButton(
				center + wide / 2 + GAP,
				bottom,
				wide,
				20,
				Text.literal("Next"),
				false,
				() -> turn(1, pages)));

		addDrawableChild(new HalcyonMenuButton(
				center - wide / 2, bottom + 24, wide, 18, Text.literal("Back"), false, this::close));
	}

	/** The row of kind tabs, built from what this player actually owns. */
	private void tabs(HalcyonCosmetics cosmetics) {
		List<String> kinds = new ArrayList<>();
		kinds.add("");
		kinds.addAll(cosmetics.kinds());

		int width = Math.max(52, Math.min(96, (this.width - 40) / Math.max(1, kinds.size()) - 4));
		int total = kinds.size() * (width + 4) - 4;
		int left = (this.width - total) / 2;

		for (String kind : kinds) {
			String label = kind.isEmpty() ? "All" : title(kind);
			int count = cosmetics.unlocked(kind).size();
			boolean active = kind.equals(filter);

			addDrawableChild(new HalcyonMenuButton(
					left,
					42,
					width,
					20,
					Text.literal(label + " " + count),
					active,
					() -> choose(kind)));
			left += width + 4;
		}
	}

	/** One button per visible cosmetic. The picture is drawn over it afterwards. */
	private void grid(HalcyonCosmetics cosmetics, int perPage) {
		int total = COLUMNS * TILE_WIDTH + (COLUMNS - 1) * GAP;
		int left = (this.width - total) / 2;
		int start = page * perPage;

		for (int slot = 0; slot < perPage; slot++) {
			int index = start + slot;
			if (index >= shown.size()) {
				break;
			}

			HalcyonCosmetics.Cape cosmetic = shown.get(index);
			int x = left + (slot % COLUMNS) * (TILE_WIDTH + GAP);
			int y = GRID_TOP + (slot / COLUMNS) * (TILE_HEIGHT + GAP);

			cells.add(new Cell(x, y, cosmetic));
			addDrawableChild(new HalcyonMenuButton(
					x,
					y,
					TILE_WIDTH,
					TILE_HEIGHT,
					Text.empty(),
					cosmetics.isWearing(cosmetic.id()),
					() -> wear(cosmetic)));
		}
	}

	private void choose(String kind) {
		filter = kind;
		page = 0;
		rebuild();
	}

	private void turn(int delta, int pages) {
		page = Math.floorMod(page + delta, pages);
		rebuild();
	}

	private void rebuild() {
		this.clearChildren();
		this.init();
	}

	private void wear(HalcyonCosmetics.Cape cosmetic) {
		MinecraftClient client = MinecraftClient.getInstance();
		HalcyonCosmetics cosmetics = HalcyonCosmetics.get();
		String slot = cosmetics.slotOf(cosmetic.id());

		cosmetics.equip(
				client, cosmetics.isWearing(cosmetic.id()) ? "" : cosmetic.id(), slot);
		rebuild();
	}

	@Override
	public void render(DrawContext context, int mouseX, int mouseY, float deltaTicks) {
		super.render(context, mouseX, mouseY, deltaTicks);

		HalcyonCosmetics cosmetics = HalcyonCosmetics.get();
		int accent = 0xFF000000 | HalcyonConfig.get().badgeRgb();
		Text title = Text.literal("COSMETICS")
				.setStyle(Style.EMPTY
						.withBold(true)
						.withColor(TextColor.fromRgb(HalcyonConfig.get().badgeRgb())));

		context.drawCenteredTextWithShadow(this.textRenderer, title, this.width / 2, 18, LABEL);

		if (shown.isEmpty()) {
			context.drawCenteredTextWithShadow(
					this.textRenderer,
					Text.literal(
							filter.isEmpty()
									? "You do not have any cosmetics yet"
									: "Nothing of that kind yet"),
					this.width / 2,
					GRID_TOP + 40,
					LABEL);
			context.drawCenteredTextWithShadow(
					this.textRenderer,
					Text.literal("Only YugiYX can hand out Halcyon cosmetics"),
					this.width / 2,
					GRID_TOP + 54,
					CAPTION);
			footer(context, cosmetics);
			return;
		}

		long now = System.currentTimeMillis();
		for (Cell cell : cells) {
			paint(context, cosmetics, cell, accent, now);
		}

		footer(context, cosmetics);
	}

	/** Draws one tile: the picture, the name under it and a mark when it is worn. */
	private void paint(
			DrawContext context,
			HalcyonCosmetics cosmetics,
			Cell cell,
			int accent,
			long now) {
		String id = cell.cosmetic().id();
		int artTop = cell.y() + 4;
		int artHeight = TILE_HEIGHT - 22;
		int artWidth = TILE_WIDTH - 16;
		int artLeft = cell.x() + 8;

		context.fill(artLeft - 2, artTop - 2, artLeft + artWidth + 2, artTop + artHeight + 2, TILE);

		Identifier texture = cosmetics.texture(id);
		if (texture == null) {
			context.drawCenteredTextWithShadow(
					this.textRenderer,
					Text.literal("..."),
					cell.x() + TILE_WIDTH / 2,
					artTop + artHeight / 2 - 4,
					CAPTION);
		} else {
			int sheetWidth = cosmetics.textureWidth(id);
			int sheetHeight = cosmetics.textureHeight(id);
			int frameHeight = cosmetics.frameHeight(id);
			// An animated picture is every frame stacked into one tall image, so playing it is a
			// matter of sliding the window down the strip as the clock moves.
			int frameTop = cosmetics.frameAt(id, now) * frameHeight;

			if (cosmetics.kindOf(id).equals("cape")) {
				// A cape sheet keeps the visible side at the very top left, and larger sheets are
				// the same layout at a bigger scale.
				int scale = Math.max(1, sheetWidth / 64);
				context.drawTexture(
						RenderPipelines.GUI_TEXTURED,
						texture,
						artLeft,
						artTop,
						(float) scale,
						(float) (frameTop + scale),
						artWidth,
						artHeight,
						10 * scale,
						16 * scale,
						sheetWidth,
						sheetHeight);
			} else {
				// Anything else is drawn whole, so wings and hats show the art the owner made
				// rather than a crop of it.
				context.drawTexture(
						RenderPipelines.GUI_TEXTURED,
						texture,
						artLeft,
						artTop,
						0.0F,
						(float) frameTop,
						artWidth,
						artHeight,
						sheetWidth,
						frameHeight,
						sheetWidth,
						sheetHeight);
			}
		}

		if (cosmetics.isWearing(id)) {
			context.fill(cell.x(), cell.y(), cell.x() + 3, cell.y() + TILE_HEIGHT, accent);
		}
		if (cosmetics.isAnimated(id)) {
			context.fill(
					cell.x() + TILE_WIDTH - 6,
					cell.y() + 4,
					cell.x() + TILE_WIDTH - 3,
					cell.y() + 7,
					accent);
		}

		String name = cell.cosmetic().name();
		String trimmed = this.textRenderer.getWidth(name) > TILE_WIDTH - 6
				? this.textRenderer.trimToWidth(name, TILE_WIDTH - 12) + "..."
				: name;

		context.drawCenteredTextWithShadow(
				this.textRenderer,
				Text.literal(trimmed),
				cell.x() + TILE_WIDTH / 2,
				cell.y() + TILE_HEIGHT - 13,
				cosmetics.isWearing(id) ? accent : LABEL);
	}

	private void footer(DrawContext context, HalcyonCosmetics cosmetics) {
		int perPage = COLUMNS * ROWS;
		int pages = Math.max(1, (shown.size() + perPage - 1) / perPage);

		context.fill(0, this.height - 54, this.width, this.height - 53, PANEL);
		context.drawCenteredTextWithShadow(
				this.textRenderer,
				Text.literal(shown.size() + " owned, page " + (page + 1) + " of " + pages),
				this.width / 2,
				this.height - 48,
				FOOTER);

		String status = cosmetics.status();
		if (!status.isEmpty()) {
			context.drawTextWithShadow(
					this.textRenderer, Text.literal(status), 8, this.height - 12, FOOTER);
		}
	}

	private static String title(String value) {
		if (value.isEmpty()) {
			return value;
		}
		return value.substring(0, 1).toUpperCase(Locale.ROOT) + value.substring(1);
	}

	@Override
	public void close() {
		MinecraftClient client = MinecraftClient.getInstance();
		if (client != null) {
			client.setScreen(parent);
		}
	}
}
