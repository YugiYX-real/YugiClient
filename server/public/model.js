/*
 * Reads a model in the browser, reduces it to the small fixed shape the client builds from, and
 * shows it the way it will actually be worn.
 *
 * There is no single model file in Minecraft, there are four, and a wing can arrive as any of them:
 * a Blockbench .bbmodel, a Java model .json, a Bedrock geometry .json (which is what Blockbench
 * writes by default and what most wings on the internet are) and an OptiFine .jem. They disagree
 * about almost everything, including where the boxes live: a .bbmodel keeps them in a flat list at
 * the top, a Bedrock geometry buries them under a geometry entry and a list of bones, and a .jem
 * puts them under models and submodels. So the reader walks the whole file and picks up every box
 * it recognises, wherever it is: a pair of corners, a Bedrock origin and size, a .jem coordinates
 * list, or the corner points of a mesh.
 *
 * A .gltf and a .glb are read as well, with one caveat that is stated plainly rather than hidden:
 * glTF is a triangle mesh format and the game builds boxes, so every mesh part comes across as the
 * box it fits inside. Coordinates come out in the space Minecraft entity models use, where y grows
 * downwards, so the mod can hand them straight to a model builder. Turning is deliberately ignored
 * everywhere, because a box that has been turned is no longer a box.
 *
 * The preview turns the piece in three dimensions, textured, next to a ghost of a player body, and
 * can be dragged with the mouse. That is the point of it: a wing is judged by how big it is next to
 * a player and how far it sticks out behind one, and a flat picture of the front faces answers
 * neither question. It is not a copy of Blockbench and does not try to be one; it draws exactly the
 * pixels the game will put on those boxes, at the size and place the game will put them.
 *
 * A piece is often drawn as several modules, a left wing and a right wing and a harness, each saved
 * to its own file. Several files are read and joined into one model here. They have to be drawn
 * against the same texture sheet, because a cosmetic wears one png.
 *
 * An animated cosmetic is one tall png with the frames stacked in it and an animation mcmeta beside
 * it, which is the same pair Minecraft uses for its own animated textures. Several pngs picked at
 * once are stacked into that strip here, and frames that were saved at different sizes are fitted
 * onto the largest one rather than refused, because a 32 by 32 frame among 64 by 64 frames is a
 * normal thing to have in a folder and is not a reason to send someone back to an image editor.
 *
 * This hangs off the window rather than a bare const so the other scripts on the page can reach it.
 */

