import test from "node:test"
import assert from "node:assert/strict"

import {
	SpeedEstimator,
	computeEtaSeconds,
	formatBytes,
	formatDuration,
	formatPlaytime,
	formatSpeed,
	progressFraction,
} from "./progress.ts"

test("formats byte sizes with human units", () => {
	assert.equal(formatBytes(0), "0 B")
	assert.equal(formatBytes(999), "999 B")
	assert.equal(formatBytes(1536), "1.5 KB")
	assert.equal(formatBytes(1024 * 1024 * 3.5), "3.5 MB")
	assert.equal(formatBytes(1024 ** 4), "1.0 TB")
})

test("formats transfer speed", () => {
	assert.equal(formatSpeed(1024 * 1024 * 12), "12.0 MB/s")
})

test("formats durations and unknown estimates", () => {
	assert.equal(formatDuration(undefined), "--")
	assert.equal(formatDuration(Number.POSITIVE_INFINITY), "--")
	assert.equal(formatDuration(45), "45s")
	assert.equal(formatDuration(125), "2m 05s")
	assert.equal(formatDuration(3725), "1h 02m")
})

test("eta is undefined when it cannot be known", () => {
	assert.equal(computeEtaSeconds(50, 100, 10), 5)
	assert.equal(computeEtaSeconds(50, 100, 0), undefined)
	assert.equal(computeEtaSeconds(100, 100, 10), undefined)
	assert.equal(computeEtaSeconds(0, 0, 10), undefined)
})

test("progress fraction is clamped", () => {
	assert.equal(progressFraction(0, 0), 0)
	assert.equal(progressFraction(5, 10), 0.5)
	assert.equal(progressFraction(20, 10), 1)
	assert.equal(progressFraction(-5, 10), 0)
})

test("speed estimator needs two samples and smooths spikes", () => {
	const estimator = new SpeedEstimator()
	assert.equal(estimator.sample(0, 1_000), 0)
	assert.equal(estimator.sample(1_000, 2_000), 1_000)

	const spike = estimator.sample(11_000, 3_000)
	assert.ok(spike > 1_000 && spike < 10_000)

	estimator.reset()
	assert.equal(estimator.current, 0)
})

test("speed estimator ignores non advancing clocks", () => {
	const estimator = new SpeedEstimator()
	estimator.sample(0, 1_000)
	estimator.sample(500, 2_000)
	const repeated = estimator.sample(900, 2_000)
	assert.equal(repeated, estimator.current)
})

test("playtime reads naturally at every scale", () => {
	assert.equal(formatPlaytime(30), "30 min")
	assert.equal(formatPlaytime(90), "1.5 h")
	assert.equal(formatPlaytime(3000), "2d 2h")
})
