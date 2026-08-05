import type {
	Account,
	AccountPatch,
	AppInfo,
	BackupEntry,
	ContentEntry,
	ContentKind,
	CrashDiagnosisDto,
	CreateInstanceInput,
	DashboardData,
	DownloadSnapshot,
	InstallOutcome,
	InstancePatch,
	InstanceSummary,
	JavaRuntime,
	LaunchProgress,
	LaunchResult,
	LoaderId,
	LoaderVersion,
	LogBundle,
	LogQuery,
	ModAnalysis,
	ModrinthProjectDetail,
	ModrinthSearchQuery,
	ModrinthSearchResult,
	ModrinthVersion,
	PluginInfo,
	ScreenshotEntry,
	Settings,
	SkinEntry,
	SkinUploadInput,
	Toast,
	UpdateStatus,
	VerificationReport,
	VersionChangeAssessmentDto,
	VersionChangeRequestDto,
	VersionEntry,
	VersionFilter,
	WorldEntry,
} from "./types.ts"

export type IpcContract = {
	"app:info": () => AppInfo
	"app:openPath": (target: string) => void
	"app:openExternal": (url: string) => void
	"app:relaunch": () => void

	"settings:get": () => Settings
	"settings:update": (patch: Partial<Settings>) => Settings
	"settings:pickDirectory": (purpose: "download" | "screenshot" | "instances") => string | null
	"settings:pickImage": () => string | null
	"settings:reset": () => Settings

	"dashboard:load": () => DashboardData

	"versions:list": (filter: VersionFilter) => readonly VersionEntry[]
	"versions:refresh": () => readonly VersionEntry[]
	"versions:favorite": (versionId: string, favorite: boolean) => readonly VersionEntry[]
	"versions:install": (versionId: string) => VerificationReport
	"versions:delete": (versionId: string) => readonly VersionEntry[]
	"versions:verify": (versionId: string) => VerificationReport
	"loaders:list": (loader: LoaderId, gameVersion: string) => readonly LoaderVersion[]

	"instances:list": () => readonly InstanceSummary[]
	"instances:get": (instanceId: string) => InstanceSummary | null
	"instances:create": (input: CreateInstanceInput) => InstanceSummary
	"instances:update": (instanceId: string, patch: InstancePatch) => InstanceSummary
	"instances:delete": (instanceId: string) => readonly InstanceSummary[]
	"instances:duplicate": (instanceId: string, name: string | null) => InstanceSummary
	"instances:rename": (instanceId: string, name: string) => InstanceSummary
	"instances:assessVersionChange": (
		instanceId: string,
		request: VersionChangeRequestDto,
	) => VersionChangeAssessmentDto
	"instances:changeVersion": (
		instanceId: string,
		request: VersionChangeRequestDto,
	) => InstanceSummary
	"instances:repair": (instanceId: string) => VerificationReport
	"instances:verify": (instanceId: string) => VerificationReport
	"instances:export": (instanceId: string) => string | null
	"instances:import": () => readonly InstanceSummary[]
	"instances:importOfficial": () => readonly InstanceSummary[]
	"instances:openFolder": (instanceId: string, subFolder: string | null) => void
	"instances:launch": (instanceId: string, accountId: string | null) => LaunchResult
	"instances:stop": (instanceId: string) => void
	"instances:worlds": (instanceId: string) => readonly WorldEntry[]
	"instances:screenshots": (instanceId: string) => readonly ScreenshotEntry[]
	"instances:backups": (instanceId: string) => readonly BackupEntry[]
	"instances:createBackup": (instanceId: string, note: string) => readonly BackupEntry[]
	"instances:restoreBackup": (instanceId: string, backupId: string) => InstanceSummary
	"instances:deleteBackup": (instanceId: string, backupId: string) => readonly BackupEntry[]

	"content:list": (instanceId: string, kind: ContentKind) => readonly ContentEntry[]
	"content:setEnabled": (
		instanceId: string,
		kind: ContentKind,
		fileNames: readonly string[],
		enabled: boolean,
	) => readonly ContentEntry[]
	"content:delete": (
		instanceId: string,
		kind: ContentKind,
		fileNames: readonly string[],
	) => readonly ContentEntry[]
	"content:import": (
		instanceId: string,
		kind: ContentKind,
		filePaths: readonly string[],
	) => readonly ContentEntry[]
	"content:checkUpdates": (instanceId: string, kind: ContentKind) => readonly ContentEntry[]
	"content:applyUpdates": (
		instanceId: string,
		kind: ContentKind,
		fileNames: readonly string[],
	) => InstallOutcome
	"content:analyze": (instanceId: string) => ModAnalysis
	"content:openFolder": (instanceId: string, kind: ContentKind) => void

	"modrinth:search": (query: ModrinthSearchQuery) => ModrinthSearchResult
	"modrinth:project": (idOrSlug: string) => ModrinthProjectDetail
	"modrinth:versions": (
		projectId: string,
		gameVersion: string | null,
		loader: LoaderId | null,
	) => readonly ModrinthVersion[]
	"modrinth:categories": (kind: ContentKind) => readonly string[]
	"modrinth:install": (
		instanceId: string,
		versionId: string,
		withDependencies: boolean,
	) => InstallOutcome

	"accounts:list": () => readonly Account[]
	"accounts:loginMicrosoft": () => Account
	"accounts:addOffline": (username: string) => Account
	"accounts:remove": (accountId: string) => readonly Account[]
	"accounts:select": (accountId: string) => readonly Account[]
	"accounts:update": (accountId: string, patch: AccountPatch) => readonly Account[]
	"accounts:refresh": (accountId: string) => Account
	"accounts:export": () => string | null
	"accounts:import": () => readonly Account[]

	"skins:list": () => readonly SkinEntry[]
	"skins:upload": (input: SkinUploadInput) => readonly SkinEntry[]
	"skins:apply": (skinId: string) => readonly SkinEntry[]
	"skins:remove": (skinId: string) => readonly SkinEntry[]
	"skins:favorite": (skinId: string, favorite: boolean) => readonly SkinEntry[]
	"skins:download": (skinId: string) => string | null

	"java:list": () => readonly JavaRuntime[]
	"java:detect": () => readonly JavaRuntime[]
	"java:install": (major: number) => readonly JavaRuntime[]
	"java:validate": (executablePath: string) => JavaRuntime
	"java:pick": () => JavaRuntime | null

	"downloads:snapshot": () => DownloadSnapshot
	"downloads:pause": () => DownloadSnapshot
	"downloads:resume": () => DownloadSnapshot
	"downloads:retryFailed": () => DownloadSnapshot
	"downloads:cancel": (itemId: string | null) => DownloadSnapshot

	"logs:read": (query: LogQuery) => LogBundle
	"logs:export": (query: LogQuery) => string | null
	"logs:analyze": (instanceId: string) => readonly CrashDiagnosisDto[]

	"updates:status": () => UpdateStatus
	"updates:check": () => UpdateStatus
	"updates:download": () => UpdateStatus
	"updates:install": () => void
	"updates:rollback": () => UpdateStatus

	"plugins:list": () => readonly PluginInfo[]
	"plugins:setEnabled": (pluginId: string, enabled: boolean) => readonly PluginInfo[]
	"plugins:reload": () => readonly PluginInfo[]
	"plugins:openFolder": () => void
}

