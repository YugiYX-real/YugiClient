/**
 * @typedef {import("@halcyon/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@halcyon/plugin-sdk").PluginModule} PluginModule
 */

const HEAVY_MOD_COUNT = 120

function gigabytes(bytes) {
	return (bytes / 1024 ** 3).toFixed(1)
}

/** @type {PluginModule} */
const plugin = {
	/** @param {PluginContext} context */
	async activate(context) {
		const refresh = async () => {
			const instances = await context.instances()
			const settings = await context.settings()

			if (instances.length === 0) {
				context.registerCard({
					title: "Library insights",
					body: "Create your first instance and this card will fill with statistics.",
					accent: "#5AA9FF",
				})
				return
			}

			const totalBytes = instances.reduce((sum, instance) => sum + instance.sizeBytes, 0)
			const totalMods = instances.reduce((sum, instance) => sum + instance.modCount, 0)
			const modded = instances.filter((instance) => instance.loader !== "vanilla")
			const underBudget = instances.filter(
				(instance) => instance.modCount >= HEAVY_MOD_COUNT && instance.memoryMb < 6144,
			)

			const lines = [
				`${instances.length} instances · ${modded.length} modded · ${totalMods} mods installed`,
				`${gigabytes(totalBytes)} GB on disk · default memory ${settings.defaultMemoryMb} MB`,
			]

			if (underBudget.length > 0) {
				lines.push(
					`Consider more memory for: ${underBudget.map((instance) => instance.name).join(", ")}`,
				)
			}

			context.registerCard({
				title: "Library insights",
				body: lines.join("\n"),
				accent: underBudget.length > 0 ? "#FFB86B" : "#5AA9FF",
			})
		}

		context.on("instances:changed", () => {
			void refresh()
		})
		context.on("settings:changed", () => {
			void refresh()
		})

		await refresh()
		context.log("Library Insights activated")
	},
}

export default plugin
