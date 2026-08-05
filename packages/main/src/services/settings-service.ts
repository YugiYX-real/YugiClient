import type { Settings } from "@halcyon/ipc"
import { recommendedMemoryMb } from "@halcyon/core"
import type { EventBus } from "../infra/events.ts"
import type { JsonStore } from "../infra/json-store.ts"
import { totalSystemMemoryMb } from "../infra/platform.ts"

export const DEFAULT_JVM_ARGS =
	"-XX:+UnlockExperimentalVMOptions -XX:+UseG1GC -XX:G1NewSizePercent=20 -XX:G1ReservePercent=20 -XX:MaxGCPauseMillis=50 -XX:G1HeapRegionSize=32M -XX:-UseAdaptiveSizePolicy -XX:-OmitStackTraceInFastThrow"

export function defaultSettings(): Settings {
	return {
		theme: "dark",
		accent: "#7C5CFF",
		language: "en",
		autoUpdate: true,
		notifications: true,
		animations: "full",
		blur: true,
		cornerRadius: 14,
		transparency: 0.08,
		uiScale: 1,
		wallpaper: null,
		defaultMemoryMb: recommendedMemoryMb(totalSystemMemoryMb(), 0),
		defaultJvmArgs: DEFAULT_JVM_ARGS,
		defaultJavaPath: null,
		downloadDirectory: null,
		screenshotDirectory: null,
		concurrentDownloads: 8,
		discordPresence: true,
		keepLauncherOpen: true,
		closeToTray: false,
		shareUsageData: false,
		showSnapshots: false,
	}
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value))
}

function sanitise(settings: Settings): Settings {
	return {
		...settings,
		cornerRadius: clamp(Math.round(settings.cornerRadius), 0, 28),
		transparency: clamp(settings.transparency, 0, 0.6),
		uiScale: clamp(settings.uiScale, 0.8, 1.4),
		defaultMemoryMb: clamp(Math.round(settings.defaultMemoryMb / 256) * 256, 512, 32_768),
		concurrentDownloads: clamp(Math.round(settings.concurrentDownloads), 1, 32),
		accent: /^#[0-9a-fA-F]{6}$/.test(settings.accent) ? settings.accent : "#7C5CFF",
	}
}

export class SettingsService {
	private readonly store: JsonStore<Settings>
	private readonly events: EventBus
	private readonly subscribers = new Set<(settings: Settings) => void>()

	constructor(store: JsonStore<Settings>, events: EventBus) {
		this.store = store
		this.events = events
	}

	async get(): Promise<Settings> {
		return sanitise({ ...defaultSettings(), ...(await this.store.read()) })
	}

	onChange(subscriber: (settings: Settings) => void): () => void {
		this.subscribers.add(subscriber)
		return () => {
			this.subscribers.delete(subscriber)
		}
	}

	async update(patch: Partial<Settings>): Promise<Settings> {
		const current = await this.get()
		const next = sanitise({ ...current, ...patch })
		await this.store.write(next)
		this.publish(next)
		return next
	}

	async reset(): Promise<Settings> {
		const next = sanitise(defaultSettings())
		await this.store.write(next)
		this.publish(next)
		return next
	}

	private publish(settings: Settings): void {
		for (const subscriber of this.subscribers) {
			subscriber(settings)
		}
		this.events.emit("settings:changed", settings)
	}
}
