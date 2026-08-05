export type ReleaseStage = "pre" | "rc" | "final"

export type ParsedRelease = {
	readonly major: number
	readonly minor: number
	readonly patch: number
	readonly stage: ReleaseStage
	readonly stageNumber: number
}

const RELEASE_PATTERN = /^(\d+)\.(\d+)(?:\.(\d+))?(?:[-_ ]?(pre|rc|Pre-Release)[-_ ]?(\d+)?)?$/i

const SNAPSHOT_PATTERN = /^(\d{2})w(\d{1,2})([a-z])$/i

export type ParsedSnapshot = {
	readonly year: number
	readonly week: number
	readonly revision: string
}

export function parseReleaseVersion(id: string): ParsedRelease | undefined {
	const match = RELEASE_PATTERN.exec(id.trim())
	if (match === null) {
		return undefined
	}

	const rawStage = match[4]?.toLowerCase()
	const stage: ReleaseStage = rawStage === undefined ? "final" : rawStage === "rc" ? "rc" : "pre"

	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3] ?? "0"),
		stage,
		stageNumber: Number(match[5] ?? "0"),
	}
}

export function parseSnapshotVersion(id: string): ParsedSnapshot | undefined {
	const match = SNAPSHOT_PATTERN.exec(id.trim())
	if (match === null) {
		return undefined
	}
	return {
		year: 2000 + Number(match[1]),
		week: Number(match[2]),
		revision: (match[3] ?? "a").toLowerCase(),
	}
}

function stageRank(stage: ReleaseStage): number {
	switch (stage) {
		case "pre":
			return 0
		case "rc":
			return 1
		default:
			return 2
	}
}

function compareNumbers(a: number, b: number): number {
	return a === b ? 0 : a < b ? -1 : 1
}

export function compareReleaseVersions(a: string, b: string): number | undefined {
	const left = parseReleaseVersion(a)
	const right = parseReleaseVersion(b)
	if (left === undefined || right === undefined) {
		return undefined
	}

	return (
		compareNumbers(left.major, right.major) ||
		compareNumbers(left.minor, right.minor) ||
		compareNumbers(left.patch, right.patch) ||
		compareNumbers(stageRank(left.stage), stageRank(right.stage)) ||
		compareNumbers(left.stageNumber, right.stageNumber)
	)
}

export function isAtLeastRelease(id: string, minimum: string): boolean | undefined {
	const comparison = compareReleaseVersions(id, minimum)
	return comparison === undefined ? undefined : comparison >= 0
}

export function compareSnapshotVersions(a: string, b: string): number | undefined {
	const left = parseSnapshotVersion(a)
	const right = parseSnapshotVersion(b)
	if (left === undefined || right === undefined) {
		return undefined
	}
	return (
		compareNumbers(left.year, right.year) ||
		compareNumbers(left.week, right.week) ||
		(left.revision === right.revision ? 0 : left.revision < right.revision ? -1 : 1)
	)
}

export type VersionOrdering = {
	compare(a: string, b: string): number
	knows(id: string): boolean
}

export function createReleaseTimeOrdering(
	entries: readonly { readonly id: string; readonly releaseTime: string }[],
): VersionOrdering {
	const timestamps = new Map<string, number>()
	for (const entry of entries) {
		const parsed = Date.parse(entry.releaseTime)
		if (!Number.isNaN(parsed)) {
			timestamps.set(entry.id, parsed)
		}
	}

	return {
		knows(id: string): boolean {
			return timestamps.has(id)
		},
		compare(a: string, b: string): number {
			const left = timestamps.get(a)
			const right = timestamps.get(b)
			if (left !== undefined && right !== undefined) {
				return compareNumbers(left, right)
			}
			return (
				compareReleaseVersions(a, b) ??
				compareSnapshotVersions(a, b) ??
				(a === b ? 0 : a < b ? -1 : 1)
			)
		},
	}
}

const SEMVER_PATTERN = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+](.*))?$/

export function compareSemver(a: string, b: string): number {
	const left = SEMVER_PATTERN.exec(a.trim())
	const right = SEMVER_PATTERN.exec(b.trim())
	if (left === null || right === null) {
		return a === b ? 0 : a < b ? -1 : 1
	}

	const numeric =
		compareNumbers(Number(left[1]), Number(right[1])) ||
		compareNumbers(Number(left[2] ?? "0"), Number(right[2] ?? "0")) ||
		compareNumbers(Number(left[3] ?? "0"), Number(right[3] ?? "0"))
	if (numeric !== 0) {
		return numeric
	}

	const leftTag = left[4]
	const rightTag = right[4]
	if (leftTag === rightTag) {
		return 0
	}
	if (leftTag === undefined) {
		return 1
	}
	if (rightTag === undefined) {
		return -1
	}
	return leftTag < rightTag ? -1 : 1
}
