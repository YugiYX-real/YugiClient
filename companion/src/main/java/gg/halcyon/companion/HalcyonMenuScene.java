package gg.halcyon.companion;

import net.minecraft.client.texture.NativeImage;

import java.util.Random;

/**
 * Paints the Halcyon main menu background.
 *
 * <p>This is the picture the client is meant to show: a cherry blossom grove leaning over still
 * water at first light. It is generated in code instead of being shipped as a png, so every
 * install has the right background from the very first launch without anyone uploading anything,
 * and the mod stays free of binary assets. It is built once per session, so it costs nothing while
 * the menu is on screen, and a picture dropped in the config folder still wins over it.
 */
public final class HalcyonMenuScene {
	private static final int WIDTH = 512;

	private static final int HEIGHT = 288;

	/** Where the water starts, as a share of the height. */
	private static final float WATER = 0.63F;

	private static final float[] STOPS = {0.00F, 0.20F, 0.38F, 0.52F, WATER, 0.80F, 1.00F};

	private static final int[] COLOURS = {
		0x53306B, 0x8B4C82, 0xC66E9E, 0xEDA2C2, 0xFBD8E4, 0x8F5080, 0x4B2B56
	};

	/** The blossom tones, mixed across every canopy so no two trees look stamped out. */
	private static final int[] BLOSSOM = {0xF7B2CE, 0xFFD0E2, 0xE87FAC, 0xFFE6EF, 0xF39CC0};

	private static final int BARK = 0x38213A;

	private HalcyonMenuScene() {}

	/** Builds the picture. The caller owns the image and hands it to a texture. */
	public static NativeImage paint() {
		int[] pixels = new int[WIDTH * HEIGHT];

		paintSky(pixels);
		paintSun(pixels);
		paintRidges(pixels);
		paintHaze(pixels);
		paintWater(pixels);
		paintGrove(pixels);
		paintReflection(pixels);
		paintPetals(pixels);
		paintVignette(pixels);

		NativeImage image = new NativeImage(WIDTH, HEIGHT, false);
		for (int y = 0; y < HEIGHT; y++) {
			for (int x = 0; x < WIDTH; x++) {
				image.setColorArgb(x, y, 0xFF000000 | pixels[y * WIDTH + x]);
			}
		}
		return image;
	}

	private static void paintSky(int[] pixels) {
		for (int y = 0; y < HEIGHT; y++) {
			int colour = sample((float) y / (float) (HEIGHT - 1));
			for (int x = 0; x < WIDTH; x++) {
				pixels[y * WIDTH + x] = colour;
			}
		}
	}

	/** Low sun behind the grove, which is what gives the whole picture its warm pink cast. */
	private static void paintSun(int[] pixels) {
		float centreX = WIDTH * 0.66F;
		float centreY = HEIGHT * (WATER - 0.06F);
		float radius = WIDTH * 0.42F;
		float disc = WIDTH * 0.038F;

		for (int y = 0; y < HEIGHT; y++) {
			for (int x = 0; x < WIDTH; x++) {
				int index = y * WIDTH + x;
				float dx = (x - centreX) / radius;
				float dy = (y - centreY) / (radius * 0.72F);
				float distance = (float) Math.sqrt(dx * dx + dy * dy);

				if (distance < 1.0F) {
					float falloff = 1.0F - distance;
					pixels[index] = mix(pixels[index], 0xFFEAF2, falloff * falloff * 0.78F);
				}

				float toCentre = (float)
						Math.sqrt((x - centreX) * (x - centreX) + (y - centreY) * (y - centreY));
				if (toCentre < disc) {
					pixels[index] = mix(pixels[index], 0xFFFFFB, 1.0F - toCentre / disc);
				}
			}
		}
	}

