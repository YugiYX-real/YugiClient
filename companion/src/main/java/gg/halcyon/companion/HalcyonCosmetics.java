package gg.halcyon.companion;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.texture.NativeImageBackedTexture;
import net.minecraft.util.Identifier;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Halcyon cosmetics.
 *
 * <p>The backend is the single source of truth: it decides which cosmetics exist and who owns
 * them, so a cape can only ever be worn after the owner handed it out. The client caches the
 * catalogue, downloads the pictures once and remembers the picked cape between sessions.
 */
public final class HalcyonCosmetics {
	/** One cape published by the owner. */
	public record Cape(String id, String name, String description, String rarity, String texture) {}

	private static final HalcyonCosmetics INSTANCE = new HalcyonCosmetics();

	private static final long INTERVAL_MS = 60L * 1000L;

	private final HttpClient http =
			HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

	private final ConcurrentHashMap<String, Identifier> textures = new ConcurrentHashMap<>();

	private final ConcurrentHashMap<String, int[]> sizes = new ConcurrentHashMap<>();

	private final Set<String> pending = ConcurrentHashMap.newKeySet();

	private volatile List<Cape> catalogue = List.of();

	private volatile Set<String> owned = Set.of();

	private volatile String equipped = "";

	private volatile String status = "";

	private volatile long lastSyncAt;

	private volatile boolean restored;

	private HalcyonCosmetics() {}

	public static HalcyonCosmetics get() {
		return INSTANCE;
	}

	/** The player name the backend knows, which works in the menu as well as in game. */
	public static String username(MinecraftClient client) {
		if (client == null) {
			return "";
		}
		if (client.player != null) {
			return client.player.getName().getString();
		}
		return client.getSession() == null ? "" : client.getSession().getUsername();
	}

	private void restore() {
		if (restored) {
			return;
		}
		restored = true;
		String saved = HalcyonConfig.get().equippedCape;
		equipped = saved == null ? "" : saved.trim();
	}

	/** Everything the owner published. */
	public List<Cape> catalogue() {
		return catalogue;
	}

	/** Only the capes this player was given. */
	public List<Cape> unlocked() {
		List<Cape> mine = new ArrayList<>();
		for (Cape cape : catalogue) {
			if (owned.contains(cape.id())) {
				mine.add(cape);
			}
		}
		return List.copyOf(mine);
	}

	public boolean isOwned(String id) {
		return id != null && owned.contains(id);
	}

	public String equippedId() {
		restore();
		return equipped;
	}

	/** A short line for the cosmetics screen, empty when everything is fine. */
	public String status() {
		return status;
	}

	public Cape find(String id) {
		for (Cape cape : catalogue) {
			if (cape.id().equals(id)) {
				return cape;
			}
		}
		return null;
	}

	/** Called every client tick, refreshes at most once a minute. */
	public void tick(MinecraftClient client) {
		restore();
		if (!HalcyonConfig.get().cosmeticsEnabled) {
			return;
		}

		long now = System.currentTimeMillis();
		if (lastSyncAt != 0L && now - lastSyncAt < INTERVAL_MS) {
			return;
		}
		refresh(client);
	}

	/** Pulls the catalogue and the unlocks for this player. Safe to call from a screen. */
	public void refresh(MinecraftClient client) {
		restore();
		String base = HalcyonBackend.baseUrl();
		if (base == null) {
			status = "No Halcyon backend is configured";
			return;
		}

		lastSyncAt = System.currentTimeMillis();
		try {
			fetchCatalogue(base);
			fetchProfile(base, username(client));
		} catch (RuntimeException error) {
			status = "The Halcyon backend address is not usable";
		}
	}

	/** Wears a cape, or takes it off when the id is empty. */
	public void equip(MinecraftClient client, String id) {
		String value = id == null ? "" : id.trim();
		if (!value.isEmpty() && !owned.contains(value)) {
			status = "That cape was not given to you";
			return;
		}

		remember(value);

		String base = HalcyonBackend.baseUrl();
		String name = username(client);
		if (base == null || name.isEmpty()) {
			return;
		}

		JsonObject payload = new JsonObject();
		payload.addProperty("name", name);
		payload.addProperty("slot", "cape");
		if (value.isEmpty()) {
			payload.add("id", com.google.gson.JsonNull.INSTANCE);
		} else {
			payload.addProperty("id", value);
		}

		HttpRequest post = request(base + "/v1/cosmetics/equip")
				.header("content-type", "application/json")
				.POST(HttpRequest.BodyPublishers.ofString(payload.toString()))
				.build();

		http.sendAsync(post, HttpResponse.BodyHandlers.ofString())
				.whenComplete((response, error) -> {
					if (error != null || response == null || response.statusCode() != 200) {
						status = "The choice could not be saved on the server";
						return;
					}
					status = "";
				});
	}

	/** The texture of the cape being worn, or null when there is none yet. */
	public Identifier capeTexture() {
		restore();
		if (!HalcyonConfig.get().cosmeticsEnabled || equipped.isEmpty()) {
			return null;
		}
		return texture(equipped);
	}

	/** The texture of one cosmetic, starting the download when it is not cached yet. */
	public Identifier texture(String id) {
		if (id == null || id.isEmpty()) {
			return null;
		}

		Identifier ready = textures.get(id);
		if (ready != null) {
			return ready;
		}

		Cape cape = find(id);
		if (cape != null) {
			download(cape);
		}
		return null;
	}

	public int textureWidth(String id) {
		int[] size = sizes.get(id);
		return size == null ? 64 : size[0];
	}

	public int textureHeight(String id) {
		int[] size = sizes.get(id);
		return size == null ? 32 : size[1];
	}

