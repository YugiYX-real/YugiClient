package gg.halcyon.companion;

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
 * A flat, double sided panel that carries one cosmetic picture.
 *
 * <p>Cosmetics that are not capes arrive from the backend as square pictures, often as animation
 * frames cut out of a gif. Wrapping them around a vanilla model would need a bespoke mesh per
 * cosmetic, so Halcyon paints them on a quad instead: the whole picture is mapped onto the panel,
 * and a second copy of the quad is turned around so the cosmetic reads correctly from both sides.
 */
public final class HalcyonCosmeticModel extends Model {
	/** Edge length of the panel in model pixels. Sixteen model pixels make one block. */
	public static final int SIZE = 24;

	private HalcyonCosmeticModel(ModelPart root, Function<Identifier, RenderLayer> layers) {
		super(root, layers);
	}

	/**
	 * Builds a fresh panel.
	 *
	 * <p>The render layer factory is handed in rather than picked here on purpose: this version of the
	 * game no longer exposes the entity layers as static helpers, so the caller passes the factory of
	 * the model it is decorating. The panel then lands on exactly the layer the player is drawn with.
	 */
	public static HalcyonCosmeticModel create(Function<Identifier, RenderLayer> layers) {
		return new HalcyonCosmeticModel(build(), layers);
	}

	private static ModelPart build() {
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
