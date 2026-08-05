import type { FeatureSet, HostPlatform, Rule } from "./types.ts"

const OS_ALIASES: Readonly<Record<string, string>> = {
	windows: "windows",
	win: "windows",
	win32: "windows",
	osx: "osx",
	macos: "osx",
	darwin: "osx",
	linux: "linux",
	unix: "linux",
}

const ARCH_ALIASES: Readonly<Record<string, string>> = {
	x86: "x86",
	x32: "x86",
	i386: "x86",
	ia32: "x86",
	x86_64: "x86_64",
	x64: "x86_64",
	amd64: "x86_64",
	arm64: "arm64",
	aarch64: "arm64",
	arm32: "arm32",
	arm: "arm32",
}

function normalizeOs(value: string): string {
	const key = value.toLowerCase()
	return OS_ALIASES[key] ?? key
}

function normalizeArch(value: string): string {
	const key = value.toLowerCase()
	return ARCH_ALIASES[key] ?? key
}

function matchesPattern(pattern: string, value: string): boolean {
	try {
		return new RegExp(pattern).test(value)
	} catch {
		return pattern === value
	}
}

export function ruleMatches(
	rule: Rule,
	platform: HostPlatform,
	features: FeatureSet = {},
): boolean {
	const os = rule.os
	if (os !== undefined) {
		if (os.name !== undefined && normalizeOs(os.name) !== platform.os) {
			return false
		}
		if (os.arch !== undefined && normalizeArch(os.arch) !== platform.arch) {
			return false
		}
		if (os.version !== undefined && !matchesPattern(os.version, platform.version)) {
			return false
		}
	}

	const required = rule.features
	if (required !== undefined) {
		for (const key of Object.keys(required)) {
			const expected = required[key] ?? false
			const actual = features[key] ?? false
			if (actual !== expected) {
				return false
			}
		}
	}

	return true
}

export function isAllowedByRules(
	rules: readonly Rule[] | undefined,
	platform: HostPlatform,
	features: FeatureSet = {},
): boolean {
	if (rules === undefined || rules.length === 0) {
		return true
	}

	let allowed = false
	for (const rule of rules) {
		if (ruleMatches(rule, platform, features)) {
			allowed = rule.action === "allow"
		}
	}
	return allowed
}
