import { randomUUID } from "node:crypto"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { BackupEntry } from "@halcyon/ipc"
import type { EventBus } from "../infra/events.ts"
import type { JsonStore } from "../infra/json-store.ts"
import type { Logger } from "../infra/logger.ts"
import {
	pathExists,
	removePath,
	sanitiseFileName,
	unzipToDirectory,
	zipDirectory,
} from "../infra/fs-extra.ts"
import type { AppPaths } from "../infra/paths.ts"
import type { InstanceService } from "./instance-service.ts"

export type BackupIndex = { entries: (BackupEntry & { instanceId: string })[] }

export const DEFAULT_BACKUP_INDEX: BackupIndex = { entries: [] }

export class BackupService {
	private readonly paths: AppPaths
	private readonly logger: Logger
	private readonly events: EventBus
	private readonly instances: InstanceService
	private readonly index: JsonStore<BackupIndex>

	constructor(dependencies: {
		paths: AppPaths
		logger: Logger
		events: EventBus
		instances: InstanceService
		index: JsonStore<BackupIndex>
	}) {
		this.paths = dependencies.paths
		this.logger = dependencies.logger
		this.events = dependencies.events
		this.instances = dependencies.instances
		this.index = dependencies.index
	}

	async list(instanceId: string): Promise<readonly BackupEntry[]> {
		const state = await this.index.read()
		return state.entries
			.filter((entry) => entry.instanceId === instanceId)
			.sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1))
	}

	private backupPath(fileName: string): string {
		return join(this.paths.backups, fileName)
	}

	async create(instanceId: string, note = ""): Promise<BackupEntry> {
		const config = await this.instances.config(instanceId)
		const id = randomUUID()
		const fileName = `${sanitiseFileName(config.name)}-${new Date()
			.toISOString()
			.replace(/[:.]/g, "-")}-${id.slice(0, 8)}.zip`

		await mkdir(this.paths.backups, { recursive: true })
		const sizeBytes = await zipDirectory(
			this.instances.gameDirectory(instanceId),
			this.backupPath(fileName),
		)

		const entry: BackupEntry & { instanceId: string } = {
			id,
			instanceId,
			fileName,
			note,
			createdAt: new Date().toISOString(),
			sizeBytes,
			gameVersion: config.gameVersion,
			loader: config.loader,
		}

		await this.index.update((current) => ({ entries: [...current.entries, entry] }))
		this.logger.info(`Created backup ${fileName} for ${config.name}`)
		this.events.emit("instances:changed", { instanceId })
		return entry
	}

	async restore(instanceId: string, backupId: string): Promise<void> {
		const state = await this.index.read()
		const entry = state.entries.find(
			(candidate) => candidate.id === backupId && candidate.instanceId === instanceId,
		)
		if (entry === undefined) {
			throw new Error(`Unknown backup "${backupId}"`)
		}

		const archivePath = this.backupPath(entry.fileName)
		if (!(await pathExists(archivePath))) {
			throw new Error(`The backup archive is missing: ${entry.fileName}`)
		}

		const safety = await this.create(instanceId, "Automatic safety copy before restore")
		const gameDirectory = this.instances.gameDirectory(instanceId)
		await removePath(gameDirectory)
		await mkdir(gameDirectory, { recursive: true })
		await unzipToDirectory(archivePath, gameDirectory)

		this.logger.info(
			`Restored backup ${entry.fileName} for instance ${instanceId} (safety copy ${safety.fileName})`,
		)
		this.events.emit("instances:changed", { instanceId })
	}

	async remove(instanceId: string, backupId: string): Promise<void> {
		const state = await this.index.read()
		const entry = state.entries.find((candidate) => candidate.id === backupId)
		if (entry === undefined) {
			return
		}
		await removePath(this.backupPath(entry.fileName))
		await this.index.write({
			entries: state.entries.filter((candidate) => candidate.id !== backupId),
		})
		this.events.emit("instances:changed", { instanceId })
	}

	async writeManifest(
		instanceId: string,
		payload: Readonly<Record<string, unknown>>,
	): Promise<void> {
		const target = join(this.instances.directory(instanceId), "halcyon.state.json")
		await writeFile(target, `${JSON.stringify(payload, null, "\t")}\n`, "utf8")
	}

	async readManifest(instanceId: string): Promise<Record<string, unknown> | undefined> {
		try {
			const target = join(this.instances.directory(instanceId), "halcyon.state.json")
			return JSON.parse(await readFile(target, "utf8")) as Record<string, unknown>
		} catch {
			return undefined
		}
	}

	async totalSize(): Promise<number> {
		const state = await this.index.read()
		let total = 0
		for (const entry of state.entries) {
			const info = await stat(this.backupPath(entry.fileName)).catch(() => undefined)
			total += info?.size ?? 0
		}
		return total
	}
}
