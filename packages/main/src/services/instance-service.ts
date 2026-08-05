import { randomUUID } from "node:crypto"
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { requiredJavaRuntime } from "@halcyon/core"
import type {
	CreateInstanceInput,
	InstanceConfig,
	InstancePatch,
	InstanceSummary,
	ScreenshotEntry,
	WorldEntry,
} from "@halcyon/ipc"
import type { EventBus } from "../infra/events.ts"
import type { JsonStore } from "../infra/json-store.ts"
import type { Logger } from "../infra/logger.ts"
import {
	copyDirectory,
	directorySize,
	listFiles,
	pathExists,
	removePath,
	sanitiseFileName,
	unzipToDirectory,
	zipDirectory,
} from "../infra/fs-extra.ts"
import {
	instanceDirectory,
	instanceGameDirectory,
	officialLauncherDirectory,
	type AppPaths,
} from "../infra/paths.ts"
import type { SettingsService } from "./settings-service.ts"

export type InstanceState = { instances: InstanceConfig[] }

export const DEFAULT_INSTANCE_STATE: InstanceState = { instances: [] }

const INSTANCE_MANIFEST = "halcyon.instance.json"

export class InstanceService {
	private readonly store: JsonStore<InstanceState>
	private readonly paths: AppPaths
	private readonly logger: Logger
	private readonly events: EventBus
	private readonly settings: SettingsService
	private readonly running = new Set<string>()

	constructor(dependencies: {
		store: JsonStore<InstanceState>
		paths: AppPaths
		logger: Logger
		events: EventBus
		settings: SettingsService
	}) {
		this.store = dependencies.store
		this.paths = dependencies.paths
		this.logger = dependencies.logger
		this.events = dependencies.events
		this.settings = dependencies.settings
	}

	directory(instanceId: string): string {
		return instanceDirectory(this.paths, instanceId)
	}

	gameDirectory(instanceId: string): string {
		return instanceGameDirectory(this.paths, instanceId)
	}

	contentDirectory(instanceId: string, folder: string): string {
		return join(this.gameDirectory(instanceId), folder)
	}

	async configs(): Promise<readonly InstanceConfig[]> {
		return (await this.store.read()).instances
	}

	async config(instanceId: string): Promise<InstanceConfig> {
		const found = (await this.configs()).find((instance) => instance.id === instanceId)
		if (found === undefined) {
			throw new Error(`Unknown instance "${instanceId}"`)
		}
		return found
	}

	async list(): Promise<readonly InstanceSummary[]> {
		const configs = await this.configs()
		return Promise.all(configs.map((config) => this.summarise(config)))
	}

	async get(instanceId: string): Promise<InstanceSummary> {
		return this.summarise(await this.config(instanceId))
	}

	private async summarise(config: InstanceConfig): Promise<InstanceSummary> {
		const directory = this.directory(config.id)
		const mods = await listFiles(this.contentDirectory(config.id, "mods"), [
			".jar",
			".jar.disabled",
		])
		return {
			...config,
			directory,
			installed: await pathExists(this.gameDirectory(config.id)),
			running: this.running.has(config.id),
			modCount: mods.length,
			requiredJavaMajor: requiredJavaRuntime(config.gameVersion).major,
			sizeBytes: null,
		}
	}

	async detailedSize(instanceId: string): Promise<number> {
		return directorySize(this.directory(instanceId))
	}

	private async persist(instances: readonly InstanceConfig[]): Promise<void> {
		await this.store.write({ instances: [...instances] })
		this.events.emit("instances:changed", { instanceId: null })
	}

	async create(input: CreateInstanceInput): Promise<InstanceSummary> {
		const settings = await this.settings.get()
		const id = randomUUID()
		const config: InstanceConfig = {
			id,
			name: input.name.trim() === "" ? "New instance" : input.name.trim(),
			icon: input.icon ?? null,
			background: null,
			group: input.group ?? null,
			gameVersion: input.gameVersion,
			loader: input.loader,
			loaderVersion: input.loaderVersion ?? null,
			javaPath: settings.defaultJavaPath,
			memoryMb: input.memoryMb ?? settings.defaultMemoryMb,
			jvmArgs: settings.defaultJvmArgs,
			window: { width: null, height: null, fullscreen: false },
			env: {},
			discordPresence: settings.discordPresence,
			favorite: false,
			notes: "",
			createdAt: new Date().toISOString(),
			lastPlayedAt: null,
			playtimeMinutes: 0,
			launchCount: 0,
		}

		await mkdir(this.gameDirectory(id), { recursive: true })
		for (const folder of [
			"mods",
			"resourcepacks",
			"shaderpacks",
			"saves",
			"screenshots",
			"logs",
		]) {
			await mkdir(this.contentDirectory(id, folder), { recursive: true })
		}

		const instances = [...(await this.configs()), config]
		await this.persist(instances)
		this.logger.info(
			`Created instance ${config.name} (${config.gameVersion}, ${config.loader})`,
		)
		return this.summarise(config)
	}

