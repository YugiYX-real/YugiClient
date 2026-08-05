import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { unzipSync } from "fflate"
import {
	compareReleaseVersions,
	parseSnapshotVersion,
	requiredJavaRuntime,
	resolveLibraries,
	resolveVersion,
} from "@halcyon/core"
import type { HostPlatform, VersionJson } from "@halcyon/core"
import type { VerificationReport, VersionChannel, VersionEntry, VersionFilter } from "@halcyon/ipc"
import type { AppPaths } from "../infra/paths.ts"
import type { HttpClient } from "../infra/http.ts"
import { sha1OfFile } from "../infra/http.ts"
import type { JsonStore } from "../infra/json-store.ts"
import type { Logger } from "../infra/logger.ts"
import { pathExists, removePath } from "../infra/fs-extra.ts"
import type { DownloadRequest, DownloadService } from "./download-service.ts"

export const VERSION_MANIFEST_URL =
	"https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"

export const RESOURCES_BASE_URL = "https://resources.download.minecraft.net"

export type ManifestVersion = {
	readonly id: string
	readonly type: string
	readonly url: string
	readonly releaseTime: string
	readonly sha1?: string
}

type RemoteManifest = {
	readonly latest: { readonly release: string; readonly snapshot: string }
	readonly versions: readonly ManifestVersion[]
}

export type VersionMetaState = {
	favorites: string[]
	cachedAt: string | null
	latestRelease: string | null
	latestSnapshot: string | null
	manifest: ManifestVersion[]
}

export const DEFAULT_VERSION_META: VersionMetaState = {
	favorites: [],
	cachedAt: null,
	latestRelease: null,
	latestSnapshot: null,
	manifest: [],
}

type AssetIndexFile = {
	readonly objects: Readonly<Record<string, { readonly hash: string; readonly size: number }>>
	readonly virtual?: boolean
	readonly map_to_resources?: boolean
}

type ArtifactLike = { url?: string; sha1?: string; size?: number; path?: string }

const MANIFEST_TTL_MS = 6 * 60 * 60 * 1000

function channelOf(type: string): VersionChannel {
	switch (type) {
		case "snapshot":
			return "snapshot"
		case "old_beta":
			return "old_beta"
		case "old_alpha":
			return "old_alpha"
		default:
			return "release"
	}
}

function clientArtifact(version: VersionJson): ArtifactLike | undefined {
	const raw = version as unknown as { downloads?: { client?: ArtifactLike } }
	return raw.downloads?.client
}

function loggingArtifact(version: VersionJson): (ArtifactLike & { id?: string }) | undefined {
	const raw = version as unknown as {
		logging?: { client?: { file?: ArtifactLike & { id?: string } } }
	}
	return raw.logging?.client?.file
}

export type InstallProgress = (detail: string, fraction: number) => void

export class VersionService {
	private readonly http: HttpClient
	private readonly paths: AppPaths
	private readonly logger: Logger
	private readonly downloads: DownloadService
	private readonly store: JsonStore<VersionMetaState>
	private readonly platform: HostPlatform

	constructor(dependencies: {
		http: HttpClient
		paths: AppPaths
		logger: Logger
		downloads: DownloadService
		store: JsonStore<VersionMetaState>
		platform: HostPlatform
	}) {
		this.http = dependencies.http
		this.paths = dependencies.paths
		this.logger = dependencies.logger
		this.downloads = dependencies.downloads
		this.store = dependencies.store
		this.platform = dependencies.platform
	}

