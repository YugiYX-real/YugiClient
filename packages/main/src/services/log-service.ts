import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { analyzeCrash, extractCrashReportPath } from "@halcyon/core"
import type { CrashDiagnosisDto, LogBundle, LogLevel, LogLine, LogQuery } from "@halcyon/ipc"
import type { EventBus } from "../infra/events.ts"
import type { Logger } from "../infra/logger.ts"
import type { AppPaths } from "../infra/paths.ts"

export const MAX_BUFFERED_LINES = 4000

const MINECRAFT_LINE = /^\[(\d{2}:\d{2}:\d{2})\]\s*\[([^\]]+)\/([A-Z]+)\]:?\s*(.*)$/
const LAUNCHER_LINE = /^\[([^\]]+)\]\s+([A-Z]+)\s+([\w.-]+)\s*[:|-]\s*(.*)$/

function toLevel(token: string): LogLevel {
	switch (token.toUpperCase()) {
		case "TRACE":
			return "trace"
		case "DEBUG":
			return "debug"
		case "WARN":
		case "WARNING":
			return "warn"
		case "ERROR":
			return "error"
		case "FATAL":
			return "fatal"
		default:
			return "info"
	}
}

function inferLevel(message: string, fallback: LogLevel): LogLevel {
	if (/(^|\s)(Exception|Caused by:|\tat )/.test(message)) {
		return "error"
	}
	if (/\bERROR\b/.test(message)) {
		return "error"
	}
	if (/\bWARN(ING)?\b/.test(message)) {
		return "warn"
	}
	return fallback
}

export function parseGameLine(raw: string, fallback: LogLevel): LogLine {
	const minecraft = MINECRAFT_LINE.exec(raw)
	if (minecraft !== null) {
		return {
			timestamp: new Date().toISOString(),
			level: toLevel(minecraft[3] ?? "INFO"),
			scope: minecraft[2] ?? "game",
			message: minecraft[4] ?? "",
		}
	}

	return {
		timestamp: new Date().toISOString(),
		level: inferLevel(raw, fallback),
		scope: "game",
		message: raw,
	}
}

export function parseLauncherLine(raw: string): LogLine {
	const match = LAUNCHER_LINE.exec(raw)
	if (match !== null) {
		const timestamp = match[1] ?? ""
		const parsed = Date.parse(timestamp)
		return {
			timestamp: Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString(),
			level: toLevel(match[2] ?? "INFO"),
			scope: match[3] ?? "launcher",
			message: match[4] ?? "",
		}
	}

	return {
		timestamp: new Date().toISOString(),
		level: inferLevel(raw, "info"),
		scope: "launcher",
		message: raw,
	}
}

export class LogService {
	private readonly paths: AppPaths
	private readonly logger: Logger
	private readonly events: EventBus
	private readonly buffers = new Map<string, LogLine[]>()
	private readonly rawBuffers = new Map<string, string[]>()

	constructor(dependencies: { paths: AppPaths; logger: Logger; events: EventBus }) {
		this.paths = dependencies.paths
		this.logger = dependencies.logger
		this.events = dependencies.events
	}

	instanceLogFile(instanceId: string): string {
		return join(this.paths.logs, `instance-${instanceId}.log`)
	}

	async beginSession(instanceId: string, header: string): Promise<void> {
		this.buffers.set(instanceId, [])
		this.rawBuffers.set(instanceId, [])
		await mkdir(this.paths.logs, { recursive: true })
		await writeFile(this.instanceLogFile(instanceId), `${header}\n`, "utf8")
	}

