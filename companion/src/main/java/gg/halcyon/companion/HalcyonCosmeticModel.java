package gg.halcyon.companion;

import java.util.List;
import java.util.function.Function;
import net.minecraft.client.model.Model;
import net.minecraft.client.model.ModelData;
import net.minecraft.client.model.ModelPart;
import net.minecraft.client.model.ModelPartBuilder;
import net.minecraft.client.model.ModelPartData;
import net.minecraft.client.model.ModelTransform;
import net.minecraft.client.model.TexturedModelData;
import net.minecraft.client.render.RenderLayer;
import net.minecraft.util.Identifier;

/**
 * The model a cosmetic is worn as.
 *
 * <p>A cosmetic that was published with a model is built out of exactly the boxes that were drawn
 * for it, at the size they were drawn at, in the place they were drawn in. Nothing about the shape
 * is invented here, which is the whole point: what comes out of Blockbench is what ends up on the
 * player, and a pair of wings is a pair of wings rather than a picture of one.
 *
 * <p>A cosmetic published as a picture with no model falls back to a flat, double sided panel, which
 * is what a cape is anyway.
 *
 * <p>Everything is measured in model pixels, sixteen of which make one block. That matters at the
 * other end of this: the matrix a feature renderer is handed is measured in blocks, so anything
 * moved by a pixel value has to be divided by sixteen first.
 *
 * <p>An animated cosmetic is one tall png with its frames stacked in it. A frame is drawn by telling
 * the builder the sheet is the whole strip and shifting every box down it by whole frames, so the
 * boxes take their picture out of that frame and nothing else has to know the texture moves.
 */
public final class HalcyonCosmeticModel extends Model {
	/** Edge length of the fallback panel in model pixels. Sixteen model pixels make one block. */
	public static final int SIZE = 24;

	/** One box of a published model, in model pixels, with y already growing downwards. */
	public record Box(
			String name,
			float x,
			float y,
			float z,
			float width,
			float height,
			float depth,
			float u,
			float v) {}

	/** A published model: the sheet one frame is drawn against, and the boxes on it. */
	public record Shape(int textureWidth, int textureHeight, List<Box> boxes) {}

	private HalcyonCosmeticModel(ModelPart root, Function<Identifier, RenderLayer> layers) {
		super(root, layers);
	}

	/**
	 * Builds the fallback panel.
	 *
	 * <p>The render layer factory is handed in rather than picked here on purpose: this version of the
	 * game no longer exposes the entity layers as static helpers, so the caller passes the factory of
	 * the model it is decorating. The piece then lands on exactly the layer the player is drawn with.
	 */
	public static HalcyonCosmeticModel create(Function<Identifier, RenderLayer> layers) {
		return new HalcyonCosmeticModel(panelRoot(), layers);
	}

	/**
	 * Builds one published model, showing one frame of its picture.
	 *
	 * @param shape the boxes that were published for this cosmetic
	 * @param frames how many frames the picture holds, one when it does not move
	 * @param frame which of those frames to show
	 */
	public static HalcyonCosmeticModel of(
			Shape shape, int frames, int frame, Function<Identifier, RenderLayer> layers) {
		return new HalcyonCosmeticModel(build(shape, frames, frame), layers);
	}

	private static ModelPart build(Shape shape, int frames, int frame) {
		if (shape == null || shape.boxes().isEmpty()) {
			return panelRoot();
		}

		int count = Math.max(1, frames);
		int index = Math.max(0, Math.min(count - 1, frame));
		int sheetWidth = Math.max(1, shape.textureWidth());
		int sheetHeight = Math.max(1, shape.textureHeight());

		// The whole strip is handed to the builder as the texture, and every box is shifted down it
		// by whole frames. That is what makes an animation play: the same boxes, a window further
		// down the same picture.
		int window = index * sheetHeight;

		ModelData data = new ModelData();
		ModelPartData root = data.getRoot();

		int number = 0;
		for (Box box : shape.boxes()) {
			ModelPartBuilder builder =
					ModelPartBuilder.create()
							.uv(Math.round(box.u()), Math.round(box.v()) + window)
							.cuboid(
									box.x(),
									box.y(),
									box.z(),
									Math.max(0.0F, box.width()),
									Math.max(0.0F, box.height()),
									Math.max(0.0F, box.depth()));
			// The names only have to be unique, and a published name could repeat or be empty, so
			// they are numbered here rather than trusted.
			root.addChild("box" + number, builder, ModelTransform.NONE);
			number += 1;
		}

		return TexturedModelData.of(data, sheetWidth, sheetHeight * count).createModel();
	}

	private static ModelPart panelRoot() {
		ModelData data = new ModelData();
		ModelPartData root = data.getRoot();
		root.addChild("front", panel(), ModelTransform.NONE);
		root.addChild(
				"back",
				panel(),
				new ModelTransform(
						0.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI, 0.0F, 1.0F, 1.0F, 1.0F));
		return TexturedModelData.of(data, SIZE, SIZE).createModel();
	}

	private static ModelPartBuilder panel() {
		return ModelPartBuilder.create()
				.uv(0, 0)
				.cuboid(-SIZE / 2.0F, 0.0F, 0.0F, (float) SIZE, (float) SIZE, 0.0F);
	}
}
