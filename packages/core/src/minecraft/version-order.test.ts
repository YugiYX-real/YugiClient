import test from "node:test"
import assert from "node:assert/strict"

import {
	compareReleaseVersions,
	compareSemver,
	compareSnapshotVersions,
	createReleaseTimeOrdering,
	isAtLeastRelease,
	parseReleaseVersion,
	parseSnapshotVersion,
} from "./version-order.ts"

test("parses releases with an implicit patch", () => {
	assert.deepEqual(parseReleaseVersion("1.20"), {
		major: 1,
		minor: 20,
		patch: 0,
		stage: "final",
		stageNumber: 0,
	})
})

test("parses pre-releases and release candidates", () => {
	assert.equal(parseReleaseVersion("1.20-pre3")?.stage, "pre")
	assert.equal(parseReleaseVersion("1.20-pre3")?.stageNumber, 3)
	assert.equal(parseReleaseVersion("1.19-rc2")?.stage, "rc")
})

test("orders releases numerically, not lexicographically", () => {
	assert.equal(compareReleaseVersions("1.9.4", "1.10"), -1)
	assert.equal(compareReleaseVersions("1.20.1", "1.20"), 1)
	assert.equal(compareReleaseVersions("1.20.1", "1.20.1"), 0)
})

test("pre-releases sort before release candidates and finals", () => {
	assert.equal(compareReleaseVersions("1.20-pre1", "1.20"), -1)
	assert.equal(compareReleaseVersions("1.20-rc1", "1.20-pre7"), 1)
	assert.equal(compareReleaseVersions("1.20-rc1", "1.20"), -1)
})

test("snapshots are not treated as releases", () => {
	assert.equal(compareReleaseVersions("24w14a", "1.20.5"), undefined)
	assert.deepEqual(parseSnapshotVersion("24w14a"), { year: 2024, week: 14, revision: "a" })
})

test("snapshots order by year, week, then revision", () => {
	assert.equal(compareSnapshotVersions("23w51b", "24w01a"), -1)
	assert.equal(compareSnapshotVersions("24w14a", "24w14b"), -1)
	assert.equal(compareSnapshotVersions("24w14a", "24w14a"), 0)
})

test("isAtLeastRelease answers the java threshold question", () => {
	assert.equal(isAtLeastRelease("1.20.6", "1.20.5"), true)
	assert.equal(isAtLeastRelease("1.20.4", "1.20.5"), false)
	assert.equal(isAtLeastRelease("24w14a", "1.20.5"), undefined)
})

test("manifest release dates order mixed release and snapshot lists", () => {
	const ordering = createReleaseTimeOrdering([
		{ id: "1.20.4", releaseTime: "2023-12-07T12:56:20+00:00" },
		{ id: "24w14a", releaseTime: "2024-04-03T12:34:00+00:00" },
		{ id: "1.20.5", releaseTime: "2024-04-23T12:56:20+00:00" },
	])
	assert.equal(ordering.compare("1.20.4", "24w14a"), -1)
	assert.equal(ordering.compare("1.20.5", "24w14a"), 1)
	assert.equal(ordering.knows("1.20.4"), true)
	assert.equal(ordering.knows("1.7.10"), false)
})

test("unknown ids still compare deterministically", () => {
	const ordering = createReleaseTimeOrdering([])
	assert.equal(ordering.compare("1.9.4", "1.10"), -1)
	assert.equal(ordering.compare("weird-a", "weird-b"), -1)
})

test("semver comparison handles pre-release tags and missing parts", () => {
	assert.equal(compareSemver("1.2.0", "1.10.0"), -1)
	assert.equal(compareSemver("v2.0", "2.0.0"), 0)
	assert.equal(compareSemver("1.0.0-rc.1", "1.0.0"), -1)
	assert.equal(compareSemver("0.15.7", "0.15.11"), -1)
})