	/** Two soft hills on the far bank, so the water has something to end against. */
	private static void paintRidges(int[] pixels) {
		int[] tints = {0xB06A99, 0x8C4E7C};
		float[] bases = {0.560F, 0.605F};
		float[] amplitudes = {0.030F, 0.022F};
		float[] frequencies = {0.011F, 0.019F};
		float[] phases = {0.6F, 2.4F};
		int surface = (int) (HEIGHT * WATER);

		for (int layer = 0; layer < tints.length; layer++) {
			for (int x = 0; x < WIDTH; x++) {
				double wave = Math.sin(x * frequencies[layer] + phases[layer])
						+ 0.4 * Math.sin(x * frequencies[layer] * 2.3 + phases[layer] * 1.6);
				int ridge = (int) (HEIGHT * (bases[layer] - amplitudes[layer] * (float) wave));

				for (int y = Math.max(0, ridge); y < surface; y++) {
					float depth = Math.min(1.0F, (y - ridge) / 22.0F);
					int index = y * WIDTH + x;
					pixels[index] = mix(pixels[index], tints[layer], 0.45F + depth * 0.35F);
				}
			}
		}
	}

	/** A band of light mist sitting on the far bank. */
	private static void paintHaze(int[] pixels) {
		int surface = (int) (HEIGHT * WATER);
		int top = surface - 26;

		for (int y = Math.max(0, top); y < surface; y++) {
			float strength = 0.42F * (1.0F - Math.abs((y - (surface - 13)) / 13.0F));
			for (int x = 0; x < WIDTH; x++) {
				int index = y * WIDTH + x;
				pixels[index] = mix(pixels[index], 0xFFE7F1, Math.max(0.0F, strength));
			}
		}
	}

	/** Still water: the sky mirrored, darkened with depth, broken by long streaks of light. */
	private static void paintWater(int[] pixels) {
		int surface = (int) (HEIGHT * WATER);
		int span = Math.max(1, HEIGHT - surface);

		for (int y = surface; y < HEIGHT; y++) {
			float depth = (float) (y - surface) / (float) span;
			int mirrored = sample(Math.max(0.0F, WATER - depth * 0.34F));
			int colour = mix(mirrored, 0x3B1F45, 0.28F + depth * 0.42F);
			for (int x = 0; x < WIDTH; x++) {
				pixels[y * WIDTH + x] = colour;
			}
		}

		Random random = new Random(0x57415445L);
		for (int count = 0; count < 190; count++) {
			int y = surface + random.nextInt(span);
			int x = random.nextInt(WIDTH);
			int length = 8 + random.nextInt(46);
			float depth = (float) (y - surface) / (float) span;
			float strength = (0.14F + random.nextFloat() * 0.28F) * (1.0F - depth * 0.65F);

			for (int step = 0; step < length; step++) {
				float taper = 1.0F - Math.abs(step - length / 2.0F) / (length / 2.0F);
				plot(pixels, x + step, y, 0xFFDCEB, strength * Math.max(0.15F, taper));
			}
		}
	}

	/** The grove itself: a big tree either side of the frame and smaller ones behind. */
	private static void paintGrove(int[] pixels) {
		Random random = new Random(0x53414B55L);
		int surface = (int) (HEIGHT * WATER);

		// Far trees first, so the near ones overlap them.
		paintTree(pixels, random, WIDTH * 0.30F, surface - 2, 0.52F, 0.6F, 0.55F);
		paintTree(pixels, random, WIDTH * 0.52F, surface - 4, 0.44F, -0.5F, 0.50F);
		paintTree(pixels, random, WIDTH * 0.78F, surface - 2, 0.58F, 0.4F, 0.60F);
		paintTree(pixels, random, WIDTH * 0.07F, surface + 2, 1.05F, 0.9F, 1.00F);
		paintTree(pixels, random, WIDTH * 0.94F, surface + 2, 0.98F, -1.0F, 1.00F);
	}