	async manifest(force = false): Promise<readonly ManifestVersion[]> {
		const state = await this.store.read()
		const age =
			state.cachedAt === null ? Number.POSITIVE_INFINITY : Date.now() - Date.parse(state.cachedAt)

		if (!force && state.manifest.length > 0 && age < MANIFEST_TTL_MS) {
			return state.manifest
		}

		try {
			const remote = await this.http.json<RemoteManifest>(VERSION_MANIFEST_URL)
			const manifest = remote.versions.map((entry) => ({
				id: entry.id,
				type: entry.type,
				url: entry.url,
				releaseTime: entry.releaseTime,
				sha1: entry.sha1,
			}))
			await this.store.update((current) => ({
				...current,
				manifest,
				cachedAt: new Date().toISOString(),
				latestRelease: remote.latest.release,
				latestSnapshot: remote.latest.snapshot,
			}))
			return manifest
		} catch (error) {
			this.logger.warn("Falling back to the cached version manifest", error)
			return state.manifest
		}
	}

	async installedVersionIds(): Promise<readonly string[]> {
		try {
			const entries = await readdir(this.paths.versions, { withFileTypes: true })
			const installed: string[] = []
			for (const entry of entries) {
				if (!entry.isDirectory()) {
					continue
				}
				if (await pathExists(join(this.paths.versions, entry.name, `${entry.name}.json`))) {
					installed.push(entry.name)
				}
			}
			return installed
		} catch {
			return []
		}
	}

	async list(filter: VersionFilter = {}): Promise<readonly VersionEntry[]> {
		const [manifest, installed, state] = await Promise.all([
			this.manifest(),
			this.installedVersionIds(),
			this.store.read(),
		])

		const installedSet = new Set(installed)
		const favourites = new Set(state.favorites)
		const known = new Map<string, VersionEntry>()

		for (const entry of manifest) {
			known.set(entry.id, {
				id: entry.id,
				channel: channelOf(entry.type),
				releaseTime: entry.releaseTime,
				installed: installedSet.has(entry.id),
				favorite: favourites.has(entry.id),
				requiredJavaMajor: requiredJavaRuntime(entry.id).major,
				sizeBytes: null,
			})
		}

		for (const id of installed) {
			if (!known.has(id)) {
				known.set(id, {
					id,
					channel: "release",
					releaseTime: new Date(0).toISOString(),
					installed: true,
					favorite: favourites.has(id),
					requiredJavaMajor: requiredJavaRuntime(id).major,
					sizeBytes: null,
				})
			}
		}

		const search = filter.search?.trim().toLowerCase() ?? ""
		const channels = filter.channels

		return [...known.values()]
			.filter((entry) => (channels === undefined ? true : channels.includes(entry.channel)))
			.filter((entry) => (filter.installedOnly === true ? entry.installed : true))
			.filter((entry) => (filter.favoritesOnly === true ? entry.favorite : true))
			.filter((entry) => (search === "" ? true : entry.id.toLowerCase().includes(search)))
			.sort((left, right) => Date.parse(right.releaseTime) - Date.parse(left.releaseTime))
	}

	async setFavorite(versionId: string, favorite: boolean): Promise<void> {
		await this.store.update((current) => ({
			...current,
			favorites: favorite
				? [...new Set([...current.favorites, versionId])]
				: current.favorites.filter((id) => id !== versionId),
		}))
	}

	async remove(versionId: string): Promise<void> {
		await removePath(join(this.paths.versions, versionId))
		this.logger.info(`Removed version ${versionId}`)
	}

	versionJsonPath(versionId: string): string {
		return join(this.paths.versions, versionId, `${versionId}.json`)
	}

	versionJarPath(versionId: string): string {
		return join(this.paths.versions, versionId, `${versionId}.jar`)
	}

	async writeVersionJson(versionId: string, version: VersionJson): Promise<void> {
		const target = this.versionJsonPath(versionId)
		await mkdir(join(target, ".."), { recursive: true })
		await writeFile(target, `${JSON.stringify(version, null, "\t")}\n`, "utf8")
	}

	private async readVersionJson(versionId: string): Promise<VersionJson | undefined> {
		try {
			const content = await readFile(this.versionJsonPath(versionId), "utf8")
			return JSON.parse(content) as VersionJson
		} catch {
			return undefined
		}
	}

