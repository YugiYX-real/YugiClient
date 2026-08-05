export type LoaderId = "vanilla" | "fabric" | "quilt" | "forge" | "neoforge"

export type OsName = "windows" | "osx" | "linux"

export type OsArch = "x86" | "x86_64" | "arm64" | "arm32"

export type HostPlatform = {
	readonly os: OsName
	readonly arch: OsArch
	readonly version: string
}

export type RuleAction = "allow" | "disallow"

export type RuleOsConstraint = {
	readonly name?: string
	readonly version?: string
	readonly arch?: string
}

export type FeatureSet = Readonly<Record<string, boolean>>

export type Rule = {
	readonly action: RuleAction
	readonly os?: RuleOsConstraint
	readonly features?: Readonly<Record<string, boolean>>
}

export type Artifact = {
	readonly path?: string
	readonly url: string
	readonly sha1?: string
	readonly size?: number
}

export type LibraryDownloads = {
	readonly artifact?: Artifact
	readonly classifiers?: Readonly<Record<string, Artifact>>
}

export type Library = {
	readonly name: string
	readonly downloads?: LibraryDownloads
	readonly natives?: Readonly<Record<string, string>>
	readonly rules?: readonly Rule[]
	readonly extract?: { readonly exclude?: readonly string[] }
	readonly url?: string
}

export type ConditionalArgument = {
	readonly rules: readonly Rule[]
	readonly value: string | readonly string[]
}

export type ArgumentEntry = string | ConditionalArgument

export type AssetIndexReference = {
	readonly id: string
	readonly url: string
	readonly sha1: string
	readonly size: number
	readonly totalSize?: number
}

export type LoggingClientConfig = {
	readonly argument: string
	readonly file: Artifact & { readonly id: string }
	readonly type: string
}

export type JavaVersionRequirement = {
	readonly component: string
	readonly majorVersion: number
}

export type VersionType = "release" | "snapshot" | "old_beta" | "old_alpha"

export type VersionJson = {
	readonly id: string
	readonly inheritsFrom?: string
	readonly type?: VersionType | string
	readonly mainClass?: string
	readonly assets?: string
	readonly assetIndex?: AssetIndexReference
	readonly javaVersion?: JavaVersionRequirement
	readonly libraries?: readonly Library[]
	readonly arguments?: {
		readonly jvm?: readonly ArgumentEntry[]
		readonly game?: readonly ArgumentEntry[]
	}
	readonly minecraftArguments?: string
	readonly downloads?: Readonly<Record<string, Artifact>>
	readonly logging?: { readonly client?: LoggingClientConfig }
	readonly releaseTime?: string
	readonly time?: string
	readonly complianceLevel?: number
	readonly minimumLauncherVersion?: number
}

export type VersionManifestEntry = {
	readonly id: string
	readonly type: VersionType | string
	readonly url: string
	readonly time: string
	readonly releaseTime: string
	readonly sha1?: string
	readonly complianceLevel?: number
}

export type VersionManifest = {
	readonly latest: { readonly release: string; readonly snapshot: string }
	readonly versions: readonly VersionManifestEntry[]
}

export type AssetObject = {
	readonly hash: string
	readonly size: number
}

export type AssetIndex = {
	readonly objects: Readonly<Record<string, AssetObject>>
	readonly virtual?: boolean
	readonly map_to_resources?: boolean
}
