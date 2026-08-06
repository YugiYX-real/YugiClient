export type CrashSeverity = "fatal" | "error" | "warning"

export type CrashDiagnosis = {
	readonly id: string
	readonly title: string
	readonly severity: CrashSeverity
	readonly explanation: string
	readonly remedies: readonly string[]
	readonly evidence: string
	readonly confidence: number
}

type Signature = {
	readonly id: string
	readonly title: string
	readonly severity: CrashSeverity
	readonly pattern: RegExp
	readonly confidence: number
	explain(match: RegExpExecArray): string
	remedies(match: RegExpExecArray): readonly string[]
}

const SIGNATURES: readonly Signature[] = [
	{
		id: "out-of-memory",
		title: "Minecraft ran out of allocated memory",
		severity: "fatal",
		pattern: /java\.lang\.OutOfMemoryError(?::\s*(.+))?/,
		confidence: 0.95,
		explain: (match) =>
			`The JVM exhausted its heap${match[1] === undefined ? "" : ` (${match[1].trim()})`}. This is an allocation limit, not a lack of physical RAM.`,
		remedies: () => [
			"Raise the instance memory allocation, in 1 GB steps.",
			"Do not allocate more than about 60% of physical RAM; the rest is needed for the OS and off-heap buffers.",
			"Large modpacks with many chunk-loading mods benefit more from fewer mods than from more heap.",
		],
	},
	{
		id: "unsupported-class-version",
		title: "Java version is too old for this Minecraft build",
		severity: "fatal",
		pattern: /java\.lang\.UnsupportedClassVersionError[^\n]*?class file version (\d+)\.\d+/,
		confidence: 0.97,
		explain: (match) => {
			const classFile = Number(match[1] ?? "0")
			const needed = classFile - 44
			return `A class was compiled for Java ${needed} (class file version ${classFile}) but the selected runtime is older.`
		},
		remedies: () => [
			"Switch the instance to the Java runtime the version requires.",
			"Use the managed runtime download instead of a system JDK if you are unsure.",
		],
	},
	{
		id: "mixin-apply-failure",
		title: "A mod failed to apply its bytecode patches",
		severity: "fatal",
		pattern: /Mixin apply(?:ing)? failed:? ([\w.\-/]+)/i,
		confidence: 0.9,
		explain: (match) =>
			`The mixin config "${match[1] ?? "unknown"}" could not be applied, which almost always means one mod targets a different Minecraft or mod version than the one installed.`,
		remedies: () => [
			"Update the mod named in the mixin config, and its dependencies.",
			"Confirm every mod targets the instance's exact Minecraft version.",
			"Temporarily disable the named mod to confirm the culprit.",
		],
	},
	{
		id: "fabric-missing-dependency",
		title: "Missing mod dependencies",
		severity: "fatal",
		pattern: /requires\s+(?:any\s+)?versions?\s+(?:.*?\s+)?of\s+(?:mod\s+)?'?([\w\-.]+)/i,
		confidence: 0.88,
		explain: (match) =>
			`The loader refused to start because a required dependency is missing or the wrong version: ${match[1] ?? "unknown"}.`,
		remedies: () => [
			"Install the missing dependency; Halcyon can add it automatically from Modrinth.",
			"Run the dependency check on the instance's Mods tab.",
		],
	},
	{
		id: "forge-missing-mandatory",
		title: "Forge reported unsatisfied mandatory dependencies",
		severity: "fatal",
		pattern: /Missing or unsupported mandatory dependencies/i,
		confidence: 0.9,
		explain: () =>
			"Forge stopped during mod loading because at least one mod requires another mod or version that is not present.",
		remedies: () => [
			"Read the dependency table printed after this line; it lists each unmet requirement.",
			"Install the listed mods at the requested version range.",
		],
	},
	{
		id: "duplicate-mods",
		title: "The same mod is installed more than once",
		severity: "fatal",
		pattern: /Duplicate mod(?:s)?(?: found)?[:\s]+([\w\-. ]+)/i,
		confidence: 0.92,
		explain: (match) =>
			`Two jars provide the mod id "${match[1]?.trim() ?? "unknown"}". Loaders refuse to continue when a mod id is claimed twice.`,
		remedies: () => [
			"Remove the older jar; the Mods tab flags duplicates by project.",
			"Check whether a modpack already bundles the mod you added manually.",
		],
	},
	{
		id: "gl-unsupported",
		title: "Graphics driver could not provide a usable OpenGL context",
		severity: "fatal",
		pattern:
			/(Pixel format not accelerated|Failed to create window|GLFW error 65542|No OpenGL context)/i,
		confidence: 0.85,
		explain: () =>
			"The game could not create an accelerated OpenGL context. This is a driver or GPU-selection problem rather than a mod problem.",
		remedies: () => [
			"Update the GPU driver from the vendor, not through Windows Update.",
			"On laptops, force the discrete GPU for the Java runtime.",
			"Remote desktop and virtual machines usually cannot provide the required context.",
		],
	},
	{
		id: "native-crash",
		title: "The JVM crashed inside a native library",
		severity: "fatal",
		pattern:
			/EXCEPTION_ACCESS_VIOLATION|A fatal error has been detected by the Java Runtime Environment/i,
		confidence: 0.8,
		explain: () =>
			"The crash happened in native code, most often a graphics driver, an audio driver, or an overlay injecting itself into the process.",
		remedies: () => [
			"Close overlays such as recording, RGB, or performance overlays and retry.",
			"Update graphics and audio drivers.",
			"If the faulting frame names a shader library, disable shaders to confirm.",
		],
	},
	{
		id: "invalid-session",
		title: "The Minecraft session was rejected",
		severity: "error",
		pattern:
			/(Invalid session|Failed to login: The authentication servers|Invalid Session \(Try restarting)/i,
		confidence: 0.9,
		explain: () =>
			"The access token used to join servers was expired or rejected. Tokens are short lived and must be refreshed.",
		remedies: () => [
			"Halcyon refreshes Microsoft sessions automatically; retry the launch once.",
			"If the session is still rejected, sign out and sign in to Microsoft again.",
		],
	},
	{
		id: "network-unreachable",
		title: "A required host could not be reached",
		severity: "error",
		pattern:
			/java\.net\.(UnknownHostException|ConnectException|SocketTimeoutException)(?::\s*(\S+))?/,
		confidence: 0.75,
		explain: (match) =>
			`Networking failed (${match[1] ?? "connection error"}${match[2] === undefined ? "" : ` for ${match[2]}`}). Downloads and authentication both need outbound HTTPS.`,
		remedies: () => [
			"Check for a firewall, VPN, or proxy blocking the Java process.",
			"Retry the failed downloads from the Downloads panel.",
		],
	},
	{
		id: "corrupted-jar",
		title: "A jar or zip file on disk is damaged",
		severity: "fatal",
		pattern:
			/(zip file is empty|Invalid or corrupt jarfile|error in opening zip file|ZipException)/i,
		confidence: 0.85,
		explain: () =>
			"A downloaded archive is truncated or corrupt, usually from an interrupted download or an aggressive antivirus.",
		remedies: () => [
			"Run Verify files on the instance to re-download anything whose checksum does not match.",
			"Add the launcher data directory to the antivirus exclusion list if this recurs.",
		],
	},
]

export function analyzeCrash(log: string, limit = 5): readonly CrashDiagnosis[] {
	const diagnoses: CrashDiagnosis[] = []

	for (const signature of SIGNATURES) {
		const match = signature.pattern.exec(log)
		if (match === null) {
			continue
		}
		diagnoses.push({
			id: signature.id,
			title: signature.title,
			severity: signature.severity,
			explanation: signature.explain(match),
			remedies: signature.remedies(match),
			evidence: (match[0] ?? "").trim().slice(0, 400),
			confidence: signature.confidence,
		})
	}

	return diagnoses.sort((a, b) => b.confidence - a.confidence).slice(0, limit)
}

export function extractCrashReportPath(log: string): string | undefined {
	const match = /crash-reports[\\/][\w\-.]+\.txt/.exec(log)
	return match?.[0]
}

export function summarizeExitCode(code: number | null, signal: string | null): string {
	if (signal !== null) {
		return `The game process was terminated by ${signal}.`
	}
	if (code === null) {
		return "The game process ended without reporting an exit code."
	}
	if (code === 0) {
		return "The game closed normally."
	}
	if (code === 1) {
		return "The game exited with code 1, which usually means an unhandled exception during startup."
	}
	if (code === 3221225477) {
		return "The game exited with an access violation (0xC0000005), which points at a native driver crash."
	}
	return `The game exited with code ${code}.`
}
