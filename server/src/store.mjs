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

/**
 * Every kind of cosmetic the client knows how to wear.
 *
 * A slot is what actually decides what replaces what: capes and wings both hang off the back, so
 * wearing wings takes the cape off rather than drawing both through each other. Adding a new kind
 * of cosmetic later is a line in this table and nothing else.
 */
export const COSMETIC_TYPES = {
	cape: { slot: "back", label: "Cape" },
	wings: { slot: "back", label: "Wings" },
	backpack: { slot: "back", label: "Backpack" },
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

function normaliseRarity(value) {
	const text = typeof value === "string" ? value.trim().toLowerCase() : ""
	return RARITIES.includes(text) ? text : "common"
}

function clamp(value, low, high, fallback) {
	const number = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10)
	if (!Number.isFinite(number)) {
		return fallback
	}
	return Math.min(high, Math.max(low, Math.round(number)))
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
	 * running since before wings existed keeps every cape and every grant it already had.
	 */
	migrate() {
		let touched = false

		for (const [id, record] of Object.entries(this.state.cosmetics)) {
			if (record.slot === undefined || record.animated === undefined) {
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
		this.state.announcements = entries
		this.schedulePersist()
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

	/** Builds the stored shape of one cosmetic from whatever the panel sent. */
	shapeCosmetic(id, entry, existing) {
		const type = normaliseCosmeticType(entry.type ?? existing.type)
		const animated =
			typeof entry.animated === "boolean" ? entry.animated : (existing.animated ?? false)
		const frames = clamp(entry.frames ?? existing.frames, 1, 64, 1)

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
			texture:
				typeof entry.texture === "string" && entry.texture.trim() !== ""
					? entry.texture.trim()
					: (existing.texture ?? `/v1/cosmetics/textures/${id}.png`),
			// An animated texture is one tall strip of frames, played top to bottom on a loop.
			animated: animated && frames > 1,
			frames: animated ? Math.max(2, frames) : 1,
			frameMs: clamp(entry.frameMs ?? existing.frameMs, 20, 5000, 100),
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
