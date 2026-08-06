package gg.halcyon.companion;

import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.network.PlayerListEntry;
import net.minecraft.text.Style;
import net.minecraft.text.Text;
import net.minecraft.text.TextColor;
import net.minecraft.util.math.BlockPos;

import java.util.ArrayList;
import java.util.List;

/** A compact overlay with the modules a client player expects to see. */
public final class HalcyonHud {
	private static final int LINE_HEIGHT = 10;

	private static final int MARGIN = 4;

	private static final long SESSION_STARTED_AT = System.currentTimeMillis();

	private HalcyonHud() {}

	public static void register() {
		HudRenderCallback.EVENT.register((context, tickCounter) -> render(context));
	}

	private static void render(DrawContext context) {
		HalcyonConfig config = HalcyonConfig.get();
		if (!config.hudEnabled) {
			return;
		}

		MinecraftClient client = MinecraftClient.getInstance();
		if (client.player == null || client.textRenderer == null || client.options.hudHidden) {
			return;
		}

		List<Text> lines = new ArrayList<>();
		lines.add(Text.literal("Halcyon")
				.setStyle(Style.EMPTY.withColor(TextColor.fromRgb(config.badgeRgb())).withBold(true)));

		if (config.showFps) {
			lines.add(Text.literal(client.getCurrentFps() + " fps"));
		}

		if (config.showPing) {
			int latency = latency(client);
			if (latency >= 0) {
				lines.add(Text.literal(latency + " ms"));
			}
		}

		if (config.showCoordinates) {
			BlockPos pos = client.player.getBlockPos();
			lines.add(Text.literal(pos.getX() + " " + pos.getY() + " " + pos.getZ()));
		}

		if (config.showSessionTime) {
			lines.add(Text.literal(sessionLength()));
		}

		boolean right = config.hudCorner == 1;
		int edge = right ? context.getScaledWindowWidth() - MARGIN : MARGIN;
		int y = MARGIN;

		for (Text line : lines) {
			int x = right ? edge - client.textRenderer.getWidth(line) : edge;
			context.drawTextWithShadow(client.textRenderer, line, x, y, 0xFFFFFFFF);
			y += LINE_HEIGHT;
		}
	}

	private static int latency(MinecraftClient client) {
		if (client.getNetworkHandler() == null || client.player == null) {
			return -1;
		}
		PlayerListEntry entry = client.getNetworkHandler().getPlayerListEntry(client.player.getUuid());
		return entry == null ? -1 : entry.getLatency();
	}

	private static String sessionLength() {
		long seconds = (System.currentTimeMillis() - SESSION_STARTED_AT) / 1000L;
		long minutes = seconds / 60L;
		long hours = minutes / 60L;
		if (hours > 0L) {
			return hours + "h " + (minutes % 60L) + "m";
		}
		return minutes + "m " + (seconds % 60L) + "s";
	}
}
