# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems.

Use GitHub's private reporting instead:
[Security → Report a vulnerability](https://github.com/jjbkl/YugiClient/security/advisories/new).

Include the affected version, the platform, reproduction steps and, if you have one, a
proof of concept. You will get an acknowledgement within a few days, and a fix or a
mitigation plan once the report is confirmed.

## Supported versions

Only the latest release receives security fixes. The in-app updater keeps you on it
automatically unless you disabled automatic updates.

## How Halcyon handles your credentials

- Microsoft sign-in uses the OAuth device code flow. Halcyon never sees or stores your
  password.
- Only the refresh token is persisted, encrypted at rest with Electron's `safeStorage`,
  which is backed by DPAPI on Windows, Keychain on macOS and the platform secret service
  on Linux.
- Access tokens live in memory and are refreshed on demand.
- Nothing is sent anywhere except Microsoft, Mojang, Modrinth, Adoptium, the loader
  metadata services and GitHub for updates. Exported account files intentionally contain
  no tokens.

## Hardening in the application

- Renderer windows run with `contextIsolation: true`, `nodeIntegration: false` and
  `sandbox` enabled.
- Preload exposes two narrow bridges and rejects any channel that is not on the
  allowlist.
- The renderer is served with a Content Security Policy and cannot load remote scripts.
- Downloads are verified against upstream sha1 or sha512 hashes before use, and updates
  are verified before installation.
- External links open in the system browser, never in an application window.

## Third-party content

Mods, resource packs, shaders and plugins are arbitrary code from other people. Plugins
in particular run with main-process privileges. Install only what you trust; Halcyon
cannot sandbox them for you.
