import { useState } from "react"
import type { Account } from "@halcyon/ipc"
import {
	Badge,
	Button,
	Card,
	ConfirmDialog,
	EmptyState,
	Field,
	Modal,
	Skeleton,
	TextInput,
} from "../components/primitives.tsx"
import { MinecraftAvatar } from "../components/MinecraftAvatar.tsx"
import { invoke } from "../lib/client.ts"
import { useAsync, useIpcEvent } from "../lib/hooks.ts"
import { formatRelative, initialsOf } from "../lib/format.ts"

const MINECRAFT_APPEARANCE_URL = "https://www.minecraft.net/msaprofile/mygames/editskin"

export function AccountsPage(): JSX.Element {
	const accounts = useAsync<readonly Account[]>(() => invoke("accounts:list"), [])
	const [offlineName, setOfflineName] = useState("")
	const [addingOffline, setAddingOffline] = useState(false)
	const [nicknaming, setNicknaming] = useState<Account | null>(null)
	const [nickname, setNickname] = useState("")
	const [removing, setRemoving] = useState<Account | null>(null)
	const [signingIn, setSigningIn] = useState(false)

	useIpcEvent("accounts:changed", accounts.reload)

	const signIn = async (): Promise<void> => {
		setSigningIn(true)
		try {
			await invoke("accounts:loginMicrosoft")
			accounts.reload()
		} finally {
			setSigningIn(false)
		}
	}

	const entries = accounts.data ?? []

	return (
		<>
			<div className="row wrap">
				<Button
					variant="primary"
					icon="accounts"
					busy={signingIn}
					onClick={() => {
						void signIn()
					}}
				>
					Sign in with Microsoft
				</Button>
				<Button
					icon="plus"
					onClick={() => {
						setAddingOffline(true)
					}}
				>
					Add offline account
				</Button>
				<span className="spacer" />
				<Button
					size="small"
					icon="upload"
					onClick={() => {
						void invoke("accounts:export")
					}}
				>
					Export
				</Button>
				<Button
					size="small"
					icon="downloads"
					onClick={() => {
						void invoke("accounts:import").then(accounts.reload)
					}}
				>
					Import
				</Button>
			</div>

			{signingIn ? (
				<Card flat>
					<small>
						A secure Microsoft sign-in window opened. Finish signing in there; Halcyon
						keeps the refresh token so your Minecraft session can renew automatically.
					</small>
				</Card>
			) : null}

			{accounts.loading && accounts.data === undefined ? (
				<Card>
					<Skeleton lines={4} />
				</Card>
			) : entries.length === 0 ? (
				<EmptyState
					icon="accounts"
					title="No accounts yet"
					description="Sign in with Microsoft to play online, or add an offline profile for LAN and singleplayer."
				/>
			) : (
				<div className="grid cols-3">
					{entries.map((account) => (
						<Card key={account.id} className={account.selected ? "" : "flat"}>
							<div className="row" style={{ alignItems: "flex-start" }}>
								<MinecraftAvatar
									skinUrl={account.skinUrl}
									fallbackUrl={account.avatarUrl}
									fallback={initialsOf(account.username)}
									size={44}
								/>
								<div className="col" style={{ gap: 2, minWidth: 0, flex: 1 }}>
									<strong>{account.nickname ?? account.username}</strong>
									<small>{account.username}</small>
								</div>
								{account.favorite ? (
									<Badge tone="accent" icon="star">
										Favourite
									</Badge>
								) : null}
							</div>

							<div className="row wrap" style={{ marginTop: 12, gap: 6 }}>
								<Badge tone={account.kind === "microsoft" ? "success" : "neutral"}>
									{account.kind}
								</Badge>
								{account.selected ? <Badge tone="accent">active</Badge> : null}
								{account.capes.length === 0 ? null : (
									<Badge>{account.capes.length} capes</Badge>
								)}
							</div>
							<small style={{ display: "block", marginTop: 8 }}>
								Last used {formatRelative(account.lastUsedAt)}
								{account.expiresAt === null
									? ""
									: ` · session valid until ${formatRelative(account.expiresAt)}`}
							</small>

							<div className="row wrap" style={{ marginTop: 12 }}>
								{account.selected ? null : (
									<Button
										size="small"
										variant="primary"
										icon="check"
										onClick={() => {
											void invoke("accounts:select", account.id).then(
												accounts.reload,
											)
										}}
									>
										Use
									</Button>
								)}
								<Button
									size="small"
									icon="star"
									title="Toggle favourite"
									onClick={() => {
										void invoke("accounts:update", account.id, {
											favorite: !account.favorite,
										}).then(accounts.reload)
									}}
								/>
								<Button
									size="small"
									icon="copy"
									title="Set nickname"
									onClick={() => {
										setNickname(account.nickname ?? "")
										setNicknaming(account)
									}}
								/>
								{account.kind === "microsoft" ? (
									<>
										<Button
											size="small"
											icon="skins"
											title="Edit skin and cape"
											onClick={() => {
												void invoke("app:openExternal", MINECRAFT_APPEARANCE_URL)
											}}
										/>
										<Button
											size="small"
											icon="refresh"
											title="Refresh session now"
											onClick={() => {
												void invoke("accounts:refresh", account.id).then(
													accounts.reload,
												)
											}}
										/>
									</>
								) : null}
								<span className="spacer" />
								<Button
									size="small"
									variant="ghost"
									icon="trash"
									title="Sign out"
									onClick={() => {
										setRemoving(account)
									}}
								/>
							</div>
						</Card>
					))}
				</div>
			)}

			{addingOffline ? (
				<Modal
					title="Add offline account"
					subtitle="Offline profiles work for singleplayer and LAN worlds"
					onClose={() => {
						setAddingOffline(false)
					}}
					footer={
						<>
							<Button
								variant="ghost"
								onClick={() => {
									setAddingOffline(false)
								}}
							>
								Cancel
							</Button>
							<Button
								variant="primary"
								disabled={offlineName.trim() === ""}
								onClick={() => {
									const username = offlineName.trim()
									setOfflineName("")
									setAddingOffline(false)
									void invoke("accounts:addOffline", username).then(
										accounts.reload,
									)
								}}
							>
								Add account
							</Button>
						</>
					}
				>
					<Field
						label="Username"
						hint="3 to 16 characters, letters, numbers and underscores"
					>
						<TextInput
							value={offlineName}
							onChange={setOfflineName}
							placeholder="Steve"
						/>
					</Field>
				</Modal>
			) : null}

			{nicknaming === null ? null : (
				<Modal
					title="Set nickname"
					onClose={() => {
						setNicknaming(null)
					}}
					footer={
						<>
							<Button
								variant="ghost"
								onClick={() => {
									setNicknaming(null)
								}}
							>
								Cancel
							</Button>
							<Button
								variant="primary"
								onClick={() => {
									const target = nicknaming
									setNicknaming(null)
									void invoke("accounts:update", target.id, {
										nickname: nickname.trim() === "" ? null : nickname.trim(),
									}).then(accounts.reload)
								}}
							>
								Save
							</Button>
						</>
					}
				>
					<Field label="Nickname" hint="Only shown inside Halcyon">
						<TextInput value={nickname} onChange={setNickname} />
					</Field>
				</Modal>
			)}

			{removing === null ? null : (
				<ConfirmDialog
					title="Sign out"
					message={`${removing.username} will be removed from this launcher. Your Minecraft purchase is unaffected.`}
					confirmLabel="Sign out"
					destructive
					onCancel={() => {
						setRemoving(null)
					}}
					onConfirm={() => {
						const target = removing
						setRemoving(null)
						void invoke("accounts:remove", target.id).then(accounts.reload)
					}}
				/>
			)}
		</>
	)
}
