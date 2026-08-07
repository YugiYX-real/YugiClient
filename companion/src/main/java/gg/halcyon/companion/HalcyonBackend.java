package gg.halcyon.companion;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.client.MinecraftClient;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/**
 * Talks to the Halcyon backend.
 *
 * <p>Every minute the client announces itself and pulls the list of players who are online right
 * now, which is what makes the badge mean something. Branding is pulled at the same time so the
 * menu message can be changed without shipping a new build. Every call is asynchronous and every
 * failure is silent by design: the backend going down must never affect the game.
 */
public final class HalcyonBackend {
	private static final HalcyonBackend INSTANCE = new HalcyonBackend();

	private static final long INTERVAL_MS = 60L * 1000L;

	private final HttpClient http =
			HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

	private volatile long lastSyncAt;

	private volatile boolean syncing;

	private volatile String menuMessage = "";

	private volatile int onlineCount;

	private HalcyonBackend() {}

	public static HalcyonBackend get() {
		return INSTANCE;
	}

	/** Message published by the backend, shown on the main menu when it is not empty. */
	public String menuMessage() {
		return menuMessage;
	}

	/** How many Halcyon players the backend reported as online. */
	public int onlineCount() {
		return onlineCount;
	}

	private static String base() {
		String configured = HalcyonConfig.get().backendUrl;
		if (configured == null || configured.isBlank()) {
			return null;
		}

		String trimmed = configured.trim();
		while (trimmed.endsWith("/")) {
			trimmed = trimmed.substring(0, trimmed.length() - 1);
		}
		return trimmed.isEmpty() ? null : trimmed;
	}

	public void tick(MinecraftClient client) {
		String base = base();
		if (base == null || syncing) {
			return;
		}

		long now = System.currentTimeMillis();
		if (lastSyncAt != 0L && now - lastSyncAt < INTERVAL_MS) {
			return;
		}

		lastSyncAt = now;
		syncing = true;

		try {
			if (client != null && client.player != null) {
				heartbeat(base, client.player.getName().getString());
			}
			roster(base);
			branding(base);
		} catch (RuntimeException error) {
			syncing = false;
			HalcyonCompanion.LOGGER.debug("The Halcyon backend address is not usable");
		}
	}

	private HttpRequest.Builder request(String url) {
		HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url))
				.timeout(Duration.ofSeconds(15))
				.header("accept", "application/json");

		String key = HalcyonConfig.get().backendKey;
		if (key != null && !key.isBlank()) {
			builder = builder.header("x-halcyon-key", key.trim());
		}
		return builder;
	}

	private void heartbeat(String base, String name) {
		JsonObject payload = new JsonObject();
		payload.addProperty("name", name);
		payload.addProperty("client", "halcyon");

		HttpRequest post = request(base + "/v1/heartbeat")
				.header("content-type", "application/json")
				.POST(HttpRequest.BodyPublishers.ofString(payload.toString()))
				.build();

		http.sendAsync(post, HttpResponse.BodyHandlers.discarding())
				.whenComplete((response, error) -> {
					if (error != null) {
						HalcyonCompanion.LOGGER.debug("The Halcyon backend heartbeat did not arrive");
					}
				});
	}

	private void roster(String base) {
		HttpRequest get = request(base + "/v1/roster").GET().build();

		http.sendAsync(get, HttpResponse.BodyHandlers.ofString())
				.whenComplete((response, error) -> {
					syncing = false;
					if (error != null || response == null || response.statusCode() != 200) {
						HalcyonCompanion.LOGGER.debug("The Halcyon backend roster is unavailable");
						return;
					}

					HalcyonRoster.get().ingest(response.body());
					onlineCount = HalcyonRoster.get().size();
				});
	}

	private void branding(String base) {
		HttpRequest get = request(base + "/v1/branding").GET().build();

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
						if (object.has("menuMessage")) {
							menuMessage = object.get("menuMessage").getAsString();
						}
						if (object.has("accentColor")) {
							HalcyonConfig.get().badgeColor = object.get("accentColor").getAsString();
						}
					} catch (RuntimeException parseError) {
						HalcyonCompanion.LOGGER.debug("The Halcyon branding payload could not be parsed");
					}
				});
	}
}
