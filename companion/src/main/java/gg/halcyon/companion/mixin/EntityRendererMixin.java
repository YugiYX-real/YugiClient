package gg.halcyon.companion.mixin;

import gg.halcyon.companion.HalcyonBadge;
import net.minecraft.client.render.command.OrderedRenderCommandQueue;
import net.minecraft.client.render.entity.EntityRenderer;
import net.minecraft.client.render.entity.state.EntityRenderState;
import net.minecraft.client.render.state.CameraRenderState;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.text.Text;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Prefixes the Halcyon badge onto player nameplates.
 *
 * <p>Since 1.21.11 the label text is no longer passed to the renderer as an argument; it is carried
 * on the render state, which the game rebuilds from the entity every frame. Decorating the state at
 * the head of the draw call therefore cannot accumulate badges over time.
 */
@Mixin(EntityRenderer.class)
public abstract class EntityRendererMixin {
	@Inject(method = "renderLabelIfPresent", at = @At("HEAD"))
	private void halcyon$decorateLabel(
			EntityRenderState state,
			MatrixStack matrices,
			OrderedRenderCommandQueue queue,
			CameraRenderState cameraRenderState,
			CallbackInfo info) {
		Text label = state.displayName;
		if (label == null) {
			return;
		}

		Text decorated = HalcyonBadge.decorate(label);
		if (decorated != label) {
			state.displayName = decorated;
		}
	}
}
