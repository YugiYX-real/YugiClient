import { app } from "electron"
import { homedir, platform } from "node:os"
import { join } from "node:path"
import { mkdir } from "node:fs/promises"

export type AppPaths = {
	readonly root: string
	readonly instances: string
	readonly versions: string
	readonly libraries: string
	readonly assets: string
	readonly assetObjects: string
	readonly assetIndexes: string
	readonly java: string
	readonly cache: string
	readonly logs: string
	readonly backups: string
	readonly skins: string
	readonly plugins: string
	readonly exports: string
	readonly settingsFile: string
	readonly accountsFile: string
	readonly instancesFile: string
	readonly versionMetaFile: string
	readonly skinsFile: string
	readonly pluginStateFile: string
	readonly statisticsFile: string
	readonly launcherLogFile: string
}

export function createAppPaths(root: string = app.getPath("userData")): AppPaths {
	const assets = join(root, "assets")
	return {
		root,
		instances: join(root, "instances"),
		versions: join(root, "versions"),
		libraries: join(root, "libraries"),
		assets,
		assetObjects: join(assets, "objects"),
		assetIndexes: join(assets, "indexes"),
		java: join(root, "java"),
		cache: join(root, "cache"),
		logs: join(root, "logs"),
		backups: join(root, "backups"),
		skins: join(root, "skins"),
		plugins: join(root, "plugins"),
		exports: join(root, "exports"),
		settingsFile: join(root, "settings.json"),
		accountsFile: join(root, "accounts.json"),
		instancesFile: join(root, "instances.json"),
		versionMetaFile: join(root, "version-meta.json"),
		skinsFile: join(root, "skins.json"),
		pluginStateFile: join(root, "plugins.json"),
		statisticsFile: join(root, "statistics.json"),
		launcherLogFile: join(root, "logs", "launcher.log"),
	}
}

export async function ensureAppDirectories(paths: AppPaths): Promise<void> {
	const directories = [
		paths.root,
		paths.instances,
		paths.versions,
		paths.libraries,
		paths.assetObjects,
		paths.assetIndexes,
		paths.java,
		paths.cache,
		paths.logs,
		paths.backups,
		paths.skins,
		paths.plugins,
		paths.exports,
	]
	for (const directory of directories) {
		await mkdir(directory, { recursive: true })
	}
}

export function instanceDirectory(paths: AppPaths, instanceId: string): string {
	return join(paths.instances, instanceId)
}

export function instanceGameDirectory(paths: AppPaths, instanceId: string): string {
	return join(paths.instances, instanceId, "minecraft")
}

export function officialLauncherDirectory(): string {
	const home = homedir()
	switch (platform()) {
		case "win32":
			return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), ".minecraft")
		case "darwin":
			return join(home, "Library", "Application Support", "minecraft")
		default:
			return join(home, ".minecraft")
	}
}
