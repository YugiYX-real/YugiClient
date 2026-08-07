package gg.halcyon.companion;

import net.minecraft.text.MutableText;
import net.minecraft.text.Style;
import net.minecraft.text.Text;
import net.minecraft.text.TextColor;

/**
 * Prefixes the nametag of a Halcyon player with the client badge.
 *
 * <p>By default only players in the roster are decorated, so vanilla players are never touched.
 * Because a player never sees their own nameplate, an empty roster means no badge is visible
 * anywhere; {@link HalcyonConfig#badgeAllPlayers} exists so the badge can be seen without a roster
 * endpoint being configured.
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

		String plain = label.getString();
		if (!config.badgeAllPlayers && !HalcyonRoster.get().isMember(plain)) {
			return label;
		}

		String glyph =
				config.badgeText == null || config.badgeText.isBlank()
						? FALLBACK_GLYPH
						: config.badgeText;

		Style style = Style.EMPTY.withColor(TextColor.fromRgb(config.badgeRgb())).withBold(true);
		MutableText badge = Text.literal(glyph + " ").setStyle(style);
		return Text.empty().append(badge).append(label);
	}
}
