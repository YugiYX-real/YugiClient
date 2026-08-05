#!/usr/bin/env node
import { rm } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const targets = [
	"out",
	"release",
	"dist",
	"coverage",
	"build/icons",
	"build/icon.png",
	"build/icon.ico",
	"build/splash.png",
]

for (const target of targets) {
	await rm(resolve(root, target), { recursive: true, force: true })
	console.log(`removed ${target}`)
}
