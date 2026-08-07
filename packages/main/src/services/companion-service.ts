import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises"
import { join } from "node:path"
import { pathExists } from "../infra/fs-extra.ts"
import type { HttpClient } from "../infra/http.ts"
import type { Logger } from "../infra/logger.ts"
import type { InstanceService } from "./instance-service.ts"

const MODRINTH_API = "https://api.modrinth.com/v2"
const FABRIC_API_PROJECT = "fabric-api"
const COMPANION_FILE_NAME = "halcyon-companion.jar"
const COMPANION_PREFIX = "halcyon-companion"

/**
 * The companion mod is compiled against one set of Yarn mappings, and a mixin
 * that misses its target takes the whole game down before the window opens.
 * Only versions the mod was actually built and tested against are listed here;
 * everything else launches untouched. The current jar is built against the
 * 1.21.11 mappings, so older 1.21 builds are deliberately excluded.
 */
const SUPPORTED_GAME_VERSIONS: readonly string[] = ["1.21.11"]

export type CompanionTarget = {
	readonly id: string
	readonly name: string
	readonly loader: string
	readonly gameVersion: string
}

export type CompanionOutcome = {
	readonly installed: boolean
	readonly detail: string
}

type RawFabricFile = {
	readonly filename: string
	readonly url: string
	readonly size: number
	readonly primary: boolean
	readonly hashes?: { readonly sha1?: string }
}

type RawFabricVersion = {
	readonly version_number: string
	readonly files: readonly RawFabricFile[]
}

/**
 * Keeps the in game companion mod in step with the launcher.
 *
 * Every launch of a supported instance refreshes the bundled jar, which is what
 * lets instances that already exist pick up a new build without the player
 * having to reinstall anything by hand. The mod needs Fabric API, so that is
 * fetched from Modrinth the first time an instance is prepared.
 */
export class CompanionService {
	private readonly instances: InstanceService
	private readonly http: HttpClient
	private readonly logger: Logger
	private cachedJar: string | null | undefined

	constructor(dependencies: { instances: InstanceService; http: HttpClient; logger: Logger }) {
		this.instances = dependencies.instances
		this.http = dependencies.http
		this.logger = dependencies.logger
	}

	supports(target: CompanionTarget): boolean {
		return target.loader === "fabric" && SUPPORTED_GAME_VERSIONS.includes(target.gameVersion)
	}

	/**
	 * Runs for every launch, including unsupported instances, because an
	 * instance that was moved to a newer game version must lose the mod again
	 * rather than crash on a mixin that no longer matches.
	 */
	async ensure(target: CompanionTarget): Promise<CompanionOutcome> {
		const modsDirectory = join(this.instances.gameDirectory(target.id), "mods")

		if (!this.supports(target)) {
			const removed = await this.removeCompanionJars(modsDirectory, null)
			const suffix = removed ? ", so the installed copy was removed" : ""
			return {
				installed: false,
				detail:
					"The in game companion supports Fabric " +
					SUPPORTED_GAME_VERSIONS.join(" and ") +
					" but " +
					target.name +
					" runs " +
					target.loader +
					" " +
					target.gameVersion +
					suffix,
			}
		}

		const source = await this.locateBundledJar()
		if (source === null) {
			return {
				installed: false,
				detail: "This build does not carry the companion mod, so nothing was installed",
			}
		}

		await mkdir(modsDirectory, { recursive: true })

		if (await pathExists(join(modsDirectory, COMPANION_FILE_NAME + ".disabled"))) {
			return {
				installed: false,
				detail: "The companion mod is switched off for " + target.name,
			}
		}

		await this.removeCompanionJars(modsDirectory, COMPANION_FILE_NAME)
		const refreshed = await this.copyWhenChanged(source, join(modsDirectory, COMPANION_FILE_NAME))

		let api = ""
		try {
			api = (await this.ensureFabricApi(modsDirectory, target.gameVersion))
				? " and installed Fabric API"
				: ""
		} catch (error) {
			this.logger.warn("Fabric API could not be installed for " + target.name, error)
			api = " but Fabric API is missing, so the mod may not load"
		}

		const verb = refreshed ? "Installed" : "Confirmed"
		return {
			installed: true,
			detail: verb + " the Halcyon companion mod in " + target.name + api,
		}
	}

