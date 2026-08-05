export type LoaderId = "vanilla" | "fabric" | "forge" | "neoforge" | "quilt"

export type ContentKind = "mod" | "resourcepack" | "shaderpack" | "datapack"

export type ThemeMode = "dark" | "light" | "amoled"

export type AnimationLevel = "full" | "reduced" | "off"

export type AppInfo = {
	readonly name: string
	readonly version: string
	readonly buildNumber: string
	readonly commit: string
	readonly buildTime: string
	readonly platform: "windows" | "osx" | "linux"
	readonly arch: string
	readonly dataDirectory: string
	readonly electronVersion: string
	readonly nodeVersion: string
}

export type Settings = {
	readonly theme: ThemeMode
	readonly accent: string
	readonly language: string
	readonly autoUpdate: boolean
	readonly notifications: boolean
	readonly animations: AnimationLevel
	readonly blur: boolean
	readonly cornerRadius: number
	readonly transparency: number
	readonly uiScale: number
	readonly wallpaper: string | null
	readonly defaultMemoryMb: number
	readonly defaultJvmArgs: string
	readonly defaultJavaPath: string | null
	readonly downloadDirectory: string | null
	readonly screenshotDirectory: string | null
	readonly concurrentDownloads: number
	readonly discordPresence: boolean
	readonly keepLauncherOpen: boolean
	readonly closeToTray: boolean
	readonly shareUsageData: boolean
	readonly showSnapshots: boolean
}

export type WindowSettings = {
	readonly width: number | null
	readonly height: number | null
	readonly fullscreen: boolean
}

export type InstanceConfig = {
	readonly id: string
	readonly name: string
	readonly icon: string | null
	readonly background: string | null
	readonly group: string | null
	readonly gameVersion: string
	readonly loader: LoaderId
	readonly loaderVersion: string | null
	readonly javaPath: string | null
	readonly memoryMb: number
	readonly jvmArgs: string
	readonly window: WindowSettings
	readonly env: Readonly<Record<string, string>>
	readonly discordPresence: boolean
	readonly favorite: boolean
	readonly notes: string
	readonly createdAt: string
	readonly lastPlayedAt: string | null
	readonly playtimeMinutes: number
	readonly launchCount: number
}

export type InstanceSummary = InstanceConfig & {
	readonly directory: string
	readonly installed: boolean
	readonly running: boolean
	readonly modCount: number
	readonly requiredJavaMajor: number
	readonly sizeBytes: number | null
}

export type CreateInstanceInput = {
	readonly name: string
	readonly gameVersion: string
	readonly loader: LoaderId
	readonly loaderVersion?: string | null
	readonly icon?: string | null
	readonly group?: string | null
	readonly memoryMb?: number
	readonly install?: boolean
}

export type InstancePatch = Partial<
	Omit<InstanceConfig, "id" | "createdAt" | "playtimeMinutes" | "launchCount">
>

export type VersionChannel = "release" | "snapshot" | "old_beta" | "old_alpha"

export type VersionEntry = {
	readonly id: string
	readonly channel: VersionChannel
	readonly releaseTime: string
	readonly installed: boolean
	readonly favorite: boolean
	readonly requiredJavaMajor: number
	readonly sizeBytes: number | null
}

export type VersionFilter = {
	readonly channels?: readonly VersionChannel[]
	readonly search?: string
	readonly installedOnly?: boolean
	readonly favoritesOnly?: boolean
}

export type LoaderVersion = {
	readonly id: string
	readonly gameVersion: string
	readonly stable: boolean
	readonly recommended: boolean
}

export type VerificationReport = {
	readonly checked: number
	readonly repaired: number
	readonly missing: readonly string[]
	readonly corrupt: readonly string[]
	readonly durationMs: number
}

export type CompatibilityWarningDto = {
	readonly code: string
	readonly severity: "info" | "warning" | "blocker"
	readonly message: string
	readonly detail: string | null
}

export type VersionChangeAssessmentDto = {
	readonly direction: "upgrade" | "downgrade" | "same" | "unknown"
	readonly warnings: readonly CompatibilityWarningDto[]
	readonly incompatibleMods: readonly string[]
	readonly recommendBackup: boolean
	readonly javaChanges: boolean
}

export type VersionChangeRequestDto = {
	readonly gameVersion: string
	readonly loader: LoaderId
	readonly loaderVersion?: string | null
	readonly createBackup?: boolean
}

export type AccountKind = "microsoft" | "offline"

