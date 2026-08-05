import { join } from "node:path"
import type { HostPlatform } from "@halcyon/core"
import type { Settings } from "@halcyon/ipc"
import { buildInfo } from "./build-info.ts"
import type { BuildInfo } from "./build-info.ts"
import { EventBus } from "./infra/events.ts"
import { HttpClient } from "./infra/http.ts"
import { JsonStore } from "./infra/json-store.ts"
import { LauncherLog } from "./infra/logger.ts"
import type { Logger } from "./infra/logger.ts"
import { createAppPaths, ensureAppDirectories } from "./infra/paths.ts"
import type { AppPaths } from "./infra/paths.ts"
import { hostPlatform } from "./infra/platform.ts"
import { AuthService, DEFAULT_ACCOUNT_STATE } from "./services/auth-service.ts"
import type { AccountState } from "./services/auth-service.ts"
import { BackupService, DEFAULT_BACKUP_INDEX } from "./services/backup-service.ts"
import type { BackupIndex } from "./services/backup-service.ts"
import { ContentService } from "./services/content-service.ts"
import { DashboardService } from "./services/dashboard-service.ts"
import { DownloadService } from "./services/download-service.ts"
import { DEFAULT_INSTANCE_STATE, InstanceService } from "./services/instance-service.ts"
import type { InstanceState } from "./services/instance-service.ts"
import { JavaService } from "./services/java-service.ts"
import { LaunchService } from "./services/launch-service.ts"
import { LoaderService } from "./services/loader-service.ts"
import { LogService } from "./services/log-service.ts"
import { ModrinthService } from "./services/modrinth-service.ts"
import { DEFAULT_PLUGIN_STATE, PluginService } from "./services/plugin-service.ts"
import type { PluginState } from "./services/plugin-service.ts"
import { PresenceService } from "./services/presence-service.ts"
import { SettingsService, defaultSettings } from "./services/settings-service.ts"
import { DEFAULT_SKIN_STATE, SkinService } from "./services/skin-service.ts"
import type { SkinState } from "./services/skin-service.ts"
import { DEFAULT_STATISTICS_STATE, StatisticsService } from "./services/statistics-service.ts"
import type { StatisticsState } from "./services/statistics-service.ts"
import { DEFAULT_UPDATE_HISTORY, UpdateService } from "./services/update-service.ts"
import type { UpdateHistoryState } from "./services/update-service.ts"
import { DEFAULT_VERSION_META, VersionService } from "./services/version-service.ts"
import type { VersionMetaState } from "./services/version-service.ts"
import { VersionChangeService } from "./services/version-change-service.ts"

const REPOSITORY_URL = "https://github.com/jjbkl/YugiClient"
const USER_AGENT_PREFIX = "Halcyon/"

export type Container = {
	readonly paths: AppPaths
	readonly log: LauncherLog
	readonly logger: Logger
	readonly events: EventBus
	readonly http: HttpClient
	readonly platform: HostPlatform
	readonly build: BuildInfo
	readonly settings: SettingsService
	readonly downloads: DownloadService
	readonly versions: VersionService
	readonly loaders: LoaderService
	readonly java: JavaService
	readonly instances: InstanceService
	readonly backups: BackupService
	readonly modrinth: ModrinthService
	readonly content: ContentService
	readonly auth: AuthService
	readonly skins: SkinService
	readonly logs: LogService
	readonly statistics: StatisticsService
	readonly presence: PresenceService
	readonly launch: LaunchService
	readonly versionChanges: VersionChangeService
	readonly updates: UpdateService
	readonly plugins: PluginService
	readonly dashboard: DashboardService
	dispose(): Promise<void>
}

