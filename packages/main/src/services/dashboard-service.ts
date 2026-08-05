import type { Account, DashboardData, NewsItem } from "@halcyon/ipc"
import type { Logger } from "../infra/logger.ts"
import type { AuthService } from "./auth-service.ts"
import type { InstanceService } from "./instance-service.ts"
import type { ModrinthService } from "./modrinth-service.ts"
import type { PluginService } from "./plugin-service.ts"
import type { StatisticsService } from "./statistics-service.ts"
import type { UpdateService } from "./update-service.ts"
import type { VersionService } from "./version-service.ts"

const MINECRAFT_ARTICLES_URL = "https://www.minecraft.net/en-us/articles"
const MODRINTH_URL = "https://modrinth.com"

export class DashboardService {
	private readonly instances: InstanceService
	private readonly versions: VersionService
	private readonly modrinth: ModrinthService
	private readonly statistics: StatisticsService
	private readonly auth: AuthService
	private readonly updates: UpdateService
	private readonly plugins: PluginService
	private readonly logger: Logger

	constructor(dependencies: {
		instances: InstanceService
		versions: VersionService
		modrinth: ModrinthService
		statistics: StatisticsService
		auth: AuthService
		updates: UpdateService
		plugins: PluginService
		logger: Logger
	}) {
		this.instances = dependencies.instances
		this.versions = dependencies.versions
		this.modrinth = dependencies.modrinth
		this.statistics = dependencies.statistics
		this.auth = dependencies.auth
		this.updates = dependencies.updates
		this.plugins = dependencies.plugins
		this.logger = dependencies.logger
	}

	private async news(): Promise<readonly NewsItem[]> {
		try {
			const manifest = await this.versions.manifest()
			const release = manifest.find((entry) => entry.type === "release")
			const snapshot = manifest.find((entry) => entry.type === "snapshot")
			const items: NewsItem[] = []

			if (release !== undefined) {
				items.push({
					id: `release-${release.id}`,
					title: `Minecraft ${release.id} is the current release`,
					summary:
						"Create an instance on this version to get the latest official changes, or pin an older release for your modpacks.",
					url: MINECRAFT_ARTICLES_URL,
					publishedAt: release.releaseTime,
					source: "Minecraft",
				})
			}

			if (snapshot !== undefined) {
				items.push({
					id: `snapshot-${snapshot.id}`,
					title: `Snapshot ${snapshot.id} is available`,
					summary:
						"Snapshots are experimental. Halcyon keeps them in a separate channel so they never overwrite a stable instance.",
					url: MINECRAFT_ARTICLES_URL,
					publishedAt: snapshot.releaseTime,
					source: "Snapshots",
				})
			}

			items.push({
				id: "modrinth-content",
				title: "Discover mods, shaders and resource packs",
				summary:
					"Halcyon installs Modrinth content with one click and resolves every required dependency for the instance you are viewing.",
				url: MODRINTH_URL,
				publishedAt: new Date().toISOString(),
				source: "Halcyon",
			})

			return items
		} catch (error) {
			this.logger.warn("Could not build the news feed", error)
			return []
		}
	}

	async load(): Promise<DashboardData> {
		const [
			instances,
			installedVersions,
			statistics,
			accounts,
			news,
			featuredMods,
			featuredShaders,
			featuredResourcePacks,
		] = await Promise.all([
			this.instances.list(),
			this.versions.list({ installedOnly: true }),
			this.statistics.summary(),
			this.auth.list(),
			this.news(),
			this.modrinth.featured("mod", 6),
			this.modrinth.featured("shaderpack", 6),
			this.modrinth.featured("resourcepack", 6),
		])

		const recent = [...instances]
			.filter((instance) => instance.lastPlayedAt !== null)
			.sort((left, right) => (left.lastPlayedAt ?? "") < (right.lastPlayedAt ?? "") ? 1 : -1)
			.slice(0, 6)

		const selected: Account | null =
			accounts.find((account) => account.selected) ?? accounts[0] ?? null

		return {
			news,
			recent,
			favorites: instances.filter((instance) => instance.favorite).slice(0, 8),
			installedVersions: installedVersions.slice(0, 12),
			featuredMods,
			featuredShaders,
			featuredResourcePacks,
			statistics,
			account: selected,
			update: this.updates.current(),
			pluginCards: this.plugins.cards(),
		}
	}
}
