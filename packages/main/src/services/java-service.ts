import { execFile } from "node:child_process"
import { chmod, mkdir, readdir, rm, stat } from "node:fs/promises"
import { homedir, platform } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { isJavaCompatible, parseJavaVersionOutput, requiredJavaRuntime } from "@halcyon/core"
import type { JavaRuntime } from "@halcyon/ipc"
import { pathExists, unzipToDirectory } from "../infra/fs-extra.ts"
import type { AppPaths } from "../infra/paths.ts"
import type { HttpClient } from "../infra/http.ts"
import type { Logger } from "../infra/logger.ts"
import { adoptiumArch, adoptiumOs, javaExecutableName } from "../infra/platform.ts"

const run = promisify(execFile)

function adoptiumUrl(major: number): string {
	const os = adoptiumOs()
	const architecture = adoptiumArch()
	return `https://api.adoptium.net/v3/binary/latest/${major}/ga/${os}/${architecture}/jre/hotspot/normal/eclipse`
}

function candidateRoots(): readonly string[] {
	const home = homedir()
	switch (platform()) {
		case "win32":
			return [
				"C:\\Program Files\\Java",
				"C:\\Program Files\\Eclipse Adoptium",
				"C:\\Program Files\\Microsoft",
				"C:\\Program Files\\Zulu",
				"C:\\Program Files (x86)\\Java",
				join(home, "AppData", "Local", "Programs", "Eclipse Adoptium"),
				join(home, ".jdks"),
			]
		case "darwin":
			return ["/Library/Java/JavaVirtualMachines", join(home, "Library", "Java", "JavaVirtualMachines"), join(home, ".jdks")]
		default:
			return ["/usr/lib/jvm", "/usr/java", "/opt/java", join(home, ".jdks"), join(home, ".sdkman", "candidates", "java")]
	}
}

function executableCandidates(root: string): readonly string[] {
	const executable = javaExecutableName()
	return [
		join(root, "bin", executable),
		join(root, "jre", "bin", executable),
		join(root, "Contents", "Home", "bin", executable),
	]
}

export class JavaService {
	private readonly http: HttpClient
	private readonly paths: AppPaths
	private readonly logger: Logger
	private readonly cache = new Map<string, JavaRuntime>()

	constructor(dependencies: { http: HttpClient; paths: AppPaths; logger: Logger }) {
		this.http = dependencies.http
		this.paths = dependencies.paths
		this.logger = dependencies.logger
	}

