import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

const DEFAULT_BRANDING = {
	accentColor: "#8B7CF6",
	badgeText: "\u2726",
	menuMessage: "",
	backgroundUrl: "",
}

const PERSIST_DELAY_MS = 2000

// Cosmetic ids end up in urls and file names, so they are kept to a short lowercase slug.
const COSMETIC_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/

/** The most frames one cosmetic may be built from. Kept for records written by older builds. */
const MAX_FRAMES = 64

/**
 * Every kind of cosmetic the client knows how to wear.
 *
 * A slot is what actually decides what replaces what: capes and wings both hang off the back, so
 * wearing wings takes the cape off rather than drawing both through each other. A shield is its own
 * slot, because a shield on the back and a cape on the back would fight over the same space.
 * Adding a new kind of cosmetic later is a line in this table and nothing else.
 */
export const COSMETIC_TYPES = {
	cape: { slot: "back", label: "Cape" },
	wings: { slot: "back", label: "Wings" },
	backpack: { slot: "back", label: "Backpack" },
	shield: { slot: "shield", label: "Shield" },
	hat: { slot: "head", label: "Hat" },
	halo: { slot: "halo", label: "Halo" },
	mask: { slot: "face", label: "Mask" },
	shoulder: { slot: "shoulder", label: "Shoulder buddy" },
	aura: { slot: "aura", label: "Aura" },
	trail: { slot: "trail", label: "Trail" },
}

export const COSMETIC_SLOTS = Array.from(
	new Set(Object.values(COSMETIC_TYPES).map((entry) => entry.slot)),
)

/**
 * How each kind is placed on the player unless the owner says otherwise.
 *
 * These are nudges on top of the model's own coordinates, not a substitute for them. A model is
 * authored where it belongs, so the defaults are deliberately small: a cosmetic that is shifted and
 * swung by the client is exactly what made wings look like they were floating behind the player.
 */
const GEOMETRY = {
	cape: { scale: 1, offsetX: 0, offsetY: 0, offsetZ: 0, flap: 0, mirror: false, glow: false },
	wings: { scale: 1, offsetX: 0, offsetY: 0, offsetZ: 0, flap: 0.25, mirror: false, glow: false },
	backpack: { scale: 1, offsetX: 0, offsetY: 0, offsetZ: 0, flap: 0, mirror: false, glow: false },
	shield: { scale: 1, offsetX: 0, offsetY: 0, offsetZ: 0, flap: 0, mirror: false, glow: false },
	hat: { scale: 1, offsetX: 0, offsetY: 0, offsetZ: 0, flap: 0, mirror: false, glow: false },
	halo: { scale: 1, offsetX: 0, offsetY: 0, offsetZ: 0, flap: 0.2, mirror: false, glow: true },
	mask: { scale: 1, offsetX: 0, offsetY: 0, offsetZ: 0, flap: 0, mirror: false, glow: false },
	shoulder: { scale: 1, offsetX: 0, offsetY: 0, offsetZ: 0, flap: 0.2, mirror: false, glow: false },
	aura: { scale: 1, offsetX: 0, offsetY: 0, offsetZ: 0, flap: 0.2, mirror: false, glow: true },
	trail: { scale: 1, offsetX: 0, offsetY: 0, offsetZ: 0, flap: 0.3, mirror: false, glow: true },
}

const RARITIES = ["common", "uncommon", "rare", "epic", "legendary", "exclusive"]

/** Returns the cleaned cosmetic id, or an empty string when the value cannot be used. */
export function normaliseCosmeticId(value) {
	const text = typeof value === "string" ? value.trim().toLowerCase() : ""
	return COSMETIC_ID.test(text) ? text : ""
}

/** Falls back to a cape, because that is what every older record was. */
export function normaliseCosmeticType(value) {
	const text = typeof value === "string" ? value.trim().toLowerCase() : ""
	return COSMETIC_TYPES[text] === undefined ? "cape" : text
}

