# Middleware and the request pipeline

> This guide covers Neton's request pipeline, the built-in security middleware, access logging,
> trace ID propagation and how to pass your own data along the pipeline. Neton v1 uses an implicit
> middleware architecture: security, logging and tracing are built into the request flow.

---

## 1. Request flow

Every HTTP request goes through these stages:

```
HTTP request
  -> HttpAdapter (accepts the connection)
    -> RequestEngine (route matching)
      -> Security pipeline (Authenticator, then Guard)
        -> Rate limiting (@RateLimit, when present)
          -> Route handler (your controller method)
            -> Response serialization (JSON / text / redirect)
              -> Access log
                -> HTTP response
```

| Stage | Responsibility | Module |
|---|---|---|
| **HttpAdapter** | Accept the TCP connection, parse HTTP, build the `HttpContext` | neton-http |
| **RequestEngine** | Match method + path to a route, build `HandlerArgs` | neton-core |
| **Security pipeline** | Authentication and authorization | neton-security |
| **Rate limiting** | Enforce `@RateLimit` through the `RateLimitGate` | neton-http / neton-routing |
| **Route handler** | Run your controller method | your code |
| **Response serialization** | Turn the return value into a response body | neton-http |
| **Access log** | Emit the structured request log | neton-logging |

---

## 2. The security pipeline

Security runs automatically **before** each handler and has two layers.

### 2.1 Authenticator — who are you

An authenticator extracts and verifies an identity, returning an `Identity`:

```kotlin
interface Authenticator {
    val name: String
    suspend fun authenticate(context: RequestContext): Identity?
}
```

| Authenticator | Notes |
|---|---|
| MockAuthenticator | Returns a fixed user; for development and tests |
| AnonymousAuthenticator | Returns null, permitting anonymous access |
| JwtAuthenticator | Parses a JWT token |
| ~~SessionAuthenticator~~ | **Not included in 1.0** — `registerSessionAuthenticator` throws; implement your own `Authenticator` |

### 2.2 Guard — what may you do

A guard runs after authentication and decides whether the identity may reach the resource:

```kotlin
interface Guard {
    suspend fun checkPermission(identity: Identity?, context: RequestContext): Boolean
}
```

| Guard | Notes |
|---|---|
| PublicGuard | Always allows; for public endpoints |
| DefaultGuard | Allows any non-null principal |
| AdminGuard | Requires the admin role |
| RoleGuard | Requires one or all of the given roles |

### 2.3 Pipeline logic

```
handleRoute(route, call)
  |
  +-- build HttpContext (with traceId)
  +-- build HandlerArgs
  +-- security pre-handle:
  |     |
  |     +-- route annotated @AllowAnonymous?
  |     |     -> skip authentication, principal = null, allow
  |     |
  |     +-- security component not installed?
  |     |     +-- route annotated @RequireAuth -> 500 (misconfiguration: fail fast)
  |     |     +-- otherwise -> allow (open by default)
  |     |
  |     +-- security installed:
  |           +-- principal = authenticator.authenticate(ctx)
  |           +-- principal == null and @RequireAuth -> 401 Unauthorized
  |           +-- attributes["principal"] = principal
  |           +-- guard.authorize(principal, ctx) == false -> 403 Forbidden
  |
  +-- rate limit pre-handle: @RateLimit exceeded -> 429 Too Many Requests
  +-- handler.invoke(httpContext, args)
  +-- response serialization
  +-- access log
```

Rate limiting runs after authentication deliberately, so that a per-user limit can see who the
caller is.

### 2.4 Security annotations

```kotlin
@Controller("/api")
class UserController {

    // public: authentication skipped
    @Get("/public/info")
    @AllowAnonymous
    suspend fun publicInfo(): String = "public"

    // any authenticated user
    @Get("/profile")
    @RequireAuth
    suspend fun profile(@CurrentUser user: Identity): String {
        return "Hello ${user.id}"
    }

    // requires the admin role
    @Get("/admin/dashboard")
    @RolesAllowed("admin")
    suspend fun dashboard(): String = "admin only"
}
```

### 2.5 Per-group authentication and authorization

```kotlin
security {
    // the default group uses JWT
    registerAuthenticator(JwtAuthenticator(secretKey = "xxx"))
    bindDefaultGuard()

    // the admin group uses a custom guard
    bindGuard("admin", CustomGuard("admin") { principal, ctx ->
        principal?.hasRole("admin") == true
    })
}
```

---

## 3. Rate limiting

`@RateLimit` is enforced on the live dispatch path, between authentication and the handler:

```kotlin
@Post("/login")
@AllowAnonymous
@RateLimit(windowSeconds = 300, maxRequests = 10, scope = RateLimitScope.IP)
suspend fun login(@Body req: LoginRequest): TokenResponse { ... }
```

| Parameter | Meaning |
|---|---|
| `windowSeconds` | Window length |
| `maxRequests` | Requests permitted per window |
| `scope` | `IP` or `USER` — what the counter is keyed by |
| `key` | Optional explicit key |
| `message` | The message returned when the limit is exceeded |

