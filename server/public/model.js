/*
 * Reads a model in the browser and reduces it to the small fixed shape the client builds from.
 *
 * A .bbmodel and a Minecraft model .json are both json with a list of boxes in them, so the panel
 * accepts either and the mod never has to know about Blockbench at all. A .gltf and a .glb are read
 * as well, with one caveat that is stated plainly rather than hidden: glTF is a triangle mesh
 * format and the game builds boxes, so every mesh part comes across as the box it fits inside.
 * Coordinates come out in the space Minecraft entity models use, where y grows downwards, so the
 * mod can hand them straight to a model builder.
 *
 * A piece is often drawn as several modules, a left wing and a right wing and a harness, each saved
 * to its own file. Several files are read and joined into one model here, so the client still gets
 * one list of boxes and one texture. They have to be drawn against the same texture sheet, because
 * a cosmetic wears one png.
 *
 * An animated cosmetic is one tall png with the frames stacked in it and an animation mcmeta beside
 * it, which is the same pair Minecraft uses for its own animated textures. Several pngs picked at
 * once are stacked into that strip here, so drawing frame by frame is enough and nobody has to
 * assemble a sheet by hand. That is also why painting takes a frame number: the picture of one
 * frame is a window down the strip.
 *
 * This hangs off the window rather than a bare const so the other scripts on the page can reach it.
 */

