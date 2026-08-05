import test from "node:test"
import assert from "node:assert/strict"

import { DownloadQueue, backoffDelay } from "./queue.ts"
import type { DownloadTask } from "./queue.ts"

const noSleep = async (): Promise<void> => {}

function tasks(count: number, bytes = 100): DownloadTask[] {
	return Array.from({ length: count }, (_unused, index) => ({
		id: `task-${index}`,
		label: `Task ${index}`,
		totalBytes: bytes,
	}))
}

test("drains every queued task and reports full progress", async () => {
	const queue = new DownloadQueue(
		async (task, context) => {
			context.reportBytes(task.totalBytes)
		},
		{ concurrency: 4, sleep: noSleep },
	)
	queue.enqueue(tasks(6))
	const snapshot = await queue.drain()

	assert.equal(snapshot.totalItems, 6)
	assert.equal(snapshot.completedItems, 6)
	assert.equal(snapshot.completedBytes, 600)
	assert.equal(snapshot.fraction, 1)
	assert.deepEqual(snapshot.failed, [])
})

test("never runs more tasks than the configured concurrency", async () => {
	let active = 0
	let peak = 0
	const queue = new DownloadQueue(
		async () => {
			active += 1
			peak = Math.max(peak, active)
			await Promise.resolve()
			active -= 1
		},
		{ concurrency: 3, sleep: noSleep },
	)
	queue.enqueue(tasks(12))
	await queue.drain()
	assert.ok(peak <= 3)
})

test("transient failures are retried up to the attempt limit", async () => {
	let attempts = 0
	const queue = new DownloadQueue(
		async () => {
			attempts += 1
			if (attempts < 3) {
				throw new Error("connection reset")
			}
		},
		{ maxAttempts: 3, sleep: noSleep },
	)
	queue.enqueue(tasks(1))
	const snapshot = await queue.drain()

	assert.equal(attempts, 3)
	assert.equal(snapshot.tasks[0]?.state, "completed")
	assert.equal(snapshot.tasks[0]?.attempt, 3)
})

test("exhausted retries land in the failed list with the last error", async () => {
	const queue = new DownloadQueue(
		async () => {
			throw new Error("checksum mismatch")
		},
		{ maxAttempts: 2, sleep: noSleep },
	)
	queue.enqueue(tasks(1))
	const snapshot = await queue.drain()

	assert.equal(snapshot.failed.length, 1)
	assert.equal(snapshot.failed[0]?.error, "checksum mismatch")
	assert.equal(snapshot.completedItems, 0)
})

test("failed tasks can be retried without rebuilding the queue", async () => {
	let failNext = true
	const queue = new DownloadQueue(
		async () => {
			if (failNext) {
				throw new Error("temporary")
			}
		},
		{ maxAttempts: 1, sleep: noSleep },
	)
	queue.enqueue(tasks(1))
	await queue.drain()
	assert.equal(queue.snapshot.failed.length, 1)

	failNext = false
	queue.retryFailed()
	const snapshot = await queue.drain()
	assert.equal(snapshot.completedItems, 1)
	assert.deepEqual(snapshot.failed, [])
})

test("cancelled tasks are skipped entirely", async () => {
	let started = 0
	const queue = new DownloadQueue(
		async () => {
			started += 1
		},
		{ sleep: noSleep },
	)
	queue.enqueue(tasks(2))
	queue.cancel("task-0")
	const snapshot = await queue.drain()

	assert.equal(started, 1)
	assert.equal(snapshot.tasks[0]?.state, "cancelled")
	assert.equal(snapshot.tasks[1]?.state, "completed")
})

test("in flight tasks observe the abort signal", async () => {
	const queue = new DownloadQueue(
		async (task, context) => {
			queue.cancel(task.id)
			assert.equal(context.signal.aborted, true)
		},
		{ sleep: noSleep },
	)
	queue.enqueue(tasks(1))
	const snapshot = await queue.drain()
	assert.equal(snapshot.tasks[0]?.state, "cancelled")
})

test("pausing suspends the workers until resume", async () => {
	const queue = new DownloadQueue(async () => {}, { concurrency: 1, sleep: noSleep })
	queue.enqueue(tasks(3))
	queue.pause()

	const draining = queue.drain()
	await Promise.resolve()
	assert.equal(queue.snapshot.paused, true)
	assert.equal(queue.snapshot.completedItems, 0)

	queue.resume()
	const snapshot = await draining
	assert.equal(snapshot.paused, false)
	assert.equal(snapshot.completedItems, 3)
})

test("subscribers receive progress updates and can unsubscribe", async () => {
	const queue = new DownloadQueue(
		async (task, context) => {
			context.reportBytes(task.totalBytes / 2)
		},
		{ sleep: noSleep },
	)
	let updates = 0
	const unsubscribe = queue.subscribe(() => {
		updates += 1
	})
	queue.enqueue(tasks(2))
	await queue.drain()
	assert.ok(updates > 2)

	unsubscribe()
	const before = updates
	queue.enqueue(tasks(1, 50))
	assert.equal(updates, before)
})

test("duplicate task ids are ignored", () => {
	const queue = new DownloadQueue(async () => {}, { sleep: noSleep })
	queue.enqueue(tasks(1))
	queue.enqueue(tasks(1))
	assert.equal(queue.snapshot.totalItems, 1)
})

test("backoff grows exponentially and stays bounded", () => {
	assert.equal(backoffDelay(1, 400), 400)
	assert.equal(backoffDelay(2, 400), 800)
	assert.equal(backoffDelay(3, 400), 1600)
	assert.equal(backoffDelay(20, 400), 30_000)
})
