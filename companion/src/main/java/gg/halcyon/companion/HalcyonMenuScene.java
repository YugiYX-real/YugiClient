package gg.halcyon.companion;

import net.minecraft.client.texture.NativeImage;

import java.util.Random;

/**
 * Paints the default main menu background.
 *
 * <p>A fresh install has no picture in the config folder, so the menu would otherwise fall back to
 * a flat gradient. This paints a dusk scene instead: a warm horizon behind layered hills, a lake
 * that catches the light, a drift of blossom petals and a field of stars. Generating it in code
 * keeps the mod free of binary assets, and it is built once per session, so it costs nothing while
 * the menu is on screen. Dropping a png in the config folder still wins over this.
 */
public final class HalcyonMenuScene {
	private static final int WIDTH = 512;

	private static final int HEIGHT = 288;

	private static final float HORIZON = 0.68F;

	private static final float[] STOPS = {0.00F, 0.28F, 0.52F, 0.64F, HORIZON, 0.73F, 1.00F};

	private static final int[] COLOURS = {
		0x070714, 0x150F2C, 0x3A1C42, 0x743253, 0xB2566B, 0x2A1832, 0x0B0A18
	};

	private HalcyonMenuScene() {}

	/** Builds the picture. The caller owns the image and hands it to a texture. */
	public static NativeImage paint() {
		int[] pixels = new int[WIDTH * HEIGHT];

		paintSky(pixels);
		paintGlow(pixels);
		paintStars(pixels);
		paintHills(pixels);
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
			int colour = sample((float) y / (float) (HEIGHT - 1));
			for (int x = 0; x < WIDTH; x++) {
				pixels[y * WIDTH + x] = colour;
			}
		}
	}

	/** The sun sitting on the horizon, with a wide soft halo around it. */
	private static void paintGlow(int[] pixels) {
		float centreX = WIDTH * 0.70F;
		float centreY = HEIGHT * HORIZON;
		float radius = WIDTH * 0.36F;
		float disc = WIDTH * 0.042F;

		for (int y = 0; y < HEIGHT; y++) {
			for (int x = 0; x < WIDTH; x++) {
				float dx = (x - centreX) / radius;
				float dy = (y - centreY) / (radius * 0.60F);
				float distance = (float) Math.sqrt(dx * dx + dy * dy);
				int index = y * WIDTH + x;

				if (distance < 1.0F) {
					float falloff = 1.0F - distance;
					pixels[index] = mix(pixels[index], 0xFFC98A, falloff * falloff * 0.80F);
				}

				float toCentre = (float) Math.sqrt(
						(x - centreX) * (x - centreX) + (y - centreY) * (y - centreY));
				if (toCentre < disc) {
					pixels[index] = mix(pixels[index], 0xFFEBCB, 1.0F - toCentre / disc);
				}
			}
		}
	}

	private static void paintStars(int[] pixels) {
		Random random = new Random(0x48414C43L);
		float ceiling = HEIGHT * 0.58F;

		for (int count = 0; count < 320; count++) {
			int x = random.nextInt(WIDTH);
			int y = random.nextInt((int) ceiling);
			float fade = 1.0F - y / ceiling;
			float strength = (0.25F + random.nextFloat() * 0.75F) * fade;

			plot(pixels, x, y, 0xFFFFFF, strength);
			if (random.nextInt(9) == 0) {
				plot(pixels, x + 1, y, 0xFFFFFF, strength * 0.45F);
				plot(pixels, x, y + 1, 0xFFFFFF, strength * 0.45F);
			}
		}
	}

	/** Three ridges, each one darker and closer than the last. */
	private static void paintHills(int[] pixels) {
		int[] tints = {0x2A1A38, 0x1A1029, 0x0E0A1B};
		float[] bases = {0.58F, 0.64F, 0.70F};
		float[] amplitudes = {0.045F, 0.055F, 0.070F};
		float[] frequencies = {0.014F, 0.020F, 0.009F};
		float[] phases = {0.0F, 1.9F, 3.4F};

		for (int layer = 0; layer < tints.length; layer++) {
			for (int x = 0; x < WIDTH; x++) {
				double wave = Math.sin(x * frequencies[layer] + phases[layer])
						+ 0.45 * Math.sin(x * frequencies[layer] * 2.7 + phases[layer] * 1.7);
				int ridge = (int) (HEIGHT * (bases[layer] - amplitudes[layer] * (float) wave));

				for (int y = Math.max(0, ridge); y < HEIGHT; y++) {
					float depth = Math.min(1.0F, (y - ridge) / 26.0F);
					int index = y * WIDTH + x;
					pixels[index] = mix(pixels[index], tints[layer], 0.70F + depth * 0.30F);
				}
			}
		}
	}

	/** A lake below the ridges, mirroring the sky and breaking the light into streaks. */
	private static void paintWater(int[] pixels) {
		int surface = (int) (HEIGHT * 0.78F);
		int span = Math.max(1, HEIGHT - surface);

		for (int y = surface; y < HEIGHT; y++) {
			float depth = (float) (y - surface) / (float) span;
			int mirrored = sample(Math.max(0.0F, HORIZON - depth * 0.28F));
			int colour = mix(mirrored, 0x0A0A18, 0.40F + depth * 0.40F);
			for (int x = 0; x < WIDTH; x++) {
				pixels[y * WIDTH + x] = colour;
			}
		}

		Random random = new Random(0x59554749L);
		for (int count = 0; count < 140; count++) {
			int y = surface + random.nextInt(span);
			int x = random.nextInt(WIDTH);
			int length = 6 + random.nextInt(30);
			float depth = (float) (y - surface) / (float) span;
			float strength = (0.16F + random.nextFloat() * 0.26F) * (1.0F - depth * 0.70F);

			for (int step = 0; step < length; step++) {
				plot(pixels, x + step, y, 0xE8A98C, strength);
			}
		}
	}

	private static void paintPetals(int[] pixels) {
		Random random = new Random(0x424C4F4DL);

		for (int count = 0; count < 150; count++) {
			int x = random.nextInt(WIDTH);
			int y = random.nextInt(HEIGHT);
			float strength = 0.18F + random.nextFloat() * 0.50F;
			int colour = random.nextInt(3) == 0 ? 0xFFD9E8 : 0xF3A9C6;

			plot(pixels, x, y, colour, strength);
			plot(pixels, x + 1, y, colour, strength * 0.70F);
			plot(pixels, x, y + 1, colour, strength * 0.55F);
			if (random.nextInt(4) == 0) {
				plot(pixels, x + 1, y + 1, colour, strength * 0.40F);
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
				float strength = Math.min(0.70F, Math.max(0.0F, distance - 0.45F) * 0.90F);
				int index = y * WIDTH + x;
				pixels[index] = mix(pixels[index], 0x05050C, strength);
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
