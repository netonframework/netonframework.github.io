# Framework source and specification map

## Resolve a version before reading examples

Authoring baseline, 2026-10-15: framework `f03c389`, neton-docs `e6a837b`. These identify inspected snapshots, not a claim that every subsequent version is compatible. Resolve the target project's actual versions on each task.

Canonical documentation repository: `https://github.com/netonframework/netonframework.github.io` (local checkout commonly named `neton-docs`). Paths below are relative to `docs/zh-hans/spec/` in that repository. English translations may exist; check their freshness against the same contract/version.

Find specs in a project-provided location or a sibling `neton-docs` checkout. A consumer need not clone Neton source. If local specs are absent, use the documentation revision distributed with the project's release or inspect a compatible repository tag/commit. Do not guess that framework and docs tags have identical names. If compatibility cannot be established, state the uncertainty and use actual dependency APIs; do not implement a draft interface as though it exists. Ask for missing contract context only when it blocks a material decision.

Source paths below are relative to the resolved framework checkout. Search within that checkout if a file moved. Do not search or mutate every sibling repository indiscriminately.

| Task | Read specifications | Inspect implementation or contract tests |
|---|---|---|
| Startup, dependency injection, cleanup | `core.md`, `lifecycle.md`, `core-spi-best-practices.md` | `neton-core/src/commonMain/kotlin/neton/core/Neton.kt`; `neton-core/src/commonTest/kotlin/neton/core/component/LifecycleContractTest.kt` |
| Business configuration extension | `config-spi.md`, current lifecycle contract | `neton-core/src/commonMain/kotlin/neton/core/config/`; generated config registry consumers |
| Modules, KSP, assembly | `module-manifest.md` | `neton-core/src/commonMain/kotlin/neton/core/module/ModuleInitializer.kt`; `neton-ksp/src/`; consumer Gradle `neton.moduleId` / `neton.modules` inputs |
| Controller routes, body/query validation | `routing.md`, `parameter-binding.md` | `neton-routing/src/`, `neton-validation/src/`, KSP controller generation |
| Authentication and authorization SPI | `security.md` | `neton-security/src/commonMain/kotlin/neton/security/`; JWT and authenticator contract tests |
| Server/client/streaming | `http.md`, `http-engine.md`, `http-engine-capabilities.md` | `neton-http/src/`; selected engine tests and consumer dependency declaration |
| Database and transactions | `database.md`, `database-session.md`, `database-execution.md`; `database-join.md` for joins | `neton-database/src/commonMain/kotlin/neton/database/api/DbContext.kt`; `DbSessionProviderContractTest.kt`, `TableUserContractTest.kt` under commonTest |
| Schema changes | Migration section in `database.md` | `neton-database/src/commonTest/kotlin/neton/database/migration/`; distribution migration runner |
| Cache, locking | `cache.md`, `redis.md` | `neton-cache/src/`, `neton-redis/src/`; failure and invalidation tests |
| Events/outbox | `event.md`, `database-session.md` | `neton-core/src/commonTest/kotlin/neton/core/event/`; application outbox implementation when present |
| Jobs, files | `jobs.md`, `storage-spec.md` | `neton-jobs/src/`, `neton-storage/src/`; lifecycle owners |
| Logging | `logging.md` | `neton-logging/src/`; structured fields, redaction and shutdown tests |
| WebSocket or AI | `websocket.md` or `ai.md` including status | Corresponding module's actual public API and tests; draft capability is not assumed implemented |
| Native release | `release-gate.md` | `.github/workflows/backend-ci.yml`, target-specific Gradle tasks |

## Conflict handling

Read status, scope and supersession notes, not only the index label. Some older documents describe earlier lifecycle phases or in-progress APIs. A more specific accepted contract may supersede those descriptions, but verify its declared scope. Historical examples can demonstrate binding while still containing demo-only schema creation or old status values. Reuse the relevant mechanism, not all example policies.

For a framework bug required by a consumer task, isolate the framework fix and consumer adaptation, retain public compatibility unless the user requested a breaking change, and test both. For a released dependency without source access, document the required version/fix instead of silently patching an unrelated local checkout.
