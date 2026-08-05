# Building Halcyon

## Requirements

| Tool    | Version                             |
| ------- | ----------------------------------- |
| Node.js | 20.11 or newer (22 LTS recommended) |
| npm     | 10 or newer                         |
| Git     | any recent version                  |

Platform extras:

- **Windows** — nothing beyond Node; NSIS ships with electron-builder.
- **Linux** — `libfuse2` is needed to _run_ an AppImage, not to build one.
- **macOS** — Xcode command line tools for code signing; unsigned builds work
  without them.

## First run

```bash
git clone https://github.com/jjbkl/YugiClient.git
cd YugiClient
npm install
npm run dev
```

`npm run dev` starts electron-vite: the main and preload bundles rebuild and
restart on change, the renderer hot-reloads.

## Everyday commands

| Command                                   | What it does                                                 |
| ----------------------------------------- | ------------------------------------------------------------ |
| `npm run dev`                             | Development with hot reload                                  |
| `npm run build`                           | Type-check and bundle main, preload and renderer into `out/` |
| `npm start`                               | Run the production bundle without packaging                  |
| `npm test`                                | Zero-dependency test suite via `scripts/run-tests.mjs`       |
| `npm run typecheck`                       | `tsc --noEmit` across every package                          |
| `npm run lint`                            | ESLint with type-aware rules                                 |
| `npm run format:check`                    | Prettier verification, exactly what CI runs                  |
| `npm run format`                          | Prettier write                                               |
| `npm run verify`                          | format:check, lint, typecheck and test in one go             |
| `npm run assets:icons`                    | Regenerate icons and the splash PNG from the SVG sources     |
| `npm run version:inject`                  | Write a tag version into `package.json`                      |
| `npm run package`                         | Installers for the current platform                          |
| `npm run package:win` / `:linux` / `:mac` | Target a single platform                                     |
| `npm run clean`                           | Remove `out/`, `dist/` and build caches                      |

## Artifacts

`npm run package` writes to `dist/`:

| Platform | Files                                                                  |
| -------- | ---------------------------------------------------------------------- |
| Windows  | `Halcyon-<version>-setup.exe` (NSIS), `Halcyon-<version>-portable.exe` |
| Linux    | `Halcyon-<version>-<arch>.AppImage`, `Halcyon-<version>-<arch>.tar.gz` |
| macOS    | `Halcyon-<version>-<arch>.dmg`, `Halcyon-<version>-<arch>.zip`         |

Each platform also emits the `latest*.yml` update manifest that the in-app updater
reads.

## Version and build numbers

Build-time constants are injected by `electron.vite.config.ts`:

| Constant           | Source                                                   |
| ------------------ | -------------------------------------------------------- |
| `__APP_VERSION__`  | `package.json` version                                   |
| `__BUILD_NUMBER__` | `GITHUB_RUN_NUMBER`, or `local`                          |
| `__COMMIT_SHA__`   | First seven characters of `GITHUB_SHA`, or `development` |
| `__BUILD_TIME__`   | ISO timestamp of the build                               |

CI calls `npm run version:inject v1.2.3` before packaging, which validates the tag
against semantic versioning and rewrites `package.json`.

## Optional environment variables

| Variable                    | Effect                                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `HALCYON_MSA_CLIENT_ID`     | Azure application (client) ID used for Microsoft sign-in. Falls back to the public Minecraft launcher client id, which works for personal use. |
| `HALCYON_DISCORD_CLIENT_ID` | Enables Discord Rich Presence. Presence stays disabled when unset.                                                                             |
| `GH_TOKEN`                  | Only needed when publishing releases locally; CI supplies `secrets.GITHUB_TOKEN`.                                                              |

### Registering your own Azure application

1. Azure Portal → **App registrations** → **New registration**.
2. Supported account types: **Personal Microsoft accounts only**.
3. Authentication → **Allow public client flows: Yes**. Halcyon uses the OAuth
   device code flow, so no redirect URI and no client secret are required.
4. Copy the Application (client) ID into `HALCYON_MSA_CLIENT_ID`.

Halcyon stores only the refresh token, encrypted at rest with Electron's
`safeStorage`. Access tokens live in memory and are refreshed on demand.

## Releasing

```bash
git tag v1.2.3
git push origin v1.2.3
```

`.github/workflows/release.yml` then injects the version, regenerates icons, builds
on all three platforms in parallel, generates a changelog from the commits since
the previous tag, uploads every artifact and update manifest to the GitHub Release
and publishes it.

## Troubleshooting

| Symptom                                        | Fix                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| `npm run build` cannot find the renderer entry | Run from the repository root; the renderer root is `packages/renderer` |
| Electron fails to start on Linux               | Install `libnss3`, `libatk1.0-0`, `libgtk-3-0`                         |
| An AppImage will not run                       | Install `libfuse2`                                                     |
| Microsoft sign-in returns 403                  | Your Azure app must allow public client flows and personal accounts    |
| Java download fails behind a proxy             | Set `HTTPS_PROXY`; the HTTP layer honours it                           |
