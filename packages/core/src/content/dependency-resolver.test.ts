import test from "node:test"
import assert from "node:assert/strict"

import { findDuplicateProjects, resolveInstallPlan } from "./dependency-resolver.ts"
import type {
	ContentResolverPort,
	ContentVersion,
	ResolutionTarget,
} from "./dependency-resolver.ts"

const target: ResolutionTarget = { gameVersion: "1.20.1", loader: "fabric" }

function version(overrides: Partial<ContentVersion> & { projectId: string }): ContentVersion {
	return {
		versionId: `${overrides.projectId}-v1`,
		name: overrides.projectId,
		slug: overrides.projectId,
		gameVersions: ["1.20.1"],
		loaders: ["fabric"],
		dependencies: [],
		...overrides,
	}
}

const fabricApi = version({ projectId: "fabric-api", name: "Fabric API" })
const sodium = version({ projectId: "sodium", name: "Sodium" })
const iris = version({
	projectId: "iris",
	name: "Iris Shaders",
	dependencies: [
		{ projectId: "sodium", kind: "required" },
		{ projectId: "fabric-api", kind: "optional" },
	],
})

function port(catalogue: readonly ContentVersion[]): ContentResolverPort {
	const byVersion = new Map(catalogue.map((entry) => [entry.versionId, entry]))
	const byProject = new Map(catalogue.map((entry) => [entry.projectId, entry]))
	return {
		getVersion: async (versionId) => byVersion.get(versionId),
		getLatestVersion: async (projectId) => byProject.get(projectId),
	}
}

test("required dependencies are pulled in transitively", async () => {
	const plan = await resolveInstallPlan([iris], port([sodium, fabricApi]), target)
	assert.deepEqual(
		plan.install.map((entry) => entry.projectId),
		["iris", "sodium"],
	)
	assert.deepEqual(plan.problems, [])
})

test("optional dependencies are never installed silently", async () => {
	const plan = await resolveInstallPlan([iris], port([sodium, fabricApi]), target)
	assert.ok(!plan.install.some((entry) => entry.projectId === "fabric-api"))
})

test("already installed dependencies are reported as satisfied", async () => {
	const plan = await resolveInstallPlan([iris], port([sodium]), target, [
		{ projectId: "sodium", fileName: "sodium.jar", enabled: true },
	])
	assert.deepEqual(
		plan.install.map((entry) => entry.projectId),
		["iris"],
	)
	assert.deepEqual(plan.alreadySatisfied, ["sodium"])
})

test("unresolvable dependencies surface as problems instead of throwing", async () => {
	const plan = await resolveInstallPlan([iris], port([]), target)
	assert.equal(plan.problems.length, 1)
	assert.equal(plan.problems[0]?.kind, "missing-dependency")
	assert.equal(plan.problems[0]?.requiredBy, "iris")
})

test("target mismatches are flagged but do not stop planning", async () => {
	const plan = await resolveInstallPlan([sodium], port([]), {
		gameVersion: "1.21",
		loader: "fabric",
	})
	assert.equal(plan.install.length, 1)
	assert.equal(plan.problems[0]?.kind, "unsupported-target")
	assert.match(plan.problems[0]?.message ?? "", /1\.21/)
})

test("quilt accepts fabric mods", async () => {
	const plan = await resolveInstallPlan([sodium], port([]), {
		gameVersion: "1.20.1",
		loader: "quilt",
	})
	assert.deepEqual(plan.problems, [])
})

test("declared incompatibilities are detected against installed content", async () => {
	const rival = version({
		projectId: "optifine-alt",
		dependencies: [{ projectId: "sodium", kind: "incompatible" }],
	})
	const plan = await resolveInstallPlan([rival], port([]), target, [
		{ projectId: "sodium", fileName: "sodium.jar", enabled: true },
	])
	assert.equal(plan.problems[0]?.kind, "incompatible")
})

test("dependency cycles terminate", async () => {
	const a = version({ projectId: "a", dependencies: [{ projectId: "b", kind: "required" }] })
	const b = version({ projectId: "b", dependencies: [{ projectId: "a", kind: "required" }] })
	const plan = await resolveInstallPlan([a], port([a, b]), target)
	assert.deepEqual(
		plan.install.map((entry) => entry.projectId),
		["a", "b"],
	)
})

test("duplicate installs are grouped by project", () => {
	const duplicates = findDuplicateProjects([
		{ projectId: "sodium", fileName: "sodium-0.5.8.jar", enabled: true },
		{ projectId: "sodium", fileName: "sodium-0.5.3.jar", enabled: false },
		{ projectId: "iris", fileName: "iris.jar", enabled: true },
		{ fileName: "unknown.jar", enabled: true },
	])
	assert.equal(duplicates.length, 1)
	assert.equal(duplicates[0]?.projectId, "sodium")
	assert.equal(duplicates[0]?.files.length, 2)
})