export function slotOf(type) {
	return COSMETIC_TYPES[normaliseCosmeticType(type)].slot
}

/** The default placement for a kind of cosmetic. */
export function geometryOf(type) {
	return GEOMETRY[normaliseCosmeticType(type)] ?? GEOMETRY.cape
}

function normaliseRarity(value) {
	const text = typeof value === "string" ? value.trim().toLowerCase() : ""
	return RARITIES.includes(text) ? text : "common"
}

/** One address that has to be fetchable by a client, or the fallback when it cannot be. */
function normaliseAddress(value, fallback) {
	const text = typeof value === "string" ? value.trim() : ""
	if (text === "" || text.length > 300) {
		return fallback
	}
	if (!text.startsWith("/") && !text.startsWith("http://") && !text.startsWith("https://")) {
		return fallback
	}
	return text
}

/**
 * The addresses of the pictures an older animated cosmetic was built from.
 *
 * Nothing writes these any more: a cosmetic is a model and a texture. They are still read so a
 * server that has been running since before models existed keeps showing what it already had.
 */
function normaliseFrameTextures(value) {
	if (!Array.isArray(value)) {
		return []
	}

	const frames = []
	for (const entry of value) {
		const text = normaliseAddress(entry, "")
		if (text === "") {
			continue
		}
		frames.push(text)
		if (frames.length === MAX_FRAMES) {
			break
		}
	}
	return frames
}

function clamp(value, low, high, fallback) {
	const number = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10)
	if (!Number.isFinite(number)) {
		return fallback
	}
	return Math.min(high, Math.max(low, Math.round(number)))
}

/** The same as clamp, but for placement values that are meant to be fractional. */
function decimal(value, low, high, fallback) {
	const number = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""))
	if (!Number.isFinite(number)) {
		return fallback
	}
	return Math.round(Math.min(high, Math.max(low, number)) * 1000) / 1000
}

function flag(value, fallback) {
	return typeof value === "boolean" ? value : fallback
}

/** Players are addressed case insensitively everywhere. */
export function playerKey(name) {
	return typeof name === "string" ? name.trim().toLowerCase() : ""
}

function emptyEquipped() {
	const equipped = {}
	for (const slot of COSMETIC_SLOTS) {
		equipped[slot] = null
	}
	return equipped
}

/** Keeps announcements to the shape every reader expects, and drops the empty ones. */
function shapeAnnouncements(entries) {
	if (!Array.isArray(entries)) {
		return []
	}

	const shaped = []
	for (const entry of entries.slice(0, 40)) {
		const source = entry ?? {}
		const title = typeof source.title === "string" ? source.title.trim().slice(0, 120) : ""
		const raw = typeof source.body === "string" ? source.body : (source.message ?? "")
		const body = typeof raw === "string" ? raw.trim().slice(0, 1000) : ""
		if (title === "" && body === "") {
			continue
		}

		shaped.push({
			title,
			body,
			// An announcement that was already posted keeps its date, so editing a typo does not
			// make it look brand new everywhere it is shown.
			postedAt:
				typeof source.postedAt === "string" && !Number.isNaN(Date.parse(source.postedAt))
					? source.postedAt
					: new Date().toISOString(),
		})
	}
	return shaped
}

/**
 * The whole service state in one json file.
 *
 * Presence is a hot path that would hammer the disk on every heartbeat, so writes are debounced and
 * written through a temporary file to make a torn state file impossible.
 */
export class Store {
	constructor(file, presenceTtlMs) {
		this.file = file
		this.presenceTtlMs = presenceTtlMs
		this.timer = null
		this.state = this.read()
		this.migrate()
	}

