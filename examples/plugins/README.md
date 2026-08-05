# Example plugins

Two complete, runnable plugins that demonstrate the Halcyon plugin API.

## Install one

1. Open **Plugins → Open plugins folder** in Halcyon.
2. Copy the plugin directory (for example `playtime-tracker`) into that folder.
3. Press **Reload plugins**.

Each directory contains a `halcyon.plugin.json` manifest and an ESM entry point.
Plugins run inside the main process, receive a narrow typed context and are fully
unloaded when disabled or reloaded — no restart required.

| Plugin | What it shows |
| --- | --- |
| `playtime-tracker` | Event subscriptions, session timing, dashboard cards, notifications |
| `library-insights` | Reading instances and settings, reacting to changes, formatting card content |

The full reference lives in [`docs/plugin-api.md`](../../docs/plugin-api.md).
