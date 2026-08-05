import { connect } from "node:net"
import type { Socket } from "node:net"
import { platform } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import type { InstanceConfig } from "@halcyon/ipc"
import type { Logger } from "../infra/logger.ts"

const OPCODE_HANDSHAKE = 0
const OPCODE_FRAME = 1
const OPCODE_CLOSE = 2
const RPC_VERSION = 1
const LARGE_IMAGE_KEY = "halcyon"

function socketCandidates(): readonly string[] {
	if (platform() === "win32") {
		return Array.from({ length: 10 }, (_unused, index) => `\\\\?\\pipe\\discord-ipc-${index}`)
	}

	const base =
		process.env.XDG_RUNTIME_DIR ??
		process.env.TMPDIR ??
		process.env.TMP ??
		process.env.TEMP ??
		"/tmp"

	const roots = [base, join(base, "app", "com.discordapp.Discord"), join(base, "snap.discord")]
	const paths: string[] = []
	for (const root of roots) {
		for (let index = 0; index < 10; index += 1) {
			paths.push(join(root, `discord-ipc-${index}`))
		}
	}
	return paths
}

function encode(opcode: number, payload: unknown): Uint8Array {
	const body = Buffer.from(JSON.stringify(payload), "utf8")
	const frame = Buffer.alloc(8 + body.byteLength)
	frame.writeInt32LE(opcode, 0)
	frame.writeInt32LE(body.byteLength, 4)
	body.copy(frame, 8)
	return frame
}

export class PresenceService {
	private readonly logger: Logger
	private socket: Socket | null = null
	private ready = false
	private enabled = true

	constructor(dependencies: { logger: Logger }) {
		this.logger = dependencies.logger
	}

	private clientId(): string | undefined {
		const configured = process.env.HALCYON_DISCORD_CLIENT_ID
		return configured === undefined || configured === "" ? undefined : configured
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled
		if (!enabled) {
			this.dispose()
		}
	}

	private async openSocket(path: string): Promise<Socket | undefined> {
		return new Promise((resolve) => {
			const socket = connect(path)
			const fail = (): void => {
				socket.destroy()
				resolve(undefined)
			}
			socket.once("error", fail)
			socket.once("connect", () => {
				socket.removeListener("error", fail)
				resolve(socket)
			})
		})
	}

	private async ensureConnection(): Promise<boolean> {
		if (!this.enabled) {
			return false
		}
		if (this.ready && this.socket !== null) {
			return true
		}

		const clientId = this.clientId()
		if (clientId === undefined) {
			return false
		}

		for (const candidate of socketCandidates()) {
			const socket = await this.openSocket(candidate)
			if (socket === undefined) {
				continue
			}

			socket.on("error", (error: unknown) => {
				this.logger.debug("Discord presence socket error", error)
				this.dispose()
			})
			socket.on("close", () => {
				this.socket = null
				this.ready = false
			})

			socket.write(encode(OPCODE_HANDSHAKE, { v: RPC_VERSION, client_id: clientId }))
			this.socket = socket
			this.ready = true
			this.logger.debug(`Connected to Discord over ${candidate}`)
			return true
		}

		return false
	}

	async setPlaying(instance: InstanceConfig, startedAtMs: number): Promise<void> {
		if (!instance.discordPresence) {
			return
		}
		if (!(await this.ensureConnection())) {
			return
		}

		const loaderLabel = instance.loader === "vanilla" ? "Vanilla" : instance.loader
		this.send({
			cmd: "SET_ACTIVITY",
			nonce: randomUUID(),
			args: {
				pid: process.pid,
				activity: {
					details: `Playing ${instance.name}`,
					state: `Minecraft ${instance.gameVersion} - ${loaderLabel}`,
					timestamps: { start: Math.round(startedAtMs) },
					assets: { large_image: LARGE_IMAGE_KEY, large_text: "Halcyon Launcher" },
					instance: false,
				},
			},
		})
	}

	async clear(): Promise<void> {
		if (!this.ready || this.socket === null) {
			return
		}
		this.send({
			cmd: "SET_ACTIVITY",
			nonce: randomUUID(),
			args: { pid: process.pid },
		})
	}

	private send(payload: unknown): void {
		try {
			this.socket?.write(encode(OPCODE_FRAME, payload))
		} catch (error) {
			this.logger.debug("Could not write a Discord presence frame", error)
			this.dispose()
		}
	}

	dispose(): void {
		const socket = this.socket
		if (socket !== null) {
			try {
				socket.write(encode(OPCODE_CLOSE, {}))
			} catch {
				this.logger.debug("Discord presence socket already closed")
			}
			socket.destroy()
		}
		this.socket = null
		this.ready = false
	}
}
