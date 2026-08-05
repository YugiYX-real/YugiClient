import {
	cp,
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises"
import { join, relative, sep } from "node:path"
import { unzipSync, zipSync } from "fflate"

export async function pathExists(target: string): Promise<boolean> {
	try {
		await stat(target)
		return true
	} catch {
		return false
	}
}

export async function directorySize(target: string): Promise<number> {
	let total = 0
	const walk = async (current: string): Promise<void> => {
		let entries
		try {
			entries = await readdir(current, { withFileTypes: true })
		} catch {
			return
		}
		for (const entry of entries) {
			const full = join(current, entry.name)
			if (entry.isDirectory()) {
				await walk(full)
			} else if (entry.isFile()) {
				const info = await stat(full)
				total += info.size
			}
		}
	}
	await walk(target)
	return total
}

export async function listFiles(directory: string, extensions?: readonly string[]): Promise<string[]> {
	try {
		const entries = await readdir(directory, { withFileTypes: true })
		return entries
			.filter((entry) => entry.isFile())
			.map((entry) => entry.name)
			.filter(
				(name) =>
					extensions === undefined ||
					extensions.some((extension) => name.toLowerCase().endsWith(extension)),
			)
			.sort((left, right) => left.localeCompare(right))
	} catch {
		return []
	}
}

export async function copyDirectory(source: string, destination: string): Promise<void> {
	await mkdir(destination, { recursive: true })
	await cp(source, destination, { recursive: true, force: true })
}

export async function removePath(target: string): Promise<void> {
	await rm(target, { recursive: true, force: true })
}

async function collectRelativeFiles(root: string, current: string, acc: string[]): Promise<void> {
	const entries = await readdir(current, { withFileTypes: true })
	for (const entry of entries) {
		const full = join(current, entry.name)
		if (entry.isDirectory()) {
			await collectRelativeFiles(root, full, acc)
		} else if (entry.isFile()) {
			acc.push(relative(root, full).split(sep).join("/"))
		}
	}
}

export async function zipDirectory(source: string, archivePath: string): Promise<number> {
	const files: string[] = []
	await collectRelativeFiles(source, source, files)

	const payload: Record<string, Uint8Array> = {}
	for (const relativePath of files) {
		payload[relativePath] = new Uint8Array(await readFile(join(source, ...relativePath.split("/"))))
	}

	const archive = zipSync(payload, { level: 6 })
	await mkdir(join(archivePath, ".."), { recursive: true })
	await writeFile(archivePath, archive)
	return archive.byteLength
}

export async function unzipToDirectory(archivePath: string, destination: string): Promise<string[]> {
	const archive = new Uint8Array(await readFile(archivePath))
	const entries = unzipSync(archive)
	const written: string[] = []

	for (const [name, content] of Object.entries(entries)) {
		if (name.endsWith("/") || name.includes("..")) {
			continue
		}
		const target = join(destination, ...name.split("/"))
		await mkdir(join(target, ".."), { recursive: true })
		await writeFile(target, content)
		written.push(name)
	}

	return written
}

export async function readZipEntry(
	archivePath: string,
	predicate: (name: string) => boolean,
): Promise<{ name: string; content: Uint8Array } | undefined> {
	try {
		const archive = new Uint8Array(await readFile(archivePath))
		const entries = unzipSync(archive, { filter: (file) => predicate(file.name) })
		for (const [name, content] of Object.entries(entries)) {
			if (predicate(name)) {
				return { name, content }
			}
		}
		return undefined
	} catch {
		return undefined
	}
}

export function sanitiseFileName(input: string): string {
	const cleaned = input
		.replace(/[\\/:*?"<>|]/g, "-")
		.replace(/\s+/g, " ")
		.trim()
	return cleaned.length === 0 ? "untitled" : cleaned.slice(0, 80)
}
