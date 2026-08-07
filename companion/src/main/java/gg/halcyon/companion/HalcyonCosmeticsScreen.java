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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The wardrobe.
 *
 * <p>Everything the owner handed out is shown at once in a grid, with a row of tabs for the kinds
 * that are owned so a growing collection of capes, wings and hats stays browsable. One cosmetic per
 * slot can be worn, which is why putting wings on does not take a hat off.
 *
 * <p>The whole layout is measured against the window every time the screen opens or is resized:
 * how many tabs fit on a row, how many tiles fit across and down, and where the row of controls
 * sits. Nothing is placed at a fixed offset, so no button can end up past the bottom of a small
 * window, and the picture in each tile keeps its own proportions instead of being stretched.
 */
public class HalcyonCosmeticsScreen extends Screen {
	private static final int PANEL = 0xB2121323;

	private static final int PLATE = 0x99101024;

	private static final int LABEL = 0xFFE9E9F6;

	private static final int CAPTION = 0xFF9AA0B5;

	private static final int FOOTER = 0xFF7B819A;

	private static final int TILE_WIDTH = 88;

	private static final int TILE_HEIGHT = 104;

	private static final int GAP = 8;

	private static final int ROW_HEIGHT = 20;

	private static final int MAX_COLUMNS = 8;

	/** Rarity reads at a glance from the bar under each picture. */
	private static final Map<String, Integer> RARITY = Map.of(
			"common", 0xFF9AA0B5,
			"uncommon", 0xFF6FCF97,
			"rare", 0xFF56A8F5,
			"epic", 0xFFA78BFA,
			"legendary", 0xFFF2C14E,
			"exclusive", 0xFFFF6FB5);

	/** One drawn cell, remembered so the picture can be painted over its button. */
	private record Cell(int x, int y, HalcyonCosmetics.Cape cosmetic) {}

	private final Screen parent;

	private final List<Cell> cells = new ArrayList<>();

	private List<HalcyonCosmetics.Cape> shown = List.of();

	private String filter = "";

	private int page;

	private int columns = 1;

	private int rows = 1;

	private int gridTop;

	private int detailTop;

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

		// Measured from the bottom up, so the controls are always on screen and the grid takes
		// whatever room is left over.
		int controlsTop = this.height - ROW_HEIGHT - 8;
		detailTop = controlsTop - 40;
		gridTop = tabs(cosmetics) + 10;

		int room = Math.max(TILE_HEIGHT, detailTop - 8 - gridTop);
		columns = Math.max(
				1, Math.min(MAX_COLUMNS, (this.width - 24 + GAP) / (TILE_WIDTH + GAP)));
		rows = Math.max(1, (room + GAP) / (TILE_HEIGHT + GAP));

		int perPage = columns * rows;
		int pages = Math.max(1, (shown.size() + perPage - 1) / perPage);
		if (page >= pages) {
			page = pages - 1;
		}