window.HalcyonModel = (() => {
	const FORMAT = "halcyon-model-1"
	const MAX_CUBES = 128
	const MAX_FRAMES = 64

	/** The file endings a model can be read out of. */
	const MODEL_EXTENSIONS = [".bbmodel", ".json", ".gltf", ".glb"]

	function round(value) {
		return Math.round(Number(value) * 1000) / 1000
	}

	function triple(value) {
		return Array.isArray(value) && value.length >= 3 && value.every((entry) => Number.isFinite(Number(entry)))
	}

	/** A texture sheet size, kept sane and falling back to the usual 64. */
	function sheet(value) {
		const size = Math.round(Number(value))
		return Number.isFinite(size) && size > 0 ? Math.min(4096, size) : 64
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

	/** True for the two glTF endings, which are read differently from the json models. */
	function isGltfName(name) {
		return /\.(gltf|glb)$/i.test(String(name ?? ""))
	}

	/**
	 * Pulls the json description out of a picked glTF file.
	 *
	 * A .gltf is json already. A .glb is a tiny container: twelve bytes of header and then chunks,
	 * the first of which is that same json. Only the json is needed here, because every glTF writes
	 * the corner points of a mesh into the accessor that holds its positions, so the boxes can be
	 * worked out without ever touching the binary vertex data.
	 */
	async function gltfJson(file) {
		if (/\.gltf$/i.test(String(file.name ?? ""))) {
			const text = await file.text()
			try {
				return JSON.parse(text)
			} catch {
				throw new Error("that gltf is not readable json")
			}
		}

		const buffer = await file.arrayBuffer()
		if (buffer.byteLength < 20) {
			throw new Error("that glb is too short to hold a model")
		}

		const view = new DataView(buffer)
		if (view.getUint32(0, true) !== 0x46546c67) {
			throw new Error("that file does not start like a glb")
		}

		let offset = 12
		while (offset + 8 <= buffer.byteLength) {
			const length = view.getUint32(offset, true)
			const kind = view.getUint32(offset + 4, true)
			if (kind === 0x4e4f534a) {
				const text = new TextDecoder().decode(new Uint8Array(buffer, offset + 8, length))
				try {
					return JSON.parse(text)
				} catch {
					throw new Error("the json inside that glb could not be read")
				}
			}
			offset += 8 + length
		}
		throw new Error("that glb holds no json chunk")
	}

	/** The corner points an accessor declares, which every exporter writes for positions. */
	function accessorBox(json, index) {
		if (!Number.isInteger(index)) {
			return null
		}

		const accessor = (json.accessors ?? [])[index]
		if (accessor === undefined || accessor === null) {
			return null
		}
		if (!Array.isArray(accessor.min) || !Array.isArray(accessor.max)) {
			return null
		}
		if (accessor.min.length < 2 || accessor.max.length < 2) {
			return null
		}
		return { min: accessor.min.map(Number), max: accessor.max.map(Number) }
	}

	/**
	 * How far a node moves and how much it grows what is under it.
	 *
	 * Turning is deliberately ignored: a box that has been turned is no longer a box, and quietly
	 * pretending otherwise would place the piece somewhere it was never drawn. Draw the piece the way
	 * round it should be worn and it comes across unchanged.
	 */
	function nodeTransform(node) {
		if (Array.isArray(node.matrix) && node.matrix.length === 16) {
			const cells = node.matrix.map(Number)
			return {
				scale: [
					Math.hypot(cells[0], cells[1], cells[2]) || 1,
					Math.hypot(cells[4], cells[5], cells[6]) || 1,
					Math.hypot(cells[8], cells[9], cells[10]) || 1,
				],
				move: [cells[12], cells[13], cells[14]],
			}
		}

		return {
			scale: triple(node.scale) ? node.scale.map(Number) : [1, 1, 1],
			move: triple(node.translation) ? node.translation.map(Number) : [0, 0, 0],
		}
	}

	/** Walks the scene and returns one entry per mesh part, with where it sits in the world. */
	function gltfBoxes(json) {
		const nodes = json.nodes ?? []
		const found = []
		const seen = new Set()

		const collect = (meshIndex, world, label) => {
			const mesh = (json.meshes ?? [])[meshIndex]
			if (mesh === undefined || mesh === null) {
				return
			}

			const primitives = Array.isArray(mesh.primitives) ? mesh.primitives : []
			for (let index = 0; index < primitives.length; index += 1) {
				const primitive = primitives[index] ?? {}
				const attributes = primitive.attributes ?? {}
				const position = accessorBox(json, attributes.POSITION)
				if (position === null) {
					continue
				}
				found.push({
					name: primitives.length === 1 ? label : `${label}/${index}`,
					position,
					uv: accessorBox(json, attributes.TEXCOORD_0),
					world,
				})
			}
		}

		const walk = (index, parent) => {
			const node = nodes[index]
			if (node === undefined || node === null || seen.has(index)) {
				return
			}
			seen.add(index)

			const local = nodeTransform(node)
			const world = {
				scale: [0, 1, 2].map((axis) => parent.scale[axis] * local.scale[axis]),
				move: [0, 1, 2].map((axis) => parent.move[axis] + parent.scale[axis] * local.move[axis]),
			}

			if (Number.isInteger(node.mesh)) {
				const label =
					typeof node.name === "string" && node.name !== "" ? node.name : `part${index}`
				collect(node.mesh, world, label)
			}
			for (const child of node.children ?? []) {
				walk(child, world)
			}
		}

		const origin = { scale: [1, 1, 1], move: [0, 0, 0] }
		const scene = (json.scenes ?? [])[Number.isInteger(json.scene) ? json.scene : 0]
		if (scene !== undefined && scene !== null && Array.isArray(scene.nodes)) {
			for (const index of scene.nodes) {
				walk(index, origin)
			}
		}
		// Anything the scene did not reach is still worth having, and walking it twice is blocked by
		// the set of nodes already seen.
		for (let index = 0; index < nodes.length; index += 1) {
			walk(index, origin)
		}
		return found
	}

	/**
	 * Turns a glTF into the client shape.
	 *
	 * Every mesh part comes across as the box it fits inside, because that is the honest translation
	 * between a triangle mesh and a model made of boxes. A piece drawn as a handful of parts, which
	 * is how wings are usually built, survives that very well; a single sculpted mesh comes out as
	 * one plain box, and .bbmodel stays the exact route.
	 */
	function normaliseGltf(json) {
		if (json === null || typeof json !== "object") {
			throw new Error("that file is not a model")
		}

		const parts = gltfBoxes(json)
		if (parts.length === 0) {
			throw new Error("that gltf holds no mesh with corner points in it, so there is nothing to build")
		}

		const corners = parts.map((part) => ({
			name: part.name,
			min: [0, 1, 2].map(
				(axis) => part.world.move[axis] + part.world.scale[axis] * Number(part.position.min[axis] ?? 0),
			),
			max: [0, 1, 2].map(
				(axis) => part.world.move[axis] + part.world.scale[axis] * Number(part.position.max[axis] ?? 0),
			),
			uv: part.uv,
		}))

		let extent = 0
		for (const box of corners) {
			for (const axis of [0, 1, 2]) {
				extent = Math.max(extent, box.max[axis] - box.min[axis])
			}
		}

		// glTF is written in metres and a block is a metre, so a piece drawn at world size is turned
		// into model pixels, sixteen to a block. A piece already drawn in pixels, which is what comes
		// out of Blockbench, is left as it is.
		const perUnit = extent > 0 && extent <= 8 ? 16 : 1

		const extras = json.extras ?? {}
		const textureWidth = sheet(extras.textureWidth ?? extras.texture_width)
		const textureHeight = sheet(extras.textureHeight ?? extras.texture_height)

		const cubes = []
		for (const box of corners) {
			const uv =
				box.uv === null
					? [0, 0]
					: [
							round(Math.max(0, Math.min(1, box.uv.min[0])) * textureWidth),
							round(Math.max(0, Math.min(1, box.uv.min[1])) * textureHeight),
						]

			cubes.push({
				name: String(box.name).slice(0, 40),
				x: round(box.min[0] * perUnit),
				// glTF has y growing upwards like Blockbench, and entity model space has it growing
				// downwards, so the top corner is negated exactly as it is for a .bbmodel.
				y: round(-box.max[1] * perUnit),
				z: round(box.min[2] * perUnit),
				width: round((box.max[0] - box.min[0]) * perUnit),
				height: round((box.max[1] - box.min[1]) * perUnit),
				depth: round((box.max[2] - box.min[2]) * perUnit),
				u: uv[0],
				v: uv[1],
				inflate: 0,
			})

			if (cubes.length === MAX_CUBES) {
				break
			}
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

	/** Reads one picked model file, whichever of the four endings it has. */
	async function fromFile(file) {
		if (isGltfName(file.name)) {
			return normaliseGltf(await gltfJson(file))
		}

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
	 * Stacks several pictures into the one tall strip an animation is.
	 *
	 * Every frame has to be the same size, because a strip is read by cutting it into equal slices,
	 * and a frame of a different size would shift every frame after it. The result is a png blob
	 * ready to upload, so nobody has to assemble a sheet in an image editor.
	 */
	async function strip(images) {
		const list = Array.from(images ?? [])
		if (list.length === 0) {
			throw new Error("no picture was picked")
		}
		if (list.length > MAX_FRAMES) {
			throw new Error(`an animation holds at most ${MAX_FRAMES} frames`)
		}

		const width = list[0].naturalWidth
		const height = list[0].naturalHeight
		for (const image of list) {
			if (image.naturalWidth !== width || image.naturalHeight !== height) {
				throw new Error(
					`every frame has to be the same size, and this one is ${image.naturalWidth}x${image.naturalHeight} ` +
						`while the first is ${width}x${height}`,
				)
			}
		}

		const canvas = document.createElement("canvas")
		canvas.width = width
		canvas.height = height * list.length

		const context = canvas.getContext("2d")
		context.imageSmoothingEnabled = false
		for (let index = 0; index < list.length; index += 1) {
			context.drawImage(list[index], 0, index * height)
		}

		const blob = await new Promise((resolve, reject) => {
			canvas.toBlob((made) => {
				if (made === null) {
					reject(new Error("the frames could not be joined into one picture"))
					return
				}
				resolve(made)
			}, "image/png")
		})

		return { blob, width, height: height * list.length, frames: list.length }
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

	/** The mcmeta written for an animation that was stacked here rather than picked. */
	function mcmetaFor(frametime) {
		const ticks = Number.isFinite(Number(frametime)) && Number(frametime) > 0 ? Math.min(200, Math.round(Number(frametime))) : 2
		return {
			mcmeta: { animation: { frametime: ticks, interpolate: false } },
			frametime: ticks,
			frameMs: Math.max(20, ticks * 50),
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
		MODEL_EXTENSIONS,
		normalise,
		normaliseGltf,
		merge,
		fromFile,
		fromFiles,
		strip,
		mcmetaFromFile,
		mcmetaFor,
		frames,
		bounds,
		paint,
		paintFlat,
		describe,
	}
})()
