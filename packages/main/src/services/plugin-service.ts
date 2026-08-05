import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import type {
	InstanceSummary,
	PluginCard,
	PluginInfo,
	Settings,
	ToastKind,
} from "@halcyon/ipc"
import type { EventBus } from "../infra/events.ts"
import type { JsonStore } from "../infra/json-store.ts"
import type { Logger } from "../infra/logger.ts"
import type { AppPaths } from "../infra/paths.ts"
import { pathExists } from "../infra/fs-extra.ts"

export const PLUGIN_API_VERSION = 1

export const PLUGIN_MANIFEST = "halcyon.plugin.json"

export type PluginState = { disabled: string[] }

export const DEFAULT_PLUGIN_STATE: PluginState = { disabled: [] }

export type PluginManifest = {
	readonly id: string
	readonly name: string
	readonly version: string
	readonly description?: string
	readonly author?: string
	readonly apiVersion: number
	readonly main: string
}

export type PluginHostEvent =
	| "launch:progress"
	| "instances:changed"
	| "downloads:changed"
	| "settings:changed"

export type PluginContext = {
	readonly launcher: { readonly name: string; readonly version: string; readonly apiVersion: number }
	readonly plugin: { readonly id: string; readonly directory: string }
	log(message: string): void
	on(event: PluginHostEvent, listener: (payload: unknown) => void): void
	registerCard(card: { title: string; body: string; accent?: string | null }): void
	notify(kind: ToastKind, message: string, detail?: string | null): void
	instances(): Promise<readonly InstanceSummary[]>
	settings(): Promise<Settings>
}

export type PluginModule = {
	activate?: (context: PluginContext) => void | Promise<void>
	deactivate?: () => void | Promise<void>
}

type LoadedPlugin = {
	info: PluginInfo
	cards: PluginCard[]
	disposers: (() => void)[]
	deactivate?: () => void | Promise<void>
}

export class PluginService {
	private readonly paths: AppPaths
	private readonly logger: Logger
	private readonly events: EventBus
	private readonly store: JsonStore<PluginState>
	private readonly host: {
		appVersion: string
		instances: () => Promise<readonly InstanceSummary[]>
		settings: () => Promise<Settings>
	}
	private readonly loaded = new Map<string, LoadedPlugin>()

	constructor(dependencies: {
		paths: AppPaths
		logger: Logger
		events: EventBus
		store: JsonStore<PluginState>
		host: {
			appVersion: string
			instances: () => Promise<readonly InstanceSummary[]>
			settings: () => Promise<Settings>
		}
	}) {
		this.paths = dependencies.paths
		this.logger = dependencies.logger
		this.events = dependencies.events
		this.store = dependencies.store
		this.host = dependencies.host
	}

	private async manifests(): Promise<readonly { directory: string; manifest: PluginManifest }[]> {
		let directories: string[] = []
		try {
			directories = (await readdir(this.paths.plugins, { withFileTypes: true }))
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name)
		} catch {
			return []
		}

		const found: { directory: string; manifest: PluginManifest }[] = []
		for (const name of directories) {
			const directory = join(this.paths.plugins, name)
			const manifestPath = join(directory, PLUGIN_MANIFEST)
			if (!(await pathExists(manifestPath))) {
				continue
			}
			try {
				const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as PluginManifest
				found.push({ directory, manifest })
			} catch (error) {
				this.logger.warn(`Could not read the plugin manifest in ${name}`, error)
			}
		}
		return found
	}

	private context(manifest: PluginManifest, directory: string, record: LoadedPlugin): PluginContext {
		return {
			launcher: { name: "Halcyon", version: this.host.appVersion, apiVersion: PLUGIN_API_VERSION },
			plugin: { id: manifest.id, directory },
			log: (message: string) => {
				this.logger.info(`[${manifest.id}] ${message}`)
			},
			on: (event, listener) => {
				const dispose = this.events.on(event, listener as (payload: never) => void)
				record.disposers.push(dispose)
			},
			registerCard: (card) => {
				record.cards.push({
					pluginId: manifest.id,
					title: card.title,
					body: card.body,
					accent: card.accent ?? null,
				})
				void this.publish()
			},
			notify: (kind, message, detail = null) => {
				this.events.toast(kind, message, detail)
			},
			instances: () => this.host.instances(),
			settings: () => this.host.settings(),
		}
	}

	async reload(): Promise<readonly PluginInfo[]> {
		await this.unloadAll()

		const { disabled } = await this.store.read()
		for (const { directory, manifest } of await this.manifests()) {
			const enabled = !disabled.includes(manifest.id)
			const record: LoadedPlugin = {
				info: {
					id: manifest.id,
					name: manifest.name,
					version: manifest.version,
					description: manifest.description ?? null,
					author: manifest.author ?? null,
					apiVersion: manifest.apiVersion,
					enabled,
					directory,
					error: null,
					contributedCards: [],
				},
				cards: [],
				disposers: [],
			}
			this.loaded.set(manifest.id, record)

			if (!enabled) {
				continue
			}
			if (manifest.apiVersion !== PLUGIN_API_VERSION) {
				record.info = {
					...record.info,
					error: `This plugin targets API version ${manifest.apiVersion}; Halcyon provides ${PLUGIN_API_VERSION}`,
				}
				continue
			}

			const entry = join(directory, manifest.main)
			if (!(await pathExists(entry))) {
				record.info = { ...record.info, error: `Missing entry point ${manifest.main}` }
				continue
			}

			try {
				const imported = (await import(/* @vite-ignore */ pathToFileURL(entry).href)) as {
					default?: PluginModule
				} & PluginModule
				const plugin = imported.default ?? imported
				await plugin.activate?.(this.context(manifest, directory, record))
				record.deactivate = plugin.deactivate
				this.logger.info(`Loaded plugin ${manifest.name} ${manifest.version}`)
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				record.info = { ...record.info, error: message }
				this.logger.warn(`Plugin ${manifest.id} failed to activate`, error)
			}
		}

		return this.publish()
	}

	private async unloadAll(): Promise<void> {
		for (const record of this.loaded.values()) {
			for (const dispose of record.disposers) {
				dispose()
			}
			try {
				await record.deactivate?.()
			} catch (error) {
				this.logger.warn(`Plugin ${record.info.id} failed to deactivate`, error)
			}
		}
		this.loaded.clear()
	}

	private publish(): readonly PluginInfo[] {
		const infos = [...this.loaded.values()]
			.map((record) => ({ ...record.info, contributedCards: [...record.cards] }))
			.sort((left, right) => left.name.localeCompare(right.name))
		this.events.emit("plugins:changed", infos)
		return infos
	}

	list(): readonly PluginInfo[] {
		return [...this.loaded.values()]
			.map((record) => ({ ...record.info, contributedCards: [...record.cards] }))
			.sort((left, right) => left.name.localeCompare(right.name))
	}

	cards(): readonly PluginCard[] {
		return [...this.loaded.values()].flatMap((record) => record.cards)
	}

	async setEnabled(pluginId: string, enabled: boolean): Promise<readonly PluginInfo[]> {
		await this.store.update((current) => ({
			disabled: enabled
				? current.disabled.filter((id) => id !== pluginId)
				: [...new Set([...current.disabled, pluginId])],
		}))
		return this.reload()
	}

	async dispose(): Promise<void> {
		await this.unloadAll()
	}
}
