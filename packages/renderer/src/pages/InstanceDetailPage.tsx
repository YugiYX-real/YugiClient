import { useMemo, useState } from "react"
import type {
	BackupEntry,
	ContentEntry,
	ContentKind,
	CrashDiagnosisDto,
	InstancePatch,
	InstanceSummary,
	JavaRuntime,
	LoaderId,
	LoaderVersion,
	LogBundle,
	ModAnalysis,
	ScreenshotEntry,
	VerificationReport,
	VersionChangeAssessmentDto,
	VersionEntry,
	WorldEntry,
} from "@halcyon/ipc"
import {
	Badge,
	Button,
	Card,
	ConfirmDialog,
	DropZone,
	EmptyState,
	Field,
	Modal,
	NumberInput,
	ProgressBar,
	SearchInput,
	Select,
	Skeleton,
	Tabs,
	TextInput,
	Toggle,
} from "../components/primitives.tsx"
import { Icon } from "../components/Icon.tsx"
import { invoke, openPath } from "../lib/client.ts"
import { useAsync, useIpcEvent } from "../lib/hooks.ts"
import { formatBytes, formatDate, formatPlaytime, formatRelative } from "../lib/format.ts"

type TabKey =
	| "overview"
	| "mods"
	| "resourcepacks"
	| "shaderpacks"
	| "datapacks"
	| "worlds"
	| "screenshots"
	| "backups"
	| "logs"
	| "settings"

const LOADERS: readonly { value: LoaderId; label: string }[] = [
	{ value: "vanilla", label: "Vanilla" },
	{ value: "fabric", label: "Fabric" },
	{ value: "forge", label: "Forge" },
	{ value: "neoforge", label: "NeoForge" },
	{ value: "quilt", label: "Quilt" },
]

const CONTENT_LABELS: Record<ContentKind, string> = {
	mod: "Mods",
	resourcepack: "Resource packs",
	shaderpack: "Shaders",
	datapack: "Datapacks",
}

