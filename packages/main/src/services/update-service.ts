import { createRequire } from "node:module"
import type { AppUpdater, UpdateInfo } from "electron-updater"
import type { UpdateStatus } from "@halcyon/ipc"
import type { EventBus } from "../infra/events.ts"
import type { JsonStore } from "../infra/json-store.ts"
import type { Logger } from "../infra/logger.ts"

// electron-updater is CommonJS and exposes autoUpdater through a lazy proxy, so the
// ESM main bundle cannot bind it as a named export. A require bridge resolves it.
const requireCjs = createRequire(import.meta.url)
const { autoUpdater } = requireCjs("electron-updater") as { autoUpdater: AppUpdater }

const UNREADABLE_FEED = /releases\.atom|authentication token is correct|401|403|404/i
const OFFLINE = /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|net::ERR/i

const UNREADABLE_FEED_MESSAGE =
	"The private update feed needs access. Set HALCYON_GITHUB_TOKEN to a fine-grained, " +
	"read-only token for YugiYX-real/YugiClient and restart Halcyon."
const OFFLINE_MESSAGE = "Update checks are unavailable because the launcher is offline."

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

function explain(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error)
	if (OFFLINE.test(message)) {
		return OFFLINE_MESSAGE
	}
	if (UNREADABLE_FEED.test(message)) {
		return UNREADABLE_FEED_MESSAGE
	}
	return message
}

function updateToken(): string | undefined {
	const token = process.env.HALCYON_GITHUB_TOKEN?.trim()
	return token === undefined || token === "" ? undefined : token
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

		const token = updateToken()
		if (token !== undefined) {
			// The private GitHub provider reads GH_TOKEN lazily when the first check starts.
			// Keep the user-owned token out of packaged files and persistent launcher data.
			process.env.GH_TOKEN = token
			autoUpdater.addAuthHeader(`token ${token}`)
			this.logger.info("Authenticated access to the private update feed is enabled")
		}

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
			this.patch({ state: "error", error: explain(error) })
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
			this.logger.warn("Could not check for updates", error)
			this.patch({ state: "error", error: explain(error) })
		}
		return this.state
	}

	async download(): Promise<UpdateStatus> {
		try {
			this.patch({ state: "downloading", percent: 0, error: null })
			await autoUpdater.downloadUpdate()
		} catch (error) {
			this.logger.warn("Could not download the update", error)
			this.patch({ state: "error", error: explain(error) })
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
