import { useState } from "react"
import type { Account, SkinEntry, SkinModel } from "@halcyon/ipc"
import {
	Badge,
	Button,
	Card,
	ConfirmDialog,
	DropZone,
	EmptyState,
	Field,
	Modal,
	SectionHeader,
	Select,
	Skeleton,
	TextInput,
} from "../components/primitives.tsx"
import { SkinPreview } from "../components/SkinPreview.tsx"
import { invoke } from "../lib/client.ts"
import { useAsync, useIpcEvent } from "../lib/hooks.ts"
import { formatDate } from "../lib/format.ts"

const MODELS: readonly { value: SkinModel; label: string }[] = [
	{ value: "classic", label: "Classic (4px arms)" },
	{ value: "slim", label: "Slim (3px arms)" },
]

export function SkinsPage(): JSX.Element {
	const skins = useAsync<readonly SkinEntry[]>(() => invoke("skins:list"), [])
	const accounts = useAsync<readonly Account[]>(() => invoke("accounts:list"), [])
	const [activeId, setActiveId] = useState<string | null>(null)
	const [uploading, setUploading] = useState(false)
	const [uploadName, setUploadName] = useState("")
	const [uploadModel, setUploadModel] = useState<SkinModel>("classic")
	const [uploadPath, setUploadPath] = useState("")
	const [removing, setRemoving] = useState<SkinEntry | null>(null)
	const [busy, setBusy] = useState(false)

	useIpcEvent("accounts:changed", () => {
		accounts.reload()
		skins.reload()
	})

	const entries = skins.data ?? []
	const active = entries.find((entry) => entry.id === activeId) ?? entries[0]
	const selectedAccount = (accounts.data ?? []).find((account) => account.selected)

	const upload = async (): Promise<void> => {
		setBusy(true)
		try {
			await invoke("skins:upload", {
				model: uploadModel,
				...(uploadName.trim() === "" ? {} : { name: uploadName.trim() }),
				...(uploadPath === "" ? {} : { filePath: uploadPath }),
			})
			setUploadName("")
			setUploadPath("")
			setUploading(false)
			skins.reload()
		} finally {
			setBusy(false)
		}
	}

	return (
		<>
			<div className="row wrap">
				<Button
					variant="primary"
					icon="upload"
					onClick={() => {
						setUploading(true)
					}}
				>
					Add skin
				</Button>
				<Button
					icon="downloads"
					disabled={selectedAccount === undefined}
					onClick={() => {
						void invoke("skins:download", "account").then(skins.reload)
					}}
				>
					Import from account
				</Button>
				<span className="spacer" />
				{selectedAccount === undefined ? (
					<Badge tone="warning">Sign in with Microsoft to apply skins</Badge>
				) : (
					<Badge tone="accent">Wardrobe of {selectedAccount.username}</Badge>
				)}
			</div>

			<div className="grid cols-2">
				<Card>
					<SectionHeader title="Live preview" subtitle="Drag to rotate the model" />
					{active === undefined ? (
						<EmptyState icon="skins" title="No skin selected" description="Add a skin to see it here." />
					) : (
						<>
							<SkinPreview dataUrl={active.dataUrl} model={active.model} />
							<div className="row wrap" style={{ marginTop: 12 }}>
								<strong>{active.name}</strong>
								<Badge>{active.model}</Badge>
								<Badge>{active.source}</Badge>
								{active.appliedAt === null ? null : (
									<Badge tone="success">applied {formatDate(active.appliedAt)}</Badge>
								)}
							</div>
							<div className="row wrap" style={{ marginTop: 12 }}>
								<Button
									variant="primary"
									icon="check"
									busy={busy}
									disabled={selectedAccount === undefined}
									onClick={() => {
										void invoke("skins:apply", active.id).then(skins.reload)
									}}
								>
									Apply to account
								</Button>
								<Button
									icon="star"
									onClick={() => {
										void invoke("skins:favorite", active.id, !active.favorite).then(skins.reload)
									}}
								>
									{active.favorite ? "Unfavourite" : "Favourite"}
								</Button>
								<Button
									icon="downloads"
									onClick={() => {
										void invoke("skins:download", active.id)
									}}
								>
									Save as PNG
								</Button>
								<Button
									variant="ghost"
									icon="trash"
									onClick={() => {
										setRemoving(active)
									}}
								/>
							</div>
						</>
					)}
				</Card>

				<Card>
					<SectionHeader title="Wardrobe" subtitle={`${entries.length} skins in your history`} />
					<DropZone
						label="Drop a 64x64 skin PNG here"
						onFiles={(paths) => {
							const first = paths[0]
							if (first !== undefined) {
								void invoke("skins:upload", { model: uploadModel, filePath: first }).then(skins.reload)
							}
						}}
					/>
					{skins.loading && skins.data === undefined ? (
						<Skeleton lines={4} />
					) : entries.length === 0 ? (
						<EmptyState
							icon="skins"
							title="Wardrobe is empty"
							description="Upload a skin or import the one on your Microsoft account."
						/>
					) : (
						<div className="grid cols-4" style={{ marginTop: 14 }}>
							{entries.map((entry) => (
								<button
									key={entry.id}
									type="button"
									className="card flat interactive"
									style={{ cursor: "pointer", textAlign: "center" }}
									onClick={() => {
										setActiveId(entry.id)
									}}
								>
									<img
										src={entry.dataUrl}
										alt={entry.name}
										style={{
											width: 48,
											height: 48,
											imageRendering: "pixelated",
											borderRadius: 8,
											background: "var(--surface-3)",
										}}
									/>
									<div style={{ marginTop: 8, fontSize: "0.8rem" }}>{entry.name}</div>
									{entry.favorite ? <Badge tone="accent">favourite</Badge> : null}
								</button>
							))}
						</div>
					)}
				</Card>
			</div>

			{uploading ? (
				<Modal
					title="Add skin"
					subtitle="Pick a PNG file; Halcyon keeps a copy in your wardrobe"
					onClose={() => {
						setUploading(false)
					}}
					footer={
						<>
							<Button
								variant="ghost"
								onClick={() => {
									setUploading(false)
								}}
							>
								Cancel
							</Button>
							<Button
								variant="primary"
								busy={busy}
								onClick={() => {
									void upload()
								}}
							>
								Add to wardrobe
							</Button>
						</>
					}
				>
					<Field label="Name" hint="Optional label for your wardrobe">
						<TextInput value={uploadName} onChange={setUploadName} placeholder="Winter cloak" />
					</Field>
					<Field label="Model">
						<Select value={uploadModel} onChange={setUploadModel} options={MODELS} />
					</Field>
					<Field label="File" hint="Leave empty to open a file picker">
						<TextInput value={uploadPath} onChange={setUploadPath} placeholder="C:\\skins\\my-skin.png" />
					</Field>
					<DropZone
						label="or drop the PNG here"
						onFiles={(paths) => {
							setUploadPath(paths[0] ?? "")
						}}
					/>
				</Modal>
			) : null}

			{removing === null ? null : (
				<ConfirmDialog
					title="Remove skin"
					message={`${removing.name} will be removed from your wardrobe. Your applied skin stays untouched.`}
					confirmLabel="Remove"
					destructive
					onCancel={() => {
						setRemoving(null)
					}}
					onConfirm={() => {
						const target = removing
						setRemoving(null)
						setActiveId(null)
						void invoke("skins:remove", target.id).then(skins.reload)
					}}
				/>
			)}
		</>
	)
}
