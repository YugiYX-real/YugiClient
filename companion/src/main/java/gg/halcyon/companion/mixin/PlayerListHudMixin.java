package gg.halcyon.companion.mixin;

import gg.halcyon.companion.HalcyonBadge;
import net.minecraft.client.gui.hud.PlayerListHud;
import net.minecraft.client.network.PlayerListEntry;
import net.minecraft.text.Text;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * Badges names in the player list.
 *
 * <p>A player never sees their own nameplate above their head, so the tab list is the only place
 * where you can confirm that your own badge is working.
 */
@Mixin(PlayerListHud.class)
public abstract class PlayerListHudMixin {
	@Inject(method = "getPlayerName", at = @At("RETURN"), cancellable = true)
	private void halcyon$decorateTabName(
			PlayerListEntry entry, CallbackInfoReturnable<Text> info) {
		Text name = info.getReturnValue();
		if (name == null) {
			return;
		}

		Text decorated = HalcyonBadge.decorate(name);
		if (decorated != name) {
			info.setReturnValue(decorated);
		}
	}
}
