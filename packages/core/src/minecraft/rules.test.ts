import test from "node:test"
import assert from "node:assert/strict"

import { isAllowedByRules, ruleMatches } from "./rules.ts"
import type { HostPlatform } from "./types.ts"

const windows: HostPlatform = { os: "windows", arch: "x86_64", version: "10.0.22631" }
const mac: HostPlatform = { os: "osx", arch: "arm64", version: "14.4" }
const linux: HostPlatform = { os: "linux", arch: "x86_64", version: "6.8.0" }

test("no rules means allowed", () => {
	assert.equal(isAllowedByRules(undefined, windows), true)
	assert.equal(isAllowedByRules([], windows), true)
})

test("rules default to disallow when nothing matches", () => {
	assert.equal(isAllowedByRules([{ action: "allow", os: { name: "osx" } }], windows), false)
})

test("last matching rule wins", () => {
	const rules = [
		{ action: "allow" as const },
		{ action: "disallow" as const, os: { name: "osx" } },
	]
	assert.equal(isAllowedByRules(rules, windows), true)
	assert.equal(isAllowedByRules(rules, mac), false)
})

test("os aliases are normalized", () => {
	assert.equal(ruleMatches({ action: "allow", os: { name: "macos" } }, mac), true)
	assert.equal(ruleMatches({ action: "allow", os: { name: "WINDOWS" } }, windows), true)
})

test("arch aliases are normalized", () => {
	assert.equal(ruleMatches({ action: "allow", os: { arch: "aarch64" } }, mac), true)
	assert.equal(ruleMatches({ action: "allow", os: { arch: "x86" } }, linux), false)
})

test("os version is treated as a regular expression", () => {
	assert.equal(ruleMatches({ action: "allow", os: { version: "^10\\." } }, windows), true)
	assert.equal(ruleMatches({ action: "allow", os: { version: "^6\\." } }, windows), false)
})

test("invalid os version patterns fall back to equality", () => {
	assert.equal(ruleMatches({ action: "allow", os: { version: "([" } }, windows), false)
})

test("feature rules compare against the active feature set", () => {
	const rule = { action: "allow" as const, features: { has_custom_resolution: true } }
	assert.equal(ruleMatches(rule, linux, { has_custom_resolution: true }), true)
	assert.equal(ruleMatches(rule, linux, {}), false)
})

test("features declared false must be absent", () => {
	const rule = { action: "allow" as const, features: { is_demo_user: false } }
	assert.equal(ruleMatches(rule, linux, {}), true)
	assert.equal(ruleMatches(rule, linux, { is_demo_user: true }), false)
})
