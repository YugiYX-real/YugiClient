import { useCallback, useEffect, useMemo, useState } from "react"
import type { InstanceSummary } from "@halcyon/ipc"
import { Button, SearchInput } from "../components/primitives.tsx"
import { CommandPalette } from "../components/CommandPalette.tsx"
import type { Command } from "../components/CommandPalette.tsx"
import { Sidebar } from "../components/Sidebar.tsx"
import { ToastStack } from "../components/ToastStack.tsx"
import { DashboardPage } from "../pages/DashboardPage.tsx"
import { InstancesPage } from "../pages/InstancesPage.tsx"
import { InstanceDetailPage } from "../pages/InstanceDetailPage.tsx"
import { DiscoverPage } from "../pages/DiscoverPage.tsx"
import { AccountsPage } from "../pages/AccountsPage.tsx"
import { SkinsPage } from "../pages/SkinsPage.tsx"
import { JavaPage } from "../pages/JavaPage.tsx"
import { DownloadsPage } from "../pages/DownloadsPage.tsx"
import { LogsPage } from "../pages/LogsPage.tsx"
import { PluginsPage } from "../pages/PluginsPage.tsx"
import { SettingsPage } from "../pages/SettingsPage.tsx"
import { invoke } from "../lib/client.ts"
import { useIpcEvent, useKeyboardShortcut, useSettings, useToasts } from "../lib/hooks.ts"
import { applyTheme } from "./theme.ts"
import { ROUTE_TITLES } from "./navigation.ts"
import type { RouteId } from "./navigation.ts"

