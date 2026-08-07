import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto"

const USERNAME = /^[A-Za-z0-9_]{3,20}$/
const EMAIL = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/
const MINECRAFT_NAME = /^[A-Za-z0-9_]{1,32}$/
const MINECRAFT_UUID = /^[0-9a-f]{32}$/

const PASSWORD_MIN = 8
const PASSWORD_MAX = 200
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const PERSIST_DELAY_MS = 1000
const KEY_LENGTH = 64

/** Hashes a password with a per account salt. scrypt is deliberately slow, which is the point. */
export function hashPassword(password) {
	const salt = randomBytes(16).toString("hex")
	const key = scryptSync(password, salt, KEY_LENGTH).toString("hex")
	return `scrypt$${salt}$${key}`
}

/** Constant time comparison, so a wrong password cannot be found one byte at a time. */
export function verifyPassword(password, stored) {
	if (typeof stored !== "string" || stored === "") {
		return false
	}

	const parts = stored.split("$")
	if (parts.length !== 3 || parts[0] !== "scrypt") {
		return false
	}

	try {
		const expected = Buffer.from(parts[2], "hex")
		const actual = scryptSync(password, parts[1], expected.length)
		return timingSafeEqual(expected, actual)
	} catch {
		return false
	}
}

/** Session tokens are stored hashed, so a stolen accounts file cannot be replayed as a login. */
function tokenKey(token) {
	return createHash("sha256").update(String(token)).digest("hex")
}

/** Dashes are optional in Mojang uuids, so everything is stored in the short lowercase form. */
function normaliseUuid(value) {
	return String(value ?? "")
		.replace(/-/g, "")
		.trim()
		.toLowerCase()
}

/**
 * Website accounts, kept in their own json file so the presence state can stay a throwaway cache
 * while this one holds the things that must survive.
 */
export class Accounts {
	constructor(file, adminUsername = "") {
		this.file = file
		this.adminUsername = String(adminUsername).trim().toLowerCase()
		this.timer = null
		this.state = this.read()
		this.pruneSessions()
	}