export type Account = {
	readonly id: string
	readonly kind: AccountKind
	readonly username: string
	readonly uuid: string
	readonly nickname: string | null
	readonly favorite: boolean
	readonly selected: boolean
	readonly avatarUrl: string | null
	readonly skinUrl: string | null
	readonly capes: readonly string[]
	readonly expiresAt: string | null
	readonly lastUsedAt: string | null
}

export type AccountPatch = {
	readonly nickname?: string | null
	readonly favorite?: boolean
}

export type SkinModel = "classic" | "slim"

export type SkinEntry = {
	readonly id: string
	readonly name: string
	readonly filePath: string
	readonly dataUrl: string
	readonly model: SkinModel
	readonly favorite: boolean
	readonly source: "upload" | "account"
	readonly createdAt: string
	readonly appliedAt: string | null
}

export type SkinUploadInput = {
	readonly name?: string
	readonly model: SkinModel
	readonly filePath?: string
}

export type JavaRuntime = {
	readonly path: string
	readonly major: number
	readonly version: string
	readonly vendor: string | null
	readonly managed: boolean
	readonly valid: boolean
	readonly error: string | null
}

export type DownloadItemState =
	| "queued"
	| "running"
	| "completed"
	| "failed"
	| "cancelled"
	| "paused"

export type DownloadItem = {
	readonly id: string
	readonly label: string
	readonly group: string | null
	readonly state: DownloadItemState
	readonly receivedBytes: number
	readonly totalBytes: number
	readonly attempt: number
	readonly error: string | null
}

export type DownloadSnapshot = {
	readonly items: readonly DownloadItem[]
	readonly completedBytes: number
	readonly totalBytes: number
	readonly completedItems: number
	readonly totalItems: number
	readonly bytesPerSecond: number
	readonly etaSeconds: number | null
	readonly fraction: number
	readonly paused: boolean
	readonly failedCount: number
}

export type ContentEntry = {
	readonly fileName: string
	readonly displayName: string
	readonly kind: ContentKind
	readonly enabled: boolean
	readonly sizeBytes: number
	readonly version: string | null
	readonly author: string | null
	readonly description: string | null
	readonly projectId: string | null
	readonly versionId: string | null
	readonly iconUrl: string | null
	readonly updateAvailable: boolean
	readonly latestVersionId: string | null
	readonly latestVersionName: string | null
	readonly gameVersions: readonly string[]
	readonly loaders: readonly string[]
}

export type ModIssue = {
	readonly kind: "missing-dependency" | "duplicate" | "incompatible" | "wrong-game-version"
	readonly message: string
	readonly fileNames: readonly string[]
	readonly projectId: string | null
}

export type ModAnalysis = {
	readonly issues: readonly ModIssue[]
	readonly totalMods: number
	readonly enabledMods: number
}

export type ModrinthSortOrder = "relevance" | "downloads" | "follows" | "newest" | "updated"

export type ModrinthSearchQuery = {
	readonly query?: string
	readonly projectType: ContentKind
	readonly gameVersion?: string | null
	readonly loader?: LoaderId | null
	readonly categories?: readonly string[]
	readonly sort?: ModrinthSortOrder
	readonly offset?: number
	readonly limit?: number
}

export type ModrinthProject = {
	readonly id: string
	readonly slug: string
	readonly title: string
	readonly description: string
	readonly iconUrl: string | null
	readonly downloads: number
	readonly follows: number
	readonly categories: readonly string[]
	readonly projectType: ContentKind
	readonly author: string | null
	readonly updatedAt: string | null
	readonly gameVersions: readonly string[]
	readonly loaders: readonly string[]
}

export type ModrinthGalleryImage = {
	readonly url: string
	readonly title: string | null
	readonly description: string | null
	readonly featured: boolean
}

export type ModrinthProjectDetail = ModrinthProject & {
	readonly body: string
	readonly gallery: readonly ModrinthGalleryImage[]
	readonly sourceUrl: string | null
	readonly issuesUrl: string | null
	readonly wikiUrl: string | null
	readonly license: string | null
}

export type ModrinthSearchResult = {
	readonly hits: readonly ModrinthProject[]
	readonly total: number
	readonly offset: number
	readonly limit: number
}

export type ModrinthDependency = {
	readonly projectId: string | null
	readonly versionId: string | null
	readonly kind: "required" | "optional" | "incompatible" | "embedded"
}

