package gg.halcyon.companion;

import net.minecraft.client.texture.NativeImage;

import java.util.Random;

/**
 * Paints the Halcyon main menu background.
 *
 * <p>The picture follows the owner's reference shot: a deep blue sky with tall white cumulus,
 * blossom canopies hanging into both top corners, a grove of pink cherry trees along the far bank
 * and dark rippled water filling the bottom quarter. It is drawn here pixel by pixel because the
 * mod jar ships no binary assets, so a fresh install shows the right background on the very first
 * launch with nothing to download and nothing to copy by hand. A png published on the backend, or
 * dropped into the instance config folder, still wins over it.
 */
public final class HalcyonMenuScene {
	private static final int WIDTH = 512;

	private static final int HEIGHT = 288;

	/** Where the far bank meets the water, as a share of the height. */
	private static final float HORIZON = 0.755F;

	private static final float[] SKY_STOPS = {0.00F, 0.20F, 0.42F, 0.60F, HORIZON};

	private static final int[] SKY_COLOURS = {0x0D2A64, 0x1A4A93, 0x3D7BC1, 0x82B4DE, 0xC6DBED};

	private static final int CLOUD_LIGHT = 0xFFFFFF;

	private static final int CLOUD_MID = 0xDCE6F2;

	private static final int CLOUD_SHADE = 0x9CACC6;

	private static final int HAZE = 0xC4DAEE;

	/** Blossom tones, mixed across every canopy so no two trees look stamped out. */
	private static final int[] BLOSSOM = {0xE98CC0, 0xF6B4D8, 0xD873AC, 0xFFD9EC, 0xC2669B};

	private static final int BLOSSOM_SHADE = 0x8B4674;

	private static final int BARK = 0x2F2138;

	private static final int LEAF = 0x4F7B45;

	private static final int STONE = 0x3B3750;

	private static final int WATER_TOP = 0x2C2C4A;

	private static final int WATER_DEEP = 0x101024;

	/** Cumulus masses: centre x, centre y, half width, half height, and how solid each reads. */
	private static final float[][] CLOUDS = {
		{0.53F, 0.585F, 0.230F, 0.135F, 1.00F},
		{0.72F, 0.520F, 0.150F, 0.090F, 0.85F},
		{0.37F, 0.520F, 0.130F, 0.080F, 0.75F},
		{0.63F, 0.360F, 0.095F, 0.055F, 0.62F},
		{0.44F, 0.180F, 0.075F, 0.040F, 0.58F},
		{0.57F, 0.270F, 0.060F, 0.032F, 0.48F},
		{0.30F, 0.330F, 0.060F, 0.034F, 0.45F},
		{0.85F, 0.290F, 0.080F, 0.042F, 0.52F},
		{0.16F, 0.210F, 0.055F, 0.030F, 0.40F},
		{0.91F, 0.450F, 0.070F, 0.040F, 0.45F}
	};

	/** The grove on the far bank: position across the frame and relative size. */
	private static final float[][] TREES = {
		{0.05F, 0.62F},
		{0.13F, 0.52F},
		{0.21F, 0.70F},
		{0.28F, 0.48F},
		{0.36F, 0.58F},
		{0.44F, 0.50F},
		{0.55F, 1.00F},
		{0.64F, 0.56F},
		{0.72F, 0.64F},
		{0.80F, 0.50F},
		{0.88F, 0.66F},
		{0.96F, 0.54F}
	};

	/** The blossom hanging into a top corner: offset x, offset y, half width, half height. */
	private static final float[][] OVERHANG = {
		{0.02F, 0.02F, 0.150F, 0.100F},
		{0.13F, 0.00F, 0.130F, 0.080F},
		{0.21F, 0.09F, 0.110F, 0.070F},
		{0.06F, 0.16F, 0.130F, 0.085F},
		{0.16F, 0.24F, 0.100F, 0.062F},
		{0.03F, 0.33F, 0.105F, 0.070F},
		{0.24F, 0.34F, 0.075F, 0.050F},
		{0.11F, 0.44F, 0.085F, 0.055F}
	};

	private static final long CLOUD_SEED = 0x484F4C43L;

	private static final long GROVE_SEED = 0x424C4F53L;

