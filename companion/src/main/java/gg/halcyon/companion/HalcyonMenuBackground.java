package gg.halcyon.companion;

import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.texture.NativeImageBackedTexture;
import net.minecraft.util.Identifier;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Supplies the main menu background picture.
 *
 * <p>The launcher's own picture is built into the jar from assets/menu-background.png, so it is
 * simply there on a fresh install with nothing to download, publish or copy. A player who wants a
 * different menu can point the config at a file or drop a png at config/halcyon/menu-background.png,
 * and that wins. The painted scene only appears if the jar was somehow built without the picture.
 */
public final class HalcyonMenuBackground {
	private static final Identifier TEXTURE_ID =
			Identifier.of("halcyon", "textures/gui/menu_background");

	/** The picture copied into the jar by the build. */
	private static final String BUNDLED = "/assets/halcyon/textures/gui/menu_background.png";

	private static boolean attempted;

	private static Identifier ready;

	private static boolean custom;

	private static int imageWidth;

	private static int imageHeight;

	private HalcyonMenuBackground() {}

	/** The registered texture, or null when even the painted scene could not be built. */
	public static Identifier texture() {
		if (!attempted) {
			attempted = true;
			load();
		}
		return ready;
	}

	/** True when a real picture is on screen rather than the painted fallback. */
	public static boolean isCustom() {
		return custom;
	}

	public static int imageWidth() {
		return imageWidth;
	}

	public static int imageHeight() {
		return imageHeight;
	}

	/** Forgets the loaded picture so the next menu picks up a replaced file. */
	public static void reload() {
		attempted = false;
		ready = null;
		custom = false;
	}

	/** The optional player override, either a configured path or the instance config folder. */
	private static Path file() {
		String configured = HalcyonConfig.get().menuBackground;
		if (configured != null && !configured.isBlank()) {
			return Path.of(configured.trim());
		}
		return FabricLoader.getInstance()
				.getConfigDir()
				.resolve("halcyon")
				.resolve("menu-background.png");
	}

	private static void load() {
		MinecraftClient client = MinecraftClient.getInstance();
		if (client == null) {
			return;
		}

		if (fromOverride(client) || fromJar(client)) {
			return;
		}

		try {
			register(client, HalcyonMenuScene.paint(), false);
			HalcyonCompanion.LOGGER.info("Painted the fallback Halcyon menu background");
		} catch (Exception error) {
			HalcyonCompanion.LOGGER.warn("Could not paint the fallback menu background", error);
		}
	}

	/** Loads a picture the player put in place, which always outranks the bundled one. */
	private static boolean fromOverride(MinecraftClient client) {
		Path path = file();
		if (!Files.isRegularFile(path)) {
			return false;
		}

		try (InputStream stream = Files.newInputStream(path)) {
			register(client, NativeImage.read(stream), true);
			HalcyonCompanion.LOGGER.info("Loaded the Halcyon menu background from {}", path);
			return true;
		} catch (Exception error) {
			HalcyonCompanion.LOGGER.warn(
					"Could not read the menu background at " + path + ", using the built in one",
					error);
			return false;
		}
	}

	/** Loads the picture the build copied into the jar. This is the normal case. */
	private static boolean fromJar(MinecraftClient client) {
		try (InputStream stream = HalcyonMenuBackground.class.getResourceAsStream(BUNDLED)) {
			if (stream == null) {
				HalcyonCompanion.LOGGER.warn("The Halcyon menu background is missing from the jar");
				return false;
			}

			register(client, NativeImage.read(stream), true);
			HalcyonCompanion.LOGGER.info("Loaded the built in Halcyon menu background");
			return true;
		} catch (Exception error) {
			HalcyonCompanion.LOGGER.warn("Could not read the built in menu background", error);
			return false;
		}
	}

	private static void register(MinecraftClient client, NativeImage image, boolean real) {
		imageWidth = image.getWidth();
		imageHeight = image.getHeight();

		NativeImageBackedTexture texture =
				new NativeImageBackedTexture(() -> "halcyon-menu-background", image);
		client.getTextureManager().registerTexture(TEXTURE_ID, texture);

		ready = TEXTURE_ID;
		custom = real;
	}
}
