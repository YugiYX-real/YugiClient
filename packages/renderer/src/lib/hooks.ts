import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { IpcEvent, IpcEventMap, Settings, Toast } from "@halcyon/ipc"
import { invoke, subscribe } from "./client.ts"

export type AsyncState<T> = {
	readonly data: T | undefined
	readonly error: string | null
	readonly loading: boolean
	reload: () => void
}

export function useAsync<T>(loader: () => Promise<T>, dependencies: readonly unknown[]): AsyncState<T> {
	const [data, setData] = useState<T | undefined>(undefined)
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)
	const [nonce, setNonce] = useState(0)
	const loaderRef = useRef(loader)
	loaderRef.current = loader

	useEffect(() => {
		let active = true
		setLoading(true)
		loaderRef
			.current()
			.then((value) => {
				if (active) {
					setData(value)
					setError(null)
				}
			})
			.catch((cause: unknown) => {
				if (active) {
					setError(cause instanceof Error ? cause.message : String(cause))
				}
			})
			.finally(() => {
				if (active) {
					setLoading(false)
				}
			})
		return () => {
			active = false
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [...dependencies, nonce])

	const reload = useCallback(() => {
		setNonce((current) => current + 1)
	}, [])

	return { data, error, loading, reload }
}

export function useIpcEvent<E extends IpcEvent>(
	event: E,
	listener: (payload: IpcEventMap[E]) => void,
): void {
	const listenerRef = useRef(listener)
	listenerRef.current = listener

	useEffect(() => {
		return subscribe(event, (payload) => {
			listenerRef.current(payload)
		})
	}, [event])
}

export function useToasts(): { toasts: readonly Toast[]; dismiss: (id: string) => void } {
	const [toasts, setToasts] = useState<readonly Toast[]>([])

	const dismiss = useCallback((id: string) => {
		setToasts((current) => current.filter((toast) => toast.id !== id))
	}, [])

	useIpcEvent("toast", (toast) => {
		setToasts((current) => [...current.slice(-4), toast])
		const lifetime = toast.kind === "error" ? 9_000 : 5_000
		setTimeout(() => {
			setToasts((current) => current.filter((candidate) => candidate.id !== toast.id))
		}, lifetime)
	})

	return { toasts, dismiss }
}

export function useSettings(): {
	settings: Settings | undefined
	update: (patch: Partial<Settings>) => Promise<void>
	reset: () => Promise<void>
} {
	const [settings, setSettings] = useState<Settings | undefined>(undefined)

	useEffect(() => {
		void invoke("settings:get").then(setSettings)
	}, [])

	useIpcEvent("settings:changed", setSettings)

	const update = useCallback(async (patch: Partial<Settings>) => {
		setSettings(await invoke("settings:update", patch))
	}, [])

	const reset = useCallback(async () => {
		setSettings(await invoke("settings:reset"))
	}, [])

	return { settings, update, reset }
}

export function useDebounced<T>(value: T, delayMs = 320): T {
	const [debounced, setDebounced] = useState(value)

	useEffect(() => {
		const timer = setTimeout(() => {
			setDebounced(value)
		}, delayMs)
		return () => {
			clearTimeout(timer)
		}
	}, [value, delayMs])

	return debounced
}

export function useKeyboardShortcut(
	combination: { key: string; meta?: boolean; shift?: boolean },
	handler: () => void,
): void {
	const handlerRef = useRef(handler)
	handlerRef.current = handler

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			const meta = combination.meta === true ? event.ctrlKey || event.metaKey : true
			const shift = combination.shift === true ? event.shiftKey : true
			if (event.key.toLowerCase() === combination.key.toLowerCase() && meta && shift) {
				event.preventDefault()
				handlerRef.current()
			}
		}
		window.addEventListener("keydown", onKeyDown)
		return () => {
			window.removeEventListener("keydown", onKeyDown)
		}
	}, [combination.key, combination.meta, combination.shift])
}

export function useSelection<T extends string>(): {
	selected: readonly T[]
	toggle: (value: T) => void
	clear: () => void
	selectAll: (values: readonly T[]) => void
	has: (value: T) => boolean
} {
	const [selected, setSelected] = useState<readonly T[]>([])

	return useMemo(
		() => ({
			selected,
			toggle: (value: T) => {
				setSelected((current) =>
					current.includes(value)
						? current.filter((candidate) => candidate !== value)
						: [...current, value],
				)
			},
			clear: () => {
				setSelected([])
			},
			selectAll: (values: readonly T[]) => {
				setSelected(values)
			},
			has: (value: T) => selected.includes(value),
		}),
		[selected],
	)
}
