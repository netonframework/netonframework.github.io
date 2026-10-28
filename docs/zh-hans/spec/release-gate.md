# Neton 1.0 Release Gate R0

> Status: active release gate

Neton 1.0 is not release-ready until every mandatory gate below is green on the release commit.

## Ownership boundary

This document defines reusable Framework release requirements. Neton Application owns the
acceptance of its generic modules and distribution. Product-specific modules, deployment
instructions, source inventories and acceptance results belong to the product's own repository.
No private product or proprietary service is a mandatory dependency of a Neton release gate.

## Mandatory gates

Formal API stability and beta migration boundaries are defined in
[the freeze contract](./release-freeze-contract.md). API dumps alone do not approve a freeze.

1. macOS framework foundation tests pass.
2. Linux `linuxX64` Core tests pass on a Linux runner.
3. Windows `mingwX64` Core tests pass on a Windows runner.
4. A documented, publicly reproducible reference integration application compiles against the candidate.
5. A release binary passes migration `status` and `verify` against an isolated database.
6. The release binary completes two READY, HTTP health check and graceful-stop cycles
   (`SIGTERM` on POSIX, targeted `CTRL_BREAK_EVENT` on Windows).
7. After shutdown, the HTTP port is closed and application database connections return to zero.
8. Gradle emits no Gradle 9 deprecation warning.
9. KSP AWT shutdown noise remains documented and non-blocking; any task failure, missing generated
   source, no-clean instability or CI flake promotes it to a release blocker.

## 1.0 completion gates beyond R0

R0 evidence is retained as a historical baseline, not a claim that all 1.0 work is complete.
The following gates must close in order before stable publication; adding a workflow is not
evidence that it passed.

1. **Compiled API/ABI baseline.** Every published Kotlin library, including the KSP JVM
   artifact, has a checked-in dump produced by the candidate's Kotlin ABI tool. The BOM has
   no executable ABI; its constraints belong to artifact validation. The experimental
   `neton-http-geario4k` adapter remains unpublished and outside the stable baseline.
   CI compares compiled outputs with committed dumps and never updates them. Missing dumps
   and ABI differences fail. Baseline changes require explicit review of public signatures,
   platform differences and accidental implementation exposure. An initial generated dump
   is a **candidate** baseline, not approval to freeze every currently public declaration.
   Native target inference is not evidence that a foreign-target binary ran successfully.
2. **KSP incremental Native acceptance.** The public `examples/ksp-incremental` fixture runs
   for macOS ARM64, Linux x64/ARM64 and Windows x64 (the database target set).
   Compilation uses a Kotlin/Native-supported host. Linux ARM64 uses a Linux x64
   cross-build followed by a separate ARM64 native execution job verifying candidate SHA
   and all five binary hashes; cross-build success alone leaves acceptance pending.
   In one output tree it builds clean, builds unchanged, adds an entity, changes its column,
   then deletes it, without cleaning between stages. Each stage compiles and links a Native
   executable that references generated APIs, and runs that executable. Assertions reject
   missing generated tables, stale column mappings, deleted symbols in aggregate registries,
   driver imports, and changed no-op generated output. Logs, source revision, target and
   stage results are retained even on failure. These tests complement, not replace, KSP
   diagnostics and module/controller contract tests.
3. **Full native reference runtime.** Run the release reference build, migration and two-cycle
   resource-release contract on macOS, Linux and Windows. Windows must use a documented native
   graceful console-control mechanism; `TerminateProcess`/forced termination is never graceful
   shutdown evidence. Preserve the R0 macOS results without relabeling them as multi-platform.
4. **Candidate artifacts.** Build the candidate publications without source substitution,
   validate publication inventory, POM/module metadata, BOM constraints and signatures, then
   compile a clean external consumer with the candidate artifacts and released dependencies.
   This staging rehearsal performs no remote upload, publication or release tagging.
   Maven Central-only verification after publication is a separate later step.
   The rehearsal uses an isolated Gradle home and an ephemeral signing key, never a
   developer or production key. Retain the public key and fingerprint with evidence;
   cryptographic verification must bind every payload to that key. This proves signing
   mechanics, not approval of the production signing identity. The repository must have
   exactly the expected coordinates, one candidate version, matching checksums and local
   metadata references. The independent consumer must not use source substitution or
   Maven Local, and must resolve the database version through the entry module's BOM.
   Run migrations and both lifecycle cycles against its release executable as well.

The baseline and candidate-artifact gates must identify which published targets and database
driver variants were actually checked. Missing targets/variants remain unverified, not inferred
from another target or quietly dropped to make the aggregate pass.

## Reference integration smoke contract (R0)

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
  HTTP health request and exit with code zero within 30 seconds of the platform graceful-stop
  signal (`SIGTERM` or targeted Windows `CTRL_BREAK_EVENT`).
