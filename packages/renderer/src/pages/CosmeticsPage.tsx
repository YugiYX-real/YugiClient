import { useCallback, useEffect, useState } from "react"
import type { CosmeticEntry, CosmeticWardrobe } from "@halcyon/ipc"
import { Button } from "../components/primitives.tsx"
import { Icon } from "../components/Icon.tsx"
import { invoke } from "../lib/client.ts"

// A cape texture is 64 by 32, so a sixfold scale keeps every pixel sharp and square.
const CAPE_SCALE = 6
const CAPE_WIDTH = 10 * CAPE_SCALE
const CAPE_HEIGHT = 16 * CAPE_SCALE

const surface = {
	background: "var(--surface, rgba(18, 19, 35, 0.72))",
	border: "1px solid var(--border, rgba(232, 236, 245, 0.09))",
	borderRadius: "var(--radius, 14px)",
} as const

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

/** The cape itself, drawn straight from the texture the backend handed over. */
function Cape({ entry }: { entry: CosmeticEntry }): JSX.Element {
	if (entry.textureUrl === "") {
		return (
			<div
				style={{
					width: CAPE_WIDTH,
					height: CAPE_HEIGHT,
					borderRadius: "var(--radius-sm, 9px)",
					background: "var(--accent-soft, rgba(124, 92, 255, 0.16))",
					display: "grid",
					placeItems: "center",
				}}
			>
				<Icon name="sparkle" size={18} />
			</div>
		)
	}

	return (
		<div
			aria-label={entry.name}
			style={{
				width: CAPE_WIDTH,
				height: CAPE_HEIGHT,
				borderRadius: "var(--radius-sm, 9px)",
				backgroundImage: `url(${entry.textureUrl})`,
				backgroundSize: `${64 * CAPE_SCALE}px auto`,
				backgroundPosition: `-${CAPE_SCALE}px -${CAPE_SCALE}px`,
				backgroundRepeat: "no-repeat",
				imageRendering: "pixelated",
			}}
		/>
	)
}

/**
 * The wardrobe.
 *
 * Capes are handed out by the owner, so this page never invents one: it shows what the backend
 * says this Minecraft account owns and lets the player wear it. Wearing something is proven with
 * the Minecraft session the launcher already holds rather than a typed in name.
 */
