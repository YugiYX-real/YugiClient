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

	/** Draw the Halcyon badge in front of the name of a Halcyon player. */
	public boolean badgeEnabled = true;

	/**
	 * Badge every player rather than only roster members.
	 *
	 * <p>Defaults to on because an unconfigured roster contains nobody but you, which would leave
	 * the badge invisible everywhere except your own player list entry.
	 */
	public boolean badgeAllPlayers = true;

	/** The glyph drawn in front of the name. */
	public String badgeText = "\u2726";

	/** Badge and accent colour as a hexadecimal RGB string. */
	public String badgeColor = "#8B7CF6";

	/** Optional plain roster endpoint that lists the players running Halcyon. */
	public String rosterUrl = "";

	/** Base address of the Halcyon backend, for example https://halcyon.example.com. */
	public String backendUrl = "";

	/** Optional shared secret expected by the backend. */
	public String backendKey = "";

	/** Pull the cosmetics the owner handed out and wear the chosen one. */
	public boolean cosmeticsEnabled = true;

	/** Id of the cape picked in the Halcyon cosmetics screen, empty means none. */
	public String equippedCape = "";

	/** Replace the vanilla resource reload screen with the Halcyon one. */
	public boolean splashEnabled = true;

	/** Replace the vanilla title screen with the Halcyon menu. */
	public boolean mainMenuBranding = true;

	/** Absolute path to a menu background image; empty means config/halcyon/menu-background.png. */
	public String menuBackground = "";

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
