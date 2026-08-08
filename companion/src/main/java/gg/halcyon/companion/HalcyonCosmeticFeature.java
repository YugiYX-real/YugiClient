package gg.halcyon.companion;

import java.lang.ref.WeakReference;
import java.util.HashMap;
import java.util.Map;
import net.minecraft.client.model.ModelPart;
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
 * using the vanilla cape slot and are skipped here. Everything else is drawn per kind against the
 * body, and one of every kind is worn at a time, so a pair of wings and a shield and a hat are all
 * drawn on the same player.
 *
 * <p><b>Units.</b> There are two of them here and mixing them up is what made wings appear tiny,
 * below the ground and a long way behind the player. The matrix a feature renderer is handed is
 * measured in blocks: one whole step of it is a metre. The boxes of a model are measured in model
 * pixels, sixteen to a block, because a model part divides them by sixteen itself. Every number in
 * this file is written in model pixels, and {@link #PIXEL} is the only place they are turned into
 * what the matrix wants. Vanilla does the same thing when it puts a cape two pixels off the back,
 * which it writes as 0.125.
 *
 * <p><b>Where it hangs.</b> A cosmetic is attached to the part of the player it belongs to rather
 * than to the player as a whole. A hat, a halo and a mask ride the head, so they turn and tilt when
 * the player looks around; everything else rides the torso, so it leans over when the player sneaks
 * or swims instead of staying bolt upright in the air behind them. This is what vanilla does with a
 * cape and an elytra, and it is the difference between a piece that is worn and a piece that
 * follows the player around.
 *
 * <p><b>Shape.</b> A cosmetic published with a model is built out of exactly the boxes that were
 * drawn for it. A piece that never had a model is drawn as a flat panel. A piece that has a model
 * which has not been downloaded yet is not drawn at all for the moment: showing the picture
 * stretched over a square instead is what looks like a broken texture floating near the player,
 * and it is better to show nothing for the half second the file takes to arrive.
 */
public final class HalcyonCosmeticFeature
		extends FeatureRenderer<PlayerEntityRenderState, PlayerEntityModel> {
	private static final int WHITE = 0xFFFFFFFF;
	private static final int FULL_BRIGHT = 0xF000F0;

	/** One model pixel, in the block sized units the matrix works in. */
	private static final float PIXEL = 1.0F / 16.0F;

	/** How far apart the two copies of a mirrored pair sit, in model pixels. */
	private static final float SPREAD = 5.0F;

	/** How long one drift takes for the kinds that are meant to float. */
	private static final long DRIFT_PERIOD_MS = 4200L;

	private static volatile WeakReference<Object> wearer = new WeakReference<>(null);

	/** The flat panel worn by anything published without a model at all. */
	private final HalcyonCosmeticModel panel;

	/** One built model per cosmetic and frame. Only ever touched on the render thread. */
	private final Map<String, HalcyonCosmeticModel> built = new HashMap<>();

	/** The shape each cached model was built from, so a republished piece is rebuilt. */
	private final Map<String, HalcyonCosmeticModel.Shape> sources = new HashMap<>();

	public HalcyonCosmeticFeature(
			FeatureRendererContext<PlayerEntityRenderState, PlayerEntityModel> context) {
		super(context);
		this.panel = HalcyonCosmeticModel.create(getContextModel()::getLayer);
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
		for (Map.Entry<String, String> entry : cosmetics.wornByKind().entrySet()) {
			String kind = entry.getKey();
			if ("cape".equals(kind)) {
				// Worn through the vanilla cape slot, so drawing it here would double it up.
				continue;
			}

			Identifier texture = cosmetics.texture(entry.getValue());
			if (texture == null) {
				continue;
			}
			paint(
					matrices,
					queue,
					light,
					state,
					texture,
					kind,
					entry.getValue(),
					limbAngle,
					limbDistance);
		}
	}

	private void paint(
			MatrixStack matrices,
			OrderedRenderCommandQueue queue,
			int light,
			PlayerEntityRenderState state,
			Identifier texture,
			String kind,
			String id,
			float limbAngle,
			float limbDistance) {
		HalcyonCosmetics cosmetics = HalcyonCosmetics.get();
		float[] place = placement(kind);

		// The piece as it was published. A model that has been announced but not downloaded yet is
		// waited for rather than faked, because the fake is a flat picture in mid air.
		HalcyonCosmeticModel.Shape shape = cosmetics.shape(id);
		if (shape == null && cosmetics.hasModel(id)) {
			return;
		}

		HalcyonCosmeticModel worn = panel;
		if (shape != null) {
			int frames = cosmetics.frames(id);
			int frame = cosmetics.isStrip(id) ? cosmetics.frameAt(id, System.currentTimeMillis()) : 0;
			worn = modelFor(id, shape, frames, frame);
		}

		// A drawn model is worn at the size it was drawn at. Only the fallback panel is resized,
		// because a flat 24 pixel square has no size of its own to respect.
		float size = (shape == null ? place[3] : 1.0F) * cosmetics.scaleOf(id);

		int glow = cosmetics.glowOf(id);
		boolean lit = glow == -1 ? glows(kind) : glow == 1;
		int brightness = lit ? FULL_BRIGHT : light;

		float flap = cosmetics.flapOf(id);
		float liveliness = flap < 0.0F ? place[4] : flap;

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

		int mirror = cosmetics.mirrorOf(id);
		int copies = mirror == -1 ? Math.max(1, (int) place[5]) : (mirror == 1 ? 2 : 1);

		// The nudges from the admin panel are in model pixels too, so a piece can be pulled onto the
		// back without anybody touching this file.
		float anchorX = place[0] + cosmetics.offsetXOf(id);
		float anchorY = place[1] + cosmetics.offsetYOf(id);
		float anchorZ = place[2] + cosmetics.offsetZOf(id);

		// The part of the player this kind rides on. Everything below is measured from that part,
		// which is why a sneaking player takes their wings with them.
		ModelPart mount = mountFor(kind);

		for (int copy = 0; copy < copies; copy++) {
			float side = copies == 1 ? 0.0F : (copy == 0 ? -1.0F : 1.0F);
			matrices.push();
			if (mount != null) {
				mount.applyTransform(matrices);
			}
			// Pixels into blocks. Without this every one of these numbers is sixteen times too
			// large, which is exactly how a pair of wings ends up a block under the ground and two
			// blocks behind the player.
			matrices.translate(
					(anchorX + side * SPREAD) * PIXEL,
					(anchorY + drift * liveliness * 1.2F) * PIXEL,
					anchorZ * PIXEL);
			// A mirrored pair is turned outwards. Everything else is only turned by how much the
			// player is actually moving.
			matrices.multiply(
					RotationAxis.POSITIVE_Y.rotationDegrees(
							side * 18.0F + (stride + drift * 0.4F) * liveliness * 9.0F));
			matrices.scale(size, size, size);
			renderModel(worn, texture, matrices, queue, brightness, state, WHITE, 0);
			matrices.pop();
		}
	}

	/**
	 * The part of the player a kind of cosmetic is attached to.
	 *
	 * <p>Attaching to a part rather than to the player means the piece inherits that part's turn and
	 * lean for free, so it behaves while sneaking, swimming and riding without a single line here
	 * knowing about any of those.
	 */
	private ModelPart mountFor(String kind) {
		PlayerEntityModel model = getContextModel();
		switch (kind) {
			case "hat":
			case "halo":
			case "mask":
				return model.head;
			default:
				return model.body;
		}
	}

	/**
	 * The built model for one cosmetic and one frame of its picture.
	 *
	 * <p>Building a model means building its boxes, so it is done once per frame of the animation
	 * and then kept. A cosmetic that was published again arrives with a different shape, and every
	 * model cached for it is thrown away rather than left showing the old piece.
	 */
	private HalcyonCosmeticModel modelFor(
			String id, HalcyonCosmeticModel.Shape shape, int frames, int frame) {
		if (sources.get(id) != shape) {
			sources.put(id, shape);
			built.keySet().removeIf(entry -> entry.startsWith(id + "#"));
		}

		String key = id + "#" + frame;
		HalcyonCosmeticModel known = built.get(key);
		if (known != null) {
			return known;
		}

		HalcyonCosmeticModel made =
				HalcyonCosmeticModel.of(shape, frames, frame, getContextModel()::getLayer);
		built.put(key, made);
		return made;
	}

	private static boolean glows(String kind) {
		return "halo".equals(kind) || "aura".equals(kind) || "trail".equals(kind);
	}

	/** The kinds that are supposed to move on their own, because they never touch the body. */
	private static boolean drifts(String kind) {
		return "halo".equals(kind) || "aura".equals(kind) || "trail".equals(kind);
	}

	/**
	 * Where each kind hangs, in model pixels: x, y, z, the size of the fallback panel, how lively it
	 * is, and how many copies to draw.
	 *
	 * <p>Entity model space is upside down, so a smaller y sits higher on the body, and z grows
	 * towards the player's back. Measured from the part the piece rides on: the head pivot and the
	 * torso pivot are both at the neck, so y 0 is the neck, the top of the head is y -8, the hips
	 * are y 12 and the feet are y 24. The back of the body is z 2 and the face is z -4.
	 *
	 * <p>These are anchors, not positions. A model is drawn around the origin in Blockbench, and the
	 * anchor is the point on the body that origin is pinned to, so a piece ends up where it was
	 * drawn rather than where this file guesses.
	 */
	private static float[] placement(String kind) {
		switch (kind) {
			case "hat":
				// The top of the head.
				return new float[] {0.0F, -8.0F, 0.0F, 0.62F, 0.1F, 1.0F};
			case "halo":
				// A little above the head, which is the one thing that is meant to float.
				return new float[] {0.0F, -14.0F, 0.0F, 0.7F, 0.35F, 1.0F};
			case "mask":
				return new float[] {0.0F, -4.0F, -4.6F, 0.42F, 0.0F, 1.0F};
			case "shoulder":
				return new float[] {0.0F, -1.0F, 0.0F, 0.5F, 0.25F, 2.0F};
			case "aura":
				// Around the middle of the body rather than at its feet.
				return new float[] {0.0F, 12.0F, 0.0F, 1.7F, 0.25F, 1.0F};
			case "trail":
				return new float[] {0.0F, 18.0F, 3.4F, 1.15F, 0.45F, 1.0F};
			case "backpack":
				return new float[] {0.0F, 2.0F, 3.0F, 0.7F, 0.1F, 1.0F};
			case "shield":
				// Strapped flat on the back, behind the cape and the wings.
				return new float[] {0.0F, 2.0F, 4.0F, 0.6F, 0.05F, 1.0F};
			default:
				// Wings, and anything new that lands on the back. Pinned at the back of the neck,
				// two pixels off the body, which is where vanilla hangs a cape from.
				return new float[] {0.0F, 0.0F, 2.0F, 0.9F, 0.35F, 1.0F};
		}
	}
}
