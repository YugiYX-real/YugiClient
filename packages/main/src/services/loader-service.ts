import { execFile } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
import { unzipSync } from "fflate"
import {
	compareSemver,
	mavenRelativePath,
	parseMavenCoordinate,
	resolveLibraries,
} from "@halcyon/core"
import type { HostPlatform, Library, VersionJson } from "@halcyon/core"
import type { LoaderId, LoaderVersion } from "@halcyon/ipc"
import { pathExists } from "../infra/fs-extra.ts"
import type { AppPaths } from "../infra/paths.ts"
import type { HttpClient } from "../infra/http.ts"
import type { Logger } from "../infra/logger.ts"
import { javaExecutableName } from "../infra/platform.ts"
import type { DownloadRequest, DownloadService } from "./download-service.ts"
import type { InstallProgress, VersionService } from "./version-service.ts"

const run = promisify(execFile)

export const FABRIC_META = "https://meta.fabricmc.net/v2"
export const QUILT_META = "https://meta.quiltmc.org/v3"
export const FORGE_MAVEN = "https://maven.minecraftforge.net"
export const NEOFORGE_MAVEN = "https://maven.neoforged.net/releases"
export const FORGE_PROMOTIONS =
	"https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json"

type FabricLoaderEntry = {
	readonly loader: { readonly version: string; readonly stable: boolean }
}

type ForgePromotions = { readonly promos: Readonly<Record<string, string>> }

type InstallProfileArtifact = {
	readonly path?: string
	readonly url?: string
	readonly sha1?: string
	readonly size?: number
}

type InstallProfileLibrary = Library & {
	readonly downloads?: { readonly artifact?: InstallProfileArtifact }
}

type InstallProcessor = {
	readonly sides?: readonly string[]
	readonly jar: string
	readonly classpath: readonly string[]
	readonly args: readonly string[]
	readonly outputs?: Readonly<Record<string, string>>
}

type InstallProfile = {
	readonly version?: string
	readonly json?: string
	readonly minecraft?: string
	readonly data?: Readonly<Record<string, { readonly client: string; readonly server: string }>>
	readonly processors?: readonly InstallProcessor[]
	readonly libraries?: readonly InstallProfileLibrary[]
}

function parseMavenMetadata(xml: string): readonly string[] {
	const versions: string[] = []
	const pattern = /<version>([^<]+)<\/version>/g
	let match = pattern.exec(xml)
	while (match !== null) {
		const value = match[1]
		if (value !== undefined) {
			versions.push(value.trim())
		}
		match = pattern.exec(xml)
	}
	return versions
}

function neoforgeGameVersion(loaderVersion: string): string {
	const parts = loaderVersion.split(".")
	const minor = parts[0]
	const patch = parts[1]
	if (minor === undefined || patch === undefined) {
		return loaderVersion
	}
	return patch === "0" ? `1.${minor}` : `1.${minor}.${patch}`
}

function manifestMainClass(manifest: string): string | undefined {
	const normalised = manifest.replaceAll("\r\n ", "").replaceAll("\n ", "")
	const match = /Main-Class:\s*(\S+)/.exec(normalised)
	return match?.[1]
}

export class LoaderService {
	private readonly http: HttpClient
	private readonly paths: AppPaths
	private readonly logger: Logger
	private readonly downloads: DownloadService
	private readonly versions: VersionService
	private readonly platform: HostPlatform

	constructor(dependencies: {
		http: HttpClient
		paths: AppPaths
		logger: Logger
		downloads: DownloadService
		versions: VersionService
		platform: HostPlatform
	}) {
		this.http = dependencies.http
		this.paths = dependencies.paths
		this.logger = dependencies.logger
		this.downloads = dependencies.downloads
		this.versions = dependencies.versions
		this.platform = dependencies.platform
	}

