import { createServer } from "node:http"
import { resolve } from "node:path"

import { Store } from "./store.mjs"

const PORT = Number.parseInt(process.env.PORT ?? "8787", 10)
const HOST = process.env.HOST ?? "127.0.0.1"
const DATA_FILE = resolve(process.env.DATA_FILE ?? "./data/state.json")
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? ""
const CLIENT_KEY = process.env.CLIENT_KEY ?? ""
const PRESENCE_TTL_MS = Number.parseInt(process.env.PRESENCE_TTL_SECONDS ?? "300", 10) * 1000
const RETENTION_MS = Number.parseInt(process.env.RETENTION_DAYS ?? "7", 10) * 24 * 60 * 60 * 1000

const MAX_BODY_BYTES = 16 * 1024
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const RATE_LIMIT_MAX = 120

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
		"access-control-allow-methods": "GET, POST, PUT, OPTIONS",
		"cache-control": "no-store"
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
			online: store.onlinePlayers().length
		})
		return
	}

	if (route === "GET /v1/roster") {
		const players = store.onlinePlayers()
		send(response, 200, {
			players: players.map((player) => player.name),
			count: players.length,
			updatedAt: new Date().toISOString()
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

		const raw = await readBody(request)
		let payload = null
		try {
			payload = JSON.parse(raw === "" ? "{}" : raw)
		} catch {
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
			version: typeof payload.version === "string" ? payload.version : undefined
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

		const raw = await readBody(request)
		try {
			send(response, 200, store.updateBranding(JSON.parse(raw)))
		} catch {
			send(response, 400, { error: "the body is not valid json" })
		}
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

		const raw = await readBody(request)
		try {
			const parsed = JSON.parse(raw)
			const entries = Array.isArray(parsed) ? parsed : parsed.announcements
			if (!Array.isArray(entries)) {
				send(response, 400, { error: "an array of announcements is required" })
				return
			}
			send(response, 200, { announcements: store.updateAnnouncements(entries) })
		} catch {
			send(response, 400, { error: "the body is not valid json" })
		}
		return
	}

	send(response, 404, { error: "unknown endpoint" })
}

const server = createServer((request, response) => {
	const address = request.socket.remoteAddress ?? "unknown"
	if (rateLimited(address)) {
		send(response, 429, { error: "too many requests" })
		return
	}

	const path = pathOf(request)

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

server.listen(PORT, HOST, () => {
	console.log(`[halcyon] backend listening on ${HOST} port ${PORT}`)
	console.log(`[halcyon] state file ${DATA_FILE}`)
	if (ADMIN_TOKEN === "") {
		console.warn("[halcyon] no admin token is set, the branding endpoints are disabled")
	}
})
