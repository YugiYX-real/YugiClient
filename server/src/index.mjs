import { createServer } from "node:http"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises"
import { dirname, extname, join, resolve } from "node:path"
import { pipeline } from "node:stream/promises"

import { Store, normaliseCosmeticId } from "./store.mjs"

const PORT = Number.parseInt(process.env.PORT ?? "8787", 10)
const HOST = process.env.HOST ?? "127.0.0.1"
const DATA_FILE = resolve(process.env.DATA_FILE ?? "./data/state.json")

// Installers and cosmetic textures live beside the state file unless told otherwise, so the
// folders are always ones the service account already owns.
const UPDATE_DIR = resolve(process.env.UPDATE_DIR ?? join(dirname(DATA_FILE), "updates"))
const COSMETIC_DIR = resolve(process.env.COSMETIC_DIR ?? join(dirname(DATA_FILE), "cosmetics"))
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? ""
const CLIENT_KEY = process.env.CLIENT_KEY ?? ""
const PRESENCE_TTL_MS = Number.parseInt(process.env.PRESENCE_TTL_SECONDS ?? "300", 10) * 1000
const RETENTION_MS = Number.parseInt(process.env.RETENTION_DAYS ?? "7", 10) * 24 * 60 * 60 * 1000

const MAX_BODY_BYTES = 16 * 1024
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const RATE_LIMIT_MAX = 120

const UPDATE_PREFIX = "/v1/updates"
const COSMETIC_PREFIX = "/v1/cosmetics"
const COSMETIC_TEXTURE_PREFIX = `${COSMETIC_PREFIX}/textures`
const COSMETIC_PLAYER_PREFIX = `${COSMETIC_PREFIX}/player`
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const PLAYER_NAME = /^[A-Za-z0-9_]{1,32}$/
const CONTENT_TYPES = {
	".yml": "text/yaml; charset=utf-8",
	".yaml": "text/yaml; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".zip": "application/zip",
	".gz": "application/gzip",
}

const store = new Store(DATA_FILE, PRESENCE_TTL_MS)
const startedAt = Date.now()
const hits = new Map()

/** The path without the query string. Parsed by hand so no base address is needed. */
function pathOf(request) {
	const target = request.url ?? "/"
	const mark = target.indexOf("?")
	return mark === -1 ? target : target.slice(0, mark)
}

function rateLimited(address) {
	const now = Date.now()
	const entry = hits.get(address)

	if (entry === undefined || now - entry.since > RATE_LIMIT_WINDOW_MS) {
		hits.set(address, { since: now, count: 1 })
		return false
	}

	entry.count += 1
	return entry.count > RATE_LIMIT_MAX
}

function send(response, status, payload) {
	const body = payload === undefined ? "" : JSON.stringify(payload)
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(body),
		"access-control-allow-origin": "*",
		"access-control-allow-headers": "content-type, authorization, x-halcyon-key",
		"access-control-allow-methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
		"cache-control": "no-store",
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

function clientAllowed(request) {
	if (CLIENT_KEY === "") {
		return true
	}
	return request.headers["x-halcyon-key"] === CLIENT_KEY
}

function adminAllowed(request) {
	if (ADMIN_TOKEN === "") {
		return false
	}
	return request.headers.authorization === `Bearer ${ADMIN_TOKEN}`
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
	if (!adminAllowed(request)) {
		send(response, 401, { error: "an admin token is required" })
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
	if (!adminAllowed(request)) {
		send(response, 401, { error: "an admin token is required" })
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

async function handleCosmetics(request, response, path) {
	const route = `${request.method} ${path}`

	if (route === `GET ${COSMETIC_PREFIX}`) {
		send(response, 200, { cosmetics: store.cosmetics() })
		return true
	}

	if (route === `PUT ${COSMETIC_PREFIX}`) {
		if (!adminAllowed(request)) {
			send(response, 401, { error: "an admin token is required" })
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
		send(response, 200, { players: store.wornCapes() })
		return true
	}

	if (route === `POST ${COSMETIC_PREFIX}/equip`) {
		if (!clientAllowed(request)) {
			send(response, 401, { error: "the client key is missing or wrong" })
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

		const wanted =
			payload.id === null || payload.id === undefined || payload.id === ""
				? null
				: normaliseCosmeticId(payload.id)
		const profile = store.equip(name, wanted)
		if (profile === null) {
			send(response, 409, { error: "that cosmetic was never given to this player" })
			return true
		}
		send(response, 200, profile)
		return true
	}

	if (route === `POST ${COSMETIC_PREFIX}/grant` || route === `POST ${COSMETIC_PREFIX}/revoke`) {
		if (!adminAllowed(request)) {
			send(response, 401, { error: "an admin token is required" })
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
		send(response, 200, store.profile(name))
		return true
	}

	if (await handleFiles(request, response, path, COSMETIC_TEXTURE_PREFIX, COSMETIC_DIR)) {
		return true
	}

	if (request.method === "DELETE" && path.startsWith(`${COSMETIC_PREFIX}/`)) {
		if (!adminAllowed(request)) {
			send(response, 401, { error: "an admin token is required" })
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
		if (!adminAllowed(request)) {
			send(response, 401, { error: "an admin token is required" })
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
		if (!adminAllowed(request)) {
			send(response, 401, { error: "an admin token is required" })
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

	if (path === UPDATE_PREFIX && (request.method === "GET" || request.method === "HEAD")) {
		send(response, 200, {
			feed: `${UPDATE_PREFIX}/latest.yml`,
			files: await listFiles(UPDATE_DIR),
		})
		return
	}

	if (await handleFiles(request, response, path, UPDATE_PREFIX, UPDATE_DIR)) {
		return
	}

	if (await handleCosmetics(request, response, path)) {
		return
	}

	send(response, 404, { error: "unknown endpoint" })
}

const server = createServer((request, response) => {
	const address = request.socket.remoteAddress ?? "unknown"
	const path = pathOf(request)

	// Downloading an installer or a cape is a handful of large requests from one machine, so the
	// counter that protects the small json endpoints does not apply.
	const downloading =
		(request.method === "GET" || request.method === "HEAD") &&
		(path.startsWith(`${UPDATE_PREFIX}/`) || path.startsWith(`${COSMETIC_TEXTURE_PREFIX}/`))

	if (!downloading && rateLimited(address)) {
		send(response, 429, { error: "too many requests" })
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
	hits.clear()
}, RATE_LIMIT_WINDOW_MS).unref()

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		console.log("[halcyon] shutting down")
		store.persist()
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
	console.log(`[halcyon] update folder ${UPDATE_DIR}`)
	console.log(`[halcyon] cosmetic folder ${COSMETIC_DIR}`)
	if (ADMIN_TOKEN === "") {
		console.warn(
			"[halcyon] no admin token is set, branding, cosmetics and uploads are disabled",
		)
	}
})
