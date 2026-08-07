# Companion staging folder

The packaging pipeline builds `companion/` with Gradle and copies the resulting
`halcyon-companion-*.jar` into this folder before electron-builder runs. The jar
is then shipped inside the installer under `resources/companion/`, which is where
the launcher looks for it when it prepares a Fabric instance.

The jar is deliberately not committed. A checkout without a Gradle build simply
ships without the companion mod, and the launcher falls back to starting the game
without the in game overlay.