	read() {
		try {
			if (existsSync(this.file)) {
				const parsed = JSON.parse(readFileSync(this.file, "utf8"))
				return {
					users: parsed.users ?? {},
					sessions: parsed.sessions ?? {},
				}
			}
		} catch (error) {
			console.warn("[halcyon] the accounts file could not be read:", error.message)
		}
		return { users: {}, sessions: {} }
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
			console.error("[halcyon] the accounts file could not be written:", error.message)
		}
	}

	count() {
		return Object.keys(this.state.users).length
	}

	/** How long a fresh session lives, in seconds. Used by the launcher handoff. */
	sessionMaxAge() {
		return Math.round(SESSION_TTL_MS / 1000)
	}

	user(username) {
		const key = String(username ?? "")
			.trim()
			.toLowerCase()
		return this.state.users[key] ?? null
	}

	byEmail(email) {
		const key = String(email ?? "")
			.trim()
			.toLowerCase()
		if (key === "") {
			return null
		}
		return Object.values(this.state.users).find((user) => user.emailKey === key) ?? null
	}

	byMinecraftId(uuid) {
		const id = normaliseUuid(uuid)
		if (id === "") {
			return null
		}
		return Object.values(this.state.users).find((user) => user.minecraftId === id) ?? null
	}

	byMinecraftName(name) {
		const wanted = String(name ?? "")
			.trim()
			.toLowerCase()
		if (wanted === "") {
			return null
		}
		return (
			Object.values(this.state.users).find(
				(user) => String(user.minecraft ?? "").toLowerCase() === wanted,
			) ?? null
		)
	}

	/** Everything the website is allowed to see about an account. The secret never leaves here. */
	publicUser(user) {
		if (user === null || user === undefined) {
			return null
		}
		return {
			username: user.username,
			email: user.email ?? "",
			role: user.role,
			minecraft: user.minecraft ?? "",
			minecraftId: user.minecraftId ?? "",
			verified: String(user.minecraftId ?? "") !== "",
			hasPassword: String(user.secret ?? "") !== "",
			createdAt: user.createdAt,
			lastLoginAt: user.lastLoginAt ?? null,
		}
	}

	/** True when this account should own the panel: nobody else does, or the owner named it. */
	firstAdmin(key) {
		return this.count() === 0 || (this.adminUsername !== "" && this.adminUsername === key)
	}

	/**
	 * Creates an account. The first one ever made becomes the admin, because a fresh install has no
	 * other way to reach the panel; every later account is an ordinary member.
	 */
	register({ username, email, password }) {
		const name = String(username ?? "").trim()
		const mail = String(email ?? "")
			.trim()
			.toLowerCase()
		const secret = String(password ?? "")

		if (!USERNAME.test(name)) {
			return { error: "the username must be 3 to 20 letters, digits or underscores" }
		}
		if (!EMAIL.test(mail)) {
			return { error: "that email address does not look right" }
		}
		if (secret.length < PASSWORD_MIN || secret.length > PASSWORD_MAX) {
			return { error: `the password must be at least ${PASSWORD_MIN} characters` }
		}

		const key = name.toLowerCase()
		if (this.state.users[key] !== undefined) {
			return { error: "that username is taken" }
		}
		if (this.byEmail(mail) !== null) {
			return { error: "that email address is already registered" }
		}

		const admin = this.firstAdmin(key)
		const user = {
			username: name,
			key,
			email: mail,
			emailKey: mail,
			secret: hashPassword(secret),
			role: admin ? "admin" : "member",
			minecraft: "",
			minecraftId: "",
			createdAt: new Date().toISOString(),
			lastLoginAt: null,
		}

		this.state.users[key] = user
		this.schedulePersist()
		return { user }
	}

	/** A free username built from an in game name, since Minecraft sign in asks for nothing. */
	uniqueUsername(base) {
		let candidate = String(base ?? "").replace(/[^A-Za-z0-9_]/g, "")
		if (candidate.length < 3) {
			candidate = `${candidate}_mc`
		}
		candidate = candidate.slice(0, 20)

		if (this.state.users[candidate.toLowerCase()] === undefined) {
			return candidate
		}
		for (let index = 2; index < 100; index += 1) {
			const suffix = String(index)
			const taken = candidate.slice(0, 20 - suffix.length) + suffix
			if (this.state.users[taken.toLowerCase()] === undefined) {
				return taken
			}
		}
		return `${candidate.slice(0, 13)}_${randomBytes(3).toString("hex")}`
	}

	/**
	 * Signs in with a Minecraft identity that the caller already checked with Mojang.
	 *
	 * Three cases, in order: the uuid is known, so that is the account; the name matches an account
	 * that linked it by hand, so the claim is upgraded to a verified one; or nobody owns it, so an
	 * account is created on the spot with no password. Passwordless accounts can only be reached
	 * through Minecraft until the owner sets one on the account page.
	 */
	signInWithMinecraft(profile) {
		const id = normaliseUuid(profile?.uuid)
		const name = String(profile?.name ?? "").trim()
		if (!MINECRAFT_UUID.test(id) || !MINECRAFT_NAME.test(name)) {
			return { error: "that Minecraft profile does not look right" }
		}

		let user = this.byMinecraftId(id)
		let created = false

		if (user === null) {
			const claimed = this.byMinecraftName(name)
			if (claimed !== null && String(claimed.minecraftId ?? "") === "") {
				user = claimed
			}
		}

		if (user === null) {
			const username = this.uniqueUsername(name)
			const key = username.toLowerCase()
			user = {
				username,
				key,
				email: "",
				emailKey: "",
				secret: "",
				role: this.firstAdmin(key) ? "admin" : "member",
				minecraft: name,
				minecraftId: id,
				createdAt: new Date().toISOString(),
				lastLoginAt: null,
			}
			this.state.users[key] = user
			created = true
		}

		// Names change, uuids do not, so the stored name follows the account rather than the
		// other way round.
		user.minecraftId = id
		user.minecraft = name
		user.lastLoginAt = new Date().toISOString()
		this.schedulePersist()
		return { user, created }
	}

	/** Links a checked Minecraft identity to an account that is already signed in. */
	linkVerified(username, profile) {
		const user = this.user(username)
		if (user === null) {
			return { error: "that account does not exist" }
		}

		const id = normaliseUuid(profile?.uuid)
		const name = String(profile?.name ?? "").trim()
		if (!MINECRAFT_UUID.test(id) || !MINECRAFT_NAME.test(name)) {
			return { error: "that Minecraft profile does not look right" }
		}

		const owner = this.byMinecraftId(id)
		if (owner !== null && owner.key !== user.key) {
			return { error: "another account already owns that Minecraft account" }
		}
		const named = this.byMinecraftName(name)
		if (named !== null && named.key !== user.key) {
			return { error: "another account already claims that Minecraft name" }
		}

		user.minecraftId = id
		user.minecraft = name
		this.schedulePersist()
		return { user }
	}

	/** Accepts either the username or the email address, which is what people expect. */
	authenticate(login, password) {
		const raw = String(login ?? "").trim()
		const user = raw.includes("@") ? this.byEmail(raw) : this.user(raw)
		if (user === null) {
			return null
		}
		if (!verifyPassword(String(password ?? ""), user.secret)) {
			return null
		}

		user.lastLoginAt = new Date().toISOString()
		this.schedulePersist()
		return user
	}

	createSession(username) {
		const user = this.user(username)
		if (user === null) {
			return null
		}

		const token = randomBytes(32).toString("hex")
		this.state.sessions[tokenKey(token)] = {
			username: user.key,
			createdAt: new Date().toISOString(),
			expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
		}
		this.schedulePersist()
		return { token, maxAgeSeconds: this.sessionMaxAge() }
	}

	sessionUser(token) {
		if (typeof token !== "string" || token === "") {
			return null
		}

		const key = tokenKey(token)
		const session = this.state.sessions[key]
		if (session === undefined) {
			return null
		}
		if (Date.parse(session.expiresAt) < Date.now()) {
			delete this.state.sessions[key]
			this.schedulePersist()
			return null
		}
		return this.state.users[session.username] ?? null
	}

	destroySession(token) {
		if (typeof token !== "string" || token === "") {
			return
		}
		delete this.state.sessions[tokenKey(token)]
		this.schedulePersist()
	}

	/** Signs an account out everywhere, used after a password change. */
	destroySessionsFor(username) {
		const key = String(username ?? "")
			.trim()
			.toLowerCase()
		for (const [token, session] of Object.entries(this.state.sessions)) {
			if (session.username === key) {
				delete this.state.sessions[token]
			}
		}
		this.schedulePersist()
	}

	pruneSessions() {
		const now = Date.now()
		let removed = 0
		for (const [token, session] of Object.entries(this.state.sessions)) {
			if (Date.parse(session.expiresAt) < now) {
				delete this.state.sessions[token]
				removed += 1
			}
		}
		if (removed > 0) {
			this.schedulePersist()
		}
		return removed
	}

	/**
	 * Changes a password. An account created through Minecraft has none yet, so the current one is
	 * only demanded when there is something to check.
	 */
	changePassword(username, current, next) {
		const user = this.user(username)
		if (user === null) {
			return { error: "that account does not exist" }
		}

		const hasPassword = String(user.secret ?? "") !== ""
		if (hasPassword && !verifyPassword(String(current ?? ""), user.secret)) {
			return { error: "the current password is wrong" }
		}

		const secret = String(next ?? "")
		if (secret.length < PASSWORD_MIN || secret.length > PASSWORD_MAX) {
			return { error: `the password must be at least ${PASSWORD_MIN} characters` }
		}

		user.secret = hashPassword(secret)
		this.destroySessionsFor(user.key)
		this.schedulePersist()
		return { user }
	}

	/** Adds or replaces the email address, needed by accounts made through Minecraft. */
	setEmail(username, email) {
		const user = this.user(username)
		if (user === null) {
			return { error: "that account does not exist" }
		}

		const mail = String(email ?? "")
			.trim()
			.toLowerCase()
		if (!EMAIL.test(mail)) {
			return { error: "that email address does not look right" }
		}

		const owner = this.byEmail(mail)
		if (owner !== null && owner.key !== user.key) {
			return { error: "that email address is already registered" }
		}

		user.email = mail
		user.emailKey = mail
		this.schedulePersist()
		return { user }
	}

	/** Ties a website account to an in game name so cosmetics can follow the person. */
	linkMinecraft(username, minecraft) {
		const user = this.user(username)
		if (user === null) {
			return { error: "that account does not exist" }
		}

		const name = String(minecraft ?? "").trim()
		if (name !== "" && !MINECRAFT_NAME.test(name)) {
			return { error: "that is not a valid Minecraft name" }
		}
		if (name === "" && String(user.minecraftId ?? "") !== "") {
			return { error: "a verified Minecraft account cannot be unlinked by hand" }
		}

		const taken = Object.values(this.state.users).find(
			(other) =>
				other.key !== user.key &&
				String(other.minecraft ?? "").toLowerCase() === name.toLowerCase() &&
				name !== "",
		)
		if (taken !== undefined) {
			return { error: "another account already claims that Minecraft name" }
		}

		user.minecraft = name
		this.schedulePersist()
		return { user }
	}

	setRole(username, role) {
		const user = this.user(username)
		if (user === null) {
			return { error: "that account does not exist" }
		}
		if (role !== "admin" && role !== "member") {
			return { error: "a role is either admin or member" }
		}

		const admins = Object.values(this.state.users).filter((entry) => entry.role === "admin")
		if (role === "member" && user.role === "admin" && admins.length <= 1) {
			return { error: "the last admin cannot be demoted" }
		}

		user.role = role
		this.schedulePersist()
		return { user }
	}

	remove(username) {
		const user = this.user(username)
		if (user === null) {
			return { error: "that account does not exist" }
		}

		const admins = Object.values(this.state.users).filter((entry) => entry.role === "admin")
		if (user.role === "admin" && admins.length <= 1) {
			return { error: "the last admin cannot be deleted" }
		}

		delete this.state.users[user.key]
		this.destroySessionsFor(user.key)
		this.schedulePersist()
		return { removed: user.username }
	}

	/** Newest first, which is the order the admin panel wants. */
	list() {
		return Object.values(this.state.users)
			.map((user) => this.publicUser(user))
			.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
	}

	stats() {
		const users = Object.values(this.state.users)
		const dayAgo = Date.now() - 24 * 60 * 60 * 1000
		const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
		return {
			registered: users.length,
			admins: users.filter((user) => user.role === "admin").length,
			linked: users.filter((user) => String(user.minecraft ?? "") !== "").length,
			verified: users.filter((user) => String(user.minecraftId ?? "") !== "").length,
			newToday: users.filter((user) => Date.parse(user.createdAt) >= dayAgo).length,
			newThisWeek: users.filter((user) => Date.parse(user.createdAt) >= weekAgo).length,
			activeSessions: Object.keys(this.state.sessions).length,
		}
	}
}
