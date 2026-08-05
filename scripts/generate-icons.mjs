#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import pngToIco from "png-to-ico"
import sharp from "sharp"

const root = fileURLToPath(new URL("..", import.meta.url))
const source = resolve(root, "assets/branding/icon.svg")
const splashSource = resolve(root, "assets/branding/splash.svg")
const buildDir = resolve(root, "build")
const iconsDir = resolve(buildDir, "icons")

const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

async function renderPng(svg, size, destination) {
	await mkdir(dirname(destination), { recursive: true })
	const buffer = await sharp(svg, { density: 512 })
		.resize(size, size)
		.png({ compressionLevel: 9 })
		.toBuffer()
	await writeFile(destination, buffer)
	return buffer
}

async function main() {
	const svg = await readFile(source)
	await mkdir(iconsDir, { recursive: true })

	const rendered = new Map()
	for (const size of PNG_SIZES) {
		const destination = resolve(iconsDir, `${size}x${size}.png`)
		rendered.set(size, await renderPng(svg, size, destination))
		console.log(`icons/${size}x${size}.png`)
	}

	await writeFile(resolve(buildDir, "icon.png"), rendered.get(1024))
	console.log("icon.png")

	const ico = await pngToIco(ICO_SIZES.map((size) => resolve(iconsDir, `${size}x${size}.png`)))
	await writeFile(resolve(buildDir, "icon.ico"), ico)
	console.log("icon.ico")

	const splash = await readFile(splashSource)
	const splashPng = await sharp(splash, { density: 300 }).resize(720, 420).png().toBuffer()
	await writeFile(resolve(buildDir, "splash.png"), splashPng)
	console.log("splash.png")
}

await main()
