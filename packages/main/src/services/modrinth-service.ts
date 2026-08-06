import type {
	ContentKind,
	LoaderId,
	ModrinthProject,
	ModrinthProjectDetail,
	ModrinthSearchQuery,
	ModrinthSearchResult,
	ModrinthVersion,
} from "@halcyon/ipc"
import type { ContentResolverPort, ContentVersion, ResolutionTarget } from "@halcyon/core"
import type { HttpClient } from "../infra/http.ts"
import type { Logger } from "../infra/logger.ts"

export const MODRINTH_API = "https://api.modrinth.com/v2"

type RawProject = {
	readonly project_id?: string
	readonly id?: string
	readonly slug: string
	readonly title: string
	readonly description: string
	readonly icon_url?: string | null
	readonly downloads: number
	readonly follows?: number
	readonly categories?: readonly string[]
	readonly display_categories?: readonly string[]
	readonly project_type?: string
	readonly author?: string
	readonly date_modified?: string
	readonly updated?: string
	readonly versions?: readonly string[]
	readonly game_versions?: readonly string[]
	readonly loaders?: readonly string[]
	readonly body?: string
	readonly source_url?: string | null
	readonly issues_url?: string | null
	readonly wiki_url?: string | null
	readonly license?: { readonly name?: string; readonly id?: string } | string | null
	readonly gallery?: readonly {
		readonly url: string
		readonly title?: string | null
		readonly description?: string | null
		readonly featured?: boolean
	}[]
}

type RawVersion = {
	readonly id: string
	readonly project_id: string
	readonly name: string
	readonly version_number: string
	readonly version_type: string
	readonly changelog?: string | null
	readonly date_published: string
	readonly downloads: number
	readonly game_versions: readonly string[]
	readonly loaders: readonly string[]
	readonly dependencies?: readonly {
		readonly project_id?: string | null
		readonly version_id?: string | null
		readonly dependency_type: string
	}[]
	readonly files: readonly {
		readonly filename: string
		readonly url: string
		readonly size: number
		readonly primary: boolean
		readonly hashes?: { readonly sha1?: string }
	}[]
}

type RawSearch = {
	readonly hits: readonly RawProject[]
	readonly total_hits: number
	readonly offset: number
	readonly limit: number
}

export function modrinthProjectType(kind: ContentKind): string {
	switch (kind) {
		case "mod":
			return "mod"
		case "resourcepack":
			return "resourcepack"
		case "shaderpack":
			return "shader"
		case "datapack":
			return "datapack"
	}
}

function contentKindOf(projectType: string | undefined): ContentKind {
	switch (projectType) {
		case "resourcepack":
			return "resourcepack"
		case "shader":
			return "shaderpack"
		case "datapack":
			return "datapack"
		default:
			return "mod"
	}
}

function versionChannel(versionType: string): "release" | "beta" | "alpha" {
	return versionType === "beta" ? "beta" : versionType === "alpha" ? "alpha" : "release"
}

function dependencyKind(value: string): "required" | "optional" | "incompatible" | "embedded" {
	switch (value) {
		case "optional":
			return "optional"
		case "incompatible":
			return "incompatible"
		case "embedded":
			return "embedded"
		default:
			return "required"
	}
}

function licenseName(license: RawProject["license"]): string | null {
	if (license === null || license === undefined) {
		return null
	}
	if (typeof license === "string") {
		return license
	}
	return license.name ?? license.id ?? null
}

function toProject(raw: RawProject): ModrinthProject {
	return {
		id: raw.project_id ?? raw.id ?? raw.slug,
		slug: raw.slug,
		title: raw.title,
		description: raw.description,
		iconUrl: raw.icon_url ?? null,
		downloads: raw.downloads,
		follows: raw.follows ?? 0,
		categories: raw.display_categories ?? raw.categories ?? [],
		projectType: contentKindOf(raw.project_type),
		author: raw.author ?? null,
		updatedAt: raw.date_modified ?? raw.updated ?? null,
		gameVersions: raw.game_versions ?? raw.versions ?? [],
		loaders: raw.loaders ?? [],
	}
}

