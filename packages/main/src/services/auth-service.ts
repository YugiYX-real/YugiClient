import { randomUUID } from "node:crypto"
import { shell } from "electron"
import type { Account, AccountPatch } from "@halcyon/ipc"
import type { EventBus } from "../infra/events.ts"
import type { HttpClient } from "../infra/http.ts"
import type { JsonStore } from "../infra/json-store.ts"
import type { Logger } from "../infra/logger.ts"
import {
	exchangeLiveCode,
	refreshLiveTokens,
	requestLiveAuthorizationCode,
} from "./msa-live-auth.ts"

const DEVICE_CODE_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode"
const TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"
const XBL_URL = "https://user.auth.xboxlive.com/user/authenticate"
const XSTS_URL = "https://xsts.auth.xboxlive.com/xsts/authorize"
const MINECRAFT_LOGIN_URL = "https://api.minecraftservices.com/authentication/login_with_xbox"
const MINECRAFT_PROFILE_URL = "https://api.minecraftservices.com/minecraft/profile"
const AVATAR_BASE_URL = "https://crafatar.com/avatars/"
const SCOPE = "XboxLive.signin offline_access"
const AZURE_CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const FALLBACK_CLIENT_ID = "00000000402b5328"

export type AuthFlow = "device" | "live"

export type StoredAccount = Account & {
	readonly accessToken: string | null
	readonly refreshToken: string | null
	readonly authFlow?: AuthFlow
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

function microsoftAccounts(accounts: readonly StoredAccount[]): StoredAccount[] {
	return accounts.filter((account) => account.kind === "microsoft")
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

	private configuredClientId(): string {
		const configured = process.env.HALCYON_MSA_CLIENT_ID
		return configured === undefined ? "" : configured.trim()
	}

	private clientId(): string {
		const configured = this.configuredClientId()
		return configured === "" ? FALLBACK_CLIENT_ID : configured
	}

	private flow(): AuthFlow {
		return AZURE_CLIENT_ID.test(this.configuredClientId()) ? "device" : "live"
	}

	async list(): Promise<readonly Account[]> {
		const { accounts } = await this.store.read()
		return microsoftAccounts(accounts)
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
		const supported = microsoftAccounts(accounts)
		return supported.find((account) => account.selected) ?? supported[0]
	}

	private async persist(accounts: readonly StoredAccount[]): Promise<readonly Account[]> {
		const supported = microsoftAccounts(accounts)
		await this.store.write({ accounts: supported })
		const published = supported.map(publish)
		this.events.emit("accounts:changed", { accounts: published })
		return published
	}

	async addOffline(username: string): Promise<Account> {
		void username
		throw new Error("Offline accounts are not supported. Sign in with Microsoft instead.")
	}

	async loginMicrosoft(): Promise<Account> {
		const configured = this.configuredClientId()
		if (configured !== "" && !AZURE_CLIENT_ID.test(configured)) {
			throw new Error(
				"HALCYON_MSA_CLIENT_ID must be the Application (client) ID of your Azure app, written as a UUID. Unset it to use the built-in sign-in instead.",
			)
		}

		if (this.flow() === "device") {
			return this.loginWithDeviceCode(configured)
		}
		return this.loginWithSignInWindow()
	}

	private async loginWithSignInWindow(): Promise<Account> {
		this.events.toast(
			"info",
			"Sign in to your Microsoft account",
			"A secure Microsoft window just opened",
		)

		const code = await requestLiveAuthorizationCode(FALLBACK_CLIENT_ID)
		const tokens = await exchangeLiveCode(this.http, FALLBACK_CLIENT_ID, code)
		return this.completeMicrosoftLogin(tokens, "live")
	}

	private async loginWithDeviceCode(clientId: string): Promise<Account> {
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

		return this.completeMicrosoftLogin(tokens, "device")
	}

	private async completeMicrosoftLogin(
		tokens: TokenResponse,
		authFlow: AuthFlow,
	): Promise<Account> {
		// Xbox Live expects t= in front of a login.live.com token and d= in front of an
		// Azure token. The wrong preamble is answered with 401 Unauthorized.
		const preamble = authFlow === "live" ? "t=" : "d="

		const xbl = await this.http.json<XboxResponse>(XBL_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify({
				Properties: {
					AuthMethod: "RPS",
					SiteName: "user.auth.xboxlive.com",
					RpsTicket: preamble + tokens.access_token,
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

		const { accounts: storedAccounts } = await this.store.read()
		const accounts = microsoftAccounts(storedAccounts)
		const existing = accounts.find((account) => account.uuid === profile.id)

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
			authFlow,
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
		const account = microsoftAccounts(accounts).find((candidate) => candidate.id === accountId)
		if (account === undefined) {
			throw new Error(`Unknown Microsoft account "${accountId}"`)
		}

		const refreshToken = account.refreshToken
		if (refreshToken === null) {
			throw new Error("This account has no refresh token; sign in again")
		}

		const authFlow = account.authFlow ?? this.flow()
		if (authFlow === "live") {
			const tokens = await refreshLiveTokens(this.http, FALLBACK_CLIENT_ID, refreshToken)
			return this.completeMicrosoftLogin(tokens, "live")
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

		return this.completeMicrosoftLogin(tokens, "device")
	}

	async validAccessToken(accountId: string): Promise<string | null> {
		const { accounts } = await this.store.read()
		const account = microsoftAccounts(accounts).find((candidate) => candidate.id === accountId)
		if (account === undefined) {
			return null
		}

		const expiresAt = account.expiresAt === null ? 0 : Date.parse(account.expiresAt)
		if (account.accessToken !== null && expiresAt - Date.now() > 60_000) {
			return account.accessToken
		}

		await this.refresh(accountId)
		const refreshed = microsoftAccounts((await this.store.read()).accounts).find(
			(candidate) => candidate.id === accountId,
		)
		return refreshed?.accessToken ?? null
	}

	async select(accountId: string): Promise<readonly Account[]> {
		const { accounts } = await this.store.read()
		return this.persist(
			microsoftAccounts(accounts).map((account) => ({
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
			microsoftAccounts(accounts).map((account) =>
				account.id === accountId ? { ...account, ...patch } : account,
			),
		)
	}

	async remove(accountId: string): Promise<readonly Account[]> {
		const { accounts } = await this.store.read()
		const remaining = microsoftAccounts(accounts).filter((account) => account.id !== accountId)

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
		const accounts = await this.list()
		return JSON.stringify(
			accounts.map((account) => ({
				kind: "microsoft",
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
		void payload
		throw new Error("Account imports are disabled. Sign in with Microsoft instead.")
	}
}
