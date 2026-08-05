import { SpeedEstimator, computeEtaSeconds, progressFraction } from "./progress.ts"
import type { ProgressSnapshot } from "./progress.ts"

export type TaskState =
	| "queued"
	| "running"
	| "completed"
	| "failed"
	| "cancelled"
	| "paused"

export type DownloadTask = {
	readonly id: string
	readonly label: string
	readonly totalBytes: number
	readonly group?: string
}

export type TaskProgress = {
	readonly id: string
	readonly state: TaskState
	readonly receivedBytes: number
	readonly attempt: number
	readonly error?: string
}

export type TaskRunner = (
	task: DownloadTask,
	context: {
		reportBytes(received: number): void
		readonly signal: { aborted: boolean }
	},
) => Promise<void>

export type QueueOptions = {
	readonly concurrency?: number
	readonly maxAttempts?: number
	readonly retryBaseDelayMs?: number
	readonly now?: () => number
	readonly sleep?: (ms: number) => Promise<void>
}

export type QueueListener = (snapshot: QueueSnapshot) => void

export type QueueSnapshot = ProgressSnapshot & {
	readonly tasks: readonly TaskProgress[]
	readonly paused: boolean
	readonly failed: readonly TaskProgress[]
}

export function backoffDelay(attempt: number, baseDelayMs: number): number {
	const exponential = baseDelayMs * 2 ** Math.max(0, attempt - 1)
	return Math.min(30_000, exponential)
}

type MutableTask = {
	task: DownloadTask
	state: TaskState
	received: number
	attempt: number
	error?: string
	aborted: boolean
}

export class DownloadQueue {
	private readonly entries = new Map<string, MutableTask>()
	private readonly order: string[] = []
	private readonly listeners = new Set<QueueListener>()
	private readonly estimator = new SpeedEstimator()
	private readonly concurrency: number
	private readonly maxAttempts: number
	private readonly retryBaseDelayMs: number
	private readonly now: () => number
	private readonly sleep: (ms: number) => Promise<void>
	private readonly runner: TaskRunner
	private pausedFlag = false
	private resumeWaiters: (() => void)[] = []

	constructor(runner: TaskRunner, options: QueueOptions = {}) {
		this.runner = runner
		this.concurrency = Math.max(1, options.concurrency ?? 8)
		this.maxAttempts = Math.max(1, options.maxAttempts ?? 3)
		this.retryBaseDelayMs = options.retryBaseDelayMs ?? 400
		this.now = options.now ?? (() => Date.now())
		this.sleep =
			options.sleep ??
			((ms: number) =>
				new Promise<void>((resolve) => {
					setTimeout(resolve, ms)
				}))
	}

	subscribe(listener: QueueListener): () => void {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}

	enqueue(tasks: readonly DownloadTask[]): void {
		for (const task of tasks) {
			if (this.entries.has(task.id)) {
				continue
			}
			this.entries.set(task.id, {
				task,
				state: "queued",
				received: 0,
				attempt: 0,
				aborted: false,
			})
			this.order.push(task.id)
		}
		this.emit()
	}

	pause(): void {
		this.pausedFlag = true
		this.emit()
	}

	resume(): void {
		if (!this.pausedFlag) {
			return
		}
		this.pausedFlag = false
		const waiters = this.resumeWaiters
		this.resumeWaiters = []
		for (const waiter of waiters) {
			waiter()
		}
		this.emit()
	}

	cancel(id: string): void {
		const entry = this.entries.get(id)
		if (entry === undefined || entry.state === "completed") {
			return
		}
		entry.aborted = true
		entry.state = "cancelled"
		this.emit()
	}

	cancelAll(): void {
		for (const id of this.entries.keys()) {
			this.cancel(id)
		}
	}

	retryFailed(): void {
		for (const entry of this.entries.values()) {
			if (entry.state === "failed" || entry.state === "cancelled") {
				entry.state = "queued"
				entry.attempt = 0
				entry.received = 0
				entry.aborted = false
				entry.error = undefined
			}
		}
		this.emit()
	}

	get snapshot(): QueueSnapshot {
		const tasks: TaskProgress[] = []
		let completedBytes = 0
		let totalBytes = 0
		let completedItems = 0

		for (const id of this.order) {
			const entry = this.entries.get(id)
			if (entry === undefined) {
				continue
			}
			totalBytes += entry.task.totalBytes
			completedBytes += entry.state === "completed" ? entry.task.totalBytes : entry.received
			if (entry.state === "completed") {
				completedItems += 1
			}
			tasks.push({
				id: entry.task.id,
				state: entry.state,
				receivedBytes: entry.received,
				attempt: entry.attempt,
				error: entry.error,
			})
		}

		const bytesPerSecond = this.estimator.sample(completedBytes, this.now())

		return {
			tasks,
			paused: this.pausedFlag,
			failed: tasks.filter((task) => task.state === "failed"),
			completedBytes,
			totalBytes,
			completedItems,
			totalItems: tasks.length,
			bytesPerSecond,
			etaSeconds: computeEtaSeconds(completedBytes, totalBytes, bytesPerSecond),
			fraction: progressFraction(completedBytes, totalBytes),
		}
	}

	async drain(): Promise<QueueSnapshot> {
		const workerCount = Math.min(this.concurrency, Math.max(1, this.order.length))
		const workers: Promise<void>[] = []
		for (let index = 0; index < workerCount; index += 1) {
			workers.push(this.worker())
		}
		await Promise.all(workers)
		this.emit()
		return this.snapshot
	}

	private async worker(): Promise<void> {
		for (;;) {
			await this.waitWhilePaused()
			const entry = this.nextQueued()
			if (entry === undefined) {
				return
			}
			await this.run(entry)
		}
	}

	private nextQueued(): MutableTask | undefined {
		for (const id of this.order) {
			const entry = this.entries.get(id)
			if (entry !== undefined && entry.state === "queued") {
				entry.state = "running"
				return entry
			}
		}
		return undefined
	}

	private async waitWhilePaused(): Promise<void> {
		if (!this.pausedFlag) {
			return
		}
		await new Promise<void>((resolve) => {
			this.resumeWaiters.push(resolve)
		})
	}

	private async run(entry: MutableTask): Promise<void> {
		for (;;) {
			if (entry.aborted) {
				entry.state = "cancelled"
				this.emit()
				return
			}

			entry.attempt += 1
			entry.received = 0
			entry.error = undefined
			this.emit()

			try {
				await this.runner(entry.task, {
					reportBytes: (received: number) => {
						entry.received = received
						this.emit()
					},
					signal: {
						get aborted(): boolean {
							return entry.aborted
						},
					},
				})
				entry.state = entry.aborted ? "cancelled" : "completed"
				entry.received = entry.task.totalBytes
				this.emit()
				return
			} catch (error) {
				entry.error = error instanceof Error ? error.message : String(error)
				if (entry.aborted) {
					entry.state = "cancelled"
					this.emit()
					return
				}
				if (entry.attempt >= this.maxAttempts) {
					entry.state = "failed"
					this.emit()
					return
				}
				await this.sleep(backoffDelay(entry.attempt, this.retryBaseDelayMs))
			}
		}
	}

	private emit(): void {
		if (this.listeners.size === 0) {
			return
		}
		const snapshot = this.snapshot
		for (const listener of this.listeners) {
			listener(snapshot)
		}
	}
}
