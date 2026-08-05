import { useMemo, useState } from "react"
import type { InstanceSummary, LogBundle, LogLevel } from "@halcyon/ipc"
import { Badge, Button, Card, SearchInput, Select, Toggle } from "../components/primitives.tsx"
import { invoke } from "../lib/client.ts"
import { useAsync, useIpcEvent } from "../lib/hooks.ts"

const LEVELS: readonly LogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"]

export function LogsPage(): JSX.Element {
	const instances = useAsync<readonly InstanceSummary[]>(() => invoke("instances:list"), [])
	const [source, setSource] = useState<"launcher" | "instance">("launcher")
	const [instanceId, setInstanceId] = useState("")
	const [search, setSearch] = useState("")
	const [levels, setLevels] = useState<readonly LogLevel[]>(LEVELS)
	const [follow, setFollow] = useState(true)

	const bundle = useAsync<LogBundle>(
		() =>
			invoke("logs:read", {
				source,
				limit: 1500,
				...(source === "instance" && instanceId !== "" ? { instanceId } : {}),
				...(search.trim() === "" ? {} : { search: search.trim() }),
				...(levels.length === LEVELS.length ? {} : { levels }),
			}),
		[source, instanceId, search, levels],
	)

	useIpcEvent("logs:appended", () => {
		if (follow) {
			bundle.reload()
		}
	})

	const lines = useMemo(() => bundle.data?.lines ?? [], [bundle.data])

	const toggleLevel = (level: LogLevel): void => {
		setLevels((current) =>
			current.includes(level)
				? current.filter((candidate) => candidate !== level)
				: [...current, level],
		)
	}

	return (
		<>
			<div className="row wrap">
				<Select
					value={source}
					onChange={setSource}
					options={[
						{ value: "launcher", label: "Launcher log" },
						{ value: "instance", label: "Instance log" },
					]}
				/>
				{source === "instance" ? (
					<Select
						value={instanceId}
						onChange={setInstanceId}
						options={[
							{ value: "", label: "Select an instance" },
							...(instances.data ?? []).map((instance) => ({
								value: instance.id,
								label: instance.name,
							})),
						]}
					/>
				) : null}
				<SearchInput value={search} onChange={setSearch} placeholder="Search log lines" />
				<span className="spacer" />
				<Toggle checked={follow} onChange={setFollow} label="Follow" />
				<Button size="small" icon="refresh" onClick={bundle.reload}>
					Reload
				</Button>
				<Button
					size="small"
					icon="copy"
					onClick={() => {
						void navigator.clipboard.writeText(
							lines
								.map(
									(line) =>
										`${line.timestamp} [${line.level}] ${line.scope} ${line.message}`,
								)
								.join("\n"),
						)
					}}
				>
					Copy
				</Button>
				<Button
					size="small"
					icon="upload"
					onClick={() => {
						void invoke("logs:export", {
							source,
							...(source === "instance" && instanceId !== "" ? { instanceId } : {}),
						})
					}}
				>
					Export
				</Button>
			</div>

			<Card flat>
				<div className="row wrap">
					{LEVELS.map((level) => (
						<button
							key={level}
							type="button"
							className="btn small"
							style={{
								opacity: levels.includes(level) ? 1 : 0.42,
							}}
							onClick={() => {
								toggleLevel(level)
							}}
						>
							{level}
						</button>
					))}
					<span className="spacer" />
					{bundle.data?.truncated === true ? (
						<Badge tone="warning">output truncated</Badge>
					) : null}
					<Badge>{lines.length} lines</Badge>
				</div>
			</Card>

			<div className="log-view">
				{lines.length === 0 ? (
					<small>No matching log lines.</small>
				) : (
					lines.map((line, index) => (
						<div
							className={`log-line ${line.level}`}
							key={`${line.timestamp}-${index}`}
						>
							<span className="time">{line.timestamp.slice(11, 19)}</span>
							<span className="lvl">{line.level}</span>
							<span className="msg">
								{line.scope === "" ? "" : `${line.scope} `}
								{line.message}
							</span>
						</div>
					))
				)}
			</div>
		</>
	)
}
