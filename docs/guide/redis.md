# Redis and distributed locks

> This guide covers installing and configuring the Redis component and using the `@Lock`
> annotation. The client API is deliberately small; the distributed lock is built on `SET NX PX`
> with a Lua-scripted release.

---

## 1. Installing the component

```kotlin
import neton.core.Neton
import neton.http.http
import neton.redis.redis
import neton.routing.routing

fun main(args: Array<String>) {
    Neton.run(args) {

        http {
            port = 8080
        }

        routing { }

        redis {
            // keyPrefix defaults to "neton", so lock keys look like neton:lock:xxx
        }
    }
}
```

Installing the component creates a `RedisClient` and binds it to the context. Retrieve it with
`ctx.getRedis()` or `ctx.get(RedisClient::class)`. There is no `ServiceFactory`.

---

## 2. Configuration

Redis reads its own file, `config/redis.conf` (TOML), following the "filename = namespace"
convention: keys sit at the **root level** and a `[redis]` section is **not** allowed.

```toml
# config/redis.conf
host = "127.0.0.1"
port = 6379
database = 0
keyPrefix = "neton"
password = ""
poolSize = 16
timeout = 5000
```

| Option | Type | Default | Meaning |
|---|---|---|---|
| `host` | String | `"127.0.0.1"` | Server address |
| `port` | Int | `6379` | Server port |
| `database` | Int | `0` | Database index |
| `keyPrefix` | String | `"neton"` | Global key prefix shared by all modules |
| `password` | String | none | Authentication password; omit for no authentication |
| `poolSize` | Int | `16` | Connection pool size |
| `timeout` | Int | `5000` | Connection timeout in milliseconds, mapped to `RedisConfig.timeoutMs` |

### Precedence

Values set in the `redis { }` DSL take precedence over `redis.conf`, which in turn takes
precedence over the built-in defaults. "Unset" is modelled separately from "set to the default
value", so `redis { port = 6379 }` still wins over a file that says `6380`, and
`redis { debug = false }` genuinely turns off a file's `debug = true`. Likewise
`redis { password = null }` clears a password set in the file.

### What keyPrefix does

`keyPrefix` is prepended to every Redis key by `RedisClient`. Each module adds its own namespace
underneath:

```
keyPrefix + ":" + module namespace + ":" + your key

cache: neton:cache:users:id:123
lock:  neton:lock:order:456
kv:    neton:kv:session:abc
```

You never write the prefix yourself, in code or in annotations — only the trailing key fragment.

---

## 3. Basic operations

```kotlin
val redis = ctx.getRedis()

// key/value
redis.set("user:1", userJson, ttl = 5.minutes)
val value = redis.get("user:1")              // String?
val user = redis.get<User>("user:1")          // deserialized

// remember: read through, loading and storing on a miss
val user = redis.remember<User>("user:1", ttl = 5.minutes) {
    UserTable.get(1)
}

// hashes
redis.hset("user:1:profile", "name", "Alice")
val name = redis.hget("user:1:profile", "name")

// lists
redis.lpush("queue:tasks", taskJson)
val task = redis.lpop("queue:tasks")

// delete and existence
redis.delete("user:1")
val exists = redis.exists("user:1")
```

---

## 4. Distributed locks

### 4.1 When you need one

Multiple instances handling the same resource — payments, stock deduction — need mutual exclusion
across processes. Typical uses:

- preventing duplicate payments
- making stock deduction idempotent
- running a scheduled job on a single instance
- arbitrating contended resources

### 4.2 The @Lock annotation

```kotlin
@Controller
class LockDemoController {

    @Get("/api/lock/{resourceId}")
    @Lock(key = "demo:{resourceId}", ttlMs = 10_000, waitMs = 0)
    suspend fun lockDemo(@PathVariable resourceId: String): String {
        return """{"ok":true,"resourceId":"$resourceId","message":"Lock acquired"}"""
    }
}
```

