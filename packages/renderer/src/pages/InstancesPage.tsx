import { useMemo, useState } from "react"
import type {
	CreateInstanceInput,
	InstanceSummary,
	LoaderId,
	LoaderVersion,
	VersionEntry,
} from "@halcyon/ipc"
import {
	Badge,
	Button,
	Card,
	ConfirmDialog,
	ContextMenu,
	EmptyState,
	Field,
	Modal,
	NumberInput,
	SearchInput,
	Select,
	Skeleton,
	Tabs,
	TextInput,
} from "../components/primitives.tsx"
import type { ContextMenuItem } from "../components/primitives.tsx"
import { invoke } from "../lib/client.ts"
import { useAsync, useIpcEvent } from "../lib/hooks.ts"
import { formatBytes, formatPlaytime, formatRelative, initialsOf } from "../lib/format.ts"

const LOADERS: readonly { value: LoaderId; label: string }[] = [
	{ value: "vanilla", label: "Vanilla" },
	{ value: "fabric", label: "Fabric" },
	{ value: "forge", label: "Forge" },
	{ value: "neoforge", label: "NeoForge" },
	{ value: "quilt", label: "Quilt" },
]

type SortKey = "recent" | "name" | "playtime"

function CreateInstanceModal({
	onClose,
	onCreated,
}: {
	onClose: () => void
	onCreated: () => void
}): JSX.Element {
	const [name, setName] = useState("")
	const [loader, setLoader] = useState<LoaderId>("fabric")
	const [search, setSearch] = useState("")
	const [gameVersion, setGameVersion] = useState("")
	const [loaderVersion, setLoaderVersion] = useState("")
	const [memoryMb, setMemoryMb] = useState(4096)
	const [showSnapshots, setShowSnapshots] = useState(false)
	const [busy, setBusy] = useState(false)

	const versions = useAsync<readonly VersionEntry[]>(
		() => invoke("versions:list", { channels: showSnapshots ? ["release", "snapshot"] : ["release"] }),
		[showSnapshots],
	)

	const loaderVersions = useAsync<readonly LoaderVersion[]>(
		() =>
			loader === "vanilla" || gameVersion === ""
				? Promise.resolve([])
				: invoke("loaders:list", loader, gameVersion),
		[loader, gameVersion],
	)

	const filtered = useMemo(() => {
		const entries = versions.data ?? []
		const needle = search.trim().toLowerCase()
		return needle === ""
			? entries.slice(0, 60)
			: entries.filter((entry) => entry.id.toLowerCase().includes(needle)).slice(0, 60)
	}, [versions.data, search])

	const create = async (): Promise<void> => {
		if (gameVersion === "") {
			return
		}
		setBusy(true)
		try {
			const input: CreateInstanceInput = {
				name: name.trim() === "" ? `${gameVersion} ${loader}` : name.trim(),
				gameVersion,
				loader,
				memoryMb,
				install: true,
				...(loaderVersion === "" ? {} : { loaderVersion }),
			}
			await invoke("instances:create", input)
			onCreated()
			onClose()
		} finally {
			setBusy(false)
		}
	}

	return (
		<Modal
			wide
			title="New instance"
			subtitle="Pick a version and loader; Halcyon downloads everything in the background"
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
						disabled={gameVersion === ""}
						onClick={() => {
							void create()
						}}
					>
						Create instance
					</Button>
				</>
			}
		>
			<div className="grid cols-2">
				<Field label="Name" hint="Leave empty to name it after the version">
					<TextInput value={name} onChange={setName} placeholder="My survival world" />
				</Field>
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
			</div>

			<Field label="Minecraft version">
				<div className="col">
					<div className="row">
						<SearchInput value={search} onChange={setSearch} placeholder="Search versions" />
						<Button
							size="small"
							variant={showSnapshots ? "primary" : "ghost"}
							icon="filter"
							onClick={() => {
								setShowSnapshots(!showSnapshots)
							}}
						>
							Snapshots
						</Button>
					</div>
					<div className="list" style={{ maxHeight: 220, overflowY: "auto" }}>
						{versions.loading ? (
							<div style={{ padding: 14 }}>
								<Skeleton lines={4} />
							</div>
						) : (
							filtered.map((entry) => (
								<button
									key={entry.id}
									type="button"
									className={entry.id === gameVersion ? "list-row selected" : "list-row"}
									style={{ border: "none", cursor: "pointer", textAlign: "left" }}
									onClick={() => {
										setGameVersion(entry.id)
										setLoaderVersion("")
									}}
								>
									<strong style={{ minWidth: 110 }}>{entry.id}</strong>
									<Badge>{entry.channel}</Badge>
									{entry.installed ? <Badge tone="success">installed</Badge> : null}
									<span className="spacer" />
									<small>Java {entry.requiredJavaMajor}</small>
								</button>
							))
						)}
					</div>
				</div>
			</Field>

			<div className="grid cols-2">
				{loader === "vanilla" ? null : (
					<Field label="Loader version" hint="Leave on recommended unless a modpack needs otherwise">
						<Select
							value={loaderVersion}
							onChange={setLoaderVersion}
							options={[
								{ value: "", label: "Recommended" },
								...(loaderVersions.data ?? []).map((version) => ({
									value: version.id,
									label: version.recommended ? `${version.id} (recommended)` : version.id,
								})),
							]}
						/>
					</Field>
				)}
				<Field label="Memory (MB)" hint="Halcyon suggests a value based on your system">
					<NumberInput value={memoryMb} onChange={setMemoryMb} min={512} max={32768} step={256} />
				</Field>
			</div>
		</Modal>
	)
}

