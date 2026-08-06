import { useEffect, useState } from "react"
import { Avatar } from "./primitives.tsx"

export function MinecraftAvatar({
	skinUrl,
	fallbackUrl,
	fallback,
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
		return <Avatar source={failed ? null : fallbackUrl} fallback={fallback} size={size} />
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
			<span style={{ opacity: ready ? 0 : 1 }}>{fallback}</span>
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
