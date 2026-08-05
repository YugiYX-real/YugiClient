import type {
	HalcyonBridge,
	IpcArgs,
	IpcChannel,
	IpcEvent,
	IpcEventMap,
	IpcResult,
} from "@halcyon/ipc"

function bridge(): HalcyonBridge {
	const candidate = window.halcyon
	if (candidate === undefined) {
		throw new Error("The Halcyon bridge is unavailable in this window")
	}
	return candidate
}

export function invoke<K extends IpcChannel>(
	channel: K,
	...args: IpcArgs<K>
): Promise<IpcResult<K>> {
	return bridge().invoke(channel, ...args)
}

export function subscribe<E extends IpcEvent>(
	event: E,
	listener: (payload: IpcEventMap[E]) => void,
): () => void {
	return bridge().on(event, listener)
}

export function hostPlatform(): NodeJS.Platform {
	return bridge().platform
}

export function filePathOf(file: File): string | undefined {
	try {
		return window.halcyonFiles?.pathFor(file)
	} catch {
		return undefined
	}
}

export function openExternal(url: string): void {
	void invoke("app:openExternal", url)
}

export function openPath(target: string): void {
	void invoke("app:openPath", target)
}
