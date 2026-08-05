import test from "node:test"
import assert from "node:assert/strict"

import { analyzeCrash, extractCrashReportPath, summarizeExitCode } from "./crash-analysis.ts"

test("detects heap exhaustion and explains the allocation limit", () => {
	const [diagnosis] = analyzeCrash(
		"[Render thread/ERROR]: java.lang.OutOfMemoryError: Java heap space",
	)
	assert.equal(diagnosis?.id, "out-of-memory")
	assert.equal(diagnosis?.severity, "fatal")
	assert.match(diagnosis?.explanation ?? "", /Java heap space/)
	assert.ok((diagnosis?.remedies.length ?? 0) > 0)
})

test("derives the required java version from the class file version", () => {
	const [diagnosis] = analyzeCrash(
		"java.lang.UnsupportedClassVersionError: net/fabricmc/loader/impl/launch/knot/KnotClient has been compiled by a more recent version of the Java Runtime (class file version 61.0), this version only recognizes up to 52.0",
	)
	assert.equal(diagnosis?.id, "unsupported-class-version")
	assert.match(diagnosis?.explanation ?? "", /Java 17/)
})

test("names the mixin config that failed", () => {
	const [diagnosis] = analyzeCrash(
		"Mixin apply failed: sodium.mixins.json:core.MixinMinecraft -> net.minecraft.client.Minecraft",
	)
	assert.equal(diagnosis?.id, "mixin-apply-failure")
	assert.match(diagnosis?.explanation ?? "", /sodium\.mixins\.json/)
})

test("detects missing loader dependencies", () => {
	const [diagnosis] = analyzeCrash(
		"Mod 'Iris Shaders' (iris) 1.6.9 requires any version of fabric-api, which is missing!",
	)
	assert.equal(diagnosis?.id, "fabric-missing-dependency")
	assert.match(diagnosis?.explanation ?? "", /fabric-api/)
})

test("detects duplicate mod ids", () => {
	const [diagnosis] = analyzeCrash("Duplicate mods found: sodium")
	assert.equal(diagnosis?.id, "duplicate-mods")
})

test("detects driver level graphics failures", () => {
	const [diagnosis] = analyzeCrash(
		"org.lwjgl.LWJGLException: Pixel format not accelerated",
	)
	assert.equal(diagnosis?.id, "gl-unsupported")
})

test("detects rejected sessions", () => {
	const [diagnosis] = analyzeCrash("Failed to login: The authentication servers are down")
	assert.equal(diagnosis?.id, "invalid-session")
	assert.equal(diagnosis?.severity, "error")
})

test("detects damaged archives", () => {
	const [diagnosis] = analyzeCrash("java.util.zip.ZipException: zip file is empty")
	assert.equal(diagnosis?.id, "corrupted-jar")
	assert.match(diagnosis?.remedies.join(" ") ?? "", /Verify files/)
})

test("returns nothing for clean logs", () => {
	assert.deepEqual(analyzeCrash("[main/INFO]: Setting user: Notch"), [])
})

test("orders by confidence and respects the limit", () => {
	const diagnoses = analyzeCrash(
		[
			"java.lang.OutOfMemoryError: Java heap space",
			"java.net.UnknownHostException: piston-meta.mojang.com",
			"Invalid session",
		].join("\n"),
		2,
	)
	assert.equal(diagnoses.length, 2)
	assert.equal(diagnoses[0]?.id, "out-of-memory")
	assert.ok((diagnoses[0]?.confidence ?? 0) >= (diagnoses[1]?.confidence ?? 0))
})

test("finds the crash report path for direct linking", () => {
	assert.equal(
		extractCrashReportPath(
			"# Full report saved to crash-reports/crash-2026-08-05_21.13.44-client.txt",
		),
		"crash-reports/crash-2026-08-05_21.13.44-client.txt",
	)
	assert.equal(extractCrashReportPath("no report here"), undefined)
})

test("exit codes are translated into plain language", () => {
	assert.match(summarizeExitCode(0, null), /closed normally/)
	assert.match(summarizeExitCode(1, null), /unhandled exception/)
	assert.match(summarizeExitCode(3221225477, null), /access violation/)
	assert.match(summarizeExitCode(null, "SIGKILL"), /SIGKILL/)
	assert.match(summarizeExitCode(137, null), /137/)
})
