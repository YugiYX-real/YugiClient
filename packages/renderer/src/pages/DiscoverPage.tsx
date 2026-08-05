import { useMemo, useState } from "react"
import type {
	ContentKind,
	InstanceSummary,
	LoaderId,
	ModrinthProject,
	ModrinthProjectDetail,
	ModrinthSearchQuery,
	ModrinthSearchResult,
	ModrinthSortOrder,
	ModrinthVersion,
} from "@halcyon/ipc"
import {
	Badge,
	Button,
	Card,
	EmptyState,
	Field,
	Modal,
	SearchInput,
	SectionHeader,
	Select,
	Skeleton,
	Tabs,
	Toggle,
} from "../components/primitives.tsx"
import { invoke, openExternal } from "../lib/client.ts"
import { useAsync, useDebounced } from "../lib/hooks.ts"
import { formatBytes, formatCount, formatDate } from "../lib/format.ts"

const KINDS: readonly { value: ContentKind; label: string }[] = [
	{ value: "mod", label: "Mods" },
	{ value: "shaderpack", label: "Shaders" },
	{ value: "resourcepack", label: "Resource packs" },
	{ value: "datapack", label: "Datapacks" },
]

const SORTS: readonly { value: ModrinthSortOrder; label: string }[] = [
	{ value: "relevance", label: "Relevance" },
	{ value: "downloads", label: "Downloads" },
	{ value: "follows", label: "Followers" },
	{ value: "newest", label: "Newest" },
	{ value: "updated", label: "Recently updated" },
]

const PAGE_SIZE = 24

