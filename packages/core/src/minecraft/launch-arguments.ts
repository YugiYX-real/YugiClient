import { isAllowedByRules } from "./rules.ts"
import { resolveLibraries } from "./libraries.ts"
import type { ArgumentEntry, FeatureSet, HostPlatform, VersionJson } from "./types.ts"

export type UserType = "msa" | "mojang" | "legacy"

export type LaunchSession = {
	readonly username: string
	readonly uuid: string
	readonly accessToken: string
	readonly userType: UserType
	readonly xuid?: string
	readonly clientId?: string
}

export type LaunchPaths = {
	readonly gameDir: string
	readonly assetsDir: string
	readonly librariesDir: string
	readonly nativesDir: string
	readonly clientJar: string
	readonly legacyAssetsDir?: string
}

export type WindowOptions = {
	readonly width?: number
	readonly height?: number
	readonly fullscreen?: boolean
}

export type QuickPlay =
	| { readonly kind: "singleplayer"; readonly world: string }
	| { readonly kind: "multiplayer"; readonly address: string }
	| { readonly kind: "realms"; readonly realmId: string }

export type MemoryOptions = {
	readonly maxMb: number
	readonly minMb?: number
}

export type LaunchRequest = {
	readonly version: VersionJson
	readonly platform: HostPlatform
	readonly javaExecutable: string
	readonly paths: LaunchPaths
	readonly session: LaunchSession
	readonly memory: MemoryOptions
	readonly launcher: { readonly name: string; readonly version: string }
	readonly extraJvmArgs?: readonly string[]
	readonly extraGameArgs?: readonly string[]
	readonly window?: WindowOptions
	readonly quickPlay?: QuickPlay
	readonly log4jConfigPath?: string
	readonly demo?: boolean
}

export type LaunchInvocation = {
	readonly executable: string
	readonly args: readonly string[]
	readonly mainClass: string
	readonly classpath: readonly string[]
	readonly workingDirectory: string
}

export class MissingMainClassError extends Error {
	readonly versionId: string

	constructor(versionId: string) {
		super(`Version "${versionId}" has no mainClass; the version manifest is incomplete`)
		this.name = "MissingMainClassError"
		this.versionId = versionId
	}
}

const PLACEHOLDER_PATTERN = /\$\{([A-Za-z0-9_]+)\}/g

const MEMORY_FLAG_PATTERN = /^-Xm[sx]/i

export function classpathSeparator(platform: HostPlatform): string {
	return platform.os === "windows" ? ";" : ":"
}

export function substitutePlaceholders(
	value: string,
	variables: Readonly<Record<string, string>>,
): string {
	return value.replace(PLACEHOLDER_PATTERN, (match, name: string) => {
		const replacement = variables[name]
		return replacement === undefined ? match : replacement
	})
}

export function resolveArgumentEntries(
	entries: readonly ArgumentEntry[] | undefined,
	platform: HostPlatform,
	features: FeatureSet,
	variables: Readonly<Record<string, string>>,
): readonly string[] {
	if (entries === undefined) {
		return []
	}

	const resolved: string[] = []
	for (const entry of entries) {
		if (typeof entry === "string") {
			resolved.push(substitutePlaceholders(entry, variables))
			continue
		}
		if (!isAllowedByRules(entry.rules, platform, features)) {
			continue
		}
		const values = typeof entry.value === "string" ? [entry.value] : entry.value
		for (const value of values) {
			resolved.push(substitutePlaceholders(value, variables))
		}
	}
	return resolved
}

export function parseLegacyArguments(
	minecraftArguments: string,
	variables: Readonly<Record<string, string>>,
): readonly string[] {
	return minecraftArguments
		.split(/\s+/)
		.filter((token) => token.length > 0)
		.map((token) => substitutePlaceholders(token, variables))
}

export function buildFeatureSet(request: LaunchRequest): FeatureSet {
	const window = request.window
	const quickPlay = request.quickPlay
	return {
		is_demo_user: request.demo === true,
		has_custom_resolution:
			window !== undefined && window.width !== undefined && window.height !== undefined,
		has_quick_plays_support: quickPlay !== undefined,
		is_quick_play_singleplayer: quickPlay?.kind === "singleplayer",
		is_quick_play_multiplayer: quickPlay?.kind === "multiplayer",
		is_quick_play_realms: quickPlay?.kind === "realms",
	}
}

export function buildClasspath(request: LaunchRequest): readonly string[] {
	const { version, platform, paths } = request
	const separator = platform.os === "windows" ? "\\" : "/"
	const entries = resolveLibraries(version.libraries, platform, buildFeatureSet(request))
		.filter((entry) => !entry.native)
		.map(
			(entry) =>
				`${paths.librariesDir}${separator}${entry.relativePath.replaceAll("/", separator)}`,
		)

	return [...entries, paths.clientJar]
}

function defaultJvmArguments(): readonly ArgumentEntry[] {
	return [
		"-Djava.library.path=${natives_directory}",
		"-Dminecraft.launcher.brand=${launcher_name}",
		"-Dminecraft.launcher.version=${launcher_version}",
		"-cp",
		"${classpath}",
	]
}

