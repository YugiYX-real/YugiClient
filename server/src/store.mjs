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

/** Returns the cleaned cosmetic id, or an empty string when the value cannot be used. */
export function normaliseCosmeticId(value) {
	const text = typeof value === "string" ? value.trim().toLowerCase() : ""
	return COSMETIC_ID.test(text) ? text : ""
}

/** Players are addressed case insensitively everywhere. */
export function playerKey(name) {
	return typeof name === "string" ? name.trim().toLowerCase() : ""
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

	/** Every cosmetic the owner published, sorted by name. */
	cosmetics() {
		return Object.values(this.state.cosmetics).sort((left, right) =>
			String(left.name).localeCompare(String(right.name)),
		)
	}

	cosmetic(id) {
		return this.state.cosmetics[normaliseCosmeticId(id)] ?? null
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
		const record = {
			id,
			type: "cape",
			name: typeof entry.name === "string" ? entry.name : (existing.name ?? id),
			description:
				typeof entry.description === "string"
					? entry.description
					: (existing.description ?? ""),
			rarity: typeof entry.rarity === "string" ? entry.rarity : (existing.rarity ?? "common"),
			texture:
				typeof entry.texture === "string" && entry.texture.trim() !== ""
					? entry.texture.trim()
					: (existing.texture ?? `/v1/cosmetics/textures/${id}.png`),
			createdAt: existing.createdAt ?? new Date().toISOString(),
		}

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
			if (profile.equipped?.cape === key) {
				profile.equipped.cape = null
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
		const cape = stored.equipped?.cape ?? null

		return {
			name: stored.name ?? String(name).trim(),
			owned,
			equipped: { cape: owned.includes(cape) ? cape : null },
		}
	}

	grant(name, id) {
		const key = playerKey(name)
		const cosmetic = normaliseCosmeticId(id)
		if (key === "" || cosmetic === "" || this.state.cosmetics[cosmetic] === undefined) {
			return null
		}

		const stored = this.state.profiles[key] ?? {
			name: String(name).trim(),
			owned: [],
			equipped: {},
		}
		stored.name = String(name).trim()
		stored.owned = Array.from(new Set([...(stored.owned ?? []), cosmetic]))
		stored.equipped = stored.equipped ?? {}
		this.state.profiles[key] = stored

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
		if (stored.equipped?.cape === cosmetic) {
			stored.equipped.cape = null
		}

		this.schedulePersist()
		return this.profile(name)
	}

	/**
	 * Puts a cape on, or takes it off when the id is null. Returns null when the player does not own
	 * the cosmetic, so a patched client cannot wear something it was never given.
	 */
	equip(name, id) {
		const key = playerKey(name)
		if (key === "") {
			return null
		}

		const stored = this.state.profiles[key] ?? {
			name: String(name).trim(),
			owned: [],
			equipped: {},
		}
		stored.name = String(name).trim()
		stored.owned = stored.owned ?? []
		stored.equipped = stored.equipped ?? {}

		if (id === null) {
			stored.equipped.cape = null
		} else {
			const cosmetic = normaliseCosmeticId(id)
			if (cosmetic === "" || !stored.owned.includes(cosmetic)) {
				return null
			}
			stored.equipped.cape = cosmetic
		}

		this.state.profiles[key] = stored
		this.schedulePersist()
		return this.profile(name)
	}

	/** The cape every online player is wearing, so other clients can draw it. */
	wornCapes() {
		const worn = {}
		for (const player of this.onlinePlayers()) {
			const profile = this.profile(player.name)
			if (profile.equipped.cape !== null) {
				worn[player.name] = profile.equipped.cape
			}
		}
		return worn
	}
}
