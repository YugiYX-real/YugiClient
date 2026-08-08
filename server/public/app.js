/*
 * Shared helpers for every page. Kept as one small classic script so the site works without a
 * build step, a bundler or a framework, exactly like the backend it talks to.
 */

const Halcyon = (() => {
	let cached = undefined

	/** Calls the api and turns an error payload into a thrown Error with the server's wording. */
	async function api(path, options = {}) {
		const init = {
			method: options.method ?? "GET",
			credentials: "same-origin",
			headers: {},
		}

		if (options.body !== undefined) {
			if (options.raw === true) {
				init.body = options.body
			} else {
				init.headers["content-type"] = "application/json"
				init.body = JSON.stringify(options.body)
			}
		}

		const response = await fetch(path, init)
		const text = await response.text()
		let payload = null
		try {
			payload = text === "" ? {} : JSON.parse(text)
		} catch {
			payload = {}
		}

		if (!response.ok) {
			throw new Error(payload.error ?? `the server answered ${response.status}`)
		}
		return payload
	}

	async function session(force = false) {
		if (cached !== undefined && !force) {
			return cached
		}
		try {
			const payload = await api("/v1/auth/me")
			cached = payload.user ?? null
		} catch {
			cached = null
		}
		return cached
	}

	function escape(value) {
		return String(value ?? "").replace(
			/[&<>"']/g,
			(character) =>
				({
					"&": "&amp;",
					"<": "&lt;",
					">": "&gt;",
					'"': "&quot;",
					"'": "&#39;",
				})[character],
		)
	}

	function number(value) {
		return new Intl.NumberFormat("en").format(Number(value ?? 0))
	}

	function when(iso) {
		if (iso === null || iso === undefined || iso === "") {
			return "never"
		}
		const date = new Date(iso)
		if (Number.isNaN(date.getTime())) {
			return "unknown"
		}
		return date.toLocaleString()
	}

	function toast(message, bad = false) {
		let host = document.querySelector(".toast")
		if (host === null) {
			host = document.createElement("div")
			host.className = "toast"
			document.body.append(host)
		}

		const item = document.createElement("div")
		item.textContent = message
		if (bad) {
			item.classList.add("bad")
		}
		host.append(item)
		setTimeout(() => item.remove(), 4000)
	}

	function say(id, message, kind = "error") {
		const box = document.getElementById(id)
		if (box === null) {
			return
		}
		box.textContent = message
		box.className = `message show ${kind}`
	}

	function clear(id) {
		const box = document.getElementById(id)
		if (box !== null) {
			box.className = "message"
			box.textContent = ""
		}
	}

	/** Fills the header with either the sign in pair or the account and admin links. */
	async function paintSession() {
		const host = document.getElementById("session")
		if (host === null) {
			return null
		}

		const user = await session()
		if (user === null) {
			host.innerHTML =
				'<a class="button small" href="/login">Sign in</a>' +
				'<a class="button small primary" href="/register">Create account</a>'
			return null
		}

		const admin =
			user.role === "admin" ? '<a class="button small" href="/admin">Admin</a>' : ""
		host.innerHTML = `${admin}<a class="button small" href="/account">${escape(user.username)}</a>`
		return user
	}

	/** Sends a visitor away when the page needs a session, or an admin session. */
	async function guard(needAdmin = false) {
		const user = await session()
		if (user === null) {
			window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`
			return null
		}
		if (needAdmin && user.role !== "admin") {
			window.location.href = "/account"
			return null
		}
		return user
	}

	/** What a cosmetic is. Anything the backend does not name counts as a cape. */
	function kindOf(cosmetic) {
		const type = String(cosmetic?.type ?? "cape").toLowerCase()
		return type === "" ? "cape" : type
	}

	/** The still picture every cosmetic has, whatever else it also has. */
	function stillUrl(cosmetic) {
		const texture = String(cosmetic?.texture ?? "")
		if (texture !== "") {
			return texture
		}
		return `/v1/cosmetics/textures/${String(cosmetic?.id ?? "")}.png`
	}

	/**
	 * The picture to show for a cosmetic.
	 *
	 * Animated cosmetics point at their gif, because a gif animates on its own and needs no
	 * javascript at all. Tiles fall back to the still picture when there is no gif, so a cosmetic
	 * built from single frames still shows something.
	 */
	function cosmeticUrl(cosmetic) {
		const id = String(cosmetic?.id ?? "")
		if (cosmetic?.animated === true && id !== "") {
			return `/v1/cosmetics/textures/${id}.gif`
		}
		return stillUrl(cosmetic)
	}

	/** Kept under its old name so older pages keep working. */
	function capeUrl(cosmetic) {
		return cosmeticUrl(cosmetic)
	}

	/**
	 * One cosmetic tile, used by the catalogue, the account page and the admin panel.
	 *
	 * A cape is a 64x32 sheet where only one region is the visible cloth, so it stays cropped to that
	 * region. Wings, hats, halos and the rest are whole pictures, often square, and cropping those is
	 * what made them look empty, so they are shown complete in a picture element instead. If the
	 * animation is missing the picture quietly swaps itself for the still frame.
	 */
	function capeCard(cosmetic, extra = "") {
		const kind = kindOf(cosmetic)
		const url = escape(cosmeticUrl(cosmetic))
		const still = escape(stillUrl(cosmetic))
		const art =
			kind === "cape"
				? `<div class="cape" style="background-image:url('${url}')"></div>`
				: `<img src="${url}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${still}'" style="width:96px;height:96px;object-fit:contain;image-rendering:pixelated" />`
		const moving = cosmetic?.animated === true ? " &middot; animated" : ""
		return `
			<div class="cape-card">
				${art}
				<div class="name">${escape(cosmetic.name ?? cosmetic.id)}</div>
				<div class="meta">${escape(cosmetic.rarity ?? "common")} &middot; ${escape(kind)}${moving}</div>
				${extra}
			</div>`
	}

	async function logout() {
		try {
			await api("/v1/auth/logout", { method: "POST" })
		} catch {
			// Signing out locally is what matters; a failed call still ends the visit.
		}
		cached = null
		window.location.href = "/"
	}

	return {
		api,
		session,
		paintSession,
		guard,
		escape,
		number,
		when,
		toast,
		say,
		clear,
		kindOf,
		stillUrl,
		cosmeticUrl,
		capeCard,
		capeUrl,
		logout,
	}
})()

document.addEventListener("DOMContentLoaded", () => {
	Halcyon.paintSession()
	const year = document.getElementById("year")
	if (year !== null) {
		year.textContent = String(new Date().getFullYear())
	}
})
