const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const

const UNKNOWN = "—"

export function formatBytes(bytes: number | null, fractionDigits = 1): string {
	if (bytes === null) {
		return UNKNOWN
	}
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return "0 B"
	}
	const exponent = Math.min(BYTE_UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
	const value = bytes / 1024 ** exponent
	const unit = BYTE_UNITS[exponent] ?? "B"
	return `${value.toFixed(exponent === 0 ? 0 : fractionDigits)} ${unit}`
}

export function formatSpeed(bytesPerSecond: number): string {
	return bytesPerSecond <= 0 ? UNKNOWN : `${formatBytes(bytesPerSecond)}/s`
}

export function formatEta(seconds: number | null): string {
	if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) {
		return UNKNOWN
	}
	if (seconds < 60) {
		return `${Math.ceil(seconds)}s`
	}
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) {
		return `${minutes}m ${Math.round(seconds % 60)}s`
	}
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function formatPlaytime(minutes: number | null): string {
	if (minutes === null || minutes <= 0) {
		return "Not played yet"
	}
	if (minutes < 60) {
		return `${Math.round(minutes)} min`
	}
	const hours = Math.floor(minutes / 60)
	const rest = Math.round(minutes % 60)
	return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

export function formatCount(value: number | null): string {
	if (value === null) {
		return UNKNOWN
	}
	if (value >= 1_000_000) {
		return `${(value / 1_000_000).toFixed(1)}M`
	}
	if (value >= 1_000) {
		return `${(value / 1_000).toFixed(1)}K`
	}
	return String(value)
}

export function formatDate(iso: string | null): string {
	if (iso === null || iso === "") {
		return UNKNOWN
	}
	const date = new Date(iso)
	if (Number.isNaN(date.getTime())) {
		return UNKNOWN
	}
	return date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })
}

export function formatRelative(iso: string | null): string {
	if (iso === null || iso === "") {
		return "never"
	}
	const timestamp = new Date(iso).getTime()
	if (Number.isNaN(timestamp)) {
		return "never"
	}

	const deltaSeconds = Math.round((timestamp - Date.now()) / 1000)
	const thresholds: readonly {
		limit: number
		unit: Intl.RelativeTimeFormatUnit
		divisor: number
	}[] = [
		{ limit: 60, unit: "second", divisor: 1 },
		{ limit: 3600, unit: "minute", divisor: 60 },
		{ limit: 86_400, unit: "hour", divisor: 3600 },
		{ limit: 2_592_000, unit: "day", divisor: 86_400 },
		{ limit: 31_536_000, unit: "month", divisor: 2_592_000 },
	]

	const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
	for (const threshold of thresholds) {
		if (Math.abs(deltaSeconds) < threshold.limit) {
			return formatter.format(Math.round(deltaSeconds / threshold.divisor), threshold.unit)
		}
	}
	return formatter.format(Math.round(deltaSeconds / 31_536_000), "year")
}

export function formatMemory(megabytes: number | null): string {
	if (megabytes === null) {
		return UNKNOWN
	}
	return megabytes >= 1024 ? `${(megabytes / 1024).toFixed(1)} GB` : `${megabytes} MB`
}

export function initialsOf(value: string): string {
	const parts = value.trim().split(/\s+/)
	const first = parts[0]?.charAt(0) ?? "?"
	const second = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : ""
	return (first + second).toUpperCase()
}
