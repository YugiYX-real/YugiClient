import type { InstanceSummary, Settings, ToastKind } from "@halcyon/ipc"

export const PLUGIN_API_VERSION = 1

export const PLUGIN_MANIFEST_FILE = "halcyon.plugin.json"

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

export type PluginCardInput = {
	title: string
	body: string
	accent?: string | null
}

export type PluginContext = {
	readonly launcher: {
		readonly name: string
		readonly version: string
		readonly apiVersion: number
	}
	readonly plugin: { readonly id: string; readonly directory: string }
	log(message: string): void
	on(event: PluginHostEvent, listener: (payload: unknown) => void): void
	registerCard(card: PluginCardInput): void
	notify(kind: ToastKind, message: string, detail?: string | null): void
	instances(): Promise<readonly InstanceSummary[]>
	settings(): Promise<Settings>
}

export type PluginModule = {
	activate?: (context: PluginContext) => void | Promise<void>
	deactivate?: () => void | Promise<void>
}

export function definePlugin(plugin: PluginModule): PluginModule {
	return plugin
}

export function supportsApiVersion(manifest: PluginManifest): boolean {
	return manifest.apiVersion === PLUGIN_API_VERSION
}

export type { InstanceSummary, Settings, ToastKind }
