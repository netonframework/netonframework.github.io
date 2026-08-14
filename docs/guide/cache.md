# Cache

> Neton ships a two-tier cache: a transparent L1 + L2 hierarchy plus declarative annotations, so
> that caching costs you very little code.

---

## 1. Architecture: transparent L1 + L2

Application code never has to know which tier holds a value. It only deals in read / write /
invalidate:

```
request → Cache.get(key)
           ├── L1 hit  → return immediately (no network)
           ├── L1 miss → L2 hit → backfill L1 → return
           └── L2 miss → return null (or getOrPut runs the loader)
```

| Tier | Implementation | Characteristics |
|---|---|---|
| **L1 (local)** | In-process LRU + TTL | No network, very low latency; bounded by process memory, sized with `maxSize` |
| **L2 (remote)** | Redis (`neton-redis`) | Shared across processes; binary serialization (ProtoBuf by default), high throughput |

Key rules:

- The L1 TTL is never longer than the L2 TTL, which avoids "ghost" entries that hit L1 after L2 has expired.
- Writes follow **cache-aside** by default: update the database, evict the entry, let the next read backfill it.
- Concurrent `getOrPut` calls for the same key in one process are **singleflighted** — the loader runs once — which prevents a cache stampede.

---

## 2. Installation

The cache is not available until you install it, and its L2 tier is Redis, so `redis { }` must be
installed first:

```kotlin
Neton.run(args) {
    redis { }
    cache {
        cache("users") {
            ttl = 5.minutes
            maxSize = 10_000
        }
    }
}
```

Installing `cache { }` without `redis { }` fails at startup rather than silently degrading to an
L1-only cache, which would behave differently on every instance.

Caches can equally be declared in `config/cache.conf`:

```toml
[caches.users]
ttlMs = 300000
maxSize = 10000
enableL1 = true
```

Values given in the DSL win over the file. Unknown codecs, non-numeric `ttlMs` / `maxSize` and
non-boolean flags are rejected at startup instead of being replaced by defaults.

---

## 3. The programmatic API

```kotlin
interface Cache<K, V> {
    suspend fun get(key: K): V?
    suspend fun put(key: K, value: V, ttl: Duration? = null)
    suspend fun delete(key: K)
    suspend fun clear()
    suspend fun getOrPut(key: K, ttl: Duration? = null, loader: suspend () -> V?): V?
}
```

| Method | Behaviour |
|---|---|
| `get(key)` | Check L1, then L2, then return null |
| `put(key, value, ttl)` | Write to L2 and backfill L1 |
| `delete(key)` | Remove the key from both L2 and L1 |
| `clear()` | Drop every entry of this cache instance (L1 + L2) |
| `getOrPut(key, ttl, loader)` | The cache-aside primitive: on a miss run `loader`, and backfill L2 + L1 when the result is non-null |

```kotlin
val cacheManager = ctx.get(CacheManager::class)
val userCache = cacheManager.getCache<User>("users")

// read through to the database on a miss
val user = userCache.getOrPut("user:$id") {
    UserTable.get(id)
}

userCache.put("user:$id", updatedUser, ttl = 5.minutes)
userCache.delete("user:$id")
```

`CacheManager` also exposes type-agnostic eviction, which matters because L1 is sharded per value
type while L2 is keyed by cache name only:

```kotlin
cacheManager.evict("users", "user:$id")
cacheManager.evictAll("users")
```

---

## 4. Cache configuration

Each named cache instance is configured independently:

| Option | Type | Meaning |
|---|---|---|
| `name` | String | The cache name passed to `getCache(name)`; acts as a namespace |
| `ttl` | Duration | Default expiry |
| `nullTtl` | Duration? | TTL for cached empty results; `null` means empty results are not cached (guards against cache penetration) |
| `maxSize` | Int? | Maximum L1 entries before LRU eviction; `<= 0` means unbounded, so only the TTL evicts |
| `enableL1` | Boolean | Whether the local tier is used; defaults to `true` |

### Full key structure

You supply the key fragment (`"id:123"`); the framework assembles the Redis key:

```
RedisConfig.keyPrefix + ":" + "cache" + ":" + cacheName + ":" + keyPart

example: neton:cache:users:id:123
```

- `keyPrefix` comes from the global Redis configuration (`"neton"` by default)
- `cache` is the fixed namespace of the cache module
- `cacheName` is the cache instance name
- `keyPart` is your key, from a template or a parameter hash

