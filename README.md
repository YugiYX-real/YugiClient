<div align="center">

<img src="assets/branding/logo.svg" alt="Halcyon" width="120" />

# Halcyon Launcher

**Launch beautifully.**

A premium, open source Minecraft launcher for Vanilla, Fabric, Forge, NeoForge and Quilt,
built on Electron, React and a fully typed process boundary.

[![Test](https://github.com/YugiYX-real/YugiClient/actions/workflows/test.yml/badge.svg)](https://github.com/YugiYX-real/YugiClient/actions/workflows/test.yml)
[![Build](https://github.com/YugiYX-real/YugiClient/actions/workflows/build.yml/badge.svg)](https://github.com/YugiYX-real/YugiClient/actions/workflows/build.yml)
[![Release](https://github.com/YugiYX-real/YugiClient/actions/workflows/release.yml/badge.svg)](https://github.com/YugiYX-real/YugiClient/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-7C5CFF.svg)](LICENSE)

</div>

---

## Why Halcyon

Most launchers make you choose between a beautiful interface and real control over your
installation. Halcyon refuses the trade-off: an aurora-lit interface with an honest,
tested engine underneath and no telemetry you did not ask for.

- **Fast** — parallel, resumable downloads with a concurrency-limited queue, a
  content-addressed asset store, and launch paths that verify only what actually changed.
- **Stable** — the domain layer is pure TypeScript with 104 assertions in a
  zero-dependency test suite, and every IPC channel is a compile-time contract.
- **Yours** — unlimited instances, per-instance Java, JVM arguments, memory, window
  settings and environment variables. Export any instance as a single file.

## Features

### Instances

- Unlimited instances with custom name, icon, background, group and notes
- Vanilla, Fabric, Forge, NeoForge and Quilt on every released Minecraft version
- Per-instance Java executable, memory, JVM arguments, resolution, fullscreen and
  environment variables
- Duplicate, rename, favourite, export, import, and import your official launcher profiles
- Repair and verify installations against the upstream manifest
- Backups with notes, one-click restore, and automatic snapshots before risky changes
- Version changer with compatibility assessment, mod warnings, loader migration and
  Java requirement diffs

### Content

- Full Modrinth integration for mods, shaders, resource packs and datapacks
- Search, categories, screenshots, descriptions, changelogs and dependency graphs
- One-click install with automatic dependency resolution
- Update checker with bulk apply, plus conflict, duplicate and missing-dependency detection
- Drag and drop jar and zip installation, bulk enable, disable and delete

### Accounts and skins

- Microsoft sign-in through OAuth with refresh tokens encrypted at rest
- Unlimited Microsoft accounts, nicknames, favourites and one-click switching
- Automatic background session renewal
- In-launcher skin wardrobe with upload, history, favourites, classic and slim models
- In-launcher owned-cape selection and cape hiding
- Minecraft skin-face portraits throughout the account interface

### Java, downloads and diagnostics

- Automatic Java detection, managed Temurin runtimes for 8, 17 and 21, manual selection
  and validation
- Download manager with progress, speed, ETA, pause, resume, retry and cancel
- Log viewer with level filters, search, follow mode, copy and export
- Crash analysis that recognises eleven signatures and explains them in plain language

### Interface

- Original design system: dark, light and AMOLED themes, six accent presets or any custom
  colour, adjustable corner radius, transparency, blur and UI scale
- Command palette, keyboard shortcuts, context menus, drag and drop everywhere
- Dashboard with news, recently played, favourites, featured content, play statistics and
  plugin cards
- Eight languages, motion controls down to fully reduced animation

### Platform

- Automatic updates with sha512 verification, release notes and rollback
- Plugin API with an event system, dashboard contributions and a typed SDK
- Windows installer and portable exe, Linux AppImage and tar.gz, macOS dmg and zip

## Install

Grab the latest build from [Releases](https://github.com/YugiYX-real/YugiClient/releases):

| Platform | File                                                               |
| -------- | ------------------------------------------------------------------ |
| Windows  | `Halcyon-<version>-setup.exe` or `Halcyon-<version>-portable.exe`  |
| Linux    | `Halcyon-<version>-x64.AppImage` or `Halcyon-<version>-x64.tar.gz` |
| macOS    | `Halcyon-<version>-x64.dmg`                                        |

Builds are currently unsigned, so Windows SmartScreen and macOS Gatekeeper will ask for
confirmation on first launch.

## Develop

```bash
git clone https://github.com/YugiYX-real/YugiClient.git
cd YugiClient
npm install
npm run dev
```

| Command           | Purpose                                |
| ----------------- | -------------------------------------- |
| `npm run dev`     | Hot-reloading development build        |
| `npm run verify`  | Formatting, lint, type check and tests |
| `npm test`        | Zero-dependency test suite             |
| `npm run build`   | Bundle main, preload and renderer      |
| `npm run package` | Installers for the current platform    |

Full instructions, environment variables and troubleshooting live in
[`docs/build.md`](docs/build.md).

## Architecture

```
packages/core        pure domain logic, no Electron, 104 assertions
packages/ipc         the typed contract shared across every boundary
packages/preload     context-isolated bridge with a channel allowlist
packages/main        twenty services behind a dependency injection container
packages/renderer    React 18 interface, design system, ten screens
packages/plugin-sdk  public types for third-party plugins
```

The renderer never touches Node. Preload exposes exactly two objects and rejects unknown
channels. The main process registers an exhaustive handler map, so adding a channel
without a handler fails the type check rather than a user's click.

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — packages, services, flows, data layout
- [`docs/api.md`](docs/api.md) — every IPC channel and event
- [`docs/plugin-api.md`](docs/plugin-api.md) — writing plugins
- [`docs/build.md`](docs/build.md) — building, packaging and releasing

## Plugins

Drop a folder with a `halcyon.plugin.json` and an ES module into
`<userData>/plugins`, then press **Reload plugins**. Plugins subscribe to launch,
instance, download and settings events, contribute dashboard cards and raise
notifications.

Two working examples ship in [`examples/plugins`](examples/plugins), and
`@halcyon/plugin-sdk` provides the types.

## Contributing

Issues and pull requests are welcome. Run `npm run verify` before opening a pull request;
CI runs the same checks on Ubuntu, Windows and macOS. Please include screenshots for
interface changes.

## Author and license

Halcyon Launcher and its packages are authored and copyrighted solely by **YugiYX**.
The project is distributed under the [MIT License](LICENSE).

Halcyon is an independent project. It is not affiliated with, endorsed by or sponsored by
Mojang Studios or Microsoft. Minecraft is a trademark of Mojang Studios. Modrinth is a
trademark of Rinth, Inc.; Halcyon uses its public API as a client.
