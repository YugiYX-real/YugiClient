import { useCallback } from "react"
import type { DashboardData, InstanceSummary, ModrinthProject } from "@halcyon/ipc"
import { Badge, Button, Card, EmptyState, ProgressBar, SectionHeader, Skeleton, StatTile } from "../components/primitives.tsx"
import { Icon } from "../components/Icon.tsx"
import { invoke, openExternal } from "../lib/client.ts"
import { useAsync, useIpcEvent } from "../lib/hooks.ts"
import { formatCount, formatDate, formatPlaytime, formatRelative, initialsOf } from "../lib/format.ts"
import type { Navigate } from "../app/navigation.ts"

function InstanceRow({
	instance,
	onOpen,
	onLaunch,
}: {
	instance: InstanceSummary
	onOpen: () => void
	onLaunch: () => void
}): JSX.Element {
	return (
		<div className="list-row">
			<div className="avatar">{instance.icon ?? initialsOf(instance.name)}</div>
			<div className="col" style={{ gap: 1, flex: 1, minWidth: 0 }}>
				<button
					type="button"
					className="btn ghost small"
					style={{ justifyContent: "flex-start", padding: 0, border: "none", background: "none" }}
					onClick={onOpen}
				>
					<strong>{instance.name}</strong>
				</button>
				<small>
					{instance.gameVersion} · {instance.loader} · played {formatRelative(instance.lastPlayedAt)}
				</small>
			</div>
			{instance.running ? <Badge tone="success">Running</Badge> : null}
			<Button icon="play" size="small" variant="primary" onClick={onLaunch} title="Launch" />
		</div>
	)
}

function ContentStrip({
	title,
	projects,
	onBrowse,
}: {
	title: string
	projects: readonly ModrinthProject[]
	onBrowse: () => void
}): JSX.Element {
	return (
		<div className="col">
			<SectionHeader
				title={title}
				action={
					<Button size="small" variant="ghost" icon="discover" onClick={onBrowse}>
						Browse
					</Button>
				}
			/>
			{projects.length === 0 ? (
				<Card flat>
					<small>Modrinth could not be reached. The rest of Halcyon keeps working offline.</small>
				</Card>
			) : (
				<div className="grid cols-3">
					{projects.map((project) => (
						<Card key={project.id} interactive onClick={onBrowse}>
							<div className="row" style={{ alignItems: "flex-start" }}>
								{project.iconUrl === null ? (
									<div className="mod-art" />
								) : (
									<img className="mod-art" src={project.iconUrl} alt="" />
								)}
								<div className="col" style={{ gap: 3, minWidth: 0 }}>
									<strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
										{project.title}
									</strong>
									<small>{formatCount(project.downloads)} downloads</small>
								</div>
							</div>
							<small style={{ display: "block", marginTop: 10 }}>{project.description}</small>
						</Card>
					))}
				</div>
			)}
		</div>
	)
}