	async ensureVersionJson(versionId: string): Promise<VersionJson> {
		const local = await this.readVersionJson(versionId)
		if (local !== undefined) {
			return local
		}

		const manifest = await this.manifest()
		const entry = manifest.find((candidate) => candidate.id === versionId)
		if (entry === undefined) {
			throw new Error(`Unknown Minecraft version "${versionId}"`)
		}

		const version = await this.http.json<VersionJson>(entry.url)
		await this.writeVersionJson(versionId, version)
		return version
	}

	async resolve(versionId: string): Promise<VersionJson> {
		const catalogue = new Map<string, VersionJson>()
		let currentId: string | undefined = versionId

		while (currentId !== undefined && !catalogue.has(currentId)) {
			const version = await this.ensureVersionJson(currentId)
			catalogue.set(currentId, version)
			currentId = version.inheritsFrom
		}

		return resolveVersion(versionId, (id) => catalogue.get(id))
	}

	private assetObjectPath(hash: string): string {
		return join(this.paths.assetObjects, hash.slice(0, 2), hash)
	}

	private async assetIndex(version: VersionJson): Promise<AssetIndexFile | undefined> {
		const reference = version.assetIndex
		if (reference === undefined) {
			return undefined
		}
		const indexPath = join(this.paths.assetIndexes, `${reference.id}.json`)
		if (!(await pathExists(indexPath))) {
			await this.http.download(reference.url, indexPath, {
				sha1: reference.sha1 ?? null,
				expectedSize: reference.size ?? null,
			})
		}
		try {
			return JSON.parse(await readFile(indexPath, "utf8")) as AssetIndexFile
		} catch {
			return undefined
		}
	}

	async plannedDownloads(version: VersionJson): Promise<readonly DownloadRequest[]> {
		const requests: DownloadRequest[] = []

		const client = clientArtifact(version)
		if (client?.url !== undefined) {
			requests.push({
				id: `client:${version.id}`,
				label: `${version.id} client`,
				url: client.url,
				destination: this.versionJarPath(version.id),
				sha1: client.sha1 ?? null,
				totalBytes: client.size ?? null,
			})
		}

		for (const entry of resolveLibraries(version.libraries, this.platform)) {
			if (entry.url === undefined) {
				continue
			}
			requests.push({
				id: `library:${entry.relativePath}`,
				label: entry.library.name,
				url: entry.url,
				destination: join(this.paths.libraries, ...entry.relativePath.split("/")),
				sha1: entry.sha1 ?? null,
				totalBytes: entry.size ?? null,
			})
		}

		const logging = loggingArtifact(version)
		if (logging?.url !== undefined) {
			requests.push({
				id: `logging:${logging.id ?? version.id}`,
				label: "Log configuration",
				url: logging.url,
				destination: join(this.paths.assets, "log_configs", logging.id ?? "client.xml"),
				sha1: logging.sha1 ?? null,
				totalBytes: logging.size ?? null,
			})
		}

		const index = await this.assetIndex(version)
		if (index !== undefined) {
			for (const [name, object] of Object.entries(index.objects)) {
				requests.push({
					id: `asset:${object.hash}`,
					label: name,
					url: `${RESOURCES_BASE_URL}/${object.hash.slice(0, 2)}/${object.hash}`,
					destination: this.assetObjectPath(object.hash),
					sha1: object.hash,
					totalBytes: object.size,
				})
			}
		}

		return requests
	}

	async install(versionId: string, onProgress?: InstallProgress): Promise<VerificationReport> {
		const startedAt = Date.now()
		onProgress?.(`Resolving ${versionId}`, 0.05)
		const version = await this.resolve(versionId)
		await this.writeVersionJson(versionId, await this.ensureVersionJson(versionId))

		onProgress?.("Collecting files", 0.1)
		const requests = await this.plannedDownloads(version)

		onProgress?.(`Downloading ${requests.length} files`, 0.2)
		const outcome = await this.downloads.run(requests, `install:${versionId}`)

		onProgress?.("Finishing installation", 0.95)
		this.logger.info(
			`Installed ${versionId} with ${outcome.completed} downloads and ${outcome.failed.length} failures`,
		)

		return {
			checked: requests.length,
			repaired: outcome.completed,
			missing: outcome.failed,
			corrupt: [],
			durationMs: Date.now() - startedAt,
		}
	}

