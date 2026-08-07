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
 * <p>Any png dropped at config/halcyon/menu-background.png inside the instance wins, so a
 * screenshot can be used without rebuilding the mod. When there is no such file the scene painted
 * by {@link HalcyonMenuScene} is used, which means the menu always has a real background rather
 * than a flat fill. Either way the picture is built once per session.
 */
public final class HalcyonMenuBackground {
	private static final Identifier TEXTURE_ID =
			Identifier.of("halcyon", "textures/gui/menu_background");

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

	/** True when the picture came from a file the player supplied. */
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

		Path path = file();
		if (Files.isRegularFile(path)) {
			try (InputStream stream = Files.newInputStream(path)) {
				register(client, NativeImage.read(stream), true);
				HalcyonCompanion.LOGGER.info("Loaded the Halcyon menu background from {}", path);
				return;
			} catch (Exception error) {
				HalcyonCompanion.LOGGER.warn(
						"Could not load the Halcyon menu background, painting the default", error);
			}
		}

		try {
			register(client, HalcyonMenuScene.paint(), false);
			HalcyonCompanion.LOGGER.info("Painted the default Halcyon menu background");
		} catch (Exception error) {
			HalcyonCompanion.LOGGER.warn("Could not paint the default menu background", error);
		}
	}

	private static void register(MinecraftClient client, NativeImage image, boolean fromFile) {
		imageWidth = image.getWidth();
		imageHeight = image.getHeight();

		NativeImageBackedTexture texture =
				new NativeImageBackedTexture(() -> "halcyon-menu-background", image);
		client.getTextureManager().registerTexture(TEXTURE_ID, texture);

		ready = TEXTURE_ID;
		custom = fromFile;
	}
}
