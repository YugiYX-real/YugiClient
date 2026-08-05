declare const __APP_VERSION__: string
declare const __BUILD_NUMBER__: string
declare const __COMMIT_SHA__: string
declare const __BUILD_TIME__: string

export type BuildInfo = {
	readonly version: string
	readonly buildNumber: string
	readonly commit: string
	readonly buildTime: string
}

export function buildInfo(fallbackVersion: string): BuildInfo {
	return {
		version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : fallbackVersion,
		buildNumber: typeof __BUILD_NUMBER__ === "string" ? __BUILD_NUMBER__ : "0",
		commit: typeof __COMMIT_SHA__ === "string" ? __COMMIT_SHA__ : "local",
		buildTime: typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__ : new Date().toISOString(),
	}
}
