# What Neton gives you

Neton ships **only the components almost every service actually uses**, and nothing else. A small
component set buys three things: it is easier to maintain, it is faster, and it fits microservices
better.

One native binary, roughly 3 ms to start and 20 MB resident. No JVM, no runtime reflection, no
dynamic proxies — the cost of scanning every class at startup and assembling an object graph
reflectively simply does not exist here.

## Built in

All of it wired by KSP at compile time rather than assembled at runtime.

| What you need to do | Neton |
|---|---|
| HTTP endpoints | `@Controller` + `@Get` / `@Post` / `@Put` / `@Patch` / `@Delete` / `@Head` / `@Options` |
| Parameter binding | Path, query and body inferred from the signature — most handlers need no annotation; `@PathVariable` / `@QueryParam` / `@Body` / `@Header` / `@Cookie` when you want to be explicit |
| File uploads | `UploadFile` / `UploadFiles`, matched to form fields by parameter name |
| Validation | `@Valid`, validators generated at compile time, failures mapped to a structured response |
| Database | `@Table` entities and a typed query DSL; `db.transaction { }`; atomic increment (CAS); soft delete; query interceptors |
| Migrations | Versioned `sql/<dialect>/V*.sql`, embedded into the binary at build time and applied in order at startup |
| Caching | `@Cacheable` / `@CachePut` / `@CacheEvict`, transparent in-process L1 over Redis L2, with singleflight against stampedes |
| Distributed locks | `@Lock` / `LockManager`, `SET NX PX` with a token-checked Lua release |
| Security | Two-layer Authenticator + Guard, `@RequireAuth` / `@AllowAnonymous` / `@RolesAllowed` / `@Permission`, JWT included |
| Rate limiting | `@RateLimit`, enforced on the dispatch path, keyed per IP or per user |
| Scheduling | `@Job(cron / fixedRate)`, `SINGLE_NODE` (mutually exclusive across instances) or `ALL_NODES` |
| Module decoupling | `DomainEventBus` with three delivery modes, including a transactional outbox with backoff retries and inspectable terminal failures |
| Configuration | TOML files with environment overrides (`application.<env>.conf`), `@NetonConfig` extension points, type errors caught at startup |
| Logging | Structured JSON, traceId / spanId propagation, asynchronous writes, sink routing, automatic redaction |
| Object storage | One abstraction over local and S3, with multi-source configuration |
| HTTP client | Outbound client, streaming responses, SSE |

## Left to the platform

Not gaps — boundaries. Pulling these in would only add weight:

| Not included | Whose job |
|---|---|
| Service discovery, config server, circuit breakers, gateway | Kubernetes and the service mesh. Reimplementing what the infrastructure already solves is duplicated work |
| Static file serving | A reverse proxy or CDN |
| Component scanning | Every capability is installed explicitly in the entry block, so what runs fits on one screen |
| Runtime reflection and dynamic proxies | Compile-time generation. What you read is what runs, and stack traces carry no framework scaffolding |

## Why it is fast and stays maintainable

**Failures move to compile time.** Routes, parameter binding, validators, cache and lock keys,
response serializers and config extension points are all generated and checked by KSP. A cache key
that cannot distinguish two requests is a compile error, not a wrong response in production. An
annotation in a place where it would never take effect fails the build instead of doing nothing.

**No implicit wiring.** Capabilities are installed explicitly and modules are registered from an
explicit list. Nothing changes behaviour just by appearing on the classpath.

**Convention over configuration.** Binding follows the signature, routes follow the directory
layout, and a config file's name is its namespace — roughly 90% of the time there is no annotation
and no configuration to write.

**Simple deployment.** A single static binary with no runtime dependency, container images in the
tens of megabytes, and millisecond startup that makes scale-to-zero and per-request billing
straightforward.

## Added when a project needs it

Driven by real applications rather than stockpiled in advance:

- Health endpoints (Kubernetes liveness and readiness probes need them — highest priority)
- OpenAPI generation (route metadata already exists at compile time, so this is generation work)
- WebSocket (SSE is available)
- HTTP-level test support (Logic classes are plain classes and already unit-test directly)
