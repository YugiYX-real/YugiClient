import { createHash, randomUUID } from "node:crypto"
import { shell } from "electron"
import type { Account, AccountPatch } from "@halcyon/ipc"
import type { EventBus } from "../infra/events.ts"
import type { HttpClient } from "../infra/http.ts"
import type { JsonStore } from "../infra/json-store.ts"
import type { Logger } from "../infra/logger.ts"

const DEVICE_CODE_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode"
const TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"
const XBL_URL = "https://user.auth.xboxlive.com/user/authenticate"
const XSTS_URL = "https://xsts.auth.xboxlive.com/xsts/authorize"
const MINECRAFT_LOGIN_URL = "https://api.minecraftservices.com/authentication/login_with_xbox"
const MINECRAFT_PROFILE_URL = "https://api.minecraftservices.com/minecraft/profile"
const AVATAR_BASE_URL = "https://crafatar.com/avatars/"
const SCOPE = "XboxLive.signin offline_access"

export const FALLBACK_CLIENT_ID = "00000000402b5328"

export type StoredAccount = Account & {
	readonly accessToken: string | null
	readonly refreshToken: string | null
}

export type AccountState = { accounts: StoredAccount[] }

export const DEFAULT_ACCOUNT_STATE: AccountState = { accounts: [] }

type DeviceCodeResponse = {
	readonly device_code: string
	readonly user_code: string
	readonly verification_uri: string
	readonly interval: number
	readonly expires_in: number
}

type TokenResponse = {
	readonly access_token: string
	readonly refresh_token?: string
	readonly expires_in: number
}

type XboxResponse = {
	readonly Token: string
	readonly DisplayClaims: {
		readonly xui: readonly { readonly uhs: string; readonly xid?: string }[]
	}
}

type MinecraftLoginResponse = {
	readonly access_token: string
	readonly expires_in: number
}

type MinecraftProfile = {
	readonly id: string
	readonly name: string
	readonly skins?: readonly {
		readonly url: string
		readonly state: string
		readonly variant?: string
	}[]
	readonly capes?: readonly { readonly url: string; readonly state: string }[]
}

function offlineUuid(username: string): string {
	const hash = createHash("md5").update(`OfflinePlayer:${username}`).digest()
	const bytes = Uint8Array.from(hash)
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x30
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
	const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")
	return [
		hex.slice(0, 8),
		hex.slice(8, 12),
		hex.slice(12, 16),
		hex.slice(16, 20),
		hex.slice(20),
	].join("-")
}

function avatarFor(uuid: string): string {
	const trimmed = uuid.split("-").join("")
	return AVATAR_BASE_URL + trimmed + "?size=64&overlay"
}

function publish(account: StoredAccount): Account {
	return {
		id: account.id,
		kind: account.kind,
		username: account.username,
		uuid: account.uuid,
		nickname: account.nickname,
		favorite: account.favorite,
		selected: account.selected,
		avatarUrl: account.avatarUrl,
		skinUrl: account.skinUrl,
		capes: account.capes,
		expiresAt: account.expiresAt,
		lastUsedAt: account.lastUsedAt,
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms)
	})
}

export class AuthService {
	private readonly store: JsonStore<AccountState>
	private readonly http: HttpClient
	private readonly logger: Logger
	private readonly events: EventBus

	constructor(dependencies: {
		store: JsonStore<AccountState>
		http: HttpClient
		logger: Logger
		events: EventBus
	}) {
		this.store = dependencies.store
		this.http = dependencies.http
		this.logger = dependencies.logger
		this.events = dependencies.events
	}

	private clientId(): string {
		const configured = process.env.HALCYON_MSA_CLIENT_ID
		return configured === undefined || configured === "" ? FALLBACK_CLIENT_ID : configured
	}

	async list(): Promise<readonly Account[]> {
		const { accounts } = await this.store.read()
		return accounts
			.map(publish)
			.sort((left, right) =>
				left.favorite === right.favorite
					? (right.lastUsedAt ?? "").localeCompare(left.lastUsedAt ?? "")
					: left.favorite
						? -1
						: 1,
			)
	}

	async selected(): Promise<StoredAccount | undefined> {
		const { accounts } = await this.store.read()
		return accounts.find((account) => account.selected) ?? accounts[0]
	}

	private async persist(accounts: readonly StoredAccount[]): Promise<readonly Account[]> {
		await this.store.write({ accounts: [...accounts] })
		const published = accounts.map(publish)
		this.events.emit("accounts:changed", { accounts: published })
		return published
	}

