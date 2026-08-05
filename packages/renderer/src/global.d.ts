import type { HalcyonBridge } from "@halcyon/ipc"

declare global {
	interface Window {
		readonly halcyon?: HalcyonBridge
		readonly halcyonFiles?: { pathFor(file: File): string }
	}

	const __APP_VERSION__: string
	const __BUILD_NUMBER__: string
	const __COMMIT_SHA__: string
	const __BUILD_TIME__: string
}

export {}
