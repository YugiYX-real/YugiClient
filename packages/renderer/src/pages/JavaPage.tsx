import { useState } from "react"
import type { JavaRuntime } from "@halcyon/ipc"
import {
	Badge,
	Button,
	Card,
	EmptyState,
	SectionHeader,
	Skeleton,
} from "../components/primitives.tsx"
import { Icon } from "../components/Icon.tsx"
import { invoke, openPath } from "../lib/client.ts"
import { useAsync } from "../lib/hooks.ts"

const MANAGED_MAJORS: readonly number[] = [8, 17, 21]

export function JavaPage(): JSX.Element {
	const runtimes = useAsync<readonly JavaRuntime[]>(() => invoke("java:list"), [])
	const [busyMajor, setBusyMajor] = useState<number | null>(null)
	const [scanning, setScanning] = useState(false)

	const install = async (major: number): Promise<void> => {
		setBusyMajor(major)
		try {
			await invoke("java:install", major)
			runtimes.reload()
		} finally {
			setBusyMajor(null)
		}
	}

	const scan = async (): Promise<void> => {
		setScanning(true)
		try {
			await invoke("java:detect")
			runtimes.reload()
		} finally {
			setScanning(false)
		}
	}

	const entries = runtimes.data ?? []
	const installedMajors = new Set(
		entries.filter((runtime) => runtime.valid).map((runtime) => runtime.major),
	)

	return (
		<>
			<div className="row wrap">
				<Button
					variant="primary"
					icon="search"
					busy={scanning}
					onClick={() => {
						void scan()
					}}
				>
					Scan for runtimes
				</Button>
				<Button
					icon="folder"
					onClick={() => {
						void invoke("java:pick").then(() => {
							runtimes.reload()
						})
					}}
				>
					Add manually
				</Button>
			</div>

			<Card>
				<SectionHeader
					title="Managed runtimes"
					subtitle="Halcyon downloads verified Eclipse Temurin builds for the versions your instances need"
				/>
				<div className="grid cols-3" style={{ marginTop: 14 }}>
					{MANAGED_MAJORS.map((major) => (
						<Card key={major} flat>
							<div className="row between">
								<div className="row" style={{ gap: 8 }}>
									<Icon name="java" size={18} />
									<strong>Java {major}</strong>
								</div>
								{installedMajors.has(major) ? (
									<Badge tone="success">ready</Badge>
								) : null}
							</div>
							<small style={{ display: "block", marginTop: 8 }}>
								{major === 8
									? "Needed for 1.16.5 and older"
									: major === 17
										? "Needed for 1.17 through 1.20.4"
										: "Needed for 1.20.5 and newer"}
							</small>
							<Button
								size="small"
								block
								variant={installedMajors.has(major) ? "ghost" : "primary"}
								icon="downloads"
								busy={busyMajor === major}
								onClick={() => {
									void install(major)
								}}
							>
								{installedMajors.has(major) ? "Reinstall" : "Install"}
							</Button>
						</Card>
					))}
				</div>
			</Card>

			<Card>
				<SectionHeader
					title="Detected runtimes"
					subtitle={`${entries.length} runtimes on this machine`}
				/>
				{runtimes.loading && runtimes.data === undefined ? (
					<Skeleton lines={4} />
				) : entries.length === 0 ? (
					<EmptyState
						icon="java"
						title="No Java found"
						description="Install a managed runtime above and Halcyon will use it automatically."
					/>
				) : (
					<div className="list" style={{ marginTop: 14 }}>
						{entries.map((runtime) => (
							<div className="list-row" key={runtime.path}>
								<Icon name={runtime.valid ? "check" : "alert"} size={17} />
								<div className="col" style={{ gap: 2, flex: 1, minWidth: 0 }}>
									<div className="row" style={{ gap: 8 }}>
										<strong>Java {runtime.major}</strong>
										<Badge>{runtime.version}</Badge>
										{runtime.managed ? (
											<Badge tone="accent">managed</Badge>
										) : null}
										{runtime.valid ? null : (
											<Badge tone="danger">unusable</Badge>
										)}
									</div>
									<small
										style={{
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
										}}
									>
										{runtime.vendor} · {runtime.path}
									</small>
									{runtime.error === null ? null : <small>{runtime.error}</small>}
								</div>
								<Button
									size="small"
									variant="ghost"
									icon="refresh"
									title="Revalidate"
									onClick={() => {
										void invoke("java:validate", runtime.path).then(
											runtimes.reload,
										)
									}}
								/>
								<Button
									size="small"
									variant="ghost"
									icon="folder"
									title="Reveal"
									onClick={() => {
										openPath(runtime.path)
									}}
								/>
							</div>
						))}
					</div>
				)}
			</Card>
		</>
	)
}
