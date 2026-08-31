# Coming from Spring Boot

Neton targets the same job Spring Boot does: build a complete server-side application — HTTP,
data, cache, security, scheduling, events — without assembling the stack yourself. The difference
is when the assembly happens. Spring wires the graph at startup through reflection and proxies;
Neton wires it at compile time through KSP, and the result is a native binary that starts in
milliseconds.

This page maps what you already know onto what Neton calls it, and states plainly what is not
there yet.

## Application entry

```java
// Spring Boot
@SpringBootApplication
public class Application {
    public static void main(String[] args) { SpringApplication.run(Application.class, args); }
}
```

```kotlin
// Neton
fun main(args: Array<String>) {
    Neton.run(args) {
        http { port = 8080 }
        routing { }
        modules(GeneratedInitializer)
    }
}
```

Neton has no component scan. Every capability is installed explicitly in the entry block, so the
set of things running is the set of things you can see on one screen.

## Web

| Spring Boot | Neton |
|---|---|
| `@RestController` | `@Controller` |
| `@GetMapping` / `@PostMapping` / … | `@Get` / `@Post` / `@Put` / `@Patch` / `@Delete` / `@Head` / `@Options` |
| `@PathVariable` / `@RequestParam` / `@RequestBody` | `@PathVariable` / `@QueryParam` / `@Body` — usually inferred from the signature, so most handlers need no annotation |
| `@RequestHeader` / `@CookieValue` | `@Header` / `@Cookie` |
| `MultipartFile` | `UploadFile` / `UploadFiles` |
| `@ControllerAdvice` + `@ExceptionHandler` | Built in: exceptions carry an error code and the framework derives the HTTP status and response envelope |
| Interceptors / filters | The pipeline runs security, rate limiting and access logging around every handler; see [Middleware](./middleware.md) |
| CORS configuration | `http { }` configuration |
| Jackson | kotlinx.serialization, with serializers generated at compile time |

## Data

| Spring Boot | Neton |
|---|---|
| Spring Data repositories | `@Table` entities and generated `XxxTable` facades |
| Derived query methods | A typed query DSL: `UserTable.query { where { and(User::status eq 1, User::name like "%a%") } }.page(1, 20)` |
| `@Transactional` | `db.transaction { }` — a coroutine-scoped session every table operation joins |
| Flyway / Liquibase | Versioned SQL under `sql/<dialect>/V*.sql`, embedded at build time and applied by the migration engine |
| Optimistic locking | `increment` / `decrement` render `col = col + ?`, which combined with `where { }` is a compare-and-swap |
| Connection pool tuning | `database.conf` |

## Everything else

| Spring Boot | Neton |
|---|---|
| `@Cacheable` / `@CachePut` / `@CacheEvict` | Same annotations, two tiers (in-process L1 + Redis L2) |
| `@Scheduled` | `@Job(cron = …)` or `@Job(fixedRate = …)`, with `SINGLE_NODE` / `ALL_NODES` execution modes |
| Spring Security filter chain | Authenticator + Guard, with `@RequireAuth` / `@AllowAnonymous` / `@RolesAllowed` / `@Permission` |
| Bucket4j / custom rate limiting | `@RateLimit`, enforced on the dispatch path |
| `ApplicationEventPublisher`, Spring Modulith event registry | `DomainEventBus` with `SYNC` / `BEST_EFFORT` / `RETRYABLE`; the last is a transactional outbox — see [Domain events](./events.md) |
| Redisson / Redis locks | `@Lock` and `LockManager` |
| `@Valid` + Bean Validation | `@Valid` with validators generated at compile time |
| `application-<profile>.yml` | `application.<env>.conf` (TOML) |
| `@ConfigurationProperties` | `@NetonConfig` configurers |
| Constructor injection | `@Logic` classes, constructed and wired by generated code |
| Graceful shutdown | Built in — SIGINT / SIGTERM run the reverse-order lifecycle |
| Micrometer / structured logs | Structured JSON logging with traceId propagation and automatic redaction |

## Not there yet

Written down so the gap is a work item rather than a surprise. Real applications drive this list:
when a project needs something here, it gets built.

| Missing | Notes |
|---|---|
| Actuator-style endpoints | No `/health`, `/metrics` or Prometheus scrape endpoint. Liveness checks currently mean "the port answers". |
| OpenAPI / Swagger generation | Route metadata exists at compile time, so this is generation work rather than new runtime machinery. |
| Test slices | No `@SpringBootTest` / `MockMvc` equivalent. Logic classes are plain classes and unit-test directly; HTTP-level tests mean starting the binary. |
| Static file serving | No built-in static handler; put a reverse proxy or CDN in front. |
| Service discovery, config server, circuit breakers | The Spring Cloud layer has no counterpart. |
| WebSocket | Not implemented. SSE is. |

## What you gain

- **No JVM at runtime.** A single native binary, around 3 ms to start and roughly 20 MB resident.
  Scale-to-zero and per-request-billing deployments stop being awkward.
- **Failures move to compile time.** Routes, parameter binding, validators, cache and lock keys,
  serializers and the config SPI are all generated and checked by KSP. A cache key that could not
  distinguish two requests is a compile error, not a wrong response in production.
- **No reflection, no proxies.** What you read is what runs; stack traces have no framework
  scaffolding in them.

The trade is ecosystem breadth. Spring has two decades of integrations; Neton has the modules
listed above. If your service is built out of those, you lose nothing.
