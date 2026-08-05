# Architecture

Halcyon is an Electron application split into six packages with strictly one-way
dependencies. Nothing in the renderer can reach Node APIs, and nothing in the
main process imports React.

```
packages/core        pure TypeScript domain logic, zero Electron, fully unit tested
packages/ipc         the typed contract shared by every process boundary
packages/preload     context-isolated bridge, channel allowlist only
packages/main        services, dependency injection container, IPC handlers
packages/renderer    React 18 interface, design system, pages
packages/plugin-sdk  public types third-party plugins compile against
```

Dependency direction:

```
core  <-  main  ->  ipc  <-  preload  <-  renderer
                     ^                       |
                     +-----------------------+
              (renderer imports types only, never runtime code)
```

## packages/core

Pure functions and small classes with no I/O and no Electron imports, so they run
under `node --test` in milliseconds.

| Module                           | Responsibility                                                        |
| -------------------------------- | --------------------------------------------------------------------- |
| `minecraft/types.ts`             | Structural types for Mojang version manifests                         |
| `minecraft/rules.ts`             | Evaluates Mojang rule blocks against an OS/arch/feature environment   |
| `minecraft/maven.ts`             | Parses Maven coordinates into paths and URLs                          |
| `minecraft/libraries.ts`         | Selects libraries and native classifiers for a platform               |
| `minecraft/inheritance.ts`       | Merges loader version JSON onto its parent version                    |
| `minecraft/version-order.ts`     | Compares Minecraft version identifiers, including snapshots           |
| `minecraft/java-requirement.ts`  | Maps a version to its required Java major and component               |
| `minecraft/launch-arguments.ts`  | Builds JVM and game argument vectors with placeholder substitution    |
| `content/dependency-resolver.ts` | Topologically resolves Modrinth dependency graphs, detects cycles     |
| `diagnostics/crash-analysis.ts`  | Recognises eleven crash signatures and produces remedies              |
| `download/queue.ts`              | Concurrency-limited queue with retry, backoff, pause and cancellation |
| `download/progress.ts`           | Rolling throughput and ETA estimation                                 |
| `instances/compatibility.ts`     | Version-change assessment, loader migration rules, memory advice      |

Every module has a sibling `*.test.ts`. The suite currently holds **104 assertions
across 12 files** and needs no dependencies: `node scripts/run-tests.mjs`.

## packages/ipc

A single `IpcContract` type enumerates every channel as a function signature, plus
an `IpcEventMap` for pushed events. Helper types derive everything else:

```ts
type IpcChannel = keyof IpcContract
type IpcArgs<K extends IpcChannel> = Parameters<IpcContract[K]>
type IpcResult<K extends IpcChannel> = Awaited<ReturnType<IpcContract[K]>>
```

`IPC_CHANNELS` and `IPC_EVENTS` are `as const satisfies` arrays, and a
`CONTRACT_IS_FULLY_ENUMERATED` type assertion fails compilation if a channel is
added to the contract but missing from the runtime allowlist. The main process
registers handlers through an exhaustive `Handlers` map, so a missing handler is a
type error rather than a runtime rejection.

## packages/preload

Runs with `contextIsolation: true` and `nodeIntegration: false`. It exposes exactly
two objects:

- `window.halcyon` — `invoke`, `on`, `platform`, each validated against the
  allowlist before touching `ipcRenderer`.
- `window.halcyonFiles` — `pathFor(file)`, wrapping `webUtils.getPathForFile` so
  drag-and-drop can hand real paths to the main process without exposing `fs`.

Unknown channels throw before crossing the boundary.

## packages/main

### Infrastructure (`src/infra`)

| File            | Responsibility                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `paths.ts`      | Every directory Halcyon owns, derived once from `app.getPath`                                           |
| `logger.ts`     | Levelled file and console logger                                                                        |
| `events.ts`     | Typed event bus that fans out to windows and plugins                                                    |
| `json-store.ts` | Atomic read/update/write JSON persistence with defaults                                                 |
| `http.ts`       | Fetch wrapper: retries on 408/425/429/5xx, exponential backoff, conditional requests, hash verification |
| `fs-extra.ts`   | `pathExists`, recursive copy, safe remove, directory size                                               |
| `platform.ts`   | OS and architecture normalisation for Mojang rule evaluation                                            |