	async list(loader: LoaderId, gameVersion: string): Promise<readonly LoaderVersion[]> {
		switch (loader) {
			case "vanilla":
				return []
			case "fabric":
				return this.listFabricLike(FABRIC_META, gameVersion)
			case "quilt":
				return this.listFabricLike(QUILT_META, gameVersion)
			case "forge":
				return this.listForge(gameVersion)
			case "neoforge":
				return this.listNeoForge(gameVersion)
		}
	}

	async install(
		loader: LoaderId,
		gameVersion: string,
		loaderVersion: string | null,
		onProgress?: InstallProgress,
	): Promise<string> {
		if (loader === "vanilla") {
			return gameVersion
		}

		const resolved = loaderVersion ?? (await this.bestVersion(loader, gameVersion))
		if (resolved === undefined) {
			throw new Error(`No ${loader} build is available for Minecraft ${gameVersion}`)
		}

		if (loader === "fabric") {
			return this.installFabricLike(FABRIC_META, gameVersion, resolved, onProgress)
		}
		if (loader === "quilt") {
			return this.installFabricLike(QUILT_META, gameVersion, resolved, onProgress)
		}
		return this.installForgeLike(loader, gameVersion, resolved, onProgress)
	}

	async bestVersion(loader: LoaderId, gameVersion: string): Promise<string | undefined> {
		const available = await this.list(loader, gameVersion)
		return (
			available.find((entry) => entry.recommended)?.id ??
			available.find((entry) => entry.stable)?.id ??
			available[0]?.id
		)
	}

	private async listFabricLike(
		baseUrl: string,
		gameVersion: string,
	): Promise<readonly LoaderVersion[]> {
		try {
			const entries = await this.http.json<readonly FabricLoaderEntry[]>(
				`${baseUrl}/versions/loader/${encodeURIComponent(gameVersion)}`,
			)
			return entries.map((entry, index) => ({
				id: entry.loader.version,
				gameVersion,
				stable: entry.loader.stable,
				recommended: index === 0,
			}))
		} catch (error) {
			this.logger.warn(`Could not list loader builds for ${gameVersion}`, error)
			return []
		}
	}

	private async listForge(gameVersion: string): Promise<readonly LoaderVersion[]> {
		try {
			const [metadata, promotions] = await Promise.all([
				this.http.text(`${FORGE_MAVEN}/net/minecraftforge/forge/maven-metadata.xml`),
				this.http
					.json<ForgePromotions>(FORGE_PROMOTIONS)
					.catch(() => ({ promos: {} }) as ForgePromotions),
			])

			const recommended = promotions.promos[`${gameVersion}-recommended`]
			const latest = promotions.promos[`${gameVersion}-latest`]

			return parseMavenMetadata(metadata)
				.filter((version) => version.startsWith(`${gameVersion}-`))
				.map((version) => {
					const build = version.slice(gameVersion.length + 1)
					return {
						id: version,
						gameVersion,
						stable: recommended !== undefined && build.startsWith(recommended),
						recommended:
							(recommended !== undefined && build.startsWith(recommended)) ||
							(recommended === undefined &&
								latest !== undefined &&
								build.startsWith(latest)),
					}
				})
				.sort((left, right) => compareSemver(right.id, left.id))
		} catch (error) {
			this.logger.warn(`Could not list Forge builds for ${gameVersion}`, error)
			return []
		}
	}

	private async listNeoForge(gameVersion: string): Promise<readonly LoaderVersion[]> {
		try {
			const metadata = await this.http.text(
				`${NEOFORGE_MAVEN}/net/neoforged/neoforge/maven-metadata.xml`,
			)
			const matching = parseMavenMetadata(metadata).filter(
				(version) => neoforgeGameVersion(version) === gameVersion,
			)
			const sorted = [...matching].sort((left, right) => compareSemver(right, left))
			return sorted.map((version, index) => ({
				id: version,
				gameVersion,
				stable: !version.includes("beta"),
				recommended: index === 0,
			}))
		} catch (error) {
			this.logger.warn(`Could not list NeoForge builds for ${gameVersion}`, error)
			return []
		}
	}

