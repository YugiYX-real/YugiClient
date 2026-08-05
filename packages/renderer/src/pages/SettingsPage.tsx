import { useEffect, useState } from "react"
import type { AnimationLevel, AppInfo, Settings, ThemeMode, UpdateStatus } from "@halcyon/ipc"
import {
	Badge,
	Button,
	Card,
	ConfirmDialog,
	Field,
	SectionHeader,
	Select,
	Skeleton,
	Slider,
	TextInput,
	Toggle,
} from "../components/primitives.tsx"
import { ACCENT_PRESETS } from "../app/theme.ts"
import { invoke, openPath } from "../lib/client.ts"
import { useIpcEvent } from "../lib/hooks.ts"
import { formatMemory } from "../lib/format.ts"

const THEMES: readonly { value: ThemeMode; label: string }[] = [
	{ value: "dark", label: "Dark" },
	{ value: "light", label: "Light" },
	{ value: "amoled", label: "AMOLED" },
]

const ANIMATIONS: readonly { value: AnimationLevel; label: string }[] = [
	{ value: "full", label: "Full motion" },
	{ value: "reduced", label: "Reduced" },
	{ value: "off", label: "Off" },
]

const LANGUAGES: readonly { value: string; label: string }[] = [
	{ value: "en", label: "English" },
	{ value: "de", label: "Deutsch" },
	{ value: "fr", label: "Français" },
	{ value: "es", label: "Español" },
	{ value: "pt-BR", label: "Português (Brasil)" },
	{ value: "ru", label: "Русский" },
	{ value: "zh-CN", label: "简体中文" },
	{ value: "ja", label: "日本語" },
]

