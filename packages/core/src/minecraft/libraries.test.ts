import test from "node:test"
import assert from "node:assert/strict"

import {
	dedupeLibrariesByArtifact,
	nativeClassifier,
	resolveLibraries,
	resolveLibrary,
} from "./libraries.ts"
import type { HostPlatform, Library } from "./types.ts"

const linux: HostPlatform = { os: "linux", arch: "x86_64", version: "6.8.0" }
const win32: HostPlatform = { os: "windows", arch: "x86", version: "10.0" }

const lwjgl: Library = {
	name: "org.lwjgl:lwjgl:3.3.1",
	natives: { linux: "natives-linux", windows: "natives-windows-${arch}" },
	downloads: {
		classifiers: {
			"natives-linux": {
				path: "org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-natives-linux.jar",
				url: "https://example.invalid/native.jar",
				sha1: "deadbeef",
				size: 12,
			},
		},
	},
	extract: { exclude: ["META-INF/"] },
}

test("substitutes the arch placeholder in native classifiers", () => {
	assert.equal(nativeClassifier(lwjgl, win32), "natives-windows-32")
	assert.equal(
		nativeClassifier(lwjgl, { os: "windows", arch: "x86_64", version: "10.0" }),
		"natives-windows-64",
	)
	assert.equal(nativeClassifier(lwjgl, linux), "natives-linux")
})

test("resolves native artifacts with extraction rules", () => {
	const resolved = resolveLibrary(lwjgl, linux)
	assert.ok(resolved)
	assert.equal(resolved.native, true)
	assert.equal(resolved.relativePath, "org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-natives-linux.jar")
	assert.deepEqual(resolved.extractExclusions, ["META-INF/"])
})

test("derives urls from the maven coordinate when downloads are absent", () => {
	const resolved = resolveLibrary(
		{ name: "net.fabricmc:fabric-loader:0.15.7", url: "https://maven.fabricmc.net/" },
		linux,
	)
	assert.ok(resolved)
	assert.equal(
		resolved.url,
		"https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.15.7/fabric-loader-0.15.7.jar",
	)
})

test("skips libraries whose rules exclude the platform", () => {
	const libraries: Library[] = [
		{ name: "a.b:only-mac:1.0", rules: [{ action: "allow", os: { name: "osx" } }] },
		{ name: "a.b:everywhere:1.0" },
	]
	const resolved = resolveLibraries(libraries, linux)
	assert.equal(resolved.length, 1)
	assert.equal(resolved[0]?.library.name, "a.b:everywhere:1.0")
})

test("deduplicates identical paths", () => {
	const resolved = resolveLibraries([lwjgl, lwjgl], linux)
	assert.equal(resolved.length, 1)
})

test("dedupe by artifact keeps the first occurrence so loaders can override", () => {
	const deduped = dedupeLibrariesByArtifact([
		{ name: "com.google.guava:guava:32.0.0" },
		{ name: "com.google.guava:guava:21.0" },
		{ name: "org.ow2.asm:asm:9.6" },
	])
	assert.deepEqual(
		deduped.map((library) => library.name),
		["com.google.guava:guava:32.0.0", "org.ow2.asm:asm:9.6"],
	)
})
