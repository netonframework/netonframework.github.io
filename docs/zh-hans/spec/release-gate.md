# Neton 1.0 Release Gate R0

> Status: active release gate

Neton 1.0 is not release-ready until every mandatory gate below is green on the release commit.

## Mandatory gates

1. macOS framework foundation tests pass.
2. Linux `linuxX64` Core tests pass on a Linux runner.
3. Windows `mingwX64` Core tests pass on a Windows runner.
4. PrivChat aggregate application compilation passes.
5. A release binary passes migration `status` and `verify` against an isolated database.
6. The release binary completes two READY, HTTP health check and SIGTERM cycles.
7. After shutdown, the HTTP port is closed and application database connections return to zero.
8. Gradle emits no Gradle 9 deprecation warning.
9. KSP AWT shutdown noise remains documented and non-blocking; any task failure, missing generated
   source, no-clean instability or CI flake promotes it to a release blocker.

## Application smoke

PrivChat provides `scripts/release-gate-smoke.sh`. It requires locally available PostgreSQL,
`redis-server`, `psql`, `lsof`, the PrivChat server binary/configuration, and a freshly built
Application release binary. The script creates isolated databases, applies and verifies migrations,
and starts a private Redis and PrivChat service on non-default ports. It must not use production
databases or an already-running production service.

```bash
# Run from the PrivChat application repository. Set credentials through your local
# PostgreSQL authentication setup; do not commit them or print them in evidence.
./gradlew --warning-mode=fail -Pnetonstream.local=false :application:linkReleaseExecutableMacosArm64
bash scripts/test-release-checks.sh
PG_ADMIN_URI='postgresql://localhost/postgres' \
PG_BASE_URI='postgresql://localhost' \
  bash scripts/release-gate-smoke.sh
```

Override `NETON_RELEASE_BINARY` and `PRIVCHAT_SERVER_BIN` when binaries are outside the default
locations. Record the binary's build inputs and hash; an old binary is not evidence for changed code.

The script verifies migration state, runs two release-process cycles, waits after READY, calls the
health endpoint, sends SIGTERM and requires a zero exit code within 30 seconds with the listening
port released. For each cycle it queries `pg_stat_activity` through the maintenance database and
requires zero connections to the isolated application database **before teardown**. Forced database
cleanup is not proof of application resource release. Query errors or malformed counts fail closed.

## CI enforcement and evidence

- The framework Backend CI runs macOS foundation/conformance suites, native Linux/Windows tests,
  and real Redis contracts. Dedicated `ci/**` branches can validate fixes without merging them first.
- Native published-dependency jobs assert `netonstream.local=false` before settings evaluation.
  PowerShell must pass dotted Gradle properties as literal argument strings.
- Source-integration jobs use `tools/ci/protocol-sources.lock`. Update a pin when a framework change
  needs an API absent from the pinned source; do not patch or reset a developer's sibling checkout.
- Gradle commands use `--warning-mode=fail` so Gradle deprecations cannot silently pass the gate.
  Kotlin compiler warnings and the documented KSP AWT noise are separate from Gradle deprecations.
- A green framework CI is necessary, not sufficient: attach aggregate application build, migration,
  both process-cycle results, database connection checks, target, dependency revisions and binary hash
  to the same release candidate. A sample application does not replace the PrivChat aggregate gate.
- Retain failures as failures. Missing credentials, unavailable runners, skipped tests or an unbuilt
  service dependency mean the corresponding gate is unverified, never implicitly passed.

## Baseline rule

Passing macOS locally closes the macOS application path only. The release baseline is established
only after the Linux and Windows CI jobs pass on their native hosts. New architecture work must not
be used to bypass a failed release gate.