	read() {
		try {
			if (existsSync(this.file)) {
				const parsed = JSON.parse(readFileSync(this.file, "utf8"))
				return {
					players: parsed.players ?? {},
					branding: { ...DEFAULT_BRANDING, ...(parsed.branding ?? {}) },
					announcements: Array.isArray(parsed.announcements) ? parsed.announcements : [],
					cosmetics: parsed.cosmetics ?? {},
					profiles: parsed.profiles ?? {},
					release: parsed.release ?? null,
				}
			}
		} catch (error) {
			console.warn("[halcyon] the state file could not be read:", error.message)
		}

		return {
			players: {},
			branding: { ...DEFAULT_BRANDING },
			announcements: [],
			cosmetics: {},
			profiles: {},
			release: null,
		}
	}

	/**
	 * Brings records written by older builds up to the current shape, so a server that has been
	 * running since before models existed keeps every cape and every grant it already had.
	 */
	migrate() {
		let touched = false

		for (const [id, record] of Object.entries(this.state.cosmetics)) {
			if (
				record.slot === undefined ||
				record.model === undefined ||
				record.scale === undefined
			) {
				this.state.cosmetics[id] = this.shapeCosmetic(id, record, record)
				touched = true
			}
		}

		for (const profile of Object.values(this.state.profiles)) {
			const equipped = profile.equipped ?? {}
			if (equipped.back === undefined) {
				// The old shape only ever had a cape, and a cape lives on the back.
				profile.equipped = { ...emptyEquipped(), back: equipped.cape ?? null }
				touched = true
			}
		}

		if (touched) {
			this.schedulePersist()
		}
	}

	schedulePersist() {
		if (this.timer !== null) {
			return
		}

		this.timer = setTimeout(() => {
			this.timer = null
			this.persist()
		}, PERSIST_DELAY_MS)

		if (typeof this.timer.unref === "function") {
			this.timer.unref()
		}
	}

	persist() {
		try {
			const directory = dirname(this.file)
			if (!existsSync(directory)) {
				mkdirSync(directory, { recursive: true })
			}

			const temporary = `${this.file}.tmp`
			writeFileSync(temporary, JSON.stringify(this.state, null, "\t"), "utf8")
			renameSync(temporary, this.file)
		} catch (error) {
			console.error("[halcyon] the state file could not be written:", error.message)
		}
	}

	/** Records that a player is online right now. */
	heartbeat(name, details) {
		const key = playerKey(name)
		const existing = this.state.players[key] ?? {}

		this.state.players[key] = {
			name: name.trim(),
			client: details.client ?? existing.client ?? "halcyon",
			version: details.version ?? existing.version ?? "",
			firstSeen: existing.firstSeen ?? new Date().toISOString(),
			lastSeen: new Date().toISOString(),
		}

		this.schedulePersist()
		return this.state.players[key]
	}

	/** Players seen within the presence window, most recent first. */
	onlinePlayers() {
		const cutoff = Date.now() - this.presenceTtlMs
		return Object.values(this.state.players)
			.filter((player) => Date.parse(player.lastSeen) >= cutoff)
			.sort((left, right) => Date.parse(right.lastSeen) - Date.parse(left.lastSeen))
	}

	/** Drops players that have not been seen for a week so the file cannot grow forever. */
	prune(maxAgeMs) {
		const cutoff = Date.now() - maxAgeMs
		let removed = 0

		for (const [key, player] of Object.entries(this.state.players)) {
			if (Date.parse(player.lastSeen) < cutoff) {
				delete this.state.players[key]
				removed += 1
			}
		}

		if (removed > 0) {
			this.schedulePersist()
		}
		return removed
	}

	branding() {
		return this.state.branding
	}

	updateBranding(patch) {
		this.state.branding = { ...this.state.branding, ...patch }
		this.schedulePersist()
		return this.state.branding
	}

	announcements() {
		return this.state.announcements
	}

	updateAnnouncements(entries) {
		this.state.announcements = shapeAnnouncements(entries)
		this.schedulePersist()
		// Written straight away rather than on the debounce, because an announcement is something
		// the owner just pressed save on and expects to survive a restart a second later.
		this.persist()
		return this.state.announcements
	}

	/** What the launcher is told to update to, or null while nothing has been published. */
	release() {
		return this.state.release
	}