	async verify(versionId: string, repair: boolean): Promise<VerificationReport> {
		const startedAt = Date.now()
		const version = await this.resolve(versionId)
		const requests = await this.plannedDownloads(version)

		const missing: string[] = []
		const corrupt: string[] = []
		const broken: DownloadRequest[] = []

		for (const request of requests) {
			if (!(await pathExists(request.destination))) {
				missing.push(request.label)
				broken.push(request)
				continue
			}
			if (request.sha1 === null || request.sha1 === undefined) {
				continue
			}
			const digest = await sha1OfFile(request.destination)
			if (digest !== request.sha1) {
				corrupt.push(request.label)
				broken.push(request)
			}
		}

		let repaired = 0
		if (repair && broken.length > 0) {
			const outcome = await this.downloads.run(broken, `repair:${versionId}`)
			repaired = outcome.completed
		}

		return {
			checked: requests.length,
			repaired,
			missing,
			corrupt,
			durationMs: Date.now() - startedAt,
		}
	}

	async extractNatives(version: VersionJson, nativesDirectory: string): Promise<void> {
		await mkdir(nativesDirectory, { recursive: true })
		const entries = resolveLibraries(version.libraries, this.platform).filter(
			(entry) => entry.native,
		)

		for (const entry of entries) {
			const archivePath = join(this.paths.libraries, ...entry.relativePath.split("/"))
			if (!(await pathExists(archivePath))) {
				continue
			}
			const exclusions = entry.extractExclusions ?? []
			try {
				const archive = new Uint8Array(await readFile(archivePath))
				const files = unzipSync(archive)
				for (const [name, content] of Object.entries(files)) {
					if (name.endsWith("/") || name.includes("..")) {
						continue
					}
					if (exclusions.some((exclusion) => name.startsWith(exclusion))) {
						continue
					}
					const target = join(nativesDirectory, ...name.split("/"))
					await mkdir(join(target, ".."), { recursive: true })
					await writeFile(target, content)
				}
			} catch (error) {
				this.logger.warn(`Could not extract natives from ${entry.library.name}`, error)
			}
		}
	}

	async materialiseLegacyAssets(version: VersionJson, gameDirectory: string): Promise<string | undefined> {
		const index = await this.assetIndex(version)
		if (index === undefined) {
			return undefined
		}
		if (index.virtual !== true && index.map_to_resources !== true) {
			return undefined
		}

		const target =
			index.map_to_resources === true
				? join(gameDirectory, "resources")
				: join(this.paths.assets, "virtual", version.assetIndex?.id ?? "legacy")

		for (const [name, object] of Object.entries(index.objects)) {
			const source = this.assetObjectPath(object.hash)
			if (!(await pathExists(source))) {
				continue
			}
			const destination = join(target, ...name.split("/"))
			if (await pathExists(destination)) {
				const info = await stat(destination)
				if (info.size === object.size) {
					continue
				}
			}
			await mkdir(join(destination, ".."), { recursive: true })
			await copyFile(source, destination)
		}

		return target
	}

	async latestReleaseId(): Promise<string | undefined> {
		const state = await this.store.read()
		if (state.latestRelease !== null) {
			return state.latestRelease
		}
		const manifest = await this.manifest()
		return manifest.find((entry) => entry.type === "release")?.id
	}

	async isReleaseAtLeast(versionId: string, threshold: string): Promise<boolean> {
		const comparison = compareReleaseVersions(versionId, threshold)
		if (comparison !== undefined) {
			return comparison >= 0
		}
		return parseSnapshotVersion(versionId) !== undefined
	}
}
