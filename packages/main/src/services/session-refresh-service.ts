import type { Logger } from "../infra/logger.ts"
import type { AuthService } from "./auth-service.ts"

const REFRESH_INTERVAL_MS = 10 * 60 * 1000
const REFRESH_WINDOW_MS = 30 * 60 * 1000

export class SessionRefreshService {
	private readonly auth: AuthService
	private readonly logger: Logger
	private timer: ReturnType<typeof setInterval> | undefined
	private refreshing = false

	constructor(auth: AuthService, logger: Logger) {
		this.auth = auth
		this.logger = logger
	}

	start(): void {
		if (this.timer !== undefined) {
			return
		}

		void this.refreshIfNeeded()
		this.timer = setInterval(() => {
			void this.refreshIfNeeded()
		}, REFRESH_INTERVAL_MS)
	}

	dispose(): void {
		if (this.timer !== undefined) {
			clearInterval(this.timer)
			this.timer = undefined
		}
	}

	private async refreshIfNeeded(): Promise<void> {
		if (this.refreshing) {
			return
		}

		this.refreshing = true
		try {
			const accounts = await this.auth.list()
			const account = accounts.find(
				(candidate) => candidate.selected && candidate.kind === "microsoft",
			)
			if (account?.expiresAt === null || account?.expiresAt === undefined) {
				return
			}

			const expiresAt = Date.parse(account.expiresAt)
			if (!Number.isFinite(expiresAt) || expiresAt - Date.now() > REFRESH_WINDOW_MS) {
				return
			}

			await this.auth.refresh(account.id)
			this.logger.info(`Renewed the session for ${account.username}`)
		} catch (error) {
			this.logger.warn("Could not renew the selected Microsoft session", error)
		} finally {
			this.refreshing = false
		}
	}
}
