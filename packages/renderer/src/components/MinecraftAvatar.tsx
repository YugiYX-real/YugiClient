import { useEffect, useState } from "react"

function PixelHead({ size }: { size: number }): JSX.Element {
	return (
		<div
			className="avatar"
			aria-label="Minecraft player"
			style={{
				width: size,
				height: size,
				position: "relative",
				overflow: "hidden",
				background: "linear-gradient(145deg, #b67b55, #74452f)",
			}}
		>
			<span
				style={{
					position: "absolute",
					width: size * 0.14,
					height: size * 0.14,
					left: size * 0.2,
					top: size * 0.38,
					background: "#241913",
				}}
			/>
			<span
				style={{
					position: "absolute",
					width: size * 0.14,
					height: size * 0.14,
					right: size * 0.2,
					top: size * 0.38,
					background: "#241913",
				}}
			/>
			<span
				style={{
					position: "absolute",
					width: size * 0.28,
					height: size * 0.1,
					left: size * 0.36,
					bottom: size * 0.2,
					background: "#593525",
				}}
			/>
		</div>
	)
}

export function MinecraftAvatar({
	skinUrl,
	size = 36,
}: {
	skinUrl: string | null
	fallbackUrl: string | null
	fallback: string
	size?: number
}): JSX.Element {
	const [ready, setReady] = useState(false)
	const [failed, setFailed] = useState(false)

	useEffect(() => {
		setReady(false)
		setFailed(false)
	}, [skinUrl])

	if (skinUrl === null || skinUrl === "" || failed) {
		return <PixelHead size={size} />
	}

	const textureSize = size * 8
	const layer = {
		position: "absolute" as const,
		inset: 0,
		backgroundImage: `url(${skinUrl})`,
		backgroundRepeat: "no-repeat",
		backgroundSize: `${textureSize}px ${textureSize}px`,
		imageRendering: "pixelated" as const,
	}

	return (
		<div
			className="avatar"
			role="img"
			aria-label="Minecraft skin"
			style={{ width: size, height: size, position: "relative", overflow: "hidden" }}
		>
			{ready ? null : <PixelHead size={size} />}
			<img
				src={skinUrl}
				alt=""
				style={{ display: "none" }}
				onLoad={() => {
					setReady(true)
				}}
				onError={() => {
					setFailed(true)
				}}
			/>
			{ready ? (
				<>
					<span
						style={{
							...layer,
							backgroundPosition: `-${size}px -${size}px`,
						}}
					/>
					<span
						style={{
							...layer,
							backgroundPosition: `-${size * 5}px -${size}px`,
						}}
					/>
				</>
			) : null}
		</div>
	)
}
