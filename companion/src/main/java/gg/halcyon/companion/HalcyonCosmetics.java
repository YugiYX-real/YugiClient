package gg.halcyon.companion;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
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
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Halcyon cosmetics.
 *
 * <p>The backend is the single source of truth: it decides which cosmetics exist and who owns
 * them, so a cape can only ever be worn after the owner handed it out. The client caches the
 * catalogue, downloads the pictures once and remembers what is worn between sessions.
 *
 * <p>A cosmetic is more than a cape now. Every entry carries a kind, which decides both the tab it
 * appears under in game and the slot it occupies, so wings and a hat can be worn at the same time
 * while two capes cannot. Entries can also be animated, in which case the picture is a single tall
 * strip of frames played on a loop.
 */
public final class HalcyonCosmetics {
	/**
	 * One cosmetic published by the owner.
	 *
	 * <p>The name is historical: this still describes a cape as often as not, and keeping it means
	 * the render mixins do not have to change every time a new kind is added.
	 */
	public record Cape(String id, String name, String description, String rarity, String texture) {}

	/** The slot a kind takes up, so one of each can be worn at a time. */
	private static final Map<String, String> SLOTS = Map.of(
			"cape", "back",
			"wings", "back",
			"backpack", "back",
			"hat", "head",
			"halo", "halo",
			"mask", "face",
			"shoulder", "shoulder",
			"aura", "aura",
			"trail", "trail");

	private static final HalcyonCosmetics INSTANCE = new HalcyonCosmetics();

	private static final long INTERVAL_MS = 60L * 1000L;

	private final HttpClient http =
			HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

	private final ConcurrentHashMap<String, Identifier> textures = new ConcurrentHashMap<>();

	private final ConcurrentHashMap<String, int[]> sizes = new ConcurrentHashMap<>();

	private final ConcurrentHashMap<String, String> kinds = new ConcurrentHashMap<>();

	private final ConcurrentHashMap<String, int[]> animations = new ConcurrentHashMap<>();

	private final Set<String> pending = ConcurrentHashMap.newKeySet();

	/** What is worn, one id per slot. */
	private final Map<String, String> worn = new ConcurrentHashMap<>();

	private volatile List<Cape> catalogue = List.of();

	private volatile Set<String> owned = Set.of();

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

	/** The slot a kind of cosmetic occupies. Unknown kinds hang off the back. */
	public static String slotFor(String kind) {
		String value = kind == null ? "" : kind.trim().toLowerCase(Locale.ROOT);
		return SLOTS.getOrDefault(value, "back");
	}

	private void restore() {
		if (restored) {
			return;
		}
		restored = true;

		String saved = HalcyonConfig.get().equippedCape;
		String cape = saved == null ? "" : saved.trim();
		if (!cape.isEmpty()) {
			worn.put("back", cape);
		}
	}

	/** Everything the owner published. */
	public List<Cape> catalogue() {
		return catalogue;
	}

	/** Only the cosmetics this player was given. */
	public List<Cape> unlocked() {
		List<Cape> mine = new ArrayList<>();
		for (Cape cape : catalogue) {
			if (owned.contains(cape.id())) {
				mine.add(cape);
			}
		}
		return List.copyOf(mine);
	}

	/** The unlocked cosmetics of one kind, or all of them when the kind is empty. */
	public List<Cape> unlocked(String kind) {
		if (kind == null || kind.isEmpty()) {
			return unlocked();
		}

		List<Cape> mine = new ArrayList<>();
		for (Cape cape : unlocked()) {
			if (kindOf(cape.id()).equals(kind)) {
				mine.add(cape);
			}
		}
		return List.copyOf(mine);
	}

	/** The kinds this player actually owns something of, in catalogue order. */
	public List<String> kinds() {
		Set<String> found = new LinkedHashSet<>();
		for (Cape cape : unlocked()) {
			found.add(kindOf(cape.id()));
		}
		return List.copyOf(found);
	}

	public String kindOf(String id) {
		return kinds.getOrDefault(id, "cape");
	}

	public String slotOf(String id) {
		return slotFor(kindOf(id));
	}

	public boolean isAnimated(String id) {
		int[] animation = animations.get(id);
		return animation != null && animation[0] > 1;
	}

	public int frames(String id) {
		int[] animation = animations.get(id);
		return animation == null ? 1 : Math.max(1, animation[0]);
	}

	public int frameMs(String id) {
		int[] animation = animations.get(id);
		return animation == null ? 100 : Math.max(20, animation[1]);
	}

	/** Which frame of an animated picture is showing right now. */
	public int frameAt(String id, long now) {
		int count = frames(id);
		if (count <= 1) {
			return 0;
		}
		return (int) ((now / frameMs(id)) % count);
	}

	public boolean isOwned(String id) {
		return id != null && owned.contains(id);
	}

	/** The cape being worn, kept as its own call because the render mixins ask for it. */
	public String equippedId() {
		restore();
		return worn.getOrDefault("back", "");
	}

	/** What is worn in one slot, empty when the slot is free. */
	public String equippedIn(String slot) {
		restore();
		return worn.getOrDefault(slot, "");
	}

