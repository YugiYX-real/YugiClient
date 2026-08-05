# Contributing to Halcyon

Thanks for wanting to help. This guide covers everything you need to get a change
merged.

## Getting set up

```bash
git clone https://github.com/jjbkl/YugiClient.git
cd YugiClient
npm install
npm run dev
```

Node 20.11 or newer and npm 10 or newer are required. See
[`docs/build.md`](docs/build.md) for platform specifics and environment variables.

## Before you open a pull request

```bash
npm run verify
```

That runs Prettier in check mode, ESLint, `tsc --noEmit` across every package and the
test suite. CI runs exactly the same commands on Ubuntu, Windows and macOS, so a green
`verify` locally means a green pipeline.

## Where code belongs

| Change | Package |
| --- | --- |
| Pure logic: version resolution, rules, argument building, diagnostics, queues | `packages/core` |
| A new IPC channel or event | `packages/ipc`, then a handler in `packages/main` |
| Filesystem, network, process or Electron work | `packages/main` |
| Interface, styling, screens | `packages/renderer` |
| Types third-party plugins compile against | `packages/plugin-sdk` |

Rules that keep the architecture honest:

- `packages/core` must not import Electron, Node built-ins that touch the outside
  world, or anything from `main`. It stays testable in isolation.
- The renderer talks to the main process only through `lib/client.ts`. Never reach for
  `window.halcyon` elsewhere and never import Node modules.
- Adding a channel means adding it to `IpcContract` **and** `IPC_CHANNELS`. The type
  system will tell you if you forget the handler.
- Services receive their dependencies through the constructor and are wired in
  `container.ts`. No singletons, no module-level state.

## Style

Prettier and ESLint own formatting, so do not hand-tune it. Beyond that:

- Tabs, no semicolons, double quotes — whatever `npm run format` produces.
- Prefer explicit names over abbreviations, and early returns over nesting.
- Comment *why*, never *what*. Delete dead code instead of commenting it out.
- Handle errors where you can act on them; otherwise let them bubble to the IPC layer,
  which surfaces them to the user.
- No `any`. Narrow unknown data at the boundary instead.

## Tests

Every change to `packages/core` needs a test in the sibling `*.test.ts` file. The suite
uses the built-in `node:test` runner, so there is no framework to learn:

```bash
npm test
```

For changes in `main` or the renderer, describe in the pull request how you exercised
them manually, and add core-level tests for any logic you can extract.

## Commits

Conventional commits, because the release pipeline turns them into the changelog:

```
feat(renderer): add per-instance playtime chart
fix(main): keep natives when repairing an instance
docs: explain the plugin lifecycle
refactor(core): simplify library selection
test(core): cover snapshot version ordering
chore: bump electron-builder
ci: cache node modules
```

Keep each commit focused. Unrelated changes belong in separate pull requests.

## Pull requests

- Fill in the template, including how you verified the change.
- Screenshots are required for anything visual, before and after when you tweak
  existing screens.
- Draft pull requests are welcome for early feedback.

## Reporting bugs

Open a bug report and attach an exported log: **Logs** → **Export**. Include your
Halcyon version from **Settings** → **About**, your operating system and the instance
setup. Please do not report crashes caused by mods without first checking
**Logs** → crash analysis, which usually names the culprit.

## Security

Do not open a public issue for vulnerabilities. See [SECURITY.md](SECURITY.md).

## Licence

Contributions are accepted under the [MIT licence](LICENSE). Only submit code you have
the right to contribute, and never copy assets, branding or code from other launchers.
