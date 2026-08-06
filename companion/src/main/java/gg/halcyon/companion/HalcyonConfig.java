package gg.halcyon.companion;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import net.fabricmc.loader.api.FabricLoader;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/** User facing settings, stored as JSON in the instance config folder. */
public final class HalcyonConfig {
	private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

	private static HalcyonConfig instance;

	/** Draw the Halcyon badge in front of the nametag of other Halcyon players. */
	public boolean badgeEnabled = true;

	/** The glyph drawn in front of the name. */
	public String badgeText = "\u2726";

	/** Badge colour as a hexadecimal RGB string. */
	public String badgeColor = "#8B7CF6";

	/** Optional roster endpoint that lists the players running Halcyon. */
	public String rosterUrl = "";

	/** Master switch for the on screen overlay. */
	public boolean hudEnabled = true;

	public boolean showFps = true;

	public boolean showCoordinates = true;

	public boolean showPing = true;

	public boolean showSessionTime = true;

	/** Corner of the screen used by the overlay: 0 top left, 1 top right. */
	public int hudCorner = 0;

	public static HalcyonConfig get() {
		if (instance == null) {
			instance = load();
		}
		return instance;
	}

	private static Path file() {
		return FabricLoader.getInstance().getConfigDir().resolve("halcyon-companion.json");
	}

	private static HalcyonConfig load() {
		Path path = file();
		if (Files.isRegularFile(path)) {
			try {
				String raw = Files.readString(path, StandardCharsets.UTF_8);
				HalcyonConfig parsed = GSON.fromJson(raw, HalcyonConfig.class);
				if (parsed != null) {
					return parsed;
				}
			} catch (IOException | RuntimeException error) {
				HalcyonCompanion.LOGGER.warn("Could not read the Halcyon config, using defaults", error);
			}
		}

		HalcyonConfig fresh = new HalcyonConfig();
		fresh.save();
		return fresh;
	}

	public void save() {
		try {
			Path path = file();
			Path parent = path.getParent();
			if (parent != null) {
				Files.createDirectories(parent);
			}
			Files.writeString(path, GSON.toJson(this), StandardCharsets.UTF_8);
		} catch (IOException error) {
			HalcyonCompanion.LOGGER.warn("Could not write the Halcyon config", error);
		}
	}

	/** Parses {@link #badgeColor}, falling back to the Halcyon accent. */
	public int badgeRgb() {
		String value = badgeColor == null ? "" : badgeColor.trim();
		if (value.startsWith("#")) {
			value = value.substring(1);
		}
		try {
			return Integer.parseInt(value, 16);
		} catch (NumberFormatException error) {
			return 0x8B7CF6;
		}
	}
}
