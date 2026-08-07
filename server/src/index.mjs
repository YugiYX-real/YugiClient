import { createServer } from "node:http"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, readdir, rename, stat, unlink, writeFile } from "node:fs/promises"
import { dirname, extname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { pipeline } from "node:stream/promises"

import { COSMETIC_SLOTS, COSMETIC_TYPES, Store, normaliseCosmeticId } from "./store.mjs"
import { Accounts } from "./accounts.mjs"
import { minecraftProfile } from "./minecraft.mjs"
import { serveSite } from "./site.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))

const PORT = Number.parseInt(process.env.PORT ?? "8787", 10)
const HOST = process.env.HOST ?? "127.0.0.1"
const DATA_FILE = resolve(process.env.DATA_FILE ?? "./data/state.json")

// Installers and cosmetic textures live beside the state file unless told otherwise, so the
// folders are always ones the service account already owns.
const UPDATE_DIR = resolve(process.env.UPDATE_DIR ?? join(dirname(DATA_FILE), "updates"))
const COSMETIC_DIR = resolve(process.env.COSMETIC_DIR ?? join(dirname(DATA_FILE), "cosmetics"))
const ACCOUNT_FILE = resolve(process.env.ACCOUNT_FILE ?? join(dirname(DATA_FILE), "accounts.json"))
const PUBLIC_DIR = resolve(process.env.PUBLIC_DIR ?? join(HERE, "..", "public"))

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? ""
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? ""
const CLIENT_KEY = process.env.CLIENT_KEY ?? ""
const PRESENCE_TTL_MS = Number.parseInt(process.env.PRESENCE_TTL_SECONDS ?? "300", 10) * 1000
const RETENTION_MS = Number.parseInt(process.env.RETENTION_DAYS ?? "7", 10) * 24 * 60 * 60 * 1000

// A Minecraft access token is a long JWT, so the body budget has to clear it comfortably.
const MAX_BODY_BYTES = 64 * 1024
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const RATE_LIMIT_MAX = 240
// Guessing a password should be slow, so sign in and sign up get their own much tighter budget.
const AUTH_LIMIT_MAX = 12

const UPDATE_PREFIX = "/v1/updates"
const COSMETIC_PREFIX = "/v1/cosmetics"
const COSMETIC_TEXTURE_PREFIX = `${COSMETIC_PREFIX}/textures`
const COSMETIC_PLAYER_PREFIX = `${COSMETIC_PREFIX}/player`
const AUTH_PREFIX = "/v1/auth"
const ACCOUNT_PREFIX = "/v1/account"
const ADMIN_PREFIX = "/v1/admin"
const SESSION_COOKIE = "halcyon_session"

const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const PLAYER_NAME = /^[A-Za-z0-9_]{1,32}$/
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/
const BASE64 = /^[A-Za-z0-9+/=]{16,256}$/
const CONTENT_TYPES = {
	".yml": "text/yaml; charset=utf-8",
	".yaml": "text/yaml; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".zip": "application/zip",
	".gz": "application/gzip",
}

const store = new Store(DATA_FILE, PRESENCE_TTL_MS)
const accounts = new Accounts(ACCOUNT_FILE, ADMIN_USERNAME)
const startedAt = Date.now()
const hits = new Map()
const authHits = new Map()

/** The path without the query string. Parsed by hand so no base address is needed. */
function pathOf(request) {
	const target = request.url ?? "/"
	const mark = target.indexOf("?")
	return mark === -1 ? target : target.slice(0, mark)
}

/** The query string of a request, as searchable parameters. */
function queryOf(request) {
	const target = request.url ?? ""
	const mark = target.indexOf("?")
	return new URLSearchParams(mark === -1 ? "" : target.slice(mark + 1))
}

function counted(bucket, address, limit) {
	const now = Date.now()
	const entry = bucket.get(address)

	if (entry === undefined || now - entry.since > RATE_LIMIT_WINDOW_MS) {
		bucket.set(address, { since: now, count: 1 })
		return false
	}

	entry.count += 1
	return entry.count > limit
}

function rateLimited(address) {
	return counted(hits, address, RATE_LIMIT_MAX)
}

function send(response, status, payload, extra = {}) {
	const body = payload === undefined ? "" : JSON.stringify(payload)
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(body),
		"access-control-allow-origin": "*",
		"access-control-allow-headers": "content-type, authorization, x-halcyon-key",
		"access-control-allow-methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
		"cache-control": "no-store",
		...extra,
	})
	response.end(body)
}

