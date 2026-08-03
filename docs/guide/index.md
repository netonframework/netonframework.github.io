# Guide

::: info Version
This documentation covers **Neton 1.0.0-beta1** (Kotlin 2.4.0 / KSP 2.3.10).
Where the documentation and the code disagree, **the compilable examples under
`neton/examples/` and the framework sources are authoritative**.
:::

Welcome to the Neton Framework guide.

Neton is a modern Kotlin/Native web framework built on Kotlin Multiplatform. It compiles to a
native binary and uses no reflection, which gives it millisecond startup and a small memory
footprint. This guide takes you from an empty directory to a working, high-performance service.

## How the documentation is organised

| Type | Audience | What it covers |
|---|---|---|
| **Guide** (this section) | Application developers | Practice-oriented: tutorials, code samples and recommended patterns |
| **[Specifications](/zh-hans/spec/)** (Chinese) | Framework contributors and advanced users | Design-oriented: frozen API definitions, architecture and SPI contracts |

If this is your first time with Neton, start here. Reach for the specifications when you need the
design rationale behind a feature or the exact frozen contract of an API.

::: tip Translation status
The guide is available in English. The specifications and API reference are currently
Chinese-only; translations are in progress.
:::

## Contents

### Getting started

- [Quick start](./quick-start.md) — build and run your first Neton application
- [Project structure](./project-structure.md) — module layout, directory conventions and config files

### Core features

- [Routing and controllers](./routing.md) — controller annotations, HTTP methods, route groups, DSL routes
- [Parameter binding](./parameter-binding.md) — inference by convention, plus path / query / body / header / cookie binding
- [Configuration](./configuration.md) — TOML files, environment overrides, the `@NetonConfig` SPI
- [Logging](./logging.md) — structured logs, sink routing, asynchronous writes, trace context

### Security

- [Security guide](./security.md) — the Authenticator + Guard architecture, JWT authentication, `@RequireAuth` / `@AllowAnonymous`

### Data and caching

- [Database](./database.md) — the entity + table model, the type-safe query DSL, the logic layer
- [Cache](./cache.md) — two-tier L1 + L2 caching, `@Cacheable` / `@CachePut` / `@CacheEvict`
- [Redis and distributed locks](./redis.md) — the Redis client and the `@Lock` annotation

### Advanced

- [Middleware](./middleware.md) — the request pipeline and custom middleware
- [Deployment and targets](./deployment.md) — release builds and cross-platform compilation
- [Toolchain known issues](./tooling-known-issues.md) — known build noise from Kotlin/Native, KSP and Gradle
