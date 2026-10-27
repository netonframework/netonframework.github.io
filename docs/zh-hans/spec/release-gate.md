# Neton 1.0 Release Gate R0

> Status: active release gate

Neton 1.0 is not release-ready until every mandatory gate below is green on the release commit.

## Ownership boundary

This document defines reusable Framework release requirements. Neton Application owns the
acceptance of its generic modules and distribution. Product-specific modules, deployment
instructions, source inventories and acceptance results belong to the product's own repository.
No private product or proprietary service is a mandatory dependency of a Neton release gate.

## Mandatory gates

1. macOS framework foundation tests pass.
2. Linux `linuxX64` Core tests pass on a Linux runner.
3. Windows `mingwX64` Core tests pass on a Windows runner.
4. A documented, publicly reproducible reference integration application compiles against the candidate.
5. A release binary passes migration `status` and `verify` against an isolated database.
6. The release binary completes two READY, HTTP health check and SIGTERM cycles.
7. After shutdown, the HTTP port is closed and application database connections return to zero.
8. Gradle emits no Gradle 9 deprecation warning.
9. KSP AWT shutdown noise remains documented and non-blocking; any task failure, missing generated
   source, no-clean instability or CI flake promotes it to a release blocker.

## Reference integration smoke contract

The candidate manifest must identify the public fixture repository/path, immutable revisions,
build command, native target and smoke command. The fixture must exercise module assembly,
explicit database migrations, HTTP readiness and lifecycle-owned resources using generic
framework/application capabilities. A minimal HTTP-only sample does not cover these requirements.
If such a fixture or its evidence is missing, the integration gate remains unverified; downstream
product results are supplementary compatibility evidence, not a replacement.

The fixture must:

- Build a release binary from the recorded inputs and record its hash.
- Provision disposable local databases and any required services on isolated ports. Never use
  production data, production services or implicit developer credentials.
- Apply migrations and verify clean status: no pending, changed or failed migrations.
- Run two process cycles. Each must reach READY, remain healthy for at least 60 seconds, answer an
  HTTP health request and exit with code zero within 30 seconds of SIGTERM.
- Require the HTTP port to be closed and database connections to be zero **before teardown**.
  For PostgreSQL, inspect `pg_stat_activity` through a maintenance database; forced database deletion
  is not proof of resource release. Query failures and malformed results fail closed.
- Test the gate's negative paths: nonzero exit, shutdown timeout, leaked connections and failed
  connection inspection must not produce a passing result.
- Clean up only its own processes and temporary resources. Keep secrets out of retained evidence.

Concrete product commands, environment variable names and product service prerequisites are
documented with that product, not in this framework contract.

## CI enforcement and evidence

- The framework Backend CI runs macOS foundation/conformance suites, native Linux/Windows tests,
  and real Redis/PostgreSQL contracts. Dedicated `ci/**` branches can validate fixes without merging them first.
- The PostgreSQL job must provision its own disposable database, set `NETON_DB_TEST_REQUIRED=true`
  and fail when connection configuration is absent or unsafe. Its native database suite covers
  migration replay/checksum drift, commit, nested rollback, cancellation and concurrent independent
  transactions; optional local runs without a database do not satisfy this gate. Retain test reports
  against the candidate commit. These tests do not substitute for application shutdown evidence.
- Native published-dependency jobs assert `netonstream.local=false` before settings evaluation.
  PowerShell must pass dotted Gradle properties as literal argument strings.
- Source-integration jobs use `tools/ci/protocol-sources.lock`. Update a pin when a framework change
  needs an API absent from the pinned source; do not patch or reset a developer's sibling checkout.
- Gradle commands use `--warning-mode=fail` so Gradle deprecations cannot silently pass the gate.
  Kotlin compiler warnings and the documented KSP AWT noise are separate from Gradle deprecations.
- A green framework CI is necessary, not sufficient: attach aggregate application build, migration,
  both process-cycle results, database connection checks, target, dependency revisions and binary hash
  to the same release candidate using the reference integration fixture above.
- Use immutable, clean source inputs and isolated build outputs for release-candidate evidence.
  A developer checkout being edited or built by another session is diagnostic evidence only.
  A retry with reduced parallelism must record the original failure and cannot prove parallel-build
  stability; investigate missing or concurrently rewritten native library artifacts explicitly.
- Retain failures as failures. Missing credentials, unavailable runners, skipped tests or an unbuilt
  service dependency mean the corresponding gate is unverified, never implicitly passed.

## Baseline rule

Passing macOS locally closes the macOS application path only. The release baseline is established
only after the Linux and Windows CI jobs pass on their native hosts. New architecture work must not
be used to bypass a failed release gate.
