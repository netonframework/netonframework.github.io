# Logging

Neton provides one structured logging API. Every module and every handler writes through the
`Logger` interface, output is JSON, and asynchronous writes, multi-sink routing and request trace
context all come for free.

## Principles

- **Structure first** — business data belongs in fields; `msg` is only an event name
- **No `println`** — everything goes through `Logger`
- **Compile-time injection** — annotate with `@Log` and take a `Logger` constructor parameter; KSP wires it
- **Automatic context** — trace and span IDs are injected by the framework, not passed by hand

## The Logger API

```kotlin
interface Logger {
    fun trace(msg: String, fields: Fields = emptyFields())
    fun debug(msg: String, fields: Fields = emptyFields())
    fun info(msg: String, fields: Fields = emptyFields())
    fun warn(msg: String, fields: Fields = emptyFields(), cause: Throwable? = null)
    fun error(msg: String, fields: Fields = emptyFields(), cause: Throwable? = null)
}
```

`Fields` is an alias:

```kotlin
typealias Fields = Map<String, Any?>
```

### Levels

| Level | Use for | `cause` |
|---|---|---|
| `trace` | The most detailed tracing, usually development only | not accepted |
| `debug` | Diagnostic detail while investigating | not accepted |
| `info` | Notable events during normal operation | not accepted |
| `warn` | Something looks wrong but the request continues | optional |
| `error` | A failure that needs attention | strongly recommended |

## Obtaining a Logger

Annotate the class with `@Log` and declare a `Logger` constructor parameter. KSP generates the
injection:

```kotlin
import neton.logging.Logger
import neton.logging.Log
import neton.core.annotations.*

@Controller("/api/users")
@Log
class UserController(private val log: Logger) {

    @Get("/{id}")
    suspend fun get(id: Long): User? {
        log.info("user.get", mapOf("userId" to id))
        return UserTable.get(id)
    }

    @Post
    suspend fun create(@Body user: User): User {
        log.info("user.create", mapOf("name" to user.name, "email" to user.email))
        return UserTable.insert(user)
    }
}
```

The parameter may be named `log` or `logger`. KSP injects an instance created through
`LoggerFactory.get("<fully qualified class name>")`.

**Do not call `LoggerFactory.get()` from application code.** Use `@Log` with constructor injection.

## Writing structured logs

### `msg` names the event

Keep `msg` a short dotted identifier. Never interpolate data into it:

```kotlin
// good — msg identifies the event, data lives in fields
log.info("user.get", mapOf("userId" to id))
log.info("order.created", mapOf("orderId" to order.id, "amount" to order.total))
log.error("payment.failed", mapOf("orderId" to orderId, "reason" to "insufficient balance"), cause = ex)

// bad — data interpolated into msg
log.info("Getting user $id")
log.info("Order ${order.id} created")
```

Interpolated messages cannot be grouped or counted, which is the main reason to log structurally at
all.

### Fields carry the data

```kotlin
log.info("http.request", mapOf(
    "method" to "GET",
    "path" to "/api/users/1",
    "status" to 200,
    "duration" to 15
))

log.warn("cache.miss", mapOf(
    "key" to cacheKey,
    "region" to "user-profile"
))

log.error("db.query.failed", mapOf(
    "table" to "users",
    "operation" to "select",
    "sql" to query
), cause = exception)
```

### Always pass `cause` on error

```kotlin
try {
    // work
} catch (e: Exception) {
    log.error("user.update.failed", mapOf(
        "userId" to userId,
        "operation" to "update"
    ), cause = e)
}
```

Without it the stack trace is lost, and an error record without a stack trace rarely tells you
enough.

## Configuration

Logging is configured under `[logging]` in `config/application.conf`:

```toml
[logging]
level = "INFO"

[logging.async]
enabled = true
queueSize = 8192
flushEveryMs = 200
flushBatchSize = 64
shutdownFlushTimeoutMs = 2000

[[logging.sinks]]
name = "access"
file = "logs/access.log"
levels = "INFO"
route = "http.access"

[[logging.sinks]]
name = "error"
file = "logs/error.log"
levels = "ERROR,WARN"

[[logging.sinks]]
name = "all"
file = "logs/all.log"
levels = "ALL"
```

### Global level

| `level` | Records emitted |
|---|---|
| `"TRACE"` | TRACE, DEBUG, INFO, WARN, ERROR |
| `"DEBUG"` | DEBUG, INFO, WARN, ERROR |
| `"INFO"` | INFO, WARN, ERROR |
| `"WARN"` | WARN, ERROR |
| `"ERROR"` | ERROR |

