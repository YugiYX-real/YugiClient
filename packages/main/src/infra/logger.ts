import { appendFile, mkdir, rename, stat } from "node:fs/promises"
import { dirname } from "node:path"
import type { LogLevel, LogLine } from "@halcyon/ipc"

const LEVEL_WEIGHT: Record<LogLevel, number> = {
	trace: 10,
	debug: 20,
	info: 30,
	warn: 40,
	error: 50,
	fatal: 60,
}

const MAX_BUFFERED_LINES = 4000
const MAX_FILE_BYTES = 5 * 1024 * 1024

export type LogSink = (lines: readonly LogLine[]) => void

export type Logger = {
	child(scope: string): Logger
	trace(message: string, detail?: unknown): void
	debug(message: string, detail?: unknown): void
	info(message: string, detail?: unknown): void
	warn(message: string, detail?: unknown): void
	error(message: string, detail?: unknown): void
	fatal(message: string, detail?: unknown): void
}

function describe(detail: unknown): string {
	if (detail === undefined) {
		return ""
	}
	if (detail instanceof Error) {
		return ` ${detail.name}: ${detail.message}`
	}
	if (typeof detail === "string") {
		return ` ${detail}`
	}
	try {
		return ` ${JSON.stringify(detail)}`
	} catch {
		return " [unserialisable detail]"
	}
}

export class LauncherLog {
	private readonly buffer: LogLine[] = []
	private readonly sinks = new Set<LogSink>()
	private readonly filePath: string
	private minimumLevel: LogLevel
	private writing: Promise<void> = Promise.resolve()

	constructor(filePath: string, minimumLevel: LogLevel = "debug") {
		this.filePath = filePath
		this.minimumLevel = minimumLevel
	}

	setLevel(level: LogLevel): void {
		this.minimumLevel = level
	}

	subscribe(sink: LogSink): () => void {
		this.sinks.add(sink)
		return () => {
			this.sinks.delete(sink)
		}
	}

	lines(): readonly LogLine[] {
		return [...this.buffer]
	}

	logger(scope: string): Logger {
		const write = (level: LogLevel, message: string, detail?: unknown): void => {
			this.write(level, scope, `${message}${describe(detail)}`)
		}
		return {
			child: (childScope) => this.logger(`${scope}/${childScope}`),
			trace: (message, detail) => write("trace", message, detail),
			debug: (message, detail) => write("debug", message, detail),
			info: (message, detail) => write("info", message, detail),
			warn: (message, detail) => write("warn", message, detail),
			error: (message, detail) => write("error", message, detail),
			fatal: (message, detail) => write("fatal", message, detail),
		}
	}

	write(level: LogLevel, scope: string, message: string): void {
		if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.minimumLevel]) {
			return
		}

		const line: LogLine = {
			timestamp: new Date().toISOString(),
			level,
			scope,
			message,
		}

		this.buffer.push(line)
		if (this.buffer.length > MAX_BUFFERED_LINES) {
			this.buffer.splice(0, this.buffer.length - MAX_BUFFERED_LINES)
		}

		for (const sink of this.sinks) {
			sink([line])
		}

		this.enqueue(line)
	}

	private enqueue(line: LogLine): void {
		const serialised = `${line.timestamp} ${line.level.toUpperCase().padEnd(5)} [${line.scope}] ${line.message}\n`
		this.writing = this.writing
			.then(async () => {
				await mkdir(dirname(this.filePath), { recursive: true })
				await this.rotateIfNeeded()
				await appendFile(this.filePath, serialised, "utf8")
			})
			.catch(() => undefined)
	}

	private async rotateIfNeeded(): Promise<void> {
		try {
			const info = await stat(this.filePath)
			if (info.size > MAX_FILE_BYTES) {
				await rename(this.filePath, `${this.filePath}.1`)
			}
		} catch {
			return
		}
	}

	async flush(): Promise<void> {
		await this.writing
	}
}
