# Changelog

All notable changes to Halcyon are documented here. This project follows
[semantic versioning](https://semver.org/). Release notes on GitHub are generated from
the commit history by the release pipeline; this file records the human summary.

## [Unreleased]

Nothing yet.

## [1.0.0]

The first Halcyon release.

### Added

- **Instances** — unlimited instances with custom name, icon, background, group and
  notes; per-instance Java executable, memory, JVM arguments, resolution, fullscreen and
  environment variables; duplicate, rename, favourite, export, import and import of
  official launcher profiles; verify and repair against the upstream manifest.
- **Loaders and versions** — Vanilla, Fabric, Forge, NeoForge and Quilt on every released
  Minecraft version, with installation, deletion, favourites, recently played and file
  verification.
- **Version changer** — compatibility assessment, mod warnings, Java requirement diffs,
  loader migration where possible and an automatic backup before the switch.
- **Backups** — zip snapshots with notes, restore and delete.
- **Modrinth** — search and browse mods, shaders, resource packs and datapacks with
  categories, screenshots, descriptions, changelogs and dependency graphs; one-click
  install with automatic dependency resolution; update checking with bulk apply.
- **Content managers** — enable, disable, delete and import in bulk; drag and drop jar and
  zip installation; duplicate, conflict and missing-dependency detection.
- **Accounts** — Microsoft sign-in over the OAuth device code flow with encrypted refresh
  tokens, unlimited Microsoft and offline accounts, nicknames, favourites, fast switching,
  import and export.
- **Skins** — wardrobe with upload, download, history, favourites, classic and slim models
  and a live 3D preview.
- **Java** — automatic detection, managed Temurin runtimes for 8, 17 and 21, manual
  selection, validation and a JVM argument editor.
- **Downloads** — concurrency-limited queue with progress, speed, ETA, pause, resume,
  retry and cancel.
- **Dashboard** — news, recently played, favourites, installed versions, featured Modrinth
  content, play statistics, account overview, update status and plugin cards.
- **Logs and diagnostics** — launcher and instance logs with level filters, search, follow
  mode, copy and export, plus crash analysis covering eleven signatures with plain-language
  explanations and remedies.
- **Theming** — dark, light and AMOLED themes, six accent presets or any custom colour,
  adjustable corner radius, transparency, blur, wallpapers and UI scaling; eight
  languages; motion controls down to fully reduced animation.
- **Interface** — sidebar navigation, command palette, keyboard shortcuts, context menus
  and drag and drop throughout.
- **Auto updates** — background checks, verified downloads, release notes and rollback.
- **Plugins** — plugin host with a typed SDK, event subscriptions, dashboard
  contributions, notifications and two working examples.
- **Engineering** — six-package architecture, a compile-time IPC contract, dependency
  injection container, 104 assertions in a zero-dependency test suite, and CI that runs
  formatting, lint, type checks and tests on Ubuntu, Windows and macOS.
- **Packaging** — Windows installer and portable executable, Linux AppImage and tar.gz,
  macOS dmg and zip, with automated releases, generated changelogs, version injection and
  update manifests.