export function buildPlaceholderVariables(
	request: LaunchRequest,
	classpath: readonly string[],
): Readonly<Record<string, string>> {
	const { version, paths, session, platform, window, launcher, quickPlay } = request
	const separator = classpathSeparator(platform)

	const variables: Record<string, string> = {
		auth_player_name: session.username,
		auth_uuid: session.uuid,
		auth_access_token: session.accessToken,
		auth_session: `token:${session.accessToken}:${session.uuid}`,
		auth_xuid: session.xuid ?? "",
		clientid: session.clientId ?? "",
		user_type: session.userType,
		user_properties: "{}",
		version_name: version.id,
		version_type: String(version.type ?? "release"),
		game_directory: paths.gameDir,
		assets_root: paths.assetsDir,
		game_assets: paths.legacyAssetsDir ?? paths.assetsDir,
		assets_index_name: version.assetIndex?.id ?? version.assets ?? "legacy",
		natives_directory: paths.nativesDir,
		library_directory: paths.librariesDir,
		primary_jar: paths.clientJar,
		classpath: classpath.join(separator),
		classpath_separator: separator,
		launcher_name: launcher.name,
		launcher_version: launcher.version,
		resolution_width: String(window?.width ?? ""),
		resolution_height: String(window?.height ?? ""),
	}

	if (quickPlay !== undefined) {
		variables.quickPlayPath = "quickPlay/log.json"
		variables.quickPlaySingleplayer = quickPlay.kind === "singleplayer" ? quickPlay.world : ""
		variables.quickPlayMultiplayer = quickPlay.kind === "multiplayer" ? quickPlay.address : ""
		variables.quickPlayRealms = quickPlay.kind === "realms" ? quickPlay.realmId : ""
	}

	return variables
}

function memoryArguments(memory: MemoryOptions): readonly string[] {
	const args = [`-Xmx${Math.max(512, Math.round(memory.maxMb))}M`]
	if (memory.minMb !== undefined) {
		args.unshift(`-Xms${Math.max(256, Math.round(memory.minMb))}M`)
	}
	return args
}

function windowArguments(window: WindowOptions | undefined): readonly string[] {
	if (window === undefined) {
		return []
	}
	if (window.fullscreen === true) {
		return ["--fullscreen"]
	}
	if (window.width !== undefined && window.height !== undefined) {
		return ["--width", String(window.width), "--height", String(window.height)]
	}
	return []
}

function quickPlayArguments(quickPlay: QuickPlay | undefined): readonly string[] {
	if (quickPlay === undefined) {
		return []
	}
	switch (quickPlay.kind) {
		case "singleplayer":
			return ["--quickPlaySingleplayer", quickPlay.world]
		case "multiplayer":
			return ["--quickPlayMultiplayer", quickPlay.address]
		case "realms":
			return ["--quickPlayRealms", quickPlay.realmId]
	}
}

export function buildLaunchInvocation(request: LaunchRequest): LaunchInvocation {
	const { version, platform } = request
	const mainClass = version.mainClass
	if (mainClass === undefined || mainClass === "") {
		throw new MissingMainClassError(version.id)
	}

	const features = buildFeatureSet(request)
	const classpath = buildClasspath(request)
	const variables = buildPlaceholderVariables(request, classpath)

	const versionJvmArgs = resolveArgumentEntries(
		version.arguments?.jvm ?? defaultJvmArguments(),
		platform,
		features,
		variables,
	)

	const userJvmArgs = (request.extraJvmArgs ?? []).filter((arg) => !MEMORY_FLAG_PATTERN.test(arg))

	const loggingArgs =
		request.log4jConfigPath === undefined || version.logging?.client === undefined
			? []
			: [
					substitutePlaceholders(version.logging.client.argument, {
						path: request.log4jConfigPath,
					}),
				]

	const gameArgs =
		version.arguments?.game !== undefined
			? resolveArgumentEntries(version.arguments.game, platform, features, variables)
			: version.minecraftArguments !== undefined
				? parseLegacyArguments(version.minecraftArguments, variables)
				: []

	const hasVersionResolution = gameArgs.includes("--width")

	const args = [
		...memoryArguments(request.memory),
		...userJvmArgs,
		...loggingArgs,
		...versionJvmArgs,
		mainClass,
		...gameArgs,
		...(hasVersionResolution ? [] : windowArguments(request.window)),
		...quickPlayArguments(request.quickPlay),
		...(request.demo === true && !gameArgs.includes("--demo") ? ["--demo"] : []),
		...(request.extraGameArgs ?? []),
	]

	return {
		executable: request.javaExecutable,
		args,
		mainClass,
		classpath,
		workingDirectory: request.paths.gameDir,
	}
}

export function redactInvocation(invocation: LaunchInvocation, secret: string): LaunchInvocation {
	if (secret === "") {
		return invocation
	}
	return {
		...invocation,
		args: invocation.args.map((arg) => arg.replaceAll(secret, "[redacted]")),
	}
}