	append(instanceId: string, chunk: string, fallback: LogLevel = "info"): void {
		const rawLines = chunk
			.split(/\r?\n/)
			.map((line) => line.trimEnd())
			.filter((line) => line.length > 0)
		if (rawLines.length === 0) {
			return
		}

		const parsed = rawLines.map((line) => parseGameLine(line, fallback))
		const buffer = this.buffers.get(instanceId) ?? []
		buffer.push(...parsed)
		if (buffer.length > MAX_BUFFERED_LINES) {
			buffer.splice(0, buffer.length - MAX_BUFFERED_LINES)
		}
		this.buffers.set(instanceId, buffer)

		const rawBuffer = this.rawBuffers.get(instanceId) ?? []
		rawBuffer.push(...rawLines)
		if (rawBuffer.length > MAX_BUFFERED_LINES) {
			rawBuffer.splice(0, rawBuffer.length - MAX_BUFFERED_LINES)
		}
		this.rawBuffers.set(instanceId, rawBuffer)

		void appendFile(this.instanceLogFile(instanceId), `${rawLines.join("\n")}\n`, "utf8").catch(
			(error: unknown) => {
				this.logger.debug("Could not persist game log lines", error)
			},
		)

		this.events.emit("logs:appended", { source: "instance", instanceId, lines: parsed })
	}

	raw(instanceId: string): string {
		const buffered = this.rawBuffers.get(instanceId)
		return buffered === undefined ? "" : buffered.join("\n")
	}

	private async launcherLines(): Promise<readonly LogLine[]> {
		try {
			const content = await readFile(this.paths.launcherLogFile, "utf8")
			return content
				.split(/\r?\n/)
				.filter((line) => line.trim().length > 0)
				.map((line) => parseLauncherLine(line))
		} catch {
			return []
		}
	}

	private async instanceLines(instanceId: string): Promise<readonly LogLine[]> {
		const buffered = this.buffers.get(instanceId)
		if (buffered !== undefined && buffered.length > 0) {
			return buffered
		}
		try {
			const content = await readFile(this.instanceLogFile(instanceId), "utf8")
			return content
				.split(/\r?\n/)
				.filter((line) => line.trim().length > 0)
				.map((line) => parseGameLine(line, "info"))
		} catch {
			return []
		}
	}

	async read(query: LogQuery): Promise<LogBundle> {
		const source = query.source
		const all =
			source === "launcher"
				? await this.launcherLines()
				: await this.instanceLines(query.instanceId ?? "")

		const search = query.search?.trim().toLowerCase() ?? ""
		const levels = query.levels
		const filtered = all
			.filter((line) => (levels === undefined ? true : levels.includes(line.level)))
			.filter((line) =>
				search === ""
					? true
					: line.message.toLowerCase().includes(search) ||
						line.scope.toLowerCase().includes(search),
			)

		const limit = query.limit ?? 1500
		const lines = filtered.slice(Math.max(0, filtered.length - limit))
		return { source, lines, truncated: lines.length < filtered.length }
	}

	async export(query: LogQuery): Promise<string> {
		const bundle = await this.read({ ...query, limit: MAX_BUFFERED_LINES })
		const stamp = new Date().toISOString().replace(/[:.]/g, "-")
		const target = join(this.paths.logs, `halcyon-${query.source}-${stamp}.log`)
		const body = bundle.lines
			.map((line) => `[${line.timestamp}] ${line.level.toUpperCase()} ${line.scope}: ${line.message}`)
			.join("\n")

		await mkdir(this.paths.logs, { recursive: true })
		await writeFile(target, `${body}\n`, "utf8")
		this.logger.info(`Exported ${bundle.lines.length} log lines to ${target}`)
		return target
	}

	async analyze(instanceId: string): Promise<readonly CrashDiagnosisDto[]> {
		let text = this.raw(instanceId)
		if (text === "") {
			try {
				text = await readFile(this.instanceLogFile(instanceId), "utf8")
			} catch {
				text = ""
			}
		}
		if (text === "") {
			return []
		}

		const crashReportPath = extractCrashReportPath(text) ?? null
		return analyzeCrash(text).map((diagnosis) => ({
			id: diagnosis.id,
			title: diagnosis.title,
			severity: diagnosis.severity,
			explanation: diagnosis.explanation,
			remedies: diagnosis.remedies,
			evidence: diagnosis.evidence,
			confidence: diagnosis.confidence,
			crashReportPath,
		}))
	}
}
