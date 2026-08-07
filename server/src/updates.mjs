import { createReadStream } from "node:fs"
import { createHash } from "node:crypto"
import { mkdir, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"

/**
 * Publishing a version.
 *
 * The launcher polls a small yaml feed and compares the version in it with its own. Everything
 * here exists to write that feed correctly: the installers are uploaded first, one PUT each, and
 * publishing is what makes them the version every launcher will offer.
 */

const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const BASE64_SHA512 = /^[A-Za-z0-9+/]{86}==$/

/** Strips a leading v and rejects anything that is not a plain version number. */
export function normaliseVersion(value) {
	const text = String(value ?? "")
		.trim()
		.replace(/^v/i, "")
	return VERSION.test(text) ? text : ""
}

/**
 * Which feed an installer belongs in.
 *
 * The launcher asks for one of these three names depending on the machine it runs on, so a
 * Windows installer must never end up in the feed a Linux machine reads.
 */
export function feedFor(name) {
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
 * The checksum the updater checks the download against.
 *
 * This is done here rather than in the browser on purpose: the panel is served over plain http,
 * where browsers refuse to expose their hashing api at all, and streaming the file past a hash on
 * the machine that already stores it costs a second even for a large installer.
 */
export async function hashFile(file) {
	const hash = createHash("sha512")
	for await (const chunk of createReadStream(file)) {
		hash.update(chunk)
	}
	return hash.digest("base64")
}

/**
 * Collects the uploaded installers named in a publish request.
 *
 * Returns either an error to send back or the finished file list. Sizes always come from disk
 * rather than from the request, so a wrong number in the body cannot produce a feed that sends
 * every launcher into a failed download.
 */
export async function collectFiles(directory, wanted) {
	const files = []

	for (const entry of wanted) {
		const name = typeof entry === "string" ? entry.trim() : String(entry?.name ?? "").trim()
		if (!SAFE_FILE_NAME.test(name)) {
			return { error: `${name === "" ? "that file" : name} is not a usable file name` }
		}

		const target = join(directory, name)
		let info = null
		try {
			info = await stat(target)
		} catch {
			return { error: `${name} has not been uploaded yet` }
		}
		if (!info.isFile()) {
			return { error: `${name} is not a file` }
		}

		const given = String(entry?.sha512 ?? "").trim()
		files.push({
			name,
			sha512: BASE64_SHA512.test(given) ? given : await hashFile(target),
			size: info.size,
		})
	}

	if (files.length === 0) {
		return { error: "at least one installer is required" }
	}
	return { files }
}

/** Writes one feed per platform and returns the names written. */
export async function writeFeeds(directory, version, files, releaseDate) {
	const grouped = new Map()
	for (const file of files) {
		const feed = feedFor(file.name)
		grouped.set(feed, [...(grouped.get(feed) ?? []), file])
	}

	await mkdir(directory, { recursive: true })
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

		await writeFile(join(directory, feed), `${lines.join("\n")}\n`, "utf8")
		written.push(feed)
	}

	return written
}
