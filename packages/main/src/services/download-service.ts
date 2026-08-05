import { DownloadQueue } from "@halcyon/core"
import type { QueueSnapshot } from "@halcyon/core"
import type { DownloadItem, DownloadItemState, DownloadSnapshot } from "@halcyon/ipc"
import type { EventBus } from "../infra/events.ts"
import type { HttpClient } from "../infra/http.ts"
import type { Logger } from "../infra/logger.ts"

export type DownloadRequest = {
	readonly id: string
	readonly label: string
	readonly url: string
	readonly destination: string
	readonly sha1?: string | null
	readonly totalBytes?: number | null
	readonly group?: string
}

export type DownloadOutcome = {
	readonly completed: number
	readonly failed: readonly string[]
	readonly bytes: number
}

const EMPTY_SNAPSHOT: DownloadSnapshot = {
	items: [],
	completedBytes: 0,
	totalBytes: 0,
	completedItems: 0,
	totalItems: 0,
	bytesPerSecond: 0,
	etaSeconds: null,
	fraction: 0,
	paused: false,
	failedCount: 0,
}

export class DownloadService {
	private readonly http: HttpClient
	private readonly logger: Logger
	private readonly events: EventBus
	private readonly requests = new Map<string, DownloadRequest>()
	private queue: DownloadQueue
	private concurrency = 8
	private activeRuns = 0
	private latest: DownloadSnapshot = EMPTY_SNAPSHOT
	private publishScheduled = false

	constructor(http: HttpClient, logger: Logger, events: EventBus) {
		this.http = http
		this.logger = logger
		this.events = events
		this.queue = this.createQueue()
	}

	setConcurrency(concurrency: number): void {
		const next = Math.min(32, Math.max(1, Math.round(concurrency)))
		if (next === this.concurrency) {
			return
		}
		this.concurrency = next
		if (this.activeRuns === 0) {
			this.queue = this.createQueue()
		}
	}

	snapshot(): DownloadSnapshot {
		return this.latest
	}

	async run(requests: readonly DownloadRequest[], group: string): Promise<DownloadOutcome> {
		if (requests.length === 0) {
			return { completed: 0, failed: [], bytes: 0 }
		}

		for (const request of requests) {
			this.requests.set(request.id, { ...request, group })
		}

		this.queue.enqueue(
			requests.map((request) => ({
				id: request.id,
				label: request.label,
				totalBytes: request.totalBytes ?? 0,
				group,
			})),
		)

		this.activeRuns += 1
		try {
			const snapshot = await this.queue.drain()
			const failed = snapshot.tasks
				.filter((task) => task.state === "failed")
				.map((task) => this.requests.get(task.id)?.label ?? task.id)
			const relevant = snapshot.tasks.filter((task) =>
				requests.some((request) => request.id === task.id),
			)
			const completed = relevant.filter((task) => task.state === "completed").length
			if (failed.length > 0) {
				this.logger.warn(`${failed.length} download(s) failed in group ${group}`)
			}
			return { completed, failed, bytes: snapshot.completedBytes }
		} finally {
			this.activeRuns -= 1
			this.recycleWhenIdle()
		}
	}

	pause(): DownloadSnapshot {
		this.queue.pause()
		return this.latest
	}

	resume(): DownloadSnapshot {
		this.queue.resume()
		return this.latest
	}

	retryFailed(): DownloadSnapshot {
		this.queue.retryFailed()
		void this.queue.drain()
		return this.latest
	}

	cancel(itemId: string | null): DownloadSnapshot {
		if (itemId === null) {
			this.queue.cancelAll()
		} else {
			this.queue.cancel(itemId)
		}
		return this.latest
	}

	private createQueue(): DownloadQueue {
		const queue = new DownloadQueue(
			async (task, context) => {
				const request = this.requests.get(task.id)
				if (request === undefined) {
					return
				}
				await this.http.download(request.url, request.destination, {
					sha1: request.sha1 ?? null,
					expectedSize: request.totalBytes ?? null,
					onProgress: (received) => {
						if (!context.signal.aborted) {
							context.reportBytes(received)
						}
					},
				})
			},
			{ concurrency: this.concurrency, maxAttempts: 4, retryBaseDelayMs: 500 },
		)
		queue.subscribe((snapshot) => {
			this.latest = this.toDto(snapshot)
			this.schedulePublish()
		})
		return queue
	}

	private schedulePublish(): void {
		if (this.publishScheduled) {
			return
		}
		this.publishScheduled = true
		setTimeout(() => {
			this.publishScheduled = false
			this.events.emit("downloads:changed", this.latest)
		}, 120)
	}

	private toDto(snapshot: QueueSnapshot): DownloadSnapshot {
		const items: DownloadItem[] = snapshot.tasks.map((task) => {
			const request = this.requests.get(task.id)
			return {
				id: task.id,
				label: request?.label ?? task.id,
				group: request?.group ?? null,
				state: task.state as DownloadItemState,
				receivedBytes: task.receivedBytes,
				totalBytes: request?.totalBytes ?? 0,
				attempt: task.attempt,
				error: task.error ?? null,
			}
		})

		return {
			items,
			completedBytes: snapshot.completedBytes,
			totalBytes: snapshot.totalBytes,
			completedItems: snapshot.completedItems,
			totalItems: snapshot.totalItems,
			bytesPerSecond: snapshot.bytesPerSecond,
			etaSeconds: snapshot.etaSeconds ?? null,
			fraction: snapshot.fraction,
			paused: snapshot.paused,
			failedCount: snapshot.failed.length,
		}
	}

	private recycleWhenIdle(): void {
		if (this.activeRuns > 0 || this.latest.failedCount > 0) {
			return
		}
		this.queue = this.createQueue()
		this.requests.clear()
		this.latest = EMPTY_SNAPSHOT
		this.events.emit("downloads:changed", this.latest)
	}
}