---

## 5. Annotation-driven caching

Three annotations cover read, write and invalidate. KSP weaves them at compile time — no
reflection, no runtime scanning.

::: warning Where these annotations work
They are woven into **`@Controller` route handlers only**, because the weaving point is the
generated route handler. Placing them on a Logic or service class — or on a plain helper method
inside a controller — is a **compile error**, not a silent no-op. To cache inside a Logic class,
call `CacheManager` directly.
:::

### 5.1 @Cacheable — read, load, backfill

Equivalent to `getOrPut`: return the cached value on a hit, otherwise run the method body and
backfill.

```kotlin
@Get("/users/{id}")
@Cacheable(name = "users", key = "{id}", ttlMs = 300_000)
suspend fun getUser(id: Long): User? = UserTable.get(id)
```

| Parameter | Type | Meaning |
|---|---|---|
| `name` | String | The cache name, matching a `CacheConfig` |
| `key` | String | Key template; `{paramName}` reads a handler argument. Empty means "hash the arguments" |
| `ttlMs` | Long | TTL in milliseconds; `0` uses the cache's configured default |

- **Hit** — the cached value is returned and the method body never runs.
- **Miss** — the body runs as the loader; a non-null result is cached.
- **Exception** — nothing is cached, and singleflight waiters observe the same exception.

### 5.2 @CachePut — run first, then update the cache

```kotlin
@Put("/users/{id}")
@CachePut(name = "users", key = "{id}")
suspend fun updateUser(id: Long, @Body user: User): User {
    UserTable.update(user)
    return user
}
```

| Parameter | Type | Meaning |
|---|---|---|
| `name` | String | The cache name |
| `key` | String | Key template |
| `ttlMs` | Long | TTL in milliseconds; `0` uses the default |

- The method **always** runs; the cache is not consulted first.
- On a normal return the result is written with `put(key, result, ttl)`.
- If the method throws, nothing is written.

### 5.3 @CacheEvict — invalidate

```kotlin
@Delete("/users/{id}")
@CacheEvict(name = "users", key = "{id}")
suspend fun deleteUser(id: Long) {
    UserTable.destroy(id)
}
```

| Parameter | Type | Meaning |
|---|---|---|
| `name` | String | The cache name |
| `key` | String | Key template |
| `allEntries` | Boolean | When true, clear the whole cache (default `false`) |

- On a normal return this calls `delete(key)`, or `clear()` when `allEntries = true`.
- If the method throws, nothing is evicted.

```kotlin
@CacheEvict(name = "users", allEntries = true)
suspend fun reloadAllUsers() { /* ... */ }
```

---

## 6. Key template rules

These rules are enforced at compile time, because a key that cannot distinguish two requests
produces a wrong cache hit rather than an error.

- `{paramName}` reads a handler argument by name; an empty template hashes the arguments instead.
- **Only path and query values can appear in a key.** The key is computed from `HandlerArgs`,
  which carries nothing else. Body, header, cookie, form and injected parameters (`HttpContext`,
  `Identity`, uploads) resolve to `null`, so including them would make two different requests share
  one key. A default key over such a parameter is rejected; supply an explicit `key` instead.
- **Use the binding name, not the Kotlin parameter name.** With
  `@PathVariable("id") userId: Long` the runtime key is `id`, so write `{id}`. Writing `{userId}`
  is a compile error that tells you the correct name.
- Only one level of nesting is supported. `{user.id}` is rejected — it would silently resolve to an
  empty string.
- The same template syntax is used by `@Lock`, so there is one rule to remember.
- SpEL and general expressions are not supported in v1.

---

## 7. Notes

1. **Return types.** `@Cacheable` and `@CachePut` require a `@Serializable` return type, since the
   value is serialized into Redis. `T?` is allowed. `Unit`, `Nothing` and `Flow<T>` are rejected at
   compile time — there is nothing to store.

2. **Serialization.** L2 uses ProtoBuf by default for throughput. You can switch a cache to JSON in
   its configuration for debugging.

3. **Empty results.** Set `nullTtl` to cache empty results under a short TTL, which guards against
   cache penetration.

4. **Caching is not locking.** Stampede protection uses in-process singleflight and takes no Redis
   lock. For cross-process mutual exclusion use `@Lock` — see
   [Redis and distributed locks](./redis.md).

---

## 8. Related

- [Redis and distributed locks](./redis.md) — installing Redis and using distributed locks
