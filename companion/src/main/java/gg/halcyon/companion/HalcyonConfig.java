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

	/**
	 * The official Halcyon backend.
	 *
	 * <p>This is a default rather than an empty string on purpose: a mod that ships with no address
	 * reports "no backend configured" in the corner and shows nobody their cosmetics, which is
	 * exactly the state every fresh instance used to start in. The launcher overwrites this per
	 * instance, and anybody self hosting can point it somewhere else.
	 */
	public static final String DEFAULT_BACKEND = "http://85.215.223.254:8787";

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

	/** Base address of the Halcyon backend. Empty falls back to {@link #DEFAULT_BACKEND}. */
	public String backendUrl = DEFAULT_BACKEND;

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
					parsed.migrate();
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

	/**
	 * Repairs a config written by an older build. Instances created before the backend shipped hold
	 * an empty address, and leaving it empty is never what the player wanted.
	 */
	private void migrate() {
		boolean changed = false;
		if (backendUrl == null || backendUrl.isBlank()) {
			backendUrl = DEFAULT_BACKEND;
			changed = true;
		}
		if (badgeText == null || badgeText.isBlank()) {
			badgeText = "\u2726";
			changed = true;
		}
		if (badgeColor == null || badgeColor.isBlank()) {
			badgeColor = "#8B7CF6";
			changed = true;
		}
		if (changed) {
			save();
		}
	}

	/** The address to call, never blank. */
	public String backend() {
		return backendUrl == null || backendUrl.isBlank() ? DEFAULT_BACKEND : backendUrl.trim();
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
