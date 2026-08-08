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
 * <p>Wearing is one per kind. A cape, a pair of wings, a shield and a hat are all on the player at
 * the same time, and only a second cape takes the first one off. That is why what is worn is kept
 * keyed by the kind rather than by the place on the body: three different kinds hang off the back.
 *
 * <p>A cosmetic can carry a model as well as a picture. The model is the small list of boxes the
 * admin panel produced out of the uploaded file, and it is downloaded and kept here so the renderer
 * can build the piece that was actually drawn rather than a flat panel. Everything in it is measured
 * in model pixels, sixteen of which make a block.
 *
 * <p>How a piece is worn travels with it too: its size, a nudge up or down and off the back in model
 * pixels, how much it moves, whether a second mirrored copy is drawn and whether it glows. That is
 * what lets a pair of wings be fixed from the admin panel without shipping a new jar.
 *
 * <p>Something that moves is one tall png with its frames stacked in it and an animation mcmeta
 * beside it, which is the same pair Minecraft uses for its own animated textures. The record says
 * how many frames there are and how long each one lasts, and the picture is played by sliding a
 * window down the strip.
 */
public final class HalcyonCosmetics {
	/**
	 * One cosmetic published by the owner.
	 *
	 * <p>The name is historical: this still describes a cape as often as not, and keeping it means
	 * the render mixins do not have to change every time a new kind is added.
	 */
	public record Cape(String id, String name, String description, String rarity, String texture) {}

	/**
	 * Where each kind sits on the body. Two kinds may share a place, because they are worn together
	 * rather than instead of one another.
	 */
	private static final Map<String, String> SLOTS = Map.ofEntries(
			Map.entry("cape", "back"),
			Map.entry("wings", "wings"),
			Map.entry("backpack", "backpack"),
			Map.entry("shield", "shield"),
			Map.entry("hat", "head"),
			Map.entry("halo", "halo"),
			Map.entry("mask", "face"),
			Map.entry("shoulder", "shoulder"),
			Map.entry("aura", "aura"),
			Map.entry("trail", "trail"));

	/** Every kind, in the order the wardrobe lists them. */
	public static final List<String> KINDS = List.of(
			"cape",
			"wings",
			"backpack",
			"shield",
			"hat",
			"halo",
			"mask",
			"shoulder",
			"aura",
			"trail");

	private static final HalcyonCosmetics INSTANCE = new HalcyonCosmetics();

	private static final long INTERVAL_MS = 60L * 1000L;

	/** How long to leave a picture alone after a failed download. */
	private static final long RETRY_MS = 30L * 1000L;

	/** More boxes than this in one piece is a mistake rather than a model. */
	private static final int MAX_BOXES = 128;

	private final HttpClient http =
			HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

	/** One entry per frame, keyed by id and frame number. */
	private final ConcurrentHashMap<String, Identifier> textures = new ConcurrentHashMap<>();

	private final ConcurrentHashMap<String, int[]> sizes = new ConcurrentHashMap<>();

	private final ConcurrentHashMap<String, String> kinds = new ConcurrentHashMap<>();

	private final ConcurrentHashMap<String, int[]> animations = new ConcurrentHashMap<>();

	/** The addresses of the frame pictures, when an older build uploaded one file per frame. */
	private final ConcurrentHashMap<String, List<String>> frameUrls = new ConcurrentHashMap<>();

	/** The address of the model file of each cosmetic, empty when the piece is worn flat. */
	private final ConcurrentHashMap<String, String> modelUrls = new ConcurrentHashMap<>();

	/** The boxes of each cosmetic, once its model file has been read. */
	private final ConcurrentHashMap<String, HalcyonCosmeticModel.Shape> shapes =
			new ConcurrentHashMap<>();

	/** How each piece is worn: size, three nudges in model pixels, movement, mirroring, glow. */
	private final ConcurrentHashMap<String, float[]> geometry = new ConcurrentHashMap<>();

