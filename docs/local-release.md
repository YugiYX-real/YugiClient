# Releasing without GitHub Actions

GitHub only bills Actions minutes for workflow runs. Creating a release and
uploading assets through the REST API is free, and so is building on your own
machine. This page describes how to ship a version of Halcyon when the Actions
quota is gone.

## What you need once

- Node 22 or newer
- A fine grained personal access token for `YugiYX-real/YugiClient` with
  **Contents: read and write**
- JDK 21 and Gradle, but only if you want the in game companion mod inside the
  build. Without them the launcher still works, it simply reports that this
  build does not carry the companion mod.

Never commit the token. Put it in the environment of the terminal you are
building from:

```powershell
$env:HALCYON_GITHUB_TOKEN = "your-token"
```

## Build and publish

```powershell
npm install
npm run version:inject -- v1.2.1
npm run verify
npm run build
npm run assets:icons
npx electron-builder --win --publish never
node scripts/publish-local.mjs v1.2.1
```

`electron-builder` writes the installer, the portable build, the zip and
`latest.yml` into `dist/`. `publish-local.mjs` then creates the release if it
does not exist yet, uploads every asset it finds in `dist/`, replaces any file
that was already attached under the same name, and finally marks the release as
the latest one. Because `latest.yml` goes up with the rest, the in app updater
treats a locally built release exactly like a release built by CI.

Useful flags:

- `--dir <folder>` publishes from somewhere other than `dist`
- `--notes <file>` uses a Markdown file as the release body

## Including the companion mod

```powershell
cd companion
gradle build --no-daemon
cd ..
mkdir -Force build\companion
copy companion\build\libs\halcyon-companion-*.jar build\companion\
```

Run this before `electron-builder`. The packaging configuration copies
`build/companion/*.jar` into the installer, and the launcher installs that jar
into every supported instance on launch.

## Keeping CI cheap when the quota returns

- Installers are no longer packaged on every push. The `Build` workflow only
  packages them when it is started by hand with the `binaries` input enabled.
- Releases build Windows only by default. Set the `RELEASE_MATRIX` repository
  variable to the full three platform matrix for a cross platform release.
- On a private repository Linux bills at one times, Windows at two times and
  macOS at ten times the rate, which is why macOS is never built automatically.
- A **public** repository has no Actions billing at all, and its release feed is
  readable without a token, which also removes the need for
  `HALCYON_GITHUB_TOKEN` in the launcher.