export function SettingsPage({
	settings,
	onUpdate,
	onReset,
}: {
	settings: Settings | undefined
	onUpdate: (patch: Partial<Settings>) => void
	onReset: () => void
}): JSX.Element {
	const [info, setInfo] = useState<AppInfo | null>(null)
	const [update, setUpdate] = useState<UpdateStatus | null>(null)
	const [resetting, setResetting] = useState(false)
	const [jvmArgs, setJvmArgs] = useState("")

	useEffect(() => {
		void invoke("app:info").then(setInfo)
		void invoke("updates:status").then(setUpdate)
	}, [])

	useEffect(() => {
		if (settings !== undefined) {
			setJvmArgs(settings.defaultJvmArgs)
		}
	}, [settings?.defaultJvmArgs, settings])

	useIpcEvent("updates:changed", setUpdate)

	if (settings === undefined) {
		return (
			<Card>
				<Skeleton lines={6} />
			</Card>
		)
	}

	return (
		<>
			<div className="grid cols-2">
				<Card>
					<SectionHeader title="Appearance" subtitle="Themes, accents and motion" />
					<div className="col" style={{ marginTop: 14 }}>
						<Field label="Theme">
							<Select
								value={settings.theme}
								options={THEMES}
								onChange={(value) => {
									onUpdate({ theme: value })
								}}
							/>
						</Field>
						<Field label="Accent colour">
							<div className="row wrap">
								{ACCENT_PRESETS.map((preset) => (
									<button
										key={preset.value}
										type="button"
										title={preset.name}
										onClick={() => {
											onUpdate({ accent: preset.value })
										}}
										style={{
											width: 28,
											height: 28,
											borderRadius: 9,
											background: preset.value,
											border:
												settings.accent.toLowerCase() === preset.value.toLowerCase()
													? "2px solid var(--text)"
													: "1px solid var(--border)",
											cursor: "pointer",
										}}
									/>
								))}
								<input
									type="color"
									value={settings.accent}
									onChange={(event) => {
										onUpdate({ accent: event.target.value })
									}}
								/>
							</div>
						</Field>
						<Field label={`Corner radius · ${settings.cornerRadius}px`}>
							<Slider
								value={settings.cornerRadius}
								min={0}
								max={28}
								onChange={(value) => {
									onUpdate({ cornerRadius: value })
								}}
							/>
						</Field>
						<Field label={`Transparency · ${Math.round(settings.transparency * 100)}%`}>
							<Slider
								value={settings.transparency}
								min={0}
								max={0.6}
								step={0.02}
								onChange={(value) => {
									onUpdate({ transparency: value })
								}}
							/>
						</Field>
						<Field label={`Interface scale · ${Math.round(settings.uiScale * 100)}%`}>
							<Slider
								value={settings.uiScale}
								min={0.8}
								max={1.4}
								step={0.05}
								onChange={(value) => {
									onUpdate({ uiScale: value })
								}}
							/>
						</Field>
						<Field label="Motion">
							<Select
								value={settings.animations}
								options={ANIMATIONS}
								onChange={(value) => {
									onUpdate({ animations: value })
								}}
							/>
						</Field>
						<Toggle
							checked={settings.blur}
							label="Blur and glass effects"
							onChange={(value) => {
								onUpdate({ blur: value })
							}}
						/>
						<div className="row wrap">
							<Button
								size="small"
								icon="upload"
								onClick={() => {
									void invoke("settings:pickImage").then((path) => {
										if (path !== null) {
											onUpdate({ wallpaper: path })
										}
									})
								}}
							>
								Choose wallpaper
							</Button>
							{settings.wallpaper === null ? null : (
								<Button
									size="small"
									variant="ghost"
									onClick={() => {
										onUpdate({ wallpaper: null })
									}}
								>
									Remove wallpaper
								</Button>
							)}
						</div>
					</div>
				</Card>

				<Card>
					<SectionHeader title="Game defaults" subtitle="Applied to newly created instances" />
					<div className="col" style={{ marginTop: 14 }}>
						<Field label={`Default memory · ${formatMemory(settings.defaultMemoryMb)}`}>
							<Slider
								value={settings.defaultMemoryMb}
								min={1024}
								max={16384}
								step={256}
								onChange={(value) => {
									onUpdate({ defaultMemoryMb: value })
								}}
							/>
						</Field>
						<Field label="Default JVM arguments">
							<textarea
								value={jvmArgs}
								onChange={(event) => {
									setJvmArgs(event.target.value)
								}}
								onBlur={() => {
									onUpdate({ defaultJvmArgs: jvmArgs })
								}}
							/>
						</Field>
						<Field label="Default Java executable" hint="Leave empty to let Halcyon choose per version">
							<TextInput
								value={settings.defaultJavaPath ?? ""}
								onChange={(value) => {
									onUpdate({ defaultJavaPath: value === "" ? null : value })
								}}
							/>
						</Field>
						<Field label={`Parallel downloads · ${settings.concurrentDownloads}`}>
							<Slider
								value={settings.concurrentDownloads}
								min={1}
								max={32}
								onChange={(value) => {
									onUpdate({ concurrentDownloads: value })
								}}
							/>
						</Field>
						<Toggle
							checked={settings.showSnapshots}
							label="Show snapshots and pre-releases"
							onChange={(value) => {
								onUpdate({ showSnapshots: value })
							}}
						/>
					</div>
				</Card>

				<Card>
					<SectionHeader title="Folders" subtitle="Where Halcyon stores game data" />
					<div className="col" style={{ marginTop: 14 }}>
						<Field label="Download directory">
							<div className="row">
								<TextInput
									value={settings.downloadDirectory ?? ""}
									onChange={(value) => {
										onUpdate({ downloadDirectory: value === "" ? null : value })
									}}
								/>
								<Button
									size="small"
									icon="folder"
									onClick={() => {
										void invoke("settings:pickDirectory", "download")
									}}
								/>
							</div>
						</Field>
						<Field label="Screenshot directory">
							<div className="row">
								<TextInput
									value={settings.screenshotDirectory ?? ""}
									onChange={(value) => {
										onUpdate({ screenshotDirectory: value === "" ? null : value })
									}}
								/>
								<Button
									size="small"
									icon="folder"
									onClick={() => {
										void invoke("settings:pickDirectory", "screenshot")
									}}
								/>
							</div>
						</Field>
						{info === null ? null : (
							<Button
								size="small"
								icon="folder"
								onClick={() => {
									openPath(info.dataDirectory)
								}}
							>
								Open data folder
							</Button>
						)}
					</div>
				</Card>

				<Card>
					<SectionHeader title="Behaviour" subtitle="Notifications, presence and window handling" />
					<div className="col" style={{ marginTop: 14 }}>
						<Field label="Language" hint="Dates and numbers always follow your system locale">
							<Select
								value={settings.language}
								options={LANGUAGES}
								onChange={(value) => {
									onUpdate({ language: value })
								}}
							/>
						</Field>
						<Toggle
							checked={settings.notifications}
							label="In-app notifications"
							onChange={(value) => {
								onUpdate({ notifications: value })
							}}
						/>
						<Toggle
							checked={settings.discordPresence}
							label="Discord Rich Presence"
							onChange={(value) => {
								onUpdate({ discordPresence: value })
							}}
						/>
						<Toggle
							checked={settings.keepLauncherOpen}
							label="Keep the launcher open while playing"
							onChange={(value) => {
								onUpdate({ keepLauncherOpen: value })
							}}
						/>
						<Toggle
							checked={settings.closeToTray}
							label="Close to system tray instead of quitting"
							onChange={(value) => {
								onUpdate({ closeToTray: value })
							}}
						/>
						<Toggle
							checked={settings.shareUsageData}
							label="Share anonymous usage data"
							onChange={(value) => {
								onUpdate({ shareUsageData: value })
							}}
						/>
						<small>
							Halcyon never uploads your accounts, tokens, worlds or logs. Usage data stays off unless you
							turn it on.
						</small>
					</div>
				</Card>

				<Card>
					<SectionHeader title="Updates" subtitle="Signed, verified and reversible" />
					<div className="col" style={{ marginTop: 14 }}>
						<Toggle
							checked={settings.autoUpdate}
							label="Download updates automatically"
							onChange={(value) => {
								onUpdate({ autoUpdate: value })
							}}
						/>
						<div className="row wrap">
							<Badge tone={update?.state === "error" ? "danger" : "accent"}>
								{update?.state ?? "idle"}
							</Badge>
							{update?.availableVersion === null || update === null ? null : (
								<Badge tone="success">{update.availableVersion} ready to download</Badge>
							)}
						</div>
						<div className="row wrap">
							<Button
								size="small"
								icon="refresh"
								onClick={() => {
									void invoke("updates:check").then(setUpdate)
								}}
							>
								Check for updates
							</Button>
							<Button
								size="small"
								icon="downloads"
								onClick={() => {
									void invoke("updates:download").then(setUpdate)
								}}
							>
								Download
							</Button>
							<Button
								size="small"
								variant="primary"
								icon="check"
								disabled={update?.state !== "ready"}
								onClick={() => {
									void invoke("updates:install")
								}}
							>
								Restart and install
							</Button>
							<Button
								size="small"
								variant="ghost"
								disabled={update?.canRollback !== true}
								onClick={() => {
									void invoke("updates:rollback").then(setUpdate)
								}}
							>
								Roll back
							</Button>
						</div>
						{update?.releaseNotes === null || update === null ? null : (
							<div className="markdown">{update.releaseNotes}</div>
						)}
					</div>
				</Card>

				<Card>
					<SectionHeader title="About" subtitle="Build information" />
					{info === null ? (
						<Skeleton lines={4} />
					) : (
						<div className="col" style={{ marginTop: 14 }}>
							<div className="row between">
								<small>Version</small>
								<span>
									{info.version} · build {info.buildNumber} · {info.commit}
								</span>
							</div>
							<div className="row between">
								<small>Platform</small>
								<span>
									{info.platform} {info.arch}
								</span>
							</div>
							<div className="row between">
								<small>Runtime</small>
								<span>
									Electron {info.electronVersion} · Node {info.nodeVersion}
								</span>
							</div>
							<div className="row between">
								<small>Built</small>
								<span>{info.buildTime}</span>
							</div>
							<div className="row wrap">
								<Button
									size="small"
									icon="refresh"
									onClick={() => {
										void invoke("app:relaunch")
									}}
								>
									Restart launcher
								</Button>
								<Button
									size="small"
									variant="danger"
									icon="trash"
									onClick={() => {
										setResetting(true)
									}}
								>
									Reset settings
								</Button>
							</div>
						</div>
					)}
				</Card>
			</div>

			{resetting ? (
				<ConfirmDialog
					title="Reset settings"
					message="Every launcher preference returns to its default. Instances, accounts and skins are untouched."
					confirmLabel="Reset"
					destructive
					onCancel={() => {
						setResetting(false)
					}}
					onConfirm={() => {
						setResetting(false)
						onReset()
					}}
				/>
			) : null}
		</>
	)
}
