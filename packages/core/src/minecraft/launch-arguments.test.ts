import test from "node:test"
import assert from "node:assert/strict"

import {
	MissingMainClassError,
	buildClasspath,
	buildLaunchInvocation,
	parseLegacyArguments,
	redactInvocation,
	substitutePlaceholders,
} from "./launch-arguments.ts"
import type { LaunchRequest } from "./launch-arguments.ts"
import type { HostPlatform, VersionJson } from "./types.ts"

const linux: HostPlatform = { os: "linux", arch: "x86_64", version: "6.8.0" }

const version: VersionJson = {
	id: "1.20.1",
	type: "release",
	mainClass: "net.minecraft.client.main.Main",
	assetIndex: { id: "5", url: "https://example.invalid/5.json", sha1: "a", size: 1 },
	libraries: [
		{
			name: "com.mojang:logging:1.1.1",
			downloads: {
				artifact: {
					path: "com/mojang/logging/1.1.1/logging-1.1.1.jar",
					url: "https://example.invalid/logging.jar",
				},
			},
		},
		{
			name: "org.lwjgl:lwjgl:3.3.1",
			natives: { linux: "natives-linux" },
			downloads: {
				classifiers: {
					"natives-linux": {
						path: "org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-natives-linux.jar",
						url: "https://example.invalid/native.jar",
					},
				},
			},
		},
		{
			name: "apple.only:cocoa:1.0",
			rules: [{ action: "allow", os: { name: "osx" } }],
		},
	],
	arguments: {
		jvm: ["-Djava.library.path=${natives_directory}", "-cp", "${classpath}"],
		game: [
			"--username",
			"${auth_player_name}",
			"--uuid",
			"${auth_uuid}",
			"--accessToken",
			"${auth_access_token}",
			{
				rules: [{ action: "allow", features: { has_custom_resolution: true } }],
				value: ["--width", "${resolution_width}", "--height", "${resolution_height}"],
			},
		],
	},
}

function request(overrides: Partial<LaunchRequest> = {}): LaunchRequest {
	return {
		version,
		platform: linux,
		javaExecutable: "/runtimes/17/bin/java",
		paths: {
			gameDir: "/instances/skyblock/minecraft",
			assetsDir: "/shared/assets",
			librariesDir: "/shared/libraries",
			nativesDir: "/instances/skyblock/natives",
			clientJar: "/shared/versions/1.20.1/1.20.1.jar",
		},
		session: {
			username: "Notch",
			uuid: "069a79f4-44e9-4726-a5be-fca90e38aaf5",
			accessToken: "super-secret-token",
			userType: "msa",
			xuid: "2535",
		},
		memory: { maxMb: 4096, minMb: 1024 },
		launcher: { name: "Halcyon", version: "1.0.0" },
		...overrides,
	}
}

test("substitutes known placeholders and leaves unknown ones intact", () => {
	assert.equal(substitutePlaceholders("${a}/${b}", { a: "x" }), "x/${b}")
})

test("classpath contains non-native libraries plus the client jar", () => {
	assert.deepEqual(buildClasspath(request()), [
		"/shared/libraries/com/mojang/logging/1.1.1/logging-1.1.1.jar",
		"/shared/versions/1.20.1/1.20.1.jar",
	])
})

test("builds a complete invocation in the documented order", () => {
	const invocation = buildLaunchInvocation(request())
	assert.equal(invocation.executable, "/runtimes/17/bin/java")
	assert.equal(invocation.args[0], "-Xms1024M")
	assert.equal(invocation.args[1], "-Xmx4096M")
	assert.equal(invocation.mainClass, "net.minecraft.client.main.Main")
	assert.ok(invocation.args.includes("-Djava.library.path=/instances/skyblock/natives"))
	assert.ok(invocation.args.includes("--username"))
	assert.ok(invocation.args.includes("Notch"))
	assert.equal(invocation.workingDirectory, "/instances/skyblock/minecraft")
})

test("main class precedes every game argument", () => {
	const invocation = buildLaunchInvocation(request())
	const mainIndex = invocation.args.indexOf("net.minecraft.client.main.Main")
	assert.ok(mainIndex > 0)
	assert.ok(invocation.args.indexOf("--username") > mainIndex)
	assert.ok(invocation.args.indexOf("-cp") < mainIndex)
})

test("classpath separator follows the host platform", () => {
	const invocation = buildLaunchInvocation(request())
	const classpathValue = invocation.args[invocation.args.indexOf("-cp") + 1] ?? ""
	assert.ok(classpathValue.includes(":"))
	assert.ok(!classpathValue.includes(";"))
})

test("feature gated resolution arguments are emitted only when requested", () => {
	const without = buildLaunchInvocation(request())
	assert.ok(!without.args.includes("--width"))

	const withResolution = buildLaunchInvocation(
		request({ window: { width: 1600, height: 900 } }),
	)
	assert.ok(withResolution.args.includes("--width"))
	assert.ok(withResolution.args.includes("1600"))
	assert.equal(withResolution.args.filter((arg) => arg === "--width").length, 1)
})

test("fullscreen replaces custom resolution flags", () => {
	const invocation = buildLaunchInvocation(request({ window: { fullscreen: true } }))
	assert.ok(invocation.args.includes("--fullscreen"))
	assert.ok(!invocation.args.includes("--width"))
})

test("user memory flags cannot override the instance allocation", () => {
	const invocation = buildLaunchInvocation(
		request({ extraJvmArgs: ["-Xmx512M", "-XX:+UseG1GC"] }),
	)
	assert.ok(!invocation.args.includes("-Xmx512M"))
	assert.ok(invocation.args.includes("-XX:+UseG1GC"))
	assert.ok(invocation.args.includes("-Xmx4096M"))
})

test("legacy versions fall back to minecraftArguments and default jvm flags", () => {
	const legacy: VersionJson = {
		id: "1.5.2",
		mainClass: "net.minecraft.client.Minecraft",
		minecraftArguments: "--username ${auth_player_name} --session ${auth_session}",
		libraries: [],
	}
	const invocation = buildLaunchInvocation(request({ version: legacy }))
	assert.ok(invocation.args.includes("--session"))
	assert.ok(invocation.args.includes("token:super-secret-token:069a79f4-44e9-4726-a5be-fca90e38aaf5"))
	assert.ok(invocation.args.includes("-cp"))
})

test("quick play arguments are appended for multiplayer joins", () => {
	const invocation = buildLaunchInvocation(
		request({ quickPlay: { kind: "multiplayer", address: "play.example.net" } }),
	)
	assert.ok(invocation.args.includes("--quickPlayMultiplayer"))
	assert.ok(invocation.args.includes("play.example.net"))
})

test("legacy argument parsing collapses whitespace", () => {
	assert.deepEqual(parseLegacyArguments("  --a   ${x}  ", { x: "1" }), ["--a", "1"])
})

test("missing main class is reported explicitly", () => {
	assert.throws(
		() => buildLaunchInvocation(request({ version: { id: "broken" } })),
		MissingMainClassError,
	)
})

test("invocations can be redacted before they reach logs", () => {
	const invocation = buildLaunchInvocation(request())
	const safe = redactInvocation(invocation, "super-secret-token")
	assert.ok(!safe.args.join(" ").includes("super-secret-token"))
	assert.ok(safe.args.includes("[redacted]"))
})
