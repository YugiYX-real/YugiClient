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
import { formatRelative } from "../lib/format.ts"

export function AccountsPage({ onEditAppearance }: { onEditAppearance?: () => void }): JSX.Element {
	const accounts = useAsync<readonly Account[]>(() => invoke("accounts:list"), [])
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

	const editAppearance = (): void => {
		if (onEditAppearance !== undefined) {
			onEditAppearance()
		}
	}

	const entries = (accounts.data ?? []).filter((account) => account.kind === "microsoft")

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
					Add Microsoft account
				</Button>
				{entries.length === 0 ? null : (
					<Button onClick={editAppearance}>Edit skin &amp; cape</Button>
				)}
				<span className="spacer" />
				<Badge tone="success">Sessions renew automatically</Badge>
			</div>

			{signingIn ? (
				<Card flat>
					<small>
						Finish signing in in the secure Microsoft window. Halcyon keeps the refresh
						token and renews the selected Minecraft session in the background.
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
					title="No Microsoft account connected"
					description="Connect the Microsoft account that owns Minecraft to launch online."
					action={
						<Button
							variant="primary"
							icon="accounts"
							busy={signingIn}
							onClick={() => {
								void signIn()
							}}
						>
							Sign in
						</Button>
					}
				/>
			) : (
				<div className="grid cols-3">
					{entries.map((account) => (
						<Card key={account.id} className={account.selected ? "" : "flat"}>
							<div className="row" style={{ alignItems: "flex-start" }}>
								<MinecraftAvatar
									skinUrl={account.skinUrl}
									fallbackUrl={account.avatarUrl}
									size={72}
								/>
								<div className="col" style={{ gap: 2, minWidth: 0, flex: 1 }}>
									<strong>{account.nickname ?? account.username}</strong>
									<small>{account.username}</small>
									<small>Last used {formatRelative(account.lastUsedAt)}</small>
								</div>
								{account.favorite ? (
									<Badge tone="accent" icon="star">
										Favourite
									</Badge>
								) : null}
							</div>

							<div className="row wrap" style={{ marginTop: 12, gap: 6 }}>
								<Badge tone="success">Microsoft</Badge>
								{account.selected ? <Badge tone="accent">active</Badge> : null}
								{account.capes.length === 0 ? null : (
									<Badge>{account.capes.length} owned capes</Badge>
								)}
							</div>

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
									onClick={() => {
										if (!account.selected) {
											void invoke("accounts:select", account.id).then(() => {
												accounts.reload()
												editAppearance()
											})
											return
										}
										editAppearance()
									}}
								>
									Edit skin &amp; cape
								</Button>
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