export function InstancesPage({ onOpen }: { onOpen: (instanceId: string) => void }): JSX.Element {
	const instances = useAsync<readonly InstanceSummary[]>(() => invoke("instances:list"), [])
	const [search, setSearch] = useState("")
	const [loaderFilter, setLoaderFilter] = useState<LoaderId | "all">("all")
	const [sort, setSort] = useState<SortKey>("recent")
	const [creating, setCreating] = useState(false)
	const [menu, setMenu] = useState<{ x: number; y: number; instance: InstanceSummary } | null>(null)
	const [renaming, setRenaming] = useState<InstanceSummary | null>(null)
	const [renameValue, setRenameValue] = useState("")
	const [deleting, setDeleting] = useState<InstanceSummary | null>(null)

	useIpcEvent("instances:changed", instances.reload)

	const visible = useMemo(() => {
		const needle = search.trim().toLowerCase()
		const entries = (instances.data ?? []).filter((instance) => {
			const matchesLoader = loaderFilter === "all" || instance.loader === loaderFilter
			const matchesSearch =
				needle === "" ||
				instance.name.toLowerCase().includes(needle) ||
				instance.gameVersion.toLowerCase().includes(needle)
			return matchesLoader && matchesSearch
		})

		return [...entries].sort((left, right) => {
			if (left.favorite !== right.favorite) {
				return left.favorite ? -1 : 1
			}
			if (sort === "name") {
				return left.name.localeCompare(right.name)
			}
			if (sort === "playtime") {
				return right.playtimeMinutes - left.playtimeMinutes
			}
			return (right.lastPlayedAt ?? "").localeCompare(left.lastPlayedAt ?? "")
		})
	}, [instances.data, search, loaderFilter, sort])

	const menuItems = (instance: InstanceSummary): readonly ContextMenuItem[] => [
		{
			label: instance.running ? "Stop" : "Launch",
			icon: instance.running ? "stop" : "play",
			onSelect: () => {
				if (instance.running) {
					void invoke("instances:stop", instance.id)
				} else {
					void invoke("instances:launch", instance.id, null)
				}
			},
		},
		{
			label: instance.favorite ? "Remove favourite" : "Add to favourites",
			icon: "star",
			onSelect: () => {
				void invoke("instances:update", instance.id, { favorite: !instance.favorite })
			},
		},
		{
			label: "Rename",
			icon: "copy",
			onSelect: () => {
				setRenameValue(instance.name)
				setRenaming(instance)
			},
		},
		{
			label: "Duplicate",
			icon: "cube",
			onSelect: () => {
				void invoke("instances:duplicate", instance.id, null)
			},
		},
		{
			label: "Export",
			icon: "upload",
			onSelect: () => {
				void invoke("instances:export", instance.id)
			},
		},
		{
			label: "Open folder",
			icon: "folder",
			onSelect: () => {
				void invoke("instances:openFolder", instance.id, null)
			},
		},
		{
			label: "Delete",
			icon: "trash",
			danger: true,
			onSelect: () => {
				setDeleting(instance)
			},
		},
	]

	return (
		<>
			<div className="row wrap">
				<SearchInput value={search} onChange={setSearch} placeholder="Search instances" />
				<Tabs
					value={loaderFilter}
					onChange={setLoaderFilter}
					tabs={[{ value: "all" as const, label: "All" }, ...LOADERS]}
				/>
				<span className="spacer" />
				<Select
					value={sort}
					onChange={setSort}
					options={[
						{ value: "recent", label: "Recently played" },
						{ value: "name", label: "Name" },
						{ value: "playtime", label: "Playtime" },
					]}
				/>
				<Button
					icon="downloads"
					variant="ghost"
					onClick={() => {
						void invoke("instances:import")
					}}
				>
					Import
				</Button>
				<Button
					icon="cube"
					variant="ghost"
					title="Import instances from the official Minecraft launcher"
					onClick={() => {
						void invoke("instances:importOfficial")
					}}
				>
					From official launcher
				</Button>
				<Button
					icon="plus"
					variant="primary"
					onClick={() => {
						setCreating(true)
					}}
				>
					New instance
				</Button>
			</div>

			{instances.loading && instances.data === undefined ? (
				<div className="grid cols-3">
					<Card>
						<Skeleton lines={4} />
					</Card>
					<Card>
						<Skeleton lines={4} />
					</Card>
					<Card>
						<Skeleton lines={4} />
					</Card>
				</div>
			) : visible.length === 0 ? (
				<EmptyState
					icon="instances"
					title="No instances yet"
					description="Create one from any Minecraft version, with or without a mod loader."
					action={
						<Button
							variant="primary"
							icon="plus"
							onClick={() => {
								setCreating(true)
							}}
						>
							Create an instance
						</Button>
					}
				/>
			) : (
				<div className="grid cols-3">
					{visible.map((instance) => (
						<Card
							key={instance.id}
							interactive
							className="instance-tile"
							onClick={() => {
								onOpen(instance.id)
							}}
							onContextMenu={(event) => {
								event.preventDefault()
								setMenu({ x: event.clientX, y: event.clientY, instance })
							}}
						>
							<div
								className="art"
								style={
									instance.background === null
										? undefined
										: { backgroundImage: `url("file://${instance.background}")` }
								}
							>
								{instance.background === null ? (instance.icon ?? initialsOf(instance.name)) : null}
							</div>
							<div className="row between">
								<strong>{instance.name}</strong>
								{instance.favorite ? <Badge tone="accent" icon="star">Pinned</Badge> : null}
							</div>
							<div className="row wrap" style={{ gap: 6 }}>
								<Badge>{instance.gameVersion}</Badge>
								<Badge>{instance.loader}</Badge>
								{instance.modCount > 0 ? <Badge>{instance.modCount} mods</Badge> : null}
								{instance.running ? <Badge tone="success">running</Badge> : null}
								{instance.installed ? null : <Badge tone="warning">not installed</Badge>}
							</div>
							<small>
								{formatPlaytime(instance.playtimeMinutes)} · {formatBytes(instance.sizeBytes)} ·{" "}
								{formatRelative(instance.lastPlayedAt)}
							</small>
							<div className="row">
								<Button
									block
									variant={instance.running ? "danger" : "primary"}
									icon={instance.running ? "stop" : "play"}
									onClick={() => {
										if (instance.running) {
											void invoke("instances:stop", instance.id)
										} else {
											void invoke("instances:launch", instance.id, null)
										}
									}}
								>
									{instance.running ? "Stop" : "Play"}
								</Button>
							</div>
						</Card>
					))}
				</div>
			)}

			{menu === null ? null : (
				<ContextMenu
					position={{ x: menu.x, y: menu.y }}
					items={menuItems(menu.instance)}
					onClose={() => {
						setMenu(null)
					}}
				/>
			)}

			{creating ? (
				<CreateInstanceModal
					onClose={() => {
						setCreating(false)
					}}
					onCreated={instances.reload}
				/>
			) : null}

			{renaming === null ? null : (
				<Modal
					title="Rename instance"
					onClose={() => {
						setRenaming(null)
					}}
					footer={
						<>
							<Button
								variant="ghost"
								onClick={() => {
									setRenaming(null)
								}}
							>
								Cancel
							</Button>
							<Button
								variant="primary"
								onClick={() => {
									const target = renaming
									setRenaming(null)
									void invoke("instances:rename", target.id, renameValue)
								}}
							>
								Save
							</Button>
						</>
					}
				>
					<Field label="Name">
						<TextInput value={renameValue} onChange={setRenameValue} />
					</Field>
				</Modal>
			)}

			{deleting === null ? null : (
				<ConfirmDialog
					title="Delete instance"
					message={`${deleting.name} and everything inside it will be moved to the trash. Backups are deleted too.`}
					confirmLabel="Delete"
					destructive
					onCancel={() => {
						setDeleting(null)
					}}
					onConfirm={() => {
						const target = deleting
						setDeleting(null)
						void invoke("instances:delete", target.id)
					}}
				/>
			)}
		</>
	)
}