export type ModrinthVersion = {
	readonly id: string
	readonly projectId: string
	readonly name: string
	readonly versionNumber: string
	readonly channel: "release" | "beta" | "alpha"
	readonly changelog: string
	readonly datePublished: string
	readonly downloads: number
	readonly gameVersions: readonly string[]
	readonly loaders: readonly string[]
	readonly dependencies: readonly ModrinthDependency[]
	readonly fileName: string
	readonly fileUrl: string
	readonly fileSize: number
	readonly sha1: string | null
}

export type InstallOutcome = {
	readonly installed: readonly string[]
	readonly skipped: readonly string[]
	readonly problems: readonly string[]
}

export type BackupEntry = {
	readonly id: string
	readonly fileName: string
	readonly note: string
	readonly createdAt: string
	readonly sizeBytes: number
	readonly gameVersion: string
	readonly loader: LoaderId
}

export type WorldEntry = {
	readonly folderName: string
	readonly name: string
	readonly lastPlayedAt: string | null
	readonly sizeBytes: number
}

export type ScreenshotEntry = {
	readonly fileName: string
	readonly filePath: string
	readonly createdAt: string
	readonly sizeBytes: number
}

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal"

export type LogLine = {
	readonly timestamp: string
	readonly level: LogLevel
	readonly scope: string
	readonly message: string
}

export type LogQuery = {
	readonly source: "launcher" | "instance"
	readonly instanceId?: string
	readonly search?: string
	readonly levels?: readonly LogLevel[]
	readonly limit?: number
}

export type LogBundle = {
	readonly source: string
	readonly lines: readonly LogLine[]
	readonly truncated: boolean
}

export type CrashDiagnosisDto = {
	readonly id: string
	readonly title: string
	readonly severity: "fatal" | "error" | "warning"
	readonly explanation: string
	readonly remedies: readonly string[]
	readonly evidence: string
	readonly confidence: number
	readonly crashReportPath: string | null
}

export type UpdateState =
	| "idle"
	| "checking"
	| "available"
	| "downloading"
	| "ready"
	| "up-to-date"
	| "error"

export type UpdateStatus = {
	readonly state: UpdateState
	readonly currentVersion: string
	readonly availableVersion: string | null
	readonly releaseNotes: string | null
	readonly percent: number
	readonly error: string | null
	readonly canRollback: boolean
}

export type PluginInfo = {
	readonly id: string
	readonly name: string
	readonly version: string
	readonly description: string | null
	readonly author: string | null
	readonly apiVersion: number
	readonly enabled: boolean
	readonly directory: string
	readonly error: string | null
	readonly contributedCards: readonly PluginCard[]
}

export type PluginCard = {
	readonly pluginId: string
	readonly title: string
	readonly body: string
	readonly accent: string | null
}

export type NewsItem = {
	readonly id: string
	readonly title: string
	readonly summary: string
	readonly url: string | null
	readonly publishedAt: string
	readonly source: string
}

export type PlayStatistics = {
	readonly totalPlaytimeMinutes: number
	readonly launchCount: number
	readonly instanceCount: number
	readonly installedVersionCount: number
	readonly busiestInstance: string | null
	readonly last7Days: readonly { readonly date: string; readonly minutes: number }[]
}

export type DashboardData = {
	readonly news: readonly NewsItem[]
	readonly recent: readonly InstanceSummary[]
	readonly favorites: readonly InstanceSummary[]
	readonly installedVersions: readonly VersionEntry[]
	readonly featuredMods: readonly ModrinthProject[]
	readonly featuredShaders: readonly ModrinthProject[]
	readonly featuredResourcePacks: readonly ModrinthProject[]
	readonly statistics: PlayStatistics
	readonly account: Account | null
	readonly update: UpdateStatus
	readonly pluginCards: readonly PluginCard[]
}

export type LaunchState =
	| "preparing"
	| "resolving"
	| "downloading"
	| "installing"
	| "launching"
	| "running"
	| "exited"
	| "error"

export type LaunchProgress = {
	readonly instanceId: string
	readonly state: LaunchState
	readonly detail: string
	readonly fraction: number
	readonly exitCode: number | null
}

export type LaunchResult = {
	readonly instanceId: string
	readonly started: boolean
	readonly pid: number | null
	readonly message: string | null
}

export type ToastKind = "info" | "success" | "warning" | "error"

export type Toast = {
	readonly id: string
	readonly kind: ToastKind
	readonly message: string
	readonly detail: string | null
}