	private void remember(String value) {
		equipped = value;
		HalcyonConfig config = HalcyonConfig.get();
		config.equippedCape = value;
		config.save();
	}

	private HttpRequest.Builder request(String url) {
		HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url))
				.timeout(Duration.ofSeconds(20))
				.header("accept", "application/json");

		String key = HalcyonBackend.clientKey();
		if (!key.isEmpty()) {
			builder = builder.header("x-halcyon-key", key);
		}
		return builder;
	}

	private void fetchCatalogue(String base) {
		HttpRequest get = request(base + "/v1/cosmetics").GET().build();

		http.sendAsync(get, HttpResponse.BodyHandlers.ofString())
				.whenComplete((response, error) -> {
					if (error != null || response == null || response.statusCode() != 200) {
						status = "The cosmetics service could not be reached";
						return;
					}

					try {
						JsonElement root = JsonParser.parseString(response.body());
						if (!root.isJsonObject()) {
							return;
						}

						JsonArray array = root.getAsJsonObject().getAsJsonArray("cosmetics");
						if (array == null) {
							return;
						}

						List<Cape> parsed = new ArrayList<>();
						for (JsonElement element : array) {
							if (!element.isJsonObject()) {
								continue;
							}

							JsonObject entry = element.getAsJsonObject();
							String id = text(entry, "id");
							if (id.isEmpty()) {
								continue;
							}

							String name = text(entry, "name");
							parsed.add(new Cape(
									id,
									name.isEmpty() ? id : name,
									text(entry, "description"),
									text(entry, "rarity"),
									text(entry, "texture")));
						}

						catalogue = List.copyOf(parsed);
						status = "";
					} catch (RuntimeException parseError) {
						HalcyonCompanion.LOGGER.debug("The Halcyon cosmetics list could not be parsed");
					}
				});
	}

	private void fetchProfile(String base, String name) {
		if (name.isEmpty()) {
			return;
		}

		String url = base + "/v1/cosmetics/player/" + URLEncoder.encode(name, StandardCharsets.UTF_8);
		HttpRequest get = request(url).GET().build();

		http.sendAsync(get, HttpResponse.BodyHandlers.ofString())
				.whenComplete((response, error) -> {
					if (error != null || response == null || response.statusCode() != 200) {
						return;
					}

					try {
						JsonElement root = JsonParser.parseString(response.body());
						if (!root.isJsonObject()) {
							return;
						}

						JsonObject object = root.getAsJsonObject();
						Set<String> unlocked = new LinkedHashSet<>();
						JsonArray array = object.getAsJsonArray("owned");
						if (array != null) {
							for (JsonElement element : array) {
								if (!element.isJsonNull()) {
									unlocked.add(element.getAsString());
								}
							}
						}
						owned = Set.copyOf(unlocked);

						JsonObject worn = object.getAsJsonObject("equipped");
						String cape = worn == null ? "" : text(worn, "cape");
						if (!cape.isEmpty() && !cape.equals(equipped)) {
							remember(cape);
						} else if (!equipped.isEmpty() && !owned.contains(equipped)) {
							remember("");
						}
					} catch (RuntimeException parseError) {
						HalcyonCompanion.LOGGER.debug("The Halcyon unlock list could not be parsed");
					}
				});
	}

	private void download(Cape cape) {
		if (!pending.add(cape.id())) {
			return;
		}

		String url = address(cape.texture());
		if (url == null) {
			pending.remove(cape.id());
			return;
		}

		HttpRequest get = request(url).header("accept", "image/png").GET().build();
		http.sendAsync(get, HttpResponse.BodyHandlers.ofByteArray())
				.whenComplete((response, error) -> {
					if (error != null || response == null || response.statusCode() != 200) {
						pending.remove(cape.id());
						return;
					}

					MinecraftClient client = MinecraftClient.getInstance();
					if (client == null) {
						pending.remove(cape.id());
						return;
					}
					client.execute(() -> register(cape.id(), response.body()));
				});
	}

	/** Textures have to be handed to the texture manager on the render thread. */
	private void register(String id, byte[] bytes) {
		try {
			NativeImage image = NativeImage.read(new ByteArrayInputStream(bytes));
			Identifier identifier = Identifier.of("halcyon", "cosmetics/" + slug(id));
			NativeImageBackedTexture texture =
					new NativeImageBackedTexture(identifier::toString, image);

			MinecraftClient.getInstance().getTextureManager().registerTexture(identifier, texture);
			sizes.put(id, new int[] {image.getWidth(), image.getHeight()});
			textures.put(id, identifier);
		} catch (IOException | RuntimeException error) {
			HalcyonCompanion.LOGGER.warn("A Halcyon cape picture could not be read", error);
		} finally {
			pending.remove(id);
		}
	}

	/** Turns a stored texture path into an absolute address. */
	private static String address(String texture) {
		String value = texture == null ? "" : texture.trim();
		if (value.isEmpty()) {
			return null;
		}
		if (value.startsWith("https:") || value.startsWith("http:")) {
			return value;
		}

		String base = HalcyonBackend.baseUrl();
		if (base == null) {
			return null;
		}
		return value.startsWith("/") ? base + value : base + "/" + value;
	}

	private static String slug(String id) {
		StringBuilder builder = new StringBuilder();
		for (char letter : id.toLowerCase(Locale.ROOT).toCharArray()) {
			builder.append(Character.isLetterOrDigit(letter) || letter == '_' ? letter : '_');
		}
		String cleaned = builder.toString();
		return cleaned.isEmpty() ? "cape" : cleaned;
	}

	private static String text(JsonObject object, String key) {
		JsonElement value = object.get(key);
		return value == null || value.isJsonNull() ? "" : value.getAsString();
	}
}
