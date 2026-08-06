export type RouteId =
	| "dashboard"
	| "instances"
	| "discover"
	| "accounts"
	| "skins"
	| "java"
	| "downloads"
	| "logs"
	| "plugins"
	| "settings"

export type Navigate = (route: RouteId, instanceId?: string) => void

export const ROUTE_TITLES: Record<RouteId, { title: string; subtitle: string }> = {
	dashboard: { title: "Dashboard", subtitle: "Everything you need, one glance away" },
	instances: { title: "Instances", subtitle: "Create, tune and launch your worlds" },
	discover: { title: "Discover", subtitle: "Mods, shaders and packs from Modrinth" },
	accounts: { title: "Accounts", subtitle: "Microsoft profiles and automatic sessions" },
	skins: { title: "Skins", subtitle: "Your wardrobe with live preview" },
	java: { title: "Java", subtitle: "Runtimes detected and managed for you" },
	downloads: { title: "Downloads", subtitle: "Queue, speed and failures at a glance" },
	logs: { title: "Logs", subtitle: "Launcher and game output with crash analysis" },
	plugins: { title: "Plugins", subtitle: "Extend Halcyon with your own tools" },
	settings: { title: "Settings", subtitle: "Appearance, defaults and privacy" },
}