	async addOffline(username: string): Promise<Account> {
		const trimmed = username.trim()
		if (!/^[A-Za-z0-9_]{3,16}$/.test(trimmed)) {
			throw new Error("Offline usernames must be 3-16 letters, digits or underscores")
		}

		const { accounts } = await this.store.read()
		if (
			accounts.some((account) => account.kind === "offline" && account.username === trimmed)
		) {
			throw new Error(`An offline account named ${trimmed} already exists`)
		}

		const uuid = offlineUuid(trimmed)
		const account: StoredAccount = {
			id: randomUUID(),
			kind: "offline",
			username: trimmed,
			uuid,
			nickname: null,
			favorite: false,
			selected: accounts.length === 0,
			avatarUrl: avatarFor(uuid),
			skinUrl: null,
			capes: [],
			expiresAt: null,
			lastUsedAt: null,
			accessToken: null,
			refreshToken: null,
		}

		await this.persist([...accounts, account])
		this.logger.info(`Added the offline account ${trimmed}`)
		return publish(account)
	}

	async loginMicrosoft(): Promise<Account> {
		const clientId = this.clientId()
		const device = await this.http.json<DeviceCodeResponse>(DEVICE_CODE_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ client_id: clientId, scope: SCOPE }).toString(),
			retries: 2,
		})

		this.events.toast(
			"info",
			`Enter the code ${device.user_code} to finish signing in`,
			`Your browser opened ${device.verification_uri}`,
		)
		await shell.openExternal(device.verification_uri)

		const deadline = Date.now() + device.expires_in * 1000
		let tokens: TokenResponse | undefined

		while (Date.now() < deadline && tokens === undefined) {
			await delay(Math.max(1, device.interval) * 1000)

			const response = await this.http
				.request(TOKEN_URL, {
					method: "POST",
					headers: {
						"Content-Type": "application/x-www-form-urlencoded",
						Accept: "application/json",
					},
					body: new URLSearchParams({
						client_id: clientId,
						grant_type: "urn:ietf:params:oauth:grant-type:device_code",
						device_code: device.device_code,
					}).toString(),
					retries: 1,
				})
				.catch((error: unknown) => {
					this.logger.debug("Device code poll rejected", error)
					return undefined
				})

			if (response === undefined) {
				continue
			}

			const payload = (await response.json().catch(() => ({}))) as TokenResponse & {
				error?: string
			}

			if (response.ok && payload.access_token !== undefined) {
				tokens = payload
				break
			}
			if (payload.error === "authorization_pending" || payload.error === undefined) {
				continue
			}
			if (payload.error === "slow_down") {
				await delay(5_000)
				continue
			}
			throw new Error(`Microsoft sign-in failed: ${payload.error}`)
		}

		if (tokens === undefined) {
			throw new Error("Microsoft sign-in timed out before it was approved")
		}

		return this.completeMicrosoftLogin(tokens)
	}

	private async completeMicrosoftLogin(tokens: TokenResponse): Promise<Account> {
		const xbl = await this.http.json<XboxResponse>(XBL_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify({
				Properties: {
					AuthMethod: "RPS",
					SiteName: "user.auth.xboxlive.com",
					RpsTicket: `d=${tokens.access_token}`,
				},
				RelyingParty: "http://auth.xboxlive.com",
				TokenType: "JWT",
			}),
		})

		const userHash = xbl.DisplayClaims.xui[0]?.uhs
		if (userHash === undefined) {
			throw new Error("Xbox Live did not return a user hash")
		}

		const xsts = await this.http.json<XboxResponse>(XSTS_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify({
				Properties: { SandboxId: "RETAIL", UserTokens: [xbl.Token] },
				RelyingParty: "rp://api.minecraftservices.com/",
				TokenType: "JWT",
			}),
		})

		const minecraft = await this.http.json<MinecraftLoginResponse>(MINECRAFT_LOGIN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify({ identityToken: `XBL3.0 x=${userHash};${xsts.Token}` }),
		})

		const profile = await this.http.json<MinecraftProfile>(MINECRAFT_PROFILE_URL, {
			headers: { Authorization: `Bearer ${minecraft.access_token}` },
		})

		const { accounts } = await this.store.read()
		const existing = accounts.find(
			(account) => account.kind === "microsoft" && account.uuid === profile.id,
		)

		const account: StoredAccount = {
			id: existing?.id ?? randomUUID(),
			kind: "microsoft",
			username: profile.name,
			uuid: profile.id,
			nickname: existing?.nickname ?? null,
			favorite: existing?.favorite ?? false,
			selected: true,
			avatarUrl: avatarFor(profile.id),
			skinUrl: profile.skins?.find((skin) => skin.state === "ACTIVE")?.url ?? null,
			capes: (profile.capes ?? []).map((cape) => cape.url),
			expiresAt: new Date(Date.now() + minecraft.expires_in * 1000).toISOString(),
			lastUsedAt: new Date().toISOString(),
			accessToken: minecraft.access_token,
			refreshToken: tokens.refresh_token ?? existing?.refreshToken ?? null,
		}

		const next = [
			...accounts
				.filter((candidate) => candidate.id !== account.id)
				.map((candidate) => ({ ...candidate, selected: false })),
			account,
		]

		await this.persist(next)
		this.logger.info(`Signed in as ${account.username}`)
		return publish(account)
	}

	async refresh(accountId: string): Promise<Account> {
		const { accounts } = await this.store.read()
		const account = accounts.find((candidate) => candidate.id === accountId)
		if (account === undefined) {
			throw new Error(`Unknown account "${accountId}"`)
		}
		if (account.kind === "offline") {
			return publish(account)
		}

		const refreshToken = account.refreshToken
		if (refreshToken === null) {
			throw new Error("This account has no refresh token; sign in again")
		}

		const tokens = await this.http.json<TokenResponse>(TOKEN_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
			},
			body: new URLSearchParams({
				client_id: this.clientId(),
				grant_type: "refresh_token",
				refresh_token: refreshToken,
				scope: SCOPE,
			}).toString(),
		})

		return this.completeMicrosoftLogin(tokens)
	}

	async validAccessToken(accountId: string): Promise<string | null> {
		const { accounts } = await this.store.read()
		const account = accounts.find((candidate) => candidate.id === accountId)
		if (account === undefined || account.kind === "offline") {
			return null
		}

		const expiresAt = account.expiresAt === null ? 0 : Date.parse(account.expiresAt)
		if (account.accessToken !== null && expiresAt - Date.now() > 60_000) {
			return account.accessToken
		}

		await this.refresh(accountId)
		const refreshed = (await this.store.read()).accounts.find(
			(candidate) => candidate.id === accountId,
		)
		return refreshed?.accessToken ?? null
	}

	async select(accountId: string): Promise<readonly Account[]> {
		const { accounts } = await this.store.read()
		return this.persist(
			accounts.map((account) => ({
				...account,
				selected: account.id === accountId,
				lastUsedAt:
					account.id === accountId ? new Date().toISOString() : account.lastUsedAt,
			})),
		)
	}

	async update(accountId: string, patch: AccountPatch): Promise<readonly Account[]> {
		const { accounts } = await this.store.read()
		return this.persist(
			accounts.map((account) =>
				account.id === accountId ? { ...account, ...patch } : account,
			),
		)
	}

	async remove(accountId: string): Promise<readonly Account[]> {
		const { accounts } = await this.store.read()
		const remaining = accounts.filter((account) => account.id !== accountId)

		if (remaining.length > 0 && !remaining.some((account) => account.selected)) {
			const first = remaining[0]
			if (first !== undefined) {
				remaining[0] = { ...first, selected: true }
			}
		}

		this.logger.info(`Removed the account ${accountId}`)
		return this.persist(remaining)
	}

	async exportAccounts(): Promise<string> {
		const { accounts } = await this.store.read()
		return JSON.stringify(
			accounts.map((account) => ({
				kind: account.kind,
				username: account.username,
				uuid: account.uuid,
				nickname: account.nickname,
				favorite: account.favorite,
			})),
			null,
			"\t",
		)
	}

	async importAccounts(payload: string): Promise<readonly Account[]> {
		type Portable = {
			kind?: string
			username?: string
			uuid?: string
			nickname?: string | null
			favorite?: boolean
		}

		const parsed = JSON.parse(payload) as readonly Portable[]
		const { accounts } = await this.store.read()
		const imported: StoredAccount[] = []

		for (const entry of parsed) {
			const username = entry.username
			if (
				username === undefined ||
				accounts.some((account) => account.username === username)
			) {
				continue
			}
			const uuid = entry.uuid ?? offlineUuid(username)
			imported.push({
				id: randomUUID(),
				kind: entry.kind === "microsoft" ? "microsoft" : "offline",
				username,
				uuid,
				nickname: entry.nickname ?? null,
				favorite: entry.favorite ?? false,
				selected: false,
				avatarUrl: avatarFor(uuid),
				skinUrl: null,
				capes: [],
				expiresAt: null,
				lastUsedAt: null,
				accessToken: null,
				refreshToken: null,
			})
		}

		this.logger.info(`Imported ${imported.length} account(s)`)
		return this.persist([...accounts, ...imported])
	}
}