function toVersion(raw: RawVersion): ModrinthVersion {
	const file = raw.files.find((candidate) => candidate.primary) ?? raw.files[0]
	return {
		id: raw.id,
		projectId: raw.project_id,
		name: raw.name,
		versionNumber: raw.version_number,
		channel: versionChannel(raw.version_type),
		changelog: raw.changelog ?? "",
		datePublished: raw.date_published,
		downloads: raw.downloads,
		gameVersions: raw.game_versions,
		loaders: raw.loaders,
		dependencies: (raw.dependencies ?? []).map((dependency) => ({
			projectId: dependency.project_id ?? null,
			versionId: dependency.version_id ?? null,
			kind: dependencyKind(dependency.dependency_type),
		})),
		fileName: file?.filename ?? `${raw.version_number}.jar`,
		fileUrl: file?.url ?? "",
		fileSize: file?.size ?? 0,
		sha1: file?.hashes?.sha1 ?? null,
	}
}

export class ModrinthService implements ContentResolverPort {
	private readonly http: HttpClient
	private readonly logger: Logger
	private readonly projectCache = new Map<string, ModrinthProjectDetail>()
	private readonly versionCache = new Map<string, ModrinthVersion>()

	constructor(dependencies: { http: HttpClient; logger: Logger }) {
		this.http = dependencies.http
		this.logger = dependencies.logger
	}

	async search(query: ModrinthSearchQuery): Promise<ModrinthSearchResult> {
		const facets: string[][] = [[`project_type:${modrinthProjectType(query.projectType)}`]]
		if (query.gameVersion !== undefined && query.gameVersion !== null) {
			facets.push([`versions:${query.gameVersion}`])
		}
		if (query.loader !== undefined && query.loader !== null && query.loader !== "vanilla") {
			facets.push([`categories:${query.loader}`])
		}
		for (const category of query.categories ?? []) {
			facets.push([`categories:${category}`])
		}

		const parameters = new URLSearchParams({
			query: query.query ?? "",
			facets: JSON.stringify(facets),
			index: query.sort ?? "relevance",
			offset: String(query.offset ?? 0),
			limit: String(Math.min(100, query.limit ?? 24)),
		})

		const raw = await this.http.json<RawSearch>(
			`${MODRINTH_API}/search?${parameters.toString()}`,
		)
		return {
			hits: raw.hits.map(toProject),
			total: raw.total_hits,
			offset: raw.offset,
			limit: raw.limit,
		}
	}

	async project(idOrSlug: string): Promise<ModrinthProjectDetail> {
		const cached = this.projectCache.get(idOrSlug)
		if (cached !== undefined) {
			return cached
		}

		const raw = await this.http.json<RawProject>(
			`${MODRINTH_API}/project/${encodeURIComponent(idOrSlug)}`,
		)
		const detail: ModrinthProjectDetail = {
			...toProject(raw),
			body: raw.body ?? "",
			gallery: (raw.gallery ?? []).map((image) => ({
				url: image.url,
				title: image.title ?? null,
				description: image.description ?? null,
				featured: image.featured ?? false,
			})),
			sourceUrl: raw.source_url ?? null,
			issuesUrl: raw.issues_url ?? null,
			wikiUrl: raw.wiki_url ?? null,
			license: licenseName(raw.license),
		}

		this.projectCache.set(idOrSlug, detail)
		this.projectCache.set(detail.id, detail)
		return detail
	}

	async versions(
		projectId: string,
		gameVersion?: string | null,
		loader?: LoaderId | null,
	): Promise<readonly ModrinthVersion[]> {
		const parameters = new URLSearchParams()
		if (gameVersion !== undefined && gameVersion !== null) {
			parameters.set("game_versions", JSON.stringify([gameVersion]))
		}
		if (loader !== undefined && loader !== null && loader !== "vanilla") {
			parameters.set("loaders", JSON.stringify([loader]))
		}

		const suffix = parameters.toString() === "" ? "" : `?${parameters.toString()}`
		const raw = await this.http.json<readonly RawVersion[]>(
			`${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version${suffix}`,
		)

		const versions = raw.map(toVersion)
		for (const version of versions) {
			this.versionCache.set(version.id, version)
		}
		return versions
	}