function readBody(request) {
	return new Promise((accept, reject) => {
		const chunks = []
		let size = 0

		request.on("data", (chunk) => {
			size += chunk.length
			if (size > MAX_BODY_BYTES) {
				reject(new Error("the request body is too large"))
				request.destroy()
				return
			}
			chunks.push(chunk)
		})
		request.on("end", () => accept(Buffer.concat(chunks).toString("utf8")))
		request.on("error", reject)
	})
}

/** Reads a json body, returning null when it cannot be parsed. */
async function readJson(request) {
	const raw = await readBody(request)
	try {
		return JSON.parse(raw === "" ? "{}" : raw)
	} catch {
		return null
	}
}

function cookies(request) {
	const header = request.headers.cookie
	const jar = {}
	if (typeof header !== "string") {
		return jar
	}

	for (const part of header.split(";")) {
		const mark = part.indexOf("=")
		if (mark === -1) {
			continue
		}
		try {
			jar[part.slice(0, mark).trim()] = decodeURIComponent(part.slice(mark + 1).trim())
		} catch {
			continue
		}
	}
	return jar
}

/**
 * The session cookie. HttpOnly keeps it away from page scripts, SameSite keeps it off other
 * sites, and there is no Secure flag because the service still answers on plain http.
 */
function sessionCookie(token, maxAgeSeconds) {
	return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`
}

function sessionToken(request) {
	return cookies(request)[SESSION_COOKIE] ?? ""
}

function currentUser(request) {
	return accounts.sessionUser(sessionToken(request))
}

function clientAllowed(request) {
	if (CLIENT_KEY === "") {
		return true
	}
	return request.headers["x-halcyon-key"] === CLIENT_KEY
}

/**
 * Admin work can arrive two ways: a curl call carrying the token, or a signed in owner clicking
 * around the panel. Both are the same authority, so both are accepted here.
 */
function adminAllowed(request) {
	if (ADMIN_TOKEN !== "" && request.headers.authorization === `Bearer ${ADMIN_TOKEN}`) {
		return true
	}
	const user = currentUser(request)
	return user !== null && user.role === "admin"
}

function requireAdmin(request, response) {
	if (adminAllowed(request)) {
		return true
	}
	send(response, 401, { error: "an admin token or an admin session is required" })
	return false
}

/** The file a request points at below a prefix, or null when the path is not one. */
function fileNameFrom(path, prefix) {
	if (!path.startsWith(`${prefix}/`)) {
		return null
	}
	let name = ""
	try {
		name = decodeURIComponent(path.slice(prefix.length + 1))
	} catch {
		return null
	}
	return SAFE_FILE_NAME.test(name) ? name : null
}

/** A single byte range, the only shape the launcher is asked to request. */
function parseRange(header, size) {
	if (typeof header !== "string") {
		return null
	}
	const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
	if (match === null) {
		return null
	}

	const rawStart = match[1]
	const rawEnd = match[2]
	if (rawStart === "" && rawEnd === "") {
		return null
	}
	if (rawStart === "") {
		const length = Number.parseInt(rawEnd, 10)
		return length > 0 ? { start: Math.max(0, size - length), end: size - 1 } : null
	}

	const start = Number.parseInt(rawStart, 10)
	const end = rawEnd === "" ? size - 1 : Math.min(Number.parseInt(rawEnd, 10), size - 1)
	if (start > end || start >= size) {
		return null
	}
	return { start, end }
}

async function listFiles(directory) {
	let entries = []
	try {
		entries = await readdir(directory)
	} catch {
		return []
	}

	const files = []
	for (const entry of entries) {
		if (entry.endsWith(".part")) {
			continue
		}
		const info = await stat(join(directory, entry))
		if (info.isFile()) {
			files.push({
				name: entry,
				bytes: info.size,
				modifiedAt: new Date(info.mtimeMs).toISOString(),
			})
		}
	}
	return files.sort((left, right) => left.name.localeCompare(right.name))
}

async function serveFile(request, response, directory, name) {
	const file = join(directory, name)
	let info = null
	try {
		info = await stat(file)
	} catch {
		send(response, 404, { error: "that file is not on the server" })
		return
	}
	if (!info.isFile()) {
		send(response, 404, { error: "that file is not on the server" })
		return
	}

	const extension = extname(name).toLowerCase()
	const head = {
		"content-type": CONTENT_TYPES[extension] ?? "application/octet-stream",
		"accept-ranges": "bytes",
		"access-control-allow-origin": "*",
		"cache-control": extension === ".yml" ? "no-store" : "public, max-age=86400",
	}

	if (request.method === "HEAD") {
		response.writeHead(200, { ...head, "content-length": info.size })
		response.end()
		return
	}

	const range = parseRange(request.headers.range, info.size)
	if (range === null) {
		response.writeHead(200, { ...head, "content-length": info.size })
		await pipeline(createReadStream(file), response)
		return
	}

	response.writeHead(206, {
		...head,
		"content-length": range.end - range.start + 1,
		"content-range": `bytes ${range.start}-${range.end}/${info.size}`,
	})
	await pipeline(createReadStream(file, { start: range.start, end: range.end }), response)
}

async function receiveFile(request, response, directory, name) {
	if (!requireAdmin(request, response)) {
		return
	}

	await mkdir(directory, { recursive: true })
	const target = join(directory, name)
	const partial = `${target}.part`

	try {
		await pipeline(request, createWriteStream(partial))
		await rename(partial, target)
	} catch (error) {
		await unlink(partial).catch(() => undefined)
		throw error
	}

	const info = await stat(target)
	console.log(`[halcyon] stored ${name} (${info.size} bytes)`)
	send(response, 200, { file: name, bytes: info.size })
}

async function removeFile(request, response, directory, name) {
	if (!requireAdmin(request, response)) {
		return
	}

	try {
		await unlink(join(directory, name))
	} catch {
		send(response, 404, { error: "that file is not on the server" })
		return
	}
	send(response, 200, { removed: name })
}

/** Handles every file verb below a prefix. Returns false when the path is not a file path. */
async function handleFiles(request, response, path, prefix, directory) {
	if (path === prefix && (request.method === "GET" || request.method === "HEAD")) {
		send(response, 200, { files: await listFiles(directory) })
		return true
	}

	const name = fileNameFrom(path, prefix)
	if (name === null) {
		return false
	}

	if (request.method === "GET" || request.method === "HEAD") {
		await serveFile(request, response, directory, name)
		return true
	}
	if (request.method === "PUT") {
		await receiveFile(request, response, directory, name)
		return true
	}
	if (request.method === "DELETE") {
		await removeFile(request, response, directory, name)
		return true
	}

	send(response, 405, { error: "that method is not allowed for files" })
	return true
}

function validName(value) {
	const name = typeof value === "string" ? value.trim() : ""
	return PLAYER_NAME.test(name) ? name : ""
}

/**
 * Which update feed an installer belongs in. The launcher asks for one of these three names
 * depending on the machine it runs on, so a Windows installer must not end up in the Linux feed.
 */
function feedFor(name) {
	const lower = name.toLowerCase()
	if (lower.endsWith(".dmg") || (lower.endsWith(".zip") && lower.includes("mac"))) {
		return "latest-mac.yml"
	}
	if (
		lower.endsWith(".appimage") ||
		lower.endsWith(".deb") ||
		lower.endsWith(".rpm") ||
		lower.endsWith(".tar.gz")
	) {
		return "latest-linux.yml"
	}
	return "latest.yml"
}

/**
 * Writes the little yaml files the launcher polls.
 *
 * The panel uploads the installer and works out its sha512 in the browser, so all that is left
 * here is describing what was uploaded in the shape the updater expects.
 */
async function writeFeeds(version, files, releaseDate) {
	const grouped = new Map()
	for (const file of files) {
		const feed = feedFor(file.name)
		grouped.set(feed, [...(grouped.get(feed) ?? []), file])
	}

	await mkdir(UPDATE_DIR, { recursive: true })
	const written = []

	for (const [feed, entries] of grouped) {
		const first = entries[0]
		const lines = [`version: ${version}`, "files:"]
		for (const entry of entries) {
			lines.push(`  - url: ${entry.name}`)
			lines.push(`    sha512: ${entry.sha512}`)
			lines.push(`    size: ${entry.size}`)
		}
		lines.push(`path: ${first.name}`)
		lines.push(`sha512: ${first.sha512}`)
		lines.push(`releaseDate: '${releaseDate}'`)
		await writeFile(join(UPDATE_DIR, feed), `${lines.join("\n")}\n`, "utf8")
		written.push(feed)
	}

	return written
}

/** The numbers the website shows. Cheap enough to compute on every request. */
function statistics() {
	const online = store.onlinePlayers()
	const known = Object.keys(store.state.players).length
	const worn = store.wornCapes()
	const profiles = Object.values(store.state.profiles)

	return {
		...accounts.stats(),
		online: online.length,
		playersKnown: known,
		cosmetics: store.cosmetics().length,
		capesWorn: Object.keys(worn).length,
		playersWithCosmetics: profiles.filter((profile) => (profile.owned ?? []).length > 0).length,
		version: store.release()?.version ?? "",
		uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
	}
}

/**
 * Everything a signed in person is shown about themselves, in one payload: the account, the in
 * game profile behind it, the cosmetics they own and whatever is being announced.
 */
function overviewFor(user) {
	const linked = String(user.minecraft ?? "")
	const profile = linked === "" ? null : store.profile(linked)
	const owned = (profile?.owned ?? []).map((id) => store.cosmetic(id)).filter(Boolean)
	return {
		user: accounts.publicUser(user),
		profile,
		owned,
		announcements: store.announcements(),
	}
}

async function handleAuth(request, response, path) {
	const route = `${request.method} ${path}`

	if (route === `GET ${AUTH_PREFIX}/me`) {
		const user = currentUser(request)
		send(response, 200, { user: accounts.publicUser(user) })
		return true
	}

	if (route === `POST ${AUTH_PREFIX}/register`) {
		const payload = await readJson(request)
		if (payload === null) {
			send(response, 400, { error: "the body is not valid json" })
			return true
		}

		const result = accounts.register(payload)
		if (result.error !== undefined) {
			send(response, 400, { error: result.error })
			return true
		}

		const session = accounts.createSession(result.user.username)
		send(
			response,
			201,
			{ user: accounts.publicUser(result.user) },
			{ "set-cookie": sessionCookie(session.token, session.maxAgeSeconds) },
		)
		console.log(`[halcyon] registered ${result.user.username} as ${result.user.role}`)
		return true
	}

	if (route === `POST ${AUTH_PREFIX}/login`) {
		const payload = await readJson(request)
		if (payload === null) {
			send(response, 400, { error: "the body is not valid json" })
			return true
		}

		const user = accounts.authenticate(payload.login ?? payload.username, payload.password)
		if (user === null) {
			// One message for both cases, so the form cannot be used to discover usernames.
			send(response, 401, { error: "those details do not match an account" })
			return true
		}

		const session = accounts.createSession(user.username)
		send(
			response,
			200,
			{ user: accounts.publicUser(user) },
			{ "set-cookie": sessionCookie(session.token, session.maxAgeSeconds) },
		)
		return true
	}

	/**
	 * Sign in with the Minecraft account the launcher already holds.
	 *
	 * The launcher posts its Minecraft access token, the server asks Mojang whose it is, and the
	 * answer becomes the account. Nothing is trusted from the body itself, and the token is not
	 * kept once the check is done.
	 */
	if (route === `POST ${AUTH_PREFIX}/minecraft`) {
		const payload = await readJson(request)
		if (payload === null) {
			send(response, 400, { error: "the body is not valid json" })
			return true
		}

		const profile = await minecraftProfile(payload.accessToken)
		if (profile === null) {
			send(response, 401, {
				error: "Minecraft did not accept that session, sign in again in the launcher",
			})
			return true
		}

		const result = accounts.signInWithMinecraft(profile)
		if (result.error !== undefined) {
			send(response, 400, { error: result.error })
			return true
		}

		const session = accounts.createSession(result.user.username)
		if (result.created) {
			console.log(`[halcyon] ${result.user.username} joined through Minecraft`)
		}
		send(
			response,
			200,
			{
				user: accounts.publicUser(result.user),
				created: result.created === true,
				token: session.token,
				maxAgeSeconds: session.maxAgeSeconds,
				overview: overviewFor(result.user),
			},
			{ "set-cookie": sessionCookie(session.token, session.maxAgeSeconds) },
		)
		return true
	}

	/**
	 * Turns a session token into a browser cookie, so the launcher can open the website with the
	 * player already signed in rather than asking them to type anything.
	 */
	if (route === `GET ${AUTH_PREFIX}/handoff`) {
		const token = queryOf(request).get("token") ?? ""
		const user = accounts.sessionUser(token)
		if (user === null) {
			response.writeHead(302, { location: "/login", "cache-control": "no-store" })
			response.end()
			return true
		}

		response.writeHead(302, {
			location: "/account",
			"cache-control": "no-store",
			"set-cookie": sessionCookie(token, accounts.sessionMaxAge()),
		})
		response.end()
		return true
	}

	if (route === `POST ${AUTH_PREFIX}/logout`) {
		accounts.destroySession(sessionToken(request))
		send(response, 200, { ok: true }, { "set-cookie": sessionCookie("", 0) })
		return true
	}

	return false
}

async function handleAccount(request, response, path) {
	if (!path.startsWith(`${ACCOUNT_PREFIX}/`)) {
		return false
	}

	const user = currentUser(request)
	if (user === null) {
		send(response, 401, { error: "sign in first" })
		return true
	}

	const route = `${request.method} ${path}`

	if (route === `GET ${ACCOUNT_PREFIX}/overview`) {
		send(response, 200, overviewFor(user))
		return true
	}

	if (route === `POST ${ACCOUNT_PREFIX}/minecraft`) {
		const payload = await readJson(request)
		if (payload === null) {
			send(response, 400, { error: "the body is not valid json" })
			return true
		}

		// A token means the launcher is linking, and that link is proven rather than claimed.
		if (typeof payload.accessToken === "string" && payload.accessToken.trim() !== "") {
			const profile = await minecraftProfile(payload.accessToken)
			if (profile === null) {
				send(response, 401, {
					error: "Minecraft did not accept that session, sign in again in the launcher",
				})
				return true
			}

			const linked = accounts.linkVerified(user.username, profile)
			if (linked.error !== undefined) {
				send(response, 409, { error: linked.error })
				return true
			}
			send(response, 200, { user: accounts.publicUser(linked.user), verified: true })
			return true
		}

		const result = accounts.linkMinecraft(user.username, payload.minecraft)
		if (result.error !== undefined) {
			send(response, 400, { error: result.error })
			return true
		}
		send(response, 200, { user: accounts.publicUser(result.user), verified: false })
		return true
	}

	if (route === `POST ${ACCOUNT_PREFIX}/email`) {
		const payload = await readJson(request)
		if (payload === null) {
			send(response, 400, { error: "the body is not valid json" })
			return true
		}

		const result = accounts.setEmail(user.username, payload.email)
		if (result.error !== undefined) {
			send(response, 400, { error: result.error })
			return true
		}
		send(response, 200, { user: accounts.publicUser(result.user) })
		return true
	}

	if (route === `POST ${ACCOUNT_PREFIX}/password`) {
		const payload = await readJson(request)
		if (payload === null) {
			send(response, 400, { error: "the body is not valid json" })
			return true
		}

		const result = accounts.changePassword(user.username, payload.current, payload.next)
		if (result.error !== undefined) {
			send(response, 400, { error: result.error })
			return true
		}
		// Every session died with the change, including this one, so the cookie goes too.
		send(response, 200, { ok: true }, { "set-cookie": sessionCookie("", 0) })
		return true
	}

	send(response, 404, { error: "unknown endpoint" })
	return true
}

async function handleAdmin(request, response, path) {
	if (!path.startsWith(`${ADMIN_PREFIX}/`)) {
		return false
	}
	if (!requireAdmin(request, response)) {
		return true
	}

	const route = `${request.method} ${path}`

	if (route === `GET ${ADMIN_PREFIX}/overview`) {
		const grants = Object.values(store.state.profiles)
			.filter((profile) => (profile.owned ?? []).length > 0)
			.map((profile) => ({
				name: profile.name,
				owned: profile.owned ?? [],
				equipped: profile.equipped ?? {},
			}))
			.sort((left, right) => left.name.localeCompare(right.name))

		send(response, 200, {
			stats: statistics(),
			accounts: accounts.list(),
			cosmetics: store.cosmetics(),
			types: COSMETIC_TYPES,
			slots: COSMETIC_SLOTS,
			grants,
			announcements: store.announcements(),
			branding: store.branding(),
			players: store.onlinePlayers(),
			release: store.release(),
			updates: await listFiles(UPDATE_DIR),
		})
		return true
	}

	if (route === `POST ${ADMIN_PREFIX}/role`) {
		const payload = await readJson(request)
		if (payload === null) {
			send(response, 400, { error: "the body is not valid json" })
			return true
		}

		const result = accounts.setRole(payload.username, payload.role)
		if (result.error !== undefined) {
			send(response, 400, { error: result.error })
			return true
		}
		send(response, 200, { user: accounts.publicUser(result.user) })
		return true
	}

	if (route === `POST ${ADMIN_PREFIX}/remove-account`) {
		const payload = await readJson(request)
		if (payload === null) {
			send(response, 400, { error: "the body is not valid json" })
			return true
		}

		const result = accounts.remove(payload.username)
		if (result.error !== undefined) {
			send(response, 400, { error: result.error })
			return true
		}
		send(response, 200, result)
		return true
	}

	send(response, 404, { error: "unknown endpoint" })
	return true
}

async function handleUpdates(request, response, path) {
	const route = `${request.method} ${path}`

	if (route === `GET ${UPDATE_PREFIX}` || route === `HEAD ${UPDATE_PREFIX}`) {
		send(response, 200, {
			feed: `${UPDATE_PREFIX}/latest.yml`,
			release: store.release(),
			files: await listFiles(UPDATE_DIR),
		})
		return true
	}

	if (route === `GET ${UPDATE_PREFIX}/status`) {
		const release = store.release()
		send(response, 200, {
			published: release !== null,
			release,
			files: await listFiles(UPDATE_DIR),
		})
		return true
	}

	/**
	 * Publishes a version.
	 *
	 * The installers themselves are uploaded first, one PUT each, and this call is what makes them
	 * the version every launcher will offer. Checksums are worked out by whoever uploaded the file
	 * rather than here, so publishing costs the server nothing even for a large installer.
	 */
	if (route === `POST ${UPDATE_PREFIX}/publish`) {
		if (!requireAdmin(request, response)) {
			return true
		}

		const payload = await readJson(request)
		if (payload === null) {
			send(response, 400, { error: "the body is not valid json" })
			return true
		}

		const version = String(payload.version ?? "")
			.trim()
			.replace(/^v/, "")
		if (!VERSION.test(version)) {
			send(response, 400, { error: "a version like 1.2.5 is required" })
			return true
		}

		const wanted = Array.isArray(payload.files) ? payload.files : []
		const files = []
		for (const entry of wanted) {
			const name = typeof entry?.name === "string" ? entry.name.trim() : ""
			const sha512 = typeof entry?.sha512 === "string" ? entry.sha512.trim() : ""
			const size = Number(entry?.size)
			if (!SAFE_FILE_NAME.test(name) || !BASE64.test(sha512) || !Number.isFinite(size)) {
				send(response, 400, { error: `${name} is missing a name, checksum or size` })
				return true
			}

			try {
				const info = await stat(join(UPDATE_DIR, name))
				if (info.size !== Math.round(size)) {
					send(response, 409, {
						error: `${name} on the server is a different size, upload it again`,
					})
					return true
				}
			} catch {
				send(response, 404, { error: `${name} has not been uploaded yet` })
				return true
			}

			files.push({ name, sha512, size: Math.round(size) })
		}

		if (files.length === 0) {
			send(response, 400, { error: "at least one installer is required" })
			return true
		}

		const releaseDate = new Date().toISOString()
		const feeds = await writeFeeds(version, files, releaseDate)
		const release = store.publishRelease({ version, notes: payload.notes, files })
		console.log(`[halcyon] published ${version} across ${feeds.join(", ")}`)
		send(response, 200, { release, feeds })
		return true
	}

	return handleFiles(request, response, path, UPDATE_PREFIX, UPDATE_DIR)
}

async function handleCosmetics(request, response, path) {
	const route = `${request.method} ${path}`

	if (route === `GET ${COSMETIC_PREFIX}`) {
		send(response, 200, { cosmetics: store.cosmetics(), types: COSMETIC_TYPES })
		return true
	}

	if (route === `GET ${COSMETIC_PREFIX}/types`) {
		send(response, 200, { types: COSMETIC_TYPES, slots: COSMETIC_SLOTS })
		return true
	}

	if (route === `PUT ${COSMETIC_PREFIX}`) {
		if (!requireAdmin(request, response)) {
			return true
		}

		const payload = await readJson(request)
		if (payload === null) {
			send(response, 400, { error: "the body is not valid json" })
			return true
		}

		const entries = Array.isArray(payload)
			? payload
			: Array.isArray(payload.cosmetics)
				? payload.cosmetics
				: [payload]
		const saved = []
		for (const entry of entries) {
			const record = store.upsertCosmetic(entry ?? {})
			if (record !== null) {
				saved.push(record)
			}
		}

		if (saved.length === 0) {
			send(response, 400, { error: "every cosmetic needs a short lowercase id" })
			return true
		}
		send(response, 200, { cosmetics: saved })
		return true
	}

	if (route === `GET ${COSMETIC_PREFIX}/worn`) {
		// players is the old cape only shape, worn is every slot.
		send(response, 200, { players: store.wornCapes(), worn: store.worn() })
		return true
	}

	/**
	 * Equipping happens three ways: the mod sends the client key, a signed in player picks a
	 * cosmetic in the launcher and the session speaks for them, or the launcher sends the very
	 * Minecraft token it plays with and Mojang says who that is. The last one is what makes the
	 * wardrobe work on a fresh install, where there is no website account yet.
	 */
	if (route === `POST ${COSMETIC_PREFIX}/equip`) {
		const payload = await readJson(request)
		if (payload === null) {
			send(response, 400, { error: "the body is not valid json" })
			return true
		}

		let name = validName(payload.name)
		let proven = false

		if (typeof payload.accessToken === "string" && payload.accessToken.trim() !== "") {
			const profile = await minecraftProfile(payload.accessToken)
			if (profile === null) {
				send(response, 401, {
					error: "Minecraft did not accept that session, sign in again in the launcher",
				})
				return true
			}
			name = validName(profile.name)
			proven = true
		}

		if (name === "") {
			send(response, 400, { error: "a player name is required" })
			return true
		}

		const user = currentUser(request)
		const owns =
			user !== null && String(user.minecraft ?? "").toLowerCase() === name.toLowerCase()
		if (!proven && !owns && !clientAllowed(request)) {
			send(response, 401, { error: "the client key is missing or wrong" })
			return true
		}

		const wanted =
			payload.id === null || payload.id === undefined || payload.id === ""
				? null
				: normaliseCosmeticId(payload.id)
		const slot = typeof payload.slot === "string" ? payload.slot : ""
		const profile = store.equip(name, wanted, slot)
		if (profile === null) {
			send(response, 409, { error: "that cosmetic was never given to this player" })
			return true
		}
		send(response, 200, profile)
		return true
	}

	if (route === `POST ${COSMETIC_PREFIX}/grant` || route === `POST ${COSMETIC_PREFIX}/revoke`) {
		if (!requireAdmin(request, response)) {
			return true
		}

		const payload = await readJson(request)
		if (payload === null) {
			send(response, 400, { error: "the body is not valid json" })
			return true
		}

		const name = validName(payload.name)
		if (name === "") {
			send(response, 400, { error: "a player name is required" })
			return true
		}

		const id = normaliseCosmeticId(payload.id)
		if (id === "" || store.cosmetic(id) === null) {
			send(response, 404, { error: "that cosmetic does not exist" })
			return true
		}

		const granting = path.endsWith("/grant")
		send(response, 200, granting ? store.grant(name, id) : store.revoke(name, id))
		return true
	}

	if (
		path.startsWith(`${COSMETIC_PLAYER_PREFIX}/`) &&
		(request.method === "GET" || request.method === "HEAD")
	) {
		let raw = ""
		try {
			raw = decodeURIComponent(path.slice(COSMETIC_PLAYER_PREFIX.length + 1))
		} catch {
			raw = ""
		}

		const name = validName(raw)
		if (name === "") {
			send(response, 400, { error: "a player name is required" })
			return true
		}

		// The wardrobe wants whole records, not only ids, and it wants the catalogue too so it can
		// show what there is left to earn.
		const profile = store.profile(name)
		const owned = (profile?.owned ?? []).map((id) => store.cosmetic(id)).filter(Boolean)
		send(response, 200, {
			...profile,
			cosmetics: owned,
			catalogue: store.cosmetics(),
			types: COSMETIC_TYPES,
		})
		return true
	}

	if (await handleFiles(request, response, path, COSMETIC_TEXTURE_PREFIX, COSMETIC_DIR)) {
		return true
	}

	if (request.method === "DELETE" && path.startsWith(`${COSMETIC_PREFIX}/`)) {
		if (!requireAdmin(request, response)) {
			return true
		}

		const id = normaliseCosmeticId(path.slice(COSMETIC_PREFIX.length + 1))
		if (id === "" || !store.removeCosmetic(id)) {
			send(response, 404, { error: "that cosmetic does not exist" })
			return true
		}
		send(response, 200, { removed: id })
		return true
	}

	return false
}

async function handle(request, response, path) {
	if (request.method === "OPTIONS") {
		send(response, 204)
		return
	}

	const route = `${request.method} ${path}`

	if (route === "GET /v1/health") {
		send(response, 200, {
			status: "ok",
			uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
			online: store.onlinePlayers().length,
		})
		return
	}

	if (route === "GET /v1/stats") {
		send(response, 200, statistics())
		return
	}

	if (route === "GET /v1/roster") {
		const players = store.onlinePlayers()
		send(response, 200, {
			players: players.map((player) => player.name),
			count: players.length,
			updatedAt: new Date().toISOString(),
		})
		return
	}

	if (route === "GET /v1/players") {
		send(response, 200, { players: store.onlinePlayers() })
		return
	}

	if (route === "POST /v1/heartbeat") {
		if (!clientAllowed(request)) {
			send(response, 401, { error: "the client key is missing or wrong" })
			return
		}

		const payload = await readJson(request)
		if (payload === null) {
			send(response, 400, { error: "the body is not valid json" })
			return
		}

		const name = typeof payload.name === "string" ? payload.name : ""
		if (name.trim() === "" || name.length > 32) {
			send(response, 400, { error: "a player name is required" })
			return
		}

		const player = store.heartbeat(name, {
			client: typeof payload.client === "string" ? payload.client : undefined,
			version: typeof payload.version === "string" ? payload.version : undefined,
		})
		send(response, 200, { player, online: store.onlinePlayers().length })
		return
	}

	if (route === "GET /v1/branding") {
		send(response, 200, store.branding())
		return
	}

	if (route === "PUT /v1/branding") {
		if (!requireAdmin(request, response)) {
			return
		}

		const payload = await readJson(request)
		if (payload === null) {
			send(response, 400, { error: "the body is not valid json" })
			return
		}
		send(response, 200, store.updateBranding(payload))
		return
	}

	if (route === "GET /v1/announcements") {
		send(response, 200, { announcements: store.announcements() })
		return
	}

	if (route === "PUT /v1/announcements") {
		if (!requireAdmin(request, response)) {
			return
		}

		const payload = await readJson(request)
		if (payload === null) {
			send(response, 400, { error: "the body is not valid json" })
			return
		}

		const entries = Array.isArray(payload) ? payload : payload.announcements
		if (!Array.isArray(entries)) {
			send(response, 400, { error: "an array of announcements is required" })
			return
		}
		send(response, 200, { announcements: store.updateAnnouncements(entries) })
		return
	}

	if (await handleAuth(request, response, path)) {
		return
	}

	if (await handleAccount(request, response, path)) {
		return
	}

	if (await handleAdmin(request, response, path)) {
		return
	}

	if (path === UPDATE_PREFIX || path.startsWith(`${UPDATE_PREFIX}/`)) {
		if (await handleUpdates(request, response, path)) {
			return
		}
	}

	if (await handleCosmetics(request, response, path)) {
		return
	}

	// Anything that is not an api call is a page request.
	if (!path.startsWith("/v1/") && (await serveSite(request, response, path, PUBLIC_DIR))) {
		return
	}

	send(response, 404, { error: "unknown endpoint" })
}

const server = createServer((request, response) => {
	const address = request.socket.remoteAddress ?? "unknown"
	const path = pathOf(request)
	const reading = request.method === "GET" || request.method === "HEAD"

	// Downloading an installer or a cape is a handful of large requests from one machine, and a
	// single page view is a dozen small ones, so neither counts against the api budget.
	const exempt =
		reading &&
		(path.startsWith(`${UPDATE_PREFIX}/`) ||
			path.startsWith(`${COSMETIC_TEXTURE_PREFIX}/`) ||
			!path.startsWith("/v1/"))

	if (!exempt && rateLimited(address)) {
		send(response, 429, { error: "too many requests" })
		return
	}

	if (
		request.method === "POST" &&
		path.startsWith(`${AUTH_PREFIX}/`) &&
		counted(authHits, address, AUTH_LIMIT_MAX)
	) {
		send(response, 429, { error: "too many attempts, wait a minute" })
		return
	}

	handle(request, response, path).catch((error) => {
		console.error("[halcyon]", request.method, path, error.message)
		if (!response.headersSent) {
			send(response, 500, { error: "the request could not be handled" })
		}
	})
})

setInterval(() => {
	const removed = store.prune(RETENTION_MS)
	if (removed > 0) {
		console.log(`[halcyon] pruned ${removed} stale players`)
	}
	accounts.pruneSessions()
	hits.clear()
	authHits.clear()
}, RATE_LIMIT_WINDOW_MS).unref()

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		console.log("[halcyon] shutting down")
		store.persist()
		accounts.persist()
		server.close(() => process.exit(0))
	})
}

for (const directory of [UPDATE_DIR, COSMETIC_DIR]) {
	await mkdir(directory, { recursive: true }).catch((error) => {
		console.warn(`[halcyon] ${directory} could not be created: ${error.message}`)
	})
}

server.listen(PORT, HOST, () => {
	console.log(`[halcyon] backend listening on ${HOST} port ${PORT}`)
	console.log(`[halcyon] state file ${DATA_FILE}`)
	console.log(`[halcyon] accounts file ${ACCOUNT_FILE}`)
	console.log(`[halcyon] update folder ${UPDATE_DIR}`)
	console.log(`[halcyon] cosmetic folder ${COSMETIC_DIR}`)
	console.log(`[halcyon] website folder ${PUBLIC_DIR}`)
	if (ADMIN_TOKEN === "") {
		console.warn(
			"[halcyon] no admin token is set, branding, cosmetics and uploads are disabled",
		)
	}
	if (accounts.count() === 0) {
		console.log("[halcyon] no accounts yet, the first one registered becomes the admin")
	}
})
