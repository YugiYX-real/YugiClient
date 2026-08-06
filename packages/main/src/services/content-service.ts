import { copyFile, mkdir, rename, stat } from "node:fs/promises"
import { basename, join } from "node:path"
import { findDuplicateProjects, resolveInstallPlan } from "@halcyon/core"
import type { InstalledContent, ResolutionTarget } from "@halcyon/core"
import type { ContentEntry, ContentKind, InstallOutcome, ModAnalysis, ModIssue } from "@halcyon/ipc"
import type { EventBus } from "../infra/events.ts"
import type { Logger } from "../infra/logger.ts"
import type { HttpClient } from "../infra/http.ts"
import { sha1OfFile } from "../infra/http.ts"
import { listFiles, readZipEntry, removePath } from "../infra/fs-extra.ts"
import type { InstanceService } from "./instance-service.ts"
import type { ModrinthService } from "./modrinth-service.ts"
import { JsonStore } from "../infra/json-store.ts"

const DISABLED_SUFFIX = ".disabled"

/** How many unknown files are hashed and looked up during a single listing. */
const ARTWORK_BATCH = 25

export type ContentRecord = {
	fileName: string
	kind: ContentKind
	projectId: string | null
	versionId: string | null
	displayName: string | null
	author: string | null
	description: string | null
	iconUrl: string | null
	version: string | null
	gameVersions: string[]
	loaders: string[]
	dependencies: { projectId: string | null; kind: string }[]
	latestVersionId: string | null
	latestVersionName: string | null
	artworkChecked?: boolean
}

export type ContentIndex = { records: ContentRecord[] }

export function contentFolder(kind: ContentKind): string {
	switch (kind) {
		case "mod":
			return "mods"
		case "resourcepack":
			return "resourcepacks"
		case "shaderpack":
			return "shaderpacks"
		case "datapack":
			return "datapacks"
	}
}

function extensionsFor(kind: ContentKind): readonly string[] {
	if (kind === "mod") {
		return [".jar", `.jar${DISABLED_SUFFIX}`]
	}
	return [".zip", `.zip${DISABLED_SUFFIX}`, ".jar", `.jar${DISABLED_SUFFIX}`]
}

function baseName(fileName: string): string {
	return fileName.endsWith(DISABLED_SUFFIX)
		? fileName.slice(0, -DISABLED_SUFFIX.length)
		: fileName
}