window.HalcyonModel = (() => {
	const FORMAT = "halcyon-model-1"
	const MAX_CUBES = 128
	const MAX_FRAMES = 64

	/** How deep into a file the walk goes before it gives up, which no model comes close to. */
	const MAX_DEPTH = 16

	/** How fast the preview turns on its own, in radians a second. */
	const SPIN = 0.5

	/** The file endings a model can be read out of. */
	const MODEL_EXTENSIONS = [".bbmodel", ".json", ".geo.json", ".jem", ".gltf", ".glb"]

	/**
	 * Keys that never hold geometry and can be expensive to walk.
	 *
	 * A .bbmodel keeps every texture in the file as a base64 string under "textures", so skipping it
	 * is the difference between reading a wing instantly and chewing through megabytes of picture.
	 */
	const SKIP_KEYS = new Set(["textures", "animations", "animation", "display", "history", "meta", "sounds", "particle_effects", "sound_effects"])

	/** The preview state of every canvas that has been drawn on, so a redraw keeps the angle. */
	const views = new WeakMap()

	function round(value) {
		return Math.round(Number(value) * 1000) / 1000
	}

	function triple(value) {
		return Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every((entry) => Number.isFinite(Number(entry)))
	}

	function pair(value) {
		return Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every((entry) => Number.isFinite(Number(entry)))
	}

	function positive(value) {
		const number = Number(value)
		return Number.isFinite(number) && number > 0
	}

	function clamp(value, low, high) {
		return Math.max(low, Math.min(high, value))
	}

	/** A texture sheet size, kept sane and falling back to the usual 64. */
	function sheet(value) {
		const size = Math.round(Number(value))
		return Number.isFinite(size) && size > 0 ? Math.min(4096, size) : 64
	}

	/**
	 * Where a box takes its picture from, in texture pixels, for a box written as two corners.
	 *
	 * Blockbench writes a box uv offset when the project uses box uv, and a uv per face when it does
	 * not. A per face uv gives the picture of one face rather than a box layout, so the box origin is
	 * the front face shifted back by the depth of the box. That is exactly right for a flat piece and
	 * close enough for anything thicker.
	 */
	function uvOf(element, depth) {
		if (pair(element.uv_offset)) {
			return [Number(element.uv_offset[0]), Number(element.uv_offset[1])]
		}
		if (pair(element.uv)) {
			return [Number(element.uv[0]), Number(element.uv[1])]
		}

		const north = element.faces?.north?.uv ?? element.uv?.north?.uv
		if (pair(north)) {
			return [Math.max(0, Number(north[0]) - depth), Math.max(0, Number(north[1]) - depth)]
		}
		return [0, 0]
	}

	/**
	 * One box in the shape the client builds from.
	 *
	 * Entity model space has y growing downwards, so a file authored the usual way round, with y
	 * growing upwards, has its top corner negated. A .jem is already written in entity space and is
	 * taken as it stands, which is what the upwards flag is for.
	 */
	function boxOf(name, from, to, uv, inflate, upwards) {
		const low = [0, 1, 2].map((axis) => Math.min(Number(from[axis]), Number(to[axis])))
		const high = [0, 1, 2].map((axis) => Math.max(Number(from[axis]), Number(to[axis])))

		return {
			name: String(name ?? "").slice(0, 40),
			x: round(low[0]),
			y: round(upwards ? -high[1] : low[1]),
			z: round(low[2]),
			width: round(high[0] - low[0]),
			height: round(high[1] - low[1]),
			depth: round(high[2] - low[2]),
			u: round(Math.max(0, Number(uv[0]) || 0)),
			v: round(Math.max(0, Number(uv[1]) || 0)),
			inflate: round(Number(inflate ?? 0) || 0),
		}
	}

	/** The corners a mesh element covers, so a piece drawn with the mesh tool still comes across. */
	function meshCorners(element) {
		const source = element.vertices
		const points = Array.isArray(source)
			? source
			: source !== null && typeof source === "object"
				? Object.values(source)
				: []
		const usable = points.filter((point) => triple(point))
		if (usable.length === 0) {
			return null
		}

		const origin = triple(element.origin) ? element.origin.map(Number) : [0, 0, 0]
		const low = [0, 1, 2].map((axis) => origin[axis] + Math.min(...usable.map((point) => Number(point[axis]))))
		const high = [0, 1, 2].map((axis) => origin[axis] + Math.max(...usable.map((point) => Number(point[axis]))))
		return { from: low, to: high }
	}

	/**
	 * Walks a file and collects every box in it, in whichever of the four shapes it was written.
	 *
	 * Each branch is a different program's idea of a box:
	 *   from and to        a Blockbench .bbmodel or a Java model .json
	 *   origin and size    a Bedrock geometry, whether under bones or anywhere else
	 *   coordinates        an OptiFine .jem, already in entity space
	 *   vertices           a Blockbench mesh, reduced to the box it fits inside
	 */
	function harvest(node, out, depth) {
		if (node === null || typeof node !== "object" || depth > MAX_DEPTH || out.length >= MAX_CUBES) {
			return
		}

		if (Array.isArray(node)) {
			for (const entry of node) {
				harvest(entry, out, depth + 1)
			}
			return
		}

		const hidden = node.visibility === false || node.export === false
		const name = typeof node.name === "string" ? node.name : ""

		if (!hidden) {
			if (triple(node.from) && triple(node.to)) {
				const depthOf = Math.abs(Number(node.to[2]) - Number(node.from[2]))
				out.push(boxOf(name, node.from.map(Number), node.to.map(Number), uvOf(node, depthOf), node.inflate, true))
			} else if (triple(node.origin) && triple(node.size)) {
				const origin = node.origin.map(Number)
				const size = node.size.map(Number)
				const to = [0, 1, 2].map((axis) => origin[axis] + size[axis])
				out.push(boxOf(name, origin, to, uvOf(node, Math.abs(size[2])), node.inflate, true))
			} else if (Array.isArray(node.coordinates) && node.coordinates.length >= 6) {
				const cells = node.coordinates.slice(0, 6).map(Number)
				if (cells.every((cell) => Number.isFinite(cell))) {
					const from = [cells[0], cells[1], cells[2]]
					const to = [cells[0] + cells[3], cells[1] + cells[4], cells[2] + cells[5]]
					const uv = pair(node.textureOffset) ? node.textureOffset : [0, 0]
					out.push(boxOf(name, from, to, uv, node.sizeAdd, false))
				}
			} else if (node.vertices !== undefined && node.vertices !== null) {
				const corners = meshCorners(node)
				if (corners !== null) {
					out.push(boxOf(name, corners.from, corners.to, uvOf(node, 0), 0, true))
				}
			}
		}

		for (const key of Object.keys(node)) {
			if (SKIP_KEYS.has(key)) {
				continue
			}
			harvest(node[key], out, depth + 1)
		}
	}

	/**
	 * Finds the texture sheet the model was drawn against, wherever the format keeps it.
	 *
	 * Blockbench writes resolution, a Java model writes texture_size, a Bedrock geometry writes
	 * texturewidth and textureheight on the geometry or its description, and a .jem writes
	 * textureSize. Nothing found means the usual 64 by 64.
	 */
	function sheetOf(node, depth) {
		if (node === null || typeof node !== "object" || depth > MAX_DEPTH) {
			return null
		}

		if (Array.isArray(node)) {
			for (const entry of node) {
				const found = sheetOf(entry, depth + 1)
				if (found !== null) {
					return found
				}
			}
			return null
		}

		const resolution = node.resolution
		if (resolution !== null && typeof resolution === "object" && positive(resolution.width) && positive(resolution.height)) {
			return [sheet(resolution.width), sheet(resolution.height)]
		}
		if (pair(node.texture_size)) {
			return [sheet(node.texture_size[0]), sheet(node.texture_size[1])]
		}
		if (pair(node.textureSize)) {
			return [sheet(node.textureSize[0]), sheet(node.textureSize[1])]
		}
		if (positive(node.texturewidth) && positive(node.textureheight)) {
			return [sheet(node.texturewidth), sheet(node.textureheight)]
		}
		if (positive(node.texture_width) && positive(node.texture_height)) {
			return [sheet(node.texture_width), sheet(node.texture_height)]
		}

		for (const key of Object.keys(node)) {
			if (SKIP_KEYS.has(key)) {
				continue
			}
			const found = sheetOf(node[key], depth + 1)
			if (found !== null) {
				return found
			}
		}
		return null
	}

	/**
	 * Turns parsed json into the client shape.
	 *
	 * Throws with a plain sentence when the file holds nothing to build, and says what the file did
	 * hold, because being told only that a model has no boxes when it plainly does is useless.
	 */
	function normalise(json) {
		if (json === null || typeof json !== "object") {
			throw new Error("that file is not a model")
		}

		const cubes = []
		harvest(json, cubes, 0)

		const usable = cubes.filter((cube) => cube.width > 0 || cube.height > 0 || cube.depth > 0)
		if (usable.length === 0) {
			const keys = Object.keys(json).slice(0, 8).join(", ")
			throw new Error(
				"no boxes could be read out of that file" +
					(keys === "" ? "" : ` (it holds: ${keys})`) +
					". A .bbmodel, a Java model .json, a Bedrock geometry .json, an OptiFine .jem, a .gltf and " +
					"a .glb are all read, so if this is one of those, send the file and it gets taught here.",
			)
		}

		const size = sheetOf(json, 0) ?? [64, 64]
		return {
			format: FORMAT,
			textureWidth: size[0],
			textureHeight: size[1],
			cubes: usable.slice(0, MAX_CUBES),
		}
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
	 * Turning is ignored here for the same reason it is ignored everywhere else in this file: a box
	 * that has been turned is no longer a box. Draw the piece the way round it should be worn and it
	 * comes across unchanged.
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

	/** Reads one picked model file, whichever ending it has. */
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
	 * A strip is read by cutting it into equal slices, so every frame has to end up the same size.
	 * Frames that were saved smaller are not refused, they are fitted onto the largest frame: whole
	 * number enlargement where it fits, which keeps pixel art perfectly sharp, and a plain fit where
	 * it does not, always centred and never smoothed. The result is a png blob ready to upload.
	 */
	async function strip(images) {
		const list = Array.from(images ?? [])
		if (list.length === 0) {
			throw new Error("no picture was picked")
		}
		if (list.length > MAX_FRAMES) {
			throw new Error(`an animation holds at most ${MAX_FRAMES} frames`)
		}

		const width = Math.max(...list.map((image) => image.naturalWidth))
		const height = Math.max(...list.map((image) => image.naturalHeight))
		if (width < 1 || height < 1) {
			throw new Error("those pictures have no size the browser could read")
		}

		const canvas = document.createElement("canvas")
		canvas.width = width
		canvas.height = height * list.length

		const context = canvas.getContext("2d")
		context.imageSmoothingEnabled = false

		let fitted = 0
		for (let index = 0; index < list.length; index += 1) {
			const image = list[index]
			const top = index * height
			if (image.naturalWidth === width && image.naturalHeight === height) {
				context.drawImage(image, 0, top)
				continue
			}

			fitted += 1
			const whole = Math.min(Math.floor(width / image.naturalWidth), Math.floor(height / image.naturalHeight))
			const factor = whole >= 1 ? whole : Math.min(width / image.naturalWidth, height / image.naturalHeight)
			const drawWidth = Math.max(1, Math.round(image.naturalWidth * factor))
			const drawHeight = Math.max(1, Math.round(image.naturalHeight * factor))
			context.drawImage(
				image,
				Math.round((width - drawWidth) / 2),
				top + Math.round((height - drawHeight) / 2),
				drawWidth,
				drawHeight,
			)
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

		return { blob, width, height: height * list.length, frames: list.length, fitted }
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
	 * A plain player body, in the same pixels a model is drawn in, used as a ghost behind the piece.
	 *
	 * This is the whole reason the preview is worth looking at. A wing on its own says nothing; a
	 * wing next to a body says whether it is a shoulder wing or a two metre banner, and whether it
	 * sits on the back or floats a foot behind it. Head top is at minus eight, the shoulders are at
	 * zero and the feet are at twenty four, which is exactly how the game measures a player.
	 */
	function bodyCubes() {
		return [
			{ x: -4, y: -8, z: -4, width: 8, height: 8, depth: 8 },
			{ x: -4, y: 0, z: -2, width: 8, height: 12, depth: 4 },
			{ x: -8, y: 0, z: -2, width: 4, height: 12, depth: 4 },
			{ x: 4, y: 0, z: -2, width: 4, height: 12, depth: 4 },
			{ x: -4, y: 12, z: -2, width: 4, height: 12, depth: 4 },
			{ x: 0, y: 12, z: -2, width: 4, height: 12, depth: 4 },
		]
	}

	/** The corner to corner extent of a list of boxes, so the view can be fitted around them. */
	function spread(cubes) {
		const low = [Infinity, Infinity, Infinity]
		const high = [-Infinity, -Infinity, -Infinity]

		for (const cube of cubes) {
			low[0] = Math.min(low[0], cube.x)
			low[1] = Math.min(low[1], cube.y)
			low[2] = Math.min(low[2], cube.z)
			high[0] = Math.max(high[0], cube.x + cube.width)
			high[1] = Math.max(high[1], cube.y + cube.height)
			high[2] = Math.max(high[2], cube.z + cube.depth)
		}

		if (low[0] === Infinity) {
			return { low: [0, 0, 0], high: [1, 1, 1] }
		}
		return { low, high }
	}

	/** Turns a point around the model, first sideways and then a little forwards. */
	function turn(point, view) {
		const spunX = point[0] * view.cosYaw + point[2] * view.sinYaw
		const spunZ = point[2] * view.cosYaw - point[0] * view.sinYaw
		return [spunX, point[1] * view.cosPitch - spunZ * view.sinPitch, spunZ * view.cosPitch + point[1] * view.sinPitch]
	}

	/** Where a corner of the model lands on the canvas, and how far away it is. */
	function place(point, view) {
		const spun = turn([point[0] - view.centre[0], point[1] - view.centre[1], point[2] - view.centre[2]], view)
		return { x: view.originX + spun[0] * view.scale, y: view.originY + spun[1] * view.scale, depth: spun[2] }
	}

	/**
	 * The six faces of a box, each with the corner its texture starts at, the corner its texture runs
	 * across to, the corner it runs down to, and the rectangle of the sheet it comes from.
	 *
	 * The rectangles are the box unwrap Minecraft has always used: the top and bottom of the box side
	 * by side on the first row, and the right, front, left and back faces along the second.
	 */
	function facesOf(cube) {
		const x0 = cube.x
		const x1 = cube.x + cube.width
		const y0 = cube.y
		const y1 = cube.y + cube.height
		const z0 = cube.z
		const z1 = cube.z + cube.depth
		const u = cube.u ?? 0
		const v = cube.v ?? 0
		const w = cube.width
		const h = cube.height
		const d = cube.depth

		return [
			{ normal: [0, 0, -1], origin: [x0, y0, z0], across: [x1, y0, z0], down: [x0, y1, z0], rect: [u + d, v + d, w, h] },
			{ normal: [0, 0, 1], origin: [x1, y0, z1], across: [x0, y0, z1], down: [x1, y1, z1], rect: [u + d + w + d, v + d, w, h] },
			{ normal: [1, 0, 0], origin: [x1, y0, z0], across: [x1, y0, z1], down: [x1, y1, z0], rect: [u, v + d, d, h] },
			{ normal: [-1, 0, 0], origin: [x0, y0, z1], across: [x0, y0, z0], down: [x0, y1, z1], rect: [u + d + w, v + d, d, h] },
			{ normal: [0, -1, 0], origin: [x0, y0, z0], across: [x1, y0, z0], down: [x0, y0, z1], rect: [u + d, v, w, d] },
			{ normal: [0, 1, 0], origin: [x0, y1, z1], across: [x1, y1, z1], down: [x0, y1, z0], rect: [u + d + w, v, w, d] },
		]
	}

	/** Draws one frame of the turning preview. */
	function render(canvas, state) {
		const context = canvas.getContext("2d")
		if (context === null) {
			return
		}

		context.setTransform(1, 0, 0, 1, 0, 0)
		context.clearRect(0, 0, canvas.width, canvas.height)
		context.imageSmoothingEnabled = false

		const model = state.model
		const ghost = state.body ? bodyCubes() : []
		const box = spread([...model.cubes, ...ghost])
		const size = [0, 1, 2].map((axis) => box.high[axis] - box.low[axis])
		const radius = Math.max(4, Math.hypot(size[0], size[1], size[2]) / 2)

		const view = {
			cosYaw: Math.cos(state.yaw),
			sinYaw: Math.sin(state.yaw),
			cosPitch: Math.cos(state.pitch),
			sinPitch: Math.sin(state.pitch),
			centre: [0, 1, 2].map((axis) => (box.low[axis] + box.high[axis]) / 2),
			scale: (Math.min(canvas.width, canvas.height) * 0.44) / radius,
			originX: canvas.width / 2,
			originY: canvas.height / 2,
		}

		const image = state.image
		const total = Math.max(1, state.frames)
		const index = clamp(Math.round(state.frame), 0, total - 1)
		const perX = image === null ? 1 : image.naturalWidth / Math.max(1, model.textureWidth)
		const frameHeight = image === null ? 0 : image.naturalHeight / total
		const perY = image === null ? 1 : frameHeight / Math.max(1, model.textureHeight)
		const top = index * frameHeight

		const panels = []
		const gather = (cube, textured) => {
			for (const face of facesOf(cube)) {
				if (textured && (face.rect[2] <= 0 || face.rect[3] <= 0)) {
					continue
				}
				if (turn(face.normal, view)[2] >= 0) {
					continue
				}

				const origin = place(face.origin, view)
				const across = place(face.across, view)
				const down = place(face.down, view)
				const area = Math.abs((across.x - origin.x) * (down.y - origin.y) - (across.y - origin.y) * (down.x - origin.x))
				if (!Number.isFinite(area) || area < 0.05) {
					continue
				}

				panels.push({
					depth: (origin.depth + across.depth + down.depth) / 3,
					origin,
					across,
					down,
					rect: textured ? face.rect : null,
				})
			}
		}

		for (const cube of ghost) {
			gather(cube, false)
		}
		for (const cube of model.cubes) {
			gather(cube, true)
		}
		panels.sort((left, right) => right.depth - left.depth)

		for (const panel of panels) {
			const corner = {
				x: panel.across.x + panel.down.x - panel.origin.x,
				y: panel.across.y + panel.down.y - panel.origin.y,
			}

			if (panel.rect === null || image === null) {
				context.beginPath()
				context.moveTo(panel.origin.x, panel.origin.y)
				context.lineTo(panel.across.x, panel.across.y)
				context.lineTo(corner.x, corner.y)
				context.lineTo(panel.down.x, panel.down.y)
				context.closePath()
				context.fillStyle = panel.rect === null ? "rgba(124, 92, 255, 0.10)" : "rgba(124, 92, 255, 0.45)"
				context.fill()
				context.strokeStyle = "rgba(124, 92, 255, 0.28)"
				context.lineWidth = 1
				context.stroke()
				continue
			}

			const sourceX = panel.rect[0] * perX
			const sourceY = top + panel.rect[1] * perY
			const sourceW = Math.max(1, panel.rect[2] * perX)
			const sourceH = Math.max(1, panel.rect[3] * perY)

			context.setTransform(
				(panel.across.x - panel.origin.x) / sourceW,
				(panel.across.y - panel.origin.y) / sourceW,
				(panel.down.x - panel.origin.x) / sourceH,
				(panel.down.y - panel.origin.y) / sourceH,
				panel.origin.x,
				panel.origin.y,
			)
			try {
				// A hair of overdraw, so neighbouring faces do not show a seam between them.
				context.drawImage(image, sourceX, sourceY, sourceW, sourceH, -0.05, -0.05, sourceW + 0.1, sourceH + 0.1)
			} catch {
				context.fillStyle = "rgba(124, 92, 255, 0.35)"
				context.fillRect(0, 0, sourceW, sourceH)
			}
			context.setTransform(1, 0, 0, 1, 0, 0)
		}
	}

	/** Lets the preview be turned with the mouse, which is attached to a canvas only once. */
	function listen(canvas) {
		canvas.style.cursor = "grab"
		canvas.style.touchAction = "none"

		canvas.addEventListener("pointerdown", (event) => {
			const state = views.get(canvas)
			if (state === undefined) {
				return
			}
			state.dragging = true
			state.pointerX = event.clientX
			state.pointerY = event.clientY
			canvas.style.cursor = "grabbing"
			try {
				canvas.setPointerCapture(event.pointerId)
			} catch {
				// Pointer capture is a convenience, not a requirement.
			}
		})

		canvas.addEventListener("pointermove", (event) => {
			const state = views.get(canvas)
			if (state === undefined || !state.dragging) {
				return
			}
			state.yaw += (event.clientX - state.pointerX) * 0.012
			state.pitch = clamp(state.pitch + (event.clientY - state.pointerY) * 0.012, -1.2, 1.2)
			state.pointerX = event.clientX
			state.pointerY = event.clientY
		})

		const release = () => {
			const state = views.get(canvas)
			if (state === undefined) {
				return
			}
			state.dragging = false
			canvas.style.cursor = "grab"
		}
		canvas.addEventListener("pointerup", release)
		canvas.addEventListener("pointercancel", release)
		canvas.addEventListener("pointerleave", release)
	}

	/** Keeps the preview turning until the canvas goes away or is hidden. */
	function ensureLoop(canvas) {
		const state = views.get(canvas)
		if (state === undefined || state.loop !== 0) {
			return
		}

		const step = (now) => {
			const current = views.get(canvas)
			if (current === undefined) {
				return
			}
			if (!canvas.isConnected || canvas.offsetParent === null) {
				current.loop = 0
				return
			}

			const elapsed = current.last === 0 ? 0 : Math.min(200, now - current.last)
			current.last = now
			if (!current.dragging) {
				current.yaw += (elapsed / 1000) * SPIN
			}
			render(canvas, current)
			current.loop = window.requestAnimationFrame(step)
		}

		state.last = 0
		state.loop = window.requestAnimationFrame(step)
	}

	/**
	 * Shows a model on a canvas, turning, textured, beside a ghost of a player.
	 *
	 * Calling this again with a different frame only updates what is drawn; the angle the piece has
	 * been turned to is kept, so an animation does not reset the view sixty times a second.
	 */
	function paint(canvas, model, image, options) {
		const settings = options ?? {}
		const existing = views.get(canvas)
		const state = existing ?? {
			// Facing the back of the player to begin with, because that is where a wing is worn.
			yaw: Math.PI * 0.82,
			pitch: 0.22,
			dragging: false,
			pointerX: 0,
			pointerY: 0,
			loop: 0,
			last: 0,
		}

		state.model = model
		state.image = image ?? null
		state.frames = Math.max(1, Math.round(Number(settings.frames ?? 1)))
		state.frame = Math.max(0, Math.round(Number(settings.frame ?? 0)))
		state.body = settings.body !== false

		if (existing === undefined) {
			views.set(canvas, state)
			listen(canvas)
		}
		render(canvas, state)
		ensureLoop(canvas)
	}

	/** Draws one frame of a picture that has no model, which is worn flat like a cape. */
	function paintFlat(canvas, image, options) {
		const settings = options ?? {}
		const total = Math.max(1, Math.round(Number(settings.frames ?? 1)))
		const index = Math.max(0, Math.min(total - 1, Math.round(Number(settings.frame ?? 0))))

		views.delete(canvas)
		const context = canvas.getContext("2d")
		context.setTransform(1, 0, 0, 1, 0, 0)
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
		const deep = model.cubes.reduce((most, cube) => Math.max(most, cube.z + cube.depth), 0)
		return (
			`${count} ${count === 1 ? "box" : "boxes"}, ` +
			`${round(box.width)} wide by ${round(box.height)} tall, ` +
			`${round(Math.max(0, deep))} behind the back, ` +
			`texture ${model.textureWidth}x${model.textureHeight}. Drag the preview to turn it.`
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
		bodyCubes,
		paint,
		paintFlat,
		describe,
	}
})()
