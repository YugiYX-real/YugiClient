import { randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import type { SkinEntry, SkinModel, SkinUploadInput } from "@halcyon/ipc"
import type { EventBus } from "../infra/events.ts"
import type { HttpClient } from "../infra/http.ts"
import type { JsonStore } from "../infra/json-store.ts"
import type { Logger } from "../infra/logger.ts"
import { pathExists, removePath, sanitiseFileName } from "../infra/fs-extra.ts"
import type { AppPaths } from "../infra/paths.ts"
import type { AuthService } from "./auth-service.ts"

const SKIN_UPLOAD_URL = "https://api.minecraftservices.com/minecraft/profile/skins"

export type SkinState = { entries: SkinEntry[] }

export const DEFAULT_SKIN_STATE: SkinState = { entries: [] }

export class SkinService {
	private readonly store: JsonStore<SkinState>
	private readonly paths: AppPaths
	private readonly http: HttpClient
	private readonly auth: AuthService
	private readonly logger: Logger
	private readonly events: EventBus

	constructor(dependencies: {
		store: JsonStore<SkinState>
		paths: AppPaths
		http: HttpClient
		auth: AuthService
		logger: Logger
		events: EventBus
	}) {
		this.store = dependencies.store
		this.paths = dependencies.paths
		this.http = dependencies.http
		this.auth = dependencies.auth
		this.logger = dependencies.logger
		this.events = dependencies.events
	}

	private async dataUrl(filePath: string): Promise<string> {
		try {
			const bytes = await readFile(filePath)
			return `data:image/png;base64,${bytes.toString("base64")}`
		} catch {
			return ""
		}
	}

	async list(): Promise<readonly SkinEntry[]> {
		const { entries } = await this.store.read()
		const hydrated: SkinEntry[] = []
		for (const entry of entries) {
			if (!(await pathExists(entry.filePath))) {
				continue
			}
			hydrated.push({ ...entry, dataUrl: await this.dataUrl(entry.filePath) })
		}
		return hydrated.sort((left, right) =>
			left.favorite === right.favorite
				? right.createdAt.localeCompare(left.createdAt)
				: left.favorite
					? -1
					: 1,
		)
	}

	async upload(input: SkinUploadInput): Promise<SkinEntry> {
		const sourcePath = input.filePath
		if (sourcePath === undefined) {
			throw new Error("No skin file was selected")
		}

		const id = randomUUID()
		const name = input.name ?? basename(sourcePath).replace(/\.png$/i, "")
		const fileName = `${sanitiseFileName(name)}-${id.slice(0, 8)}.png`
		const filePath = join(this.paths.skins, fileName)

		await mkdir(this.paths.skins, { recursive: true })
		await writeFile(filePath, await readFile(sourcePath))

		const entry: SkinEntry = {
			id,
			name,
			filePath,
			dataUrl: await this.dataUrl(filePath),
			model: input.model,
			favorite: false,
			source: "upload",
			createdAt: new Date().toISOString(),
			appliedAt: null,
		}

		await this.store.update((current) => ({ entries: [...current.entries, entry] }))
		return entry
	}

	async downloadFromAccount(accountId: string): Promise<SkinEntry | undefined> {
		const accounts = await this.auth.list()
		const account = accounts.find((candidate) => candidate.id === accountId)
		if (account?.skinUrl === null || account?.skinUrl === undefined) {
			return undefined
		}

		const id = randomUUID()
		const fileName = `${sanitiseFileName(account.username)}-${id.slice(0, 8)}.png`
		const filePath = join(this.paths.skins, fileName)
		await this.http.download(account.skinUrl, filePath, { skipIfValid: false })

		const entry: SkinEntry = {
			id,
			name: `${account.username} skin`,
			filePath,
			dataUrl: await this.dataUrl(filePath),
			model: "classic",
			favorite: false,
			source: "account",
			createdAt: new Date().toISOString(),
			appliedAt: null,
		}

		await this.store.update((current) => ({ entries: [...current.entries, entry] }))
		return entry
	}

	async apply(accountId: string, skinId: string): Promise<SkinEntry> {
		const { entries } = await this.store.read()
		const entry = entries.find((candidate) => candidate.id === skinId)
		if (entry === undefined) {
			throw new Error(`Unknown skin "${skinId}"`)
		}

		const token = await this.auth.validAccessToken(accountId)
		if (token === null) {
			throw new Error("Applying a skin requires a signed-in Microsoft account")
		}

		const bytes = await readFile(entry.filePath)
		const form = new FormData()
		form.set("variant", entry.model === "slim" ? "slim" : "classic")
		form.set("file", new Blob([new Uint8Array(bytes)], { type: "image/png" }), basename(entry.filePath))

		const response = await fetch(SKIN_UPLOAD_URL, {
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
			body: form,
		})
		if (!response.ok) {
			throw new Error(`Minecraft rejected the skin upload (${response.status})`)
		}

		const applied: SkinEntry = { ...entry, appliedAt: new Date().toISOString() }
		await this.store.write({
			entries: entries.map((candidate) => (candidate.id === skinId ? applied : candidate)),
		})
		this.logger.info(`Applied skin ${entry.name}`)
		this.events.toast("success", `Applied ${entry.name}`)
		return applied
	}

	async setFavorite(skinId: string, favorite: boolean): Promise<readonly SkinEntry[]> {
		await this.store.update((current) => ({
			entries: current.entries.map((entry) =>
				entry.id === skinId ? { ...entry, favorite } : entry,
			),
		}))
		return this.list()
	}

	async setModel(skinId: string, model: SkinModel): Promise<readonly SkinEntry[]> {
		await this.store.update((current) => ({
			entries: current.entries.map((entry) => (entry.id === skinId ? { ...entry, model } : entry)),
		}))
		return this.list()
	}

	async remove(skinId: string): Promise<readonly SkinEntry[]> {
		const { entries } = await this.store.read()
		const entry = entries.find((candidate) => candidate.id === skinId)
		if (entry !== undefined) {
			await removePath(entry.filePath)
		}
		await this.store.write({ entries: entries.filter((candidate) => candidate.id !== skinId) })
		return this.list()
	}
}
