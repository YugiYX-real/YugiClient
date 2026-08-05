/**
 * @typedef {import("@halcyon/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@halcyon/plugin-sdk").PluginModule} PluginModule
 */

const startedAt = new Map()
let minutesToday = 0
let sessionsToday = 0

function formatMinutes(total) {
	const hours = Math.floor(total / 60)
	const minutes = total % 60
	return hours === 0 ? `${minutes}m` : `${hours}h ${minutes}m`
}

/** @type {PluginModule} */
const plugin = {
	/** @param {PluginContext} context */
	activate(context) {
		context.log(`Playtime Tracker running on Halcyon ${context.launcher.version}`)

		const publish = () => {
			context.registerCard({
				title: "Playtime today",
				body:
					sessionsToday === 0
						? "No sessions yet today. Pick an instance and press play."
						: `${formatMinutes(minutesToday)} across ${sessionsToday} session${sessionsToday === 1 ? "" : "s"}.`,
				accent: "#39E0C8",
			})
		}

		context.on("launch:progress", (payload) => {
			const progress = /** @type {{ instanceId: string, state: string }} */ (payload)

			if (progress.state === "running") {
				startedAt.set(progress.instanceId, Date.now())
				return
			}

			if (progress.state !== "exited" && progress.state !== "error") {
				return
			}

			const began = startedAt.get(progress.instanceId)
			if (began === undefined) {
				return
			}
			startedAt.delete(progress.instanceId)

			const minutes = Math.max(1, Math.round((Date.now() - began) / 60000))
			minutesToday += minutes
			sessionsToday += 1
			publish()
			context.notify("info", `Session ended after ${formatMinutes(minutes)}`)
		})

		publish()
	},

	deactivate() {
		startedAt.clear()
		minutesToday = 0
		sessionsToday = 0
	},
}

export default plugin
