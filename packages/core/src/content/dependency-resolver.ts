import type { LoaderId } from "../minecraft/types.ts"

export type DependencyKind = "required" | "optional" | "incompatible" | "embedded"

export type ContentDependency = {
	readonly projectId?: string
	readonly versionId?: string
	readonly kind: DependencyKind
}

export type ContentVersion = {
	readonly projectId: string
	readonly versionId: string
	readonly name: string
	readonly slug: string
	readonly gameVersions: readonly string[]
	readonly loaders: readonly string[]
	readonly dependencies: readonly ContentDependency[]
}

export type ResolutionTarget = {
	readonly gameVersion: string
	readonly loader: LoaderId
}

export type ContentResolverPort = {
	getVersion(versionId: string): Promise<ContentVersion | undefined>
	getLatestVersion(projectId: string, target: ResolutionTarget): Promise<ContentVersion | undefined>
}

export type InstalledContent = {
	readonly projectId?: string
	readonly versionId?: string
	readonly fileName: string
	readonly enabled: boolean
}

export type ResolutionProblem = {
	readonly kind: "missing-dependency" | "incompatible" | "unsupported-target" | "cycle"
	readonly message: string
	readonly projectId?: string
	readonly requiredBy?: string
}

export type InstallPlan = {
	readonly install: readonly ContentVersion[]
	readonly alreadySatisfied: readonly string[]
	readonly problems: readonly ResolutionProblem[]
}

function supportsTarget(version: ContentVersion, target: ResolutionTarget): boolean {
	const gameOk =
		version.gameVersions.length === 0 || version.gameVersions.includes(target.gameVersion)
	const loaderOk =
		version.loaders.length === 0 ||
		version.loaders.includes(target.loader) ||
		(target.loader === "quilt" && version.loaders.includes("fabric"))
	return gameOk && loaderOk
}

export async function resolveInstallPlan(
	roots: readonly ContentVersion[],
	port: ContentResolverPort,
	target: ResolutionTarget,
	installed: readonly InstalledContent[] = [],
): Promise<InstallPlan> {
	const install: ContentVersion[] = []
	const problems: ResolutionProblem[] = []
	const alreadySatisfied: string[] = []

	const installedProjects = new Set(
		installed.map((entry) => entry.projectId).filter((id): id is string => id !== undefined),
	)
	const plannedProjects = new Set<string>()
	const visiting = new Set<string>()

	const queue: { version: ContentVersion; requiredBy?: string }[] = roots.map((version) => ({
		version,
	}))

	while (queue.length > 0) {
		const item = queue.shift()
		if (item === undefined) {
			break
		}
		const { version, requiredBy } = item

		if (plannedProjects.has(version.projectId)) {
			continue
		}
		if (visiting.has(version.versionId)) {
			problems.push({
				kind: "cycle",
				message: `Dependency cycle detected at ${version.name}`,
				projectId: version.projectId,
				requiredBy,
			})
			continue
		}
		visiting.add(version.versionId)

		if (!supportsTarget(version, target)) {
			problems.push({
				kind: "unsupported-target",
				message: `${version.name} does not list support for Minecraft ${target.gameVersion} on ${target.loader}`,
				projectId: version.projectId,
				requiredBy,
			})
		}

		plannedProjects.add(version.projectId)
		install.push(version)

		for (const dependency of version.dependencies) {
			if (dependency.kind === "embedded" || dependency.kind === "optional") {
				continue
			}

			if (dependency.kind === "incompatible") {
				const conflictId = dependency.projectId
				if (
					conflictId !== undefined &&
					(installedProjects.has(conflictId) || plannedProjects.has(conflictId))
				) {
					problems.push({
						kind: "incompatible",
						message: `${version.name} is incompatible with an installed project (${conflictId})`,
						projectId: conflictId,
						requiredBy: version.projectId,
					})
				}
				continue
			}

			const dependencyProject = dependency.projectId
			if (dependencyProject !== undefined && installedProjects.has(dependencyProject)) {
				alreadySatisfied.push(dependencyProject)
				continue
			}
			if (dependencyProject !== undefined && plannedProjects.has(dependencyProject)) {
				continue
			}

			const resolved =
				dependency.versionId !== undefined
					? await port.getVersion(dependency.versionId)
					: dependencyProject !== undefined
						? await port.getLatestVersion(dependencyProject, target)
						: undefined

			if (resolved === undefined) {
				problems.push({
					kind: "missing-dependency",
					message: `Could not resolve a required dependency of ${version.name}${
						dependencyProject === undefined ? "" : ` (${dependencyProject})`
					} for Minecraft ${target.gameVersion} on ${target.loader}`,
					projectId: dependencyProject,
					requiredBy: version.projectId,
				})
				continue
			}

			queue.push({ version: resolved, requiredBy: version.projectId })
		}
	}

	return { install, alreadySatisfied, problems }
}

export type DuplicateGroup = {
	readonly projectId: string
	readonly files: readonly string[]
}

export function findDuplicateProjects(
	installed: readonly InstalledContent[],
): readonly DuplicateGroup[] {
	const byProject = new Map<string, string[]>()
	for (const entry of installed) {
		if (entry.projectId === undefined) {
			continue
		}
		const files = byProject.get(entry.projectId) ?? []
		files.push(entry.fileName)
		byProject.set(entry.projectId, files)
	}

	const duplicates: DuplicateGroup[] = []
	for (const [projectId, files] of byProject) {
		if (files.length > 1) {
			duplicates.push({ projectId, files })
		}
	}
	return duplicates
}
