import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { extname, join, normalize, resolve, sep } from "node:path"
import { pipeline } from "node:stream/promises"

const TYPES = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".txt": "text/plain; charset=utf-8",
	".woff2": "font/woff2",
}

/**
 * Turns a request path into a file below the site root, or null when it escapes the root. Every
 * path is resolved and checked rather than merely sanitised, so no amount of dots or encoding can
 * reach outside the folder.
 */
function candidate(root, path) {
	let clean = path
	try {
		clean = decodeURIComponent(path)
	} catch {
		return null
	}
	if (clean.includes("\0")) {
		return null
	}

	while (clean.endsWith("/") && clean.length > 1) {
		clean = clean.slice(0, -1)
	}
	if (clean === "/" || clean === "") {
		clean = "/index"
	}

	const target = resolve(join(root, normalize(clean)))
	if (target !== root && !target.startsWith(root + sep)) {
		return null
	}
	return target
}

/** Pretty urls: /terms serves terms.html, and a folder serves its index.html. */
async function fileFor(root, path) {
	const base = candidate(root, path)
	if (base === null) {
		return null
	}

	const attempts =
		extname(base) === "" ? [`${base}.html`, join(base, "index.html")] : [base]
	for (const attempt of attempts) {
		try {
			const info = await stat(attempt)
			if (info.isFile()) {
				return { file: attempt, bytes: info.size }
			}
		} catch {
			continue
		}
	}
	return null
}

async function deliver(request, response, found, status) {
	const extension = extname(found.file).toLowerCase()
	const head = {
		"content-type": TYPES[extension] ?? "application/octet-stream",
		"content-length": found.bytes,
		// Pages must never be cached or a signed in visitor sees a stale shell; assets may be.
		"cache-control": extension === ".html" ? "no-store" : "public, max-age=3600",
		"x-content-type-options": "nosniff",
		"referrer-policy": "same-origin",
	}

	response.writeHead(status, head)
	if (request.method === "HEAD") {
		response.end()
		return
	}
	await pipeline(createReadStream(found.file), response)
}

/**
 * Serves the website. Returns false when the request is not a page request at all, so the caller
 * can fall through to its json 404.
 */
export async function serveSite(request, response, path, root) {
	if (request.method !== "GET" && request.method !== "HEAD") {
		return false
	}

	const found = await fileFor(root, path)
	if (found !== null) {
		await deliver(request, response, found, 200)
		return true
	}

	const missing = await fileFor(root, "/404")
	if (missing === null) {
		return false
	}
	await deliver(request, response, missing, 404)
	return true
}
