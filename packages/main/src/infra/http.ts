import { createHash } from "node:crypto"
import { createWriteStream } from "node:fs"
import { mkdir, rename, rm, stat } from "node:fs/promises"
import { dirname } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { Logger } from "./logger.ts"

export class HttpError extends Error {
	readonly status: number
	readonly url: string
	readonly details: string

	constructor(status: number, url: string, statusText: string, details = "") {
		const summary = `Request failed with ${status} ${statusText}: ${url}`
		super(details === "" ? summary : `${summary} - ${details}`)
		this.name = "HttpError"
		this.status = status
		this.url = url
		this.details = details
	}
}

export class ChecksumMismatchError extends Error {
	readonly expected: string
	readonly actual: string

	constructor(destination: string, expected: string, actual: string) {
		super(`Checksum mismatch for ${destination}`)
		this.name = "ChecksumMismatchError"
		this.expected = expected
		this.actual = actual
	}
}

export type RequestOptions = {
	readonly headers?: Readonly<Record<string, string>>
	readonly method?: "GET" | "POST" | "PUT" | "DELETE"
	readonly body?: string | Uint8Array
	readonly timeoutMs?: number
	readonly retries?: number
	readonly signal?: AbortSignal
	readonly acceptNotFound?: boolean
}

export type DownloadOptions = {
	readonly sha1?: string | null
	readonly expectedSize?: number | null
	readonly onProgress?: (receivedBytes: number, totalBytes: number) => void
	readonly signal?: AbortSignal
	readonly headers?: Readonly<Record<string, string>>
	readonly skipIfValid?: boolean
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])
const DETAIL_LIMIT = 400

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms)
	})
}

async function describeFailure(response: Response): Promise<string> {
	try {
		const body = await response.text()
		return body.trim().replace(/\s+/g, " ").slice(0, DETAIL_LIMIT)
	} catch {
		return ""
	}
}

export async function sha1OfFile(filePath: string): Promise<string> {
	const { createReadStream } = await import("node:fs")
	const hash = createHash("sha1")
	await pipeline(createReadStream(filePath), hash)
	return hash.digest("hex")
}

export class HttpClient {
	private readonly logger: Logger
	private readonly userAgent: string
	private readonly defaultTimeoutMs: number

	constructor(logger: Logger, userAgent: string, defaultTimeoutMs = 30_000) {
		this.logger = logger
		this.userAgent = userAgent
		this.defaultTimeoutMs = defaultTimeoutMs
	}

	async request(url: string, options: RequestOptions = {}): Promise<Response> {
		const retries = options.retries ?? 3
		let lastError: unknown

		for (let attempt = 1; attempt <= retries; attempt += 1) {
			const controller = new AbortController()
			const timeout = setTimeout(() => {
				controller.abort()
			}, options.timeoutMs ?? this.defaultTimeoutMs)

			const onExternalAbort = (): void => {
				controller.abort()
			}
			options.signal?.addEventListener("abort", onExternalAbort)

			try {
				const response = await fetch(url, {
					method: options.method ?? "GET",
					body: options.body,
					signal: controller.signal,
					headers: {
						"User-Agent": this.userAgent,
						...options.headers,
					},
				})

				if (response.ok) {
					return response
				}
				if (response.status === 404 && options.acceptNotFound === true) {
					return response
				}
				if (!RETRYABLE_STATUS.has(response.status) || attempt === retries) {
					throw new HttpError(
						response.status,
						url,
						response.statusText,
						await describeFailure(response),
					)
				}
				lastError = new HttpError(response.status, url, response.statusText)
			} catch (error) {
				lastError = error
				if (options.signal?.aborted === true || attempt === retries) {
					throw error
				}
			} finally {
				clearTimeout(timeout)
				options.signal?.removeEventListener("abort", onExternalAbort)
			}

			const backoff = Math.min(8_000, 500 * 2 ** (attempt - 1))
			this.logger.debug(`Retrying ${url} in ${backoff}ms`, { attempt })
			await delay(backoff)
		}

		throw lastError instanceof Error ? lastError : new Error(`Request failed: ${url}`)
	}

	async json<T>(url: string, options: RequestOptions = {}): Promise<T> {
		const response = await this.request(url, {
			...options,
			headers: { Accept: "application/json", ...options.headers },
		})
		return (await response.json()) as T
	}

	async text(url: string, options: RequestOptions = {}): Promise<string> {
		const response = await this.request(url, options)
		return response.text()
	}

	async bytes(url: string, options: RequestOptions = {}): Promise<Uint8Array> {
		const response = await this.request(url, options)
		return new Uint8Array(await response.arrayBuffer())
	}

	async download(
		url: string,
		destination: string,
		options: DownloadOptions = {},
	): Promise<number> {
		if (options.skipIfValid !== false && (await this.isValid(destination, options))) {
			const info = await stat(destination)
			options.onProgress?.(info.size, info.size)
			return info.size
		}

		await mkdir(dirname(destination), { recursive: true })
		const temporary = `${destination}.part`
		const response = await this.request(url, {
			headers: options.headers,
			signal: options.signal,
		})

		const declaredSize = Number(response.headers.get("content-length") ?? 0)
		const totalBytes = options.expectedSize ?? (declaredSize > 0 ? declaredSize : 0)
		const body = response.body
		if (body === null) {
			throw new Error(`Response for ${url} carried no body`)
		}

		const hash = createHash("sha1")
		let received = 0
		const source = Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0])
		source.on("data", (chunk: Buffer) => {
			received += chunk.byteLength
			hash.update(chunk)
			options.onProgress?.(received, totalBytes)
		})

		try {
			await pipeline(source, createWriteStream(temporary))
		} catch (error) {
			await rm(temporary, { force: true })
			throw error
		}

		const digest = hash.digest("hex")
		if (options.sha1 !== undefined && options.sha1 !== null && options.sha1 !== digest) {
			await rm(temporary, { force: true })
			throw new ChecksumMismatchError(destination, options.sha1, digest)
		}

		await rm(destination, { force: true })
		await rename(temporary, destination)
		return received
	}

	private async isValid(destination: string, options: DownloadOptions): Promise<boolean> {
		try {
			const info = await stat(destination)
			if (!info.isFile() || info.size === 0) {
				return false
			}
			if (options.expectedSize !== undefined && options.expectedSize !== null) {
				if (info.size !== options.expectedSize) {
					return false
				}
			}
			if (options.sha1 !== undefined && options.sha1 !== null) {
				return (await sha1OfFile(destination)) === options.sha1
			}
			return true
		} catch {
			return false
		}
	}
}
