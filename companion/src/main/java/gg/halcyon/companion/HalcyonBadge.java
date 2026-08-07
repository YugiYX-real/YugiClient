package gg.halcyon.companion;

import net.minecraft.client.MinecraftClient;
import net.minecraft.text.MutableText;
import net.minecraft.text.Style;
import net.minecraft.text.Text;
import net.minecraft.text.TextColor;

import java.util.Locale;

/**
 * Prefixes the name of a Halcyon player with the client badge.
 *
 * <p>Three rules decide whether a name is decorated. Your own name always is, because otherwise the
 * badge would be invisible to the only person who wants to check that it works. Roster members are,
 * because that is the point of the badge. And when {@link HalcyonConfig#badgeAllPlayers} is set,
 * everybody is, which is the default until a roster endpoint is configured.
 */
public final class HalcyonBadge {
	private static final String FALLBACK_GLYPH = "\u2726";

	private HalcyonBadge() {}

	public static Text decorate(Text label) {
		if (label == null) {
			return label;
		}

		HalcyonConfig config = HalcyonConfig.get();
		if (!config.badgeEnabled) {
			return label;
		}

		String glyph =
				config.badgeText == null || config.badgeText.isBlank()
						? FALLBACK_GLYPH
						: config.badgeText;

		String plain = label.getString();

		// Render state labels are decorated every frame, so a decorated label must never be
		// decorated again or the badge stacks up in front of the name.
		if (plain.startsWith(glyph)) {
			return label;
		}

		if (!config.badgeAllPlayers && !isSelf(plain) && !HalcyonRoster.get().isMember(plain)) {
			return label;
		}

		Style style = Style.EMPTY.withColor(TextColor.fromRgb(config.badgeRgb())).withBold(true);
		MutableText badge = Text.literal(glyph + " ").setStyle(style);
		return Text.empty().append(badge).append(label);
	}

	/** True when the label belongs to the player sitting at this computer. */
	private static boolean isSelf(String plain) {
		MinecraftClient client = MinecraftClient.getInstance();
		if (client == null || client.player == null) {
			return false;
		}

		String self = client.player.getName().getString();
		if (self.isBlank()) {
			return false;
		}

		return plain.toLowerCase(Locale.ROOT).contains(self.toLowerCase(Locale.ROOT));
	}
}
