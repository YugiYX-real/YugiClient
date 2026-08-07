package gg.halcyon.companion;

import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.texture.NativeImageBackedTexture;
import net.minecraft.util.Identifier;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;

/**
 * Supplies the main menu background picture.
 *
 * <p>The owner's picture wins over everything else. It is fetched from the backend once per
 * session and kept at config/halcyon/menu-background.png inside the instance, so the menu shows it
 * again immediately on the next start and keeps showing it when the server is unreachable. A png
 * dropped at that path by hand works exactly the same way.
 *
 * <p>The painted scene is only a last resort for a fresh install that has never reached the
 * backend, because a flat fill or a stock Minecraft panorama is not what this menu is meant to
 * look like.
 */
public final class HalcyonMenuBackground {
	private static final Identifier TEXTURE_ID =
			Identifier.of("halcyon", "textures/gui/menu_background");

	/** Where the owner's picture is published, so one upload reaches every player. */
	private static final String REMOTE_PATH = "/v1/cosmetics/textures/menu-background.png";

	private static final HttpClient HTTP =
			HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

	private static boolean attempted;

	private static boolean fetched;

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
		fetch();
		return ready;
	}

	/** True when the picture came from the backend or from a file the player supplied. */
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
		fetched = false;
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

	/**
	 * Asks the backend for the owner's picture once per session.
	 *
	 * <p>This runs in the background and only replaces what is on screen once the bytes are in
	 * hand, so the menu is never left empty while the request is in flight.
	 */
	private static void fetch() {
		if (fetched) {
			return;
		}
		fetched = true;

		String base = HalcyonBackend.baseUrl();
		if (base == null) {
			return;
		}

		HttpRequest get;
		try {
			get = HttpRequest.newBuilder(URI.create(base + REMOTE_PATH))
					.timeout(Duration.ofSeconds(20))
					.header("accept", "image/png")
					.GET()
					.build();
		} catch (RuntimeException error) {
			return;
		}

		HTTP.sendAsync(get, HttpResponse.BodyHandlers.ofByteArray())
				.whenComplete((response, error) -> {
					if (error != null || response == null || response.statusCode() != 200) {
						return;
					}

					byte[] bytes = response.body();
					if (bytes == null || bytes.length == 0) {
						return;
					}

					MinecraftClient client = MinecraftClient.getInstance();
					if (client == null) {
						return;
					}
					client.execute(() -> adopt(client, bytes));
				});
	}

	/** Registers the downloaded picture and keeps a copy for the next start. */
	private static void adopt(MinecraftClient client, byte[] bytes) {
		try {
			register(client, NativeImage.read(new ByteArrayInputStream(bytes)), true);
		} catch (Exception error) {
			HalcyonCompanion.LOGGER.warn("The Halcyon menu background could not be read", error);
			return;
		}

		try {
			Path path = file();
			Path folder = path.getParent();
			if (folder != null) {
				Files.createDirectories(folder);
			}
			Files.write(path, bytes);
			HalcyonCompanion.LOGGER.info("Saved the Halcyon menu background to {}", path);
		} catch (Exception error) {
			HalcyonCompanion.LOGGER.debug("The Halcyon menu background could not be cached");
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
