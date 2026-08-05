import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import react from "@vitejs/plugin-react"
import { defineConfig, externalizeDepsPlugin } from "electron-vite"

const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
	version: string
}

const alias = {
	"@halcyon/core": resolve("packages/core/src/index.ts"),
	"@halcyon/ipc": resolve("packages/ipc/src/index.ts"),
	"@halcyon/plugin-sdk": resolve("packages/plugin-sdk/src/index.ts"),
	"@renderer": resolve("packages/renderer/src"),
}

const buildConstants = {
	__APP_VERSION__: JSON.stringify(packageJson.version),
	__BUILD_NUMBER__: JSON.stringify(process.env.GITHUB_RUN_NUMBER ?? "local"),
	__COMMIT_SHA__: JSON.stringify((process.env.GITHUB_SHA ?? "development").slice(0, 7)),
	__BUILD_TIME__: JSON.stringify(new Date().toISOString()),
}

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin()],
		resolve: { alias },
		define: buildConstants,
		build: {
			outDir: "out/main",
			sourcemap: true,
			rollupOptions: {
				input: { index: resolve("packages/main/src/index.ts") },
			},
		},
	},
	preload: {
		plugins: [externalizeDepsPlugin()],
		resolve: { alias },
		define: buildConstants,
		build: {
			outDir: "out/preload",
			sourcemap: true,
			rollupOptions: {
				input: { index: resolve("packages/preload/src/index.ts") },
			},
		},
	},
	renderer: {
		root: resolve("packages/renderer"),
		plugins: [react()],
		resolve: { alias },
		define: buildConstants,
		build: {
			outDir: resolve("out/renderer"),
			emptyOutDir: true,
			sourcemap: true,
			rollupOptions: {
				input: resolve("packages/renderer/index.html"),
			},
		},
	},
})
