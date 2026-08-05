import test from "node:test"
import assert from "node:assert/strict"

import {
	InvalidMavenCoordinateError,
	coordinateKey,
	mavenRelativePath,
	mavenUrl,
	parseMavenCoordinate,
} from "./maven.ts"

test("parses a three part coordinate", () => {
	assert.deepEqual(parseMavenCoordinate("com.mojang:authlib:4.0.43"), {
		group: "com.mojang",
		artifact: "authlib",
		version: "4.0.43",
		classifier: undefined,
		extension: "jar",
	})
})

test("parses classifier and extension", () => {
	assert.deepEqual(parseMavenCoordinate("net.fabricmc:mappings:1.0+build.7:sources@zip"), {
		group: "net.fabricmc",
		artifact: "mappings",
		version: "1.0+build.7",
		classifier: "sources",
		extension: "zip",
	})
})

test("rejects incomplete coordinates", () => {
	assert.throws(() => parseMavenCoordinate("com.mojang:authlib"), InvalidMavenCoordinateError)
})

test("builds the maven relative path", () => {
	assert.equal(
		mavenRelativePath(parseMavenCoordinate("org.lwjgl:lwjgl:3.3.1:natives-windows")),
		"org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-natives-windows.jar",
	)
})

test("builds absolute urls against a repository root", () => {
	const coordinate = parseMavenCoordinate("net.minecraftforge:forge:1.20.1-47.2.0:installer")
	assert.equal(
		mavenUrl("https://maven.minecraftforge.net", coordinate),
		"https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.2.0/forge-1.20.1-47.2.0-installer.jar",
	)
})

test("coordinate key ignores version so upgrades dedupe", () => {
	assert.equal(coordinateKey(parseMavenCoordinate("a.b:c:1.0")), "a.b:c")
	assert.equal(coordinateKey(parseMavenCoordinate("a.b:c:2.0")), "a.b:c")
	assert.notEqual(
		coordinateKey(parseMavenCoordinate("a.b:c:1.0:natives")),
		coordinateKey(parseMavenCoordinate("a.b:c:1.0")),
	)
})
