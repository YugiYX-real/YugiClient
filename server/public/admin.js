/*
 * The admin panel.
 *
 * Publishing a cosmetic means uploading three files and nothing else: a Blockbench model, a png, and
 * an animation mcmeta when the thing moves. The model and the mcmeta are read here in the browser
 * and reduced to the small shapes the client builds from, and the same reduced pair is what the
 * preview above the button is drawn from, so what is on screen is what every client will build.
 */

let announcements = []

// What the preview is currently showing.
let pickedModel = null
let pickedImage = null
let pickedMcmeta = null
let pickedFrames = 1
let ticker = null

function bytes(value) {
	const size = Number(value ?? 0)
	if (size < 1024) {
		return `${size} B`
	}
	if (size < 1024 * 1024) {
		return `${(size / 1024).toFixed(1)} KB`
	}
	return `${(size / 1024 / 1024).toFixed(1)} MB`
}

/** File names travel in a url, so anything unusual becomes a dash. */
function safeName(name) {
	return String(name).replace(/[^A-Za-z0-9._-]+/g, "-")
}

/** A box left empty means "leave it to the kind", so nothing is sent for it. */
function optionalNumber(id) {
	const raw = document.getElementById(id).value.trim()
	if (raw === "") {
		return undefined
	}
	const value = Number(raw)
	return Number.isFinite(value) ? value : undefined
}

function optionalFlag(id) {
	const value = document.getElementById(id).value
	if (value === "yes") {
		return true
	}
	return value === "no" ? false : undefined
}

/** Loads a picked png so the preview can take pieces out of it. */
function loadImage(file) {
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(file)
		const image = new Image()
		image.addEventListener("load", () => {
			URL.revokeObjectURL(url)
			resolve(image)
		})
		image.addEventListener("error", () => {
			URL.revokeObjectURL(url)
			reject(new Error("that png could not be read"))
		})
		image.src = url
	})
}

function stopTicker() {
	if (ticker !== null) {
		clearInterval(ticker)
		ticker = null
	}
}

/** Draws one frame of whatever is picked: the model painted with the texture, or the texture flat. */
function drawFrame(frame) {
	const canvas = document.getElementById("c-canvas")
	if (pickedModel !== null) {
		HalcyonModel.paint(canvas, pickedModel, pickedImage, { frames: pickedFrames, frame })
		return
	}
	HalcyonModel.paintFlat(canvas, pickedImage, { frames: pickedFrames, frame })
}

/**
 * Reads the picked files and shows the piece before it exists anywhere.
 *
 * An animation plays here on a timer at the frametime out of the mcmeta, which is the same speed the
 * game will play it at, so a wing that flaps too fast can be fixed before anybody is given it.
 */
async function refreshPreview() {
	const note = document.getElementById("c-preview")
	const canvas = document.getElementById("c-canvas")
	const modelFile = document.getElementById("c-model").files[0]
	const textureFile = document.getElementById("c-file").files[0]
	const metaFile = document.getElementById("c-mcmeta").files[0]

	stopTicker()
	pickedModel = null
	pickedImage = null
	pickedMcmeta = null
	pickedFrames = 1
	canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height)

	const lines = []
	try {
		if (textureFile !== undefined) {
			pickedImage = await loadImage(textureFile)
			lines.push(
				`texture ${pickedImage.naturalWidth}x${pickedImage.naturalHeight}, ${bytes(textureFile.size)}`,
			)
		}
		if (modelFile !== undefined) {
			pickedModel = await HalcyonModel.fromFile(modelFile)
			lines.push(HalcyonModel.describe(pickedModel))
		}
		if (metaFile !== undefined) {
			pickedMcmeta = await HalcyonModel.mcmetaFromFile(metaFile)
		}
	} catch (error) {
		note.textContent = error.message
		return
	}

	if (pickedMcmeta !== null) {
		if (pickedImage === null) {
			lines.push("an animation also needs the png with the frames stacked in it")
		} else {
			pickedFrames = HalcyonModel.frames(pickedModel, pickedImage)
			lines.push(
				pickedFrames > 1
					? `animated, ${pickedFrames} frames at ${pickedMcmeta.frameMs}ms`
					: "the mcmeta says animated but the png holds a single frame",
			)
		}
	}

	if (pickedModel === null && pickedImage === null) {
		note.textContent = "Pick a model and a texture to see it before anyone can wear it."
		return
	}

	if (pickedModel !== null && pickedImage === null) {
		lines.push("no texture picked yet, so the boxes are drawn plain")
	}
	if (pickedModel === null && pickedImage !== null) {
		lines.push("no model picked, so this is worn flat like a cape")
	}

	note.textContent = lines.join(" \u00b7 ")
	drawFrame(0)

	if (pickedFrames > 1 && pickedMcmeta !== null) {
		let frame = 0
		ticker = setInterval(() => {
			frame = (frame + 1) % pickedFrames
			drawFrame(frame)
		}, pickedMcmeta.frameMs)
	}
}

