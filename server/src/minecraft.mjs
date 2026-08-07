const PROFILE_URL = "https://api.minecraftservices.com/minecraft/profile"
const TIMEOUT_MS = 8000
const UUID = /^[0-9a-f]{32}$/
const NAME = /^[A-Za-z0-9_]{1,32}$/

/**
 * Asks Mojang who a Minecraft access token belongs to.
 *
 * This is the whole point of the flow: the launcher already signed the player in with Microsoft,
 * so instead of trusting a name typed into a form, the server hands the token straight back to
 * Mojang and believes only the answer. A token that is expired, revoked or made up gets nothing.
 *
 * Returns `{ uuid, name }` or null. The token is never stored and never logged.
 */
export async function minecraftProfile(accessToken) {
	const token = String(accessToken ?? "").trim()
	if (token === "" || token.length > 4096) {
		return null
	}

	let response = null
	try {
		response = await fetch(PROFILE_URL, {
			headers: { authorization: `Bearer ${token}`, accept: "application/json" },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		})
	} catch (error) {
		console.warn("[halcyon] Mojang could not be reached:", error.message)
		return null
	}

	if (!response.ok) {
		return null
	}

	let payload = null
	try {
		payload = await response.json()
	} catch {
		return null
	}

	const uuid = String(payload?.id ?? "")
		.replace(/-/g, "")
		.toLowerCase()
	const name = String(payload?.name ?? "").trim()
	if (!UUID.test(uuid) || !NAME.test(name)) {
		return null
	}
	return { uuid, name }
}
