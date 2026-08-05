# IPC API reference

Every interaction between the interface and the main process goes through one
typed contract in `packages/ipc/src/contract.ts`. The renderer calls
`invoke(channel, ...args)`; the main process registers an exhaustive handler map.
Adding a channel to the contract without a handler is a compile error.

```ts
import { invoke, subscribe } from "@renderer/lib/client.ts"

const instances = await invoke("instances:list")
const stop = subscribe("launch:progress", (progress) => console.log(progress.state))
```

## Application

| Channel            | Signature                  |
| ------------------ | -------------------------- |
| `app:info`         | `() => AppInfo`            |
| `app:openPath`     | `(target: string) => void` |
| `app:openExternal` | `(url: string) => void`    |
| `app:relaunch`     | `() => void`               |

## Settings

| Channel                  | Signature                                                                |
| ------------------------ | ------------------------------------------------------------------------ |
| `settings:get`           | `() => Settings`                                                         |
| `settings:update`        | `(patch: Partial<Settings>) => Settings`                                 |
| `settings:reset`         | `() => Settings`                                                         |
| `settings:pickDirectory` | `(purpose: "download" \| "screenshot" \| "instances") => string \| null` |
| `settings:pickImage`     | `() => string \| null`                                                   |

## Dashboard

| Channel          | Signature             |
| ---------------- | --------------------- |
| `dashboard:load` | `() => DashboardData` |

`DashboardData` bundles news, recently played, favourites, installed versions,
featured Modrinth mods, shaders and resource packs, play statistics, the selected
account, update status and plugin cards in a single round trip.

## Versions and loaders

| Channel             | Signature                                                             |
| ------------------- | --------------------------------------------------------------------- |
| `versions:list`     | `(filter: VersionFilter) => readonly VersionEntry[]`                  |
| `versions:refresh`  | `() => void`                                                          |
| `versions:favorite` | `(versionId: string, favorite: boolean) => void`                      |
| `versions:install`  | `(versionId: string) => VerificationReport`                           |
| `versions:verify`   | `(versionId: string) => VerificationReport`                           |
| `versions:delete`   | `(versionId: string) => void`                                         |
| `loaders:list`      | `(loader: LoaderId, gameVersion: string) => readonly LoaderVersion[]` |

## Instances

| Channel                         | Signature                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| `instances:list`                | `() => readonly InstanceSummary[]`                                                     |
| `instances:get`                 | `(instanceId: string) => InstanceSummary \| null`                                      |
| `instances:create`              | `(input: CreateInstanceInput) => InstanceSummary`                                      |
| `instances:update`              | `(instanceId: string, patch: InstancePatch) => InstanceSummary`                        |
| `instances:rename`              | `(instanceId: string, name: string) => InstanceSummary`                                |
| `instances:duplicate`           | `(instanceId: string, name: string \| null) => InstanceSummary`                        |
| `instances:delete`              | `(instanceId: string) => void`                                                         |
| `instances:assessVersionChange` | `(instanceId: string, request: VersionChangeRequestDto) => VersionChangeAssessmentDto` |
| `instances:changeVersion`       | `(instanceId: string, request: VersionChangeRequestDto) => InstanceSummary`            |
| `instances:verify`              | `(instanceId: string) => VerificationReport`                                           |
| `instances:repair`              | `(instanceId: string) => VerificationReport`                                           |
| `instances:export`              | `(instanceId: string) => string \| null`                                               |
| `instances:import`              | `() => InstanceSummary \| null`                                                        |
| `instances:importOfficial`      | `() => readonly InstanceSummary[]`                                                     |
| `instances:openFolder`          | `(instanceId: string, subFolder: string \| null) => void`                              |
| `instances:launch`              | `(instanceId: string, accountId: string \| null) => LaunchResult`                      |
| `instances:stop`                | `(instanceId: string) => void`                                                         |
| `instances:worlds`              | `(instanceId: string) => readonly WorldEntry[]`                                        |
| `instances:screenshots`         | `(instanceId: string) => readonly ScreenshotEntry[]`                                   |
| `instances:backups`             | `(instanceId: string) => readonly BackupEntry[]`                                       |
| `instances:createBackup`        | `(instanceId: string, note: string) => BackupEntry`                                    |
| `instances:restoreBackup`       | `(instanceId: string, backupId: string) => InstanceSummary`                            |
| `instances:deleteBackup`        | `(instanceId: string, backupId: string) => void`                                       |

## Content

`ContentKind` is `mod`, `resourcepack`, `shaderpack` or `datapack`.

| Channel                | Signature                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| `content:list`         | `(instanceId: string, kind: ContentKind) => readonly ContentEntry[]`                              |
| `content:setEnabled`   | `(instanceId: string, kind: ContentKind, fileNames: readonly string[], enabled: boolean) => void` |
| `content:delete`       | `(instanceId: string, kind: ContentKind, fileNames: readonly string[]) => void`                   |
| `content:import`       | `(instanceId: string, kind: ContentKind, filePaths: readonly string[]) => InstallOutcome`         |
| `content:checkUpdates` | `(instanceId: string, kind: ContentKind) => readonly ContentEntry[]`                              |
| `content:applyUpdates` | `(instanceId: string, kind: ContentKind, fileNames: readonly string[]) => InstallOutcome`         |
| `content:analyze`      | `(instanceId: string) => ModAnalysis`                                                             |
| `content:openFolder`   | `(instanceId: string, kind: ContentKind) => void`                                                 |

