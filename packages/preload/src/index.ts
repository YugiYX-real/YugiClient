import { contextBridge, ipcRenderer } from "electron"
import { IPC_CHANNELS, IPC_EVENTS } from "@halcyon/ipc"
import type { HalcyonBridge, IpcChannel, IpcEvent } from "@halcyon/ipc"

const allowedChannels = new Set<string>(IPC_CHANNELS)
const allowedEvents = new Set<string>(IPC_EVENTS)

function assertChannel(channel: string): asserts channel is IpcChannel {
	if (!allowedChannels.has(channel)) {
		throw new Error(`Blocked unknown IPC channel "${channel}"`)
	}
}

function assertEvent(event: string): asserts event is IpcEvent {
	if (!allowedEvents.has(event)) {
		throw new Error(`Blocked unknown IPC event "${event}"`)
	}
}

const bridge: HalcyonBridge = {
	invoke: (channel, ...args) => {
		assertChannel(channel)
		return ipcRenderer.invoke(channel, ...args)
	},
	on: (event, listener) => {
		assertEvent(event)
		const handler = (_event: unknown, payload: unknown): void => {
			listener(payload as never)
		}
		ipcRenderer.on(event, handler)
		return () => {
			ipcRenderer.removeListener(event, handler)
		}
	},
	platform: process.platform,
}

contextBridge.exposeInMainWorld("halcyon", bridge)
