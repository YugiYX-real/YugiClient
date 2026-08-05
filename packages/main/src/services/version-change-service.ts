import { assessVersionChange } from "@halcyon/core"
import type {
	InstanceSummary,
	VersionChangeAssessmentDto,
	VersionChangeRequestDto,
} from "@halcyon/ipc"
import type { EventBus } from "../infra/events.ts"
import type { Logger } from "../infra/logger.ts"
import type { BackupService } from "./backup-service.ts"
import type { ContentService } from "./content-service.ts"
import type { InstanceService } from "./instance-service.ts"
import type { LoaderService } from "./loader-service.ts"
import type { VersionService } from "./version-service.ts"

const LOADER_FAMILY_WARNING = "loader-family-change"

export class VersionChangeService {
	private readonly instances: InstanceService
	private readonly content: ContentService
	private readonly backups: BackupService
	private readonly loaders: LoaderService
	private readonly versions: VersionService
	private readonly events: EventBus
	private readonly logger: Logger

	constructor(dependencies: {
		instances: InstanceService
		content: ContentService
		backups: BackupService
		loaders: LoaderService
		versions: VersionService
		events: EventBus
		logger: Logger
	}) {
		this.instances = dependencies.instances
		this.content = dependencies.content
		this.backups = dependencies.backups
		this.loaders = dependencies.loaders
		this.versions = dependencies.versions
		this.events = dependencies.events
		this.logger = dependencies.logger
	}

	async assess(
		instanceId: string,
		request: VersionChangeRequestDto,
	): Promise<VersionChangeAssessmentDto> {
		const config = await this.instances.config(instanceId)
		const [mods, worlds] = await Promise.all([
			this.content.list(instanceId, "mod"),
			this.instances.worlds(instanceId),
		])

		const assessment = assessVersionChange({
			fromVersion: config.gameVersion,
			toVersion: request.gameVersion,
			fromLoader: config.loader,
			toLoader: request.loader,
			hasWorlds: worlds.length > 0,
			mods: mods.map((mod) => ({
				fileName: mod.fileName,
				displayName: mod.displayName,
				enabled: mod.enabled,
				gameVersions: mod.gameVersions,
				loaders: mod.loaders,
			})),
		})

		return {
			direction: assessment.direction,
			warnings: assessment.warnings.map((warning) => ({
				code: warning.code,
				severity: warning.severity,
				message: warning.message,
				detail: warning.detail ?? null,
			})),
			incompatibleMods: assessment.incompatibleMods.map((mod) => mod.displayName),
			recommendBackup: assessment.recommendBackup,
			javaChanges: assessment.javaChanges,
		}
	}

	async change(instanceId: string, request: VersionChangeRequestDto): Promise<InstanceSummary> {
		const config = await this.instances.config(instanceId)
		const assessment = await this.assess(instanceId, request)
		const shouldBackup = request.createBackup ?? assessment.recommendBackup

		if (shouldBackup) {
			this.progress(instanceId, "Creating a safety backup", 0.05)
			await this.backups.create(
				instanceId,
				`Before switching to ${request.gameVersion} (${request.loader})`,
			)
		}

		const familyChange = assessment.warnings.some(
			(warning) => warning.code === LOADER_FAMILY_WARNING,
		)
		if (familyChange) {
			const mods = await this.content.list(instanceId, "mod")
			const enabled = mods.filter((mod) => mod.enabled).map((mod) => mod.fileName)
			if (enabled.length > 0) {
				await this.content.setEnabled(instanceId, "mod", enabled, false)
				this.logger.info(
					`Disabled ${enabled.length} mod(s) while migrating ${config.loader} to ${request.loader}`,
				)
			}
		}

		const loaderVersion =
			request.loader === "vanilla"
				? null
				: (request.loaderVersion ??
					(await this.loaders.bestVersion(request.loader, request.gameVersion)) ??
					null)

		if (request.loader === "vanilla") {
			await this.versions.install(request.gameVersion, (detail, fraction) => {
				this.progress(instanceId, detail, 0.1 + fraction * 0.85)
			})
		} else {
			await this.loaders.install(
				request.loader,
				request.gameVersion,
				loaderVersion,
				(detail, fraction) => {
					this.progress(instanceId, detail, 0.1 + fraction * 0.85)
				},
			)
		}

		const summary = await this.instances.update(instanceId, {
			gameVersion: request.gameVersion,
			loader: request.loader,
			loaderVersion,
		})

		this.events.emit("launch:progress", {
			instanceId,
			state: "exited",
			detail: `${config.name} now runs Minecraft ${request.gameVersion}`,
			fraction: 1,
			exitCode: null,
		})
		this.events.toast(
			"success",
			`${config.name} switched to ${request.gameVersion}`,
			familyChange ? "Existing mods were disabled because the loader family changed" : null,
		)
		this.logger.info(
			`Changed ${config.name} from ${config.gameVersion}/${config.loader} to ${request.gameVersion}/${request.loader}`,
		)
		return summary
	}

	private progress(instanceId: string, detail: string, fraction: number): void {
		this.events.emit("launch:progress", {
			instanceId,
			state: "installing",
			detail,
			fraction,
			exitCode: null,
		})
	}
}
