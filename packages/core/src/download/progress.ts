export type ProgressSnapshot = {
	readonly completedBytes: number
	readonly totalBytes: number
	readonly completedItems: number
	readonly totalItems: number
	readonly bytesPerSecond: number
	readonly etaSeconds: number | undefined
	readonly fraction: number
}

const SMOOTHING = 0.25

export class SpeedEstimator {
	private lastBytes = 0
	private lastTimestamp: number | undefined
	private smoothed = 0

	sample(totalBytes: number, timestamp: number): number {
		if (this.lastTimestamp === undefined) {
			this.lastTimestamp = timestamp
			this.lastBytes = totalBytes
			return 0
		}

		const elapsed = (timestamp - this.lastTimestamp) / 1000
		if (elapsed <= 0) {
			return this.smoothed
		}

		const delta = Math.max(0, totalBytes - this.lastBytes)
		const instant = delta / elapsed
		this.smoothed =
			this.smoothed === 0 ? instant : this.smoothed * (1 - SMOOTHING) + instant * SMOOTHING
		this.lastBytes = totalBytes
		this.lastTimestamp = timestamp
		return this.smoothed
	}

	get current(): number {
		return this.smoothed
	}

	reset(): void {
		this.lastBytes = 0
		this.lastTimestamp = undefined
		this.smoothed = 0
	}
}

export function computeEtaSeconds(
	completedBytes: number,
	totalBytes: number,
	bytesPerSecond: number,
): number | undefined {
	if (bytesPerSecond <= 0 || totalBytes <= 0 || completedBytes >= totalBytes) {
		return undefined
	}
	return (totalBytes - completedBytes) / bytesPerSecond
}

export function progressFraction(completed: number, total: number): number {
	if (total <= 0) {
		return 0
	}
	return Math.min(1, Math.max(0, completed / total))
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const

export function formatBytes(bytes: number, fractionDigits = 1): string {
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return "0 B"
	}
	const exponent = Math.min(BYTE_UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
	const value = bytes / 1024 ** exponent
	const unit = BYTE_UNITS[exponent] ?? "B"
	return `${value.toFixed(exponent === 0 ? 0 : fractionDigits)} ${unit}`
}

export function formatSpeed(bytesPerSecond: number): string {
	return `${formatBytes(bytesPerSecond)}/s`
}

export function formatDuration(seconds: number | undefined): string {
	if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
		return "--"
	}
	const total = Math.round(seconds)
	const hours = Math.floor(total / 3600)
	const minutes = Math.floor((total % 3600) / 60)
	const secs = total % 60
	if (hours > 0) {
		return `${hours}h ${String(minutes).padStart(2, "0")}m`
	}
	if (minutes > 0) {
		return `${minutes}m ${String(secs).padStart(2, "0")}s`
	}
	return `${secs}s`
}

export function formatPlaytime(minutes: number): string {
	if (minutes < 60) {
		return `${Math.round(minutes)} min`
	}
	const hours = minutes / 60
	if (hours < 24) {
		return `${hours.toFixed(1)} h`
	}
	return `${Math.floor(hours / 24)}d ${Math.round(hours % 24)}h`
}