	async update(instanceId: string, patch: InstancePatch): Promise<InstanceSummary> {
		const instances = await this.configs()
		let updated: InstanceConfig | undefined
		const next = instances.map((instance) => {
			if (instance.id !== instanceId) {
				return instance
			}
			updated = { ...instance, ...patch, id: instance.id }
			return updated
		})
		if (updated === undefined) {
			throw new Error(`Unknown instance "${instanceId}"`)
		}
		await this.persist(next)
		return this.summarise(updated)
	}

	async rename(instanceId: string, name: string): Promise<InstanceSummary> {
		return this.update(instanceId, { name: name.trim() })
	}

	async remove(instanceId: string): Promise<void> {
		const instances = await this.configs()
		await this.persist(instances.filter((instance) => instance.id !== instanceId))
		await removePath(this.directory(instanceId))
		this.logger.info(`Deleted instance ${instanceId}`)
	}

	async duplicate(instanceId: string, name?: string): Promise<InstanceSummary> {
		const source = await this.config(instanceId)
		const id = randomUUID()
		const config: InstanceConfig = {
			...source,
			id,
			name: name?.trim() ?? `${source.name} (copy)`,
			createdAt: new Date().toISOString(),
			lastPlayedAt: null,
			playtimeMinutes: 0,
			launchCount: 0,
			favorite: false,
		}

		await copyDirectory(this.directory(instanceId), this.directory(id))
		await this.persist([...(await this.configs()), config])
		return this.summarise(config)
	}

	async worlds(instanceId: string): Promise<readonly WorldEntry[]> {
		const savesDirectory = this.contentDirectory(instanceId, "saves")
		let entries: string[] = []
		try {
			entries = (await readdir(savesDirectory, { withFileTypes: true }))
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name)
		} catch {
			return []
		}