	private async installFabricLike(
		baseUrl: string,
		gameVersion: string,
		loaderVersion: string,
		onProgress?: InstallProgress,
	): Promise<string> {
		onProgress?.(`Fetching loader profile ${loaderVersion}`, 0.1)
		const profile = await this.http.json<VersionJson>(
			`${baseUrl}/versions/loader/${encodeURIComponent(gameVersion)}/${encodeURIComponent(
				loaderVersion,
			)}/profile/json`,
		)

		await this.versions.writeVersionJson(profile.id, profile)
		onProgress?.(`Installing Minecraft ${gameVersion}`, 0.3)
		await this.versions.install(profile.id, (detail, fraction) => {
			onProgress?.(detail, 0.3 + fraction * 0.7)
		})
		return profile.id
	}

	private installerUrl(loader: LoaderId, loaderVersion: string): string {
		if (loader === "neoforge") {
			return `${NEOFORGE_MAVEN}/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`
		}
		return `${FORGE_MAVEN}/net/minecraftforge/forge/${loaderVersion}/forge-${loaderVersion}-installer.jar`
	}

	private libraryPath(coordinate: string): string {
		return join(
			this.paths.libraries,
			...mavenRelativePath(parseMavenCoordinate(coordinate)).split("/"),
		)
	}

	private async installForgeLike(
		loader: LoaderId,
		gameVersion: string,
		loaderVersion: string,
		onProgress?: InstallProgress,
	): Promise<string> {
		onProgress?.(`Downloading the ${loader} installer`, 0.05)
		const installerPath = join(this.paths.cache, `${loader}-${loaderVersion}-installer.jar`)
		await this.http.download(this.installerUrl(loader, loaderVersion), installerPath, {
			skipIfValid: false,
		})

		const archive = unzipSync(new Uint8Array(await readFile(installerPath)))
		const decoder = new TextDecoder()

		const profileEntry = archive["install_profile.json"]
		const versionEntry = archive["version.json"]
		if (profileEntry === undefined || versionEntry === undefined) {
			throw new Error(`The ${loader} installer is missing its metadata`)
		}

		const profile = JSON.parse(decoder.decode(profileEntry)) as InstallProfile
		const version = JSON.parse(decoder.decode(versionEntry)) as VersionJson

		onProgress?.(`Installing Minecraft ${gameVersion}`, 0.15)
		await this.versions.install(gameVersion, (detail, fraction) => {
			onProgress?.(detail, 0.15 + fraction * 0.4)
		})

		await this.versions.writeVersionJson(version.id, version)

		onProgress?.("Downloading loader libraries", 0.6)
		await this.installLibraries(profile.libraries ?? [], archive, `${loader}:${loaderVersion}`)
		await this.versions.install(version.id, (detail, fraction) => {
			onProgress?.(detail, 0.6 + fraction * 0.2)
		})

		onProgress?.("Running installer processors", 0.85)
		await this.runProcessors(profile, archive, gameVersion, installerPath)

		onProgress?.(`${loader} ${loaderVersion} ready`, 1)
		return version.id
	}

	private async installLibraries(
		libraries: readonly InstallProfileLibrary[],
		archive: Readonly<Record<string, Uint8Array>>,
		group: string,
	): Promise<void> {
		const requests: DownloadRequest[] = []

		for (const library of libraries) {
			const artifact = library.downloads?.artifact
			const relativePath =
				artifact?.path ?? mavenRelativePath(parseMavenCoordinate(library.name))
			const destination = join(this.paths.libraries, ...relativePath.split("/"))

			if (artifact?.url === undefined || artifact.url === "") {
				const bundled = archive[`maven/${relativePath}`]
				if (bundled !== undefined) {
					await mkdir(join(destination, ".."), { recursive: true })
					await writeFile(destination, bundled)
				}
				continue
			}

			requests.push({
				id: `library:${relativePath}`,
				label: library.name,
				url: artifact.url,
				destination,
				sha1: artifact.sha1 ?? null,
				totalBytes: artifact.size ?? null,
			})
		}

		if (requests.length > 0) {
			await this.downloads.run(requests, group)
		}
	}