function paintAnnouncements() {
	const host = document.getElementById("announcements")
	if (announcements.length === 0) {
		host.innerHTML = '<div class="empty">No announcements yet.</div>'
		return
	}

	host.innerHTML = announcements
		.map(
			(entry, index) => `
				<div class="field" data-index="${index}" data-posted="${Halcyon.escape(entry.postedAt ?? "")}">
					<div class="inline">
						<div class="field">
							<label>Title</label>
							<input class="a-title" value="${Halcyon.escape(entry.title ?? "")}" />
						</div>
						<button class="button small danger a-remove">Remove</button>
					</div>
					<div class="field" style="margin-top: 0.5rem">
						<label>Body</label>
						<input class="a-body" value="${Halcyon.escape(entry.body ?? "")}" />
					</div>
				</div>`,
		)
		.join("")

	host.querySelectorAll(".a-remove").forEach((button) => {
		button.addEventListener("click", (event) => {
			const index = Number(event.target.closest("[data-index]").dataset.index)
			collectAnnouncements()
			announcements.splice(index, 1)
			paintAnnouncements()
		})
	})
}

/** Reads the boxes back. An entry keeps the date it was first posted on. */
function collectAnnouncements() {
	const rows = document.querySelectorAll("#announcements [data-index]")
	announcements = Array.from(rows).map((row) => {
		const posted = row.dataset.posted ?? ""
		return {
			title: row.querySelector(".a-title").value,
			body: row.querySelector(".a-body").value,
			postedAt: posted === "" ? new Date().toISOString() : posted,
		}
	})
}

function paintRelease(release, files) {
	const host = document.getElementById("release")
	if (release === null || release === undefined) {
		host.className = "empty"
		host.textContent = "Nothing published yet, so every launcher is told there is no update."
	} else {
		host.className = ""
		host.innerHTML =
			`<strong>${Halcyon.escape(release.version)}</strong> ` +
			`<span class="tag">published ${Halcyon.escape(Halcyon.when(release.publishedAt))}</span>` +
			`<div class="hint" style="margin-top:0.4rem">${Halcyon.escape(release.notes ?? "")}</div>`
	}

	const rows = files ?? []
	document.getElementById("updates").innerHTML =
		rows.length === 0
			? '<tr><td colspan="4">No installers uploaded.</td></tr>'
			: rows
					.map(
						(file) =>
							`<tr><td>${Halcyon.escape(file.name)}</td><td>${bytes(file.bytes)}</td><td>${Halcyon.escape(Halcyon.when(file.modifiedAt))}</td><td><button class="button small danger drop-file" data-file="${Halcyon.escape(file.name)}">Delete</button></td></tr>`,
					)
					.join("")

	document.querySelectorAll(".drop-file").forEach((button) => {
		button.addEventListener("click", async () => {
			try {
				await Halcyon.api(`/v1/updates/${button.dataset.file}`, { method: "DELETE" })
				Halcyon.toast("file deleted")
				load()
			} catch (error) {
				Halcyon.toast(error.message, true)
			}
		})
	})
}

/** The one line under a cosmetic in the list: what it is and how it behaves. */
function describe(cosmetic) {
	const parts = [cosmetic.type ?? "cape"]
	parts.push(cosmetic.hasModel === true ? "own model" : "flat")
	if (cosmetic.animated === true) {
		parts.push(`animated, ${cosmetic.frames ?? 2} frames at ${cosmetic.frameMs ?? 100}ms`)
	}
	if (cosmetic.mirror === true) {
		parts.push("mirrored pair")
	}
	if (cosmetic.glow === true) {
		parts.push("glowing")
	}
	if (Number(cosmetic.scale ?? 1) !== 1) {
		parts.push(`size ${cosmetic.scale}`)
	}
	return parts.join(", ")
}

