import type { PluginInfo } from "@halcyon/ipc"
import {
	Badge,
	Button,
	Card,
	EmptyState,
	SectionHeader,
	Skeleton,
	Toggle,
} from "../components/primitives.tsx"
import { invoke, openPath } from "../lib/client.ts"
import { useAsync, useIpcEvent } from "../lib/hooks.ts"

export function PluginsPage(): JSX.Element {
	const plugins = useAsync<readonly PluginInfo[]>(() => invoke("plugins:list"), [])

	useIpcEvent("plugins:changed", () => {
		plugins.reload()
	})

	const entries = plugins.data ?? []

	return (
		<>
			<div className="row wrap">
				<Button
					variant="primary"
					icon="refresh"
					onClick={() => {
						void invoke("plugins:reload").then(plugins.reload)
					}}
				>
					Reload plugins
				</Button>
				<Button
					icon="folder"
					onClick={() => {
						void invoke("plugins:openFolder")
					}}
				>
					Open plugins folder
				</Button>
			</div>

			<Card flat>
				<SectionHeader
					title="How plugins work"
					subtitle="Drop a folder with halcyon.plugin.json into the plugins directory and reload"
				/>
				<small style={{ display: "block", marginTop: 8 }}>
					Plugins run in the main process with a narrow, typed context: subscribe to launcher events,
					contribute dashboard cards, send notifications and read instances or settings. The full API
					reference lives in docs/plugin-api.md, with two runnable examples under examples/plugins.
				</small>
			</Card>

			{plugins.loading && plugins.data === undefined ? (
				<Card>
					<Skeleton lines={4} />
				</Card>
			) : entries.length === 0 ? (
				<EmptyState
					icon="plugins"
					title="No plugins installed"
					description="Copy an example plugin into your plugins folder to try the API."
				/>
			) : (
				<div className="grid cols-2">
					{entries.map((plugin) => (
						<Card key={plugin.id}>
							<div className="row between">
								<div className="col" style={{ gap: 2 }}>
									<strong>{plugin.name}</strong>
									<small>
										v{plugin.version} · {plugin.author ?? "unknown author"} · API {plugin.apiVersion}
									</small>
								</div>
								<Toggle
									checked={plugin.enabled}
									onChange={(value) => {
										void invoke("plugins:setEnabled", plugin.id, value).then(plugins.reload)
									}}
								/>
							</div>
							{plugin.description === null ? null : (
								<small style={{ display: "block", marginTop: 10 }}>{plugin.description}</small>
							)}
							<div className="row wrap" style={{ marginTop: 10, gap: 6 }}>
								{plugin.error === null ? (
									<Badge tone={plugin.enabled ? "success" : "neutral"}>
										{plugin.enabled ? "loaded" : "disabled"}
									</Badge>
								) : (
									<Badge tone="danger">{plugin.error}</Badge>
								)}
								{plugin.contributedCards.length === 0 ? null : (
									<Badge tone="accent">
										{plugin.contributedCards.length} dashboard card
										{plugin.contributedCards.length === 1 ? "" : "s"}
									</Badge>
								)}
								<span className="spacer" />
								<Button
									size="small"
									variant="ghost"
									icon="folder"
									onClick={() => {
										openPath(plugin.directory)
									}}
								>
									Reveal
								</Button>
							</div>
						</Card>
					))}
				</div>
			)}
		</>
	)
}
