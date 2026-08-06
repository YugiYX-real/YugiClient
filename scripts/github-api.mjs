// Minimal GitHub REST helper for continuous integration.
//
// The gh command line tool ships with GitHub hosted runners but not with self
// hosted machines, so every automation step goes through this script instead.
// Node is always installed by the workflow, which makes this the one dependency
// that is guaranteed to exist on any runner.
//
// Usage:
//   node scripts/github-api.mjs release-reserve v1.2.3 "Halcyon 1.2.3" NOTES.md
//   node scripts/github-api.mjs release-publish v1.2.3 "Halcyon 1.2.3" NOTES.md
//   node scripts/github-api.mjs issue-create "Title" body.md

import { readFileSync } from "node:fs"
import process from "node:process"

const API_ROOT = "https://api.github.com"

const authToken = () => {
	const value = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
	if (!value) {
		throw new Error("Set GITHUB_TOKEN so this script can reach the GitHub API.")
	}
	return value
}

const repositoryPath = () => {
	const slug = process.env.GITHUB_REPOSITORY
	if (!slug) {
		throw new Error("GITHUB_REPOSITORY is not set, so the repository is unknown.")
	}
	return "/repos/" + slug
}

const request = async (method, path, body) => {
	const response = await fetch(API_ROOT + path, {
		method,
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: "Bearer " + authToken(),
			"Content-Type": "application/json",
			"User-Agent": "halcyon-ci",
			"X-GitHub-Api-Version": "2022-11-28",
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	})

	const raw = await response.text()
	let parsed = {}
	if (raw.length > 0) {
		try {
			parsed = JSON.parse(raw)
		} catch {
			parsed = { message: raw.slice(0, 400) }
		}
	}

	return { status: response.status, body: parsed }
}

const requireOk = (result, description) => {
	if (result.status >= 400) {
		const message = typeof result.body.message === "string" ? result.body.message : "unknown error"
		throw new Error(description + " failed with " + String(result.status) + ": " + message)
	}
	return result.body
}

const findRelease = async (tag) => {
	const result = await request("GET", repositoryPath() + "/releases/tags/" + encodeURIComponent(tag))
	if (result.status === 404) {
		return null
	}
	return requireOk(result, "Looking up release " + tag)
}

const readNotes = (notesFile) => {
	if (!notesFile) {
		throw new Error("A notes file is required.")
	}
	return readFileSync(notesFile, "utf8")
}

const downloadSection = (assets) => {
	const names = assets
		.map((asset) => String(asset.name))
		.filter((name) => !name.endsWith(".blockmap") && !name.startsWith("latest"))
		.sort()

	if (names.length === 0) {
		return ""
	}

	const lines = ["", "### Downloads", ""]
	for (const name of names) {
		lines.push("- `" + name + "`")
	}
	lines.push("")
	lines.push("Every artifact is verified with sha512 by the in-app updater.")
	return lines.join("\n")
}

const releaseReserve = async (tag, title, notesFile) => {
	if (!tag || !title) {
		throw new Error("Usage: release-reserve <tag> <title> <notesFile>")
	}

	const notes = readNotes(notesFile)
	const existing = await findRelease(tag)

	if (existing) {
		requireOk(
			await request("PATCH", repositoryPath() + "/releases/" + String(existing.id), {
				name: title,
				body: notes,
			}),
			"Updating release " + tag,
		)
		console.log("Reusing the existing release " + tag + ".")
		return
	}

	requireOk(
		await request("POST", repositoryPath() + "/releases", {
			tag_name: tag,
			name: title,
			body: notes,
			draft: true,
		}),
		"Creating release " + tag,
	)
	console.log("Created the draft release " + tag + ".")
}

const releasePublish = async (tag, title, notesFile) => {
	if (!tag || !title) {
		throw new Error("Usage: release-publish <tag> <title> <notesFile>")
	}

	const release = await findRelease(tag)
	if (!release) {
		throw new Error("Release " + tag + " does not exist, so there is nothing to publish.")
	}

	const assets = Array.isArray(release.assets) ? release.assets : []
	if (assets.length === 0) {
		throw new Error(
			"No assets were uploaded for " + tag + ", so it stays a draft rather than shipping empty.",
		)
	}

	const notes = readNotes(notesFile).trimEnd() + "\n" + downloadSection(assets) + "\n"

	requireOk(
		await request("PATCH", repositoryPath() + "/releases/" + String(release.id), {
			name: title,
			body: notes,
			draft: false,
			make_latest: "true",
		}),
		"Publishing release " + tag,
	)

	console.log("Published " + tag + " with " + String(assets.length) + " assets:")
	for (const asset of assets) {
		console.log("  " + String(asset.name))
	}
}

const issueCreate = async (title, bodyFile) => {
	if (!title || !bodyFile) {
		throw new Error("Usage: issue-create <title> <bodyFile>")
	}

	const created = requireOk(
		await request("POST", repositoryPath() + "/issues", {
			title,
			body: readFileSync(bodyFile, "utf8"),
		}),
		"Creating issue",
	)

	console.log("Opened issue #" + String(created.number) + ".")
}

const handlers = {
	"release-reserve": releaseReserve,
	"release-publish": releasePublish,
	"issue-create": issueCreate,
}

const main = async () => {
	const [command, ...args] = process.argv.slice(2)
	const handler = command ? handlers[command] : undefined

	if (!handler) {
		const known = Object.keys(handlers).join(", ")
		throw new Error("Unknown command " + String(command) + ". Known commands: " + known + ".")
	}

	await handler(...args)
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error))
	process.exit(1)
})
