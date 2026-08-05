export type IconName =
	| "dashboard"
	| "instances"
	| "discover"
	| "accounts"
	| "skins"
	| "java"
	| "downloads"
	| "logs"
	| "settings"
	| "plugins"
	| "play"
	| "stop"
	| "plus"
	| "search"
	| "refresh"
	| "trash"
	| "folder"
	| "check"
	| "alert"
	| "close"
	| "chevron"
	| "star"
	| "sparkle"
	| "pause"
	| "upload"
	| "copy"
	| "clock"
	| "cube"
	| "shield"
	| "filter"

const PATHS: Record<IconName, string> = {
	dashboard: "M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z",
	instances: "M4 7h16M4 12h16M4 17h16",
	discover: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm3.5-12.5-2 5-5 2 2-5 5-2Z",
	accounts: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 8a8 8 0 0 1 16 0",
	skins: "M8 4 5 6v5h3v9h8v-9h3V6l-3-2-4 2-4-2Z",
	java: "M8 20h8M9 4c-2 2 3 3 1 5m3-5c-2 2 3 3 1 5M6 12h12a6 6 0 0 1-6 5 6 6 0 0 1-6-5Z",
	downloads: "M12 4v10m0 0 4-4m-4 4-4-4M5 19h14",
	logs: "M6 4h9l4 4v12H6V4Zm3 7h7M9 15h7",
	settings:
		"M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3-2-1 1-2-2-2-2 1-1-2h-4l-1 2-2-1-2 2 1 2-2 1v0l2 1-1 2 2 2 2-1 1 2h4l1-2 2 1 2-2-1-2 2-1Z",
	plugins: "M10 4h4v3h3v4h3v4h-3v5H7v-5H4v-4h3V7h3V4Z",
	play: "M8 5l11 7-11 7V5Z",
	stop: "M7 7h10v10H7z",
	plus: "M12 5v14M5 12h14",
	search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5 -2 4 4",
	refresh: "M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5",
	trash: "M5 7h14M9 7V4h6v3m-7 0 1 13h6l1-13",
	folder: "M4 7h5l2 2h9v9H4V7Z",
	check: "M5 13l4 4 10-10",
	alert: "M12 4l9 16H3l9-16Zm0 6v4m0 3v.5",
	close: "M6 6l12 12M18 6 6 18",
	chevron: "M9 6l6 6-6 6",
	star: "M12 4l2.5 5.2 5.5.8-4 4 1 5.6L12 17l-5 2.6 1-5.6-4-4 5.5-.8L12 4Z",
	sparkle: "M12 4l1.8 4.7L18.5 10l-4.7 1.7L12 16l-1.8-4.3L5.5 10l4.7-1.3L12 4Zm6 8.5 1 2.4 2.5.6-2.5 1-1 2.5-1-2.5-2.5-1 2.5-.6 1-2.4Z",
	pause: "M9 6v12M15 6v12",
	upload: "M12 20V10m0 0 4 4m-4-4-4 4M5 5h14",
	copy: "M9 9h10v10H9V9Zm-4 6V5h10",
	clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l4 2",
	cube: "M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 0v18m8-13.5-8 4.5-8-4.5",
	shield: "M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6l8-3Z",
	filter: "M4 6h16l-6 7v6l-4-2v-4L4 6Z",
}

export function Icon({
	name,
	size = 18,
	strokeWidth = 1.7,
}: {
	name: IconName
	size?: number
	strokeWidth?: number
}): JSX.Element {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			<path d={PATHS[name]} />
		</svg>
	)
}