	async version(versionId: string): Promise<ModrinthVersion | undefined> {
		const cached = this.versionCache.get(versionId)
		if (cached !== undefined) {
			return cached
		}
		try {
			const raw = await this.http.json<RawVersion>(
				`${MODRINTH_API}/version/${encodeURIComponent(versionId)}`,
			)
			const version = toVersion(raw)
			this.versionCache.set(version.id, version)
			return version
		} catch (error) {
			this.logger.warn(`Could not load Modrinth version ${versionId}`, error)
			return undefined
		}
	}

	/**
	 * Identifies local files in bulk from their sha1 hashes. Files that were
	 * dropped into an instance by hand were never linked to a project, so this
	 * is the only way to recover their title, author and artwork.
	 */
	async versionsByHashes(hashes: readonly string[]): Promise<ReadonlyMap<string, ModrinthVersion>> {
		const matches = new Map<string, ModrinthVersion>()
		const wanted = [...new Set(hashes)].filter((hash) => hash !== "")
		if (wanted.length === 0) {
			return matches
		}

		try {
			const raw = await this.http.json<Record<string, RawVersion>>(
				`${MODRINTH_API}/version_files`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Accept: "application/json",
					},
					body: JSON.stringify({ hashes: wanted, algorithm: "sha1" }),
				},
			)

			for (const [hash, value] of Object.entries(raw)) {
				const version = toVersion(value)
				this.versionCache.set(version.id, version)
				matches.set(hash, version)
			}
		} catch (error) {
			this.logger.warn("Could not match installed files against Modrinth", error)
		}

		return matches
	}

	async categories(kind: ContentKind): Promise<readonly string[]> {
		type RawCategory = { readonly name: string; readonly project_type: string }
		try {
			const raw = await this.http.json<readonly RawCategory[]>(`${MODRINTH_API}/tag/category`)
			const wanted = modrinthProjectType(kind)
			return [
				...new Set(
					raw.filter((entry) => entry.project_type === wanted).map((entry) => entry.name),
				),
			].sort((left, right) => left.localeCompare(right))
		} catch (error) {
			this.logger.warn("Could not load Modrinth categories", error)
			return []
		}
	}

	async featured(kind: ContentKind, limit = 6): Promise<readonly ModrinthProject[]> {
		try {
			const result = await this.search({ projectType: kind, sort: "downloads", limit })
			return result.hits
		} catch (error) {
			this.logger.warn(`Could not load featured ${kind} content`, error)
			return []
		}
	}

	async getVersion(versionId: string): Promise<ContentVersion | undefined> {
		const version = await this.version(versionId)
		if (version === undefined) {
			return undefined
		}
		return this.toContentVersion(version)
	}

	async getLatestVersion(
		projectId: string,
		target: ResolutionTarget,
	): Promise<ContentVersion | undefined> {
		try {
			const candidates = await this.versions(projectId, target.gameVersion, target.loader)
			const best = candidates[0] ?? (await this.versions(projectId))[0]
			return best === undefined ? undefined : this.toContentVersion(best)
		} catch (error) {
			this.logger.warn(`Could not resolve the latest version of ${projectId}`, error)
			return undefined
		}
	}

	private toContentVersion(version: ModrinthVersion): ContentVersion {
		return {
			projectId: version.projectId,
			versionId: version.id,
			name: version.name,
			slug: version.projectId,
			gameVersions: version.gameVersions,
			loaders: version.loaders,
			dependencies: version.dependencies.map((dependency) => ({
				projectId: dependency.projectId ?? undefined,
				versionId: dependency.versionId ?? undefined,
				kind: dependency.kind,
			})),
		}
	}

	resolveVersionFromCache(versionId: string): ModrinthVersion | undefined {
		return this.versionCache.get(versionId)
	}
}