export function App(): JSX.Element {
	const { settings, update, reset } = useSettings()
	const { toasts, dismiss } = useToasts()
	const [route, setRoute] = useState<RouteId>("dashboard")
	const [instanceId, setInstanceId] = useState<string | null>(null)
	const [instances, setInstances] = useState<readonly InstanceSummary[]>([])
	const [activeDownloads, setActiveDownloads] = useState(0)
	const [updateReady, setUpdateReady] = useState(false)
	const [paletteOpen, setPaletteOpen] = useState(false)
	const [quickSearch, setQuickSearch] = useState("")

	useEffect(() => {
		if (settings !== undefined) {
			applyTheme(settings)
		}
	}, [settings])

	const reloadInstances = useCallback(() => {
		void invoke("instances:list").then(setInstances)
	}, [])

	useEffect(() => {
		reloadInstances()
		void invoke("downloads:snapshot").then((snapshot) => {
			setActiveDownloads(snapshot.totalItems - snapshot.completedItems)
		})
		void invoke("updates:status").then((status) => {
			setUpdateReady(status.state === "ready" || status.state === "available")
		})
	}, [reloadInstances])

	useIpcEvent("instances:changed", reloadInstances)
	useIpcEvent("downloads:changed", (snapshot) => {
		setActiveDownloads(Math.max(0, snapshot.totalItems - snapshot.completedItems))
	})
	useIpcEvent("updates:changed", (status) => {
		setUpdateReady(status.state === "ready" || status.state === "available")
	})
	useIpcEvent("launch:progress", (progress) => {
		if (progress.state === "running" || progress.state === "exited") {
			reloadInstances()
		}
	})

	const navigate = useCallback((next: RouteId, targetInstanceId?: string) => {
		setRoute(next)
		setInstanceId(targetInstanceId ?? null)
	}, [])

	useKeyboardShortcut({ key: "k", meta: true }, () => {
		setPaletteOpen(true)
	})
	useKeyboardShortcut({ key: "1", meta: true }, () => {
		navigate("dashboard")
	})
	useKeyboardShortcut({ key: "2", meta: true }, () => {
		navigate("instances")
	})
	useKeyboardShortcut({ key: "3", meta: true }, () => {
		navigate("discover")
	})
	useKeyboardShortcut({ key: ",", meta: true }, () => {
		navigate("settings")
	})

	const commands = useMemo<readonly Command[]>(() => {
		const routeCommands: Command[] = (Object.keys(ROUTE_TITLES) as RouteId[]).map((id) => ({
			id: `route-${id}`,
			label: `Go to ${ROUTE_TITLES[id].title}`,
			hint: "page",
			icon: "chevron",
			run: () => {
				navigate(id)
			},
		}))

		const instanceCommands: Command[] = instances.flatMap((instance) => [
			{
				id: `launch-${instance.id}`,
				label: `Launch ${instance.name}`,
				hint: `${instance.gameVersion} · ${instance.loader}`,
				icon: "play",
				run: () => {
					void invoke("instances:launch", instance.id, null)
				},
			},
			{
				id: `open-${instance.id}`,
				label: `Open ${instance.name}`,
				hint: "instance",
				icon: "instances",
				run: () => {
					navigate("instances", instance.id)
				},
			},
		])

		const actions: Command[] = [
			{
				id: "action-check-updates",
				label: "Check for launcher updates",
				icon: "refresh",
				run: () => {
					void invoke("updates:check")
				},
			},
			{
				id: "action-refresh-versions",
				label: "Refresh the Minecraft version manifest",
				icon: "cube",
				run: () => {
					void invoke("versions:refresh")
				},
			},
			{
				id: "action-scan-java",
				label: "Scan for Java runtimes",
				icon: "java",
				run: () => {
					void invoke("java:detect")
				},
			},
			{
				id: "action-reload-plugins",
				label: "Reload plugins",
				icon: "plugins",
				run: () => {
					void invoke("plugins:reload")
				},
			},
			{
				id: "action-import-instance",
				label: "Import an instance archive",
				icon: "downloads",
				run: () => {
					void invoke("instances:import")
				},
			},
			{
				id: "action-edit-appearance",
				label: "Edit skin and cape",
				icon: "skins",
				run: () => {
					navigate("skins")
				},
			},
			{
				id: "action-toggle-theme",
				label: "Switch theme",
				icon: "sparkle",
				run: () => {
					if (settings !== undefined) {
						void update({
							theme:
								settings.theme === "dark"
									? "light"
									: settings.theme === "light"
										? "amoled"
										: "dark",
						})
					}
				},
			},
		]

		return [...routeCommands, ...instanceCommands, ...actions]
	}, [instances, navigate, settings, update])

	const quickMatches = useMemo(() => {
		const needle = quickSearch.trim().toLowerCase()
		return needle === ""
			? []
			: instances
					.filter((instance) => instance.name.toLowerCase().includes(needle))
					.slice(0, 5)
	}, [instances, quickSearch])

	const heading =
		route === "instances" && instanceId !== null
			? { title: "Instance", subtitle: "Tune, inspect and launch" }
			: ROUTE_TITLES[route]

	return (
		<div className="shell">
			<Sidebar
				route={route}
				onNavigate={(next) => {
					const target =
						next === "discover" && route === "instances" && instanceId !== null
							? instanceId
							: undefined
					navigate(next, target)
				}}
				activeDownloads={activeDownloads}
				runningInstances={instances.filter((instance) => instance.running).length}
				updateReady={updateReady}
				version={__APP_VERSION__}
				build={__BUILD_NUMBER__}
			/>

			<main className="main">
				<header className="topbar">
					<div className="topbar-title">
						<strong>{heading.title}</strong>
						<small>{heading.subtitle}</small>
					</div>
					<div className="topbar-actions">
						{route === "instances" && instanceId !== null ? (
							<Button
								size="small"
								variant="primary"
								icon="discover"
								onClick={() => {
									navigate("discover", instanceId)
								}}
							>
								Discover mods
							</Button>
						) : null}
						<div style={{ position: "relative" }}>
							<SearchInput
								value={quickSearch}
								onChange={setQuickSearch}
								placeholder="Jump to an instance"
							/>
							{quickMatches.length === 0 ? null : (
								<div
									className="context-menu"
									style={{ position: "absolute", top: 42, right: 0 }}
								>
									{quickMatches.map((instance) => (
										<button
											key={instance.id}
											type="button"
											className="context-item"
											onClick={() => {
												setQuickSearch("")
												navigate("instances", instance.id)
											}}
										>
											{instance.name}
										</button>
									))}
								</div>
							)}
						</div>
						<Button
							size="small"
							variant="ghost"
							icon="search"
							title="Command palette"
							onClick={() => {
								setPaletteOpen(true)
							}}
						>
							Ctrl K
						</Button>
						<Button
							size="small"
							variant="ghost"
							icon="downloads"
							title="Downloads"
							onClick={() => {
								navigate("downloads")
							}}
						/>
						<Button
							size="small"
							variant="ghost"
							icon="accounts"
							title="Accounts"
							onClick={() => {
								navigate("accounts")
							}}
						/>
					</div>
				</header>

				<section className="page" key={`${route}-${instanceId ?? "root"}`}>
					{route === "dashboard" ? <DashboardPage navigate={navigate} /> : null}
					{route === "instances" && instanceId === null ? (
						<InstancesPage
							onOpen={(id) => {
								navigate("instances", id)
							}}
						/>
					) : null}
					{route === "instances" && instanceId !== null ? (
						<InstanceDetailPage
							instanceId={instanceId}
							onBack={() => {
								navigate("instances")
							}}
							onDiscover={(id) => {
								navigate("discover", id)
							}}
						/>
					) : null}
					{route === "discover" ? (
						<DiscoverPage initialInstanceId={instanceId ?? undefined} />
					) : null}
					{route === "accounts" ? (
						<AccountsPage
							onEditAppearance={() => {
								navigate("skins")
							}}
						/>
					) : null}
					{route === "skins" ? <SkinsPage /> : null}
					{route === "java" ? <JavaPage /> : null}
					{route === "downloads" ? <DownloadsPage /> : null}
					{route === "logs" ? <LogsPage /> : null}
					{route === "plugins" ? <PluginsPage /> : null}
					{route === "settings" ? (
						<SettingsPage
							settings={settings}
							onUpdate={(patch) => {
								void update(patch)
							}}
							onReset={() => {
								void reset()
							}}
						/>
					) : null}
				</section>
			</main>

			{paletteOpen ? (
				<CommandPalette
					commands={commands}
					onClose={() => {
						setPaletteOpen(false)
					}}
				/>
			) : null}

			<ToastStack toasts={toasts} onDismiss={dismiss} />
		</div>
	)
}
