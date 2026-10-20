---
name: neton-development
description: Build, integrate, debug, or review Kotlin services using Neton Framework and maintain its components against Neton specs. Use for Neton lifecycle, Config SPI, KSP modules, routing, security SPI, database transactions, HTTP, events, and resource ownership. Application business conventions belong to neton-application-development; do not apply this skill to unrelated Kotlin projects.
---

# Neton development

Deliver changes against the project's actual Neton version and the relevant accepted contracts. Preserve the user's task: a review produces findings; implementation produces verified code. This skill does not authorize deployments, publishing, or edits to unrelated repositories.

## Establish the contract

1. Read project instructions and inspect the working tree before editing. Identify whether this is a framework checkout, a dependency consumer, or an Application fork.
2. Resolve the framework dependency from Gradle settings, version catalog, lockfiles and included builds. Do not upgrade Kotlin, KSP, Neton, or the HTTP engine merely to match an example.
3. Locate matching canonical specs using [the source map](references/source-map.md). Read only the topics involved. Record applicable spec status and the implementation/version inspected.
4. Treat frozen/accepted contracts as requirements for their stated version. Draft APIs and historical review findings are not evidence of shipped behavior. When a normative contract conflicts with code, explain the discrepancy; implement the intended contract only within the requested scope. Do not silently redefine a spec or copy a known violation.

## Framework boundaries

- Use `Neton.run` and the existing installation/registration model. Infrastructure DSL installs components; application policy uses Config SPI. Do not introduce runtime scanning or reflection to replace KSP.
- Use constructor injection or an explicit context. Register services before context freeze. Background work starts through owned lifecycle entries; every client, scope, pool, worker and watcher needs a shutdown owner. Propagate startup failure and coroutine cancellation.
- Use `@Module`, generated manifests/registries and declared dependencies as supported by the selected version. Edit source annotations/build inputs, never generated KSP output. Public symbol changes require searching actual downstream consumers.
- Keep framework interfaces independent of application tables, business identities, permission strings and product names. Authentication policy belongs behind existing SPI. Do not add admin/account business rules to generic JWT signing primitives.
- For inbound/outbound HTTP, use Neton abstractions. The distribution selects the engine dependency. Check required capabilities; do not import concrete engines or driver types into business contracts. Follow ownership, cancellation, timeout and streaming contracts.
- Execute Table/Query/raw parameterized SQL through `DbContext` and the current session. Transactions commit once, roll back and rethrow on failure/cancellation; nested v1 transactions join the outer transaction. Do not parallelize operations sharing one transaction or let lazy work escape it.
- Keep entities persistence-free. Use explicit insert/update/destroy operations. Production schema changes use versioned explicit migrations; startup is not a schema-upgrade hook. Small examples using automatic table creation are not production migration templates.
- Use framework logging with structured fields and request context. Never log credentials or raw authentication payloads. Reuse cache, Redis, storage, jobs and events contracts when the task needs them; do not introduce competing execution paths.

Application-specific `Long id`, 0/1 flags and CRUD URL conventions are not universal framework restrictions. Apply them only when working in that ecosystem.

## Implement and verify

For a feature, identify its invariants and failure paths, find the existing API and one relevant implementation, then make the smallest complete change. If functionality is absent, identify that gap instead of inventing an API call.

Use the target project's Gradle wrapper and available native target. Inspect its build/tasks and CI before choosing commands. In a framework source checkout, examples of focused tasks are:

```sh
./gradlew :neton-core:macosArm64Test
./gradlew :neton-database:macosArm64Test
./gradlew :neton-security:macosArm64Test
```

These examples require a compatible host and the declared tasks. Run only relevant suites; downstream integration and release checks depend on the changed contract.

- Lifecycle changes: failed startup, cleanup, stop ordering, freeze and cancellation.
- Database changes: real supported database commit/rollback, nested and concurrent independent transactions. A memory adapter does not prove SQL locking behavior.
- HTTP/security changes: malformed input, authorization failure, cancellation/timeout and relevant engine contracts, not just a successful request.
- Generated APIs: regenerate, compile consumers and test behavior. A green metadata task alone does not prove a native executable links.
- Release claims: use the actual target platform and release gate; local debug success is not a Linux release result.

Before database/service tests, inspect their configuration and cleanup behavior and use disposable local resources. Report exact checks run, skipped requirements, and remaining limitations. Do not claim unexecuted tests passed.

## Maintenance

This skill is an execution guide, not another normative spec. Keep policy in canonical specs and update this guide's routing when APIs or ownership change. See the source map for the inspected baseline and handling consumers without sibling checkouts.