export function DashboardPage({ navigate }: { navigate: Navigate }): JSX.Element {
	const dashboard = useAsync<DashboardData>(() => invoke("dashboard:load"), [])

	useIpcEvent("instances:changed", dashboard.reload)
	useIpcEvent("updates:changed", dashboard.reload)
	useIpcEvent("accounts:changed", dashboard.reload)

	const launch = useCallback((instanceId: string) => {
		void invoke("instances:launch", instanceId, null)
	}, [])

	if (dashboard.data === undefined) {
		return (
			<div className="grid cols-2">
				<Card>
					<Skeleton lines={5} />
				</Card>
				<Card>
					<Skeleton lines={5} />
				</Card>
			</div>
		)
	}

	const data = dashboard.data
	const quickLaunch = data.recent[0] ?? data.favorites[0]
	const peak = Math.max(1, ...data.statistics.last7Days.map((entry) => entry.minutes))

	return (
		<>
			<Card>
				<div className="row between wrap" style={{ gap: 18 }}>
					<div className="col" style={{ gap: 6 }}>
						<Badge tone="accent" icon="sparkle">
							Halcyon {data.update.currentVersion}
						</Badge>
						<h1>
							{data.account === null
								? "Welcome to Halcyon"
								: `Welcome back, ${data.account.nickname ?? data.account.username}`}
						</h1>
						<small>
							{quickLaunch === undefined
								? "Create your first instance to get playing in under a minute."
								: `${quickLaunch.name} · ${quickLaunch.gameVersion} · ${quickLaunch.loader}`}
						</small>
					</div>
					<div className="row">
						{quickLaunch === undefined ? (
							<Button
								variant="primary"
								icon="plus"
								onClick={() => {
									navigate("instances")
								}}
							>
								Create an instance
							</Button>
						) : (
							<>
								<Button
									variant="ghost"
									onClick={() => {
										navigate("instances", quickLaunch.id)
									}}
								>
									Open instance
								</Button>
								<Button
									variant="primary"
									icon="play"
									onClick={() => {
										launch(quickLaunch.id)
									}}
								>
									Quick launch
								</Button>
							</>
						)}
					</div>
				</div>
			</Card>

			<div className="grid cols-4">
				<StatTile
					label="Total playtime"
					value={formatPlaytime(data.statistics.totalPlaytimeMinutes)}
					hint={`${data.statistics.launchCount} launches`}
				/>
				<StatTile
					label="Instances"
					value={String(data.statistics.instanceCount)}
					hint={data.statistics.busiestInstance ?? "No favourite yet"}
				/>
				<StatTile
					label="Installed versions"
					value={String(data.statistics.installedVersionCount)}
					hint="Ready to play offline"
				/>
				<StatTile
					label="Account"
					value={data.account === null ? "Not signed in" : data.account.username}
					hint={data.account === null ? "Add a Microsoft account" : data.account.kind}
				/>
			</div>

			<div className="grid cols-2">
				<Card>
					<SectionHeader title="Last 7 days" subtitle="Minutes played per day" />
					<div className="chart">
						{data.statistics.last7Days.map((entry) => (
							<div className="chart-bar" key={entry.date} title={`${entry.minutes} minutes`}>
								<i style={{ height: `${Math.round((entry.minutes / peak) * 100)}%` }} />
								<small>{entry.date.slice(5)}</small>
							</div>
						))}
					</div>
				</Card>

				<Card>
					<SectionHeader
						title="Launcher updates"
						subtitle={
							data.update.availableVersion === null
								? `You are on ${data.update.currentVersion}`
								: `Version ${data.update.availableVersion} is available`
						}
					/>
					<div className="col">
						{data.update.state === "downloading" ? (
							<ProgressBar fraction={data.update.percent / 100} />
						) : null}
						<div className="row wrap">
							<Badge tone={data.update.state === "error" ? "danger" : "accent"}>
								{data.update.state}
							</Badge>
							<Button
								size="small"
								icon="refresh"
								onClick={() => {
									void invoke("updates:check")
								}}
							>
								Check now
							</Button>
							{data.update.state === "available" ? (
								<Button
									size="small"
									variant="primary"
									icon="downloads"
									onClick={() => {
										void invoke("updates:download")
									}}
								>
									Download
								</Button>
							) : null}
							{data.update.state === "ready" ? (
								<Button
									size="small"
									variant="primary"
									icon="check"
									onClick={() => {
										void invoke("updates:install")
									}}
								>
									Restart and install
								</Button>
							) : null}
						</div>
						{data.update.releaseNotes === null ? null : (
							<div className="markdown">{data.update.releaseNotes}</div>
						)}
						{data.update.error === null ? null : <small>{data.update.error}</small>}
					</div>
				</Card>
			</div>

			<div className="grid cols-2">
				<Card>
					<SectionHeader
						title="Recently played"
						action={
							<Button
								size="small"
								variant="ghost"
								onClick={() => {
									navigate("instances")
								}}
							>
								All instances
							</Button>
						}
					/>
					{data.recent.length === 0 ? (
						<EmptyState
							icon="instances"
							title="Nothing played yet"
							description="Launch an instance and it will show up here."
						/>
					) : (
						<div className="list">
							{data.recent.map((instance) => (
								<InstanceRow
									key={instance.id}
									instance={instance}
									onOpen={() => {
										navigate("instances", instance.id)
									}}
									onLaunch={() => {
										launch(instance.id)
									}}
								/>
							))}
						</div>
					)}
				</Card>

				<Card>
					<SectionHeader title="Favourites" subtitle="Pinned instances" />
					{data.favorites.length === 0 ? (
						<EmptyState
							icon="star"
							title="No favourites yet"
							description="Right-click an instance to pin it here."
						/>
					) : (
						<div className="list">
							{data.favorites.map((instance) => (
								<InstanceRow
									key={instance.id}
									instance={instance}
									onOpen={() => {
										navigate("instances", instance.id)
									}}
									onLaunch={() => {
										launch(instance.id)
									}}
								/>
							))}
						</div>
					)}
				</Card>
			</div>

			{data.pluginCards.length === 0 ? null : (
				<div className="grid cols-3">
					{data.pluginCards.map((card) => (
						<Card key={`${card.pluginId}-${card.title}`} flat>
							<div className="row" style={{ gap: 8 }}>
								<Icon name="plugins" size={15} />
								<strong>{card.title}</strong>
							</div>
							<small style={{ display: "block", marginTop: 8 }}>{card.body}</small>
						</Card>
					))}
				</div>
			)}

			<ContentStrip
				title="Featured mods"
				projects={data.featuredMods}
				onBrowse={() => {
					navigate("discover")
				}}
			/>
			<ContentStrip
				title="Featured shaders"
				projects={data.featuredShaders}
				onBrowse={() => {
					navigate("discover")
				}}
			/>
			<ContentStrip
				title="Featured resource packs"
				projects={data.featuredResourcePacks}
				onBrowse={() => {
					navigate("discover")
				}}
			/>

			<div className="col">
				<SectionHeader title="News" subtitle="Straight from the Minecraft version feed" />
				<div className="grid cols-3">
					{data.news.map((item) => (
						<Card
							key={item.id}
							interactive
							onClick={() => {
								openExternal(item.url)
							}}
						>
							<div className="row between">
								<Badge>{item.source}</Badge>
								<small>{formatDate(item.publishedAt)}</small>
							</div>
							<h3 style={{ marginTop: 10 }}>{item.title}</h3>
							<small style={{ display: "block", marginTop: 6 }}>{item.summary}</small>
						</Card>
					))}
				</div>
			</div>
		</>
	)
}
