import { existsSync } from "node:fs"
import { join } from "node:path"
import { BrowserWindow, Menu, Tray, app, nativeImage, nativeTheme, shell } from "electron"
import { createContainer } from "./container.ts"
import type { Container } from "./container.ts"
import { registerIpc } from "./ipc/register.ts"

const APP_ID = "dev.yugi.halcyon"
const BACKGROUND_COLOR = "#0B0E14"
const SPLASH_DATA_PREFIX = "data:text/html;charset=utf-8,"
const UPDATE_CHECK_DELAY_MS = 8_000

const SPLASH_HTML = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<style>
			* { margin: 0; padding: 0; box-sizing: border-box; }
			body {
				width: 100vw;
				height: 100vh;
				display: grid;
				place-items: center;
				background: radial-gradient(120% 120% at 12% 0%, #1A2130 0%, #0B0E14 58%);
				font-family: "Inter", "Segoe UI", system-ui, sans-serif;
				color: #E8ECF5;
				overflow: hidden;
				border-radius: 18px;
			}
			.aurora {
				position: absolute;
				inset: -40%;
				background:
					radial-gradient(closest-side, rgba(124, 92, 255, 0.55), transparent 70%) 20% 25% / 60% 60% no-repeat,
					radial-gradient(closest-side, rgba(57, 224, 200, 0.42), transparent 70%) 78% 70% / 55% 55% no-repeat;
				filter: blur(14px);
				animation: drift 9s ease-in-out infinite alternate;
			}
			.stack { position: relative; display: grid; gap: 22px; justify-items: center; }
			.mark {
				width: 74px;
				height: 74px;
				border-radius: 22px;
				background: linear-gradient(140deg, #7C5CFF, #39E0C8);
				box-shadow: 0 18px 48px rgba(124, 92, 255, 0.42);
				display: grid;
				place-items: center;
				animation: breathe 2.8s ease-in-out infinite;
			}
			.mark span { font-size: 34px; font-weight: 700; color: #0B0E14; }
			.word { font-size: 22px; font-weight: 600; letter-spacing: 0.32em; text-transform: uppercase; }
			.tag { font-size: 12px; letter-spacing: 0.14em; color: rgba(232, 236, 245, 0.55); text-transform: uppercase; }
			.bar { width: 190px; height: 3px; border-radius: 999px; background: rgba(232, 236, 245, 0.12); overflow: hidden; }
			.bar i { display: block; width: 40%; height: 100%; border-radius: 999px; background: linear-gradient(90deg, #7C5CFF, #39E0C8); animation: slide 1.5s ease-in-out infinite; }
			@keyframes slide { 0% { transform: translateX(-110%); } 100% { transform: translateX(260%); } }
			@keyframes breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
			@keyframes drift { 0% { transform: translate3d(-3%, -2%, 0) rotate(0deg); } 100% { transform: translate3d(3%, 4%, 0) rotate(8deg); } }
		</style>
	</head>
	<body>
		<div class="aurora"></div>
		<div class="stack">
			<div class="mark"><span>H</span></div>
			<div class="word">Halcyon</div>
			<div class="bar"><i></i></div>
			<div class="tag">Launch beautifully</div>
		</div>
	</body>
</html>`

let container: Container | undefined
let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null
let tray: Tray | undefined
let closeToTray = false
let quitting = false

function appAsset(...segments: readonly string[]): string {
	return join(app.getAppPath(), ...segments)
}

function preloadScript(): string {
	const candidates = [
		appAsset("out", "preload", "index.mjs"),
		appAsset("out", "preload", "index.js"),
		appAsset("out", "preload", "index.cjs"),
	]
	const fallback = candidates[0] ?? ""
	return candidates.find((candidate) => existsSync(candidate)) ?? fallback
}

function showSplash(): void {
	splashWindow = new BrowserWindow({
		width: 460,
		height: 300,
		frame: false,
		transparent: true,
		resizable: false,
		movable: true,
		skipTaskbar: true,
		alwaysOnTop: true,
		show: true,
		hasShadow: true,
		webPreferences: { contextIsolation: true, nodeIntegration: false },
	})
	void splashWindow.loadURL(SPLASH_DATA_PREFIX + encodeURIComponent(SPLASH_HTML))
}

function closeSplash(): void {
	if (splashWindow !== null && !splashWindow.isDestroyed()) {
		splashWindow.destroy()
	}
	splashWindow = null
}

function createMainWindow(): BrowserWindow {
	const macOs = process.platform === "darwin"
	const window = new BrowserWindow({
		width: 1320,
		height: 860,
		minWidth: 1080,
		minHeight: 700,
		show: false,
		backgroundColor: BACKGROUND_COLOR,
		autoHideMenuBar: true,
		...(macOs
			? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 18, y: 20 } }
			: {}),
		webPreferences: {
			preload: preloadScript(),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
			spellcheck: false,
		},
	})

	window.once("ready-to-show", () => {
		closeSplash()
		window.show()
		window.focus()
	})

	window.webContents.setWindowOpenHandler(({ url }) => {
		void shell.openExternal(url)
		return { action: "deny" }
	})

	window.on("close", (event) => {
		if (closeToTray && !quitting && tray !== undefined) {
			event.preventDefault()
			window.hide()
		}
	})

	window.on("closed", () => {
		mainWindow = null
	})

	const devServer = process.env["ELECTRON_RENDERER_URL"]
	if (devServer !== undefined && devServer !== "") {
		void window.loadURL(devServer)
		window.webContents.openDevTools({ mode: "detach" })
	} else {
		void window.loadFile(appAsset("out", "renderer", "index.html"))
	}

	return window
}

function revealMainWindow(): void {
	if (mainWindow === null || mainWindow.isDestroyed()) {
		mainWindow = createMainWindow()
		container?.events.register(mainWindow)
		return
	}
	if (mainWindow.isMinimized()) {
		mainWindow.restore()
	}
	mainWindow.show()
	mainWindow.focus()
}

function createTray(): void {
	const iconPath = appAsset("build", "icon.png")
	if (!existsSync(iconPath)) {
		return
	}

	const image = nativeImage.createFromPath(iconPath)
	if (image.isEmpty()) {
		return
	}

	tray = new Tray(image.resize({ width: 20, height: 20 }))
	tray.setToolTip("Halcyon")
	tray.setContextMenu(
		Menu.buildFromTemplate([
			{ label: "Open Halcyon", click: revealMainWindow },
			{ type: "separator" },
			{
				label: "Quit",
				click: () => {
					quitting = true
					app.quit()
				},
			},
		]),
	)
	tray.on("double-click", revealMainWindow)
}

async function bootstrap(): Promise<void> {
	app.setAppUserModelId(APP_ID)
	showSplash()

	const instance = await createContainer({ fallbackVersion: app.getVersion() })
	container = instance

	const settings = await instance.settings.get()
	closeToTray = settings.closeToTray
	nativeTheme.themeSource = settings.theme === "light" ? "light" : "dark"

	instance.settings.onChange((next) => {
		closeToTray = next.closeToTray
		nativeTheme.themeSource = next.theme === "light" ? "light" : "dark"
	})

	registerIpc(instance)

	mainWindow = createMainWindow()
	instance.events.register(mainWindow)
	createTray()

	await instance.updates.initialize(settings.autoUpdate)
	await instance.plugins.reload()

	if (settings.autoUpdate) {
		setTimeout(() => {
			void instance.updates.check()
		}, UPDATE_CHECK_DELAY_MS)
	}

	instance.logger.info("Halcyon is ready")
}

if (!app.requestSingleInstanceLock()) {
	app.quit()
} else {
	app.on("second-instance", revealMainWindow)

	app.on("activate", () => {
		revealMainWindow()
	})

	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") {
			app.quit()
		}
	})

	app.on("before-quit", () => {
		quitting = true
	})

	app.on("will-quit", (event) => {
		const instance = container
		if (instance === undefined) {
			return
		}
		container = undefined
		event.preventDefault()
		void instance.dispose().finally(() => {
			tray?.destroy()
			app.quit()
		})
	})

	process.on("uncaughtException", (error: Error) => {
		container?.logger.error("An unexpected error reached the top level", error)
	})

	process.on("unhandledRejection", (reason: unknown) => {
		container?.logger.error("A promise rejection was not handled", reason)
	})

	app.whenReady()
		.then(bootstrap)
		.catch((error: unknown) => {
			closeSplash()
			console.error("Halcyon failed to start", error)
			app.exit(1)
		})
}
