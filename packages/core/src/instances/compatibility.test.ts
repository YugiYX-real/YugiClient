import test from "node:test"
import assert from "node:assert/strict"

import {
	assessVersionChange,
	loadersInterchangeable,
	recommendedMemoryMb,
} from "./compatibility.ts"
import type { ModSummary } from "./compatibility.ts"

const sodium: ModSummary = {
	fileName: "sodium.jar",
	displayName: "Sodium",
	enabled: true,
	gameVersions: ["1.20.1"],
	loaders: ["fabric"],
}

test("loader families migrate within themselves only", () => {
	assert.equal(loadersInterchangeable("fabric", "quilt"), true)
	assert.equal(loadersInterchangeable("forge", "neoforge"), true)
	assert.equal(loadersInterchangeable("fabric", "forge"), false)
	assert.equal(loadersInterchangeable("vanilla", "vanilla"), true)
})

test("upgrading flags mods that do not declare the new version", () => {
	const assessment = assessVersionChange({
		fromVersion: "1.20.1",
		toVersion: "1.21",
		fromLoader: "fabric",
		toLoader: "fabric",
		mods: [sodium],
		hasWorlds: true,
	})

	assert.equal(assessment.direction, "upgrade")
	assert.equal(assessment.incompatibleMods.length, 1)
	assert.equal(assessment.recommendBackup, true)
	assert.ok(assessment.warnings.some((warning) => warning.code === "mods-incompatible"))
})

test("java changes are announced with the reason", () => {
	const assessment = assessVersionChange({
		fromVersion: "1.20.1",
		toVersion: "1.21",
		fromLoader: "vanilla",
		toLoader: "vanilla",
		mods: [],
		hasWorlds: false,
	})
	assert.equal(assessment.javaChanges, true)
	const warning = assessment.warnings.find((entry) => entry.code === "java-change")
	assert.match(warning?.message ?? "", /Java 21/)
})

test("downgrading with existing worlds is a blocker", () => {
	const assessment = assessVersionChange({
		fromVersion: "1.21",
		toVersion: "1.20.1",
		fromLoader: "fabric",
		toLoader: "fabric",
		mods: [],
		hasWorlds: true,
	})
	assert.equal(assessment.direction, "downgrade")
	assert.ok(
		assessment.warnings.some(
			(warning) => warning.code === "world-downgrade" && warning.severity === "blocker",
		),
	)
})

test("changing loader family is a blocker, migrating within one is informational", () => {
	const crossFamily = assessVersionChange({
		fromVersion: "1.20.1",
		toVersion: "1.20.1",
		fromLoader: "fabric",
		toLoader: "forge",
		mods: [],
		hasWorlds: false,
	})
	assert.ok(
		crossFamily.warnings.some(
			(warning) => warning.code === "loader-family-change" && warning.severity === "blocker",
		),
	)

	const sameFamily = assessVersionChange({
		fromVersion: "1.20.1",
		toVersion: "1.20.1",
		fromLoader: "fabric",
		toLoader: "quilt",
		mods: [],
		hasWorlds: false,
	})
	assert.ok(sameFamily.warnings.some((warning) => warning.code === "loader-migration"))
})

test("disabled mods are not counted as blockers", () => {
	const assessment = assessVersionChange({
		fromVersion: "1.20.1",
		toVersion: "1.21",
		fromLoader: "fabric",
		toLoader: "fabric",
		mods: [{ ...sodium, enabled: false }],
		hasWorlds: false,
	})
	assert.equal(assessment.incompatibleMods.length, 0)
	assert.equal(assessment.recommendBackup, false)
})

test("snapshot to snapshot changes still resolve a direction", () => {
	const assessment = assessVersionChange({
		fromVersion: "24w10a",
		toVersion: "24w14a",
		fromLoader: "vanilla",
		toLoader: "vanilla",
		mods: [],
		hasWorlds: false,
	})
	assert.equal(assessment.direction, "upgrade")
})

test("memory recommendations reserve room for the operating system", () => {
	assert.equal(recommendedMemoryMb(8192, 0), 2048)
	assert.equal(recommendedMemoryMb(16384, 200), 6144)
	assert.equal(recommendedMemoryMb(65536, 300), 8192)
	assert.equal(recommendedMemoryMb(4096, 100), 2048)
	assert.equal(recommendedMemoryMb(16384, 0) % 512, 0)
})
