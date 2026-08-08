import { useCallback, useEffect, useState } from "react"
import type { CosmeticEntry, CosmeticWardrobe } from "@halcyon/ipc"
import { Button } from "../components/primitives.tsx"
import { Icon } from "../components/Icon.tsx"
import { invoke } from "../lib/client.ts"

// A cape texture is 64 by 32, so a sixfold scale keeps every pixel sharp and square.
const CAPE_SCALE = 6
const CAPE_WIDTH = 10 * CAPE_SCALE
const CAPE_HEIGHT = 16 * CAPE_SCALE

// Anything with a model of its own is not cape shaped, so it gets a square-ish tile and is shown
// whole rather than cropped to the rectangle a cape occupies on a skin sheet.
const TILE_WIDTH = 76
const TILE_HEIGHT = 96

const surface = {
	background: "var(--surface, rgba(18, 19, 35, 0.72))",
	border: "1px solid var(--border, rgba(232, 236, 245, 0.09))",
	borderRadius: "var(--radius, 14px)",
} as const

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

/**
 * The picture of one cosmetic.
 *
 * A cosmetic that moves is one tall picture with its frames stacked in it, exactly the way
 * Minecraft stores an animated texture, so playing it means sliding a window down the strip on a
 * timer. Showing the whole strip at once is what made a pair of animated wings look like a smear,
 * and it is why the frame count now travels with every cosmetic.
 */
function Preview({ entry }: { entry: CosmeticEntry }): JSX.Element {
	const frames = Math.max(1, entry.frames)
	const [frame, setFrame] = useState(0)

	useEffect(() => {
		if (frames <= 1) {
			setFrame(0)
			return undefined
		}

		const timer = window.setInterval(() => {
			setFrame((current) => (current + 1) % frames)
		}, Math.max(40, entry.frameMs))

		return () => {
			window.clearInterval(timer)
		}
	}, [frames, entry.frameMs])

	if (entry.textureUrl === "") {
		return (
			<div
				style={{
					width: entry.hasModel ? TILE_WIDTH : CAPE_WIDTH,
					height: entry.hasModel ? TILE_HEIGHT : CAPE_HEIGHT,
					flex: "0 0 auto",
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

	if (!entry.hasModel) {
		// Cape shaped: the front of the cape is the ten by sixteen patch at the top left of the
		// sheet, and one frame of an animation is one sheet high.
		const frameHeight = entry.textureHeight > 0 ? entry.textureHeight / frames : 32
		return (
			<div
				aria-label={entry.name}
				style={{
					width: CAPE_WIDTH,
					height: CAPE_HEIGHT,
					flex: "0 0 auto",
					borderRadius: "var(--radius-sm, 9px)",
					backgroundImage: `url(${entry.textureUrl})`,
					backgroundSize: `${64 * CAPE_SCALE}px auto`,
					backgroundPosition: `-${CAPE_SCALE}px -${(1 + frame * frameHeight) * CAPE_SCALE}px`,
					backgroundRepeat: "no-repeat",
					imageRendering: "pixelated",
				}}
			/>
		)
	}

	// Modelled: fit one whole frame into the tile and keep it centred, so wings, a shield and a
	// halo all show what was actually drawn.
	const frameWidth = entry.textureWidth > 0 ? entry.textureWidth : 64
	const frameHeight = entry.textureHeight > 0 ? entry.textureHeight / frames : 64
	const fit = Math.min(TILE_WIDTH / frameWidth, TILE_HEIGHT / frameHeight)
	const shownWidth = frameWidth * fit
	const shownHeight = frameHeight * fit
	const top = (TILE_HEIGHT - shownHeight) / 2 - frame * shownHeight

	return (
		<div
			aria-label={entry.name}
			style={{
				width: TILE_WIDTH,
				height: TILE_HEIGHT,
				flex: "0 0 auto",
				borderRadius: "var(--radius-sm, 9px)",
				background: "var(--accent-soft, rgba(124, 92, 255, 0.10))",
				backgroundImage: `url(${entry.textureUrl})`,
				backgroundSize: `${shownWidth}px ${shownHeight * frames}px`,
				backgroundPosition: `50% ${top}px`,
				backgroundRepeat: "no-repeat",
				imageRendering: "pixelated",
			}}
		/>
	)
}

/** The line under the name: what kind it is, how rare, and whether it moves. */
function Caption({ entry }: { entry: CosmeticEntry }): JSX.Element {
	const parts = [entry.type, entry.rarity]
	if (entry.frames > 1) {
		parts.push(`animated, ${entry.frames} frames`)
	}
	return (
		<span style={{ color: "var(--muted, #9aa0b5)", fontSize: 11 }}>{parts.join(" · ")}</span>
	)
}

/**
 * The wardrobe.
 *
 * Cosmetics are handed out by the owner, so this page never invents one: it shows what the backend
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
					<strong>Your cosmetics</strong>
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
						Nothing has been given to this account yet. Cosmetics are handed out by the
						owner in the admin panel.
					</div>
				) : (
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
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
									<Preview entry={entry} />
									<div style={{ display: "grid", gap: 6, minWidth: 0 }}>
										<strong style={{ fontSize: 13 }}>{entry.name}</strong>
										<Caption entry={entry} />
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
							gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
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
								<Preview entry={entry} />
								<div style={{ display: "grid", gap: 4, minWidth: 0 }}>
									<strong style={{ fontSize: 13 }}>{entry.name}</strong>
									<Caption entry={entry} />
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