	private final ConcurrentHashMap<String, Long> retryAt = new ConcurrentHashMap<>();

	private final Set<String> pending = ConcurrentHashMap.newKeySet();

	/** What is worn, one id per kind. */
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

	/** The place on the body a kind of cosmetic sits. Unknown kinds hang off the back. */
	public static String slotFor(String kind) {
		String value = kind == null ? "" : kind.trim().toLowerCase(Locale.ROOT);
		return SLOTS.getOrDefault(value, "back");
	}

	/** True when this is a kind the client knows, rather than a place on the body. */
	public static boolean isKind(String value) {
		return value != null && SLOTS.containsKey(value.trim().toLowerCase(Locale.ROOT));
	}

	private void restore() {
		if (restored) {
			return;
		}
		restored = true;

		String saved = HalcyonConfig.get().equippedCape;
		String cape = saved == null ? "" : saved.trim();
		if (!cape.isEmpty()) {
			worn.put("cape", cape);
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
		return frames(id) > 1;
	}

	/** How many frames the picture has, one when it does not move. */
	public int frames(String id) {
		List<String> urls = frameUrls.get(id);
		if (urls != null && urls.size() > 1) {
			return urls.size();
		}

		int[] animation = animations.get(id);
		return animation == null ? 1 : Math.max(1, animation[0]);
	}

	public int frameMs(String id) {
		int[] animation = animations.get(id);
		return animation == null ? 100 : Math.max(20, animation[1]);
	}

	/** Which frame is showing right now. */
	public int frameAt(String id, long now) {
		int count = frames(id);
		if (count <= 1) {
			return 0;
		}
		return (int) ((now / frameMs(id)) % count);
	}

	/**
	 * True when the frames live inside one tall picture rather than in a file each, in which case
	 * playing it means sliding a window down the strip instead of swapping textures. Everything
	 * published with an mcmeta is this shape.
	 */
	public boolean isStrip(String id) {
		List<String> urls = frameUrls.get(id);
		boolean separate = urls != null && urls.size() > 1;
		return !separate && frames(id) > 1;
	}

	public boolean isOwned(String id) {
		return id != null && owned.contains(id);
	}

	/**
	 * The boxes this cosmetic is built from, or null when it is worn flat or the model has not been
	 * read yet. Asking for a model that has not arrived starts the download, so calling this every
	 * frame is the intended use.
	 */
	public HalcyonCosmeticModel.Shape shape(String id) {
		if (id == null || id.isEmpty()) {
			return null;
		}

		HalcyonCosmeticModel.Shape known = shapes.get(id);
		if (known != null) {
			return known;
		}

		String url = modelUrls.getOrDefault(id, "");
		if (!url.isEmpty()) {
			fetchModel(id, url);
		}
		return null;
	}

	/** True when a model was published for this cosmetic, whether or not it has arrived yet. */
	public boolean hasModel(String id) {
		return id != null && !modelUrls.getOrDefault(id, "").isEmpty();
	}

	/** How much bigger or smaller than drawn the piece is worn. */
	public float scaleOf(String id) {
		float value = geometryAt(id, 0, 1.0F);
		return value > 0.0F ? value : 1.0F;
	}

	/** Nudge sideways, in model pixels. */
	public float offsetXOf(String id) {
		return geometryAt(id, 1, 0.0F);
	}

	/** Nudge up or down, in model pixels. Larger is lower, as everywhere in model space. */
	public float offsetYOf(String id) {
		return geometryAt(id, 2, 0.0F);
	}

	/** Nudge off the back, in model pixels. */
	public float offsetZOf(String id) {
		return geometryAt(id, 3, 0.0F);
	}

	/** How much the piece moves while walking, or a negative number to leave it to the kind. */
	public float flapOf(String id) {
		return geometryAt(id, 4, -1.0F);
	}

	/** 1 to draw a second mirrored copy, 0 for one copy, -1 to leave it to the kind. */
	public int mirrorOf(String id) {
		return Math.round(geometryAt(id, 5, -1.0F));
	}

	/** 1 when the piece is lit in the dark, 0 when it is not, -1 to leave it to the kind. */
	public int glowOf(String id) {
		return Math.round(geometryAt(id, 6, -1.0F));
	}

	private float geometryAt(String id, int index, float fallback) {
		float[] values = id == null ? null : geometry.get(id);
		if (values == null || index >= values.length) {
			return fallback;
		}
		return values[index];
	}

	/** The cape being worn, kept as its own call because the vanilla cape slot asks for it. */
	public String equippedId() {
		restore();
		return worn.getOrDefault("cape", "");
	}

	/** What is worn of one kind, empty when nothing of that kind is on. */
	public String equippedOf(String kind) {
		restore();
		if (kind == null || kind.isEmpty()) {
			return "";
		}
		return worn.getOrDefault(kind.trim().toLowerCase(Locale.ROOT), "");
	}

	/**
	 * What is worn at one place on the body, for callers that still think in places. Several kinds
	 * can share a place now, so this answers with the first one found in wardrobe order.
	 */
	public String equippedIn(String slot) {
		restore();
		if (slot == null || slot.isEmpty()) {
			return "";
		}

		String place = slot.trim().toLowerCase(Locale.ROOT);
		for (String kind : KINDS) {
			String id = worn.getOrDefault(kind, "");
			if (!id.isEmpty() && slotFor(kind).equals(place)) {
				return id;
			}
		}
		return "";
	}

	/** Everything being worn right now, keyed by kind, in wardrobe order. */
	public Map<String, String> wornByKind() {
		restore();
		Map<String, String> snapshot = new LinkedHashMap<>();
		for (String kind : KINDS) {
			String id = worn.getOrDefault(kind, "");
			if (!id.isEmpty()) {
				snapshot.put(kind, id);
			}
		}
		return Map.copyOf(snapshot);
	}

	/** True when this exact cosmetic is being worn. */
	public boolean isWearing(String id) {
		return id != null && !id.isEmpty() && id.equals(equippedOf(kindOf(id)));
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
		equip(client, id, "");
	}

	/**
	 * Wears a cosmetic, or takes something off when the id is empty.
	 *
	 * <p>What is replaced is decided by the cosmetic itself: putting a cape on only ever takes the
	 * cape that was on off, so wings, a shield and a hat all stay where they are. The second argument
	 * only matters when taking something off, where it names the kind, or the place on the body when
	 * a whole place should be cleared.
	 */
	public void equip(MinecraftClient client, String id, String which) {
		String value = id == null ? "" : id.trim();
		String wanted = which == null ? "" : which.trim().toLowerCase(Locale.ROOT);
		if (!value.isEmpty() && !owned.contains(value)) {
			status = "That cosmetic was not given to you";
			return;
		}

		String sent;
		if (!value.isEmpty()) {
			sent = kindOf(value);
			remember(sent, value);
		} else if (isKind(wanted)) {
			sent = wanted;
			remember(sent, "");
		} else if (wanted.isEmpty()) {
			// Nothing named at all, which only ever meant the cape.
			sent = "cape";
			remember(sent, "");
		} else {
			// A place on the body, so everything worn there comes off.
			sent = wanted;
			for (String kind : KINDS) {
				if (slotFor(kind).equals(wanted)) {
					remember(kind, "");
				}
			}
		}

		String base = HalcyonBackend.baseUrl();
		String name = username(client);
		if (base == null || name.isEmpty()) {
			return;
		}

		JsonObject payload = new JsonObject();
		payload.addProperty("name", name);
		// The server takes either a kind or a place here, and works out the rest itself.
		payload.addProperty("slot", sent);
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

	/**
	 * The picture of one cosmetic as it should look right now, starting the download when it is not
	 * cached yet. An animation built from separate frames returns a different texture as the clock
	 * moves, which is what makes it play everywhere it is drawn.
	 */
	public Identifier texture(String id) {
		if (id == null || id.isEmpty()) {
			return null;
		}

		int index = isStrip(id) ? 0 : frameAt(id, System.currentTimeMillis());
		Identifier chosen = textures.get(key(id, index));
		if (chosen != null) {
			return chosen;
		}

		Cape cape = find(id);
		if (cape != null) {
			download(cape);
		}
		return textures.get(key(id, 0));
	}

	public int textureWidth(String id) {
		int[] size = sizes.get(id);
		return size == null ? 64 : size[0];
	}

	public int textureHeight(String id) {
		int[] size = sizes.get(id);
		return size == null ? 32 : size[1];
	}

	/** The height of one frame, which is the whole picture unless the frames share a strip. */
	public int frameHeight(String id) {
		if (!isStrip(id)) {
			return textureHeight(id);
		}
		return Math.max(1, textureHeight(id) / frames(id));
	}

	private void remember(String kind, String value) {
		if (value.isEmpty()) {
			worn.remove(kind);
		} else {
			worn.put(kind, value);
		}

		// Only the cape survives a restart on its own; everything else comes back from the
		// backend on the next refresh, which is the record that matters anyway.
		if (kind.equals("cape")) {
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
						Map<String, List<String>> parsedFrames = new LinkedHashMap<>();
						Map<String, String> parsedModels = new LinkedHashMap<>();
						Map<String, float[]> parsedGeometry = new LinkedHashMap<>();

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
							parsedKinds.put(id, isKind(kind) ? kind : "cape");

							// The model file the admin panel produced, and how the piece is worn.
							// Both travel with the record so a wing can be fixed from the panel.
							parsedModels.put(id, text(entry, "model"));
							parsedGeometry.put(
									id,
									new float[] {
										decimal(entry, "scale", 1.0F),
										decimal(entry, "offsetX", 0.0F),
										decimal(entry, "offsetY", 0.0F),
										decimal(entry, "offsetZ", 0.0F),
										decimal(entry, "flap", -1.0F),
										flag(entry, "mirror"),
										flag(entry, "glow")
									});

							List<String> urls = strings(entry, "frameTextures");
							parsedFrames.put(id, urls);

							// An mcmeta on the record is what makes something animated, and the
							// server counts the frames of the strip when it is published.
							boolean animated = bool(entry, "animated");
							int declared = number(entry, "frames", 1);
							int count = urls.size() > 1
									? urls.size()
									: (animated ? Math.max(2, declared) : 1);
							parsedAnimations.put(
									id, new int[] {count, Math.max(20, number(entry, "frameMs", 100))});
						}

						// A cosmetic whose frames changed has to drop the pictures it cached, or the
						// old animation would keep playing until the game restarts.
						for (Map.Entry<String, List<String>> fresh : parsedFrames.entrySet()) {
							List<String> previous = frameUrls.get(fresh.getKey());
							if (previous != null && !previous.equals(fresh.getValue())) {
								forget(fresh.getKey());
							}
						}

						// The same goes for a model that was published again under a new address.
						for (Map.Entry<String, String> fresh : parsedModels.entrySet()) {
							String previous = modelUrls.get(fresh.getKey());
							if (previous != null && !previous.equals(fresh.getValue())) {
								shapes.remove(fresh.getKey());
								retryAt.remove("model#" + fresh.getKey());
							}
						}

						catalogue = List.copyOf(parsed);
						kinds.keySet().retainAll(parsedKinds.keySet());
						kinds.putAll(parsedKinds);
						animations.keySet().retainAll(parsedAnimations.keySet());
						animations.putAll(parsedAnimations);
						frameUrls.keySet().retainAll(parsedFrames.keySet());
						frameUrls.putAll(parsedFrames);
						modelUrls.keySet().retainAll(parsedModels.keySet());
						modelUrls.putAll(parsedModels);
						geometry.keySet().retainAll(parsedGeometry.keySet());
						geometry.putAll(parsedGeometry);
						shapes.keySet().retainAll(parsedModels.keySet());
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

						// The server is the record of what this player wears everywhere, so it
						// replaces whatever is held here. What each id was filed under is
						// ignored: the kind of the cosmetic itself says where it belongs, which
						// is what makes this work against an older server too.
						JsonObject equipped = object.getAsJsonObject("equipped");
						if (equipped != null) {
							Map<String, String> fresh = new LinkedHashMap<>();
							for (String key : equipped.keySet()) {
								String id = text(equipped, key);
								if (!id.isEmpty() && owned.contains(id)) {
									fresh.put(kindOf(id), id);
								}
							}

							worn.keySet().retainAll(fresh.keySet());
							worn.putAll(fresh);

							HalcyonConfig config = HalcyonConfig.get();
							String cape = worn.getOrDefault("cape", "");
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

	/** Starts whatever pictures this cosmetic still needs. Safe to call on every frame. */
	private void download(Cape cape) {
		List<String> urls = frameUrls.getOrDefault(cape.id(), List.of());
		List<String> wanted =
				urls.isEmpty() ? List.of(cape.texture() == null ? "" : cape.texture()) : urls;

		for (int index = 0; index < wanted.size(); index++) {
			if (!textures.containsKey(key(cape.id(), index))) {
				fetchFrame(cape.id(), index, wanted.get(index));
			}
		}
	}

	/**
	 * Pulls the model file of one cosmetic.
	 *
	 * <p>This is plain json rather than a picture, so it does not need the render thread and is kept
	 * as soon as it arrives. A file that cannot be read is left alone for a while rather than asked
	 * for again on the next frame.
	 */
	private void fetchModel(String id, String model) {
		String slot = "model#" + id;
		Long wait = retryAt.get(slot);
		if (wait != null && System.currentTimeMillis() < wait) {
			return;
		}

		String url = address(model);
		if (url == null) {
			return;
		}
		if (!pending.add(slot)) {
			return;
		}

		HttpRequest get = request(url).GET().build();
		http.sendAsync(get, HttpResponse.BodyHandlers.ofString())
				.whenComplete((response, error) -> {
					try {
						if (error != null || response == null || response.statusCode() != 200) {
							retryAt.put(slot, System.currentTimeMillis() + RETRY_MS);
							return;
						}

						HalcyonCosmeticModel.Shape shape = parseShape(response.body());
						if (shape == null) {
							retryAt.put(slot, System.currentTimeMillis() + RETRY_MS);
							HalcyonCompanion.LOGGER.warn(
									"The model of the Halcyon cosmetic {} could not be read", id);
							return;
						}

						shapes.put(id, shape);
						retryAt.remove(slot);
					} finally {
						pending.remove(slot);
					}
				});
	}

	/** Reads the published model into boxes, or null when there is nothing usable in it. */
	private static HalcyonCosmeticModel.Shape parseShape(String body) {
		try {
			JsonElement root = JsonParser.parseString(body);
			if (!root.isJsonObject()) {
				return null;
			}

			JsonObject object = root.getAsJsonObject();
			JsonArray cubes = object.getAsJsonArray("cubes");
			if (cubes == null) {
				return null;
			}

			List<HalcyonCosmeticModel.Box> boxes = new ArrayList<>();
			for (JsonElement element : cubes) {
				if (!element.isJsonObject()) {
					continue;
				}

				JsonObject cube = element.getAsJsonObject();
				boxes.add(new HalcyonCosmeticModel.Box(
						text(cube, "name"),
						decimal(cube, "x", 0.0F),
						decimal(cube, "y", 0.0F),
						decimal(cube, "z", 0.0F),
						decimal(cube, "width", 0.0F),
						decimal(cube, "height", 0.0F),
						decimal(cube, "depth", 0.0F),
						decimal(cube, "u", 0.0F),
						decimal(cube, "v", 0.0F)));

				if (boxes.size() >= MAX_BOXES) {
					break;
				}
			}

			if (boxes.isEmpty()) {
				return null;
			}

			return new HalcyonCosmeticModel.Shape(
					Math.max(1, number(object, "textureWidth", 64)),
					Math.max(1, number(object, "textureHeight", 64)),
					List.copyOf(boxes));
		} catch (RuntimeException error) {
			return null;
		}
	}

	private void fetchFrame(String id, int index, String texture) {
		String slot = key(id, index);
		Long wait = retryAt.get(slot);
		if (wait != null && System.currentTimeMillis() < wait) {
			return;
		}

		String url = address(texture);
		if (url == null) {
			return;
		}
		if (!pending.add(slot)) {
			return;
		}

		HttpRequest get = request(url).header("accept", "image/png").GET().build();
		http.sendAsync(get, HttpResponse.BodyHandlers.ofByteArray())
				.whenComplete((response, error) -> {
					if (error != null || response == null || response.statusCode() != 200) {
						retryAt.put(slot, System.currentTimeMillis() + RETRY_MS);
						pending.remove(slot);
						return;
					}

					MinecraftClient client = MinecraftClient.getInstance();
					if (client == null) {
						pending.remove(slot);
						return;
					}
					client.execute(() -> register(id, index, response.body()));
				});
	}

	/** Textures have to be handed to the texture manager on the render thread. */
	private void register(String id, int index, byte[] bytes) {
		String slot = key(id, index);
		try {
			NativeImage image = NativeImage.read(new ByteArrayInputStream(bytes));
			Identifier identifier =
					Identifier.of("halcyon", "cosmetics/" + slug(id) + "_f" + index);
			NativeImageBackedTexture texture =
					new NativeImageBackedTexture(identifier::toString, image);

			MinecraftClient.getInstance().getTextureManager().registerTexture(identifier, texture);
			if (index == 0) {
				sizes.put(id, new int[] {image.getWidth(), image.getHeight()});
			}
			textures.put(slot, identifier);
			retryAt.remove(slot);
		} catch (IOException | RuntimeException error) {
			retryAt.put(slot, System.currentTimeMillis() + RETRY_MS);
			HalcyonCompanion.LOGGER.warn("A Halcyon cosmetic picture could not be read", error);
		} finally {
			pending.remove(slot);
		}
	}

	/** Drops the cached pictures of one cosmetic so they are pulled again. */
	private void forget(String id) {
		textures.keySet().removeIf(entry -> entry.startsWith(id + "#"));
		retryAt.keySet().removeIf(entry -> entry.startsWith(id + "#"));
		sizes.remove(id);
	}

	private static String key(String id, int index) {
		return id + "#" + index;
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

	private static List<String> strings(JsonObject object, String key) {
		JsonElement value = object.get(key);
		if (value == null || !value.isJsonArray()) {
			return List.of();
		}

		List<String> found = new ArrayList<>();
		for (JsonElement element : value.getAsJsonArray()) {
			if (element != null && element.isJsonPrimitive()) {
				String entry = element.getAsString().trim();
				if (!entry.isEmpty()) {
					found.add(entry);
				}
			}
		}
		return List.copyOf(found);
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

	/** A yes or no that can also be missing, which means "leave it to the kind". */
	private static float flag(JsonObject object, String key) {
		JsonElement value = object.get(key);
		if (value == null || value.isJsonNull() || !value.isJsonPrimitive()) {
			return -1.0F;
		}
		try {
			return value.getAsBoolean() ? 1.0F : 0.0F;
		} catch (RuntimeException error) {
			return -1.0F;
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

	private static float decimal(JsonObject object, String key, float fallback) {
		JsonElement value = object.get(key);
		if (value == null || value.isJsonNull() || !value.isJsonPrimitive()) {
			return fallback;
		}
		try {
			return value.getAsFloat();
		} catch (RuntimeException error) {
			return fallback;
		}
	}
}
