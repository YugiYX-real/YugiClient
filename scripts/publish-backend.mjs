#!/usr/bin/env node
/**
 * Uploads locally built installers to the Halcyon backend, which serves them as
 * the launcher's update feed. Nothing touches GitHub, so no release, no public
 * repository and no Actions minutes are involved.
 *
 *   npm run build
 *   npx electron-builder --win --publish never
 *   node scripts/publish-backend.mjs
 *
 * The server address and admin token come from the environment and are never
 * written anywhere: HALCYON_BACKEND_URL and HALCYON_ADMIN_TOKEN. Both can also
 * be passed as --url and --token.
 */
import { readFile, readdir, stat } from "node:fs/promises"
import { join, resolve } from "node:path"

const UPLOAD_PATTERNS = [
	/\.exe$/i,
	/\.msi$/i,
	/\.appimage$/i,
	/\.dmg$/i,
	/\.zip$/i,
	/\.tar\.gz$/i,
	/\.blockmap$/i,
	/^latest.*\.yml$/i,
]

function parseArguments(argv) {
	let directory = "dist"
	let url = process.env.HALCYON_BACKEND_URL ?? ""
	let token = process.env.HALCYON_ADMIN_TOKEN ?? ""

	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index]
		if (argument === "--dir") {
			index += 1
			directory = argv[index] ?? directory
		} else if (argument === "--url") {
			index += 1
			url = argv[index] ?? url
		} else if (argument === "--token") {
			index += 1
			token = argv[index] ?? token
		}
	}

	return { directory, url: url.replace(/\/+$/, ""), token }
}

async function collectFiles(directory) {
	let entries = []
	try {
		entries = await readdir(directory)
	} catch {
		throw new Error("No build output was found at " + directory)
	}

	const files = []
	for (const entry of entries) {
		if (!UPLOAD_PATTERNS.some((pattern) => pattern.test(entry))) {
			continue
		}
		const full = join(directory, entry)
		const info = await stat(full)
		if (info.isFile()) {
			files.push({ path: full, name: entry, size: info.size })
		}
	}

	// The version file is uploaded last so the launcher never sees a new version
	// number before the installer it points at has finished uploading.
	return files.sort((left, right) => {
		const leftFeed = /\.yml$/i.test(left.name) ? 1 : 0
		const rightFeed = /\.yml$/i.test(right.name) ? 1 : 0
		return leftFeed - rightFeed || left.name.localeCompare(right.name)
	})
}

async function upload(base, token, file) {
	const target = base + "/v1/updates/" + encodeURIComponent(file.name)
	const body = await readFile(file.path)

	const response = await fetch(target, {
		method: "PUT",
		headers: {
			Authorization: "Bearer " + token,
			"Content-Type": "application/octet-stream",
			"Content-Length": String(file.size),
		},
		body,
	})

	if (!response.ok) {
		const detail = (await response.text()).slice(0, 300)
		throw new Error("Uploading " + file.name + " failed with " + response.status + ": " + detail)
	}

	const megabytes = (file.size / (1024 * 1024)).toFixed(1)
	console.log("Uploaded " + file.name + " (" + megabytes + " MB)")
}

async function main() {
	const { directory, url, token } = parseArguments(process.argv.slice(2))
	if (url === "") {
		throw new Error("Set HALCYON_BACKEND_URL to the address of your Halcyon backend")
	}
	if (token === "") {
		throw new Error("Set HALCYON_ADMIN_TOKEN to the admin token from /etc/halcyon-backend.env")
	}

	const outputDirectory = resolve(process.cwd(), directory)
	const files = await collectFiles(outputDirectory)
	if (files.length === 0) {
		throw new Error(
			"Nothing to upload from " +
				outputDirectory +
				". Run npm run build and electron-builder first.",
		)
	}

	console.log("Uploading " + files.length + " file(s) from " + outputDirectory + " to " + url)
	for (const file of files) {
		await upload(url, token, file)
	}

	console.log("Done. Launchers pointed at " + url + "/v1/updates will pick this up.")
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error))
	process.exitCode = 1
})
