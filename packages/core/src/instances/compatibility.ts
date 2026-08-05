import { compareReleaseVersions, parseSnapshotVersion } from "../minecraft/version-order.ts"
import { requiredJavaRuntime } from "../minecraft/java-requirement.ts"
import type { LoaderId } from "../minecraft/types.ts"

export type CompatibilitySeverity = "info" | "warning" | "blocker"

export type CompatibilityWarning = {
	readonly code: string
	readonly severity: CompatibilitySeverity
	readonly message: string
	readonly detail?: string
}

export type ModSummary = {
	readonly fileName: string
	readonly displayName: string
	readonly enabled: boolean
	readonly gameVersions: readonly string[]
	readonly loaders: readonly string[]
}

export type VersionChangeRequest = {
	readonly fromVersion: string
	readonly toVersion: string
	readonly fromLoader: LoaderId
	readonly toLoader: LoaderId
	readonly mods: readonly ModSummary[]
	readonly hasWorlds: boolean
}

export type VersionChangeAssessment = {
	readonly direction: "upgrade" | "downgrade" | "same" | "unknown"
	readonly warnings: readonly CompatibilityWarning[]
	readonly incompatibleMods: readonly ModSummary[]
	readonly recommendBackup: boolean
	readonly javaChanges: boolean
	readonly canProceed: boolean
}

const FABRIC_FAMILY: readonly LoaderId[] = ["fabric", "quilt"]
const FORGE_FAMILY: readonly LoaderId[] = ["forge", "neoforge"]

export function loadersInterchangeable(from: LoaderId, to: LoaderId): boolean {
	if (from === to) {
		return true
	}
	return (
		(FABRIC_FAMILY.includes(from) && FABRIC_FAMILY.includes(to)) ||
		(FORGE_FAMILY.includes(from) && FORGE_FAMILY.includes(to))
	)
}

function modSupports(mod: ModSummary, version: string, loader: LoaderId): boolean {
	const gameOk = mod.gameVersions.length === 0 || mod.gameVersions.includes(version)
	const loaderOk =
		mod.loaders.length === 0 ||
		mod.loaders.includes(loader) ||
		(loader === "quilt" && mod.loaders.includes("fabric"))
	return gameOk && loaderOk
}

function direction(from: string, to: string): VersionChangeAssessment["direction"] {
	const comparison = compareReleaseVersions(from, to)
	if (comparison === undefined) {
		const fromSnapshot = parseSnapshotVersion(from)
		const toSnapshot = parseSnapshotVersion(to)
		if (fromSnapshot === undefined || toSnapshot === undefined) {
			return from === to ? "same" : "unknown"
		}
		const snapshotDelta =
			fromSnapshot.year - toSnapshot.year || fromSnapshot.week - toSnapshot.week
		return snapshotDelta === 0 ? "same" : snapshotDelta < 0 ? "upgrade" : "downgrade"
	}
	return comparison === 0 ? "same" : comparison < 0 ? "upgrade" : "downgrade"
}

export function assessVersionChange(request: VersionChangeRequest): VersionChangeAssessment {
	const warnings: CompatibilityWarning[] = []
	const changeDirection = direction(request.fromVersion, request.toVersion)

	const incompatibleMods = request.mods.filter(
		(mod) => mod.enabled && !modSupports(mod, request.toVersion, request.toLoader),
	)

	if (incompatibleMods.length > 0) {
		warnings.push({
			code: "mods-incompatible",
			severity: "warning",
			message: `${incompatibleMods.length} enabled mod${incompatibleMods.length === 1 ? "" : "s"} do not list support for ${request.toVersion}`,
			detail: incompatibleMods
				.slice(0, 8)
				.map((mod) => mod.displayName)
				.join(", "),
		})
	}

	if (!loadersInterchangeable(request.fromLoader, request.toLoader)) {
		warnings.push({
			code: "loader-family-change",
			severity: "blocker",
			message: `Switching from ${request.fromLoader} to ${request.toLoader} changes the mod format`,
			detail: "Mods cannot carry over between these loader families. Existing mods will be disabled rather than deleted.",
		})
	} else if (request.fromLoader !== request.toLoader) {
		warnings.push({
			code: "loader-migration",
			severity: "info",
			message: `${request.fromLoader} mods usually keep working on ${request.toLoader}`,
			detail: "Halcyon will migrate the mod folder and re-check dependencies after the change.",
		})
	}

	if (changeDirection === "downgrade" && request.hasWorlds) {
		warnings.push({
			code: "world-downgrade",
			severity: "blocker",
			message: "Downgrading can corrupt worlds that were already opened in a newer version",
			detail: "Minecraft upgrades world data in place and never downgrades it.",
		})
	}

	const fromJava = requiredJavaRuntime(request.fromVersion)
	const toJava = requiredJavaRuntime(request.toVersion)
	const javaChanges = fromJava.major !== toJava.major

	if (javaChanges) {
		warnings.push({
			code: "java-change",
			severity: "info",
			message: `This version needs Java ${toJava.major} instead of Java ${fromJava.major}`,
			detail: toJava.reason,
		})
	}

	if (changeDirection === "unknown") {
		warnings.push({
			code: "unknown-order",
			severity: "info",
			message: "Could not determine whether this is an upgrade or a downgrade",
			detail: "Version ordering falls back to the official manifest release dates when available.",
		})
	}

	return {
		direction: changeDirection,
		warnings,
		incompatibleMods,
		recommendBackup: request.hasWorlds || incompatibleMods.length > 0,
		javaChanges,
		canProceed: true,
	}
}

export function recommendedMemoryMb(totalSystemMb: number, modCount: number): number {
	const reserveForOs = Math.max(2048, Math.round(totalSystemMb * 0.25))
	const available = Math.max(1024, totalSystemMb - reserveForOs)
	const base =
		modCount === 0
			? 2048
			: modCount < 50
				? 3072
				: modCount < 150
					? 4096
					: modCount < 300
						? 6144
						: 8192
	const capped = Math.min(base, available, 8192)
	return Math.round(capped / 512) * 512
}
