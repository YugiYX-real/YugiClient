import type { BrowserWindow } from "electron"
import { randomUUID } from "node:crypto"
import type { IpcEvent, IpcEventMap, Toast, ToastKind } from "@halcyon/ipc"

export class EventBus {
	private readonly windows = new Set<BrowserWindow>()
	private readonly localListeners = new Map<string, Set<(payload: unknown) => void>>()

	register(window: BrowserWindow): void {
		this.windows.add(window)
		window.once("closed", () => {
			this.windows.delete(window)
		})
	}

	emit<E extends IpcEvent>(event: E, payload: IpcEventMap[E]): void {
		for (const window of this.windows) {
			if (!window.isDestroyed()) {
				window.webContents.send(event, payload)
			}
		}
		const listeners = this.localListeners.get(event)
		if (listeners !== undefined) {
			for (const listener of listeners) {
				listener(payload)
			}
		}
	}

	on<E extends IpcEvent>(event: E, listener: (payload: IpcEventMap[E]) => void): () => void {
		const listeners = this.localListeners.get(event) ?? new Set()
		const wrapped = listener as (payload: unknown) => void
		listeners.add(wrapped)
		this.localListeners.set(event, listeners)
		return () => {
			listeners.delete(wrapped)
		}
	}

	toast(kind: ToastKind, message: string, detail: string | null = null): void {
		const toast: Toast = { id: randomUUID(), kind, message, detail }
		this.emit("toast", toast)
	}
}