	async validate(executablePath: string, managed = false): Promise<JavaRuntime> {
		const cached = this.cache.get(executablePath)
		if (cached !== undefined) {
			return cached
		}

		try {
			const { stdout, stderr } = await run(executablePath, ["-version"], { timeout: 8_000 })
			const banner = `${stderr}\n${stdout}`
			const major = parseJavaVersionOutput(banner)
			if (major === undefined) {
				throw new Error("Could not read the Java version banner")
			}
			const versionMatch = /version "([^"]+)"/.exec(banner)
			const vendorMatch = /^(\w[\w ]*?) (?:Runtime|OpenJDK)/m.exec(banner)
			const runtime: JavaRuntime = {
				path: executablePath,
				major,
				version: versionMatch?.[1] ?? String(major),
				vendor: vendorMatch?.[1]?.trim() ?? null,
				managed,
				valid: true,
				error: null,
			}
			this.cache.set(executablePath, runtime)
			return runtime
		} catch (error) {
			return {
				path: executablePath,
				major: 0,
				version: "unknown",
				vendor: null,
				managed,
				valid: false,
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	async managedRuntimes(): Promise<readonly JavaRuntime[]> {
		const runtimes: JavaRuntime[] = []
		let entries: string[] = []
		try {
			entries = (await readdir(this.paths.java, { withFileTypes: true }))
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name)
		} catch {
			return runtimes
		}

		for (const entry of entries) {
			const executable = await this.findExecutable(join(this.paths.java, entry))
			if (executable !== undefined) {
				runTimePush: {
					const runtime = await this.validate(executable, true)
					if (runtime.valid) {
						runtimes.push(runtime)
					}
					break runTimePush
				}
			}
		}
		return runtimes
	}

	private async findExecutable(root: string): Promise<string | undefined> {
		for (const candidate of executableCandidates(root)) {
			if (await pathExists(candidate)) {
				return candidate
			}
		}

		try {
			const nested = await readdir(root, { withFileTypes: true })
			for (const entry of nested) {
				if (!entry.isDirectory()) {
					continue
				}
				for (const candidate of executableCandidates(join(root, entry.name))) {
					if (await pathExists(candidate)) {
						return candidate
					}
				}
			}
		} catch {
			return undefined
		}
		return undefined
	}

	async detect(): Promise<readonly JavaRuntime[]> {
		const discovered = new Map<string, JavaRuntime>()

		for (const runtime of await this.managedRuntimes()) {
			discovered.set(runtime.path, runtime)
		}

		const javaHome = process.env.JAVA_HOME
		if (javaHome !== undefined && javaHome !== "") {
			const executable = await this.findExecutable(javaHome)
			if (executable !== undefined) {
				const runtime = await this.validate(executable)
				if (runtime.valid) {
					discovered.set(runtime.path, runtime)
				}
			}
		}

		for (const root of candidateRoots()) {
			let entries: string[] = []
			try {
				entries = (await readdir(root, { withFileTypes: true }))
					.filter((entry) => entry.isDirectory())
					.map((entry) => entry.name)
			} catch {
				continue
			}
			for (const entry of entries) {
				const executable = await this.findExecutable(join(root, entry))
				if (executable === undefined) {
					continue
				}
				const runtime = await this.validate(executable)
				if (runtime.valid) {
					discovered.set(runtime.path, runtime)
				}
			}
		}

		const onPath = await this.validate(javaExecutableName())
		if (onPath.valid) {
			discovered.set(onPath.path, onPath)
		}

		return [...discovered.values()].sort((left, right) => right.major - left.major)
	}

	async install(major: number): Promise<JavaRuntime> {
		const destination = join(this.paths.java, `jre-${major}`)
		const existing = await this.findExecutable(destination)
		if (existing !== undefined) {
			return this.validate(existing, true)
		}

		const isWindows = platform() === "win32"
		const archivePath = join(this.paths.cache, `jre-${major}${isWindows ? ".zip" : ".tar.gz"}`)
		this.logger.info(`Downloading a managed Java ${major} runtime`)
		await this.http.download(adoptiumUrl(major), archivePath, { skipIfValid: false })
		await mkdir(destination, { recursive: true })

		if (isWindows) {
			await unzipToDirectory(archivePath, destination)
		} else {
			await run("tar", ["-xzf", archivePath, "-C", destination])
		}
		await rm(archivePath, { force: true })

		const executable = await this.findExecutable(destination)
		if (executable === undefined) {
			throw new Error(`The downloaded Java ${major} archive did not contain a runtime`)
		}
		if (!isWindows) {
			await chmod(executable, 0o755)
		}
		this.cache.delete(executable)
		return this.validate(executable, true)
	}

	async resolveForVersion(
		gameVersion: string,
		overridePath: string | null,
		autoInstall: boolean,
	): Promise<JavaRuntime> {
		const requirement = requiredJavaRuntime(gameVersion)

		if (overridePath !== null && overridePath !== "") {
			const chosen = await this.validate(overridePath)
			if (chosen.valid) {
				return chosen
			}
			this.logger.warn(`The configured Java executable is unusable: ${overridePath}`)
		}

		const available = await this.detect()
		const compatible = available
			.filter((runtime) => isJavaCompatible(runtime.major, requirement))
			.sort((left, right) => {
				if (left.major === requirement.major && right.major !== requirement.major) {
					return -1
				}
				if (right.major === requirement.major && left.major !== requirement.major) {
					return 1
				}
				return left.major - right.major
			})

		const best = compatible[0]
		if (best !== undefined) {
			return best
		}
		if (!autoInstall) {
			throw new Error(
				`No compatible Java runtime found. ${gameVersion} needs Java ${requirement.major}.`,
			)
		}
		return this.install(requirement.major)
	}

	async sizeOnDisk(): Promise<number> {
		try {
			const info = await stat(this.paths.java)
			return info.size
		} catch {
			return 0
		}
	}
}