### Services (`src/services`)

Twenty single-responsibility services, each constructor-injected with an explicit
dependency object or positional dependencies — no service reaches for a global.

`download`, `version`, `java`, `adoptium`, `settings`, `loader`, `instance`,
`backup`, `modrinth`, `content`, `auth`, `skin`, `log`, `statistics`, `presence`,
`launch`, `version-change`, `update`, `plugin`, `dashboard`.

Notable flows:

- **Launch** (`launch-service.ts`): resolve version → assemble classpath and natives
  → verify or download assets → pick Java → build argument vectors → spawn → stream
  stdout and stderr into the instance log → emit `launch:progress` → record playtime.
- **Version change** (`version-change-service.ts`): assess direction, warn about
  loader-family migrations, list incompatible mods, optionally snapshot a backup,
  then install the target version and rewrite the instance config.
- **Updates** (`update-service.ts`): `electron-updater` with sha512 verification,
  release notes, and a rollback path that re-enables `allowDowngrade` and
  re-checks against the previous version.

### Composition (`src/container.ts`)

`createContainer()` is the only place where services are constructed. It wires
dependencies in topological order and exposes `dispose()` so every watcher, child
process and interval is released on quit. Handlers receive the container; they
never instantiate anything themselves.

## packages/renderer

- `lib/client.ts` — the only module that touches `window.halcyon`; everything else
  imports `invoke`, `subscribe`, `openExternal`, `openPath`, `filePathOf`.
- `lib/hooks.ts` — `useAsync`, `useIpcEvent`, `useSettings`, `useToasts`,
  `useDebounced`, `useKeyboardShortcut`, `useSelection`.
- `app/theme.ts` — writes CSS custom properties and `data-theme` /
  `data-animations` attributes; the theming engine is token substitution, so
  switching themes never re-renders the tree.
- `styles/global.css` — one token-driven stylesheet: dark, light and AMOLED themes,
  accent derivation, blur, radius, transparency and UI scale all read from tokens.
- `components/primitives.tsx` — the component library: buttons, cards, modals,
  tabs, toggles, sliders, drop zones, context menus, toasts, skeletons, empty
  states.
- `pages/*.tsx` — one page per route, each owning its data fetching through
  `useAsync` and refreshing from IPC events rather than polling.

Routing is a small in-memory reducer over `RouteId` — no router dependency and no
URL state to keep in sync with a desktop window.

## Data on disk

```
<userData>/
  halcyon.log                 launcher log
  settings.json               launcher preferences
  accounts.json               refresh tokens, encrypted at rest
  skins.json                  wardrobe index
  java.json                   detected and managed runtimes
  plugins.json                disabled plugin ids
  instances/<id>/             halcyon.instance.json, halcyon.content.json,
                              halcyon.state.json, mods/, resourcepacks/,
                              shaderpacks/, saves/, screenshots/, logs/
  versions/<id>/              version json, client jar, natives
  assets/                     shared object store with indexes
  libraries/                  Maven layout
  runtimes/<major>/           managed Temurin runtimes
  backups/<instance>/         zip snapshots
  plugins/<id>/               halcyon.plugin.json and entry point
```

Instances are self-contained: exporting one is a zip of its directory, and
importing validates the manifest before adopting it.

## Performance choices

- Downloads run through a concurrency-limited queue (default 8) with per-item
  retry and a shared throughput estimator.
- Assets are content-addressed, so switching versions re-uses everything already
  on disk; verification hashes only what the manifest claims.
- The version manifest is cached for six hours and revalidated conditionally.
- Modrinth responses are cached per query for the session.
- The renderer never polls: every list refreshes from a targeted IPC event.

## Testing strategy

| Layer       | How it is tested                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core`      | Unit tests over pure functions, including regression cases for crash signatures, version ordering and memory recommendations                            |
| Integration | Queue behaviour under failure and cancellation, dependency resolution over real Modrinth response shapes, inheritance merging over real loader profiles |
| Contract    | `CONTRACT_IS_FULLY_ENUMERATED` and the exhaustive `Handlers` map make channel drift a compile error                                                     |
| Static      | `tsc --noEmit` across every package, ESLint with type-aware rules, Prettier `--check`                                                                   |

CI runs all of it on Ubuntu, Windows and macOS.
