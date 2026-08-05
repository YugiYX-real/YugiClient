import { dedupeLibrariesByArtifact } from "./libraries.ts"
import type { VersionJson } from "./types.ts"

export class UnresolvedInheritanceError extends Error {
	readonly versionId: string
	readonly missingParent: string

	constructor(versionId: string, missingParent: string) {
		super(`Version "${versionId}" inherits from "${missingParent}", which is not available`)
		this.name = "UnresolvedInheritanceError"
		this.versionId = versionId
		this.missingParent = missingParent
	}
}

export class CircularInheritanceError extends Error {
	readonly chain: readonly string[]

	constructor(chain: readonly string[]) {
		super(`Circular version inheritance detected: ${chain.join(" -> ")}`)
		this.name = "CircularInheritanceError"
		this.chain = chain
	}
}

export function mergeVersionJson(child: VersionJson, parent: VersionJson): VersionJson {
	const merged: VersionJson = {
		id: child.id,
		type: child.type ?? parent.type,
		mainClass: child.mainClass ?? parent.mainClass,
		assets: child.assets ?? parent.assets,
		assetIndex: child.assetIndex ?? parent.assetIndex,
		javaVersion: child.javaVersion ?? parent.javaVersion,
		downloads: child.downloads ?? parent.downloads,
		logging: child.logging ?? parent.logging,
		releaseTime: child.releaseTime ?? parent.releaseTime,
		time: child.time ?? parent.time,
		complianceLevel: child.complianceLevel ?? parent.complianceLevel,
		minimumLauncherVersion: child.minimumLauncherVersion ?? parent.minimumLauncherVersion,
		minecraftArguments: child.minecraftArguments ?? parent.minecraftArguments,
		libraries: dedupeLibrariesByArtifact([
			...(child.libraries ?? []),
			...(parent.libraries ?? []),
		]),
		arguments: {
			jvm: [...(parent.arguments?.jvm ?? []), ...(child.arguments?.jvm ?? [])],
			game: [...(parent.arguments?.game ?? []), ...(child.arguments?.game ?? [])],
		},
	}

	const hasArguments =
		(merged.arguments?.jvm?.length ?? 0) > 0 || (merged.arguments?.game?.length ?? 0) > 0

	return hasArguments ? merged : { ...merged, arguments: undefined }
}

export function flattenVersionChain(chain: readonly VersionJson[]): VersionJson {
	if (chain.length === 0) {
		throw new Error("Cannot flatten an empty version chain")
	}

	let result = chain[chain.length - 1] as VersionJson
	for (let index = chain.length - 2; index >= 0; index -= 1) {
		result = mergeVersionJson(chain[index] as VersionJson, result)
	}
	return result
}

export function resolveVersionChain(
	rootId: string,
	lookup: (id: string) => VersionJson | undefined,
): readonly VersionJson[] {
	const chain: VersionJson[] = []
	const visited = new Set<string>()
	let currentId: string | undefined = rootId

	while (currentId !== undefined) {
		if (visited.has(currentId)) {
			throw new CircularInheritanceError([...visited, currentId])
		}
		visited.add(currentId)

		const version = lookup(currentId)
		if (version === undefined) {
			const parentOf = chain[chain.length - 1]
			throw new UnresolvedInheritanceError(parentOf?.id ?? rootId, currentId)
		}

		chain.push(version)
		currentId = version.inheritsFrom
	}

	return chain
}

export function resolveVersion(
	rootId: string,
	lookup: (id: string) => VersionJson | undefined,
): VersionJson {
	return flattenVersionChain(resolveVersionChain(rootId, lookup))
}
