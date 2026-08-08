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
 * using the vanilla cape slot. Everything else is drawn here, placed per kind against the body.
 *
 * <p>Two rules keep a cosmetic looking attached rather than floating. It is anchored to a point on
 * the body rather than somewhere above it, and anything worn on the body only moves when the player
 * moves. A halo, an aura and a trail are the exceptions, because drifting on their own is the whole
 * point of them.
 */
public final class HalcyonCosmeticFeature
		extends FeatureRenderer<PlayerEntityRenderState, PlayerEntityModel> {
	private static final String[] SLOTS = {
		"back", "shield", "head", "halo", "face", "shoulder", "aura", "trail"
	};
	private static final int WHITE = 0xFFFFFFFF;
	private static final int FULL_BRIGHT = 0xF000F0;

	/** How long one drift takes for the kinds that are meant to float. */
	private static final long DRIFT_PERIOD_MS = 4200L;

	private static volatile WeakReference<Object> wearer = new WeakReference<>(null);

	private final HalcyonCosmeticModel model;

	public HalcyonCosmeticFeature(
			FeatureRendererContext<PlayerEntityRenderState, PlayerEntityModel> context) {
		super(context);
		this.model = HalcyonCosmeticModel.create(getContextModel()::getLayer);
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
			paint(matrices, queue, light, state, texture, kind, limbAngle, limbDistance);
		}
	}

	private void paint(
			MatrixStack matrices,
			OrderedRenderCommandQueue queue,
			int light,
			PlayerEntityRenderState state,
			Identifier texture,
			String kind,
			float limbAngle,
			float limbDistance) {
		float[] place = placement(kind);
		int brightness = glows(kind) ? FULL_BRIGHT : light;
		float liveliness = place[4];

		// Walking swings the piece; standing still leaves it alone. This is the whole difference
		// between wings that are worn and wings that hover.
		float stride = (float) Math.sin(limbAngle) * Math.min(1.0F, limbDistance);
		float drift = 0.0F;
		if (drifts(kind)) {
			long now = System.currentTimeMillis();
			drift =
					(float)
							Math.sin(
									(now % DRIFT_PERIOD_MS)
											/ (double) DRIFT_PERIOD_MS
											* Math.PI
											* 2.0);
		}

		int copies = Math.max(1, (int) place[5]);
		for (int copy = 0; copy < copies; copy++) {
			float side = copies == 1 ? 0.0F : (copy == 0 ? -1.0F : 1.0F);
			matrices.push();
			matrices.translate(
					place[0] + side * 6.0F,
					place[1] + drift * liveliness * 1.2F,
					place[2]);
			// A shoulder buddy sits to one side, so a pair is turned outwards. Everything else is
			// only turned by how much the player is actually moving.
			matrices.multiply(
					RotationAxis.POSITIVE_Y.rotationDegrees(
							side * 18.0F + (stride + drift * 0.4F) * liveliness * 9.0F));
			matrices.scale(place[3], place[3], place[3]);
			renderModel(model, texture, matrices, queue, brightness, state, WHITE, 0);
			matrices.pop();
		}
	}

	private static boolean glows(String kind) {
		return "halo".equals(kind) || "aura".equals(kind) || "trail".equals(kind);
	}

	/** The kinds that are supposed to move on their own, because they never touch the body. */
	private static boolean drifts(String kind) {
		return "halo".equals(kind) || "aura".equals(kind) || "trail".equals(kind);
	}

	/**
	 * Placement per cosmetic kind: x, y, z, scale, liveliness and how many copies to draw.
	 *
	 * <p>Entity model space is upside down, so a smaller y sits higher on the body, and z grows
	 * towards the player's back. The body runs from the neck at y 0 down to the hips at y 12, and its
	 * back is at z 2, which is why anything worn on the back starts just below zero rather than above
	 * it.
	 */
	private static float[] placement(String kind) {
		switch (kind) {
			case "hat":
				return new float[] {0.0F, -31.0F, 0.0F, 0.62F, 0.1F, 1.0F};
			case "halo":
				return new float[] {0.0F, -34.0F, 0.0F, 0.7F, 0.35F, 1.0F};
			case "mask":
				return new float[] {0.0F, -9.0F, -4.6F, 0.42F, 0.0F, 1.0F};
			case "shoulder":
				return new float[] {0.0F, -2.0F, 0.0F, 0.5F, 0.25F, 2.0F};
			case "aura":
				return new float[] {0.0F, 2.0F, 0.0F, 1.7F, 0.25F, 1.0F};
			case "trail":
				return new float[] {0.0F, 9.0F, 3.4F, 1.15F, 0.45F, 1.0F};
			case "backpack":
				return new float[] {0.0F, 1.0F, 2.4F, 0.7F, 0.1F, 1.0F};
			case "shield":
				// Strapped flat on the back, a little lower and smaller than wings.
				return new float[] {0.0F, 1.5F, 2.6F, 0.6F, 0.05F, 1.0F};
			default:
				// Wings, and anything new that lands on the back. Hung from just under the neck,
				// tight against the back, so the picture covers the shoulders and not the sky.
				return new float[] {0.0F, 1.0F, 2.2F, 0.9F, 0.35F, 1.0F};
		}
	}
}
