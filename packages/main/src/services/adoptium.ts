import { adoptiumArch, adoptiumOs } from "../infra/platform.ts"

const ADOPTIUM_BINARY_BASE = "https://api.adoptium.net/v3/binary/latest/"

export function adoptiumJreUrl(major: number): string {
	const segments = [
		String(major),
		"ga",
		adoptiumOs(),
		adoptiumArch(),
		"jre",
		"hotspot",
		"normal",
		"eclipse",
	]
	return ADOPTIUM_BINARY_BASE + segments.join("/")
}
