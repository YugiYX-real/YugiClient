import { compareReleaseVersions, parseSnapshotVersion } from "./version-order.ts"
import type { JavaVersionRequirement } from "./types.ts"

export type JavaRequirement = {
	readonly major: number
	readonly component: string
	readonly source: "manifest" | "heuristic"
	readonly reason: string
}

type Threshold = {
	readonly minimumRelease: string
	readonly snapshotYear: number
	readonly snapshotWeek: number
	readonly major: number
	readonly component: string
}

const THRESHOLDS: readonly Threshold[] = [
	{
		minimumRelease: "1.20.5",
		snapshotYear: 2024,
		snapshotWeek: 14,
		major: 21,
		component: "java-runtime-delta",
	},
	{
		minimumRelease: "1.18",
		snapshotYear: 2021,
		snapshotWeek: 37,
		major: 17,
		component: "java-runtime-gamma",
	},
	{
		minimumRelease: "1.17",
		snapshotYear: 2021,
		snapshotWeek: 3,
		major: 16,
		component: "java-runtime-alpha",
	},
]

const LEGACY: Threshold = {
	minimumRelease: "0.0.0",
	snapshotYear: 0,
	snapshotWeek: 0,
	major: 8,
	component: "jre-legacy",
}

function matchesThreshold(versionId: string, threshold: Threshold): boolean {
	const release = compareReleaseVersions(versionId, threshold.minimumRelease)
	if (release !== undefined) {
		return release >= 0
	}

	const snapshot = parseSnapshotVersion(versionId)
	if (snapshot !== undefined) {
		if (snapshot.year !== threshold.snapshotYear) {
			return snapshot.year > threshold.snapshotYear
		}
		return snapshot.week >= threshold.snapshotWeek
	}

	return false
}

export function requiredJavaRuntime(
	versionId: string,
	declared?: JavaVersionRequirement,
): JavaRequirement {
	if (declared !== undefined && Number.isFinite(declared.majorVersion)) {
		return {
			major: declared.majorVersion,
			component: declared.component,
			source: "manifest",
			reason: `Minecraft ${versionId} declares Java ${declared.majorVersion} (${declared.component}).`,
		}
	}

	for (const threshold of THRESHOLDS) {
		if (matchesThreshold(versionId, threshold)) {
			return {
				major: threshold.major,
				component: threshold.component,
				source: "heuristic",
				reason: `Minecraft ${versionId} is at or above ${threshold.minimumRelease}, which requires Java ${threshold.major}.`,
			}
		}
	}

	return {
		major: LEGACY.major,
		component: LEGACY.component,
		source: "heuristic",
		reason: `Minecraft ${versionId} predates the modern runtime split and runs on Java ${LEGACY.major}.`,
	}
}

export function isJavaCompatible(installedMajor: number, requirement: JavaRequirement): boolean {
	if (requirement.major >= 16) {
		return installedMajor >= requirement.major
	}
	return installedMajor === requirement.major
}

export function parseJavaVersionOutput(output: string): number | undefined {
	const quoted = /version "(\d+)(?:\.(\d+))?[^"]*"/.exec(output)
	if (quoted !== null) {
		const major = Number(quoted[1])
		if (major === 1) {
			return Number(quoted[2] ?? "0")
		}
		return major
	}

	const openjdk = /openjdk (\d+)/i.exec(output)
	if (openjdk !== null) {
		return Number(openjdk[1])
	}

	return undefined
}
