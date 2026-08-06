import { BrowserWindow } from "electron"
import type { HttpClient } from "../infra/http.ts"

const AUTHORIZE_URL = "https://login.live.com/oauth20_authorize.srf"
const TOKEN_URL = "https://login.live.com/oauth20_token.srf"
const REDIRECT_URL = "https://login.live.com/oauth20_desktop.srf"
const PARTITION = "persist:halcyon-microsoft"

// The legacy endpoints issue a ticket for the relying party named in the scope. Xbox
// Live only accepts a ticket minted for itself, so the v2.0 style "XboxLive.signin
// offline_access" scope yields a token that user/authenticate answers with 401.
const SCOPE = "service::user.auth.xboxlive.com::MBI_SSL"

export type LiveTokens = {
	readonly access_token: string
	readonly refresh_token?: string
	readonly expires_in: number
}

type Outcome =
	| { readonly kind: "code"; readonly code: string }
	| { readonly kind: "error"; readonly error: string }

function authorizeUrl(clientId: string): string {
	const query = new URLSearchParams({
		client_id: clientId,
		response_type: "code",
		redirect_uri: REDIRECT_URL,
		scope: SCOPE,
		prompt: "select_account",
	})
	return AUTHORIZE_URL + "?" + query.toString()
}

function outcomeOf(url: string): Outcome | undefined {
	if (!url.startsWith(REDIRECT_URL)) {
		return undefined
	}

	const parameters = new URL(url).searchParams
	const code = parameters.get("code")
	if (code !== null && code !== "") {
		return { kind: "code", code }
	}

	const error = parameters.get("error_description") ?? parameters.get("error")
	if (error !== null && error !== "") {
		return { kind: "error", error }
	}

	return undefined
}

export function requestLiveAuthorizationCode(clientId: string): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const window = new BrowserWindow({
			width: 520,
			height: 730,
			title: "Sign in with Microsoft",
			autoHideMenuBar: true,
			backgroundColor: "#0B0E14",
			webPreferences: {
				partition: PARTITION,
				nodeIntegration: false,
				contextIsolation: true,
			},
		})

		let settled = false

		const inspect = (_event: unknown, url: string): void => {
			if (settled) {
				return
			}

			const outcome = outcomeOf(url)
			if (outcome === undefined) {
				return
			}

			settled = true
			if (outcome.kind === "code") {
				resolve(outcome.code)
			} else {
				reject(new Error("Microsoft sign-in failed: " + outcome.error))
			}

			setImmediate(() => {
				if (!window.isDestroyed()) {
					window.destroy()
				}
			})
		}

		window.webContents.on("did-navigate", inspect)
		window.webContents.on("did-redirect-navigation", inspect)
		window.on("closed", () => {
			if (settled) {
				return
			}
			settled = true
			reject(new Error("The Microsoft sign-in window was closed before it finished"))
		})

		void window.loadURL(authorizeUrl(clientId))
	})
}

export async function exchangeLiveCode(
	http: HttpClient,
	clientId: string,
	code: string,
): Promise<LiveTokens> {
	return http.json<LiveTokens>(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: clientId,
			code,
			grant_type: "authorization_code",
			redirect_uri: REDIRECT_URL,
			scope: SCOPE,
		}).toString(),
		retries: 2,
	})
}

export async function refreshLiveTokens(
	http: HttpClient,
	clientId: string,
	refreshToken: string,
): Promise<LiveTokens> {
	return http.json<LiveTokens>(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: clientId,
			refresh_token: refreshToken,
			grant_type: "refresh_token",
			redirect_uri: REDIRECT_URL,
			scope: SCOPE,
		}).toString(),
		retries: 2,
	})
}