		const worlds: WorldEntry[] = []
		for (const folderName of entries) {
			const folder = join(savesDirectory, folderName)
			const info = await stat(folder).catch(() => undefined)
			worlds.push({
				folderName,
				name: folderName,
				lastPlayedAt: info === undefined ? null : new Date(info.mtimeMs).toISOString(),
				sizeBytes: await directorySize(folder),
			})
		}
		return worlds.sort((left, right) =>
			(left.lastPlayedAt ?? "") < (right.lastPlayedAt ?? "") ? 1 : -1,
		)
	}

	async screenshots(instanceId: string): Promise<readonly ScreenshotEntry[]> {
		const settings = await this.settings.get()
		const directory =
			settings.screenshotDirectory ?? this.contentDirectory(instanceId, "screenshots")
		const files = await listFiles(directory, [".png", ".jpg", ".jpeg", ".webp"])

		const screenshots: ScreenshotEntry[] = []
		for (const fileName of files) {
			const filePath = join(directory, fileName)
			const info = await stat(filePath).catch(() => undefined)
			screenshots.push({
				fileName,
				filePath,
				createdAt: new Date(info?.mtimeMs ?? Date.now()).toISOString(),
				sizeBytes: info?.size ?? 0,
			})
		}
		return screenshots.sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1))
	}

	async exportInstance(instanceId: string, targetPath?: string): Promise<string> {
		const config = await this.config(instanceId)
		const archivePath =
			targetPath ??
			join(
				this.paths.exports,
				`${sanitiseFileName(config.name)}-${config.gameVersion}.halcyon.zip`,
			)

		const manifestPath = join(this.directory(instanceId), INSTANCE_MANIFEST)
		await writeFile(manifestPath, `${JSON.stringify(config, null, "\t")}\n`, "utf8")
		await mkdir(this.paths.exports, { recursive: true })
		await zipDirectory(this.directory(instanceId), archivePath)
		this.logger.info(`Exported instance ${config.name} to ${archivePath}`)
		return archivePath
	}

	async importInstance(archivePath: string): Promise<InstanceSummary> {
		const id = randomUUID()
		const destination = this.directory(id)
		await mkdir(destination, { recursive: true })
		await unzipToDirectory(archivePath, destination)

		let imported: InstanceConfig | undefined
		try {
			const manifest = await readFile(join(destination, INSTANCE_MANIFEST), "utf8")
			imported = JSON.parse(manifest) as InstanceConfig
		} catch {
			imported = undefined
		}

		const settings = await this.settings.get()
		const config: InstanceConfig = {
			...(imported ?? {
				name: basename(archivePath).replace(/\.(halcyon\.)?zip$/i, ""),
				icon: null,
				background: null,
				group: null,
				gameVersion: "1.20.1",
				loader: "vanilla",
				loaderVersion: null,
				javaPath: settings.defaultJavaPath,
				memoryMb: settings.defaultMemoryMb,
				jvmArgs: settings.defaultJvmArgs,
				window: { width: null, height: null, fullscreen: false },
				env: {},
				discordPresence: settings.discordPresence,
				favorite: false,
				notes: "",
				lastPlayedAt: null,
			}),
			id,
			createdAt: new Date().toISOString(),
			playtimeMinutes: 0,
			launchCount: 0,
		}

		await this.persist([...(await this.configs()), config])
		return this.summarise(config)
	}

	async importOfficial(sourceDirectory?: string): Promise<readonly InstanceSummary[]> {
		const source = sourceDirectory ?? officialLauncherDirectory()
		if (!(await pathExists(source))) {
			throw new Error(`No Minecraft installation was found at ${source}`)
		}

		const versionsDirectory = join(source, "versions")
		let versionIds: string[] = []
		try {
			versionIds = (await readdir(versionsDirectory, { withFileTypes: true }))
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name)
		} catch {
			versionIds = []
		}

		const created: InstanceSummary[] = []
		for (const versionId of versionIds.slice(0, 24)) {
			const loader = versionId.toLowerCase().includes("fabric")
				? "fabric"
				: versionId.toLowerCase().includes("quilt")
					? "quilt"
					: versionId.toLowerCase().includes("neoforge")
						? "neoforge"
						: versionId.toLowerCase().includes("forge")
							? "forge"
							: "vanilla"

			const summary = await this.create({
				name: `${versionId} (imported)`,
				gameVersion: versionId.replace(/^.*?(\d+\.\d+(?:\.\d+)?).*$/, "$1"),
				loader,
			})

			for (const folder of ["mods", "resourcepacks", "shaderpacks", "saves", "screenshots"]) {
				const from = join(source, folder)
				if (await pathExists(from)) {
					await copyDirectory(from, this.contentDirectory(summary.id, folder))
				}
			}
			created.push(await this.get(summary.id))
		}

		this.logger.info(`Imported ${created.length} instance(s) from ${source}`)
		return created
	}

	setRunning(instanceId: string, running: boolean): void {
		if (running) {
			this.running.add(instanceId)
		} else {
			this.running.delete(instanceId)
		}
		this.events.emit("instances:changed", { instanceId })
	}

	isRunning(instanceId: string): boolean {
		return this.running.has(instanceId)
	}

	runningInstanceIds(): readonly string[] {
		return [...this.running]
	}

	async markLaunched(instanceId: string): Promise<void> {
		const instances = await this.configs()
		await this.persist(
			instances.map((instance) =>
				instance.id === instanceId
					? {
							...instance,
							lastPlayedAt: new Date().toISOString(),
							launchCount: instance.launchCount + 1,
						}
					: instance,
			),
		)
	}

	async addPlaytime(instanceId: string, minutes: number): Promise<void> {
		if (minutes <= 0) {
			return
		}
		const instances = await this.configs()
		await this.persist(
			instances.map((instance) =>
				instance.id === instanceId
					? {
							...instance,
							playtimeMinutes: instance.playtimeMinutes + Math.round(minutes),
						}
					: instance,
			),
		)
	}

	async moveContentFile(
		instanceId: string,
		folder: string,
		from: string,
		to: string,
	): Promise<void> {
		const directory = this.contentDirectory(instanceId, folder)
		await mkdir(directory, { recursive: true })
		await rename(join(directory, from), join(directory, to))
	}
}
