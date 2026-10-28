# Public native reference acceptance — 2026-10-28

This is an evidence record, not a replacement for the [release gate](../release-gate.md).
All results below concern the same committed Framework candidate; no product-specific modules,
private services or product deployment are acceptance dependencies.

## Candidate and CI

- Repository: `netonframework/neton`
- Commit: [`d8ea68c032c2afa2362741e6e22f49da74b3d73d`](https://github.com/netonframework/neton/commit/d8ea68c032c2afa2362741e6e22f49da74b3d73d)
- Validated branch: `ci/native-release-gates` (this record does not assert a merge to `main`).
- [Backend CI run 40629410695](https://github.com/netonframework/neton/actions/runs/40629410695): **success**.
- Passed jobs: `framework-checks` (macOS foundation/conformance), `Core (linuxX64)`,
  `Core (mingwX64)`, `postgres-contracts`, `redis-contracts`,
  `Reference release (macosArm64)`, and aggregate `Neton release gates`.
- Fixture: `examples/release-gate`; harness: `tools/ci/reference_gate.py`.
- Native host: macOS 15.7.9 ARM64; PostgreSQL 16.15 (Homebrew).
- CI artifact: `reference-release-macosArm64-d8ea68c032c2afa2362741e6e22f49da74b3d73d`.
  It contains `evidence.json` plus build, migration, application and PostgreSQL logs.

## Release build and migrations

Release binary SHA-256:

```text
5e98a83d4cdde0d47402fc4cfa2fe1eb2b5b618511b86775d30145d6a3cb0a85
```

The first release build succeeded in 6m 33s. The second build, without clean, succeeded in 17s.
Both used `--warning-mode=fail`. The second build ran 12 tasks and reused 60 up-to-date tasks.
This is a successful no-clean rebuild, not a claim of bit-for-bit reproducibility across hosts.

`migrate up`, repeated `migrate up`, `migrate status` and `migrate verify` all exited 0, emitted
their success markers, and left zero application database connections. The database belonged to
a newly provisioned temporary loopback cluster; no existing developer/production database was used.

## Runtime observations

| Cycle | Healthy hold | Connections while serving | SIGTERM to exit | Exit code | Port closed | Connections after exit |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 60.7649s | 1 | 0.0540s | 0 | yes | 0 |
| 2 | 60.6353s | 1 | 0.0093s | 0 | yes | 0 |

Each health check required HTTP 200 and the standard Neton success envelope:

```json
{"code":0,"message":"OK","data":{"status":"READY","value":"neton-reference"}}
```

Port and connection observations occurred **before** PostgreSQL teardown. The gate queried
`pg_stat_activity` from the maintenance database; forced cleanup was not counted as evidence
of application resource release. The harness additionally checked that sources and the binary
did not change during acceptance. Its final `evidence.json` records `passed: true`.

## Immutable dependency inputs

The source integration stack was pinned by `tools/ci/protocol-sources.lock`:

| Dependency | Commit |
| --- | --- |
| io | `5fb406cd66efff399d875da389af90b89f65c2c7` |
| http | `3452c87f1303fde2ac327ce4621ffd6ac64d09f1` |
| tls | `1e1748c4585a6af0f89c81456828e94e3195b23e` |
| websocket | `775b2ccc8ca0889bc317a3ebb67f2c327edf036e` |
| openssl-kotlin | `06f31bc67fce845bf6cbaa62c97721b61632cb81` |

## Failure-path coverage and scope

Sixteen Python harness/report tests passed locally, including rejection of nonzero exit,
premature exit, shutdown timeout, an open listener, leaked database connections, failed/malformed
connection inspection, an invalid health envelope, and missing/skipped integration evidence.
The reference job reran its eight smoke-harness tests in CI; the PostgreSQL job reran the eight
integration-report tests. Real PostgreSQL and Redis execution markers were required independently.

Earlier unsuccessful candidates remain unsuccessful records: run
[40628847736](https://github.com/netonframework/neton/actions/runs/40628847736) rejected a dirty
checkout created by Python bytecode caching, and run
[40629170458](https://github.com/netonframework/neton/actions/runs/40629170458) rejected the initial
health probe, which incorrectly expected unwrapped JSON rather than Neton's standard envelope.
Those checks were corrected and the full candidate rerun; their failures were not reclassified.

This closes the requested public-reference/macOS CI acceptance for this commit. It does not
claim full Linux/Windows application runtime acceptance, Maven Central consumer verification,
an approved public ABI baseline, a merge to the default branch, or publication of version 1.0.0.
