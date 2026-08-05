import { arch, platform, totalmem } from "node:os"
import type { HostPlatform } from "@halcyon/core"

export function hostPlatform(): HostPlatform {
	const osName = platform() === "win32" ? "windows" : platform() === "darwin" ? "osx" : "linux"
	const architecture = arch() === "arm64" ? "arm64" : arch() === "ia32" ? "x86" : "x86_64"
	return { os: osName, arch: architecture, version: process.getSystemVersion?.() ?? "0.0.0" }
}

export function totalSystemMemoryMb(): number {
	return Math.round(totalmem() / (1024 * 1024))
}

export function adoptiumOs(): "windows" | "mac" | "linux" {
	switch (platform()) {
		case "win32":
			return "windows"
		case "darwin":
			return "mac"
		default:
			return "linux"
	}
}

export function adoptiumArch(): "x64" | "aarch64" | "x86" {
	switch (arch()) {
		case "arm64":
			return "aarch64"
		case "ia32":
			return "x86"
		default:
			return "x64"
	}
}

export function javaExecutableName(): string {
	return platform() === "win32" ? "java.exe" : "java"
}
