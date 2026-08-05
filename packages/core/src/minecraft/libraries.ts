import { isAllowedByRules } from "./rules.ts"
import {
	coordinateKey,
	mavenRelativePath,
	mavenUrl,
	parseMavenCoordinate,
	withClassifier,
} from "./maven.ts"
import type { Artifact, FeatureSet, HostPlatform, Library } from "./types.ts"

export const DEFAULT_LIBRARY_REPOSITORY = "https://libraries.minecraft.net/"

export function nativeClassifier(library: Library, platform: HostPlatform): string | undefined {
	const natives = library.natives
	if (natives === undefined) {
		return undefined
	}
	const template = natives[platform.os]
	if (template === undefined) {
		return undefined
	}
	return template.replaceAll("${arch}", platform.arch === "x86" ? "32" : "64")
}

export function isNativeLibrary(library: Library): boolean {
	return library.natives !== undefined
}

export type ResolvedLibrary = {
	readonly library: Library
	readonly relativePath: string
	readonly url: string
	readonly sha1?: string
	readonly size?: number
	readonly native: boolean
	readonly extractExclusions: readonly string[]
}

function artifactFor(
	library: Library,
	platform: HostPlatform,
): { artifact?: Artifact; classifier?: string; native: boolean } {
	const classifier = nativeClassifier(library, platform)
	if (classifier !== undefined) {
		return {
			artifact: library.downloads?.classifiers?.[classifier],
			classifier,
			native: true,
		}
	}
	return { artifact: library.downloads?.artifact, native: false }
}

export function resolveLibrary(
	library: Library,
	platform: HostPlatform,
): ResolvedLibrary | undefined {
	const { artifact, classifier, native } = artifactFor(library, platform)
	if (native && classifier === undefined) {
		return undefined
	}

	const coordinate = withClassifier(parseMavenCoordinate(library.name), classifier)
	const relativePath = artifact?.path ?? mavenRelativePath(coordinate)
	const repository = library.url ?? DEFAULT_LIBRARY_REPOSITORY

	return {
		library,
		relativePath,
		url: artifact?.url ?? mavenUrl(repository, coordinate),
		sha1: artifact?.sha1,
		size: artifact?.size,
		native,
		extractExclusions: library.extract?.exclude ?? [],
	}
}

export function resolveLibraries(
	libraries: readonly Library[] | undefined,
	platform: HostPlatform,
	features: FeatureSet = {},
): readonly ResolvedLibrary[] {
	if (libraries === undefined) {
		return []
	}

	const seen = new Set<string>()
	const resolved: ResolvedLibrary[] = []

	for (const library of libraries) {
		if (!isAllowedByRules(library.rules, platform, features)) {
			continue
		}
		const entry = resolveLibrary(library, platform)
		if (entry === undefined) {
			continue
		}
		if (seen.has(entry.relativePath)) {
			continue
		}
		seen.add(entry.relativePath)
		resolved.push(entry)
	}

	return resolved
}

export function dedupeLibrariesByArtifact(libraries: readonly Library[]): readonly Library[] {
	const byKey = new Map<string, Library>()
	const ordered: Library[] = []

	for (const library of libraries) {
		let key: string
		try {
			key = coordinateKey(parseMavenCoordinate(library.name))
		} catch {
			key = library.name
		}
		if (byKey.has(key)) {
			continue
		}
		byKey.set(key, library)
		ordered.push(library)
	}

	return ordered
}
