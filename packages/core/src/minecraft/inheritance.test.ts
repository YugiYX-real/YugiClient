import test from "node:test"
import assert from "node:assert/strict"

import {
	CircularInheritanceError,
	UnresolvedInheritanceError,
	mergeVersionJson,
	resolveVersion,
} from "./inheritance.ts"
import type { VersionJson } from "./types.ts"

const vanilla: VersionJson = {
	id: "1.20.1",
	type: "release",
	mainClass: "net.minecraft.client.main.Main",
	assets: "5",
	assetIndex: { id: "5", url: "https://example.invalid/5.json", sha1: "a", size: 1 },
	javaVersion: { component: "java-runtime-gamma", majorVersion: 17 },
	libraries: [{ name: "com.google.guava:guava:31.0.1" }, { name: "org.ow2.asm:asm:9.3" }],
	arguments: { jvm: ["-cp", "${classpath}"], game: ["--username", "${auth_player_name}"] },
}

const fabric: VersionJson = {
	id: "fabric-loader-0.15.7-1.20.1",
	inheritsFrom: "1.20.1",
	type: "release",
	mainClass: "net.fabricmc.loader.impl.launch.knot.KnotClient",
	libraries: [{ name: "net.fabricmc:fabric-loader:0.15.7" }, { name: "org.ow2.asm:asm:9.6" }],
	arguments: { jvm: ["-DFabricMcEmu=net.minecraft.client.main.Main"] },
}

test("child overrides scalar fields and inherits the rest", () => {
	const merged = mergeVersionJson(fabric, vanilla)
	assert.equal(merged.id, "fabric-loader-0.15.7-1.20.1")
	assert.equal(merged.mainClass, "net.fabricmc.loader.impl.launch.knot.KnotClient")
	assert.equal(merged.assets, "5")
	assert.equal(merged.javaVersion?.majorVersion, 17)
	assert.equal(merged.inheritsFrom, undefined)
})

test("child libraries win version conflicts and are ordered first", () => {
	const merged = mergeVersionJson(fabric, vanilla)
	assert.deepEqual(
		(merged.libraries ?? []).map((library) => library.name),
		[
			"net.fabricmc:fabric-loader:0.15.7",
			"org.ow2.asm:asm:9.6",
			"com.google.guava:guava:31.0.1",
		],
	)
})

test("arguments concatenate parent first so loader flags come last", () => {
	const merged = mergeVersionJson(fabric, vanilla)
	assert.deepEqual(merged.arguments?.jvm, [
		"-cp",
		"${classpath}",
		"-DFabricMcEmu=net.minecraft.client.main.Main",
	])
	assert.deepEqual(merged.arguments?.game, ["--username", "${auth_player_name}"])
})

test("resolveVersion walks the whole inheritance chain", () => {
	const catalogue = new Map<string, VersionJson>([
		[vanilla.id, vanilla],
		[fabric.id, fabric],
	])
	const resolved = resolveVersion(fabric.id, (id) => catalogue.get(id))
	assert.equal(resolved.mainClass, "net.fabricmc.loader.impl.launch.knot.KnotClient")
	assert.equal(resolved.assetIndex?.id, "5")
})

test("missing parents raise a descriptive error", () => {
	assert.throws(
		() => resolveVersion(fabric.id, (id) => (id === fabric.id ? fabric : undefined)),
		UnresolvedInheritanceError,
	)
})

test("cycles are detected instead of hanging", () => {
	const a: VersionJson = { id: "a", inheritsFrom: "b" }
	const b: VersionJson = { id: "b", inheritsFrom: "a" }
	const catalogue = new Map<string, VersionJson>([
		["a", a],
		["b", b],
	])
	assert.throws(() => resolveVersion("a", (id) => catalogue.get(id)), CircularInheritanceError)
})
