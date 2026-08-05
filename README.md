<div align="center">

<img src="assets/branding/logo-wordmark.svg" alt="Halcyon Launcher" width="420">

**A premium, open source Minecraft launcher.**

Launch beautifully.

[![Build](https://github.com/jjbkl/YugiClient/actions/workflows/build.yml/badge.svg)](https://github.com/jjbkl/YugiClient/actions/workflows/build.yml)
[![Tests](https://github.com/jjbkl/YugiClient/actions/workflows/test.yml/badge.svg)](https://github.com/jjbkl/YugiClient/actions/workflows/test.yml)
[![Release](https://github.com/jjbkl/YugiClient/actions/workflows/release.yml/badge.svg)](https://github.com/jjbkl/YugiClient/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/license-MIT-7C5CFF)](LICENSE)

</div>

---

Halcyon is a desktop Minecraft launcher built around three ideas that most launchers get wrong:

1. **The domain logic is pure.** Version resolution, argument building, dependency solving, crash analysis and download scheduling live in `@halcyon/core`, a package with zero runtime dependencies that never touches the network or the filesystem. It is fully unit tested and can be reasoned about in isolation.
2. **Everything the user waits for is observable.** Every download reports bytes, speed, ETA, retries and failures through one queue, and every launch reports its full, redacted command line.
3. **Failures explain themselves.** A crash is not a wall of stack traces; Halcyon reads the log, names the mod or driver at fault, and tells you what to do next.

## Contents

- [Feature overview](#feature-overview)
- [Architecture](#architecture)
- [Project layout](#project-layout)
- [Requirements](#requirements)
- [Building from source](#building-from-source)
- [Testing](#testing)
- [Continuous integration and releases](#continuous-integration-and-releases)
- [Plugin API](#plugin-api)
- [Design rationale](#design-rationale)
- [Known limitations](#known-limitations)
- [License](#license)

## Feature overview

### Minecraft support

| Area | Support |
| --- | --- |
| Loaders | Vanilla, Fabric, Quilt, Forge, NeoForge |
| Versions | Every released version in the official manifest, including snapshots, pre-releases and release candidates |
| Java | Automatic detection, managed runtime downloads, per-instance override, validation before launch |
| Assets | Shared asset and library store, legacy virtual assets, checksum verification, repair |

### Instances

Unlimited instances, each with its own name, icon, background, version, loader, Java runtime, memory allocation, JVM arguments, window size, environment variables and Rich Presence toggle. Instances can be duplicated, renamed, favourited, exported to a portable archive, imported back, backed up and restored. Worlds, saves, screenshots, resource packs, shader packs, mods and logs are all browsable from inside the instance.

### Accounts

Microsoft OAuth device-code and authorisation-code flows, Xbox Live and XSTS token exchange, silent refresh, offline accounts for LAN play, unlimited stored accounts with nicknames and favourites, one-click switching, and encrypted token storage using the operating system keychain.

### Content

First-class Modrinth integration for mods, shaders, resource packs and datapacks: search with loader and version filters, browse categories, read descriptions and changelogs, inspect dependencies, install with one click, and let Halcyon resolve required dependencies automatically. Local management covers enable, disable, bulk operations, drag and drop installation, update checks, duplicate detection and missing dependency detection.

### Quality of life

A dashboard with quick launch, recently played, play statistics and featured content. A command palette bound to `Ctrl/Cmd + K`. A log viewer with filtering, search, error highlighting and crash explanations. A theming engine with dark, light and AMOLED bases, custom accent colours, blur, transparency, corner radius and UI scaling. Silent background updates with release notes.

## Architecture

Halcyon is an Electron application, but the Electron parts are deliberately thin. Dependencies point inwards: the renderer knows about the IPC contract, the main process knows about the contract and the domain, and the domain knows about nothing.

```
┌──────────────────────────────────────────────────────────────┐
│ renderer  React + Vite                                       │
│ pages, components, stores, theming                           │
└───────────────────────────┬──────────────────────────────────┘
                            │ window.halcyon (typed, contextBridge)
┌───────────────────────────┴──────────────────────────────────┐
│ preload   contextBridge surface generated from the contract   │
└───────────────────────────┬──────────────────────────────────┘
                            │ @halcyon/ipc  channel + payload types
┌───────────────────────────┴──────────────────────────────────┐
│ main      DI container, IPC handlers, services                │
│ http, downloads, mojang, loaders, modrinth, auth, java,       │
│ instances, mods, skins, backups, launch, updates, plugins     │
└───────────────────────────┬──────────────────────────────────┘
                            │ ports (interfaces only)
┌───────────────────────────┴──────────────────────────────────┐
│ core      pure domain, zero dependencies, fully unit tested   │
│ rules, maven, libraries, inheritance, version ordering,       │
│ java requirements, launch arguments, dependency resolution,    │
│ compatibility, crash analysis, progress, download queue        │
└──────────────────────────────────────────────────────────────┘
```

Services never construct their own collaborators. They receive interfaces through a small typed container, which is what makes the domain testable without a network, a filesystem or an Electron process.

## Project layout

```
halcyon/
├── .github/workflows/        build.yml, test.yml, release.yml
├── assets/branding/          logo, icon, splash, wordmark (SVG sources)
├── docs/                     architecture, build, plugin API, IPC API
├── examples/plugins/         working example plugins
├── packages/
│   ├── core/                 pure domain logic and its unit tests
│   ├── ipc/                  shared IPC channel and payload contract
│   ├── main/                 Electron main process, services, container
│   ├── preload/              contextBridge bridge
│   ├── plugin-sdk/           public plugin API types and helpers
│   └── renderer/             React application
├── scripts/                  test runner, icon rasteriser, version injection
├── electron-builder.yml      packaging targets for Windows, Linux, macOS
└── package.json              npm workspaces root
```

## Requirements

- Node.js 20.11 or newer (Node 22 LTS recommended)
- npm 10 or newer
- Git
- Platform toolchain only if you package for that platform: Windows for NSIS installers, macOS for `.dmg`

## Building from source

```bash
git clone https://github.com/jjbkl/YugiClient.git
cd YugiClient
npm ci
npm run build          # compile core, ipc, main, preload and the renderer
npm start              # launch the app from source
npm run package        # produce installers for the current platform
```

See [docs/build.md](docs/build.md) for platform notes, code signing and reproducible builds.

## Testing

```bash
npm test               # unit and integration tests
npm run typecheck      # project-wide TypeScript check
npm run lint           # static analysis
npm run format:check   # formatting verification
```

The domain tests run on the Node test runner with no test framework dependency, so `npm test` works on a clean clone with nothing installed but the workspace itself. Integration tests exercise the service layer against in-memory ports and recorded fixtures instead of live APIs, which keeps CI deterministic.

## Continuous integration and releases

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `test.yml` | push, pull request | Formatting, lint, typecheck, unit and integration tests on Linux, Windows and macOS |
| `build.yml` | push to `main`, pull request | Full build plus unsigned release binaries for every platform, uploaded as artifacts |
| `release.yml` | tag `v*` or a published release | Injects the version, builds and packages every target, generates a changelog, uploads assets and the auto-update manifest |

Release assets: portable Windows `.exe`, Windows NSIS installer, Linux AppImage, Linux `tar.gz`, macOS `.dmg` and `.zip`, plus `latest.yml`, `latest-linux.yml` and `latest-mac.yml` for `electron-updater`.

Versioning follows semantic versioning. `scripts/inject-version.mjs` writes the tag, commit and build number into the application at build time, so the About panel always matches the artifact it came from.

## Plugin API

Plugins are plain ES modules that export a factory. They receive a scoped, typed context and can subscribe to launcher events, add dashboard cards, register commands in the palette and read instance metadata.

```ts
import { definePlugin } from "@halcyon/plugin-sdk"

export default definePlugin({
	id: "playtime-tracker",
	name: "Playtime Tracker",
	version: "1.0.0",
	setup(context) {
		context.events.on("instance:exited", ({ instanceId, durationMs }) => {
			context.logger.info(`${instanceId} ran for ${Math.round(durationMs / 60000)} minutes`)
		})
	},
})
```

Full reference in [docs/plugin-api.md](docs/plugin-api.md); runnable examples in [examples/plugins](examples/plugins).

## Design rationale

**Why Electron rather than a native toolkit.** The UI is the product, and the UI here is dense, animated and constantly evolving. Electron trades memory for iteration speed and a single rendering model on all three platforms. The cost is mitigated by keeping the main process lean and doing all heavy work in the domain layer.

**Why a pure core.** Launcher bugs are almost always logic bugs: a wrong classpath separator, a native classifier that ignores architecture, a snapshot that sorts before a release, a dependency graph with a cycle. None of those need a network to reproduce, so none of them should need one to test. The domain package has no imports outside Node built-ins.

**Why one download queue.** Parallel downloads, retries with exponential backoff, pause and resume, ETA and speed all belong to the same problem. Solving it once and injecting the transport keeps every feature that downloads something consistent.

**Why crash analysis is a data table.** Signatures are declarative, each with a title, severity, explanation and remedies. Adding a new diagnosis is one entry and one test, not a new branch in a growing conditional.

## Known limitations

Honesty is more useful than marketing, so here is the current state:

- The domain package is verified by 104 unit tests that run in this repository today. The service layer that talks to Mojang, Modrinth, Microsoft and Adoptium is written against those APIs but was authored in an environment without outbound network access, so the first real end-to-end run should be treated as a smoke test.
- Branding assets ship as SVG sources. `npm run assets:icons` rasterises them to `.png`, `.ico` and `.icns` during packaging; CI does this before `electron-builder` runs.
- Code signing is not configured. Unsigned Windows builds show a SmartScreen prompt and unsigned macOS builds need `xattr -d com.apple.quarantine`. Add certificates as repository secrets to enable it.
- Forge and NeoForge installation uses the installer profile JSON. Very old Forge versions that require running the graphical installer are imported rather than installed.
- The 3D skin preview renders the player model, cape and elytra; it is not a full model editor.

## License

MIT. See [LICENSE](LICENSE).

Minecraft is a trademark of Mojang Synergies AB. Halcyon is an unofficial project and is not affiliated with or endorsed by Mojang or Microsoft.
