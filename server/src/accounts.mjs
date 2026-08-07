import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto"

const USERNAME = /^[A-Za-z0-9_]{3,20}$/
const EMAIL = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/
const MINECRAFT_NAME = /^[A-Za-z0-9_]{1,32}$/

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
	if (typeof stored !== "string") {
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
		return Object.values(this.state.users).find((user) => user.emailKey === key) ?? null
	}

	/** Everything the website is allowed to see about an account. The secret never leaves here. */
	publicUser(user) {
		if (user === null || user === undefined) {
			return null
		}
		return {
			username: user.username,
			email: user.email,
			role: user.role,
			minecraft: user.minecraft ?? "",
			createdAt: user.createdAt,
			lastLoginAt: user.lastLoginAt ?? null,
		}
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

		const first = this.count() === 0
		const named = this.adminUsername !== "" && this.adminUsername === key
		const user = {
			username: name,
			key,
			email: mail,
			emailKey: mail,
			secret: hashPassword(secret),
			role: first || named ? "admin" : "member",
			minecraft: "",
			createdAt: new Date().toISOString(),
			lastLoginAt: null,
		}

		this.state.users[key] = user
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
		return { token, maxAgeSeconds: Math.round(SESSION_TTL_MS / 1000) }
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

	changePassword(username, current, next) {
		const user = this.user(username)
		if (user === null) {
			return { error: "that account does not exist" }
		}
		if (!verifyPassword(String(current ?? ""), user.secret)) {
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
			newToday: users.filter((user) => Date.parse(user.createdAt) >= dayAgo).length,
			newThisWeek: users.filter((user) => Date.parse(user.createdAt) >= weekAgo).length,
			activeSessions: Object.keys(this.state.sessions).length,
		}
	}
}
