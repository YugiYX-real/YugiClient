import { useEffect, useMemo, useState } from "react"
import type { CSSProperties } from "react"
import type { SkinModel } from "@halcyon/ipc"

const TEXTURE_SIZE = 64
const SCALE = 7

type FaceRect = { u: number; v: number; width: number; height: number }

function face(dataUrl: string, rect: FaceRect, transform: string): CSSProperties {
	return {
		position: "absolute",
		width: rect.width * SCALE,
		height: rect.height * SCALE,
		backgroundImage: `url(${dataUrl})`,
		backgroundSize: `${TEXTURE_SIZE * SCALE}px ${TEXTURE_SIZE * SCALE}px`,
		backgroundPosition: `-${rect.u * SCALE}px -${rect.v * SCALE}px`,
		imageRendering: "pixelated",
		transform,
		transformStyle: "preserve-3d",
		backfaceVisibility: "hidden",
		top: 0,
		left: 0,
	}
}

function Box({
	dataUrl,
	width,
	height,
	depth,
	faces,
	style,
}: {
	dataUrl: string
	width: number
	height: number
	depth: number
	faces: {
		front: FaceRect
		back: FaceRect
		left: FaceRect
		right: FaceRect
		top: FaceRect
		bottom: FaceRect
	}
	style: CSSProperties
}): JSX.Element {
	const halfDepth = (depth * SCALE) / 2
	return (
		<div
			style={{
				position: "absolute",
				width: width * SCALE,
				height: height * SCALE,
				transformStyle: "preserve-3d",
				...style,
			}}
		>
			<div style={face(dataUrl, faces.front, `translateZ(${halfDepth}px)`)} />
			<div style={face(dataUrl, faces.back, `rotateY(180deg) translateZ(${halfDepth}px)`)} />
			<div
				style={{
					...face(
						dataUrl,
						faces.right,
						`rotateY(90deg) translateZ(${(width * SCALE) / 2}px)`,
					),
					left: (width * SCALE) / 2 - halfDepth,
				}}
			/>
			<div
				style={{
					...face(
						dataUrl,
						faces.left,
						`rotateY(-90deg) translateZ(${(width * SCALE) / 2}px)`,
					),
					left: (width * SCALE) / 2 - halfDepth,
				}}
			/>
			<div
				style={{
					...face(
						dataUrl,
						faces.top,
						`rotateX(90deg) translateZ(${(height * SCALE) / 2}px)`,
					),
					top: (height * SCALE) / 2 - halfDepth,
				}}
			/>
			<div
				style={{
					...face(
						dataUrl,
						faces.bottom,
						`rotateX(-90deg) translateZ(${(height * SCALE) / 2}px)`,
					),
					top: (height * SCALE) / 2 - halfDepth,
				}}
			/>
		</div>
	)
}

function boxFaces(u: number, v: number, width: number, height: number, depth: number) {
	return {
		top: { u: u + depth, v, width, height: depth },
		bottom: { u: u + depth + width, v, width, height: depth },
		right: { u, v: v + depth, width: depth, height },
		front: { u: u + depth, v: v + depth, width, height },
		left: { u: u + depth + width, v: v + depth, width: depth, height },
		back: { u: u + depth + width + depth, v: v + depth, width, height },
	}
}

export function SkinPreview({
	dataUrl,
	model,
	autoRotate = true,
}: {
	dataUrl: string
	model: SkinModel
	autoRotate?: boolean
}): JSX.Element {
	const [angle, setAngle] = useState(24)
	const [dragging, setDragging] = useState(false)

	useEffect(() => {
		if (!autoRotate || dragging) {
			return
		}
		const timer = setInterval(() => {
			setAngle((current) => (current + 0.6) % 360)
		}, 40)
		return () => {
			clearInterval(timer)
		}
	}, [autoRotate, dragging])

	const armWidth = model === "slim" ? 3 : 4

	const parts = useMemo(
		() => ({
			head: boxFaces(0, 0, 8, 8, 8),
			body: boxFaces(16, 16, 8, 12, 4),
			rightArm: boxFaces(40, 16, armWidth, 12, 4),
			leftArm: boxFaces(32, 48, armWidth, 12, 4),
			rightLeg: boxFaces(0, 16, 4, 12, 4),
			leftLeg: boxFaces(16, 48, 4, 12, 4),
		}),
		[armWidth],
	)

	return (
		<div
			className="skin-preview"
			style={{ perspective: 900, cursor: "grab", userSelect: "none" }}
			onPointerDown={(event) => {
				setDragging(true)
				event.currentTarget.setPointerCapture(event.pointerId)
			}}
			onPointerUp={() => {
				setDragging(false)
			}}
			onPointerMove={(event) => {
				if (dragging) {
					setAngle((current) => (current + event.movementX * 0.6 + 360) % 360)
				}
			}}
		>
			<div
				style={{
					position: "relative",
					width: 8 * SCALE,
					height: 32 * SCALE,
					transformStyle: "preserve-3d",
					transform: `rotateX(-10deg) rotateY(${angle}deg)`,
					transition: dragging ? "none" : "transform 40ms linear",
				}}
			>
				<Box
					dataUrl={dataUrl}
					width={8}
					height={8}
					depth={8}
					faces={parts.head}
					style={{ top: 0, left: 0 }}
				/>
				<Box
					dataUrl={dataUrl}
					width={8}
					height={12}
					depth={4}
					faces={parts.body}
					style={{ top: 8 * SCALE, left: 0 }}
				/>
				<Box
					dataUrl={dataUrl}
					width={armWidth}
					height={12}
					depth={4}
					faces={parts.rightArm}
					style={{ top: 8 * SCALE, left: -armWidth * SCALE }}
				/>
				<Box
					dataUrl={dataUrl}
					width={armWidth}
					height={12}
					depth={4}
					faces={parts.leftArm}
					style={{ top: 8 * SCALE, left: 8 * SCALE }}
				/>
				<Box
					dataUrl={dataUrl}
					width={4}
					height={12}
					depth={4}
					faces={parts.rightLeg}
					style={{ top: 20 * SCALE, left: 0 }}
				/>
				<Box
					dataUrl={dataUrl}
					width={4}
					height={12}
					depth={4}
					faces={parts.leftLeg}
					style={{ top: 20 * SCALE, left: 4 * SCALE }}
				/>
			</div>
		</div>
	)
}
