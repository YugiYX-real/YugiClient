import { autoUpdater } from "electron-updater"
import type { UpdateInfo } from "electron-updater"
import type { UpdateStatus } from "@halcyon/ipc"
import type { EventBus } from "../infra/events.ts"
import type { JsonStore } from "../infra/json-store.ts"
import type { Logger } from "../infra/logger.ts"

export type UpdateHistoryState = { installedVersions: string[] }

export const DEFAULT_UPDATE_HISTORY: UpdateHistoryState = { installedVersions: [] }

type ReleaseNote = { readonly version?: string; readonly note?: string | null }

function releaseNotesOf(info: UpdateInfo): string | null {
	const notes: unknown = info.releaseNotes
	if (typeof notes === "string") {
		return notes.trim() === "" ? null : notes
	}
	if (Array.isArray(notes)) {
		const joined = (notes as readonly ReleaseNote[])
			.map((entry) => entry.note ?? "")
			.filter((note) => note.trim() !== "")
			.join("\n\n")
		return joined === "" ? null : joined
	}
	return null
}

export class UpdateService {
	private readonly logger: Logger
	private readonly events: EventBus
	private readonly history: JsonStore<UpdateHistoryState>
	private readonly currentVersion: string
	private state: UpdateStatus

	constructor(dependencies: {
		logger: Logger
		events: EventBus
		history: JsonStore<UpdateHistoryState>
		currentVersion: string
	}) {
		this.logger = dependencies.logger
		this.events = dependencies.events
		this.history = dependencies.history
		this.currentVersion = dependencies.currentVersion
		this.state = {
			state: "idle",
			currentVersion: dependencies.currentVersion,
			availableVersion: null,
			releaseNotes: null,
			percent: 0,
			error: null,
			canRollback: false,
		}
	}

	async initialize(autoDownload: boolean): Promise<void> {
		autoUpdater.autoDownload = autoDownload
		autoUpdater.autoInstallOnAppQuit = true
		autoUpdater.allowDowngrade = false

		autoUpdater.on("checking-for-update", () => {
			this.patch({ state: "checking", error: null })
		})
		autoUpdater.on("update-available", (info: UpdateInfo) => {
			this.patch({
				state: autoDownload ? "downloading" : "available",
				availableVersion: info.version,
				releaseNotes: releaseNotesOf(info),
			})
		})
		autoUpdater.on("update-not-available", () => {
			this.patch({ state: "up-to-date", availableVersion: null, percent: 0 })
		})
		autoUpdater.on("download-progress", (progress: { percent?: number }) => {
			this.patch({ state: "downloading", percent: Math.round(progress.percent ?? 0) })
		})
		autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
			this.patch({
				state: "ready",
				availableVersion: info.version,
				releaseNotes: releaseNotesOf(info),
				percent: 100,
			})
			this.events.toast(
				"success",
				`Halcyon ${info.version} is ready to install`,
				"The update is applied the next time the launcher restarts",
			)
		})
		autoUpdater.on("error", (error: Error) => {
			this.logger.warn("The updater reported a problem", error)
			this.patch({ state: "error", error: error.message })
		})

		await this.history.update((current) => ({
			installedVersions: [
				...current.installedVersions.filter((version) => version !== this.currentVersion),
				this.currentVersion,
			].slice(-10),
		}))

		this.patch({ canRollback: (await this.previousVersion()) !== undefined })
	}

	private async previousVersion(): Promise<string | undefined> {
		const { installedVersions } = await this.history.read()
		return [...installedVersions].reverse().find((version) => version !== this.currentVersion)
	}

	private patch(next: Partial<UpdateStatus>): void {
		this.state = { ...this.state, ...next }
		this.events.emit("updates:changed", this.state)
	}

	current(): UpdateStatus {
		return this.state
	}

	async check(): Promise<UpdateStatus> {
		try {
			await autoUpdater.checkForUpdates()
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			this.logger.warn("Could not check for updates", error)
			this.patch({ state: "error", error: message })
		}
		return this.state
	}

	async download(): Promise<UpdateStatus> {
		try {
			this.patch({ state: "downloading", percent: 0, error: null })
			await autoUpdater.downloadUpdate()
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			this.logger.warn("Could not download the update", error)
			this.patch({ state: "error", error: message })
		}
		return this.state
	}

	install(): void {
		if (this.state.state !== "ready") {
			this.events.toast("info", "No downloaded update is waiting to be installed")
			return
		}
		autoUpdater.quitAndInstall(false, true)
	}

	async rollback(): Promise<UpdateStatus> {
		const previous = await this.previousVersion()
		if (previous === undefined) {
			this.patch({
				state: "error",
				error: "No previous version is recorded for this install",
			})
			return this.state
		}

		autoUpdater.allowDowngrade = true
		this.logger.info(`Rolling back towards ${previous}`)
		this.events.toast(
			"info",
			`Rolling back to Halcyon ${previous}`,
			"The published release is downloaded and verified before it is applied",
		)
		return this.check()
	}
}
