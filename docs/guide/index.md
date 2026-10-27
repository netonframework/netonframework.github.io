# Guide

::: info Version
This documentation covers **Neton 1.0.0** (Kotlin 2.4.0 / KSP 2.3.10), currently in public beta. The final release date is not yet fixed.
Where the documentation and the code disagree, **the compilable examples under
`neton/examples/` and the framework sources are authoritative**.
:::

Welcome to the Neton Framework guide.

Neton Framework is a Kotlin/Native backend application framework for APIs, services and business systems. It brings routing, dependency injection, configuration, data access and security together, with compile-time assembly and native deployment without a JVM.

Use Framework directly to develop a service, or build on **Neton Application** to reuse business modules and a modular administration frontend. [Understand the two layers](./application.md). Underlying protocol libraries are documented separately in the [technical architecture and ecosystem](/ecosystem/).

## Contents

### Getting started

- [Quick start](./quick-start.md) — build and run your first Neton application
- [What Neton gives you](./capabilities.md) — the built-in component set, what is left to the platform, and why that keeps it fast
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
- [Domain events](./events.md) — decoupling modules with the event bus; `SYNC` / `BEST_EFFORT` / `RETRYABLE`

### Advanced

- [Middleware](./middleware.md) — the request pipeline and custom middleware
- [Deployment and targets](./deployment.md) — release builds and cross-platform compilation
- [Toolchain known issues](./tooling-known-issues.md) — known build noise from Kotlin/Native, KSP and Gradle