	/** True when this exact cosmetic is being worn. */
	public boolean isWearing(String id) {
		return id != null && !id.isEmpty() && id.equals(equippedIn(slotOf(id)));
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

	/** Wears a cosmetic, or takes it off when the id is empty. */
	public void equip(MinecraftClient client, String id) {
		String value = id == null ? "" : id.trim();
		equip(client, value, value.isEmpty() ? "back" : slotOf(value));
	}

	/** Wears a cosmetic in one slot, or empties that slot when the id is empty. */
	public void equip(MinecraftClient client, String id, String slot) {
		String value = id == null ? "" : id.trim();
		String target = slot == null || slot.isEmpty() ? "back" : slot;
		if (!value.isEmpty() && !owned.contains(value)) {
			status = "That cosmetic was not given to you";
			return;
		}

		remember(target, value);

		String base = HalcyonBackend.baseUrl();
		String name = username(client);
		if (base == null || name.isEmpty()) {
			return;
		}

		JsonObject payload = new JsonObject();
		payload.addProperty("name", name);
		payload.addProperty("slot", target);
		if (value.isEmpty()) {
			payload.add("id", JsonNull.INSTANCE);
		} else {
			payload.addProperty("id", value);
		}

		HttpRequest post = request(base + "/v1/cosmetics/equip")
				.header("content-type", "application/json")
				.POST(HttpRequest.BodyPublishers.ofString(payload.toString()))
				.build();

		http.sendAsync(post, HttpResponse.BodyHandlers.ofString())
				.whenComplete((response, error) -> {
					if (error != null || response == null) {
						status = "The Halcyon server could not be reached";
						return;
					}
					if (response.statusCode() == 401) {
						// The server has a client key and this instance does not, which is worth
						// saying plainly rather than hiding behind a generic failure.
						status = "The server refused the client key in halcyon-companion.json";
						return;
					}
					if (response.statusCode() != 200) {
						status = "The choice could not be saved on the server";
						return;
					}
					status = "";
				});
	}

	/** The texture of the cape being worn, or null when there is none yet. */
	public Identifier capeTexture() {
		restore();
		String cape = equippedId();
		if (!HalcyonConfig.get().cosmeticsEnabled || cape.isEmpty()) {
			return null;
		}
		return texture(cape);
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

	/** The height of a single frame, which is the whole picture when it is not animated. */
	public int frameHeight(String id) {
		return Math.max(1, textureHeight(id) / frames(id));
	}

	private void remember(String slot, String value) {
		if (value.isEmpty()) {
			worn.remove(slot);
		} else {
			worn.put(slot, value);
		}

		// Only the cape survives a restart on its own; everything else comes back from the
		// backend on the next refresh, which is the record that matters anyway.
		if (slot.equals("back")) {
			HalcyonConfig config = HalcyonConfig.get();
			config.equippedCape = value;
			config.save();
		}
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
						Map<String, String> parsedKinds = new LinkedHashMap<>();
						Map<String, int[]> parsedAnimations = new LinkedHashMap<>();

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

							String kind = text(entry, "type");
							parsedKinds.put(id, kind.isEmpty() ? "cape" : kind);

							boolean animated = bool(entry, "animated");
							int frames = number(entry, "frames", 1);
							int frameMs = number(entry, "frameMs", 100);
							parsedAnimations.put(
									id,
									new int[] {animated ? Math.max(2, frames) : 1, Math.max(20, frameMs)});
						}

						catalogue = List.copyOf(parsed);
						kinds.keySet().retainAll(parsedKinds.keySet());
						kinds.putAll(parsedKinds);
						animations.keySet().retainAll(parsedAnimations.keySet());
						animations.putAll(parsedAnimations);
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

						// The server keeps one id per slot, and it is the record of what this
						// player is wearing everywhere, so it replaces whatever is held here.
						JsonObject equipped = object.getAsJsonObject("equipped");
						if (equipped != null) {
							for (String slot : List.copyOf(worn.keySet())) {
								if (!equipped.has(slot)) {
									worn.remove(slot);
								}
							}
							for (String slot : equipped.keySet()) {
								String id = text(equipped, slot);
								if (id.isEmpty() || !owned.contains(id)) {
									worn.remove(slot);
								} else {
									worn.put(slot, id);
								}
							}

							HalcyonConfig config = HalcyonConfig.get();
							String cape = worn.getOrDefault("back", "");
							if (!cape.equals(config.equippedCape)) {
								config.equippedCape = cape;
								config.save();
							}
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
			HalcyonCompanion.LOGGER.warn("A Halcyon cosmetic picture could not be read", error);
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
		return cleaned.isEmpty() ? "cosmetic" : cleaned;
	}

	private static String text(JsonObject object, String key) {
		JsonElement value = object.get(key);
		if (value == null || value.isJsonNull() || !value.isJsonPrimitive()) {
			return "";
		}
		return value.getAsString();
	}

	private static boolean bool(JsonObject object, String key) {
		JsonElement value = object.get(key);
		if (value == null || value.isJsonNull() || !value.isJsonPrimitive()) {
			return false;
		}
		try {
			return value.getAsBoolean();
		} catch (RuntimeException error) {
			return false;
		}
	}

	private static int number(JsonObject object, String key, int fallback) {
		JsonElement value = object.get(key);
		if (value == null || value.isJsonNull() || !value.isJsonPrimitive()) {
			return fallback;
		}
		try {
			return value.getAsInt();
		} catch (RuntimeException error) {
			return fallback;
		}
	}
}
