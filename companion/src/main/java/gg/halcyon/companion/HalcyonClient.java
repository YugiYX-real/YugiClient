package gg.halcyon.companion;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import net.minecraft.text.Text;
import org.lwjgl.glfw.GLFW;

/** Entrypoint for the client half of Halcyon. */
public final class HalcyonClient implements ClientModInitializer {
	private static KeyBinding toggleHud;

	private static KeyBinding toggleBadges;

	@Override
	public void onInitializeClient() {
		toggleHud = KeyBindingHelper.registerKeyBinding(new KeyBinding(
				"key.halcyon.toggleHud",
				InputUtil.Type.KEYSYM,
				GLFW.GLFW_KEY_RIGHT_SHIFT,
				"key.categories.halcyon"));

		toggleBadges = KeyBindingHelper.registerKeyBinding(new KeyBinding(
				"key.halcyon.toggleBadges",
				InputUtil.Type.KEYSYM,
				InputUtil.UNKNOWN_KEY.getCode(),
				"key.categories.halcyon"));

		HalcyonHud.register();
		ClientTickEvents.END_CLIENT_TICK.register(HalcyonClient::tick);

		HalcyonCompanion.LOGGER.info("The Halcyon companion is ready");
	}

	private static void tick(MinecraftClient client) {
		if (client.player != null) {
			HalcyonRoster.get().add(client.player.getGameProfile().getName());
			HalcyonRoster.get().refreshIfStale();
		}

		HalcyonConfig config = HalcyonConfig.get();

		while (toggleHud.wasPressed()) {
			config.hudEnabled = !config.hudEnabled;
			config.save();
			announce(client, config.hudEnabled ? "Halcyon overlay on" : "Halcyon overlay off");
		}

		while (toggleBadges.wasPressed()) {
			config.badgeEnabled = !config.badgeEnabled;
			config.save();
			announce(client, config.badgeEnabled ? "Halcyon badges on" : "Halcyon badges off");
		}
	}

	private static void announce(MinecraftClient client, String message) {
		if (client.player != null) {
			client.player.sendMessage(Text.literal(message), true);
		}
	}
}
