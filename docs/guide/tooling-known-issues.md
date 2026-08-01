# Tooling Known Issues

## KSP AWT shutdown noise

On macOS, a completed Kotlin/Native KSP build may occasionally print an `AWT-EventQueue-0`
`NullPointerException` from IntelliJ's `FileDocumentManager` after a KSP task. This is tooling
shutdown noise when Gradle still reports `BUILD SUCCESSFUL`; it is not emitted by generated Neton
application code.

Rules:

- The Gradle exit code and task result remain authoritative. Never ignore a failed KSP task.
- Do not add application retries, `clean`, or exception suppression for this AWT stack trace.
- Keep Kotlin, KSP and Gradle versions pinned together and re-check the issue when upgrading them.
- A reproducible non-zero build failure must be tracked separately and blocks release validation.

Neton 1.0 builds on Kotlin `2.4.0` with the KSP plugin pinned at `2.3.10` (see `gradle/libs.versions.toml`).