export async function createContainer(options: {
	fallbackVersion: string
	dataDirectory?: string
}): Promise<Container> {
	const paths = createAppPaths(options.dataDirectory)
	await ensureAppDirectories(paths)

	const build = buildInfo(options.fallbackVersion)
	const log = new LauncherLog(paths.launcherLogFile)
	const logger = log.logger("launcher")
	const events = new EventBus()
	const platform = hostPlatform()
	const userAgent = USER_AGENT_PREFIX + build.version + " (+" + REPOSITORY_URL + ")"
	const http = new HttpClient(log.logger("http"), userAgent)

	const settings = new SettingsService(
		new JsonStore<Settings>({
			filePath: paths.settingsFile,
			defaults: defaultSettings(),
			onError: (error) => log.logger("settings").warn("Settings could not be read", error),
		}),
		events,
	)

	const downloads = new DownloadService(http, log.logger("downloads"), events)

	const versions = new VersionService({
		http,
		paths,
		logger: log.logger("versions"),
		downloads,
		store: new JsonStore<VersionMetaState>({
			filePath: paths.versionMetaFile,
			defaults: DEFAULT_VERSION_META,
		}),
		platform,
	})

	const loaders = new LoaderService({
		http,
		paths,
		logger: log.logger("loaders"),
		downloads,
		versions,
		platform,
	})

	const java = new JavaService({ http, paths, logger: log.logger("java") })

	const instances = new InstanceService({
		store: new JsonStore<InstanceState>({
			filePath: paths.instancesFile,
			defaults: DEFAULT_INSTANCE_STATE,
		}),
		paths,
		logger: log.logger("instances"),
		events,
		settings,
	})

	const backups = new BackupService({
		paths,
		logger: log.logger("backups"),
		events,
		instances,
		index: new JsonStore<BackupIndex>({
			filePath: join(paths.backups, "index.json"),
			defaults: DEFAULT_BACKUP_INDEX,
		}),
	})

	const modrinth = new ModrinthService({ http, logger: log.logger("modrinth") })

	const content = new ContentService({
		instances,
		modrinth,
		http,
		logger: log.logger("content"),
		events,
	})

	const auth = new AuthService({
		store: new JsonStore<AccountState>({
			filePath: paths.accountsFile,
			defaults: DEFAULT_ACCOUNT_STATE,
		}),
		http,
		logger: log.logger("accounts"),
		events,
	})

	const skins = new SkinService({
		store: new JsonStore<SkinState>({
			filePath: paths.skinsFile,
			defaults: DEFAULT_SKIN_STATE,
		}),
		paths,
		http,
		auth,
		logger: log.logger("skins"),
		events,
	})

	const logs = new LogService({ paths, logger: log.logger("logs"), events })

	const statistics = new StatisticsService({
		store: new JsonStore<StatisticsState>({
			filePath: paths.statisticsFile,
			defaults: DEFAULT_STATISTICS_STATE,
		}),
		instances,
		versions,
	})

	const presence = new PresenceService({ logger: log.logger("presence") })

	const launch = new LaunchService({
		instances,
		versions,
		loaders,
		java,
		auth,
		settings,
		logs,
		statistics,
		presence,
		events,
		logger: log.logger("launch"),
		paths,
		platform,
		appVersion: build.version,
	})

	const versionChanges = new VersionChangeService({
		instances,
		content,
		backups,
		loaders,
		versions,
		events,
		logger: log.logger("version-change"),
	})

	const updates = new UpdateService({
		logger: log.logger("updates"),
		events,
		history: new JsonStore<UpdateHistoryState>({
			filePath: join(paths.cache, "update-history.json"),
			defaults: DEFAULT_UPDATE_HISTORY,
		}),
		currentVersion: build.version,
	})

	const plugins = new PluginService({
		paths,
		logger: log.logger("plugins"),
		events,
		store: new JsonStore<PluginState>({
			filePath: paths.pluginStateFile,
			defaults: DEFAULT_PLUGIN_STATE,
		}),
		host: {
			appVersion: build.version,
			instances: () => instances.list(),
			settings: () => settings.get(),
		},
	})

	const dashboard = new DashboardService({
		instances,
		versions,
		modrinth,
		statistics,
		auth,
		updates,
		plugins,
		logger: log.logger("dashboard"),
	})

	const initial = await settings.get()
	downloads.setConcurrency(initial.concurrentDownloads)
	presence.setEnabled(initial.discordPresence)

	settings.onChange((next) => {
		downloads.setConcurrency(next.concurrentDownloads)
		presence.setEnabled(next.discordPresence)
	})

	log.subscribe((lines) => {
		events.emit("logs:appended", { source: "launcher", instanceId: null, lines })
	})

	logger.info(
		`Halcyon ${build.version} (build ${build.buildNumber}, commit ${build.commit}) starting on ${platform.os}`,
	)

	return {
		paths,
		log,
		logger,
		events,
		http,
		platform,
		build,
		settings,
		downloads,
		versions,
		loaders,
		java,
		instances,
		backups,
		modrinth,
		content,
		auth,
		skins,
		logs,
		statistics,
		presence,
		launch,
		versionChanges,
		updates,
		plugins,
		dashboard,
		async dispose(): Promise<void> {
			launch.stopAll()
			presence.dispose()
			await plugins.dispose()
			await log.flush()
		},
	}
}
