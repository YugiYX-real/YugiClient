import type { RouteId } from "../app/navigation.ts"
import { Icon } from "./Icon.tsx"
import type { IconName } from "./Icon.tsx"

type NavEntry = { readonly route: RouteId; readonly label: string; readonly icon: IconName }

const GROUPS: readonly { readonly label: string; readonly entries: readonly NavEntry[] }[] = [
	{
		label: "Play",
		entries: [
			{ route: "dashboard", label: "Dashboard", icon: "dashboard" },
			{ route: "instances", label: "Instances", icon: "instances" },
			{ route: "discover", label: "Discover", icon: "discover" },
		],
	},
	{
		label: "Profile",
		entries: [
			{ route: "accounts", label: "Accounts", icon: "accounts" },
			{ route: "skins", label: "Skins", icon: "skins" },
		],
	},
	{
		label: "System",
		entries: [
			{ route: "java", label: "Java", icon: "java" },
			{ route: "downloads", label: "Downloads", icon: "downloads" },
			{ route: "logs", label: "Logs", icon: "logs" },
			{ route: "plugins", label: "Plugins", icon: "plugins" },
		],
	},
]

export function Sidebar({
	route,
	onNavigate,
	activeDownloads,
	runningInstances,
	updateReady,
	version,
	build,
}: {
	route: RouteId
	onNavigate: (route: RouteId) => void
	activeDownloads: number
	runningInstances: number
	updateReady: boolean
	version: string
	build: string
}): JSX.Element {
	const badgeFor = (entry: NavEntry): string | null => {
		if (entry.route === "downloads" && activeDownloads > 0) {
			return String(activeDownloads)
		}
		if (entry.route === "instances" && runningInstances > 0) {
			return String(runningInstances)
		}
		return null
	}

	return (
		<aside className="sidebar">
			<div className="brand">
				<div className="brand-mark">H</div>
				<div className="brand-text">
					<strong>Halcyon</strong>
					<span>Launcher</span>
				</div>
			</div>

			<nav className="nav">
				{GROUPS.map((group) => (
					<div key={group.label}>
						<div className="nav-label">{group.label}</div>
						{group.entries.map((entry) => {
							const badge = badgeFor(entry)
							return (
								<button
									key={entry.route}
									type="button"
									className="nav-item"
									aria-current={route === entry.route ? "page" : undefined}
									onClick={() => {
										onNavigate(entry.route)
									}}
								>
									<Icon name={entry.icon} size={17} />
									<span>{entry.label}</span>
									{badge === null ? null : (
										<span className="badge accent">{badge}</span>
									)}
								</button>
							)
						})}
					</div>
				))}
			</nav>

			<button
				type="button"
				className="nav-item"
				aria-current={route === "settings" ? "page" : undefined}
				onClick={() => {
					onNavigate("settings")
				}}
			>
				<Icon name="settings" size={17} />
				<span>Settings</span>
				{updateReady ? <span className="badge success">update</span> : null}
			</button>

			<small style={{ paddingLeft: 11 }}>
				v{version} · build {build}
			</small>
		</aside>
	)
}