	/**
	 * One blossom tree.
	 *
	 * @param rootX where the trunk meets the bank
	 * @param rootY the bank height at that point
	 * @param scale overall size, one being a tree that fills the side of the frame
	 * @param lean how far the crown leans out over the water
	 * @param weight how solid the blossom reads, so distant trees stay hazy
	 */
	private static void paintTree(
			int[] pixels,
			Random random,
			float rootX,
			float rootY,
			float scale,
			float lean,
			float weight) {
		float trunkHeight = 96.0F * scale;
		float crownX = rootX + lean * 34.0F * scale;
		float crownY = rootY - trunkHeight;

		stroke(pixels, rootX, rootY, crownX, crownY, 7.0F * scale, 2.6F * scale, BARK, 0.92F);

		// A few limbs reaching out of the trunk, each one carrying its own cluster of blossom.
		int limbs = 3 + Math.round(scale * 3.0F);
		for (int limb = 0; limb < limbs; limb++) {
			float along = 0.42F + 0.14F * limb;
			float fromX = rootX + (crownX - rootX) * along;
			float fromY = rootY + (crownY - rootY) * along;
			float reach = (26.0F + random.nextFloat() * 24.0F) * scale;
			float side = limb % 2 == 0 ? 1.0F : -1.0F;
			if (lean != 0.0F) {
				side *= Math.signum(lean);
			}

			float toX = fromX + side * reach;
			float toY = fromY - reach * (0.35F + random.nextFloat() * 0.45F);
			stroke(pixels, fromX, fromY, toX, toY, 2.6F * scale, 1.2F * scale, BARK, 0.85F);
			canopy(pixels, random, toX, toY, 26.0F * scale, 17.0F * scale, weight);
		}

		canopy(pixels, random, crownX, crownY - 6.0F * scale, 46.0F * scale, 26.0F * scale, weight);
	}

	/** A cloud of blossom built from soft overlapping blobs. */
	private static void canopy(
			int[] pixels,
			Random random,
			float centreX,
			float centreY,
			float spreadX,
			float spreadY,
			float weight) {
		int puffs = 12 + (int) (spreadX * 0.55F);

		for (int puff = 0; puff < puffs; puff++) {
			float angle = random.nextFloat() * (float) Math.PI * 2.0F;
			float reach = random.nextFloat();
			float x = centreX + (float) Math.cos(angle) * spreadX * reach;
			float y = centreY + (float) Math.sin(angle) * spreadY * reach;
			float radius = (5.0F + random.nextFloat() * 9.0F) * Math.max(0.45F, spreadX / 40.0F);
			int colour = BLOSSOM[random.nextInt(BLOSSOM.length)];
			float strength = (0.45F + random.nextFloat() * 0.42F) * weight;

			blob(pixels, x, y, radius, radius * 0.78F, colour, strength);
		}

		// A handful of bright petals catching the sun on the upper edge of the cloud.
		for (int light = 0; light < puffs / 2; light++) {
			float x = centreX + (random.nextFloat() - 0.5F) * spreadX * 1.6F;
			float y = centreY - random.nextFloat() * spreadY;
			blob(pixels, x, y, 2.4F, 2.0F, 0xFFF0F6, 0.55F * weight);
		}
	}

	/** Mirrors everything above the waterline into the water, softened and gently rippled. */
	private static void paintReflection(int[] pixels) {
		int surface = (int) (HEIGHT * WATER);

		for (int y = surface; y < HEIGHT; y++) {
			int depth = y - surface;
			int source = surface - depth;
			if (source < 1) {
				break;
			}

			double wobble = 3.0 * Math.sin(depth * 0.22) + 1.6 * Math.sin(depth * 0.07);
			float strength = Math.max(0.0F, 0.46F - depth * 0.0042F);

			for (int x = 0; x < WIDTH; x++) {
				int from = (int) Math.round(x + wobble);
				if (from < 0 || from >= WIDTH) {
					continue;
				}
				int index = y * WIDTH + x;
				pixels[index] = mix(pixels[index], pixels[source * WIDTH + from], strength);
			}
		}
	}

	/** Petals drifting across the whole frame, thicker where the canopies are. */
	private static void paintPetals(int[] pixels) {
		Random random = new Random(0x50455441L);

		for (int count = 0; count < 260; count++) {
			int x = random.nextInt(WIDTH);
			int y = random.nextInt(HEIGHT);
			float strength = 0.20F + random.nextFloat() * 0.55F;
			int colour = random.nextInt(3) == 0 ? 0xFFEAF2 : BLOSSOM[random.nextInt(BLOSSOM.length)];

			plot(pixels, x, y, colour, strength);
			plot(pixels, x + 1, y, colour, strength * 0.72F);
			plot(pixels, x, y + 1, colour, strength * 0.58F);
			if (random.nextInt(4) == 0) {
				plot(pixels, x + 1, y + 1, colour, strength * 0.42F);
				plot(pixels, x + 2, y, colour, strength * 0.30F);
			}
		}
	}