#### Parameters

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `key` | String | — | Your key, supporting `{paramName}` templates |
| `ttlMs` | Long | `10_000` | Lock expiry in milliseconds, which prevents deadlock |
| `waitMs` | Long | `0` | How long to wait; `0` fails immediately |
| `retryMs` | Long | `50` | Polling interval while waiting, in milliseconds |

::: warning Where @Lock works
Like the cache annotations, `@Lock` is woven into **`@Controller` route handlers only**. On a
Logic or service class, or on a helper method without an HTTP annotation, it is a **compile
error** rather than a silent no-op — use `LockManager.withLock` directly there.

Key templates may reference **path and query parameters only**, and must use the binding name:
with `@PathVariable("id") userId` write `{id}`, not `{userId}`. Both rules are enforced at compile
time.
:::

#### Full lock key

```
keyPrefix + ":" + "lock:" + your key

@Lock(key = "demo:{resourceId}")
  with resourceId = "order-001"
  → neton:lock:demo:order-001
```

#### Concurrent behaviour

For concurrent requests carrying the same `resourceId`:

- **The first request** acquires the lock, runs the body, and releases the lock in a `finally`
  block after a token check — whether the body succeeded or threw.
- **Subsequent requests** (with `waitMs = 0`) fail to acquire it and raise
  `LockNotAcquiredException`, which the framework maps to **HTTP 409 Conflict**.

```
request A → acquired → body runs → released → 200 OK
request B → not acquired → 409 Conflict ({"success":false,"message":"Lock not acquired"})
```

#### Waiting

With `waitMs > 0` a blocked request polls:

```kotlin
@Lock(key = "order:{orderId}", ttlMs = 15_000, waitMs = 5_000, retryMs = 100)
suspend fun processOrder(@PathVariable orderId: String): Result {
    // waits up to 5 s, retrying every 100 ms
    // still unavailable after that → 409
}
```

### 4.3 Safety guarantees

| Rule | Why |
|---|---|
| **TTL is mandatory** | Every lock expires, so a crashed holder cannot deadlock the system |
| **Token-checked release** | A Lua script compares the token before deleting, so you only ever release your own lock |
| **Strong random token** | Each acquisition generates a UUID-grade token of at least 16 bytes |
| **Released in `finally`** | The KSP-woven code releases in a `finally` block, so exceptions still release |

The release script:

```lua
-- delete only when the value matches our token, so we never drop someone else's lock
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
```

### 4.4 The LockManager API

```kotlin
val lockManager = ctx.get(LockManager::class)

// explicit acquire and release
val lock = lockManager.tryLock(
    key = "order:$orderId",
    ttl = 10.seconds
)
if (lock != null) {
    try {
        // work
    } finally {
        lock.release()
    }
}

// scoped, and preferred
lockManager.withLock(
    key = "order:$orderId",
    ttl = 10.seconds
) {
    // work; the lock is released in a finally block on exit
}
```

---

## 5. Caching versus locking

| Capability | Use when | Mechanism |
|---|---|---|
| **Cache** | Reads dominate and you want throughput | L1 + L2, in-process singleflight, no distributed lock |
| **Lock** | Writes conflict and you need mutual exclusion or idempotency | Cross-process exclusion with TTL and token release |

Singleflight only collapses concurrent loads **within one process**; it does no cross-process
coordination. If you need instances to serialize their cache reloads, wrap the loader in an
explicit `@Lock`.

---

## 6. Notes

1. **Single-instance locks in v1.** There is no RedLock multi-node quorum, which is adequate for most workloads.

2. **No auto-renewal.** v1 does not extend a lock's lease. Give long-running work a TTL comfortably longer than it needs, so the lock does not expire mid-flight.

3. **No busy waiting.** With `waitMs > 0` the framework waits with `delay(retryMs)`; spinning is not allowed.

4. **409 is fixed.** In v1 a failed acquisition always maps to HTTP 409 Conflict and cannot be customised.

---

## 7. Related

- [Cache](./cache.md) — the caching guide
