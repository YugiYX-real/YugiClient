import type { CosmeticEntry, CosmeticWardrobe } from "@halcyon/ipc"
import type { Logger } from "../infra/logger.ts"
import type { AuthService, StoredAccount } from "./auth-service.ts"
import type { CompanionService } from "./companion-service.ts"

const TIMEOUT_MS = 8000
const SESSION_COOKIE = "halcyon_session"

type RemoteCosmetic = {
	readonly id?: unknown
	readonly name?: unknown
	readonly description?: unknown
	readonly rarity?: unknown
	readonly texture?: unknown
	readonly type?: unknown
	readonly slot?: unknown
	readonly animated?: unknown
}

type CosmeticListPayload = { readonly cosmetics?: unknown }

type PlayerPayload = {
	readonly owned?: unknown
	readonly equipped?: Record<string, unknown> | null
	readonly cape?: unknown
	readonly cosmetics?: unknown
}

type SignInPayload = {
	readonly token?: unknown
	readonly user?: { readonly username?: unknown } | null
}

type Answer<T> = {
	readonly ok: boolean
	readonly status: number
	readonly data: T | null
	readonly error: string
}

function text(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback
}

function stringList(value: unknown): readonly string[] {
	if (!Array.isArray(value)) {
		return []
	}
	return value.filter((entry): entry is string => typeof entry === "string")
}

function records(value: unknown): readonly RemoteCosmetic[] {
	if (!Array.isArray(value)) {
		return []
	}
	return value.filter(
		(entry): entry is RemoteCosmetic => typeof entry === "object" && entry !== null,
	)
}

/**
 * The launcher side of the cosmetics service.
 *
 * Two things make this more than a thin http wrapper. Textures are fetched here and handed to the
 * renderer as data urls, because the window only loads images from itself, data and https, and the
 * backend still answers on plain http. And who the player is never comes from the body of a
 * request: the Minecraft token the launcher already holds is sent instead, and the server asks
 * Mojang. That works on a fresh install, where there is no website account to sign in to yet.
 */
export class CosmeticsService {
	private readonly auth: AuthService
	private readonly companion: CompanionService
	private readonly logger: Logger
	private readonly textures = new Map<string, string>()
	private session: string | null = null
	private sessionOwner: string | null = null

	constructor(dependencies: {
		auth: AuthService
		companion: CompanionService
		logger: Logger
	}) {
		this.auth = dependencies.auth
		this.companion = dependencies.companion
		this.logger = dependencies.logger
	}

	/** The address the companion mod also talks to, so both always agree. */
	backendUrl(): string {
		return this.companion.backendUrl()
	}

	private address(path: string): string {
		return path.startsWith("http") ? path : this.backendUrl() + path
	}

	private async call<T>(path: string, init: RequestInit): Promise<Answer<T>> {
		try {
			const response = await fetch(this.address(path), {
				...init,
				signal: AbortSignal.timeout(TIMEOUT_MS),
			})
			const body: unknown = await response.json().catch(() => null)
			const error =
				typeof body === "object" && body !== null
					? text((body as { error?: unknown }).error)
					: ""
			return {
				ok: response.ok,
				status: response.status,
				data: response.ok ? (body as T) : null,
				error,
			}
		} catch (error) {
			this.logger.warn(`The cosmetics backend could not be reached at ${path}`, error)
			return { ok: false, status: 0, data: null, error: "" }
		}
	}

	/** Fetches a texture once and keeps it as a data url the window is allowed to draw. */
	private async texture(path: string): Promise<string> {
		const cached = this.textures.get(path)
		if (cached !== undefined) {
			return cached
		}

		try {
			const response = await fetch(this.address(path), {
				signal: AbortSignal.timeout(TIMEOUT_MS),
			})
			if (!response.ok) {
				return ""
			}
			const bytes = Buffer.from(await response.arrayBuffer())
			const inlined = `data:image/png;base64,${bytes.toString("base64")}`
			this.textures.set(path, inlined)
			return inlined
		} catch (error) {
			this.logger.debug(`The texture ${path} could not be downloaded`, error)
			return ""
		}
	}

	private async decorate(
		entries: readonly RemoteCosmetic[],
		owned: ReadonlySet<string>,
	): Promise<readonly CosmeticEntry[]> {
		const result: CosmeticEntry[] = []
		for (const entry of entries) {
			const id = text(entry.id)
			if (id === "") {
				continue
			}
			const path = text(entry.texture, `/v1/cosmetics/textures/${id}.png`)
			result.push({
				id,
				name: text(entry.name, id),
				description: text(entry.description),
				rarity: text(entry.rarity, "common"),
				textureUrl: await this.texture(path),
				owned: owned.has(id),
			})
		}
		return result
	}