	private static final long WATER_SEED = 0x57415445L;

	private static final long PETAL_SEED = 0x50455441L;

	private HalcyonMenuScene() {}

	/** Builds the picture. The caller owns the image and hands it to a texture. */
	public static NativeImage paint() {
		int[] pixels = new int[WIDTH * HEIGHT];

		paintSky(pixels);
		paintClouds(pixels);
		paintBank(pixels);
		paintGrove(pixels);
		paintMist(pixels);
		paintWater(pixels);
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
			int colour = sample(Math.min(HORIZON, (float) y / (float) (HEIGHT - 1)));
			for (int x = 0; x < WIDTH; x++) {
				pixels[y * WIDTH + x] = colour;
			}
		}
	}

	/** Big soft cumulus, bright on top and flat and grey underneath. */
	private static void paintClouds(int[] pixels) {
		int horizon = (int) (HEIGHT * HORIZON);

		for (int y = 0; y < horizon; y++) {
			for (int x = 0; x < WIDTH; x++) {
				float density = cloud(x, y);
				if (density <= 0.01F) {
					continue;
				}

				float above = cloud(x, y - 9);
				float below = cloud(x, y + 9);
				int colour = mix(CLOUD_LIGHT, CLOUD_MID, above * 0.70F);
				colour = mix(colour, CLOUD_SHADE, Math.max(0.0F, above - below) * 0.85F);

				// Everything sinks into the haze as it approaches the far bank.
				float haze = Math.max(0.0F, 1.0F - (horizon - y) / 55.0F);
				colour = mix(colour, HAZE, haze * 0.60F);

				plot(pixels, x, y, colour, Math.min(1.0F, density * 1.25F) * (1.0F - haze * 0.30F));
			}
		}
	}

	/** How much cloud sits at a pixel: a soft mass shape cut out of layered noise. */
	private static float cloud(int x, int y) {
		if (y < 0 || y >= HEIGHT) {
			return 0.0F;
		}

		float coverage = 0.0F;
		for (float[] mass : CLOUDS) {
			float dx = (x - mass[0] * WIDTH) / (mass[2] * WIDTH);
			float dy = (y - mass[1] * HEIGHT) / (mass[3] * HEIGHT);
			float distance = dx * dx + dy * dy;
			if (distance < 1.0F) {
				coverage = Math.max(coverage, mass[4] * (1.0F - distance));
			}
		}
		if (coverage <= 0.0F) {
			return 0.0F;
		}

		float shape = fbm(x * 0.013F, y * 0.030F, CLOUD_SEED);
		return clamp((shape - (0.70F - 0.42F * coverage)) / 0.12F);
	}

	/** The far bank the grove stands on, blocky like the world it came from. */
	private static void paintBank(int[] pixels) {
		int horizon = (int) (HEIGHT * HORIZON);
		Random random = new Random(GROVE_SEED);

		for (int block = 0; block < WIDTH; block += 8) {
			int height = 6 + random.nextInt(9);
			// The middle of the frame opens up, which is what lets the water read as a lake.
			float middle = 1.0F - Math.abs(block - WIDTH / 2.0F) / (WIDTH / 2.0F);
			height = Math.max(2, height - Math.round(middle * 5.0F));
			int top = horizon - height;

			for (int x = block; x < Math.min(WIDTH, block + 8); x++) {
				for (int y = top; y < horizon; y++) {
					int colour = y < top + 2 ? LEAF : STONE;
					float haze = Math.min(0.60F, 0.28F + (horizon - y) * 0.020F);
					plot(pixels, x, y, mix(colour, HAZE, haze), 0.95F);
				}
			}
		}
	}

	/** The grove itself, plus the blossom hanging into both top corners. */
	private static void paintGrove(int[] pixels) {
		Random random = new Random(GROVE_SEED + 17L);
		int horizon = (int) (HEIGHT * HORIZON);

		for (float[] tree : TREES) {
			paintTree(pixels, random, tree[0] * WIDTH, horizon - 1, tree[1]);
		}

		paintOverhang(pixels, random, -0.04F, 1.0F);
		paintOverhang(pixels, random, 1.04F, -1.0F);
	}

	/**
	 * One cherry tree on the bank.
	 *
	 * @param rootX where the trunk meets the bank
	 * @param rootY the bank height at that point
	 * @param scale overall size, one being the hero tree near the middle
	 */
	private static void paintTree(
			int[] pixels, Random random, float rootX, float rootY, float scale) {
		float trunk = 30.0F * scale;
		float crownY = rootY - trunk;
		float weight = 0.55F + scale * 0.40F;

		stroke(pixels, rootX, rootY, rootX, crownY, 3.4F * scale, 1.6F * scale, BARK, 0.80F);

		int limbs = 2 + Math.round(scale * 2.0F);
		for (int limb = 0; limb < limbs; limb++) {
			float side = limb % 2 == 0 ? 1.0F : -1.0F;
			float reach = (12.0F + random.nextFloat() * 12.0F) * scale;
			float fromY = crownY + trunk * 0.30F * random.nextFloat();
			float toX = rootX + side * reach;
			float toY = fromY - reach * 0.50F;

			stroke(pixels, rootX, fromY, toX, toY, 1.8F * scale, 1.0F * scale, BARK, 0.70F);
			canopy(pixels, random, toX, toY - 3.0F * scale, 15.0F * scale, 9.0F * scale, weight);
		}

		canopy(pixels, random, rootX, crownY - 4.0F * scale, 26.0F * scale, 14.0F * scale, weight);
	}

	/** Blossom leaning in from one side of the frame, which is what frames the whole picture. */
	private static void paintOverhang(int[] pixels, Random random, float edge, float direction) {
		float baseX = edge * WIDTH;

		// A couple of dark branches out of the corner hold the blossom together.
		stroke(
				pixels,
				baseX,
				HEIGHT * 0.02F,
				baseX + direction * WIDTH * 0.20F,
				HEIGHT * 0.17F,
				6.0F,
				2.0F,
				BARK,
				0.85F);
		stroke(
				pixels,
				baseX,
				HEIGHT * 0.11F,
				baseX + direction * WIDTH * 0.26F,
				HEIGHT * 0.38F,
				4.5F,
				1.6F,
				BARK,
				0.80F);

		for (float[] mass : OVERHANG) {
			float x = baseX + direction * mass[0] * WIDTH;
			float y = mass[1] * HEIGHT;
			canopy(pixels, random, x, y, mass[2] * WIDTH, mass[3] * HEIGHT, 1.0F);
		}
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
		int puffs = 10 + (int) (spreadX * 0.70F);

		for (int puff = 0; puff < puffs; puff++) {
			float angle = random.nextFloat() * (float) Math.PI * 2.0F;
			float reach = (float) Math.sqrt(random.nextFloat());
			float x = centreX + (float) Math.cos(angle) * spreadX * reach;
			float y = centreY + (float) Math.sin(angle) * spreadY * reach;
			float radius = (4.0F + random.nextFloat() * 7.0F) * Math.max(0.50F, spreadX / 34.0F);
			int colour = BLOSSOM[random.nextInt(BLOSSOM.length)];

			// Blossom in the lower half of a mass sits in its own shadow.
			float low = Math.max(0.0F, (y - centreY) / Math.max(1.0F, spreadY));
			colour = mix(colour, BLOSSOM_SHADE, low * 0.60F);

			blob(
					pixels,
					x,
					y,
					radius,
					radius * 0.82F,
					colour,
					(0.55F + random.nextFloat() * 0.40F) * weight);
		}

		for (int light = 0; light < puffs / 2; light++) {
			float x = centreX + (random.nextFloat() - 0.5F) * spreadX * 1.5F;
			float y = centreY - random.nextFloat() * spreadY * 0.90F;
			blob(pixels, x, y, 2.2F, 1.8F, 0xFFE7F3, 0.50F * weight);
		}

		for (int dark = 0; dark < puffs / 3; dark++) {
			float x = centreX + (random.nextFloat() - 0.5F) * spreadX * 1.3F;
			float y = centreY + random.nextFloat() * spreadY * 0.90F;
			blob(pixels, x, y, 2.0F, 1.6F, BARK, 0.35F * weight);
		}
	}

	/** A band of light mist sitting on the far bank. */
	private static void paintMist(int[] pixels) {
		int horizon = (int) (HEIGHT * HORIZON);
		int top = Math.max(0, horizon - 22);

		for (int y = top; y < horizon; y++) {
			float towards = (float) (y - top) / (float) Math.max(1, horizon - top);
			for (int x = 0; x < WIDTH; x++) {
				float noise = fbm(x * 0.02F, y * 0.09F, CLOUD_SEED + 91L);
				plot(pixels, x, y, HAZE, towards * 0.50F * (0.55F + noise * 0.65F));
			}
		}
	}

	/** The lake: a dark sheet carrying a squashed reflection of the grove, broken by ripples. */
	private static void paintWater(int[] pixels) {
		int horizon = (int) (HEIGHT * HORIZON);
		int span = Math.max(1, HEIGHT - horizon);

		for (int y = horizon; y < HEIGHT; y++) {
			float depth = (float) (y - horizon) / (float) span;
			int colour = mix(WATER_TOP, WATER_DEEP, depth * depth * 0.95F);
			for (int x = 0; x < WIDTH; x++) {
				pixels[y * WIDTH + x] = colour;
			}
		}

		// The reflection is compressed towards the shore, the way a low camera sees it.
		for (int y = horizon; y < HEIGHT; y++) {
			int depth = y - horizon;
			int source = horizon - (int) (depth * 2.10F);
			if (source < 1) {
				source = 1;
			}

			float wobble = 3.2F * (float) Math.sin(depth * 0.30F) + 1.8F * (float) Math.sin(depth * 0.09F + 1.3F);
			float strength = Math.max(0.0F, 0.50F - depth * 0.0055F);

			for (int x = 0; x < WIDTH; x++) {
				int from = Math.round(x + wobble * (0.60F + 0.40F * (float) Math.sin(x * 0.03F)));
				if (from < 0 || from >= WIDTH) {
					continue;
				}
				int index = y * WIDTH + x;
				pixels[index] = mix(pixels[index], pixels[source * WIDTH + from], strength);
			}
		}

		// Ripple bands, brightest just off the shore.
		for (int y = horizon; y < HEIGHT; y++) {
			float depth = (float) (y - horizon) / (float) span;
			for (int x = 0; x < WIDTH; x++) {
				float wave = (float) Math.sin(x * 0.045F + y * 0.55F) * 0.5F + 0.5F;
				float noise = fbm(x * 0.05F, y * 0.22F, WATER_SEED);
				float strength = Math.max(0.0F, wave * 0.45F + noise * 0.55F - 0.62F)
						* (0.85F - depth * 0.45F);
				plot(pixels, x, y, 0xBFCBE6, strength);
			}
		}

		// Long streaks of light lying on the surface.
		Random random = new Random(WATER_SEED + 7L);
		for (int count = 0; count < 210; count++) {
			int y = horizon + random.nextInt(span);
			int x = random.nextInt(WIDTH);
			int length = 10 + random.nextInt(52);
			float depth = (float) (y - horizon) / (float) span;
			boolean warm = random.nextInt(3) == 0;
			int colour = warm ? 0xE9A9CC : 0xD3E1F2;
			float strength = (0.10F + random.nextFloat() * 0.24F) * (1.0F - depth * 0.55F);

			for (int step = 0; step < length; step++) {
				float taper = 1.0F - Math.abs(step - length / 2.0F) / (length / 2.0F);
				plot(pixels, x + step, y, colour, strength * Math.max(0.15F, taper));
			}
		}
	}

	/** A few petals in the air, thicker under the corner canopies. */
	private static void paintPetals(int[] pixels) {
		Random random = new Random(PETAL_SEED);

		for (int count = 0; count < 150; count++) {
			int x = random.nextInt(WIDTH);
			int y = random.nextInt((int) (HEIGHT * HORIZON));
			float edge = 1.0F - Math.min(1.0F, Math.abs(x - WIDTH / 2.0F) / (WIDTH / 2.0F));
			float strength = (0.18F + random.nextFloat() * 0.45F) * (1.0F - edge * 0.55F);
			int colour = BLOSSOM[random.nextInt(BLOSSOM.length)];

			plot(pixels, x, y, colour, strength);
			plot(pixels, x + 1, y, colour, strength * 0.65F);
			plot(pixels, x, y + 1, colour, strength * 0.50F);
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
				float strength = Math.min(0.42F, Math.max(0.0F, distance - 0.58F) * 0.80F);
				int index = y * WIDTH + x;
				pixels[index] = mix(pixels[index], 0x0A1024, strength);
			}
		}
	}

	/** A tapering line, used for trunks and branches. */
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
			// A touch of bow reads much more like a branch than a straight line.
			float bow = (float) Math.sin(along * Math.PI) * dx * 0.10F;
			float x = fromX + dx * along + bow;
			float y = fromY + dy * along;
			float thickness = fromThickness + (toThickness - fromThickness) * along;
			blob(pixels, x, y, Math.max(0.8F, thickness), Math.max(0.8F, thickness), colour, strength);
		}
	}

	/** A soft filled ellipse. */
	private static void blob(
			int[] pixels,
			float centreX,
			float centreY,
			float radiusX,
			float radiusY,
			int colour,
			float strength) {
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

	/** Four octaves of value noise, which is what gives the clouds and ripples their edges. */
	private static float fbm(float x, float y, long seed) {
		float total = 0.0F;
		float sum = 0.0F;
		float amplitude = 0.5F;
		float frequency = 1.0F;

		for (int octave = 0; octave < 4; octave++) {
			total += amplitude * noise(x * frequency, y * frequency, seed + octave * 131L);
			sum += amplitude;
			amplitude *= 0.5F;
			frequency *= 2.07F;
		}
		return sum <= 0.0F ? 0.0F : total / sum;
	}

	private static float noise(float x, float y, long seed) {
		int x0 = (int) Math.floor(x);
		int y0 = (int) Math.floor(y);
		float fx = x - x0;
		float fy = y - y0;
		float sx = fx * fx * (3.0F - 2.0F * fx);
		float sy = fy * fy * (3.0F - 2.0F * fy);

		float topLeft = hash(x0, y0, seed);
		float topRight = hash(x0 + 1, y0, seed);
		float bottomLeft = hash(x0, y0 + 1, seed);
		float bottomRight = hash(x0 + 1, y0 + 1, seed);

		float top = topLeft + (topRight - topLeft) * sx;
		float bottom = bottomLeft + (bottomRight - bottomLeft) * sx;
		return top + (bottom - top) * sy;
	}

	private static float hash(int x, int y, long seed) {
		long value = x * 0x9E3779B97F4A7C15L ^ y * 0xC2B2AE3D27D4EB4FL ^ seed * 0x165667B19E3779F9L;
		value ^= value >>> 33;
		value *= 0xFF51AFD7ED558CCDL;
		value ^= value >>> 29;
		value *= 0xC4CEB9FE1A85EC53L;
		value ^= value >>> 32;
		return (float) ((value >>> 11) / (double) (1L << 53));
	}

	private static int sample(float position) {
		for (int index = 1; index < SKY_STOPS.length; index++) {
			if (position <= SKY_STOPS[index]) {
				float span = SKY_STOPS[index] - SKY_STOPS[index - 1];
				float ratio = span <= 0.0F ? 0.0F : (position - SKY_STOPS[index - 1]) / span;
				return mix(SKY_COLOURS[index - 1], SKY_COLOURS[index], ratio);
			}
		}
		return SKY_COLOURS[SKY_COLOURS.length - 1];
	}

	private static void plot(int[] pixels, int x, int y, int colour, float strength) {
		if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT || strength <= 0.0F) {
			return;
		}
		int index = y * WIDTH + x;
		pixels[index] = mix(pixels[index], colour, strength);
	}

	private static int mix(int from, int to, float ratio) {
		float clamped = clamp(ratio);
		int red = channel((from >> 16) & 0xFF, (to >> 16) & 0xFF, clamped);
		int green = channel((from >> 8) & 0xFF, (to >> 8) & 0xFF, clamped);
		int blue = channel(from & 0xFF, to & 0xFF, clamped);
		return (red << 16) | (green << 8) | blue;
	}

	private static int channel(int from, int to, float ratio) {
		int value = Math.round(from + (to - from) * ratio);
		return Math.max(0, Math.min(255, value));
	}

	private static float clamp(float value) {
		return Math.max(0.0F, Math.min(1.0F, value));
	}
}
