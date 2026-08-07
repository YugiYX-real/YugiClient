import { spawn } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import { mkdir, readFile, readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { buildLaunchInvocation, summarizeExitCode } from "@halcyon/core"
import type { HostPlatform, LaunchSession, UserType, VersionJson } from "@halcyon/core"
import type { LaunchResult, LaunchState } from "@halcyon/ipc"
import type { EventBus } from "../infra/events.ts"
import type { Logger } from "../infra/logger.ts"
import type { AppPaths } from "../infra/paths.ts"
import { pathExists } from "../infra/fs-extra.ts"
import type { AuthService } from "./auth-service.ts"
import type { CompanionService } from "./companion-service.ts"
import type { InstanceService } from "./instance-service.ts"
import type { JavaService } from "./java-service.ts"
import type { LoaderService } from "./loader-service.ts"
import type { LogService } from "./log-service.ts"
import type { PresenceService } from "./presence-service.ts"
import type { SettingsService } from "./settings-service.ts"
import type { StatisticsService } from "./statistics-service.ts"
import type { VersionService } from "./version-service.ts"

type RunningGame = {
	readonly child: ChildProcess
	readonly startedAtMs: number
}

/** Only reports written by the run that just ended are worth showing. */
const CRASH_REPORT_MAX_AGE_MS = 5 * 60 * 1000
const CRASH_EXCERPT_LINES = 26
const CRASH_EXCERPT_FRAMES = 8

function loggingConfigId(version: VersionJson): string | undefined {
	const raw = version as unknown as {
		logging?: { client?: { file?: { id?: string } } }
	}
	return raw.logging?.client?.file?.id
}

function userTypeFor(kind: "microsoft" | "offline"): UserType {
	return kind === "microsoft" ? "msa" : "legacy"
}

/**
 * Trims a Minecraft crash report down to the part that explains the crash:
 * the description, the exception and the first few stack frames. The rest of
 * the report is mostly hardware details that bury the cause.
 */
function crashReportExcerpt(content: string): string {
	const lines = content.split(/\r?\n/)
	const described = lines.findIndex((line) => line.startsWith("Description:"))
	const picked: string[] = []
	let frames = 0

	for (const line of lines.slice(described === -1 ? 0 : described)) {
		if (picked.length >= CRASH_EXCERPT_LINES) {
			break
		}
		if (line.startsWith("-- ") && picked.length > 0) {
			break
		}
		if (line.trim().startsWith("at ")) {
			frames += 1
			if (frames > CRASH_EXCERPT_FRAMES) {
				continue
			}
		}
		picked.push(line)
	}

	return picked.join("\n").trim()
}

function crashHeadline(excerpt: string): string | null {
	for (const line of excerpt.split("\n")) {
		const trimmed = line.trim()
		if (trimmed.length === 0 || trimmed.startsWith("Description:")) {
			continue
		}
		return trimmed
	}
	return null
}

export class LaunchService {
	private readonly instances: InstanceService
	private readonly versions: VersionService
	private readonly loaders: LoaderService
	private readonly java: JavaService
	private readonly auth: AuthService
	private readonly settings: SettingsService
	private readonly logs: LogService
	private readonly statistics: StatisticsService
	private readonly presence: PresenceService
	private readonly companion: CompanionService
	private readonly events: EventBus
	private readonly logger: Logger
	private readonly paths: AppPaths
	private readonly platform: HostPlatform
	private readonly appVersion: string
	private readonly running = new Map<string, RunningGame>()

	constructor(dependencies: {
		instances: InstanceService
		versions: VersionService
		loaders: LoaderService
		java: JavaService
		auth: AuthService
		settings: SettingsService
		logs: LogService
		statistics: StatisticsService
		presence: PresenceService
		companion: CompanionService
		events: EventBus
		logger: Logger
		paths: AppPaths
		platform: HostPlatform
		appVersion: string
	}) {
		this.instances = dependencies.instances
		this.versions = dependencies.versions
		this.loaders = dependencies.loaders
		this.java = dependencies.java
		this.auth = dependencies.auth
		this.settings = dependencies.settings
		this.logs = dependencies.logs
		this.statistics = dependencies.statistics
		this.presence = dependencies.presence
		this.companion = dependencies.companion
		this.events = dependencies.events
		this.logger = dependencies.logger
		this.paths = dependencies.paths
		this.platform = dependencies.platform
		this.appVersion = dependencies.appVersion
	}

	private progress(
		instanceId: string,
		state: LaunchState,
		detail: string,
		fraction: number,
		exitCode: number | null = null,
	): void {
		this.events.emit("launch:progress", { instanceId, state, detail, fraction, exitCode })
	}

	isRunning(instanceId: string): boolean {
		return this.running.has(instanceId)
	}

	async launch(instanceId: string, accountId: string | null = null): Promise<LaunchResult> {
		if (this.running.has(instanceId)) {
			return {
				instanceId,
				started: false,
				pid: null,
				message: "This instance is already running",
			}
		}

		try {
			return await this.startGame(instanceId, accountId)
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			this.logger.error(`Launch failed for ${instanceId}`, error)
			this.progress(instanceId, "error", message, 1)
			this.instances.setRunning(instanceId, false)
			this.events.toast("error", "Launch failed", message)
			return { instanceId, started: false, pid: null, message }
		}
	}

	private async startGame(instanceId: string, accountId: string | null): Promise<LaunchResult> {
		const config = await this.instances.config(instanceId)
		const settings = await this.settings.get()

		this.progress(instanceId, "preparing", `Preparing ${config.name}`, 0.02)

		const account =
			accountId === null
				? await this.auth.selected()
				: (await this.auth.list()).find((candidate) => candidate.id === accountId)
		if (account === undefined) {
			throw new Error("Add an account before launching the game")
		}

		const accessToken =
			account.kind === "microsoft" ? await this.auth.validAccessToken(account.id) : null
		if (account.kind === "microsoft" && accessToken === null) {
			throw new Error("The Microsoft session expired; sign in again")
		}

		this.progress(
			instanceId,
			"resolving",
			`Resolving ${config.loader} ${config.gameVersion}`,
			0.08,
		)
		const launchVersionId = await this.loaders.install(
			config.loader,
			config.gameVersion,
			config.loaderVersion,
			(detail, fraction) => {
				this.progress(instanceId, "installing", detail, 0.1 + fraction * 0.5)
			},
		)

		if (config.loader === "vanilla") {
			await this.versions.install(config.gameVersion, (detail, fraction) => {
				this.progress(instanceId, "downloading", detail, 0.1 + fraction * 0.5)
			})
		}

		await this.prepareCompanion(instanceId, config.name, config.loader, config.gameVersion)

		const version = await this.versions.resolve(launchVersionId)

		this.progress(instanceId, "installing", "Extracting native libraries", 0.66)
		const gameDirectory = this.instances.gameDirectory(instanceId)
		const nativesDirectory = join(
			this.instances.directory(instanceId),
			"natives",
			launchVersionId,
		)
		await mkdir(gameDirectory, { recursive: true })
		await this.versions.extractNatives(version, nativesDirectory)
		const legacyAssetsDir = await this.versions.materialiseLegacyAssets(version, gameDirectory)

		this.progress(instanceId, "installing", "Selecting a Java runtime", 0.74)
		const runtime = await this.java.resolveForVersion(
			config.gameVersion,
			config.javaPath ?? settings.defaultJavaPath,
			true,
		)

		const moddedJar = this.versions.versionJarPath(launchVersionId)
		const clientJar = (await pathExists(moddedJar))
			? moddedJar
			: this.versions.versionJarPath(config.gameVersion)

		const session: LaunchSession = {
			username: account.nickname ?? account.username,
			uuid: account.uuid,
			accessToken: accessToken ?? "0",
			userType: userTypeFor(account.kind),
			clientId: "halcyon",
		}

		const loggingId = loggingConfigId(version)
		const invocation = buildLaunchInvocation({
			version,
			platform: this.platform,
			javaExecutable: runtime.path,
			paths: {
				gameDir: gameDirectory,
				assetsDir: this.paths.assets,
				librariesDir: this.paths.libraries,
				nativesDir: nativesDirectory,
				clientJar,
				legacyAssetsDir,
			},
			session,
			memory: { maxMb: config.memoryMb, minMb: Math.min(1024, config.memoryMb) },
			launcher: { name: "Halcyon", version: this.appVersion },
			extraJvmArgs: config.jvmArgs.split(/\s+/).filter((argument) => argument.length > 0),
			window: {
				width: config.window.width ?? undefined,
				height: config.window.height ?? undefined,
				fullscreen: config.window.fullscreen,
			},
			log4jConfigPath:
				loggingId === undefined
					? undefined
					: join(this.paths.assets, "log_configs", loggingId),
		})

		this.progress(instanceId, "launching", `Starting Minecraft ${config.gameVersion}`, 0.9)
		await this.logs.beginSession(
			instanceId,
			`Halcyon ${this.appVersion} launching ${config.name} (${launchVersionId}) with Java ${runtime.version}`,
		)

		const child = spawn(invocation.executable, [...invocation.args], {
			cwd: invocation.workingDirectory,
			env: { ...process.env, ...config.env },
			windowsHide: true,
			detached: false,
		})

		const startedAtMs = Date.now()
		this.running.set(instanceId, { child, startedAtMs })
		this.instances.setRunning(instanceId, true)
		await this.instances.markLaunched(instanceId)

		child.stdout?.setEncoding("utf8")
		child.stderr?.setEncoding("utf8")
		child.stdout?.on("data", (chunk: string) => {
			this.logs.append(instanceId, chunk, "info")
		})
		child.stderr?.on("data", (chunk: string) => {
			this.logs.append(instanceId, chunk, "error")
		})

		child.once("spawn", () => {
			this.progress(instanceId, "running", `${config.name} is running`, 1)
			void this.presence.setPlaying(config, startedAtMs)
		})

		child.once("error", (error: Error) => {
			this.logger.error(`The game process for ${config.name} failed to start`, error)
			this.progress(instanceId, "error", error.message, 1)
		})

		child.once("exit", (code, signal) => {
			void this.handleExit(instanceId, code, signal, startedAtMs)
		})

		this.logger.info(`Launched ${config.name} as ${session.username} (pid ${child.pid ?? 0})`)
		return { instanceId, started: true, pid: child.pid ?? null, message: null }
	}

	/**
	 * Instances that already exist pick up the companion mod here, because this
	 * runs on every launch rather than only when an instance is created. A
	 * failure is never fatal: the game still starts, only without the in game
	 * overlay and player badges.
	 */
	private async prepareCompanion(
		instanceId: string,
		name: string,
		loader: string,
		gameVersion: string,
	): Promise<void> {
		this.progress(instanceId, "installing", "Checking the Halcyon companion mod", 0.62)
		try {
			const outcome = await this.companion.ensure({
				id: instanceId,
				name,
				loader,
				gameVersion,
			})
			this.logger.info(outcome.detail)
		} catch (error) {
			this.logger.warn(`The companion mod could not be prepared for ${name}`, error)
		}
	}

	/**
	 * Copies the useful part of the crash report Minecraft just wrote into the
	 * instance log, so the reason for the crash is visible in the launcher
	 * instead of hidden in a file on disk.
	 */
	private async collectCrashReport(instanceId: string): Promise<string | null> {
		const directory = join(this.instances.gameDirectory(instanceId), "crash-reports")

		let entries: string[] = []
		try {
			entries = await readdir(directory)
		} catch {
			return null
		}

		let newestPath: string | null = null
		let newestAtMs = 0
		for (const name of entries) {
			if (!name.endsWith(".txt")) {
				continue
			}
			const candidate = join(directory, name)
			try {
				const info = await stat(candidate)
				if (info.mtimeMs > newestAtMs) {
					newestAtMs = info.mtimeMs
					newestPath = candidate
				}
			} catch {
				continue
			}
		}

		if (newestPath === null || Date.now() - newestAtMs > CRASH_REPORT_MAX_AGE_MS) {
			return null
		}

		let content = ""
		try {
			content = await readFile(newestPath, "utf8")
		} catch (error) {
			this.logger.warn(`The crash report at ${newestPath} could not be read`, error)
			return null
		}

		const excerpt = crashReportExcerpt(content)
		if (excerpt.length === 0) {
			return null
		}

		this.logs.append(
			instanceId,
			`\nMinecraft wrote a crash report to ${newestPath}\n${excerpt}\n`,
			"error",
		)
		this.logger.warn(`Crash report for ${instanceId}: ${excerpt}`)
		return crashHeadline(excerpt)
	}

	private async handleExit(
		instanceId: string,
		code: number | null,
		signal: NodeJS.Signals | null,
		startedAtMs: number,
	): Promise<void> {
		this.running.delete(instanceId)
		this.instances.setRunning(instanceId, false)
		void this.presence.clear()

		const minutes = (Date.now() - startedAtMs) / 60_000
		await this.instances.addPlaytime(instanceId, minutes)
		await this.statistics.record({
			instanceId,
			startedAt: new Date(startedAtMs).toISOString(),
			minutes,
		})

		const summary = summarizeExitCode(code, signal)
		this.progress(instanceId, "exited", summary, 1, code)

		if (code !== 0 && code !== null) {
			const headline = await this.collectCrashReport(instanceId)
			const diagnoses = await this.logs.analyze(instanceId)
			const first = diagnoses[0]
			this.events.toast(
				"error",
				first?.title ?? "Minecraft closed unexpectedly",
				first?.explanation ?? headline ?? summary,
			)
			this.logger.warn(`${summary} (instance ${instanceId})`)
			return
		}

		this.logger.info(`${summary} (instance ${instanceId})`)
	}

	async stop(instanceId: string): Promise<void> {
		const game = this.running.get(instanceId)
		if (game === undefined) {
			return
		}
		game.child.kill("SIGTERM")
		setTimeout(() => {
			if (this.running.has(instanceId)) {
				game.child.kill("SIGKILL")
			}
		}, 5_000)
	}

	stopAll(): void {
		for (const [, game] of this.running) {
			game.child.kill("SIGTERM")
		}
		this.running.clear()
	}
}