	private empty(message: string, playerName: string | null): CosmeticWardrobe {
		return {
			backendUrl: this.backendUrl(),
			playerName,
			signedIn: this.session !== null,
			equipped: null,
			cosmetics: [],
			message,
		}
	}

	/** What the player is wearing, across the old cape only shape and the newer slots. */
	private static wearing(payload: PlayerPayload | null): string | null {
		const slots = payload?.equipped ?? {}
		for (const value of Object.values(slots)) {
			if (typeof value === "string" && value !== "") {
				return value
			}
		}
		const legacy = text(payload?.cape)
		return legacy === "" ? null : legacy
	}

	/** Everything the wardrobe page shows: the catalogue, what is owned and what is worn. */
	async load(): Promise<CosmeticWardrobe> {
		const account = await this.auth.selected()
		if (account === undefined) {
			return this.empty("Sign in with a Microsoft account to see your cosmetics.", null)
		}

		const catalogue = await this.call<CosmeticListPayload>("/v1/cosmetics", { method: "GET" })
		if (!catalogue.ok) {
			return this.empty(
				`Halcyon could not reach the cosmetics server at ${this.backendUrl()}.`,
				account.username,
			)
		}

		const mine = await this.call<PlayerPayload>(
			`/v1/cosmetics/player/${encodeURIComponent(account.username)}`,
			{ method: "GET" },
		)
		const owned = new Set(stringList(mine.data?.owned))
		const equipped = CosmeticsService.wearing(mine.data)
		const cosmetics = await this.decorate(records(catalogue.data?.cosmetics), owned)
		const ownedCount = cosmetics.filter((entry) => entry.owned).length

		return {
			backendUrl: this.backendUrl(),
			playerName: account.username,
			signedIn: this.session !== null,
			equipped,
			cosmetics,
			message: ownedCount === 0 ? "No cosmetics have been given to this account yet." : "",
		}
	}

	/**
	 * Trades the Minecraft token for a backend session. The token is only used to prove ownership
	 * of the account and is never stored on the server.
	 */
	private async ensureSession(account: StoredAccount): Promise<string | null> {
		if (this.session !== null && this.sessionOwner === account.uuid) {
			return this.session
		}

		const accessToken = await this.auth.validAccessToken(account.id)
		if (accessToken === null) {
			return null
		}

		const result = await this.call<SignInPayload>("/v1/auth/minecraft", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ accessToken }),
		})

		const token = text(result.data?.token)
		if (!result.ok || token === "") {
			this.logger.warn(
				`The backend refused the Minecraft sign in with ${result.status} ${result.error}`,
			)
			return null
		}

		this.session = token
		this.sessionOwner = account.uuid
		this.logger.info(`Linked ${account.username} to the Halcyon backend`)
		return token
	}

	/** Signs the selected Minecraft account in to the backend and links it to a web account. */
	async link(): Promise<CosmeticWardrobe> {
		const account = await this.auth.selected()
		if (account === undefined) {
			throw new Error("Sign in with a Microsoft account first")
		}

		const session = await this.ensureSession(account)
		if (session === null) {
			throw new Error(
				`The backend at ${this.backendUrl()} did not accept this Minecraft session. Make sure it is running the newest build.`,
			)
		}
		return this.load()
	}

	/**
	 * Puts a cosmetic on, or takes it off when the id is null.
	 *
	 * The Minecraft token travels with the request, so this works whether or not a website session
	 * could be obtained first. A session cookie is sent as well when there is one, which is what an
	 * older backend understands.
	 */
	async equip(cosmeticId: string | null): Promise<CosmeticWardrobe> {
		const account = await this.auth.selected()
		if (account === undefined) {
			throw new Error("Sign in with a Microsoft account first")
		}

		const accessToken = await this.auth.validAccessToken(account.id)
		if (accessToken === null) {
			throw new Error(
				"This Minecraft session has expired. Open Accounts and sign in to it again.",
			)
		}

		const session = await this.ensureSession(account)
		const headers: Record<string, string> = { "content-type": "application/json" }
		if (session !== null) {
			headers.cookie = `${SESSION_COOKIE}=${session}`
		}

		const result = await this.call("/v1/cosmetics/equip", {
			method: "POST",
			headers,
			body: JSON.stringify({ name: account.username, id: cosmeticId, accessToken }),
		})

		if (!result.ok) {
			throw new Error(
				result.error === ""
					? `The cosmetics server at ${this.backendUrl()} could not be reached`
					: result.error,
			)
		}
		return this.load()
	}

	/** A one time link that opens the website already signed in as this player. */
	async handoffUrl(): Promise<string | null> {
		const account = await this.auth.selected()
		if (account === undefined) {
			return null
		}

		const session = await this.ensureSession(account)
		if (session === null) {
			return null
		}
		return `${this.backendUrl()}/v1/auth/handoff?token=${encodeURIComponent(session)}`
	}
}