function ProjectModal({
	projectId,
	instance,
	kind,
	onClose,
}: {
	projectId: string
	instance: InstanceSummary | undefined
	kind: ContentKind
	onClose: () => void
}): JSX.Element {
	const detail = useAsync<ModrinthProjectDetail>(
		() => invoke("modrinth:project", projectId),
		[projectId],
	)
	const [filterToInstance, setFilterToInstance] = useState(true)
	const [withDependencies, setWithDependencies] = useState(true)
	const [busyVersion, setBusyVersion] = useState<string | null>(null)
	const [outcome, setOutcome] = useState<string | null>(null)

	const loaderFilter: LoaderId | null =
		filterToInstance && instance !== undefined && kind === "mod" ? instance.loader : null
	const gameVersionFilter =
		filterToInstance && instance !== undefined ? instance.gameVersion : null

	const versions = useAsync<readonly ModrinthVersion[]>(
		() => invoke("modrinth:versions", projectId, gameVersionFilter, loaderFilter),
		[projectId, gameVersionFilter, loaderFilter],
	)

	const install = async (versionId: string): Promise<void> => {
		if (instance === undefined) {
			return
		}
		setBusyVersion(versionId)
		try {
			const result = await invoke(
				"modrinth:install",
				instance.id,
				versionId,
				withDependencies,
			)
			setOutcome(
				`Installed ${result.installed.length} file(s), skipped ${result.skipped.length}` +
					(result.problems.length === 0 ? "" : ` · ${result.problems.join(", ")}`),
			)
		} finally {
			setBusyVersion(null)
		}
	}

	return (
		<Modal
			wide
			title={detail.data?.title ?? "Loading"}
			subtitle={detail.data === undefined ? undefined : `by ${detail.data.author}`}
			onClose={onClose}
		>
			{detail.data === undefined ? (
				<Skeleton lines={6} />
			) : (
				<>
					<div className="row wrap">
						<Badge tone="accent">{formatCount(detail.data.downloads)} downloads</Badge>
						<Badge>{formatCount(detail.data.follows)} followers</Badge>
						{detail.data.license === null ? null : <Badge>{detail.data.license}</Badge>}
						<Badge>updated {formatDate(detail.data.updatedAt)}</Badge>
						<span className="spacer" />
						{detail.data.sourceUrl === null ? null : (
							<Button
								size="small"
								variant="ghost"
								onClick={() => {
									openExternal(detail.data?.sourceUrl ?? "")
								}}
							>
								Source
							</Button>
						)}
						{detail.data.issuesUrl === null ? null : (
							<Button
								size="small"
								variant="ghost"
								onClick={() => {
									openExternal(detail.data?.issuesUrl ?? "")
								}}
							>
								Issues
							</Button>
						)}
					</div>

					{detail.data.gallery.length === 0 ? null : (
						<div className="gallery">
							{detail.data.gallery.map((image) => (
								<img
									key={image.url}
									src={image.url}
									alt={image.title ?? ""}
									title={image.title ?? ""}
								/>
							))}
						</div>
					)}

					<div className="markdown">{detail.data.body}</div>

					<div className="row wrap">
						{instance === undefined ? (
							<Badge tone="warning">Select a target instance to install</Badge>
						) : (
							<>
								<Badge tone="accent">Installing into {instance.name}</Badge>
								<Toggle
									checked={filterToInstance}
									onChange={setFilterToInstance}
									label="Only compatible versions"
								/>
								<Toggle
									checked={withDependencies}
									onChange={setWithDependencies}
									label="Install dependencies"
								/>
							</>
						)}
					</div>

					{outcome === null ? null : <Badge tone="success">{outcome}</Badge>}

					<SectionHeader
						title="Versions"
						subtitle="Changelogs and dependencies included"
					/>
					{versions.data === undefined ? (
						<Skeleton lines={4} />
					) : versions.data.length === 0 ? (
						<EmptyState
							icon="alert"
							title="No compatible versions"
							description="Turn off the compatibility filter to see every release."
						/>
					) : (
						<div className="col">
							{versions.data.slice(0, 12).map((version) => (
								<Card key={version.id} flat>
									<div className="row wrap">
										<strong>{version.name}</strong>
										<Badge
											tone={
												version.channel === "release"
													? "success"
													: "warning"
											}
										>
											{version.channel}
										</Badge>
										<Badge>{version.versionNumber}</Badge>
										<small>
											{formatDate(version.datePublished)} ·{" "}
											{formatBytes(version.fileSize)} ·{" "}
											{formatCount(version.downloads)} downloads
										</small>
										<span className="spacer" />
										<Button
											size="small"
											variant="primary"
											icon="downloads"
											disabled={instance === undefined}
											busy={busyVersion === version.id}
											onClick={() => {
												void install(version.id)
											}}
										>
											Install
										</Button>
									</div>
									<div className="row wrap" style={{ marginTop: 8, gap: 6 }}>
										{version.gameVersions.slice(0, 6).map((gameVersion) => (
											<Badge key={gameVersion}>{gameVersion}</Badge>
										))}
										{version.loaders.map((loader) => (
											<Badge key={loader} tone="accent">
												{loader}
											</Badge>
										))}
										{version.dependencies.length === 0 ? null : (
											<Badge tone="warning">
												{version.dependencies.length} dependencies
											</Badge>
										)}
									</div>
									{version.changelog === null ||
									version.changelog === "" ? null : (
										<details style={{ marginTop: 8 }}>
											<summary
												style={{
													cursor: "pointer",
													color: "var(--muted)",
													fontSize: "0.82rem",
												}}
											>
												Changelog
											</summary>
											<div className="markdown" style={{ marginTop: 8 }}>
												{version.changelog}
											</div>
										</details>
									)}
								</Card>
							))}
						</div>
					)}
				</>
			)}
		</Modal>
	)
}

