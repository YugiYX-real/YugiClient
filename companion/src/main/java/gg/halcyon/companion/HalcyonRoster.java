package gg.halcyon.companion;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Knows which players are running Halcyon.
 *
 * <p>Two sources feed the roster: the local player is always a member, and an optional roster
 * endpoint can publish the wider community. Everything degrades to "only me" when the endpoint is
 * unset or unreachable, so the mod never blocks the game.
 */
public final class HalcyonRoster {
	private static final HalcyonRoster INSTANCE = new HalcyonRoster();

	private static final long REFRESH_INTERVAL_MS = 5L * 60L * 1000L;

	private final Set<String> members = ConcurrentHashMap.newKeySet();

	private final HttpClient http =
			HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

	private volatile long lastRefreshAt;

	private volatile boolean refreshing;

	private HalcyonRoster() {}

	public static HalcyonRoster get() {
		return INSTANCE;
	}

	public void add(String name) {
		if (name != null && !name.isBlank()) {
			members.add(normalise(name));
		}
	}

	public boolean isMember(String name) {
		if (name == null || name.isBlank()) {
			return false;
		}
		return members.contains(normalise(name));
	}

	private static String normalise(String name) {
		return name.trim().toLowerCase(Locale.ROOT);
	}

	/** Refreshes from the roster endpoint at most once every five minutes. */
	public void refreshIfStale() {
		String endpoint = HalcyonConfig.get().rosterUrl;
		if (endpoint == null || endpoint.isBlank() || refreshing) {
			return;
		}

		long now = System.currentTimeMillis();
		if (lastRefreshAt != 0L && now - lastRefreshAt < REFRESH_INTERVAL_MS) {
			return;
		}

		lastRefreshAt = now;
		refreshing = true;

		try {
			HttpRequest request = HttpRequest.newBuilder(URI.create(endpoint.trim()))
					.timeout(Duration.ofSeconds(15))
					.header("accept", "application/json")
					.GET()
					.build();

			http.sendAsync(request, HttpResponse.BodyHandlers.ofString())
					.whenComplete((response, error) -> {
						refreshing = false;
						if (error != null || response == null) {
							HalcyonCompanion.LOGGER.debug("The Halcyon roster could not be reached");
							return;
						}
						if (response.statusCode() < 200 || response.statusCode() >= 300) {
							HalcyonCompanion.LOGGER.debug(
									"The Halcyon roster answered with status {}", response.statusCode());
							return;
						}
						ingest(response.body());
					});
		} catch (IllegalArgumentException error) {
			refreshing = false;
			HalcyonCompanion.LOGGER.warn("The configured Halcyon roster address is not a valid url");
		}
	}

	/** Accepts either a bare array of names or objects carrying a name field. */
	private void ingest(String body) {
		try {
			JsonElement root = JsonParser.parseString(body);
			JsonArray entries;
			if (root.isJsonArray()) {
				entries = root.getAsJsonArray();
			} else if (root.isJsonObject() && root.getAsJsonObject().has("players")) {
				entries = root.getAsJsonObject().getAsJsonArray("players");
			} else {
				return;
			}

			int added = 0;
			for (JsonElement entry : entries) {
				if (entry.isJsonPrimitive()) {
					add(entry.getAsString());
					added++;
				} else if (entry.isJsonObject()) {
					JsonObject object = entry.getAsJsonObject();
					if (object.has("name")) {
						add(object.get("name").getAsString());
						added++;
					}
				}
			}

			HalcyonCompanion.LOGGER.info("Loaded {} Halcyon players from the roster", added);
		} catch (RuntimeException error) {
			HalcyonCompanion.LOGGER.debug("The Halcyon roster payload could not be parsed");
		}
	}
}