	publishRelease(entry) {
		this.state.release = {
			version: String(entry.version ?? "").trim(),
			notes: typeof entry.notes === "string" ? entry.notes : "",
			files: Array.isArray(entry.files) ? entry.files : [],
			publishedAt: new Date().toISOString(),
		}
		this.schedulePersist()
		return this.state.release
	}

	/** Every cosmetic the owner published, sorted by kind and then by name. */
	cosmetics() {
		return Object.values(this.state.cosmetics).sort(
			(left, right) =>
				String(left.type).localeCompare(String(right.type)) ||
				String(left.name).localeCompare(String(right.name)),
		)
	}

	cosmetic(id) {
		return this.state.cosmetics[normaliseCosmeticId(id)] ?? null
	}

	/**
	 * Builds the stored shape of one cosmetic from whatever the panel sent.
	 *
	 * The two things that matter are the model and the texture. Everything else is either a label or
	 * a small nudge on top of the coordinates the model was authored with.
	 */
	shapeCosmetic(id, entry, existing) {
		const type = normaliseCosmeticType(entry.type ?? existing.type)
		const placement = geometryOf(type)
		const model = normaliseAddress(entry.model ?? existing.model, "")
		const frameTextures = normaliseFrameTextures(entry.frameTextures ?? existing.frameTextures)

		return {
			id,
			type,
			slot: slotOf(type),
			name: typeof entry.name === "string" ? entry.name : (existing.name ?? id),
			description:
				typeof entry.description === "string"
					? entry.description
					: (existing.description ?? ""),
			rarity: normaliseRarity(entry.rarity ?? existing.rarity),
			texture: normaliseAddress(
				entry.texture ?? existing.texture,
				`/v1/cosmetics/textures/${id}.png`,
			),
			// The Blockbench model, already reduced to the small shape the client builds from.
			// A cosmetic without one is drawn on a flat panel, which is all a cape ever needs.
			model,
			hasModel: model !== "",
			// Kept so a client built before models existed still gets what it expects.
			frameTextures,
			animated: frameTextures.length > 1,
			frames: frameTextures.length > 1 ? frameTextures.length : 1,
			frameMs: clamp(entry.frameMs ?? existing.frameMs, 20, 5000, 100),
			// How the thing is worn, on top of its own coordinates.
			scale: decimal(entry.scale ?? existing.scale, 0.1, 4, placement.scale),
			offsetX: decimal(entry.offsetX ?? existing.offsetX, -2, 2, placement.offsetX),
			offsetY: decimal(entry.offsetY ?? existing.offsetY, -2, 2, placement.offsetY),
			offsetZ: decimal(entry.offsetZ ?? existing.offsetZ, -2, 2, placement.offsetZ),
			flap: decimal(entry.flap ?? existing.flap, 0, 1, placement.flap),
			mirror: flag(entry.mirror ?? existing.mirror, placement.mirror),
			glow: flag(entry.glow ?? existing.glow, placement.glow),
			createdAt: existing.createdAt ?? new Date().toISOString(),
		}
	}

	/**
	 * Creates or edits a cosmetic. Only the owner may call this, which is what keeps cosmetics
	 * something that has to be handed out rather than something a client can invent.
	 */
	upsertCosmetic(entry) {
		const id = normaliseCosmeticId(entry.id)
		if (id === "") {
			return null
		}

		const existing = this.state.cosmetics[id] ?? {}
		const record = this.shapeCosmetic(id, entry, existing)

		this.state.cosmetics[id] = record
		this.schedulePersist()
		return record
	}

	/** Deletes a cosmetic and takes it away from everyone who had it. */
	removeCosmetic(id) {
		const key = normaliseCosmeticId(id)
		if (key === "" || this.state.cosmetics[key] === undefined) {
			return false
		}

		delete this.state.cosmetics[key]

		for (const profile of Object.values(this.state.profiles)) {
			profile.owned = (profile.owned ?? []).filter((owned) => owned !== key)
			for (const [slot, worn] of Object.entries(profile.equipped ?? {})) {
				if (worn === key) {
					profile.equipped[slot] = null
				}
			}
		}

		this.schedulePersist()
		return true
	}