		grid(cosmetics, perPage);
		controls(client, cosmetics, controlsTop, pages);
	}

	/** The row or rows of kind tabs, built from what this player actually owns. */
	private int tabs(HalcyonCosmetics cosmetics) {
		List<String> kinds = new ArrayList<>();
		kinds.add("");
		kinds.addAll(cosmetics.kinds());

		Map<String, String> labels = new LinkedHashMap<>();
		int widest = 0;
		for (String kind : kinds) {
			String label =
					(kind.isEmpty() ? "All" : title(kind)) + " " + cosmetics.unlocked(kind).size();
			labels.put(kind, label);
			widest = Math.max(widest, this.textRenderer.getWidth(label));
		}

		int tabWidth = Math.max(52, Math.min(120, widest + 16));
		int perRow = Math.max(1, (this.width - 24 + 4) / (tabWidth + 4));
		int top = 30;
		int index = 0;

		while (index < kinds.size()) {
			int count = Math.min(perRow, kinds.size() - index);
			int total = count * (tabWidth + 4) - 4;
			int left = Math.max(8, (this.width - total) / 2);

			for (int column = 0; column < count; column++) {
				String kind = kinds.get(index + column);
				addDrawableChild(new HalcyonMenuButton(
						left,
						top,
						tabWidth,
						ROW_HEIGHT,
						Text.literal(labels.get(kind)),
						kind.equals(filter),
						() -> choose(kind)));
				left += tabWidth + 4;
			}

			index += count;
			top += ROW_HEIGHT + 4;
		}
		return top - 4;
	}

	/** One button per visible cosmetic. The picture is drawn over it afterwards. */
	private void grid(HalcyonCosmetics cosmetics, int perPage) {
		int span = columns * TILE_WIDTH + (columns - 1) * GAP;
		int left = Math.max(4, (this.width - span) / 2);
		int start = page * perPage;

		for (int slot = 0; slot < perPage; slot++) {
			int index = start + slot;
			if (index >= shown.size()) {
				break;
			}

			HalcyonCosmetics.Cape cosmetic = shown.get(index);
			int x = left + (slot % columns) * (TILE_WIDTH + GAP);
			int y = gridTop + (slot / columns) * (TILE_HEIGHT + GAP);

			cells.add(new Cell(x, y, cosmetic));
			addDrawableChild(new HalcyonMenuButton(
					x, y, TILE_WIDTH, TILE_HEIGHT, Text.empty(), false, () -> wear(cosmetic)));
		}
	}

	/** Paging, a manual refresh and the way out, all on one row inside the window. */
	private void controls(
			MinecraftClient client, HalcyonCosmetics cosmetics, int top, int pages) {
		int width = Math.max(52, Math.min(112, (this.width - 24 - 3 * GAP) / 4));
		int total = 4 * width + 3 * GAP;
		int left = Math.max(8, (this.width - total) / 2);

		addDrawableChild(new HalcyonMenuButton(
				left,
				top,
				width,
				ROW_HEIGHT,
				Text.literal("Previous"),
				false,
				() -> turn(-1, pages)));

		addDrawableChild(new HalcyonMenuButton(
				left + width + GAP,
				top,
				width,
				ROW_HEIGHT,
				Text.literal("Next"),
				false,
				() -> turn(1, pages)));

		addDrawableChild(new HalcyonMenuButton(
				left + 2 * (width + GAP),
				top,
				width,
				ROW_HEIGHT,
				Text.literal("Refresh"),
				false,
				() -> {
					cosmetics.refresh(client);
					rebuild();
				}));

		addDrawableChild(new HalcyonMenuButton(
				left + 3 * (width + GAP),
				top,
				width,
				ROW_HEIGHT,
				Text.literal("Back"),
				true,
				this::close));
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

		cosmetics.equip(client, cosmetics.isWearing(cosmetic.id()) ? "" : cosmetic.id(), slot);
		rebuild();
	}

	@Override
	public void render(DrawContext context, int mouseX, int mouseY, float deltaTicks) {
		super.render(context, mouseX, mouseY, deltaTicks);

		HalcyonCosmetics cosmetics = HalcyonCosmetics.get();
		int accent = 0xFF000000 | HalcyonConfig.get().badgeRgb();

		context.drawCenteredTextWithShadow(
				this.textRenderer,
				Text.literal("COSMETICS")
						.setStyle(Style.EMPTY
								.withBold(true)
								.withColor(TextColor.fromRgb(HalcyonConfig.get().badgeRgb()))),
				this.width / 2,
				12,
				LABEL);

		int perPage = Math.max(1, columns * rows);
		int pages = Math.max(1, (shown.size() + perPage - 1) / perPage);
		String counter = shown.size() + " owned, page " + (page + 1) + " of " + pages;
		context.drawTextWithShadow(
				this.textRenderer,
				Text.literal(counter),
				this.width - 8 - this.textRenderer.getWidth(counter),
				12,
				FOOTER);

		if (shown.isEmpty()) {
			context.drawCenteredTextWithShadow(
					this.textRenderer,
					Text.literal(
							filter.isEmpty()
									? "You do not have any cosmetics yet"
									: "Nothing of that kind yet"),
					this.width / 2,
					gridTop + 24,
					LABEL);
			context.drawCenteredTextWithShadow(
					this.textRenderer,
					Text.literal("Only YugiYX can hand out Halcyon cosmetics"),
					this.width / 2,
					gridTop + 38,
					CAPTION);
			detail(context, cosmetics, null, accent);
			return;
		}

		long now = System.currentTimeMillis();
		HalcyonCosmetics.Cape focus = null;

		for (Cell cell : cells) {
			boolean hovered = mouseX >= cell.x()
					&& mouseX < cell.x() + TILE_WIDTH
					&& mouseY >= cell.y()
					&& mouseY < cell.y() + TILE_HEIGHT;
			if (hovered) {
				focus = cell.cosmetic();
			}
			paint(context, cosmetics, cell, accent, now);
		}

		if (focus == null) {
			for (HalcyonCosmetics.Cape cosmetic : shown) {
				if (cosmetics.isWearing(cosmetic.id())) {
					focus = cosmetic;
					break;
				}
			}
		}
		if (focus == null && !cells.isEmpty()) {
			focus = cells.get(0).cosmetic();
		}

		detail(context, cosmetics, focus, accent);
	}

	/** Draws one tile: the picture, the name under it and a mark when it is worn. */
	private void paint(
			DrawContext context, HalcyonCosmetics cosmetics, Cell cell, int accent, long now) {
		String id = cell.cosmetic().id();
		int artLeft = cell.x() + 5;
		int artTop = cell.y() + 5;
		int artWidth = TILE_WIDTH - 10;
		int artHeight = TILE_HEIGHT - 34;

		context.fill(artLeft, artTop, artLeft + artWidth, artTop + artHeight, PLATE);

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
			// Frames uploaded as separate pictures are swapped whole, so only a strip has to
			// slide its window down the sheet as the clock moves.
			int frameTop = cosmetics.isStrip(id) ? cosmetics.frameAt(id, now) * frameHeight : 0;
			boolean cape = cosmetics.kindOf(id).equals("cape");
			int scale = Math.max(1, sheetWidth / 64);

			// A cape sheet keeps the visible side at the top left; everything else is drawn whole
			// so wings and hats show the art the owner made rather than a crop of it.
			float u = cape ? scale : 0.0F;
			float v = cape ? frameTop + scale : frameTop;
			int regionWidth = cape ? 10 * scale : sheetWidth;
			int regionHeight = cape ? 16 * scale : frameHeight;

			// Keeping the proportions of the picture is the difference between a wardrobe and a
			// wall of squashed thumbnails.
			double ratio = (double) regionWidth / (double) Math.max(1, regionHeight);
			int drawHeight = artHeight - 4;
			int drawWidth = (int) Math.round(drawHeight * ratio);
			if (drawWidth > artWidth - 4) {
				drawWidth = artWidth - 4;
				drawHeight = (int) Math.round(drawWidth / Math.max(0.01, ratio));
			}

			context.drawTexture(
					RenderPipelines.GUI_TEXTURED,
					texture,
					artLeft + (artWidth - drawWidth) / 2,
					artTop + (artHeight - drawHeight) / 2,
					u,
					v,
					Math.max(1, drawWidth),
					Math.max(1, drawHeight),
					regionWidth,
					regionHeight,
					sheetWidth,
					sheetHeight);
		}

		int rarity = RARITY.getOrDefault(
				cell.cosmetic().rarity().toLowerCase(Locale.ROOT), CAPTION);
		context.fill(artLeft, artTop + artHeight + 1, artLeft + artWidth, artTop + artHeight + 2, rarity);

		boolean worn = cosmetics.isWearing(id);
		if (worn) {
			// A ring rather than a wash, so the picture underneath stays readable.
			context.fill(cell.x(), cell.y(), cell.x() + TILE_WIDTH, cell.y() + 1, accent);
			context.fill(
					cell.x(),
					cell.y() + TILE_HEIGHT - 1,
					cell.x() + TILE_WIDTH,
					cell.y() + TILE_HEIGHT,
					accent);
			context.fill(cell.x(), cell.y(), cell.x() + 1, cell.y() + TILE_HEIGHT, accent);
			context.fill(
					cell.x() + TILE_WIDTH - 1,
					cell.y(),
					cell.x() + TILE_WIDTH,
					cell.y() + TILE_HEIGHT,
					accent);
		}
		if (cosmetics.isAnimated(id)) {
			context.fill(
					cell.x() + TILE_WIDTH - 8,
					cell.y() + 8,
					cell.x() + TILE_WIDTH - 5,
					cell.y() + 11,
					accent);
		}

		// Two lines of room means most names fit in full, and the one under the pointer is
		// spelled out in the panel below whatever happens.
		List<String> name = wrap(cell.cosmetic().name(), TILE_WIDTH - 8, 2);
		int textTop = cell.y() + TILE_HEIGHT - 4 - name.size() * 10;
		for (int line = 0; line < name.size(); line++) {
			context.drawCenteredTextWithShadow(
					this.textRenderer,
					Text.literal(name.get(line)),
					cell.x() + TILE_WIDTH / 2,
					textTop + line * 10,
					worn ? accent : LABEL);
		}
	}

	/** The panel under the grid, which always spells out one cosmetic in full. */
	private void detail(
			DrawContext context,
			HalcyonCosmetics cosmetics,
			HalcyonCosmetics.Cape cosmetic,
			int accent) {
		context.fill(0, detailTop - 8, this.width, detailTop - 7, PANEL);

		String status = cosmetics.status();
		if (cosmetic != null) {
			String id = cosmetic.id();
			boolean worn = cosmetics.isWearing(id);

			context.drawCenteredTextWithShadow(
					this.textRenderer,
					Text.literal(cosmetic.name()),
					this.width / 2,
					detailTop,
					worn ? accent : LABEL);

			StringBuilder line = new StringBuilder(title(cosmetics.kindOf(id)));
			line.append(" - ")
					.append(title(cosmetic.rarity().isEmpty() ? "common" : cosmetic.rarity()))
					.append(" - ")
					.append(cosmetics.slotOf(id))
					.append(" slot");
			if (cosmetics.isAnimated(id)) {
				line.append(" - animated, ").append(cosmetics.frames(id)).append(" frames");
			}
			line.append(worn ? " - worn, click to take off" : " - click to wear");

			context.drawCenteredTextWithShadow(
					this.textRenderer,
					Text.literal(line.toString()),
					this.width / 2,
					detailTop + 12,
					CAPTION);

			String third = status.isEmpty() ? cosmetic.description() : status;
			if (!third.isEmpty()) {
				context.drawCenteredTextWithShadow(
						this.textRenderer,
						Text.literal(this.textRenderer.trimToWidth(third, this.width - 24)),
						this.width / 2,
						detailTop + 24,
						FOOTER);
			}
			return;
		}

		if (!status.isEmpty()) {
			context.drawCenteredTextWithShadow(
					this.textRenderer,
					Text.literal(this.textRenderer.trimToWidth(status, this.width - 24)),
					this.width / 2,
					detailTop + 12,
					FOOTER);
		}
	}

	/** Breaks a name over a few lines at word boundaries, with an ellipsis when it still runs on. */
	private List<String> wrap(String value, int width, int lines) {
		List<String> result = new ArrayList<>();
		String rest = value == null ? "" : value.trim();

		while (!rest.isEmpty() && result.size() < lines) {
			if (this.textRenderer.getWidth(rest) <= width) {
				result.add(rest);
				return result;
			}

			String head = this.textRenderer.trimToWidth(rest, width);
			if (head.isEmpty()) {
				head = rest.substring(0, 1);
			}

			if (result.size() + 1 == lines) {
				String shortened = this.textRenderer.trimToWidth(rest, Math.max(1, width - 8));
				result.add(shortened + "...");
				return result;
			}

			int cut = head.lastIndexOf(' ');
			if (cut > 0) {
				head = head.substring(0, cut);
			}
			result.add(head);
			rest = rest.substring(head.length()).trim();
		}

		if (result.isEmpty()) {
			result.add("");
		}
		return result;
	}

	private static String title(String value) {
		if (value == null || value.isEmpty()) {
			return "";
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
