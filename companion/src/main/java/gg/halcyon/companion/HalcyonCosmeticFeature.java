package gg.halcyon.companion;

import java.lang.ref.WeakReference;
import net.minecraft.client.render.command.OrderedRenderCommandQueue;
import net.minecraft.client.render.entity.feature.FeatureRenderer;
import net.minecraft.client.render.entity.feature.FeatureRendererContext;
import net.minecraft.client.render.entity.model.PlayerEntityModel;
import net.minecraft.client.render.entity.state.PlayerEntityRenderState;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.RotationAxis;

/**
 * Draws every Halcyon cosmetic that is not a cape.
 *
 * <p>A cape is the one cosmetic the vanilla player model already knows how to wear, so capes keep
 * using the vanilla cape slot. Wings, hats, halos, masks, shoulder pieces, auras and trails are
 * square pictures instead, and forcing them through the cape slot is exactly what made them look
 * broken. They are drawn here on {@link HalcyonCosmeticModel}, placed per slot, lit per kind and
 * animated by asking {@link HalcyonCosmetics} for the current frame every time we paint.
 */
public final class HalcyonCosmeticFeature
		extends FeatureRenderer<PlayerEntityRenderState, PlayerEntityModel> {
	private static final String[] SLOTS = {
		"back", "head", "halo", "face", "shoulder", "aura", "trail"
	};
	private static final int WHITE = 0xFFFFFFFF;
	private static final int FULL_BRIGHT = 0xF000F0;
	private static final long SWAY_PERIOD_MS = 3200L;
	private static final long BOB_PERIOD_MS = 4800L;

	private static volatile WeakReference<Object> wearer = new WeakReference<>(null);

	private final HalcyonCosmeticModel model = HalcyonCosmeticModel.create();

	public HalcyonCosmeticFeature(
			FeatureRendererContext<PlayerEntityRenderState, PlayerEntityModel> context) {
		super(context);
	}

	/**
	 * Remembers which render state belongs to the account that owns the cosmetics. The renderer only
	 * receives render states, so the mixin that already looks at the entity marks it for us.
	 */
	public static void mark(Object state) {
		wearer = new WeakReference<>(state);
	}

	private static boolean wears(Object state) {
		return wearer.get() == state;
	}

	@Override
	public void render(
			MatrixStack matrices,
			OrderedRenderCommandQueue queue,
			int light,
			PlayerEntityRenderState state,
			float limbAngle,
			float limbDistance) {
		if (!wears(state)) {
			return;
		}

		HalcyonCosmetics cosmetics = HalcyonCosmetics.get();
		for (String slot : SLOTS) {
			String id = cosmetics.equippedIn(slot);
			if (id == null || id.isEmpty()) {
				continue;
			}
			String kind = cosmetics.kindOf(id);
			if ("cape".equals(kind)) {
				continue;
			}
			Identifier texture = cosmetics.texture(id);
			if (texture == null) {
				continue;
			}
			paint(matrices, queue, light, state, texture, kind);
		}
	}

	private void paint(
			MatrixStack matrices,
			OrderedRenderCommandQueue queue,
			int light,
			PlayerEntityRenderState state,
			Identifier texture,
			String kind) {
		float[] place = placement(kind);
		int brightness = glows(kind) ? FULL_BRIGHT : light;
		long now = System.currentTimeMillis();
		float sway =
				(float) Math.sin((now % SWAY_PERIOD_MS) / (double) SWAY_PERIOD_MS * Math.PI * 2.0);
		float bob = (float) Math.sin((now % BOB_PERIOD_MS) / (double) BOB_PERIOD_MS * Math.PI * 2.0);
		int copies = Math.max(1, (int) place[5]);
		for (int copy = 0; copy < copies; copy++) {
			float side = copies == 1 ? 0.0F : (copy == 0 ? -1.0F : 1.0F);
			matrices.push();
			matrices.translate(
					place[0] + side * 6.0F, place[1] + bob * place[4] * 1.5F, place[2]);
			matrices.multiply(
					RotationAxis.POSITIVE_Y.rotationDegrees(
							side * 22.0F + sway * place[4] * 12.0F));
			matrices.scale(place[3], place[3], place[3]);
			renderModel(model, texture, matrices, queue, brightness, state, WHITE, 0);
			matrices.pop();
		}
	}

	private static boolean glows(String kind) {
		return "halo".equals(kind) || "aura".equals(kind) || "trail".equals(kind);
	}

	/**
	 * Placement per cosmetic kind: x, y, z, scale, liveliness and how many copies to draw. Entity
	 * model space is upside down, so a smaller y sits higher on the body, and z grows towards the
	 * player's back.
	 */
	private static float[] placement(String kind) {
		switch (kind) {
			case "hat":
				return new float[] {0.0F, -31.0F, 0.0F, 0.62F, 0.15F, 1.0F};
			case "halo":
				return new float[] {0.0F, -34.0F, 0.0F, 0.7F, 0.35F, 1.0F};
			case "mask":
				return new float[] {0.0F, -9.0F, -4.6F, 0.42F, 0.0F, 1.0F};
			case "shoulder":
				return new float[] {0.0F, -3.0F, 0.0F, 0.5F, 0.3F, 2.0F};
			case "aura":
				return new float[] {0.0F, 2.0F, 0.0F, 1.7F, 0.25F, 1.0F};
			case "trail":
				return new float[] {0.0F, 9.0F, 3.4F, 1.15F, 0.45F, 1.0F};
			case "backpack":
				return new float[] {0.0F, 0.0F, 2.6F, 0.7F, 0.15F, 1.0F};
			default:
				return new float[] {0.0F, -3.0F, 2.6F, 1.0F, 0.6F, 1.0F};
		}
	}
}
