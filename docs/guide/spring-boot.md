# Coming from Spring

Neton targets what Spring Boot and Spring Cloud target: complete server-side applications that
run in a microservice architecture. It gets there differently — by shipping **only the components
almost every service actually uses, and nothing else**.

A small component set buys three things: it is easier to maintain, it is faster, and it fits
microservices better. One native binary, roughly 3 ms to start and 20 MB resident, with no JVM,
no reflection and no proxies. The startup scan-and-wire cost simply does not exist here.

## The essential set

Everything below is built in, and all of it is wired by KSP at compile time:

| What you need to do | Neton |
|---|---|
| HTTP endpoints | `@Controller` + `@Get` / `@Post` …, arguments inferred from the signature — most handlers need no annotation |
| Validation | `@Valid`, validators generated at compile time |
| Database | `@Table` entities and a typed query DSL; `db.transaction { }`; versioned SQL migrations |
| Caching | `@Cacheable` / `@CachePut` / `@CacheEvict`, in-process L1 plus Redis L2 |
| Distributed locks | `@Lock` / `LockManager` |
| Security | Authenticator + Guard, `@RequireAuth` / `@RolesAllowed` / `@Permission` |
| Rate limiting | `@RateLimit` |
| Scheduling | `@Job(cron / fixedRate)`, `SINGLE_NODE` / `ALL_NODES` |
| Module decoupling | `DomainEventBus` with a transactional outbox (Spring Modulith's event registry) |
| Configuration | `application.<env>.conf`, `@NetonConfig` configurers |
| Logging and tracing | Structured JSON, traceId propagation, automatic redaction |
| Object storage | One abstraction over local and S3 |

## Deliberately not included

Not gaps — boundaries. These belong to the platform, and pulling them into the framework only
adds weight:

| Not included | Whose job |
|---|---|
| Service discovery, config server, circuit breakers, gateway (the Spring Cloud layer) | Kubernetes and the service mesh. Reimplementing Eureka or Config Server in 2026 duplicates what the platform already does |
| Static file serving | A reverse proxy or CDN |
| Component scanning | Every capability is installed explicitly in the entry block, so what runs fits on one screen |
| Runtime reflection and dynamic proxies | Compile-time generation. What you read is what runs, and stack traces carry no framework scaffolding |

## Added when a project needs it

Driven by real applications rather than stockpiled in advance.

- Health endpoints (Kubernetes liveness and readiness probes need them — highest priority)
- OpenAPI generation (route metadata already exists at compile time, so this is generation work)
- WebSocket (SSE is available)
- HTTP-level test support (Logic classes are plain classes and already unit-test directly)

## The mental shift

In Spring you **describe** an object graph and the container assembles it at startup. In Neton you
**write** it and KSP fills in the boilerplate. That moves a class of failures forward: routes,
parameter binding, validators, cache and lock keys and serializers are all checked at compile
time. A cache key that cannot distinguish two requests is a compile error, not a wrong response
in production.

The trade is ecosystem breadth. Spring has two decades of integrations. If your service is built
out of the table above, you lose nothing; if it leans on some niche starter, you will be writing
that part yourself.
