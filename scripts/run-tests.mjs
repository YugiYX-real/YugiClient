#!/usr/bin/env node
import { spawn } from "node:child_process"
import { readdir } from "node:fs/promises"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const searchRoots = ["packages", "examples"]
const ignored = new Set(["node_modules", "dist", "out", "release", ".git", "coverage"])

async function collect(directory) {
	const files = []
	let entries
	try {
		entries = await readdir(directory, { withFileTypes: true })
	} catch {
		return files
	}
	for (const entry of entries) {
		const path = join(directory, entry.name)
		if (entry.isDirectory()) {
			if (!ignored.has(entry.name)) {
				files.push(...(await collect(path)))
			}
			continue
		}
		if (entry.name.endsWith(".test.ts")) {
			files.push(path)
		}
	}
	return files
}

const testFiles = (await Promise.all(searchRoots.map((directory) => collect(join(root, directory)))))
	.flat()
	.sort()

if (testFiles.length === 0) {
	console.error("No test files found.")
	process.exit(1)
}

console.log(`Running ${testFiles.length} test files with the Node test runner.`)

const args = [
	"--test",
	...process.argv.slice(2),
	...testFiles.map((file) => relative(root, file)),
]

const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit" })

child.on("exit", (code, signal) => {
	process.exit(signal === null ? (code ?? 1) : 1)
})
