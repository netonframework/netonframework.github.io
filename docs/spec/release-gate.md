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

PrivChat provides `scripts/release-gate-smoke.sh`. It requires PostgreSQL, Redis and the PrivChat
service API on port 9090, plus an isolated database whose migrations have already been applied.

```bash
NETON_RELEASE_DB_URI='postgresql://user:password@localhost:5432/neton_release_gate_r0' \
  scripts/release-gate-smoke.sh
```

The script verifies migration state, runs two release-process cycles, waits after READY, calls the
health endpoint, sends SIGTERM and requires a zero exit code with the listening port released.

## Baseline rule

Passing macOS locally closes the macOS application path only. The release baseline is established
only after the Linux and Windows CI jobs pass on their native hosts. New architecture work must not
be used to bypass a failed release gate.