- Require the HTTP port to be closed and database connections to be zero **before teardown**.
  For PostgreSQL, inspect `pg_stat_activity` through a maintenance database; forced database deletion
  is not proof of resource release. Query failures and malformed results fail closed.
- Test the gate's negative paths: nonzero exit, shutdown timeout, leaked connections and failed
  connection inspection must not produce a passing result.
- Clean up only its own processes and temporary resources. Keep secrets out of retained evidence.

Concrete product commands, environment variable names and product service prerequisites are
documented with that product, not in this framework contract.

## Public reference implementation

The Framework repository `netonframework/neton` supplies `examples/release-gate` and
`tools/ci/reference_gate.py`. The `reference` module uses `@Module`, generated KSP manifest and
constructor-injected controller, embedded versioned SQL, `MigrationEngine`, `DbContext`, and
framework-owned HTTP/database lifecycle. Normal startup never migrates schema. Its health
endpoint must return the standard Neton success envelope (`code: 0`) with READY and the expected
database probe value; HTTP 200 alone is not sufficient.

On a clean committed native checkout, with PostgreSQL 16 tooling installed:

```sh
bash tools/ci/checkout-protocols.sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tools/ci -p 'test_reference_gate.py'
python3 tools/ci/reference_gate.py --target macosArm64 \
  --pg-bin /absolute/path/to/postgresql/bin --output /new/absolute/evidence-directory
```

This harness requires fresh fixture build outputs and builds release twice, with no clean
between passes. It owns a temporary loopback PostgreSQL cluster and uses a maintenance database
for connection inspection. It checks `up`, repeated `up`, `status`, `verify`, then both lifecycle
cycles. At least one application connection must be observed while serving, followed by zero
after shutdown, before any PostgreSQL teardown. Environment and credentials from existing
developer databases must not be inherited.

`evidence.json` records the immutable framework/dependency revisions, target and host,
PostgreSQL version, build/smoke commands, binary SHA-256, migration results and both cycle
observations. `passed` describes this fixture only, not an assertion of every 1.0 requirement.
Failed runs retain `passed: false` and their logs; reruns do not erase the original failures.

Backend CI's expanded `Reference release` matrix requires `macosArm64`, `linuxX64` and `mingwX64`,
using published dependencies without source substitution. Each target retains its own evidence
under the candidate commit. `Neton release gates` requires it together with framework tests,
native Core tests, PostgreSQL, Redis, ABI, KSP incremental contracts and the signed local
candidate-artifact rehearsal on that same commit.
Failed or skipped prerequisites fail the aggregate. The historical R0 macOS-only evidence
does not satisfy the expanded matrix. New platform jobs remain unverified until their actual
evidence passes. This matrix does not replace candidate-publication/Maven Central verification.
No publishing or product deployment is performed by this gate.

Candidate results are recorded separately from normative requirements. See the
[2026-10-28 public reference acceptance](./release-evidence/2026-10-28-native-reference.md)
for its exact commit, CI run, binary hash, observations and scope limitations.
The subsequent [API/ABI, KSP and candidate-artifact acceptance record](./release-evidence/2026-10-28-abi-ksp-candidate.md)
keeps the expanded gates and their failed intermediate candidates separate from that R0 baseline.

## CI enforcement and evidence

- `public-app` builds a pinned `neton-app` SHA against the exact signed candidate
  repository from this workflow on macOS ARM64, Linux x64 and Windows x64. Each target
  links twice and performs two healthy/graceful-stop cycles. The job checks upstream
  revision and payload hashes before linking; it does not use a previously published beta
  as a substitute. Its result is mandatory in the release aggregate.
- Internal/experimental source marker checks and positive/negative consumer compilation
  supplement ABI comparison. KSP-generated support explicitly opts in to internal APIs;
  business consumers must not inherit a project-wide internal opt-in from the framework.

- The framework Backend CI runs macOS foundation/conformance suites, native Linux/Windows tests,
  and real Redis/PostgreSQL contracts. Dedicated `ci/**` branches can validate fixes without merging them first.
- The PostgreSQL job must provision its own disposable database, set `NETON_DB_TEST_REQUIRED=true`
  and fail when connection configuration is absent or unsafe. Its native database suite covers
  migration replay/checksum drift, commit, nested rollback, cancellation and concurrent independent
  transactions; optional local runs without a database do not satisfy this gate. Retain test reports
  against the candidate commit. These tests do not substitute for application shutdown evidence.
- Native integration tasks must explicitly forward their service configuration into the test
  process and disable cached/up-to-date results when the service gate is required. A successful
  JUnit case alone is insufficient: optional tests may return before contacting the service.
  Verify required test identities, reject missing/skipped/failed reports, and require execution
  markers emitted only after the real-service assertions complete. Apply this to PostgreSQL and
  Redis (`NETON_TEST_REDIS_REQUIRED=true`), not just to one database provider.
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
