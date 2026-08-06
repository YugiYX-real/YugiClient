import { useEffect, useState } from "react"

/**
 * Crops the front panel out of a Minecraft cape texture.
 *
 * Cape textures are 64x32 and the visible front sits at (1,1) with a size of
 * 10x16 texels, so showing the raw file would look wrong. The texture is
 * scaled by whole texels to keep the pixel art crisp.
 */
export function CapePreview({
	capeUrl,
	scale = 6,
}: {
	capeUrl: string
	scale?: number
}): JSX.Element {
	const [failed, setFailed] = useState(false)

	useEffect(() => {
		setFailed(false)
	}, [capeUrl])

	const width = 10 * scale
	const height = 16 * scale

	if (failed) {
		return (
			<div
				style={{
					width,
					height,
					borderRadius: "var(--radius-sm)",
					background: "var(--surface-3)",
					display: "grid",
					placeItems: "center",
					fontSize: "0.68rem",
					color: "var(--muted)",
					textAlign: "center",
					padding: 4,
				}}
			>
				Cape texture unavailable
			</div>
		)
	}

	return (
		<div
			role="img"
			aria-label="Minecraft cape"
			style={{
				width,
				height,
				borderRadius: "var(--radius-sm)",
				overflow: "hidden",
				background: "var(--surface-3)",
				backgroundImage: `url("${capeUrl}")`,
				backgroundRepeat: "no-repeat",
				backgroundSize: `${64 * scale}px ${32 * scale}px`,
				backgroundPosition: `-${scale}px -${scale}px`,
				imageRendering: "pixelated",
			}}
		>
			<img
				src={capeUrl}
				alt=""
				style={{ display: "none" }}
				onError={() => {
					setFailed(true)
				}}
			/>
		</div>
	)
}
