#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/

const rawVersion = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? ""
const match = SEMVER.exec(rawVersion.trim())

if (match === null) {
	console.error(
		`Expected a semantic version such as v1.4.2, received "${rawVersion}".\n` +
			"Usage: node scripts/inject-version.mjs v1.4.2",
	)
	process.exit(1)
}

const version = `${match[1]}.${match[2]}.${match[3]}${match[4] === undefined ? "" : `-${match[4]}`}`
const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url))
const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"))
const previous = packageJson.version

packageJson.version = version
await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, "\t")}\n`, "utf8")

console.log(`Version ${previous} -> ${version}`)
console.log(`Build number: ${process.env.GITHUB_RUN_NUMBER ?? "local"}`)
console.log(`Commit: ${(process.env.GITHUB_SHA ?? "development").slice(0, 7)}`)
