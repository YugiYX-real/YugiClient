import type { Settings, ThemeMode } from "@halcyon/ipc"

type Palette = {
	readonly surface0: string
	readonly surface1: string
	readonly surface2: string
	readonly surface3: string
	readonly border: string
	readonly text: string
	readonly muted: string
	readonly shadow: string
}

const PALETTES: Record<ThemeMode, Palette> = {
	dark: {
		surface0: "#0B0E14",
		surface1: "#121722",
		surface2: "#1A2130",
		surface3: "#222B3D",
		border: "rgba(232, 236, 245, 0.09)",
		text: "#E8ECF5",
		muted: "rgba(232, 236, 245, 0.58)",
		shadow: "0 26px 60px rgba(3, 5, 10, 0.55)",
	},
	amoled: {
		surface0: "#000000",
		surface1: "#07080B",
		surface2: "#0D0F14",
		surface3: "#14171F",
		border: "rgba(232, 236, 245, 0.12)",
		text: "#F2F5FB",
		muted: "rgba(242, 245, 251, 0.55)",
		shadow: "0 26px 60px rgba(0, 0, 0, 0.8)",
	},
	light: {
		surface0: "#F4F6FB",
		surface1: "#FFFFFF",
		surface2: "#EEF1F8",
		surface3: "#E3E8F3",
		border: "rgba(11, 14, 20, 0.1)",
		text: "#141926",
		muted: "rgba(20, 25, 38, 0.6)",
		shadow: "0 22px 48px rgba(26, 33, 48, 0.14)",
	},
}

function channels(hex: string): { r: number; g: number; b: number } {
	const normalised = hex.replace("#", "")
	return {
		r: Number.parseInt(normalised.slice(0, 2), 16),
		g: Number.parseInt(normalised.slice(2, 4), 16),
		b: Number.parseInt(normalised.slice(4, 6), 16),
	}
}

function mix(hex: string, target: string, amount: number): string {
	const from = channels(hex)
	const to = channels(target)
	const blend = (left: number, right: number): number =>
		Math.round(left + (right - left) * amount)
	const value = (blend(from.r, to.r) << 16) | (blend(from.g, to.g) << 8) | blend(from.b, to.b)
	return `#${value.toString(16).padStart(6, "0")}`
}

export function applyTheme(settings: Settings): void {
	const root = document.documentElement
	const palette = PALETTES[settings.theme]
	const accent = settings.accent
	const rgb = channels(accent)

	root.dataset["theme"] = settings.theme
	root.dataset["animations"] = settings.animations
	root.dataset["blur"] = settings.blur ? "on" : "off"

	const variables: Record<string, string> = {
		"--surface-0": palette.surface0,
		"--surface-1": palette.surface1,
		"--surface-2": palette.surface2,
		"--surface-3": palette.surface3,
		"--border": palette.border,
		"--text": palette.text,
		"--muted": palette.muted,
		"--shadow": palette.shadow,
		"--accent": accent,
		"--accent-rgb": `${rgb.r}, ${rgb.g}, ${rgb.b}`,
		"--accent-soft": `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.16)`,
		"--accent-strong": mix(accent, settings.theme === "light" ? "#000000" : "#FFFFFF", 0.16),
		"--accent-contrast": settings.theme === "light" ? "#FFFFFF" : "#0B0E14",
		"--radius": `${settings.cornerRadius}px`,
		"--radius-sm": `${Math.max(4, Math.round(settings.cornerRadius * 0.6))}px`,
		"--radius-lg": `${Math.round(settings.cornerRadius * 1.6)}px`,
		"--glass": `rgba(${settings.theme === "light" ? "255, 255, 255" : "255, 255, 255"}, ${settings.transparency.toFixed(3)})`,
		"--ui-scale": settings.uiScale.toFixed(3),
		"--motion": settings.animations === "off" ? "0" : settings.animations === "reduced" ? "0.5" : "1",
		"--wallpaper": settings.wallpaper === null ? "none" : `url("file://${settings.wallpaper}")`,
	}

	for (const [name, value] of Object.entries(variables)) {
		root.style.setProperty(name, value)
	}
}

export const ACCENT_PRESETS: readonly { readonly name: string; readonly value: string }[] = [
	{ name: "Violet", value: "#7C5CFF" },
	{ name: "Aqua", value: "#39E0C8" },
	{ name: "Amber", value: "#FFB86B" },
	{ name: "Coral", value: "#FF6B7A" },
	{ name: "Mint", value: "#5BE49B" },
	{ name: "Azure", value: "#5AA9FF" },
]