function ContentTab({ instanceId, kind }: { instanceId: string; kind: ContentKind }): JSX.Element {
	const entries = useAsync<readonly ContentEntry[]>(
		() => invoke("content:list", instanceId, kind),
		[instanceId, kind],
	)
	const [search, setSearch] = useState("")
	const [sort, setSort] = useState<"name" | "size" | "state">("name")
	const [selected, setSelected] = useState<readonly string[]>([])
	const [busy, setBusy] = useState(false)
	const [analysis, setAnalysis] = useState<ModAnalysis | null>(null)

	const visible = useMemo(() => {
		const needle = search.trim().toLowerCase()
		const filtered = (entries.data ?? []).filter(
			(entry) =>
				needle === "" ||
				entry.displayName.toLowerCase().includes(needle) ||
				entry.fileName.toLowerCase().includes(needle) ||
				(entry.author ?? "").toLowerCase().includes(needle),
		)
		return [...filtered].sort((left, right) => {
			if (sort === "size") {
				return right.sizeBytes - left.sizeBytes
			}
			if (sort === "state") {
				return Number(right.enabled) - Number(left.enabled)
			}
			return left.displayName.localeCompare(right.displayName)
		})
	}, [entries.data, search, sort])

	const updatable = (entries.data ?? []).filter((entry) => entry.updateAvailable)

	const run = async (action: () => Promise<unknown>): Promise<void> => {
		setBusy(true)
		try {
			await action()
			setSelected([])
			entries.reload()
		} finally {
			setBusy(false)
		}
	}

	const toggleSelection = (fileName: string): void => {
		setSelected((current) =>
			current.includes(fileName)
				? current.filter((candidate) => candidate !== fileName)
				: [...current, fileName],
		)
	}

	return (
		<div className="col" style={{ gap: 16 }}>
			<div className="row wrap">
				<SearchInput
					value={search}
					onChange={setSearch}
					placeholder={`Search ${CONTENT_LABELS[kind].toLowerCase()}`}
				/>
				<Select
					value={sort}
					onChange={setSort}
					options={[
						{ value: "name", label: "Name" },
						{ value: "size", label: "Size" },
						{ value: "state", label: "Enabled first" },
					]}
				/>
				<span className="spacer" />
				<Button
					size="small"
					icon="refresh"
					busy={busy}
					onClick={() => {
						void run(() => invoke("content:checkUpdates", instanceId, kind))
					}}
				>
					Check updates
				</Button>
				{updatable.length === 0 ? null : (
					<Button
						size="small"
						variant="primary"
						icon="downloads"
						busy={busy}
						onClick={() => {
							void run(() =>
								invoke(
									"content:applyUpdates",
									instanceId,
									kind,
									updatable.map((entry) => entry.fileName),
								),
							)
						}}
					>
						Update {updatable.length}
					</Button>
				)}
				<Button
					size="small"
					icon="upload"
					onClick={() => {
						void run(() => invoke("content:import", instanceId, kind, []))
					}}
				>
					Import files
				</Button>
				<Button
					size="small"
					icon="folder"
					onClick={() => {
						void invoke("content:openFolder", instanceId, kind)
					}}
				>
					Open folder
				</Button>
				{kind === "mod" ? (
					<Button
						size="small"
						icon="shield"
						busy={busy}
						onClick={() => {
							void invoke("content:analyze", instanceId).then(setAnalysis)
						}}
					>
						Analyse
					</Button>
				) : null}
			</div>

			{selected.length === 0 ? null : (
				<Card flat>
					<div className="row wrap">
						<strong>{selected.length} selected</strong>
						<span className="spacer" />
						<Button
							size="small"
							icon="check"
							busy={busy}
							onClick={() => {
								void run(() =>
									invoke("content:setEnabled", instanceId, kind, selected, true),
								)
							}}
						>
							Enable
						</Button>
						<Button
							size="small"
							icon="pause"
							busy={busy}
							onClick={() => {
								void run(() =>
									invoke("content:setEnabled", instanceId, kind, selected, false),
								)
							}}
						>
							Disable
						</Button>
						<Button
							size="small"
							variant="danger"
							icon="trash"
							busy={busy}
							onClick={() => {
								void run(() => invoke("content:delete", instanceId, kind, selected))
							}}
						>
							Delete
						</Button>
						<Button
							size="small"
							variant="ghost"
							onClick={() => {
								setSelected([])
							}}
						>
							Clear
						</Button>
					</div>
				</Card>
			)}

			{analysis === null ? null : (
				<Card flat>
					<div className="row between">
						<strong>
							{analysis.enabledMods} of {analysis.totalMods} mods enabled
						</strong>
						<Button
							size="small"
							variant="ghost"
							icon="close"
							onClick={() => {
								setAnalysis(null)
							}}
						/>
					</div>
					{analysis.issues.length === 0 ? (
						<small>No dependency, duplicate or compatibility problems found.</small>
					) : (
						<div className="col" style={{ marginTop: 10 }}>
							{analysis.issues.map((issue, index) => (
								<div className="row" key={`${issue.kind}-${index}`}>
									<Badge tone={issue.kind === "duplicate" ? "warning" : "danger"}>
										{issue.kind}
									</Badge>
									<small>{issue.message}</small>
								</div>
							))}
						</div>
					)}
				</Card>
			)}

			<DropZone
				label={`Drop ${kind === "mod" ? "jar" : "zip"} files here to install them into this instance`}
				onFiles={(paths) => {
					void run(() => invoke("content:import", instanceId, kind, paths))
				}}
			/>

			{entries.loading && entries.data === undefined ? (
				<Card>
					<Skeleton lines={5} />
				</Card>
			) : visible.length === 0 ? (
				<EmptyState
					icon="cube"
					title={`No ${CONTENT_LABELS[kind].toLowerCase()} installed`}
					description="Install from Discover, drop files above, or import them manually."
				/>
			) : (
				<div className="list">
					{visible.map((entry) => (
						<div
							key={entry.fileName}
							className={
								selected.includes(entry.fileName) ? "list-row selected" : "list-row"
							}
						>
							<input
								type="checkbox"
								style={{ width: 16, height: 16 }}
								checked={selected.includes(entry.fileName)}
								onChange={() => {
									toggleSelection(entry.fileName)
								}}
							/>
							{entry.iconUrl === null ? (
								<div className="mod-art" />
							) : (
								<img className="mod-art" src={entry.iconUrl} alt="" />
							)}
							<div className="col" style={{ gap: 2, flex: 1, minWidth: 0 }}>
								<div className="row" style={{ gap: 8 }}>
									<strong>{entry.displayName}</strong>
									{entry.version === null ? null : <Badge>{entry.version}</Badge>}
									{entry.updateAvailable ? (
										<Badge tone="accent">
											{entry.latestVersionName ?? "update"}
										</Badge>
									) : null}
								</div>
								<small
									style={{
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}
								>
									{entry.author === null
										? entry.fileName
										: `${entry.author} · ${entry.fileName}`}
								</small>
							</div>
							<small>{formatBytes(entry.sizeBytes)}</small>
							<Toggle
								checked={entry.enabled}
								onChange={(value) => {
									void run(() =>
										invoke(
											"content:setEnabled",
											instanceId,
											kind,
											[entry.fileName],
											value,
										),
									)
								}}
							/>
							<Button
								size="small"
								variant="ghost"
								icon="trash"
								title="Delete"
								onClick={() => {
									void run(() =>
										invoke("content:delete", instanceId, kind, [
											entry.fileName,
										]),
									)
								}}
							/>
						</div>
					))}
				</div>
			)}
		</div>
	)
}

function VersionChangeModal({
	instance,
	onClose,
}: {
	instance: InstanceSummary
	onClose: () => void
}): JSX.Element {
	const [gameVersion, setGameVersion] = useState(instance.gameVersion)
	const [loader, setLoader] = useState<LoaderId>(instance.loader)
	const [loaderVersion, setLoaderVersion] = useState("")
	const [createBackup, setCreateBackup] = useState(true)
	const [search, setSearch] = useState("")
	const [busy, setBusy] = useState(false)

	const versions = useAsync<readonly VersionEntry[]>(
		() => invoke("versions:list", { channels: ["release", "snapshot"] }),
		[],
	)
	const loaderVersions = useAsync<readonly LoaderVersion[]>(
		() =>
			loader === "vanilla"
				? Promise.resolve([])
				: invoke("loaders:list", loader, gameVersion),
		[loader, gameVersion],
	)
	const assessment = useAsync<VersionChangeAssessmentDto>(
		() =>
			invoke("instances:assessVersionChange", instance.id, {
				gameVersion,
				loader,
				...(loaderVersion === "" ? {} : { loaderVersion }),
				createBackup,
			}),
		[instance.id, gameVersion, loader, loaderVersion, createBackup],
	)

	const filtered = useMemo(() => {
		const needle = search.trim().toLowerCase()
		const entries = versions.data ?? []
		return (
			needle === ""
				? entries
				: entries.filter((entry) => entry.id.toLowerCase().includes(needle))
		).slice(0, 60)
	}, [versions.data, search])

	const apply = async (): Promise<void> => {
		setBusy(true)
		try {
			await invoke("instances:changeVersion", instance.id, {
				gameVersion,
				loader,
				...(loaderVersion === "" ? {} : { loaderVersion }),
				createBackup,
			})
			onClose()
		} finally {
			setBusy(false)
		}
	}

	const blocked = (assessment.data?.warnings ?? []).some(
		(warning) => warning.severity === "blocker",
	)

	return (
		<Modal
			wide
			title="Change version"
			subtitle="Halcyon checks mod compatibility, Java requirements and world safety first"
			onClose={onClose}
			footer={
				<>
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button
						variant="primary"
						icon="check"
						busy={busy}
						disabled={blocked}
						onClick={() => {
							void apply()
						}}
					>
						Apply change
					</Button>
				</>
			}
		>
			<div className="grid cols-2">
				<Field label="Mod loader">
					<Select
						value={loader}
						options={LOADERS}
						onChange={(value) => {
							setLoader(value)
							setLoaderVersion("")
						}}
					/>
				</Field>
				{loader === "vanilla" ? null : (
					<Field label="Loader version">
						<Select
							value={loaderVersion}
							onChange={setLoaderVersion}
							options={[
								{ value: "", label: "Recommended" },
								...(loaderVersions.data ?? []).map((version) => ({
									value: version.id,
									label: version.recommended
										? `${version.id} (recommended)`
										: version.id,
								})),
							]}
						/>
					</Field>
				)}
			</div>

			<Field label="Target Minecraft version">
				<div className="col">
					<SearchInput
						value={search}
						onChange={setSearch}
						placeholder="Search versions"
					/>
					<div className="list" style={{ maxHeight: 200, overflowY: "auto" }}>
						{filtered.map((entry) => (
							<button
								key={entry.id}
								type="button"
								className={
									entry.id === gameVersion ? "list-row selected" : "list-row"
								}
								style={{ border: "none", cursor: "pointer", textAlign: "left" }}
								onClick={() => {
									setGameVersion(entry.id)
									setLoaderVersion("")
								}}
							>
								<strong style={{ minWidth: 110 }}>{entry.id}</strong>
								<Badge>{entry.channel}</Badge>
								{entry.installed ? <Badge tone="success">installed</Badge> : null}
							</button>
						))}
					</div>
				</div>
			</Field>

			<Toggle
				checked={createBackup}
				onChange={setCreateBackup}
				label="Create a backup before changing"
			/>

			<Card flat>
				{assessment.data === undefined ? (
					<Skeleton lines={3} />
				) : (
					<div className="col">
						<div className="row wrap">
							<Badge tone="accent">{assessment.data.direction}</Badge>
							{assessment.data.recommendBackup ? (
								<Badge tone="warning">backup advised</Badge>
							) : null}
							{assessment.data.javaChanges ? (
								<Badge tone="warning">java changes</Badge>
							) : null}
						</div>
						{assessment.data.warnings.length === 0 ? (
							<small>No problems detected for this change.</small>
						) : (
							assessment.data.warnings.map((warning) => (
								<div
									className="row"
									key={warning.code}
									style={{ alignItems: "flex-start" }}
								>
									<Badge
										tone={
											warning.severity === "blocker"
												? "danger"
												: warning.severity === "warning"
													? "warning"
													: "neutral"
										}
									>
										{warning.severity}
									</Badge>
									<div className="col" style={{ gap: 1 }}>
										<span>{warning.message}</span>
										{warning.detail === null ? null : (
											<small>{warning.detail}</small>
										)}
									</div>
								</div>
							))
						)}
						{assessment.data.incompatibleMods.length === 0 ? null : (
							<small>
								Incompatible mods: {assessment.data.incompatibleMods.join(", ")}
							</small>
						)}
					</div>
				)}
			</Card>
		</Modal>
	)
}

function BackupsTab({ instanceId }: { instanceId: string }): JSX.Element {
	const backups = useAsync<readonly BackupEntry[]>(
		() => invoke("instances:backups", instanceId),
		[instanceId],
	)
	const [note, setNote] = useState("")
	const [busy, setBusy] = useState(false)
	const [restoring, setRestoring] = useState<BackupEntry | null>(null)

	const create = async (): Promise<void> => {
		setBusy(true)
		try {
			await invoke("instances:createBackup", instanceId, note)
			setNote("")
			backups.reload()
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className="col" style={{ gap: 16 }}>
			<Card flat>
				<div className="row wrap">
					<TextInput
						value={note}
						onChange={setNote}
						placeholder="Optional note, e.g. before 1.21 upgrade"
					/>
					<Button
						variant="primary"
						icon="plus"
						busy={busy}
						onClick={() => {
							void create()
						}}
					>
						Create backup
					</Button>
				</div>
			</Card>

			{(backups.data ?? []).length === 0 ? (
				<EmptyState
					icon="shield"
					title="No backups yet"
					description="Backups archive your whole game folder and can be restored with one click."
				/>
			) : (
				<div className="list">
					{(backups.data ?? []).map((backup) => (
						<div className="list-row" key={backup.id}>
							<Icon name="shield" size={17} />
							<div className="col" style={{ gap: 2, flex: 1 }}>
								<strong>
									{backup.note === "" ? backup.fileName : backup.note}
								</strong>
								<small>
									{formatDate(backup.createdAt)} · {backup.gameVersion} ·{" "}
									{backup.loader} · {formatBytes(backup.sizeBytes)}
								</small>
							</div>
							<Button
								size="small"
								icon="refresh"
								onClick={() => {
									setRestoring(backup)
								}}
							>
								Restore
							</Button>
							<Button
								size="small"
								variant="ghost"
								icon="trash"
								title="Delete backup"
								onClick={() => {
									void invoke(
										"instances:deleteBackup",
										instanceId,
										backup.id,
									).then(backups.reload)
								}}
							/>
						</div>
					))}
				</div>
			)}

			{restoring === null ? null : (
				<ConfirmDialog
					title="Restore backup"
					message="The current game folder is archived first, then replaced with the backup contents."
					confirmLabel="Restore"
					onCancel={() => {
						setRestoring(null)
					}}
					onConfirm={() => {
						const target = restoring
						setRestoring(null)
						void invoke("instances:restoreBackup", instanceId, target.id).then(
							backups.reload,
						)
					}}
				/>
			)}
		</div>
	)
}

function LogsTab({ instanceId }: { instanceId: string }): JSX.Element {
	const [search, setSearch] = useState("")
	const bundle = useAsync<LogBundle>(
		() =>
			invoke("logs:read", {
				source: "instance",
				instanceId,
				limit: 1200,
				...(search.trim() === "" ? {} : { search: search.trim() }),
			}),
		[instanceId, search],
	)
	const [diagnoses, setDiagnoses] = useState<readonly CrashDiagnosisDto[] | null>(null)

	useIpcEvent("logs:appended", (payload) => {
		if (payload.instanceId === instanceId) {
			bundle.reload()
		}
	})

	return (
		<div className="col" style={{ gap: 14, flex: 1 }}>
			<div className="row wrap">
				<SearchInput value={search} onChange={setSearch} placeholder="Filter log lines" />
				<span className="spacer" />
				<Button
					size="small"
					icon="alert"
					onClick={() => {
						void invoke("logs:analyze", instanceId).then(setDiagnoses)
					}}
				>
					Explain crashes
				</Button>
				<Button
					size="small"
					icon="copy"
					onClick={() => {
						const text = (bundle.data?.lines ?? [])
							.map(
								(line) =>
									`${line.timestamp} [${line.level}] ${line.scope} ${line.message}`,
							)
							.join("\n")
						void navigator.clipboard.writeText(text)
					}}
				>
					Copy
				</Button>
				<Button
					size="small"
					icon="upload"
					onClick={() => {
						void invoke("logs:export", { source: "instance", instanceId })
					}}
				>
					Export
				</Button>
				<Button size="small" icon="refresh" onClick={bundle.reload}>
					Reload
				</Button>
			</div>

			{diagnoses === null || diagnoses.length === 0 ? null : (
				<div className="col">
					{diagnoses.map((diagnosis) => (
						<Card key={diagnosis.id} flat>
							<div className="row between">
								<div className="row">
									<Badge
										tone={
											diagnosis.severity === "warning" ? "warning" : "danger"
										}
									>
										{diagnosis.severity}
									</Badge>
									<strong>{diagnosis.title}</strong>
								</div>
								<small>{Math.round(diagnosis.confidence * 100)}% confidence</small>
							</div>
							<small style={{ display: "block", marginTop: 8 }}>
								{diagnosis.explanation}
							</small>
							<ul
								style={{
									marginTop: 8,
									paddingLeft: 18,
									color: "var(--muted)",
									fontSize: "0.82rem",
								}}
							>
								{diagnosis.remedies.map((remedy) => (
									<li key={remedy}>{remedy}</li>
								))}
							</ul>
							{diagnosis.crashReportPath === null ? null : (
								<Button
									size="small"
									variant="ghost"
									icon="folder"
									onClick={() => {
										openPath(diagnosis.crashReportPath as string)
									}}
								>
									Open crash report
								</Button>
							)}
						</Card>
					))}
				</div>
			)}

			<div className="log-view">
				{(bundle.data?.lines ?? []).length === 0 ? (
					<small>No log output yet. Launch the instance to see live output here.</small>
				) : (
					(bundle.data?.lines ?? []).map((line, index) => (
						<div
							className={`log-line ${line.level}`}
							key={`${line.timestamp}-${index}`}
						>
							<span className="time">{line.timestamp.slice(11, 19)}</span>
							<span className="lvl">{line.level}</span>
							<span className="msg">{line.message}</span>
						</div>
					))
				)}
			</div>
		</div>
	)
}

function SettingsTab({
	instance,
	onPatch,
}: {
	instance: InstanceSummary
	onPatch: (patch: InstancePatch) => void
}): JSX.Element {
	const runtimes = useAsync<readonly JavaRuntime[]>(() => invoke("java:list"), [])
	const [jvmArgs, setJvmArgs] = useState(instance.jvmArgs)
	const [notes, setNotes] = useState(instance.notes)
	const [envText, setEnvText] = useState(
		Object.entries(instance.env)
			.map(([key, value]) => `${key}=${value}`)
			.join("\n"),
	)

	const commitEnv = (): void => {
		const env: Record<string, string> = {}
		for (const line of envText.split("\n")) {
			const index = line.indexOf("=")
			if (index > 0) {
				env[line.slice(0, index).trim()] = line.slice(index + 1).trim()
			}
		}
		onPatch({ env })
	}

	return (
		<div className="grid cols-2">
			<Card>
				<h3>Identity</h3>
				<div className="col" style={{ marginTop: 12 }}>
					<Field label="Name">
						<TextInput
							value={instance.name}
							onChange={(value) => {
								onPatch({ name: value })
							}}
						/>
					</Field>
					<Field label="Icon" hint="Any emoji works as an instance icon">
						<TextInput
							value={instance.icon ?? ""}
							onChange={(value) => {
								onPatch({ icon: value === "" ? null : value })
							}}
						/>
					</Field>
					<Field label="Group" hint="Group instances to organise large collections">
						<TextInput
							value={instance.group ?? ""}
							onChange={(value) => {
								onPatch({ group: value === "" ? null : value })
							}}
						/>
					</Field>
					<div className="row">
						<Button
							size="small"
							icon="upload"
							onClick={() => {
								void invoke("settings:pickImage").then((path) => {
									if (path !== null) {
										onPatch({ background: path })
									}
								})
							}}
						>
							Choose background
						</Button>
						{instance.background === null ? null : (
							<Button
								size="small"
								variant="ghost"
								onClick={() => {
									onPatch({ background: null })
								}}
							>
								Remove
							</Button>
						)}
					</div>
					<Field label="Notes">
						<textarea
							value={notes}
							onChange={(event) => {
								setNotes(event.target.value)
							}}
							onBlur={() => {
								onPatch({ notes })
							}}
						/>
					</Field>
				</div>
			</Card>

			<Card>
				<h3>Java and memory</h3>
				<div className="col" style={{ marginTop: 12 }}>
					<Field
						label="Java runtime"
						hint={`This version needs Java ${instance.requiredJavaMajor} or newer`}
					>
						<Select
							value={instance.javaPath ?? ""}
							onChange={(value) => {
								onPatch({ javaPath: value === "" ? null : value })
							}}
							options={[
								{ value: "", label: "Automatic (recommended)" },
								...(runtimes.data ?? []).map((runtime) => ({
									value: runtime.path,
									label: `Java ${runtime.major} · ${runtime.vendor}${runtime.managed ? " (managed)" : ""}`,
								})),
							]}
						/>
					</Field>
					<Button
						size="small"
						icon="folder"
						onClick={() => {
							void invoke("java:pick").then((runtime) => {
								if (runtime !== null) {
									onPatch({ javaPath: runtime.path })
									runtimes.reload()
								}
							})
						}}
					>
						Pick executable manually
					</Button>
					<Field label="Memory (MB)">
						<NumberInput
							value={instance.memoryMb}
							min={512}
							max={32768}
							step={256}
							onChange={(value) => {
								onPatch({ memoryMb: value })
							}}
						/>
					</Field>
					<Field label="JVM arguments">
						<textarea
							value={jvmArgs}
							onChange={(event) => {
								setJvmArgs(event.target.value)
							}}
							onBlur={() => {
								onPatch({ jvmArgs })
							}}
						/>
					</Field>
				</div>
			</Card>

			<Card>
				<h3>Window</h3>
				<div className="col" style={{ marginTop: 12 }}>
					<div className="grid cols-2">
						<Field label="Width">
							<NumberInput
								value={instance.window.width ?? 854}
								min={320}
								max={7680}
								onChange={(value) => {
									onPatch({ window: { ...instance.window, width: value } })
								}}
							/>
						</Field>
						<Field label="Height">
							<NumberInput
								value={instance.window.height ?? 480}
								min={240}
								max={4320}
								onChange={(value) => {
									onPatch({ window: { ...instance.window, height: value } })
								}}
							/>
						</Field>
					</div>
					<Toggle
						checked={instance.window.fullscreen}
						label="Start in fullscreen"
						onChange={(value) => {
							onPatch({ window: { ...instance.window, fullscreen: value } })
						}}
					/>
					<Toggle
						checked={instance.discordPresence}
						label="Discord Rich Presence for this instance"
						onChange={(value) => {
							onPatch({ discordPresence: value })
						}}
					/>
					<Toggle
						checked={instance.favorite}
						label="Pin to favourites"
						onChange={(value) => {
							onPatch({ favorite: value })
						}}
					/>
				</div>
			</Card>

			<Card>
				<h3>Environment variables</h3>
				<div className="col" style={{ marginTop: 12 }}>
					<Field label="KEY=VALUE per line">
						<textarea
							value={envText}
							onChange={(event) => {
								setEnvText(event.target.value)
							}}
							onBlur={commitEnv}
						/>
					</Field>
					<small>Applied to the game process only, never to the launcher itself.</small>
				</div>
			</Card>
		</div>
	)
}

export function InstanceDetailPage({
	instanceId,
	onBack,
}: {
	instanceId: string
	onBack: () => void
}): JSX.Element {
	const instance = useAsync<InstanceSummary | null>(
		() => invoke("instances:get", instanceId),
		[instanceId],
	)
	const [tab, setTab] = useState<TabKey>("overview")
	const [changing, setChanging] = useState(false)
	const [report, setReport] = useState<VerificationReport | null>(null)
	const [progressLabel, setProgressLabel] = useState<string | null>(null)
	const [progressFraction, setProgressFraction] = useState(0)

	useIpcEvent("instances:changed", (payload) => {
		if (payload.instanceId === null || payload.instanceId === instanceId) {
			instance.reload()
		}
	})

	useIpcEvent("launch:progress", (payload) => {
		if (payload.instanceId !== instanceId) {
			return
		}
		if (
			payload.state === "running" ||
			payload.state === "exited" ||
			payload.state === "error"
		) {
			setProgressLabel(null)
			instance.reload()
			return
		}
		setProgressLabel(`${payload.state}: ${payload.detail}`)
		setProgressFraction(payload.fraction)
	})

	const worlds = useAsync<readonly WorldEntry[]>(
		() => (tab === "worlds" ? invoke("instances:worlds", instanceId) : Promise.resolve([])),
		[instanceId, tab],
	)
	const screenshots = useAsync<readonly ScreenshotEntry[]>(
		() =>
			tab === "screenshots"
				? invoke("instances:screenshots", instanceId)
				: Promise.resolve([]),
		[instanceId, tab],
	)

	if (instance.data === undefined) {
		return (
			<Card>
				<Skeleton lines={6} />
			</Card>
		)
	}

	if (instance.data === null) {
		return (
			<EmptyState
				icon="alert"
				title="Instance not found"
				description="It may have been deleted from disk."
				action={<Button onClick={onBack}>Back to instances</Button>}
			/>
		)
	}

	const current = instance.data
	const patch = (values: InstancePatch): void => {
		void invoke("instances:update", current.id, values).then(instance.reload)
	}

	return (
		<>
			<div className="row wrap">
				<Button icon="chevron" variant="ghost" onClick={onBack} title="Back" />
				<div
					className="avatar"
					style={{
						width: 46,
						height: 46,
						fontSize: "1.2rem",
						...(current.background === null
							? {}
							: {
									backgroundImage: `url("file://${current.background}")`,
									backgroundSize: "cover",
								}),
					}}
				>
					{current.background === null ? (current.icon ?? "◆") : null}
				</div>
				<div className="col" style={{ gap: 2 }}>
					<h1>{current.name}</h1>
					<small>
						{current.gameVersion} · {current.loader}
						{current.loaderVersion === null ? "" : ` ${current.loaderVersion}`} ·{" "}
						{formatPlaytime(current.playtimeMinutes)} · {current.launchCount} launches ·{" "}
						{formatBytes(current.sizeBytes)}
					</small>
				</div>
				<span className="spacer" />
				<Button
					icon="cube"
					onClick={() => {
						setChanging(true)
					}}
				>
					Change version
				</Button>
				<Button
					variant={current.running ? "danger" : "primary"}
					icon={current.running ? "stop" : "play"}
					onClick={() => {
						if (current.running) {
							void invoke("instances:stop", current.id)
						} else {
							void invoke("instances:launch", current.id, null)
						}
					}}
				>
					{current.running ? "Stop" : "Play"}
				</Button>
			</div>

			{progressLabel === null ? null : (
				<Card flat>
					<div className="col">
						<div className="row between">
							<small>{progressLabel}</small>
							<small>{Math.round(progressFraction * 100)}%</small>
						</div>
						<ProgressBar fraction={progressFraction} />
					</div>
				</Card>
			)}

			<Tabs
				value={tab}
				onChange={setTab}
				tabs={[
					{ value: "overview", label: "Overview" },
					{ value: "mods", label: "Mods" },
					{ value: "resourcepacks", label: "Resource packs" },
					{ value: "shaderpacks", label: "Shaders" },
					{ value: "datapacks", label: "Datapacks" },
					{ value: "worlds", label: "Worlds" },
					{ value: "screenshots", label: "Screenshots" },
					{ value: "backups", label: "Backups" },
					{ value: "logs", label: "Logs" },
					{ value: "settings", label: "Settings" },
				]}
			/>

			{tab === "overview" ? (
				<div className="grid cols-2">
					<Card>
						<h3>Health</h3>
						<div className="col" style={{ marginTop: 12 }}>
							<div className="row wrap">
								<Badge tone={current.installed ? "success" : "warning"}>
									{current.installed ? "Installed" : "Needs installing"}
								</Badge>
								<Badge>Java {current.requiredJavaMajor}</Badge>
								<Badge>{current.modCount} mods</Badge>
							</div>
							<div className="row wrap">
								<Button
									size="small"
									icon="check"
									onClick={() => {
										void invoke("instances:verify", current.id).then(setReport)
									}}
								>
									Verify files
								</Button>
								<Button
									size="small"
									icon="refresh"
									onClick={() => {
										void invoke("instances:repair", current.id).then(setReport)
									}}
								>
									Repair
								</Button>
								<Button
									size="small"
									icon="folder"
									onClick={() => {
										void invoke("instances:openFolder", current.id, null)
									}}
								>
									Open folder
								</Button>
								<Button
									size="small"
									icon="upload"
									onClick={() => {
										void invoke("instances:export", current.id)
									}}
								>
									Export
								</Button>
								<Button
									size="small"
									icon="copy"
									onClick={() => {
										void invoke("instances:duplicate", current.id, null)
									}}
								>
									Duplicate
								</Button>
							</div>
							{report === null ? null : (
								<small>
									Checked {report.checked} files, repaired {report.repaired},
									missing {report.missing}, corrupt {report.corrupt} in{" "}
									{Math.round(report.durationMs / 100) / 10}s
								</small>
							)}
						</div>
					</Card>

					<Card>
						<h3>Activity</h3>
						<div className="col" style={{ marginTop: 12 }}>
							<div className="row between">
								<small>Last played</small>
								<span>{formatRelative(current.lastPlayedAt)}</span>
							</div>
							<div className="row between">
								<small>Created</small>
								<span>{formatDate(current.createdAt)}</span>
							</div>
							<div className="row between">
								<small>Playtime</small>
								<span>{formatPlaytime(current.playtimeMinutes)}</span>
							</div>
							<div className="row between">
								<small>Folder</small>
								<small>{current.directory}</small>
							</div>
							{current.notes === "" ? null : <small>{current.notes}</small>}
						</div>
					</Card>
				</div>
			) : null}

			{tab === "mods" ? <ContentTab instanceId={current.id} kind="mod" /> : null}
			{tab === "resourcepacks" ? (
				<ContentTab instanceId={current.id} kind="resourcepack" />
			) : null}
			{tab === "shaderpacks" ? (
				<ContentTab instanceId={current.id} kind="shaderpack" />
			) : null}
			{tab === "datapacks" ? <ContentTab instanceId={current.id} kind="datapack" /> : null}

			{tab === "worlds" ? (
				(worlds.data ?? []).length === 0 ? (
					<EmptyState
						icon="cube"
						title="No worlds yet"
						description="Create a world in game and it appears here."
					/>
				) : (
					<div className="list">
						{(worlds.data ?? []).map((world) => (
							<div className="list-row" key={world.folderName}>
								<Icon name="cube" size={17} />
								<div className="col" style={{ gap: 2, flex: 1 }}>
									<strong>{world.name}</strong>
									<small>
										{world.folderName} · {formatBytes(world.sizeBytes)} · played{" "}
										{formatRelative(world.lastPlayedAt)}
									</small>
								</div>
								<Button
									size="small"
									variant="ghost"
									icon="folder"
									onClick={() => {
										void invoke("instances:openFolder", current.id, "saves")
									}}
								/>
							</div>
						))}
					</div>
				)
			) : null}

			{tab === "screenshots" ? (
				(screenshots.data ?? []).length === 0 ? (
					<EmptyState
						icon="sparkle"
						title="No screenshots yet"
						description="Press F2 in game and your captures appear here."
					/>
				) : (
					<div className="gallery">
						{(screenshots.data ?? []).map((shot) => (
							<button
								key={shot.filePath}
								type="button"
								style={{
									border: "none",
									background: "none",
									padding: 0,
									cursor: "pointer",
								}}
								title={`${shot.fileName} · ${formatBytes(shot.sizeBytes)}`}
								onClick={() => {
									openPath(shot.filePath)
								}}
							>
								<img src={`file://${shot.filePath}`} alt={shot.fileName} />
							</button>
						))}
					</div>
				)
			) : null}

			{tab === "backups" ? <BackupsTab instanceId={current.id} /> : null}
			{tab === "logs" ? <LogsTab instanceId={current.id} /> : null}
			{tab === "settings" ? <SettingsTab instance={current} onPatch={patch} /> : null}

			{changing ? (
				<VersionChangeModal
					instance={current}
					onClose={() => {
						setChanging(false)
						instance.reload()
					}}
				/>
			) : null}
		</>
	)
}