	/** What a single player owns and wears. Unknown players simply own nothing. */
	profile(name) {
		const key = playerKey(name)
		const stored = this.state.profiles[key] ?? {}
		const owned = (stored.owned ?? []).filter((id) => this.state.cosmetics[id] !== undefined)
		const equipped = emptyEquipped()

		for (const [slot, worn] of Object.entries(stored.equipped ?? {})) {
			if (equipped[slot] !== undefined && typeof worn === "string" && owned.includes(worn)) {
				equipped[slot] = worn
			}
		}

		return {
			name: stored.name ?? String(name).trim(),
			owned,
			equipped,
			// Older clients only ever looked at this one field.
			cape: equipped.back,
		}
	}

	ensureProfile(name) {
		const key = playerKey(name)
		const stored = this.state.profiles[key] ?? { owned: [], equipped: emptyEquipped() }
		stored.name = String(name).trim()
		stored.owned = stored.owned ?? []
		stored.equipped = { ...emptyEquipped(), ...(stored.equipped ?? {}) }
		this.state.profiles[key] = stored
		return stored
	}

	grant(name, id) {
		const key = playerKey(name)
		const cosmetic = normaliseCosmeticId(id)
		if (key === "" || cosmetic === "" || this.state.cosmetics[cosmetic] === undefined) {
			return null
		}

		const stored = this.ensureProfile(name)
		stored.owned = Array.from(new Set([...stored.owned, cosmetic]))

		this.schedulePersist()
		return this.profile(name)
	}

	revoke(name, id) {
		const key = playerKey(name)
		const cosmetic = normaliseCosmeticId(id)
		const stored = this.state.profiles[key]
		if (stored === undefined || cosmetic === "") {
			return this.profile(name)
		}

		stored.owned = (stored.owned ?? []).filter((owned) => owned !== cosmetic)
		for (const [slot, worn] of Object.entries(stored.equipped ?? {})) {
			if (worn === cosmetic) {
				stored.equipped[slot] = null
			}
		}

		this.schedulePersist()
		return this.profile(name)
	}

	/**
	 * Puts a cosmetic on, or takes the slot off when the id is null. Returns null when the player
	 * does not own the cosmetic, so a patched client cannot wear something it was never given.
	 */
	equip(name, id, slot) {
		const key = playerKey(name)
		if (key === "") {
			return null
		}

		const stored = this.ensureProfile(name)

		if (id === null) {
			// No slot named means the caller is an older client, which only knew about capes.
			const target = COSMETIC_SLOTS.includes(slot) ? slot : "back"
			stored.equipped[target] = null
			this.schedulePersist()
			return this.profile(name)
		}

		const cosmetic = normaliseCosmeticId(id)
		const record = this.state.cosmetics[cosmetic] ?? null
		if (record === null || !stored.owned.includes(cosmetic)) {
			return null
		}

		stored.equipped[record.slot ?? slotOf(record.type)] = cosmetic
		this.schedulePersist()
		return this.profile(name)
	}

	/** Everything every online player is wearing, so other clients can draw it. */
	worn() {
		const worn = {}
		for (const player of this.onlinePlayers()) {
			const profile = this.profile(player.name)
			const dressed = Object.entries(profile.equipped).filter(([, id]) => id !== null)
			if (dressed.length > 0) {
				worn[player.name] = Object.fromEntries(dressed)
			}
		}
		return worn
	}

	/** The cape every online player is wearing, kept for clients built before slots existed. */
	wornCapes() {
		const worn = {}
		for (const [name, slots] of Object.entries(this.worn())) {
			if (typeof slots.back === "string") {
				worn[name] = slots.back
			}
		}
		return worn
	}
}