export type IpcChannel = keyof IpcContract

export type IpcArgs<K extends IpcChannel> = Parameters<IpcContract[K]>

export type IpcResult<K extends IpcChannel> = Awaited<ReturnType<IpcContract[K]>>

export type IpcEventMap = {
	"downloads:changed": DownloadSnapshot
	"instances:changed": readonly InstanceSummary[]
	"accounts:changed": readonly Account[]
	"settings:changed": Settings
	"plugins:changed": readonly PluginInfo[]
	"updates:changed": UpdateStatus
	"launch:progress": LaunchProgress
	"logs:appended": { readonly source: string; readonly lines: readonly LogBundle["lines"][number][] }
	"toast": Toast
}

export type IpcEvent = keyof IpcEventMap

export const IPC_CHANNELS = [
	"app:info",
	"app:openPath",
	"app:openExternal",
	"app:relaunch",
	"settings:get",
	"settings:update",
	"settings:pickDirectory",
	"settings:pickImage",
	"settings:reset",
	"dashboard:load",
	"versions:list",
	"versions:refresh",
	"versions:favorite",
	"versions:install",
	"versions:delete",
	"versions:verify",
	"loaders:list",
	"instances:list",
	"instances:get",
	"instances:create",
	"instances:update",
	"instances:delete",
	"instances:duplicate",
	"instances:rename",
	"instances:assessVersionChange",
	"instances:changeVersion",
	"instances:repair",
	"instances:verify",
	"instances:export",
	"instances:import",
	"instances:importOfficial",
	"instances:openFolder",
	"instances:launch",
	"instances:stop",
	"instances:worlds",
	"instances:screenshots",
	"instances:backups",
	"instances:createBackup",
	"instances:restoreBackup",
	"instances:deleteBackup",
	"content:list",
	"content:setEnabled",
	"content:delete",
	"content:import",
	"content:checkUpdates",
	"content:applyUpdates",
	"content:analyze",
	"content:openFolder",
	"modrinth:search",
	"modrinth:project",
	"modrinth:versions",
	"modrinth:categories",
	"modrinth:install",
	"accounts:list",
	"accounts:loginMicrosoft",
	"accounts:addOffline",
	"accounts:remove",
	"accounts:select",
	"accounts:update",
	"accounts:refresh",
	"accounts:export",
	"accounts:import",
	"skins:list",
	"skins:upload",
	"skins:apply",
	"skins:remove",
	"skins:favorite",
	"skins:download",
	"java:list",
	"java:detect",
	"java:install",
	"java:validate",
	"java:pick",
	"downloads:snapshot",
	"downloads:pause",
	"downloads:resume",
	"downloads:retryFailed",
	"downloads:cancel",
	"logs:read",
	"logs:export",
	"logs:analyze",
	"updates:status",
	"updates:check",
	"updates:download",
	"updates:install",
	"updates:rollback",
	"plugins:list",
	"plugins:setEnabled",
	"plugins:reload",
	"plugins:openFolder",
] as const satisfies readonly IpcChannel[]

export const IPC_EVENTS = [
	"downloads:changed",
	"instances:changed",
	"accounts:changed",
	"settings:changed",
	"plugins:changed",
	"updates:changed",
	"launch:progress",
	"logs:appended",
	"toast",
] as const satisfies readonly IpcEvent[]

type UncoveredChannel = Exclude<IpcChannel, (typeof IPC_CHANNELS)[number]>
type UncoveredEvent = Exclude<IpcEvent, (typeof IPC_EVENTS)[number]>

export type ContractIsFullyEnumerated = [UncoveredChannel] extends [never]
	? [UncoveredEvent] extends [never]
		? true
		: never
	: never

export const CONTRACT_IS_FULLY_ENUMERATED: ContractIsFullyEnumerated = true

export type HalcyonBridge = {
	invoke<K extends IpcChannel>(channel: K, ...args: IpcArgs<K>): Promise<IpcResult<K>>
	on<E extends IpcEvent>(event: E, listener: (payload: IpcEventMap[E]) => void): () => void
	readonly platform: NodeJS.Platform
}
