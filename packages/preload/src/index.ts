import { contextBridge, ipcRenderer, webUtils } from "electron"
import type { IpcRendererEvent } from "electron"
import { IPC_CHANNELS, IPC_EVENTS } from "@halcyon/ipc"
import type {
	HalcyonBridge,
	IpcArgs,
	IpcChannel,
	IpcEvent,
	IpcEventMap,
	IpcResult,
} from "@halcyon/ipc"

const allowedChannels: ReadonlySet<string> = new Set(IPC_CHANNELS)
const allowedEvents: ReadonlySet<string> = new Set(IPC_EVENTS)

function assertChannel(channel: string): void {
	if (!allowedChannels.has(channel)) {
		throw new Error(`Blocked unknown IPC channel "${channel}"`)
	}
}

function assertEvent(event: string): void {
	if (!allowedEvents.has(event)) {
		throw new Error(`Blocked unknown IPC event "${event}"`)
	}
}

const bridge: HalcyonBridge = {
	invoke<K extends IpcChannel>(channel: K, ...args: IpcArgs<K>): Promise<IpcResult<K>> {
		assertChannel(channel)
		return ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<K>>
	},
	on<E extends IpcEvent>(event: E, listener: (payload: IpcEventMap[E]) => void): () => void {
		assertEvent(event)
		const handler = (_event: IpcRendererEvent, payload: IpcEventMap[E]): void => {
			listener(payload)
		}
		ipcRenderer.on(event, handler)
		return () => {
			ipcRenderer.removeListener(event, handler)
		}
	},
	platform: process.platform,
}

contextBridge.exposeInMainWorld("halcyon", bridge)

contextBridge.exposeInMainWorld("halcyonFiles", {
	pathFor: (file: File): string => webUtils.getPathForFile(file),
})
