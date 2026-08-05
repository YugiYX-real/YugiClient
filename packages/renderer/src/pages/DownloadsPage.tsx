import { useEffect, useState } from "react"
import type { DownloadSnapshot } from "@halcyon/ipc"
import {
	Badge,
	Button,
	Card,
	EmptyState,
	ProgressBar,
	SectionHeader,
	StatTile,
} from "../components/primitives.tsx"
import { invoke } from "../lib/client.ts"
import { useIpcEvent } from "../lib/hooks.ts"
import { formatBytes, formatEta, formatSpeed } from "../lib/format.ts"

export function DownloadsPage(): JSX.Element {
	const [snapshot, setSnapshot] = useState<DownloadSnapshot | null>(null)

	useEffect(() => {
		void invoke("downloads:snapshot").then(setSnapshot)
	}, [])

	useIpcEvent("downloads:changed", setSnapshot)

	if (snapshot === null) {
		return <EmptyState icon="downloads" title="Loading queue" />
	}

	const active = snapshot.items.filter(
		(item) => item.state === "running" || item.state === "queued" || item.state === "paused",
	)
	const failed = snapshot.items.filter((item) => item.state === "failed")
	const finished = snapshot.items.filter(
		(item) => item.state === "completed" || item.state === "cancelled",
	)

	return (
		<>
			<Card>
				<SectionHeader
					title={snapshot.paused ? "Queue paused" : "Transfer queue"}
					subtitle={`${snapshot.completedItems} of ${snapshot.totalItems} items complete`}
					action={
						<div className="row">
							{snapshot.paused ? (
								<Button
									size="small"
									variant="primary"
									icon="play"
									onClick={() => {
										void invoke("downloads:resume").then(setSnapshot)
									}}
								>
									Resume
								</Button>
							) : (
								<Button
									size="small"
									icon="pause"
									onClick={() => {
										void invoke("downloads:pause").then(setSnapshot)
									}}
								>
									Pause
								</Button>
							)}
							<Button
								size="small"
								icon="refresh"
								disabled={snapshot.failedCount === 0}
								onClick={() => {
									void invoke("downloads:retryFailed").then(setSnapshot)
								}}
							>
								Retry failed
							</Button>
							<Button
								size="small"
								variant="danger"
								icon="close"
								disabled={active.length === 0}
								onClick={() => {
									void invoke("downloads:cancel", null).then(setSnapshot)
								}}
							>
								Cancel all
							</Button>
						</div>
					}
				/>
				<div className="col" style={{ marginTop: 14 }}>
					<ProgressBar fraction={snapshot.fraction} />
					<div className="row between">
						<small>
							{formatBytes(snapshot.completedBytes)} of {formatBytes(snapshot.totalBytes)}
						</small>
						<small>{Math.round(snapshot.fraction * 100)}%</small>
					</div>
				</div>
			</Card>

			<div className="grid cols-4">
				<StatTile label="Speed" value={formatSpeed(snapshot.bytesPerSecond)} />
				<StatTile label="Time remaining" value={formatEta(snapshot.etaSeconds)} />
				<StatTile label="Active" value={String(active.length)} hint="queued and running" />
				<StatTile label="Failed" value={String(snapshot.failedCount)} hint="retryable" />
			</div>

			{active.length === 0 && failed.length === 0 ? (
				<EmptyState
					icon="check"
					title="Nothing in the queue"
					description="Downloads appear here whenever you install a version, loader, mod or runtime."
				/>
			) : (
				<div className="list">
					{[...failed, ...active].map((item) => (
						<div className="list-row" key={item.id}>
							<div className="col" style={{ gap: 4, flex: 1, minWidth: 0 }}>
								<div className="row" style={{ gap: 8 }}>
									<strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
										{item.label}
									</strong>
									<Badge
										tone={
											item.state === "failed"
												? "danger"
												: item.state === "running"
													? "accent"
													: "neutral"
										}
									>
										{item.state}
									</Badge>
									{item.attempt > 1 ? <Badge tone="warning">attempt {item.attempt}</Badge> : null}
									<Badge>{item.group}</Badge>
								</div>
								<ProgressBar
									fraction={item.totalBytes > 0 ? item.receivedBytes / item.totalBytes : 0}
									indeterminate={item.totalBytes === 0 && item.state === "running"}
								/>
								<small>
									{formatBytes(item.receivedBytes)}
									{item.totalBytes > 0 ? ` of ${formatBytes(item.totalBytes)}` : ""}
									{item.error === null ? "" : ` · ${item.error}`}
								</small>
							</div>
							<Button
								size="small"
								variant="ghost"
								icon="close"
								title="Cancel"
								onClick={() => {
									void invoke("downloads:cancel", item.id).then(setSnapshot)
								}}
							/>
						</div>
					))}
				</div>
			)}

			{finished.length === 0 ? null : (
				<Card flat>
					<SectionHeader title="Recently finished" subtitle={`${finished.length} items`} />
					<div className="col" style={{ marginTop: 10 }}>
						{finished.slice(-12).map((item) => (
							<div className="row between" key={item.id}>
								<small style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
									{item.label}
								</small>
								<small>{formatBytes(item.receivedBytes)}</small>
							</div>
						))}
					</div>
				</Card>
			)}
		</>
	)
}
