import { app, dialog, ipcMain, shell } from "electron"
import { readFile, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { IPC_CHANNELS } from "@halcyon/ipc"
import type {
	AppInfo,
	ContentKind,
	InstanceSummary,
	IpcArgs,
	IpcChannel,
	IpcResult,
	JavaRuntime,
	LoaderId,
	Settings,
} from "@halcyon/ipc"
import type { Container } from "../container.ts"
import { contentFolder } from "../services/content-service.ts"

type Handler<K extends IpcChannel> = (...args: IpcArgs<K>) => IpcResult<K> | Promise<IpcResult<K>>

type Handlers = { [K in IpcChannel]: Handler<K> }

async function pickDirectory(): Promise<string | null> {
	const result = await dialog.showOpenDialog({
		properties: ["openDirectory", "createDirectory"],
	})
	return result.canceled ? null : (result.filePaths[0] ?? null)
}

async function pickFiles(
	name: string,
	extensions: readonly string[],
	multiple: boolean,
): Promise<readonly string[]> {
	const result = await dialog.showOpenDialog({
		properties: multiple ? ["openFile", "multiSelections"] : ["openFile"],
		filters: [{ name, extensions: [...extensions] }],
	})
	return result.canceled ? [] : result.filePaths
}

async function pickSavePath(
	defaultPath: string,
	name: string,
	extension: string,
): Promise<string | null> {
	const result = await dialog.showSaveDialog({
		defaultPath,
		filters: [{ name, extensions: [extension] }],
	})
	return result.canceled ? null : (result.filePath ?? null)
}

export function registerIpc(container: Container): void {
	const {
		auth,
		backups,
		build,
		content,
		dashboard,
		downloads,
		events,
		instances,
		java,
		launch,
		loaders,
		logger,
		logs,
		modrinth,
		paths,
		platform,
		plugins,
		settings,
		skins,
		statistics,
		updates,
		versionChanges,
		versions,
	} = container

	void statistics

	const prepareInstance = (summary: InstanceSummary): void => {
		void (async () => {
			const progress = (detail: string, fraction: number): void => {
				events.emit("launch:progress", {
					instanceId: summary.id,
					state: "installing",
					detail,
					fraction,
					exitCode: null,
				})
			}
			try {
				if (summary.loader === "vanilla") {
					await versions.install(summary.gameVersion, progress)
				} else {
					await loaders.install(
						summary.loader,
						summary.gameVersion,
						summary.loaderVersion,
						progress,
					)
				}
				events.emit("launch:progress", {
					instanceId: summary.id,
					state: "exited",
					detail: `${summary.name} is ready to play`,
					fraction: 1,
					exitCode: null,
				})
				events.toast("success", `${summary.name} is ready to play`)
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				logger.warn(`Could not prepare ${summary.name}`, error)
				events.emit("launch:progress", {
					instanceId: summary.id,
					state: "error",
					detail: message,
					fraction: 1,
					exitCode: null,
				})
				events.toast("error", `Could not prepare ${summary.name}`, message)
			}
		})()
	}

	const kindOfVersion = async (versionId: string): Promise<ContentKind> => {
		const version = await modrinth.version(versionId)
		if (version === undefined) {
			return "mod"
		}
		const project = await modrinth.project(version.projectId).catch(() => undefined)
		return project?.projectType ?? "mod"
	}

	const appInfo = (): AppInfo => ({
		name: "Halcyon",
		version: build.version,
		buildNumber: build.buildNumber,
		commit: build.commit,
		buildTime: build.buildTime,
		platform: platform.os,
		arch: process.arch,
		dataDirectory: paths.root,
		electronVersion: process.versions.electron ?? "unknown",
		nodeVersion: process.versions.node,
	})

	const handlers: Handlers = {
		"app:info": () => appInfo(),
		"app:openPath": (target: string) => {
			void shell.openPath(target)
		},
		"app:openExternal": (url: string) => {
			void shell.openExternal(url)
		},
		"app:relaunch": () => {
			app.relaunch()
			app.exit(0)
		},

		"settings:get": () => settings.get(),
		"settings:update": (patch: Partial<Settings>) => settings.update(patch),
		"settings:pickDirectory": async (purpose) => {
			const chosen = await pickDirectory()
			if (chosen === null) {
				return null
			}
			if (purpose === "download") {
				await settings.update({ downloadDirectory: chosen })
			}
			if (purpose === "screenshot") {
				await settings.update({ screenshotDirectory: chosen })
			}
			return chosen
		},
		"settings:pickImage": async () => {
			const files = await pickFiles("Images", ["png", "jpg", "jpeg", "webp"], false)
			return files[0] ?? null
		},
		"settings:reset": () => settings.reset(),

		"dashboard:load": () => dashboard.load(),

		"versions:list": (filter) => versions.list(filter),
		"versions:refresh": async () => {
			await versions.manifest(true)
			return versions.list({})
		},
		"versions:favorite": async (versionId: string, favorite: boolean) => {
			await versions.setFavorite(versionId, favorite)
			return versions.list({})
		},
		"versions:install": (versionId: string) => versions.install(versionId),
		"versions:delete": async (versionId: string) => {
			await versions.remove(versionId)
			return versions.list({})
		},
		"versions:verify": (versionId: string) => versions.verify(versionId, true),
		"loaders:list": (loader: LoaderId, gameVersion: string) =>
			loaders.list(loader, gameVersion),

		"instances:list": () => instances.list(),
		"instances:get": async (instanceId: string) => {
			try {
				return await instances.get(instanceId)
			} catch {
				return null
			}
		},
		"instances:create": async (input) => {
			const summary = await instances.create(input)
			if (input.install !== false) {
				prepareInstance(summary)
			}
			return summary
		},
		"instances:update": (instanceId: string, patch) => instances.update(instanceId, patch),
		"instances:delete": async (instanceId: string) => {
			await instances.remove(instanceId)
			return instances.list()
		},
		"instances:duplicate": (instanceId: string, name: string | null) =>
			instances.duplicate(instanceId, name ?? undefined),
		"instances:rename": (instanceId: string, name: string) =>
			instances.rename(instanceId, name),
		"instances:assessVersionChange": (instanceId: string, request) =>
			versionChanges.assess(instanceId, request),
		"instances:changeVersion": (instanceId: string, request) =>
			versionChanges.change(instanceId, request),
		"instances:repair": async (instanceId: string) => {
			const config = await instances.config(instanceId)
			return versions.verify(config.gameVersion, true)
		},
		"instances:verify": async (instanceId: string) => {
			const config = await instances.config(instanceId)
			return versions.verify(config.gameVersion, false)
		},
		"instances:export": async (instanceId: string) => {
			const config = await instances.config(instanceId)
			const target = await pickSavePath(
				join(paths.exports, `${config.name}.halcyon.zip`),
				"Halcyon instance",
				"zip",
			)
			if (target === null) {
				return null
			}
			return instances.exportInstance(instanceId, target)
		},
		"instances:import": async () => {
			const files = await pickFiles("Halcyon instance", ["zip"], true)
			for (const file of files) {
				await instances.importInstance(file)
			}
			return instances.list()
		},
		"instances:importOfficial": async () => {
			await instances.importOfficial()
			return instances.list()
		},
		"instances:openFolder": (instanceId: string, subFolder: string | null) => {
			const target =
				subFolder === null
					? instances.directory(instanceId)
					: instances.contentDirectory(instanceId, subFolder)
			void shell.openPath(target)
		},
		"instances:launch": (instanceId: string, accountId: string | null) =>
			launch.launch(instanceId, accountId),
		"instances:stop": (instanceId: string) => {
			void launch.stop(instanceId)
		},
		"instances:worlds": (instanceId: string) => instances.worlds(instanceId),
		"instances:screenshots": (instanceId: string) => instances.screenshots(instanceId),
		"instances:backups": (instanceId: string) => backups.list(instanceId),
		"instances:createBackup": async (instanceId: string, note: string) => {
			await backups.create(instanceId, note)
			return backups.list(instanceId)
		},
		"instances:restoreBackup": async (instanceId: string, backupId: string) => {
			await backups.restore(instanceId, backupId)
			return instances.get(instanceId)
		},
		"instances:deleteBackup": async (instanceId: string, backupId: string) => {
			await backups.remove(instanceId, backupId)
			return backups.list(instanceId)
		},

		"content:list": (instanceId: string, kind: ContentKind) => content.list(instanceId, kind),
		"content:setEnabled": async (instanceId, kind, fileNames, enabled) => {
			await content.setEnabled(instanceId, kind, fileNames, enabled)
			return content.list(instanceId, kind)
		},
		"content:delete": async (instanceId, kind, fileNames) => {
			await content.remove(instanceId, kind, fileNames)
			return content.list(instanceId, kind)
		},
		"content:import": async (instanceId, kind, filePaths) => {
			const chosen =
				filePaths.length > 0
					? filePaths
					: await pickFiles(
							kind === "mod" ? "Mod files" : "Archives",
							kind === "mod" ? ["jar"] : ["zip", "jar"],
							true,
						)
			if (chosen.length > 0) {
				await content.importFiles(instanceId, kind, chosen)
			}
			return content.list(instanceId, kind)
		},
		"content:checkUpdates": (instanceId, kind) => content.checkUpdates(instanceId, kind),
		"content:applyUpdates": (instanceId, kind, fileNames) =>
			content.applyUpdates(instanceId, kind, fileNames),
		"content:analyze": (instanceId: string) => content.analyze(instanceId),
		"content:openFolder": (instanceId: string, kind: ContentKind) => {
			void shell.openPath(instances.contentDirectory(instanceId, contentFolder(kind)))
		},

		"modrinth:search": (query) => modrinth.search(query),
		"modrinth:project": (idOrSlug: string) => modrinth.project(idOrSlug),
		"modrinth:versions": (projectId, gameVersion, loader) =>
			modrinth.versions(projectId, gameVersion, loader),
		"modrinth:categories": (kind: ContentKind) => modrinth.categories(kind),
		"modrinth:install": async (instanceId, versionId, withDependencies) => {
			const kind = await kindOfVersion(versionId)
			return content.installFromModrinth(instanceId, kind, versionId, withDependencies)
		},

		"accounts:list": () => auth.list(),
		"accounts:loginMicrosoft": () => auth.loginMicrosoft(),
		"accounts:addOffline": (username: string) => auth.addOffline(username),
		"accounts:remove": (accountId: string) => auth.remove(accountId),
		"accounts:select": (accountId: string) => auth.select(accountId),
		"accounts:update": (accountId: string, patch) => auth.update(accountId, patch),
		"accounts:refresh": (accountId: string) => auth.refresh(accountId),
		"accounts:export": async () => {
			const target = await pickSavePath(
				join(paths.exports, "halcyon-accounts.json"),
				"Account list",
				"json",
			)
			if (target === null) {
				return null
			}
			await writeFile(target, await auth.exportAccounts(), "utf8")
			return target
		},
		"accounts:import": async () => {
			const files = await pickFiles("Account list", ["json"], false)
			const file = files[0]
			if (file === undefined) {
				return auth.list()
			}
			return auth.importAccounts(await readFile(file, "utf8"))
		},

		"skins:list": () => skins.list(),
		"skins:upload": async (input) => {
			const filePath = input.filePath ?? (await pickFiles("Skin", ["png"], false))[0]
			if (filePath === undefined) {
				return skins.list()
			}
			await skins.upload({ ...input, filePath })
			return skins.list()
		},
		"skins:apply": async (skinId: string) => {
			const account = await auth.selected()
			if (account === undefined) {
				throw new Error("Select a Microsoft account before applying a skin")
			}
			await skins.apply(account.id, skinId)
			return skins.list()
		},
		"skins:remove": (skinId: string) => skins.remove(skinId),
		"skins:favorite": (skinId: string, favorite: boolean) =>
			skins.setFavorite(skinId, favorite),
		"skins:download": async (skinId: string) => {
			if (skinId === "account") {
				const account = await auth.selected()
				if (account === undefined) {
					return null
				}
				const imported = await skins.downloadFromAccount(account.id)
				return imported?.filePath ?? null
			}

			const entry = (await skins.list()).find((candidate) => candidate.id === skinId)
			if (entry === undefined) {
				return null
			}
			const target = await pickSavePath(basename(entry.filePath), "Skin", "png")
			if (target === null) {
				return null
			}
			await writeFile(target, await readFile(entry.filePath))
			return target
		},

		"java:list": () => java.detect(),
		"java:detect": () => java.detect(),
		"java:install": async (major: number) => {
			await java.install(major)
			return java.detect()
		},
		"java:validate": (executablePath: string) => java.validate(executablePath),
		"java:pick": async (): Promise<JavaRuntime | null> => {
			const files = await pickFiles(
				"Java executable",
				platform.os === "windows" ? ["exe"] : ["*"],
				false,
			)
			const file = files[0]
			return file === undefined ? null : java.validate(file)
		},

		"downloads:snapshot": () => downloads.snapshot(),
		"downloads:pause": () => downloads.pause(),
		"downloads:resume": () => downloads.resume(),
		"downloads:retryFailed": () => downloads.retryFailed(),
		"downloads:cancel": (itemId: string | null) => downloads.cancel(itemId),

		"logs:read": (query) => logs.read(query),
		"logs:export": (query) => logs.export(query),
		"logs:analyze": (instanceId: string) => logs.analyze(instanceId),

		"updates:status": () => updates.current(),
		"updates:check": () => updates.check(),
		"updates:download": () => updates.download(),
		"updates:install": () => {
			updates.install()
		},
		"updates:rollback": () => updates.rollback(),

		"plugins:list": () => plugins.list(),
		"plugins:setEnabled": (pluginId: string, enabled: boolean) =>
			plugins.setEnabled(pluginId, enabled),
		"plugins:reload": () => plugins.reload(),
		"plugins:openFolder": () => {
			void shell.openPath(paths.plugins)
		},
	}

	for (const channel of IPC_CHANNELS) {
		ipcMain.removeHandler(channel)
		ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
			const handler = handlers[channel] as (...values: unknown[]) => unknown
			try {
				return await handler(...args)
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				logger.warn(`${channel} failed`, error)
				events.toast("error", message)
				throw error
			}
		})
	}

	logger.info(`Registered ${IPC_CHANNELS.length} IPC channels`)
}
