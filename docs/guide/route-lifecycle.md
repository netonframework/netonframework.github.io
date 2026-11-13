# Route interceptors and completion observers

> Available in the Neton Framework 1.2.0 candidate. These APIs are in source; this guide does not announce a Maven Central release.

The standard HTTP dispatcher offers two extension points. Use an **around interceptor** to wrap a matched route handler, and a **completion observer** to inspect how the dispatcher finished. Neither replaces authentication, authorization, or rate limiting.

| Extension | When it runs | What it can do |
| --- | --- | --- |
| Around interceptor | After admission, security, and rate limiting | Set request attributes, call the handler, inspect or replace its result, or short-circuit |
| Completion observer | When dispatch of a matched route finishes, including rejection, failure, or cancellation | Read a structured result and record a metric or enqueue work |

## Register at startup

Register extensions in your application or module bootstrap before the context is frozen. No controller annotation or runtime scanning is required.

```kotlin
import neton.core.component.NetonContext
import neton.core.http.RouteCompletion
import neton.core.http.RouteSelector
import neton.core.http.routeLifecycle

fun installRouteExtensions(ctx: NetonContext, record: (RouteCompletion) -> Unit) {
    val lifecycle = ctx.routeLifecycle()
    val admin = RouteSelector(group = "admin")
    lifecycle.intercept("example.admin-context", { http, next ->
        http.setAttribute("example.area", "backoffice")
        val result = next() // Call at most once, within this request.
        result             // Runs after the handler returns, before response mapping.
    }, selector = admin)
    lifecycle.observe("example.admin-completion", { completion ->
        record(completion) // Keep this non-blocking.
    }, selector = admin)
}
```

Omit the selector for all matched routes. Combine `group`, `method`, and `pattern` to narrow it; `pattern` is the **mounted route template**, such as `/admin/system/post/get/{id}`, not a concrete URL. IDs must be unique. Extensions are ordered by ascending `order`, then by ID; nested around interceptors unwind in reverse order.

## What completion means

The observer receives the route template, server-generated invocation ID, authenticated actor ID when available, resolved client address, duration, terminal phase, result, and HTTP status or framework error code when available. It does not receive raw route parameters, query values, credentials, or request and response bodies. Observe synchronously and hand off I/O to a bounded queue; do not wait for a database in the callback.

A route can complete without entering its handler. Unmatched requests, CORS preflights and rejections before the dispatcher are out of scope. An upgrade handshake can produce a completion record but does not enter the ordinary around chain. Completion does **not** prove the client received the response, a WebSocket session ended, or a business transaction committed.

See [the HTTP pipeline](./middleware.md) for built-in stages and [operation auditing](./operation-audit.md) for the Neton Application integration.
