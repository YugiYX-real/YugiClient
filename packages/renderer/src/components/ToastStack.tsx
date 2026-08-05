import type { Toast } from "@halcyon/ipc"
import { Icon } from "./Icon.tsx"
import type { IconName } from "./Icon.tsx"

const ICONS: Record<Toast["kind"], IconName> = {
	info: "sparkle",
	success: "check",
	warning: "alert",
	error: "alert",
}

export function ToastStack({
	toasts,
	onDismiss,
}: {
	toasts: readonly Toast[]
	onDismiss: (id: string) => void
}): JSX.Element | null {
	if (toasts.length === 0) {
		return null
	}

	return (
		<div className="toasts">
			{toasts.map((toast) => (
				<div className={`toast ${toast.kind}`} key={toast.id} role="status">
					<span className="accent-bar" />
					<Icon name={ICONS[toast.kind]} size={17} />
					<div className="col" style={{ gap: 2, flex: 1 }}>
						<strong style={{ fontSize: "0.88rem" }}>{toast.message}</strong>
						{toast.detail === null ? null : <small>{toast.detail}</small>}
					</div>
					<button
						type="button"
						className="btn ghost icon small"
						aria-label="Dismiss"
						onClick={() => {
							onDismiss(toast.id)
						}}
					>
						<Icon name="close" size={14} />
					</button>
				</div>
			))}
		</div>
	)
}