Only the `FIXED_WINDOW` strategy is supported in v1; anything else is rejected at compile time.
Exceeding the limit produces HTTP 429.

::: warning Upgrading from an earlier build
In releases before 1.0.0-beta1 this annotation parsed and generated metadata but was **never
enforced** — the only enforcement point sat on a code path the HTTP adapter did not call. If you
relied on `@RateLimit` for brute-force protection, you were unprotected. Re-check your limits
after upgrading.
:::

---

## 4. Access logging

Every request produces a structured access log automatically, written through `Logger.info` with
the fixed message `"http.access"`.

### 4.1 Fields

| Field | Meaning |
|---|---|
| `method` | HTTP method |
| `path` | Request path |
| `status` | Response status code |
| `latencyMs` | Duration in milliseconds |
| `bytesIn` | Request body size in bytes |
| `bytesOut` | Response body size in bytes |
| `traceId` | Request trace ID |

### 4.2 Example

```json
{
  "ts": "2026-02-14T10:21:33.123Z",
  "level": "INFO",
  "msg": "http.access",
  "method": "GET",
  "path": "/api/users/1",
  "status": 200,
  "latencyMs": 12,
  "bytesIn": 0,
  "bytesOut": 256,
  "traceId": "req-1707900093-a1b2c3"
}
```

### 4.3 Routing access logs to their own file

```toml
[[logging.sinks]]
name = "access"
file = "logs/access.log"
levels = "INFO"
route = "http.access"
```

---

## 5. Trace ID propagation

Each request gets a unique `traceId` that follows it through its whole lifecycle.

### 5.1 How it is injected

- **Entry** — `HttpAdapter` generates the trace ID on arrival and writes it to `HttpContext.traceId` and `LogContext`.
- **Propagation** — the logger reads it from `LogContext`, so every record carries it without your code passing anything.
- **Consistency** — `HttpContext.traceId` and `LogContext.traceId` are always the same value.

### 5.2 In practice

```kotlin
@Get("/users/{id}")
suspend fun getUser(ctx: HttpContext, @PathVariable id: Long): User? {
    // this record carries the current request's traceId automatically
    log.info("fetching user", mapOf("userId" to id))
    return userService.findById(id)
}
```

```json
{"ts":"...","level":"INFO","msg":"fetching user","userId":1,"traceId":"req-1707900093-a1b2c3"}
{"ts":"...","level":"INFO","msg":"http.access","path":"/users/1","status":200,"traceId":"req-1707900093-a1b2c3"}
```

One trace ID ties the business log to the access log, which is usually all you need to locate a
problem.

---

## 6. HttpContext.attributes — per-request data

`HttpContext.attributes` is a request-scoped `MutableMap<String, Any>` for passing your own data
between pipeline stages.

### 6.1 Reading and writing

```kotlin
// set early in the pipeline, for example inside an Authenticator
ctx.setAttribute("requestTime", System.currentTimeMillis())
ctx.setAttribute("requestId", "req-001")

// read in a controller
val requestTime = ctx.getAttribute("requestTime") as Long
val requestId = ctx.getAttribute("requestId") as String

ctx.removeAttribute("tempData")
```

### 6.2 Built-in attributes

| Key | Type | Set by |
|---|---|---|
| `"principal"` | Identity? | The security pipeline, after authentication |

### 6.3 Typical use

```kotlin
@Controller
class OrderController {

    @Post("/orders")
    @RequireAuth
    suspend fun createOrder(ctx: HttpContext, @Body order: CreateOrderReq): Order {
        val startTime = ctx.getAttribute("requestTime") as? Long
        val principal = ctx.getAttribute("principal") as? Identity
        return orderService.create(order, principal?.id)
    }
}
```

---

## 7. Config SPI: configuration-time middleware

`@NetonConfig` provides declarative global configuration — effectively middleware at the
configuration layer. It runs during component startup (`onStart`) and is where you register
authenticators, guards, data sources and so on.

```kotlin
@NetonConfig("security", order = 0)
class AppSecurityConfig : SecurityConfigurer {
    override fun configure(ctx: NetonContext, target: SecurityBuilder) {
        // a mock authenticator for development
        target.registerMockAuthenticator(
            userId = "test-user",
            roles = listOf("user", "admin")
        )
        target.bindDefaultGuard()
    }
}
```

The principles behind it:

- The DSL (`security { }`) installs components and sets infrastructure parameters, nothing more.
- Business rules — authentication and permission policy — arrive through `@NetonConfig` configurers.
- KSP finds every `@NetonConfig` class at compile time and generates the registry. No reflection.

---

## 8. Looking ahead

v1 builds security, logging and tracing into the request flow, which covers most needs. A formal
middleware pipeline API is planned, adding:

- registration and ordering of custom middleware
- request and response interception
- common middleware such as CORS
- conditional execution per route or method

Until then, custom pipeline logic has three good homes:

1. **`HttpContext.attributes`** — pass data between stages.
2. **`@NetonConfig`** — inject global configuration at startup.
3. **`Guard`** — implement custom authorization.