async function load() {
	const user = await Halcyon.guard(true)
	if (user === null) {
		return
	}

	const data = await Halcyon.api("/v1/admin/overview")

	document.getElementById("s-online").textContent = Halcyon.number(data.stats.online)
	document.getElementById("s-registered").textContent = Halcyon.number(data.stats.registered)
	document.getElementById("s-players").textContent = Halcyon.number(data.stats.playersKnown)
	document.getElementById("s-week").textContent = Halcyon.number(data.stats.newThisWeek)
	document.getElementById("s-cosmetics").textContent = Halcyon.number(data.stats.cosmetics)
	document.getElementById("s-version").textContent =
		data.release === null || data.release === undefined ? "none" : data.release.version

	paintRelease(data.release, data.updates)

	announcements = Array.isArray(data.announcements) ? data.announcements : []
	paintAnnouncements()
	document.getElementById("a-status").textContent =
		announcements.length === 0 ? "" : `${announcements.length} live on the site and in game`

	const types = data.types ?? {}
	const typeSelect = document.getElementById("c-type")
	if (Object.keys(types).length > 0) {
		const chosen = typeSelect.value
		typeSelect.innerHTML = Object.entries(types)
			.map(
				([id, entry]) =>
					`<option value="${Halcyon.escape(id)}">${Halcyon.escape(entry.label ?? id)}</option>`,
			)
			.join("")
		typeSelect.value = chosen
	}

	const cosmetics = data.cosmetics ?? []
	document.getElementById("cosmetics").innerHTML =
		cosmetics.length === 0
			? '<div class="empty">No cosmetics yet. Publish one above.</div>'
			: '<div class="capes">' +
				cosmetics
					.map((cosmetic) =>
						Halcyon.capeCard(
							cosmetic,
							`<div class="hint">${Halcyon.escape(describe(cosmetic))}</div>` +
								`<button class="button small danger drop" data-id="${Halcyon.escape(cosmetic.id)}" style="margin-top:0.5rem">Delete</button>`,
						),
					)
					.join("") +
				"</div>"

	document.querySelectorAll(".drop").forEach((button) => {
		button.addEventListener("click", async () => {
			const id = button.dataset.id
			if (!window.confirm(`Delete ${id} and take it from everyone?`)) {
				return
			}
			try {
				await Halcyon.api(`/v1/cosmetics/${id}`, { method: "DELETE" })
				Halcyon.toast(`${id} deleted`)
				load()
			} catch (error) {
				Halcyon.toast(error.message, true)
			}
		})
	})

	document.getElementById("g-id").innerHTML = cosmetics
		.map(
			(cosmetic) =>
				`<option value="${Halcyon.escape(cosmetic.id)}">${Halcyon.escape(cosmetic.name ?? cosmetic.id)} &middot; ${Halcyon.escape(cosmetic.type ?? "cape")}</option>`,
		)
		.join("")

	document.getElementById("grants").innerHTML =
		(data.grants ?? []).length === 0
			? '<tr><td colspan="3">Nothing handed out yet.</td></tr>'
			: data.grants
					.map((grant) => {
						// One entry per kind now, so this reads like "cape: aurora, wings: ember".
						const worn = Object.entries(grant.equipped ?? {})
							.filter(([, id]) => id !== null && id !== undefined)
							.map(([kind, id]) => `${kind}: ${id}`)
							.join(", ")
						return `<tr><td>${Halcyon.escape(grant.name)}</td><td>${Halcyon.escape(grant.owned.join(", "))}</td><td>${Halcyon.escape(worn === "" ? "nothing" : worn)}</td></tr>`
					})
					.join("")

	document.getElementById("accounts").innerHTML = (data.accounts ?? [])
		.map((account) => {
			const role =
				account.role === "admin"
					? '<span class="tag admin">admin</span>'
					: '<span class="tag">member</span>'
			const next = account.role === "admin" ? "member" : "admin"
			const name = Halcyon.escape(account.username)
			const linked =
				account.minecraft === ""
					? "not linked"
					: account.verified === true
						? `${account.minecraft} (verified)`
						: account.minecraft
			return `<tr>
				<td>${name}</td>
				<td>${Halcyon.escape(account.email)}</td>
				<td>${Halcyon.escape(linked)}</td>
				<td>${role}</td>
				<td>${Halcyon.escape(Halcyon.when(account.createdAt))}</td>
				<td>
					<button class="button small role" data-user="${name}" data-role="${next}">Make ${next}</button>
					<button class="button small danger kill" data-user="${name}">Delete</button>
				</td>
			</tr>`
		})
		.join("")

	document.querySelectorAll(".role").forEach((button) => {
		button.addEventListener("click", async () => {
			try {
				await Halcyon.api("/v1/admin/role", {
					method: "POST",
					body: { username: button.dataset.user, role: button.dataset.role },
				})
				Halcyon.toast("role changed")
				load()
			} catch (error) {
				Halcyon.toast(error.message, true)
			}
		})
	})

	document.querySelectorAll(".kill").forEach((button) => {
		button.addEventListener("click", async () => {
			if (!window.confirm(`Delete the account ${button.dataset.user}?`)) {
				return
			}
			try {
				await Halcyon.api("/v1/admin/remove-account", {
					method: "POST",
					body: { username: button.dataset.user },
				})
				Halcyon.toast("account deleted")
				load()
			} catch (error) {
				Halcyon.toast(error.message, true)
			}
		})
	})

	document.getElementById("players").innerHTML =
		(data.players ?? []).length === 0
			? '<tr><td colspan="4">Nobody is playing right now.</td></tr>'
			: data.players
					.map(
						(player) =>
							`<tr><td>${Halcyon.escape(player.name)}</td><td>${Halcyon.escape(player.client)}</td><td>${Halcyon.escape(player.version)}</td><td>${Halcyon.escape(Halcyon.when(player.lastSeen))}</td></tr>`,
					)
					.join("")
}

