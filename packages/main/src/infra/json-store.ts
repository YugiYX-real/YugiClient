import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export type JsonStoreOptions<T> = {
	readonly filePath: string
	readonly defaults: T
	readonly migrate?: (raw: unknown) => T
	readonly onError?: (error: unknown) => void
}

export class JsonStore<T> {
	private readonly filePath: string
	private readonly defaults: T
	private readonly migrate: (raw: unknown) => T
	private readonly onError: (error: unknown) => void
	private cache: T | undefined
	private writing: Promise<void> = Promise.resolve()

	constructor(options: JsonStoreOptions<T>) {
		this.filePath = options.filePath
		this.defaults = options.defaults
		this.migrate = options.migrate ?? ((raw) => raw as T)
		this.onError = options.onError ?? (() => undefined)
	}

	async read(): Promise<T> {
		if (this.cache !== undefined) {
			return this.cache
		}
		try {
			const content = await readFile(this.filePath, "utf8")
			const parsed: unknown = JSON.parse(content)
			this.cache = this.migrate(parsed)
		} catch (error) {
			const code = (error as { code?: string }).code
			if (code !== "ENOENT") {
				this.onError(error)
			}
			this.cache = this.defaults
		}
		return this.cache
	}

	async write(value: T): Promise<T> {
		this.cache = value
		const serialised = `${JSON.stringify(value, null, "\t")}\n`
		const target = this.filePath
		this.writing = this.writing.then(async () => {
			await mkdir(dirname(target), { recursive: true })
			const temporary = `${target}.tmp`
			await writeFile(temporary, serialised, "utf8")
			await rename(temporary, target)
		})
		try {
			await this.writing
		} catch (error) {
			this.onError(error)
		}
		return value
	}

	async update(updater: (current: T) => T): Promise<T> {
		const current = await this.read()
		return this.write(updater(current))
	}
}