	private async resolveDataValues(
		profile: InstallProfile,
		archive: Readonly<Record<string, Uint8Array>>,
		gameVersion: string,
		installerPath: string,
	): Promise<Map<string, string>> {
		const values = new Map<string, string>()
		const extractionRoot = join(this.paths.cache, "installer-data", gameVersion)

		for (const [key, entry] of Object.entries(profile.data ?? {})) {
			const raw = entry.client
			if (raw.startsWith("[") && raw.endsWith("]")) {
				values.set(key, this.libraryPath(raw.slice(1, -1)))
				continue
			}
			if (raw.startsWith("'") && raw.endsWith("'")) {
				values.set(key, raw.slice(1, -1))
				continue
			}
			if (raw.startsWith("/")) {
				const name = raw.slice(1)
				const content = archive[name]
				const destination = join(extractionRoot, ...name.split("/"))
				if (content !== undefined) {
					await mkdir(join(destination, ".."), { recursive: true })
					await writeFile(destination, content)
				}
				values.set(key, destination)
				continue
			}
			values.set(key, raw)
		}

		values.set("SIDE", "client")
		values.set("MINECRAFT_JAR", this.versions.versionJarPath(gameVersion))
		values.set("MINECRAFT_VERSION", gameVersion)
		values.set("ROOT", this.paths.root)
		values.set("LIBRARY_DIR", this.paths.libraries)
		values.set("INSTALLER", installerPath)

		return values
	}

	private substitute(argument: string, values: ReadonlyMap<string, string>): string {
		if (argument.startsWith("[") && argument.endsWith("]")) {
			return this.libraryPath(argument.slice(1, -1))
		}
		return argument.replace(
			/\{([A-Z0-9_]+)\}/g,
			(match, key: string) => values.get(key) ?? match,
		)
	}

	private async mainClassOf(jarPath: string): Promise<string> {
		const archive = unzipSync(new Uint8Array(await readFile(jarPath)), {
			filter: (file) => file.name === "META-INF/MANIFEST.MF",
		})
		const manifest = archive["META-INF/MANIFEST.MF"]
		if (manifest === undefined) {
			throw new Error(`No manifest found in ${jarPath}`)
		}
		const mainClass = manifestMainClass(new TextDecoder().decode(manifest))
		if (mainClass === undefined) {
			throw new Error(`No Main-Class declared in ${jarPath}`)
		}
		return mainClass
	}

	private async runProcessors(
		profile: InstallProfile,
		archive: Readonly<Record<string, Uint8Array>>,
		gameVersion: string,
		installerPath: string,
	): Promise<void> {
		const processors = (profile.processors ?? []).filter(
			(processor) => processor.sides === undefined || processor.sides.includes("client"),
		)
		if (processors.length === 0) {
			return
		}

		const values = await this.resolveDataValues(profile, archive, gameVersion, installerPath)
		const separator = this.platform.os === "windows" ? ";" : ":"

		for (const [index, processor] of processors.entries()) {
			const jarPath = this.libraryPath(processor.jar)
			if (!(await pathExists(jarPath))) {
				throw new Error(`Processor library missing: ${processor.jar}`)
			}

			const classpath = [
				...processor.classpath.map((coordinate) => this.libraryPath(coordinate)),
				jarPath,
			].join(separator)

			const mainClass = await this.mainClassOf(jarPath)
			const args = processor.args.map((argument) => this.substitute(argument, values))

			this.logger.info(
				`Running installer processor ${index + 1}/${processors.length}: ${mainClass}`,
			)
			await run(javaExecutableName(), ["-cp", classpath, mainClass, ...args], {
				maxBuffer: 32 * 1024 * 1024,
				windowsHide: true,
			})
		}
	}

	async loaderLibraries(version: VersionJson): Promise<readonly string[]> {
		return resolveLibraries(version.libraries, this.platform).map((entry) => entry.relativePath)
	}
}
