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
 * Loads the main menu background picture.
 *
 * <p>Any png dropped at config/halcyon/menu-background.png inside the instance becomes the menu
 * background, so a screenshot can be used without rebuilding the mod. The file is read once per
 * session and a missing file simply means the painted gradient is used instead.
 */
public final class HalcyonMenuBackground {
	private static final Identifier TEXTURE_ID =
			Identifier.of("halcyon", "textures/gui/menu_background");

	private static boolean attempted;

	private static Identifier ready;

	private static int imageWidth;

	private static int imageHeight;

	private HalcyonMenuBackground() {}

	/** The registered texture, or null when no picture is available. */
	public static Identifier texture() {
		if (!attempted) {
			attempted = true;
			load();
		}
		return ready;
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
		Path path = file();
		if (!Files.isRegularFile(path)) {
			HalcyonCompanion.LOGGER.info("No Halcyon menu background at {}, painting the gradient", path);
			return;
		}

		MinecraftClient client = MinecraftClient.getInstance();
		if (client == null) {
			return;
		}

		try (InputStream stream = Files.newInputStream(path)) {
			NativeImage image = NativeImage.read(stream);
			imageWidth = image.getWidth();
			imageHeight = image.getHeight();

			NativeImageBackedTexture texture =
					new NativeImageBackedTexture(() -> "halcyon-menu-background", image);
			client.getTextureManager().registerTexture(TEXTURE_ID, texture);

			ready = TEXTURE_ID;
			HalcyonCompanion.LOGGER.info("Loaded the Halcyon menu background from {}", path);
		} catch (Exception error) {
			HalcyonCompanion.LOGGER.warn("Could not load the Halcyon menu background", error);
		}
	}
}
