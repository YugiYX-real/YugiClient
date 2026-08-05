import type { PlayStatistics } from "@halcyon/ipc"
import type { JsonStore } from "../infra/json-store.ts"
import type { InstanceService } from "./instance-service.ts"
import type { VersionService } from "./version-service.ts"

export type PlaySession = {
	readonly instanceId: string
	readonly startedAt: string
	readonly minutes: number
}

export type StatisticsState = { sessions: PlaySession[] }

export const DEFAULT_STATISTICS_STATE: StatisticsState = { sessions: [] }

const RETENTION_DAYS = 180

function dayKey(value: Date): string {
	return value.toISOString().slice(0, 10)
}

export class StatisticsService {
	private readonly store: JsonStore<StatisticsState>
	private readonly instances: InstanceService
	private readonly versions: VersionService

	constructor(dependencies: {
		store: JsonStore<StatisticsState>
		instances: InstanceService
		versions: VersionService
	}) {
		this.store = dependencies.store
		this.instances = dependencies.instances
		this.versions = dependencies.versions
	}

	async record(session: PlaySession): Promise<void> {
		if (session.minutes <= 0) {
			return
		}
		const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
		await this.store.update((current) => ({
			sessions: [...current.sessions, session].filter(
				(entry) => Date.parse(entry.startedAt) >= cutoff,
			),
		}))
	}

	async summary(): Promise<PlayStatistics> {
		const [{ sessions }, configs, installed] = await Promise.all([
			this.store.read(),
			this.instances.configs(),
			this.versions.installedVersionIds(),
		])

		const byInstance = new Map<string, number>()
		for (const config of configs) {
			byInstance.set(config.id, config.playtimeMinutes)
		}

		let busiestInstance: string | null = null
		let busiestMinutes = 0
		for (const config of configs) {
			if (config.playtimeMinutes > busiestMinutes) {
				busiestMinutes = config.playtimeMinutes
				busiestInstance = config.name
			}
		}

		const minutesByDay = new Map<string, number>()
		for (const session of sessions) {
			const key = dayKey(new Date(session.startedAt))
			minutesByDay.set(key, (minutesByDay.get(key) ?? 0) + session.minutes)
		}

		const last7Days: { date: string; minutes: number }[] = []
		for (let offset = 6; offset >= 0; offset -= 1) {
			const day = new Date(Date.now() - offset * 24 * 60 * 60 * 1000)
			const key = dayKey(day)
			last7Days.push({ date: key, minutes: Math.round(minutesByDay.get(key) ?? 0) })
		}

		return {
			totalPlaytimeMinutes: configs.reduce(
				(total, config) => total + config.playtimeMinutes,
				0,
			),
			launchCount: configs.reduce((total, config) => total + config.launchCount, 0),
			instanceCount: configs.length,
			installedVersionCount: installed.length,
			busiestInstance,
			last7Days,
		}
	}
}
