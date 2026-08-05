import test from "node:test"
import assert from "node:assert/strict"

import {
	isJavaCompatible,
	parseJavaVersionOutput,
	requiredJavaRuntime,
} from "./java-requirement.ts"

test("the manifest declaration always wins", () => {
	const requirement = requiredJavaRuntime("1.16.5", {
		component: "java-runtime-beta",
		majorVersion: 16,
	})
	assert.equal(requirement.major, 16)
	assert.equal(requirement.source, "manifest")
})

test("modern releases map to their known runtimes", () => {
	assert.equal(requiredJavaRuntime("1.20.6").major, 21)
	assert.equal(requiredJavaRuntime("1.21").major, 21)
	assert.equal(requiredJavaRuntime("1.20.4").major, 17)
	assert.equal(requiredJavaRuntime("1.18").major, 17)
	assert.equal(requiredJavaRuntime("1.17.1").major, 16)
	assert.equal(requiredJavaRuntime("1.16.5").major, 8)
	assert.equal(requiredJavaRuntime("1.7.10").major, 8)
})

test("snapshots are mapped through week thresholds", () => {
	assert.equal(requiredJavaRuntime("24w14a").major, 21)
	assert.equal(requiredJavaRuntime("23w45a").major, 17)
	assert.equal(requiredJavaRuntime("21w03a").major, 16)
	assert.equal(requiredJavaRuntime("20w51a").major, 8)
})

test("every requirement explains itself", () => {
	assert.match(requiredJavaRuntime("1.20.6").reason, /Java 21/)
	assert.match(requiredJavaRuntime("1.7.10").reason, /Java 8/)
})

test("modern runtimes accept newer majors, legacy ones do not", () => {
	assert.equal(isJavaCompatible(21, requiredJavaRuntime("1.20.4")), true)
	assert.equal(isJavaCompatible(11, requiredJavaRuntime("1.20.4")), false)
	assert.equal(isJavaCompatible(17, requiredJavaRuntime("1.8.9")), false)
	assert.equal(isJavaCompatible(8, requiredJavaRuntime("1.8.9")), true)
})

test("parses both legacy and modern java version banners", () => {
	assert.equal(
		parseJavaVersionOutput('openjdk version "1.8.0_392"\nOpenJDK Runtime Environment'),
		8,
	)
	assert.equal(parseJavaVersionOutput('openjdk version "17.0.10" 2024-01-16'), 17)
	assert.equal(parseJavaVersionOutput('java version "21.0.2" 2024-01-16 LTS'), 21)
	assert.equal(parseJavaVersionOutput("not a java banner"), undefined)
})
