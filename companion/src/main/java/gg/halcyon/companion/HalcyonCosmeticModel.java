package gg.halcyon.companion;

import net.minecraft.client.model.Model;
import net.minecraft.client.model.ModelData;
import net.minecraft.client.model.ModelPart;
import net.minecraft.client.model.ModelPartBuilder;
import net.minecraft.client.model.ModelPartData;
import net.minecraft.client.model.ModelTransform;
import net.minecraft.client.model.TexturedModelData;
import net.minecraft.client.render.RenderLayer;

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

	private HalcyonCosmeticModel(ModelPart root) {
		super(root, RenderLayer::getEntityTranslucent);
	}

	/** Builds a fresh panel. Cheap enough to own one per feature renderer. */
	public static HalcyonCosmeticModel create() {
		return new HalcyonCosmeticModel(build());
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
