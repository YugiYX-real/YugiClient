package gg.halcyon.companion.mixin;

import gg.halcyon.companion.HalcyonBadge;
import net.minecraft.client.render.entity.EntityRenderer;
import net.minecraft.text.Text;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

/**
 * Rewrites the label an entity renderer is about to draw.
 *
 * <p>Only the text argument is touched, so the mixin stays compatible with the different label
 * signatures Mojang has shipped across 1.21 builds.
 */
@Mixin(EntityRenderer.class)
public abstract class EntityRendererMixin {
	@ModifyVariable(method = "renderLabelIfPresent", at = @At("HEAD"), argsOnly = true, index = 2)
	private Text halcyon$decorateLabel(Text label) {
		return HalcyonBadge.decorate(label);
	}
}