	private static void paintVignette(int[] pixels) {
		float centreX = WIDTH / 2.0F;
		float centreY = HEIGHT / 2.0F;
		float longest = (float) Math.sqrt(centreX * centreX + centreY * centreY);

		for (int y = 0; y < HEIGHT; y++) {
			for (int x = 0; x < WIDTH; x++) {
				float dx = x - centreX;
				float dy = y - centreY;
				float distance = (float) Math.sqrt(dx * dx + dy * dy) / longest;
				float strength = Math.min(0.58F, Math.max(0.0F, distance - 0.52F) * 0.85F);
				int index = y * WIDTH + x;
				pixels[index] = mix(pixels[index], 0x1A0C1E, strength);
			}
		}
	}

	/** A tapering line, used for trunks and limbs. */
	private static void stroke(
			int[] pixels,
			float fromX,
			float fromY,
			float toX,
			float toY,
			float fromThickness,
			float toThickness,
			int colour,
			float strength) {
		float dx = toX - fromX;
		float dy = toY - fromY;
		int steps = Math.max(8, (int) (Math.sqrt(dx * dx + dy * dy) * 1.6F));

		for (int step = 0; step <= steps; step++) {
			float along = (float) step / (float) steps;
			// A touch of bow in the trunk reads much more like a tree than a straight line.
			float bow = (float) Math.sin(along * Math.PI) * dx * 0.10F;
			float x = fromX + dx * along + bow;
			float y = fromY + dy * along;
			float thickness = fromThickness + (toThickness - fromThickness) * along;
			blob(pixels, x, y, Math.max(0.8F, thickness), Math.max(0.8F, thickness), colour, strength);
		}
	}

	/** A soft filled ellipse. */
	private static void blob(
			int[] pixels, float centreX, float centreY, float radiusX, float radiusY, int colour, float strength) {
		int minX = (int) Math.floor(centreX - radiusX);
		int maxX = (int) Math.ceil(centreX + radiusX);
		int minY = (int) Math.floor(centreY - radiusY);
		int maxY = (int) Math.ceil(centreY + radiusY);

		for (int y = minY; y <= maxY; y++) {
			for (int x = minX; x <= maxX; x++) {
				float dx = (x - centreX) / Math.max(0.5F, radiusX);
				float dy = (y - centreY) / Math.max(0.5F, radiusY);
				float distance = dx * dx + dy * dy;
				if (distance > 1.0F) {
					continue;
				}
				float fade = 1.0F - (float) Math.sqrt(distance);
				plot(pixels, x, y, colour, strength * (0.30F + 0.70F * fade));
			}
		}
	}

	private static int sample(float position) {
		for (int index = 1; index < STOPS.length; index++) {
			if (position <= STOPS[index]) {
				float span = STOPS[index] - STOPS[index - 1];
				float ratio = span <= 0.0F ? 0.0F : (position - STOPS[index - 1]) / span;
				return mix(COLOURS[index - 1], COLOURS[index], ratio);
			}
		}
		return COLOURS[COLOURS.length - 1];
	}

	private static void plot(int[] pixels, int x, int y, int colour, float strength) {
		if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) {
			return;
		}
		int index = y * WIDTH + x;
		pixels[index] = mix(pixels[index], colour, strength);
	}

	private static int mix(int from, int to, float ratio) {
		float clamped = Math.max(0.0F, Math.min(1.0F, ratio));
		int red = channel((from >> 16) & 0xFF, (to >> 16) & 0xFF, clamped);
		int green = channel((from >> 8) & 0xFF, (to >> 8) & 0xFF, clamped);
		int blue = channel(from & 0xFF, to & 0xFF, clamped);
		return (red << 16) | (green << 8) | blue;
	}

	private static int channel(int from, int to, float ratio) {
		int value = Math.round(from + (to - from) * ratio);
		return Math.max(0, Math.min(255, value));
	}
}