export function DiscoverPage(): JSX.Element {
	const instances = useAsync<readonly InstanceSummary[]>(() => invoke("instances:list"), [])
	const [instanceId, setInstanceId] = useState("")
	const [kind, setKind] = useState<ContentKind>("mod")
	const [query, setQuery] = useState("")
	const [sort, setSort] = useState<ModrinthSortOrder>("relevance")
	const [category, setCategory] = useState("")
	const [restrictToInstance, setRestrictToInstance] = useState(true)
	const [page, setPage] = useState(0)
	const [openProject, setOpenProject] = useState<string | null>(null)

	const debouncedQuery = useDebounced(query)
	const selected = (instances.data ?? []).find((instance) => instance.id === instanceId)
	const categories = useAsync<readonly string[]>(
		() => invoke("modrinth:categories", kind),
		[kind],
	)

	const search = useAsync<ModrinthSearchResult>(() => {
		const request: ModrinthSearchQuery = {
			projectType: kind,
			sort,
			offset: page * PAGE_SIZE,
			limit: PAGE_SIZE,
			...(debouncedQuery.trim() === "" ? {} : { query: debouncedQuery.trim() }),
			...(category === "" ? {} : { categories: [category] }),
			...(restrictToInstance && selected !== undefined
				? {
						gameVersion: selected.gameVersion,
						...(kind === "mod" && selected.loader !== "vanilla"
							? { loader: selected.loader }
							: {}),
					}
				: {}),
		}
		return invoke("modrinth:search", request)
	}, [
		kind,
		sort,
		page,
		debouncedQuery,
		category,
		restrictToInstance,
		selected?.id,
		selected?.gameVersion,
	])

	const hits: readonly ModrinthProject[] = search.data?.hits ?? []
	const totalPages = useMemo(
		() => Math.max(1, Math.ceil((search.data?.total ?? 0) / PAGE_SIZE)),
		[search.data?.total],
	)

	return (
		<>
			<div className="row wrap">
				<Tabs
					value={kind}
					onChange={(value) => {
						setKind(value)
						setCategory("")
						setPage(0)
					}}
					tabs={KINDS}
				/>
				<SearchInput
					value={query}
					onChange={(value) => {
						setQuery(value)
						setPage(0)
					}}
					placeholder="Search Modrinth"
				/>
			</div>

			<Card flat>
				<div className="row wrap">
					<Field label="Install target">
						<Select
							value={instanceId}
							onChange={(value) => {
								setInstanceId(value)
								setPage(0)
							}}
							options={[
								{ value: "", label: "No instance selected" },
								...(instances.data ?? []).map((instance) => ({
									value: instance.id,
									label: `${instance.name} · ${instance.gameVersion} · ${instance.loader}`,
								})),
							]}
						/>
					</Field>
					<Field label="Category">
						<Select
							value={category}
							onChange={(value) => {
								setCategory(value)
								setPage(0)
							}}
							options={[
								{ value: "", label: "All categories" },
								...(categories.data ?? []).map((name) => ({
									value: name,
									label: name,
								})),
							]}
						/>
					</Field>
					<Field label="Sort by">
						<Select
							value={sort}
							onChange={(value) => {
								setSort(value)
								setPage(0)
							}}
							options={SORTS}
						/>
					</Field>
					<div className="col" style={{ justifyContent: "flex-end" }}>
						<Toggle
							checked={restrictToInstance}
							onChange={(value) => {
								setRestrictToInstance(value)
								setPage(0)
							}}
							label="Match selected instance"
						/>
					</div>
				</div>
			</Card>

			{search.error !== null ? (
				<EmptyState
					icon="alert"
					title="Modrinth is unreachable"
					description={search.error}
					action={<Button onClick={search.reload}>Try again</Button>}
				/>
			) : search.data === undefined ? (
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
			) : hits.length === 0 ? (
				<EmptyState
					icon="search"
					title="Nothing matched"
					description="Try a different term or clear the filters."
				/>
			) : (
				<>
					<div className="grid cols-3">
						{hits.map((project) => (
							<Card
								key={project.id}
								interactive
								onClick={() => {
									setOpenProject(project.id)
								}}
							>
								<div className="row" style={{ alignItems: "flex-start" }}>
									{project.iconUrl === null ? (
										<div className="mod-art" />
									) : (
										<img className="mod-art" src={project.iconUrl} alt="" />
									)}
									<div className="col" style={{ gap: 2, minWidth: 0 }}>
										<strong
											style={{
												overflow: "hidden",
												textOverflow: "ellipsis",
												whiteSpace: "nowrap",
											}}
										>
											{project.title}
										</strong>
										<small>
											{project.author} · {formatCount(project.downloads)}{" "}
											downloads
										</small>
									</div>
								</div>
								<small style={{ display: "block", marginTop: 10 }}>
									{project.description}
								</small>
								<div className="row wrap" style={{ marginTop: 10, gap: 6 }}>
									{project.categories.slice(0, 3).map((name) => (
										<Badge key={name}>{name}</Badge>
									))}
								</div>
							</Card>
						))}
					</div>

					<div className="row">
						<Button
							size="small"
							disabled={page === 0}
							onClick={() => {
								setPage(Math.max(0, page - 1))
							}}
						>
							Previous
						</Button>
						<small>
							Page {page + 1} of {totalPages} · {formatCount(search.data.total)}{" "}
							results
						</small>
						<Button
							size="small"
							disabled={page + 1 >= totalPages}
							onClick={() => {
								setPage(page + 1)
							}}
						>
							Next
						</Button>
					</div>
				</>
			)}

			{openProject === null ? null : (
				<ProjectModal
					projectId={openProject}
					instance={selected}
					kind={kind}
					onClose={() => {
						setOpenProject(null)
					}}
				/>
			)}
		</>
	)
}
