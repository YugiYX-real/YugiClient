/*
 * Reads a Blockbench model in the browser and reduces it to the small fixed shape the client builds
 * a model from.
 *
 * A .bbmodel and a Minecraft model .json are both json with a list of boxes in them, so the panel
 * accepts either and the mod never has to know about Blockbench at all. Coordinates come out in the
 * space Minecraft entity models use, where y grows downwards, so the mod can hand them straight to
 * a model builder.
 *
 * A piece is often drawn as several modules, a left wing and a right wing and a harness, each saved
 * to its own file. Several files are read and joined into one model here, so the client still gets
 * one list of boxes and one texture. They have to be drawn against the same texture sheet, because
 * a cosmetic wears one png.
 *
 * An animated cosmetic is one tall png with the frames stacked in it and an animation mcmeta beside
 * it, which is the same pair Minecraft uses for its own animated textures. That is why painting
 * takes a frame number: the picture of one frame is a window down the strip.
 *
 * This hangs off the window rather than a bare const so the other scripts on the page can reach it.
 */

window.HalcyonModel = (() => {
	const FORMAT = "halcyon-model-1"
	const MAX_CUBES = 128
	const MAX_FRAMES = 64

	function round(value) {
		return Math.round(Number(value) * 1000) / 1000
	}

	function triple(value) {
		return Array.isArray(value) && value.length >= 3 && value.every((entry) => Number.isFinite(Number(entry)))
	}

	/** Where a box takes its picture from, in texture pixels. */
	function uvOf(element) {
		if (triple([...(element.uv_offset ?? []), 0])) {
			return [Number(element.uv_offset[0]), Number(element.uv_offset[1])]
		}

		const north = element.faces?.north?.uv
		if (Array.isArray(north) && north.length >= 2) {
			// Per face uv gives the picture of one face rather than a box layout, so the box origin
			// is the front face shifted back by the depth of the box. That is exactly right for a
			// flat piece and close enough for anything thicker.
			const depth = Math.abs(Number(element.to?.[2] ?? 0) - Number(element.from?.[2] ?? 0))
			return [Math.max(0, Number(north[0]) - depth), Math.max(0, Number(north[1]) - depth)]
		}
		return [0, 0]
	}

	/**
	 * Turns parsed json into the client shape.
	 *
	 * Throws with a plain sentence when the file is not a model, because that message is shown to
	 * whoever is publishing rather than swallowed.
	 */
	function normalise(json) {
		if (json === null || typeof json !== "object") {
			throw new Error("that file is not a model")
		}

		const elements = Array.isArray(json.elements)
			? json.elements
			: Array.isArray(json.cubes)
				? json.cubes
				: []
		if (elements.length === 0) {
			throw new Error("that model has no boxes in it")
		}

		const resolution = json.resolution ?? {}
		const size = Array.isArray(json.texture_size) ? json.texture_size : []
		const textureWidth = Math.max(1, Number(resolution.width ?? size[0] ?? 64))
		const textureHeight = Math.max(1, Number(resolution.height ?? size[1] ?? 64))

		const cubes = []
		for (const element of elements) {
			if (element === null || typeof element !== "object") {
				continue
			}
			// Blockbench keeps groups, locators and meshes in the same list. Only boxes have both
			// corners, so anything else is skipped rather than guessed at.
			if (!triple(element.from) || !triple(element.to)) {
				continue
			}
			if (element.visibility === false || element.export === false) {
				continue
			}

			const from = element.from.map(Number)
			const to = element.to.map(Number)
			const width = Math.abs(to[0] - from[0])
			const height = Math.abs(to[1] - from[1])
			const depth = Math.abs(to[2] - from[2])
			const uv = uvOf(element)

			cubes.push({
				name: typeof element.name === "string" ? element.name.slice(0, 40) : "",
				// Entity model space has y growing downwards, so the top corner of the box is the
				// negated upper edge of what was authored.
				x: round(Math.min(from[0], to[0])),
				y: round(-Math.max(from[1], to[1])),
				z: round(Math.min(from[2], to[2])),
				width: round(width),
				height: round(height),
				depth: round(depth),
				u: round(uv[0]),
				v: round(uv[1]),
				inflate: round(Number(element.inflate ?? 0)),
			})

			if (cubes.length === MAX_CUBES) {
				break
			}
		}

		if (cubes.length === 0) {
			throw new Error("that model has no boxes the client can build")
		}

		return { format: FORMAT, textureWidth, textureHeight, cubes }
	}

	/** The part of a file name that is worth keeping in front of a box name. */
	function stem(name) {
		return String(name ?? "")
			.replace(/\.[A-Za-z0-9]+$/, "")
			.slice(0, 20)
	}

	/**
	 * Joins several modules into the one model a cosmetic is.
	 *
	 * Every module has to be drawn against the same texture sheet, because the piece wears a single
	 * png and a box takes its picture out of that sheet by pixel. Mixing sheets would quietly paint
	 * the wrong pixels on half the piece, so it is refused with a sentence that says which two files
	 * disagree.
	 */
	function merge(parts) {
		const list = (parts ?? []).filter((part) => part !== null && part !== undefined)
		if (list.length === 0) {
			throw new Error("no model file was picked")
		}
		if (list.length === 1) {
			return list[0].model
		}

		const first = list[0]
		const cubes = []
		let dropped = 0

		for (const part of list) {
			if (
				part.model.textureWidth !== first.model.textureWidth ||
				part.model.textureHeight !== first.model.textureHeight
			) {
				throw new Error(
					`${part.name} is drawn against a ${part.model.textureWidth}x${part.model.textureHeight} texture ` +
						`but ${first.name} uses ${first.model.textureWidth}x${first.model.textureHeight}, ` +
						"and one cosmetic wears one png",
				)
			}

			for (const cube of part.model.cubes) {
				if (cubes.length >= MAX_CUBES) {
					dropped += 1
					continue
				}
				// The file a box came from is kept in front of its name, so a left wing and a right
				// wing that both hold a box called "feather" stay tellable apart.
				const label = cube.name === "" ? stem(part.name) : `${stem(part.name)}/${cube.name}`
				cubes.push({ ...cube, name: label.slice(0, 40) })
			}
		}

		if (dropped > 0) {
			throw new Error(
				`those files hold more than ${MAX_CUBES} boxes together, which is more than the client builds`,
			)
		}

		return {
			format: FORMAT,
			textureWidth: first.model.textureWidth,
			textureHeight: first.model.textureHeight,
			cubes,
		}
	}

	/** Reads a picked .bbmodel or .json file. */
	async function fromFile(file) {
		const text = await file.text()
		let json = null
		try {
			json = JSON.parse(text)
		} catch {
			throw new Error("that file is not readable json")
		}
		return normalise(json)
	}

	/**
	 * Reads every picked model file and joins them into one piece.
	 *
	 * A file that cannot be read says which file it was, because picking six modules and being told
	 * only "that file is not a model" is useless.
	 */
	async function fromFiles(files) {
		const list = Array.from(files ?? [])
		if (list.length === 0) {
			throw new Error("no model file was picked")
		}

		const parts = []
		for (const file of list) {
			try {
				parts.push({ name: file.name, model: await fromFile(file) })
			} catch (error) {
				throw new Error(list.length === 1 ? error.message : `${file.name}: ${error.message}`)
			}
		}
		return merge(parts)
	}

	/**
	 * Reads an animation mcmeta and returns the animation block, cleaned, together with how long one
	 * frame lasts in milliseconds.
	 *
	 * Minecraft counts frametime in ticks, and a tick is fifty milliseconds, which is the only sum
	 * in here. Nothing else about the file is invented: an mcmeta written for a normal Minecraft
	 * texture works unchanged.
	 */
	async function mcmetaFromFile(file) {
		const text = await file.text()
		let json = null
		try {
			json = JSON.parse(text)
		} catch {
			throw new Error("that mcmeta file is not readable json")
		}

		const animation = json === null || typeof json !== "object" ? null : json.animation
		if (animation === null || animation === undefined || typeof animation !== "object") {
			throw new Error("that mcmeta file has no animation block in it")
		}

		const raw = Number(animation.frametime ?? 1)
		const frametime = Number.isFinite(raw) && raw > 0 ? Math.min(200, Math.round(raw)) : 1
		return {
			mcmeta: {
				animation: {
					frametime,
					interpolate: animation.interpolate === true,
				},
			},
			frametime,
			frameMs: Math.max(20, frametime * 50),
		}
	}

	/**
	 * How many frames a picture holds.
	 *
	 * One frame is as tall as the sheet the model was drawn against, so a 64 by 64 model with a 64 by
	 * 512 png has eight frames. Without a model the picture is worn flat like a cape, where the sheet
	 * is twice as wide as it is tall.
	 */
	function frames(model, image) {
		if (image === null || image === undefined) {
			return 1
		}

		const unit =
			model === null || model === undefined
				? Math.max(1, Math.round(image.naturalWidth / 2))
				: Math.max(1, model.textureHeight)
		const count = Math.round(image.naturalHeight / unit)
		return Math.max(1, Math.min(MAX_FRAMES, count))
	}

	/** The box every cube of the model fits inside, used to fit a preview on screen. */
	function bounds(model) {
		let left = Infinity
		let right = -Infinity
		let top = Infinity
		let bottom = -Infinity

		for (const cube of model.cubes) {
			left = Math.min(left, cube.x)
			right = Math.max(right, cube.x + cube.width)
			top = Math.min(top, cube.y)
			bottom = Math.max(bottom, cube.y + cube.height)
		}

		return { left, right, top, bottom, width: right - left, height: bottom - top }
	}

	/**
	 * Draws the model from the front onto a canvas, taking every box's picture out of the texture.
	 *
	 * This is a flat front view rather than a rotating three dimensional one, which is what makes it
	 * honest: it shows the actual pixels the game will put on those boxes, at the actual proportions,
	 * without pretending to be the renderer.
	 *
	 * The options are the frame count of the strip and which frame to draw, so calling this on a
	 * timer plays the animation.
	 */
	function paint(canvas, model, image, options) {
		const settings = options ?? {}
		const total = Math.max(1, Math.round(Number(settings.frames ?? 1)))
		const index = Math.max(0, Math.min(total - 1, Math.round(Number(settings.frame ?? 0))))

		const context = canvas.getContext("2d")
		context.clearRect(0, 0, canvas.width, canvas.height)
		context.imageSmoothingEnabled = false

		const box = bounds(model)
		const margin = 10
		const scale = Math.max(
			1,
			Math.min(
				(canvas.width - margin * 2) / Math.max(1, box.width),
				(canvas.height - margin * 2) / Math.max(1, box.height),
			),
		)
		const originX = (canvas.width - box.width * scale) / 2 - box.left * scale
		const originY = (canvas.height - box.height * scale) / 2 - box.top * scale

		// One frame of the strip is the sheet the model was drawn against.
		const sheetWidth = image === null ? model.textureWidth : image.naturalWidth
		const sheetHeight = image === null ? model.textureHeight : image.naturalHeight / total
		const top = index * sheetHeight
		const perX = sheetWidth / model.textureWidth
		const perY = sheetHeight / model.textureHeight

		// Boxes further back are drawn first, so a wing behind a body panel does not cover it.
		const ordered = [...model.cubes].sort((left, right) => right.z - left.z)
		for (const cube of ordered) {
			const target = [
				originX + cube.x * scale,
				originY + cube.y * scale,
				Math.max(1, cube.width * scale),
				Math.max(1, cube.height * scale),
			]

			if (image === null || cube.width === 0 || cube.height === 0) {
				context.fillStyle = "rgba(124, 92, 255, 0.35)"
				context.fillRect(target[0], target[1], target[2], target[3])
				continue
			}

			// The front face of a box uv sheet sits one depth in and one depth down.
			const sourceX = (cube.u + cube.depth) * perX
			const sourceY = top + (cube.v + cube.depth) * perY
			const sourceW = cube.width * perX
			const sourceH = cube.height * perY

			try {
				context.drawImage(
					image,
					sourceX,
					sourceY,
					Math.max(1, sourceW),
					Math.max(1, sourceH),
					target[0],
					target[1],
					target[2],
					target[3],
				)
			} catch {
				context.fillStyle = "rgba(124, 92, 255, 0.35)"
				context.fillRect(target[0], target[1], target[2], target[3])
			}
		}
	}

	/** Draws one frame of a picture that has no model, which is worn flat like a cape. */
	function paintFlat(canvas, image, options) {
		const settings = options ?? {}
		const total = Math.max(1, Math.round(Number(settings.frames ?? 1)))
		const index = Math.max(0, Math.min(total - 1, Math.round(Number(settings.frame ?? 0))))

		const context = canvas.getContext("2d")
		context.clearRect(0, 0, canvas.width, canvas.height)
		context.imageSmoothingEnabled = false
		if (image === null || image === undefined) {
			return
		}

		const sheetHeight = image.naturalHeight / total
		const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / sheetHeight)
		const width = image.naturalWidth * scale
		const height = sheetHeight * scale

		context.drawImage(
			image,
			0,
			index * sheetHeight,
			image.naturalWidth,
			sheetHeight,
			(canvas.width - width) / 2,
			(canvas.height - height) / 2,
			width,
			height,
		)
	}

	/** One sentence about a model, shown next to the preview. */
	function describe(model) {
		const box = bounds(model)
		const count = model.cubes.length
		return (
			`${count} ${count === 1 ? "box" : "boxes"}, ` +
			`${round(box.width)} by ${round(box.height)} pixels, ` +
			`texture ${model.textureWidth}x${model.textureHeight}`
		)
	}

	return {
		FORMAT,
		MAX_CUBES,
		MAX_FRAMES,
		normalise,
		merge,
		fromFile,
		fromFiles,
		mcmetaFromFile,
		frames,
		bounds,
		paint,
		paintFlat,
		describe,
	}
})()
