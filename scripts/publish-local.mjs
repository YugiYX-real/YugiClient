#!/usr/bin/env node
/**
 * Publishes installers that were built on this machine to a GitHub Release.
 *
 * GitHub Actions minutes are only spent by workflow runs. Creating a release
 * and uploading assets through the REST API costs nothing, so a machine that
 * can run `npm run build` can produce and ship a release on its own.
 *
 *   npm run build
 *   npx electron-builder --win --publish never
 *   node scripts/publish-local.mjs v1.2.1
 *
 * The token is read from the environment and is never written anywhere:
 * HALCYON_GITHUB_TOKEN, GITHUB_TOKEN or GH_TOKEN, in that order. It needs
 * write access to the repository contents.
 */
import { readFile, readdir, stat } from "node:fs/promises"
import { basename, join, resolve } from "node:path"

const API_ROOT = "https://api.github.com"
const UPLOAD_ROOT = "https://uploads.github.com"
const DEFAULT_SLUG = "YugiYX-real/YugiClient"
const PAGE_SIZE = 100
const MAX_PAGES = 10

const ASSET_PATTERNS = [
	/\.exe$/i,
	/\.msi$/i,
	/\.appimage$/i,
	/\.dmg$/i,
	/\.zip$/i,
	/\.tar\.gz$/i,
	/\.blockmap$/i,
	/^latest.*\.yml$/i,
]

function authToken() {
	const token =
		process.env.HALCYON_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
	if (token === undefined || token.length === 0) {
		throw new Error(
			"Set HALCYON_GITHUB_TOKEN to a token with write access before publishing a release",
		)
	}
	return token
}

function repositoryPath() {
	const slug = process.env.GITHUB_REPOSITORY ?? DEFAULT_SLUG
	return "/repos/" + slug
}

function headers(extra = {}) {
	return {
		Accept: "application/vnd.github+json",
		Authorization: "Bearer " + authToken(),
		"User-Agent": "halcyon-local-publish",
		"X-GitHub-Api-Version": "2022-11-28",
		...extra,
	}
}

async function request(method, path, body) {
	const response = await fetch(API_ROOT + path, {
		method,
		headers: headers(body === undefined ? {} : { "Content-Type": "application/json" }),
		body: body === undefined ? undefined : JSON.stringify(body),
	})
	const text = await response.text()
	const payload = text.length === 0 ? {} : JSON.parse(text)
	return { ok: response.ok, status: response.status, payload }
}

function requireOk(result, action) {
	if (!result.ok) {
		const detail = JSON.stringify(result.payload).slice(0, 400)
		throw new Error(action + " failed with " + result.status + ": " + detail)
	}
	return result.payload
}

/** Lists releases including drafts, which the tag lookup endpoint hides. */
async function findRelease(tag) {
	for (let page = 1; page <= MAX_PAGES; page += 1) {
		const query = "/releases?per_page=" + PAGE_SIZE + "&page=" + page
		const result = await request("GET", repositoryPath() + query)
		const releases = requireOk(result, "Listing releases")
		if (!Array.isArray(releases) || releases.length === 0) {
			return null
		}
		const match = releases.find((release) => release.tag_name === tag)
		if (match !== undefined) {
			return match
		}
		if (releases.length < PAGE_SIZE) {
			return null
		}
	}
	return null
}

async function ensureRelease(tag, name, notes) {
	const existing = await findRelease(tag)
	if (existing !== null) {
		console.log("Reusing the existing release for " + tag)
		return existing
	}
	const created = requireOk(
		await request("POST", repositoryPath() + "/releases", {
			tag_name: tag,
			name,
			body: notes,
			draft: true,
			prerelease: false,
		}),
		"Creating the release",
	)
	console.log("Created a draft release for " + tag)
	return created
}

async function collectAssets(directory) {
	let entries = []
	try {
		entries = await readdir(directory)
	} catch {
		throw new Error("No build output was found at " + directory)
	}

	const files = []
	for (const entry of entries) {
		if (!ASSET_PATTERNS.some((pattern) => pattern.test(entry))) {
			continue
		}
		const full = join(directory, entry)
		const info = await stat(full)
		if (info.isFile()) {
			files.push({ path: full, name: entry, size: info.size })
		}
	}
	return files.sort((left, right) => left.name.localeCompare(right.name))
}

async function replaceAsset(release, asset) {
	const clash = (release.assets ?? []).find((candidate) => candidate.name === asset.name)
	if (clash !== undefined) {
		requireOk(
			await request("DELETE", repositoryPath() + "/releases/assets/" + clash.id),
			"Removing the previous " + asset.name,
		)
	}

	const body = await readFile(asset.path)
	const target =
		UPLOAD_ROOT +
		repositoryPath() +
		"/releases/" +
		release.id +
		"/assets?name=" +
		encodeURIComponent(asset.name)

	const response = await fetch(target, {
		method: "POST",
		headers: headers({
			"Content-Type": "application/octet-stream",
			"Content-Length": String(asset.size),
		}),
		body,
	})
	if (!response.ok) {
		const detail = (await response.text()).slice(0, 400)
		throw new Error("Uploading " + asset.name + " failed with " + response.status + ": " + detail)
	}

	const megabytes = (asset.size / (1024 * 1024)).toFixed(1)
	console.log("Uploaded " + asset.name + " (" + megabytes + " MB)")
}

async function readNotes(notesPath, tag) {
	if (notesPath === null) {
		return "Halcyon " + tag.replace(/^v/, "") + ", built locally."
	}
	try {
		return await readFile(notesPath, "utf8")
	} catch {
		console.warn("The notes file " + notesPath + " could not be read, using a short summary.")
		return "Halcyon " + tag.replace(/^v/, "") + ", built locally."
	}
}

function parseArguments(argv) {
	const positional = []
	let directory = "dist"
	let notes = null

	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index]
		if (argument === "--dir") {
			index += 1
			directory = argv[index] ?? directory
		} else if (argument === "--notes") {
			index += 1
			notes = argv[index] ?? null
		} else {
			positional.push(argument)
		}
	}

	return { tag: positional[0] ?? null, directory, notes }
}

async function main() {
	const { tag, directory, notes } = parseArguments(process.argv.slice(2))
	if (tag === null || !/^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/.test(tag)) {
		throw new Error("Pass the tag to publish, for example: node " + basename(process.argv[1]) + " v1.2.1")
	}

	const outputDirectory = resolve(process.cwd(), directory)
	const assets = await collectAssets(outputDirectory)
	if (assets.length === 0) {
		throw new Error(
			"Nothing to upload from " +
				outputDirectory +
				". Run npm run build and electron-builder first.",
		)
	}

	console.log("Publishing " + assets.length + " file(s) from " + outputDirectory + " to " + tag)
	const version = tag.replace(/^v/, "")
	const release = await ensureRelease(tag, "Halcyon " + version, await readNotes(notes, tag))

	for (const asset of assets) {
		await replaceAsset(release, asset)
	}

	requireOk(
		await request("PATCH", repositoryPath() + "/releases/" + release.id, {
			draft: false,
			make_latest: "true",
		}),
		"Publishing the release",
	)

	console.log("Halcyon " + version + " is published and the update feed will pick it up.")
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error))
	process.exitCode = 1
})