Disabled files are suffixed `.disabled` on disk, so the game never sees them and
re-enabling is instant.

## Modrinth

| Channel               | Signature                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `modrinth:search`     | `(query: ModrinthSearchQuery) => ModrinthSearchResult`                                                     |
| `modrinth:project`    | `(idOrSlug: string) => ModrinthProjectDetail`                                                              |
| `modrinth:versions`   | `(projectId: string, gameVersion: string \| null, loader: LoaderId \| null) => readonly ModrinthVersion[]` |
| `modrinth:categories` | `(kind: ContentKind) => readonly string[]`                                                                 |
| `modrinth:install`    | `(instanceId: string, versionId: string, withDependencies: boolean) => InstallOutcome`                     |

## Accounts and skins

| Channel                   | Signature                                             |
| ------------------------- | ----------------------------------------------------- |
| `accounts:list`           | `() => readonly Account[]`                            |
| `accounts:loginMicrosoft` | `() => Account`                                       |
| `accounts:addOffline`     | `(username: string) => Account`                       |
| `accounts:select`         | `(accountId: string) => void`                         |
| `accounts:remove`         | `(accountId: string) => void`                         |
| `accounts:update`         | `(accountId: string, patch: AccountPatch) => Account` |
| `accounts:refresh`        | `(accountId: string) => Account`                      |
| `accounts:export`         | `() => string \| null`                                |
| `accounts:import`         | `() => readonly Account[]`                            |
| `skins:list`              | `() => readonly SkinEntry[]`                          |
| `skins:upload`            | `(input: SkinUploadInput) => SkinEntry \| null`       |
| `skins:apply`             | `(skinId: string) => SkinEntry`                       |
| `skins:favorite`          | `(skinId: string, favorite: boolean) => SkinEntry`    |
| `skins:remove`            | `(skinId: string) => void`                            |
| `skins:download`          | `(skinId: string) => string \| null`                  |

`skins:download` accepts the sentinel id `"account"`, which imports the signed-in
account's current skin into the wardrobe instead of exporting a stored one.

## Java, downloads, logs, updates, plugins

| Channel                 | Signature                                                       |
| ----------------------- | --------------------------------------------------------------- |
| `java:list`             | `() => readonly JavaRuntime[]`                                  |
| `java:detect`           | `() => readonly JavaRuntime[]`                                  |
| `java:install`          | `(major: number) => JavaRuntime`                                |
| `java:validate`         | `(executablePath: string) => JavaRuntime`                       |
| `java:pick`             | `() => JavaRuntime \| null`                                     |
| `downloads:snapshot`    | `() => DownloadSnapshot`                                        |
| `downloads:pause`       | `() => DownloadSnapshot`                                        |
| `downloads:resume`      | `() => DownloadSnapshot`                                        |
| `downloads:retryFailed` | `() => DownloadSnapshot`                                        |
| `downloads:cancel`      | `(itemId: string \| null) => DownloadSnapshot`                  |
| `logs:read`             | `(query: LogQuery) => LogBundle`                                |
| `logs:export`           | `(query: LogQuery) => string \| null`                           |
| `logs:analyze`          | `(instanceId: string) => readonly CrashDiagnosisDto[]`          |
| `updates:status`        | `() => UpdateStatus`                                            |
| `updates:check`         | `() => UpdateStatus`                                            |
| `updates:download`      | `() => UpdateStatus`                                            |
| `updates:install`       | `() => void`                                                    |
| `updates:rollback`      | `() => UpdateStatus`                                            |
| `plugins:list`          | `() => readonly PluginInfo[]`                                   |
| `plugins:setEnabled`    | `(pluginId: string, enabled: boolean) => readonly PluginInfo[]` |
| `plugins:reload`        | `() => readonly PluginInfo[]`                                   |
| `plugins:openFolder`    | `() => void`                                                    |

## Events

Subscribe with `subscribe(event, listener)`; the returned function unsubscribes.

| Event               | Payload                            |
| ------------------- | ---------------------------------- |
| `instances:changed` | `{ instanceId: string \| null }`   |
| `accounts:changed`  | `{ accounts: readonly Account[] }` |
| `settings:changed`  | `Settings`                         |
| `downloads:changed` | `DownloadSnapshot`                 |
| `launch:progress`   | `LaunchProgress`                   |
| `logs:appended`     | `{ source, instanceId, lines }`    |
| `updates:changed`   | `UpdateStatus`                     |
| `plugins:changed`   | `readonly PluginInfo[]`            |
| `toast`             | `Toast`                            |

## Crash diagnosis

`logs:analyze` matches instance logs and crash reports against eleven signatures:
`out-of-memory`, `unsupported-class-version`, `mixin-apply-failure`,
`fabric-missing-dependency`, `forge-missing-mandatory`, `duplicate-mods`,
`gl-unsupported`, `native-crash`, `invalid-session`, `network-unreachable` and
`corrupted-jar`. Each result carries a severity, a plain-language explanation,
ordered remedies, the matched evidence, a confidence score and the crash report
path when one exists.

## Error handling

Handlers reject with `Error`. The renderer surfaces the message through the toast
system and, where a page owns the failure, inline via `useAsync().error`. Unknown
channels are rejected in preload before they reach the main process.