### Asynchronous writes

Enable these in production so that I/O does not block request handling:

| Option | Meaning |
|---|---|
| `enabled` | Turn on asynchronous mode |
| `queueSize` | Queue capacity; records are dropped with a warning when it is full |
| `flushEveryMs` | Flush on this interval even when a batch is not full |
| `flushBatchSize` | Flush as soon as this many records are queued |
| `shutdownFlushTimeoutMs` | How long shutdown waits for the queue to drain |

### Sink routing

Each sink is one output rule:

- `name` — the sink's name
- `file` — output path
- `levels` — comma-separated levels (`"ERROR,WARN"`) or `"ALL"`
- `route` — optional message prefix match; `"http.access"` captures only access logs

One record can match several sinks. With the configuration above, an ERROR record is written to
both `error.log` and `all.log`.

## Trace context

The logger injects request-scoped tracing automatically:

```kotlin
data class LogContext(
    val traceId: String,       // trace identifier
    val spanId: String?,       // span identifier
    val requestId: String?,    // request identifier
    val userId: String?        // the current user
)
```

`LogContext` is populated when an HTTP request arrives, and every record written during that
request carries these fields — which is what lets you reconstruct one request across modules.

```kotlin
@Get("/{id}")
suspend fun get(id: Long): User? {
    // traceId and spanId are added automatically
    log.info("user.get", mapOf("userId" to id))
    return UserTable.get(id)
}
```

## JSON output

Records are single-line JSON, ready for a collector:

```json
{
  "ts": "2026-02-14T08:30:00.123Z",
  "level": "INFO",
  "msg": "user.get",
  "traceId": "abc123def456",
  "spanId": "span-001",
  "requestId": "req-789",
  "userId": "admin-user",
  "userId_field": 42
}
```

| Field | Source | Meaning |
|---|---|---|
| `ts` | generated | UTC timestamp, ISO 8601 |
| `level` | the call | TRACE / DEBUG / INFO / WARN / ERROR |
| `msg` | first argument | The event name |
| `traceId` | LogContext | Trace identifier, injected |
| `spanId` | LogContext | Span identifier, injected |
| `requestId` | LogContext | Request identifier, injected |
| `userId` | LogContext | Current user, injected |
| everything else | Fields | Your data, flattened into the top level |
| `error` | cause | Exception message (warn and error only) |
| `stackTrace` | cause | Exception stack trace (warn and error only) |

### Redaction

Fields whose keys look sensitive are replaced with `[REDACTED]`, so passwords and tokens do not
reach the log files.

## Rules at a glance

| Rule | Detail |
|---|---|
| No `println` | Everything goes through `Logger` |
| No data in `msg` | `log.info("user.get", ...)`, not `log.info("Getting user $id")` |
| Data in fields | `mapOf("userId" to id, "name" to name)` |
| `cause` on error | `log.error("xxx", fields, cause = ex)` |
| `@Log` for injection | Never call `LoggerFactory.get()` directly |
| Dotted event names | `"user.get"`, `"order.created"`, `"http.access"` |

## A complete example

```kotlin
import neton.core.annotations.*
import neton.core.http.*
import neton.logging.Logger
import neton.logging.Log
import neton.database.dsl.*

@Controller("/api/orders")
@Log
class OrderController(private val log: Logger) {

    @Get
    suspend fun list(
        @QueryParam("status") status: Int?
    ): List<Order> {
        log.info("order.list", mapOf("status" to status))
        return if (status != null) {
            OrderTable.query { where { Order::status eq status } }.list()
        } else {
            OrderTable.findAll()
        }
    }

    @Post
    suspend fun create(@Body order: Order): Order {
        log.info("order.create", mapOf(
            "customerId" to order.customerId,
            "amount" to order.amount
        ))
        return try {
            OrderTable.insert(order)
        } catch (e: Exception) {
            log.error("order.create.failed", mapOf(
                "customerId" to order.customerId,
                "amount" to order.amount
            ), cause = e)
            throw e
        }
    }

    @Delete("/{id}")
    suspend fun cancel(id: Long) {
        log.warn("order.cancel", mapOf("orderId" to id))
        OrderTable.destroy(id)
    }
}
```

## Related

- [Logging specification](/zh-hans/spec/logging) (Chinese) — the full module design
- [Configuration](./configuration.md) — logging settings in `application.conf`