function prettyName(fileName: string): string {
	return baseName(fileName)
		.replace(/\.(jar|zip)$/i, "")
		.replace(/[-_]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
}

function emptyRecord(fileName: string, kind: ContentKind): ContentRecord {
	return {
		fileName,
		kind,
		projectId: null,
		versionId: null,
		displayName: prettyName(fileName),
		author: null,
		description: null,
		iconUrl: null,
		version: null,
		gameVersions: [],
		loaders: [],
		dependencies: [],
		latestVersionId: null,
		latestVersionName: null,
	}
}

type FabricModJson = {
	readonly id?: string
	readonly name?: string
	readonly version?: string
	readonly description?: string
	readonly authors?: readonly (string | { readonly name?: string })[]
	readonly depends?: Readonly<Record<string, unknown>>
}

export class ContentService {
	private readonly instances: InstanceService
	private readonly modrinth: ModrinthService
	private readonly http: HttpClient
	private readonly logger: Logger
	private readonly events: EventBus
	private readonly indices = new Map<string, JsonStore<ContentIndex>>()

	constructor(dependencies: {
		instances: InstanceService
		modrinth: ModrinthService
		http: HttpClient
		logger: Logger
		events: EventBus
	}) {
		this.instances = dependencies.instances
		this.modrinth = dependencies.modrinth
		this.http = dependencies.http
		this.logger = dependencies.logger
		this.events = dependencies.events
	}

	private index(instanceId: string): JsonStore<ContentIndex> {
		const existing = this.indices.get(instanceId)
		if (existing !== undefined) {
			return existing
		}
		const store = new JsonStore<ContentIndex>({
			filePath: join(this.instances.directory(instanceId), "halcyon.content.json"),
			defaults: { records: [] },
			onError: (error) => this.logger.warn("Content index problem", error),
		})
		this.indices.set(instanceId, store)
		return store
	}

	directory(instanceId: string, kind: ContentKind): string {
		return this.instances.contentDirectory(instanceId, contentFolder(kind))
	}

	async list(instanceId: string, kind: ContentKind): Promise<readonly ContentEntry[]> {
		const entries = await this.collect(instanceId, kind)
		const enriched = await this.hydrateArtwork(instanceId, kind, entries).catch(
			(error: unknown) => {
				this.logger.warn("Could not look up artwork for installed content", error)
				return false
			},
		)
		return enriched ? this.collect(instanceId, kind) : entries
	}

	private async collect(instanceId: string, kind: ContentKind): Promise<readonly ContentEntry[]> {
		const directory = this.directory(instanceId, kind)
		const files = await listFiles(directory, extensionsFor(kind))
		const { records } = await this.index(instanceId).read()

		const entries: ContentEntry[] = []
		for (const fileName of files) {
			const record = records.find(
				(candidate) => baseName(candidate.fileName) === baseName(fileName),
			)
			const info = await stat(join(directory, fileName)).catch(() => undefined)
			const metadata =
				record ?? (await this.readJarMetadata(join(directory, fileName), fileName, kind))

			entries.push({
				fileName,
				displayName: metadata.displayName ?? prettyName(fileName),
				kind,
				enabled: !fileName.endsWith(DISABLED_SUFFIX),
				sizeBytes: info?.size ?? 0,
				version: metadata.version,
				author: metadata.author,
				description: metadata.description,
				projectId: metadata.projectId,
				versionId: metadata.versionId,
				iconUrl: metadata.iconUrl,
				updateAvailable:
					metadata.latestVersionId !== null &&
					metadata.latestVersionId !== metadata.versionId,
				latestVersionId: metadata.latestVersionId,
				latestVersionName: metadata.latestVersionName,
				gameVersions: metadata.gameVersions,
				loaders: metadata.loaders,
			})
		}

		return entries.sort((left, right) => left.displayName.localeCompare(right.displayName))
	}

	/**
	 * Looks up files that still have no artwork by their sha1 hash. Modrinth
	 * answers with the project behind the file, which gives the list a real
	 * title, author and icon. Both hits and misses are written back so the same
	 * file is never looked up twice.
	 */
	private async hydrateArtwork(
		instanceId: string,
		kind: ContentKind,
		entries: readonly ContentEntry[],
	): Promise<boolean> {
		const { records } = await this.index(instanceId).read()
		const pending = entries
			.filter((entry) => entry.iconUrl === null)
			.filter((entry) => {
				const record = records.find(
					(candidate) => baseName(candidate.fileName) === baseName(entry.fileName),
				)
				return record === undefined || record.artworkChecked !== true
			})
			.slice(0, ARTWORK_BATCH)

		if (pending.length === 0) {
			return false
		}

		const directory = this.directory(instanceId, kind)
		const hashed: { fileName: string; hash: string }[] = []
		for (const entry of pending) {
			const hash = await sha1OfFile(join(directory, entry.fileName)).catch(() => undefined)
			if (hash !== undefined) {
				hashed.push({ fileName: entry.fileName, hash })
			}
		}

		if (hashed.length === 0) {
			return false
		}

		const matches = await this.modrinth.versionsByHashes(hashed.map((item) => item.hash))

		for (const { fileName, hash } of hashed) {
			const existing = records.find(
				(candidate) => baseName(candidate.fileName) === baseName(fileName),
			)
			const base =
				existing ?? (await this.readJarMetadata(join(directory, fileName), fileName, kind))
			const version = matches.get(hash)

			if (version === undefined) {
				await this.record(instanceId, {
					...base,
					fileName,
					kind,
					artworkChecked: true,
				})
				continue
			}

			const project = await this.modrinth.project(version.projectId).catch(() => undefined)
			await this.record(instanceId, {
				...base,
				fileName,
				kind,
				projectId: version.projectId,
				versionId: version.id,
				displayName: project?.title ?? base.displayName,
				author: project?.author ?? base.author,
				description: project?.description ?? base.description,
				iconUrl: project?.iconUrl ?? null,
				version: base.version ?? version.versionNumber,
				gameVersions: [...version.gameVersions],
				loaders: [...version.loaders],
				dependencies: version.dependencies.map((dependency) => ({
					projectId: dependency.projectId,
					kind: dependency.kind,
				})),
				latestVersionId: base.latestVersionId ?? version.id,
				latestVersionName: base.latestVersionName ?? version.versionNumber,
				artworkChecked: true,
			})
		}

		return true
	}

	private async readJarMetadata(
		filePath: string,
		fileName: string,
		kind: ContentKind,
	): Promise<ContentRecord> {
		const fallback = emptyRecord(fileName, kind)

		if (kind !== "mod") {
			return fallback
		}

		const fabric = await readZipEntry(filePath, (name) => name === "fabric.mod.json")
		if (fabric !== undefined) {
			try {
				const parsed = JSON.parse(new TextDecoder().decode(fabric.content)) as FabricModJson
				const author = parsed.authors?.[0]
				return {
					...fallback,
					displayName: parsed.name ?? parsed.id ?? fallback.displayName,
					version: parsed.version ?? null,
					description: parsed.description ?? null,
					author: typeof author === "string" ? author : (author?.name ?? null),
					loaders: ["fabric"],
					dependencies: Object.keys(parsed.depends ?? {})
						.filter(
							(id) => id !== "minecraft" && id !== "java" && id !== "fabricloader",
						)
						.map((id) => ({ projectId: id, kind: "required" })),
				}
			} catch {
				return fallback
			}
		}

		const toml = await readZipEntry(
			filePath,
			(name) => name === "META-INF/mods.toml" || name === "META-INF/neoforge.mods.toml",
		)
		if (toml !== undefined) {
			const text = new TextDecoder().decode(toml.content)
			const displayName = /displayName\s*=\s*"([^"]+)"/.exec(text)?.[1]
			const version = /version\s*=\s*"([^"]+)"/.exec(text)?.[1]
			const authors = /authors\s*=\s*"([^"]+)"/.exec(text)?.[1]
			const description = /description\s*=\s*'''([\s\S]*?)'''/.exec(text)?.[1]
			return {
				...fallback,
				displayName: displayName ?? fallback.displayName,
				version: version ?? null,
				author: authors ?? null,
				description: description?.trim() ?? null,
				loaders: ["forge", "neoforge"],
			}
		}

		return fallback
	}

	async setEnabled(
		instanceId: string,
		kind: ContentKind,
		fileNames: readonly string[],
		enabled: boolean,
	): Promise<void> {
		const directory = this.directory(instanceId, kind)
		for (const fileName of fileNames) {
			const target = enabled ? baseName(fileName) : `${baseName(fileName)}${DISABLED_SUFFIX}`
			if (target === fileName) {
				continue
			}
			await rename(join(directory, fileName), join(directory, target)).catch(
				(error: unknown) => {
					this.logger.warn(`Could not toggle ${fileName}`, error)
				},
			)
		}
		this.events.emit("instances:changed", { instanceId })
	}

	async remove(
		instanceId: string,
		kind: ContentKind,
		fileNames: readonly string[],
	): Promise<void> {
		const directory = this.directory(instanceId, kind)
		for (const fileName of fileNames) {
			await removePath(join(directory, fileName))
		}
		await this.index(instanceId).update((current) => ({
			records: current.records.filter(
				(record) =>
					!fileNames.some((fileName) => baseName(fileName) === baseName(record.fileName)),
			),
		}))
		this.events.emit("instances:changed", { instanceId })
	}

	async importFiles(
		instanceId: string,
		kind: ContentKind,
		sourcePaths: readonly string[],
	): Promise<InstallOutcome> {
		const directory = this.directory(instanceId, kind)
		await mkdir(directory, { recursive: true })

		const installed: string[] = []
		const problems: string[] = []

		for (const sourcePath of sourcePaths) {
			const fileName = basename(sourcePath)
			try {
				await copyFile(sourcePath, join(directory, fileName))
				installed.push(fileName)
			} catch (error) {
				problems.push(
					`${fileName}: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		}

		this.events.emit("instances:changed", { instanceId })
		return { installed, skipped: [], problems }
	}

	async installFromModrinth(
		instanceId: string,
		kind: ContentKind,
		versionId: string,
		withDependencies = true,
	): Promise<InstallOutcome> {
		const config = await this.instances.config(instanceId)
		const target: ResolutionTarget = { gameVersion: config.gameVersion, loader: config.loader }

		const root = await this.modrinth.getVersion(versionId)
		if (root === undefined) {
			return {
				installed: [],
				skipped: [],
				problems: [`Unknown Modrinth version ${versionId}`],
			}
		}

		const installedRecords = await this.installedContent(instanceId)
		const plan = withDependencies
			? await resolveInstallPlan([root], this.modrinth, target, installedRecords)
			: { install: [root], alreadySatisfied: [], problems: [] }

		const installed: string[] = []
		const problems = plan.problems.map((problem) => problem.message)
		const directory = this.directory(instanceId, kind)
		await mkdir(directory, { recursive: true })

		for (const planned of plan.install) {
			const version = await this.modrinth.version(planned.versionId)
			if (version === undefined || version.fileUrl === "") {
				problems.push(`No downloadable file for ${planned.name}`)
				continue
			}

			try {
				await this.http.download(version.fileUrl, join(directory, version.fileName), {
					sha1: version.sha1,
					expectedSize: version.fileSize,
				})
				const project = await this.modrinth
					.project(version.projectId)
					.catch(() => undefined)
				await this.record(instanceId, {
					fileName: version.fileName,
					kind,
					projectId: version.projectId,
					versionId: version.id,
					displayName: project?.title ?? version.name,
					author: project?.author ?? null,
					description: project?.description ?? null,
					iconUrl: project?.iconUrl ?? null,
					version: version.versionNumber,
					gameVersions: [...version.gameVersions],
					loaders: [...version.loaders],
					dependencies: version.dependencies.map((dependency) => ({
						projectId: dependency.projectId,
						kind: dependency.kind,
					})),
					latestVersionId: version.id,
					latestVersionName: version.versionNumber,
					artworkChecked: true,
				})
				installed.push(version.fileName)
			} catch (error) {
				problems.push(
					`${version.name}: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		}

		this.events.emit("instances:changed", { instanceId })
		return { installed, skipped: [...plan.alreadySatisfied], problems }
	}

	private async record(instanceId: string, record: ContentRecord): Promise<void> {
		await this.index(instanceId).update((current) => ({
			records: [
				...current.records.filter(
					(candidate) => baseName(candidate.fileName) !== baseName(record.fileName),
				),
				record,
			],
		}))
	}

	private async installedContent(instanceId: string): Promise<readonly InstalledContent[]> {
		const { records } = await this.index(instanceId).read()
		return records.map((record) => ({
			projectId: record.projectId ?? undefined,
			versionId: record.versionId ?? undefined,
			fileName: record.fileName,
			enabled: !record.fileName.endsWith(DISABLED_SUFFIX),
		}))
	}

	async checkUpdates(instanceId: string, kind: ContentKind): Promise<readonly ContentEntry[]> {
		const config = await this.instances.config(instanceId)
		const { records } = await this.index(instanceId).read()

		for (const record of records) {
			if (record.projectId === null || record.kind !== kind) {
				continue
			}
			const latest = await this.modrinth.getLatestVersion(record.projectId, {
				gameVersion: config.gameVersion,
				loader: config.loader,
			})
			if (latest === undefined) {
				continue
			}
			await this.record(instanceId, {
				...record,
				latestVersionId: latest.versionId,
				latestVersionName: latest.name,
			})
		}

		return this.list(instanceId, kind)
	}

	async applyUpdates(
		instanceId: string,
		kind: ContentKind,
		fileNames: readonly string[],
	): Promise<InstallOutcome> {
		const { records } = await this.index(instanceId).read()
		const installed: string[] = []
		const problems: string[] = []

		const targets = records.filter(
			(record) =>
				record.kind === kind &&
				record.latestVersionId !== null &&
				record.latestVersionId !== record.versionId &&
				(fileNames.length === 0 ||
					fileNames.some((fileName) => baseName(fileName) === baseName(record.fileName))),
		)

		for (const record of targets) {
			const latestVersionId = record.latestVersionId
			if (latestVersionId === null) {
				continue
			}
			const outcome = await this.installFromModrinth(instanceId, kind, latestVersionId, false)
			if (outcome.installed.length > 0) {
				await this.remove(instanceId, kind, [record.fileName])
				installed.push(...outcome.installed)
			}
			problems.push(...outcome.problems)
		}

		return { installed, skipped: [], problems }
	}

	async analyze(instanceId: string): Promise<ModAnalysis> {
		const config = await this.instances.config(instanceId)
		const entries = await this.list(instanceId, "mod")
		const { records } = await this.index(instanceId).read()
		const issues: ModIssue[] = []

		for (const group of findDuplicateProjects(await this.installedContent(instanceId))) {
			issues.push({
				kind: "duplicate",
				message: `Two files provide the same project (${group.projectId})`,
				fileNames: group.files,
				projectId: group.projectId,
			})
		}

		const presentProjects = new Set(
			records.map((record) => record.projectId).filter((id): id is string => id !== null),
		)

		for (const record of records) {
			for (const dependency of record.dependencies) {
				if (dependency.kind !== "required" || dependency.projectId === null) {
					continue
				}
				if (!presentProjects.has(dependency.projectId)) {
					issues.push({
						kind: "missing-dependency",
						message: `${record.displayName ?? record.fileName} requires ${dependency.projectId}`,
						fileNames: [record.fileName],
						projectId: dependency.projectId,
					})
				}
			}

			if (
				record.gameVersions.length > 0 &&
				!record.gameVersions.includes(config.gameVersion)
			) {
				issues.push({
					kind: "wrong-game-version",
					message: `${record.displayName ?? record.fileName} does not list Minecraft ${config.gameVersion}`,
					fileNames: [record.fileName],
					projectId: record.projectId,
				})
			}

			if (
				record.loaders.length > 0 &&
				config.loader !== "vanilla" &&
				!record.loaders.includes(config.loader) &&
				!(config.loader === "quilt" && record.loaders.includes("fabric"))
			) {
				issues.push({
					kind: "incompatible",
					message: `${record.displayName ?? record.fileName} targets ${record.loaders.join(", ")}`,
					fileNames: [record.fileName],
					projectId: record.projectId,
				})
			}
		}

		return {
			issues,
			totalMods: entries.length,
			enabledMods: entries.filter((entry) => entry.enabled).length,
		}
	}

	async installedProjectIds(instanceId: string): Promise<readonly string[]> {
		const { records } = await this.index(instanceId).read()
		return records.map((record) => record.projectId).filter((id): id is string => id !== null)
	}
}