async function handout(endpoint) {
	try {
		await Halcyon.api(`/v1/cosmetics/${endpoint}`, {
			method: "POST",
			body: {
				name: document.getElementById("g-name").value,
				id: document.getElementById("g-id").value,
			},
		})
		Halcyon.toast(endpoint === "grant" ? "granted" : "revoked")
		load()
	} catch (error) {
		Halcyon.toast(error.message, true)
	}
}

/** Uploads every chosen installer and then publishes them as one version. */
async function publishVersion() {
	const button = document.getElementById("publish-version")
	const status = document.getElementById("u-status")
	const version = document.getElementById("u-version").value.trim().replace(/^v/i, "")
	const chosen = Array.from(document.getElementById("u-files").files)

	if (!/^[0-9]+\.[0-9]+\.[0-9]+/.test(version)) {
		Halcyon.toast("a version like 1.2.5 is required", true)
		return
	}

	button.disabled = true
	try {
		const names = []
		for (const file of chosen) {
			const name = safeName(file.name)
			status.textContent = `Uploading ${name}, ${bytes(file.size)}`
			await Halcyon.api(`/v1/updates/${name}`, { method: "PUT", body: file, raw: true })
			names.push(name)
		}

		if (names.length === 0) {
			// Publishing without uploading re-points a version at files already on the server.
			const listing = await Halcyon.api("/v1/updates")
			for (const file of listing.files ?? []) {
				if (!file.name.endsWith(".yml")) {
					names.push(file.name)
				}
			}
		}

		status.textContent = "Working out checksums"
		const result = await Halcyon.api("/v1/updates/publish", {
			method: "POST",
			body: { version, notes: document.getElementById("u-notes").value, files: names },
		})

		status.textContent = ""
		Halcyon.toast(`${result.release.version} published`)
		load()
	} catch (error) {
		status.textContent = ""
		Halcyon.toast(error.message, true)
	} finally {
		button.disabled = false
	}
}

/**
 * Publishes one cosmetic: the texture, the model, the animation mcmeta, and the record that ties
 * them together.
 *
 * Nothing is guessed from the preview: every file is read again here, in case one was swapped after
 * it was drawn.
 */
