# Plugin API

Halcyon loads plugins from `<userData>/plugins`. A plugin is a directory with a
manifest and an ES module entry point. Plugins run in the main process, receive a
narrow typed context, and are fully unloaded when disabled or reloaded — no
restart required.

The current API version is **1**.

## Layout

```
plugins/
  my-plugin/
    halcyon.plugin.json
    index.mjs
```

### `halcyon.plugin.json`

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "What it does.",
  "author": "You",
  "apiVersion": 1,
  "main": "index.mjs"
}
```

| Field         | Required | Notes                                                      |
| ------------- | -------- | ---------------------------------------------------------- |
| `id`          | yes      | Unique, stable, used as the storage key                    |
| `name`        | yes      | Shown on the Plugins page                                  |
| `version`     | yes      | Semantic version string                                    |
| `description` | no       | One sentence                                               |
| `author`      | no       | Free text                                                  |
| `apiVersion`  | yes      | Must equal 1; a mismatch is reported instead of loaded     |
| `main`        | yes      | Path to the entry module, relative to the plugin directory |

## Entry point

Export a default object (or named exports) with `activate` and optionally
`deactivate`:

```js
export default {
  async activate(context) {
    context.log(`hello from ${context.plugin.id}`)

    context.on("launch:progress", (payload) => {
      if (payload.state === "running") {
        context.notify("info", "Have fun")
      }
    })

    const instances = await context.instances()
    context.registerCard({
      title: "My Plugin",
      body: `${instances.length} instances ready`,
      accent: "#7C5CFF",
    })
  },

  deactivate() {
    // release anything activate() created
  },
}
```

Both hooks may be async. Errors thrown during activation are caught, surfaced on
the plugin card on the Plugins page, and never affect the launcher.

## The context

```ts
type PluginContext = {
  readonly launcher: { name: string; version: string; apiVersion: number }
  readonly plugin: { id: string; directory: string }
  log(message: string): void
  on(event: PluginHostEvent, listener: (payload: unknown) => void): void
  registerCard(card: { title: string; body: string; accent?: string | null }): void
  notify(kind: ToastKind, message: string, detail?: string | null): void
  instances(): Promise<readonly InstanceSummary[]>
  settings(): Promise<Settings>
}
```

| Member         | Behaviour                                                                            |
| -------------- | ------------------------------------------------------------------------------------ |
| `log`          | Writes to the launcher log, prefixed with your plugin id                             |
| `on`           | Subscribes to a host event. Subscriptions are tracked and disposed for you on unload |
| `registerCard` | Contributes a card to the dashboard. Call it again to publish updated content        |
| `notify`       | Raises an in-app toast. `kind` is `info`, `success`, `warning` or `error`            |
| `instances`    | Current instance summaries, including running state, mod count and size              |
| `settings`     | The launcher settings snapshot                                                       |

## Events

| Event               | Payload                                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `launch:progress`   | `{ instanceId, state, detail, fraction, exitCode }`. States are `preparing`, `resolving`, `downloading`, `installing`, `launching`, `running`, `exited`, `error` |
| `instances:changed` | `{ instanceId: string \| null }`                                                                                                                                 |
| `downloads:changed` | The full download snapshot: items, bytes, speed, ETA, failures                                                                                                   |
| `settings:changed`  | The updated settings object                                                                                                                                      |

These are the same events the interface consumes, so a plugin always sees exactly
what the user sees.

## Type safety

Plugins written in TypeScript can compile against the published contract:

```ts
import { definePlugin } from "@halcyon/plugin-sdk"
import type { PluginContext } from "@halcyon/plugin-sdk"

export default definePlugin({
  activate(context: PluginContext) {
    context.log("typed and checked")
  },
})
```

Compile to ESM and point `main` at the emitted `.mjs` file. `@halcyon/plugin-sdk`
also exports `PLUGIN_API_VERSION`, `PLUGIN_MANIFEST_FILE`, `PluginManifest`,
`PluginHostEvent`, `PluginCardInput` and `supportsApiVersion`.

## Lifecycle guarantees

1. On startup, and on **Reload plugins**, every loaded plugin is deactivated first.
2. Manifests are read, API versions checked, entry points verified to exist.
3. Enabled plugins are imported and activated in directory order.
4. Disabling a plugin persists its id and triggers a reload cycle.
5. On quit, the container disposes the plugin host, which awaits every
   `deactivate` before the process exits.

## Boundaries

Plugins have main-process privileges, so install only code you trust. They cannot
reach into the renderer directly — dashboard cards and toasts are the supported
way to reach the user. Anything more invasive should be proposed as an API
addition so it can be reviewed and versioned.

## Examples

| Example                                                                     | Demonstrates                                                               |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [`examples/plugins/playtime-tracker`](../examples/plugins/playtime-tracker) | Event subscriptions, session timing, live card updates, notifications      |
| [`examples/plugins/library-insights`](../examples/plugins/library-insights) | Reading instances and settings, reacting to changes, formatted card bodies |