	private async copyWhenChanged(source: string, destination: string): Promise<boolean> {
		try {
			const current = await stat(source)
			const installed = await stat(destination)
			if (current.size === installed.size && current.mtimeMs <= installed.mtimeMs) {
				return false
			}
		} catch {
			// Nothing is installed yet, so the jar is always copied.
		}
		await copyFile(source, destination)
		return true
	}

	/**
	 * Clears companion jars out of an instance, optionally keeping the one file
	 * that is about to be refreshed. Two jars carrying the same mod id stop
	 * Fabric from starting at all, so leftovers are never acceptable.
	 */
	private async removeCompanionJars(
		modsDirectory: string,
		keep: string | null,
	): Promise<boolean> {
		let removed = false
		for (const name of await this.listEntries(modsDirectory)) {
			const lower = name.toLowerCase()
			if (!lower.startsWith(COMPANION_PREFIX) || !lower.endsWith(".jar")) {
				continue
			}
			if (keep !== null && name === keep) {
				continue
			}
			await rm(join(modsDirectory, name), { force: true })
			this.logger.info("Removed the companion jar " + name)
			removed = true
		}
		return removed
	}

	private async ensureFabricApi(modsDirectory: string, gameVersion: string): Promise<boolean> {
		const present = await this.listEntries(modsDirectory)
		if (present.some((name) => name.toLowerCase().startsWith(FABRIC_API_PROJECT))) {
			return false
		}

		const query =
			"?loaders=" +
			encodeURIComponent(JSON.stringify(["fabric"])) +
			"&game_versions=" +
			encodeURIComponent(JSON.stringify([gameVersion]))
		const url = MODRINTH_API + "/project/" + FABRIC_API_PROJECT + "/version" + query
		const versions = await this.http.json<readonly RawFabricVersion[]>(url)

		const best = versions[0]
		if (best === undefined) {
			throw new Error("Modrinth has no Fabric API build for " + gameVersion)
		}

		const file = best.files.find((candidate) => candidate.primary) ?? best.files[0]
		if (file === undefined) {
			throw new Error("The Fabric API release for " + gameVersion + " carried no file")
		}

		await this.http.download(file.url, join(modsDirectory, file.filename), {
			sha1: file.hashes?.sha1 ?? null,
			expectedSize: file.size,
		})
		this.logger.info("Installed " + file.filename + " so the companion mod can load")
		return true
	}

	private async locateBundledJar(): Promise<string | null> {
		if (this.cachedJar !== undefined) {
			return this.cachedJar
		}

		const electron = process as NodeJS.Process & { resourcesPath?: string }
		const packaged =
			electron.resourcesPath === undefined ? null : join(electron.resourcesPath, "companion")
		const candidates = [
			packaged,
			join(process.cwd(), "build", "companion"),
			join(process.cwd(), "companion", "build", "libs"),
		]

		for (const directory of candidates) {
			if (directory === null) {
				continue
			}
			const jar = await this.findJar(directory)
			if (jar !== null) {
				this.logger.info("Using the companion mod at " + jar)
				this.cachedJar = jar
				return jar
			}
		}

		this.cachedJar = null
		return null
	}

	private async findJar(directory: string): Promise<string | null> {
		const jars = (await this.listEntries(directory))
			.filter((name) => name.startsWith(COMPANION_PREFIX) && name.endsWith(".jar"))
			.filter((name) => !name.includes("-sources") && !name.includes("-dev"))
			.sort((left, right) => left.localeCompare(right))

		const chosen = jars[jars.length - 1]
		return chosen === undefined ? null : join(directory, chosen)
	}

	private async listEntries(directory: string): Promise<string[]> {
		try {
			return await readdir(directory)
		} catch {
			return []
		}
	}
}