export function CosmeticsPage(): JSX.Element {
	const [wardrobe, setWardrobe] = useState<CosmeticWardrobe | null>(null)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState("")

	const load = useCallback(() => {
		setBusy(true)
		void invoke("cosmetics:load")
			.then((next) => {
				setWardrobe(next)
				setError("")
			})
			.catch((reason: unknown) => {
				setError(message(reason))
			})
			.finally(() => {
				setBusy(false)
			})
	}, [])

	useEffect(() => {
		load()
	}, [load])

	const run = useCallback((work: Promise<CosmeticWardrobe>) => {
		setBusy(true)
		void work
			.then((next) => {
				setWardrobe(next)
				setError("")
			})
			.catch((reason: unknown) => {
				setError(message(reason))
			})
			.finally(() => {
				setBusy(false)
			})
	}, [])

	const owned = (wardrobe?.cosmetics ?? []).filter((entry) => entry.owned)
	const rest = (wardrobe?.cosmetics ?? []).filter((entry) => !entry.owned)

	return (
		<div style={{ display: "grid", gap: 18 }}>
			<div style={{ ...surface, padding: 18, display: "grid", gap: 12 }}>
				<div
					style={{
						display: "flex",
						gap: 12,
						alignItems: "center",
						flexWrap: "wrap",
					}}
				>
					<Icon name="sparkle" size={20} />
					<div style={{ flex: 1, minWidth: 200 }}>
						<strong>{wardrobe?.playerName ?? "No account selected"}</strong>
						<div style={{ color: "var(--muted, #9aa0b5)", fontSize: 12 }}>
							{wardrobe === null
								? "Loading your wardrobe"
								: `Cosmetics server ${wardrobe.backendUrl}`}
						</div>
					</div>
					{wardrobe?.signedIn === true ? (
						<span className="badge success">linked</span>
					) : (
						<Button
							size="small"
							variant="primary"
							icon="shield"
							onClick={() => {
								run(invoke("cosmetics:link"))
							}}
						>
							Link with Minecraft
						</Button>
					)}
					<Button
						size="small"
						variant="ghost"
						icon="refresh"
						title="Reload"
						onClick={load}
					>
						Reload
					</Button>
					<Button
						size="small"
						variant="ghost"
						icon="discover"
						title="Open the website already signed in"
						onClick={() => {
							void invoke("cosmetics:openSite")
						}}
					>
						Open website
					</Button>
				</div>

				{error === "" ? null : (
					<div style={{ color: "#ff9aa0", fontSize: 13 }}>{error}</div>
				)}
				{wardrobe !== null && wardrobe.message !== "" ? (
					<div style={{ color: "var(--muted, #9aa0b5)", fontSize: 13 }}>
						{wardrobe.message}
					</div>
				) : null}
				{busy ? (
					<div style={{ color: "var(--muted, #9aa0b5)", fontSize: 12 }}>Working…</div>
				) : null}
			</div>

			<div style={{ ...surface, padding: 18, display: "grid", gap: 14 }}>
				<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
					<strong>Your capes</strong>
					<span className="badge accent">{owned.length}</span>
					{wardrobe?.equipped === null || wardrobe === null ? null : (
						<Button
							size="small"
							variant="ghost"
							icon="close"
							onClick={() => {
								run(invoke("cosmetics:equip", null))
							}}
						>
							Take it off
						</Button>
					)}
				</div>

				{owned.length === 0 ? (
					<div style={{ color: "var(--muted, #9aa0b5)", fontSize: 13 }}>
						Nothing has been given to this account yet. Capes are handed out by the
						owner in the admin panel.
					</div>
				) : (
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
							gap: 12,
						}}
					>
						{owned.map((entry) => {
							const worn = wardrobe?.equipped === entry.id
							return (
								<div
									key={entry.id}
									style={{
										padding: 12,
										borderRadius: "var(--radius-sm, 9px)",
										border: worn
											? "1px solid var(--accent, #7c5cff)"
											: "1px solid var(--border, rgba(232, 236, 245, 0.09))",
										display: "flex",
										gap: 12,
										alignItems: "center",
									}}
								>
									<Cape entry={entry} />
									<div style={{ display: "grid", gap: 6 }}>
										<strong style={{ fontSize: 13 }}>{entry.name}</strong>
										<span
											style={{
												color: "var(--muted, #9aa0b5)",
												fontSize: 11,
											}}
										>
											{entry.rarity}
										</span>
										{worn ? (
											<span className="badge success">worn</span>
										) : (
											<Button
												size="small"
												variant="primary"
												icon="check"
												onClick={() => {
													run(invoke("cosmetics:equip", entry.id))
												}}
											>
												Wear
											</Button>
										)}
									</div>
								</div>
							)
						})}
					</div>
				)}
			</div>

			{rest.length === 0 ? null : (
				<div style={{ ...surface, padding: 18, display: "grid", gap: 14 }}>
					<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
						<strong>Everything else</strong>
						<span className="badge">{rest.length}</span>
					</div>
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
							gap: 12,
							opacity: 0.55,
						}}
					>
						{rest.map((entry) => (
							<div
								key={entry.id}
								style={{
									padding: 12,
									borderRadius: "var(--radius-sm, 9px)",
									border: "1px solid var(--border, rgba(232, 236, 245, 0.09))",
									display: "flex",
									gap: 12,
									alignItems: "center",
								}}
							>
								<Cape entry={entry} />
								<div style={{ display: "grid", gap: 4 }}>
									<strong style={{ fontSize: 13 }}>{entry.name}</strong>
									<span
										style={{ color: "var(--muted, #9aa0b5)", fontSize: 11 }}
									>
										not unlocked
									</span>
								</div>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	)
}