async function publishCosmetic() {
	const button = document.getElementById("publish")
	const status = document.getElementById("c-status")
	const id = document.getElementById("c-id").value.trim().toLowerCase()

	if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(id)) {
		Halcyon.toast("a short lowercase id is required", true)
		return
	}

	const textureFile = document.getElementById("c-file").files[0]
	const modelFile = document.getElementById("c-model").files[0]
	const metaFile = document.getElementById("c-mcmeta").files[0]

	button.disabled = true
	try {
		const model = modelFile === undefined ? null : await HalcyonModel.fromFile(modelFile)
		const meta = metaFile === undefined ? null : await HalcyonModel.mcmetaFromFile(metaFile)
		const image = textureFile === undefined ? null : await loadImage(textureFile)

		if (meta !== null && image === null) {
			throw new Error("an animated cosmetic needs the png with the frames in it as well")
		}

		if (textureFile !== undefined) {
			status.textContent = `Uploading the texture, ${bytes(textureFile.size)}`
			await Halcyon.api(`/v1/cosmetics/textures/${id}.png`, {
				method: "PUT",
				body: textureFile,
				raw: true,
			})
		}

		if (model !== null) {
			status.textContent = `Uploading the model, ${model.cubes.length} boxes`
			await Halcyon.api(`/v1/cosmetics/textures/${id}.model.json`, {
				method: "PUT",
				body: new Blob([JSON.stringify(model)], { type: "application/json" }),
				raw: true,
			})
		}

		if (meta !== null) {
			status.textContent = "Uploading the animation"
			await Halcyon.api(`/v1/cosmetics/textures/${id}.mcmeta.json`, {
				method: "PUT",
				body: new Blob([JSON.stringify(meta.mcmeta)], { type: "application/json" }),
				raw: true,
			})
		}

		const body = {
			id,
			name: document.getElementById("c-name").value || id,
			type: document.getElementById("c-type").value,
			rarity: document.getElementById("c-rarity").value,
			description: document.getElementById("c-description").value,
		}

		// Only sent when a model was picked, so editing a name cannot drop an existing model.
		if (model !== null) {
			body.model = `/v1/cosmetics/textures/${id}.model.json`
		}

		if (meta !== null) {
			body.mcmeta = `/v1/cosmetics/textures/${id}.mcmeta.json`
			body.frames = HalcyonModel.frames(model, image)
			body.frameMs = meta.frameMs
		} else if (textureFile !== undefined) {
			// A new texture with no mcmeta beside it is a still picture, so any animation that was
			// on this cosmetic before is cleared rather than left playing over the new png.
			body.mcmeta = ""
		}

		const placement = {
			scale: optionalNumber("c-scale"),
			offsetY: optionalNumber("c-offset-y"),
			offsetZ: optionalNumber("c-offset-z"),
			flap: optionalNumber("c-flap"),
			mirror: optionalFlag("c-mirror"),
			glow: optionalFlag("c-glow"),
		}
		for (const [key, value] of Object.entries(placement)) {
			if (value !== undefined) {
				body[key] = value
			}
		}

		await Halcyon.api("/v1/cosmetics", { method: "PUT", body })
		status.textContent = ""
		Halcyon.toast(`${id} published`)
		load()
	} catch (error) {
		status.textContent = ""
		Halcyon.toast(error.message, true)
	} finally {
		button.disabled = false
	}
}

document.getElementById("add-announcement").addEventListener("click", () => {
	collectAnnouncements()
	announcements.push({ title: "", body: "" })
	paintAnnouncements()
})

/** Saves the announcements and reads them back, so the screen shows what the server kept. */
document.getElementById("save-announcements").addEventListener("click", async () => {
	const status = document.getElementById("a-status")
	collectAnnouncements()
	status.textContent = "Saving"

	try {
		const result = await Halcyon.api("/v1/announcements", {
			method: "PUT",
			body: { announcements },
		})
		const kept = (result.announcements ?? []).length
		Halcyon.toast(kept === 1 ? "1 announcement saved" : `${kept} announcements saved`)
		await load()
	} catch (error) {
		status.textContent = ""
		Halcyon.toast(error.message, true)
	}
})

for (const picker of ["c-model", "c-file", "c-mcmeta"]) {
	document.getElementById(picker).addEventListener("change", () => {
		refreshPreview().catch((error) => Halcyon.toast(error.message, true))
	})
}

document.getElementById("publish-version").addEventListener("click", publishVersion)
document.getElementById("publish").addEventListener("click", publishCosmetic)
document.getElementById("grant").addEventListener("click", () => handout("grant"))
document.getElementById("revoke").addEventListener("click", () => handout("revoke"))

load().catch((error) => Halcyon.say("message", error.message))
