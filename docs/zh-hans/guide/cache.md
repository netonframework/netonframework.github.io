# 缓存指南

> 本指南介绍 Neton 的统一缓存体系。Neton 提供 L1 + L2 透明分层缓存，以及基于注解的声明式缓存 API，让你用最少的代码实现高性能的数据缓存。

---

## 一、架构概览：L1 + L2 透明分层

Neton 缓存采用两级透明分层架构，业务代码无需关心数据存储在哪一层，只需关心「读/写/失效」语义：

```
请求 → Cache.get(key)
         ├── L1 命中 → 直接返回（零网络开销）
         ├── L1 miss → L2 命中 → 回填 L1 → 返回
         └── L2 miss → 返回 null（或由 getOrPut 触发 loader 回源）
```

| 层级 | 实现 | 特点 |
|------|------|------|
| **L1（本地缓存）** | 进程内 LRU + TTL | 零网络、极低延迟；受进程内存限制，可配置 maxSize |
| **L2（远程缓存）** | Redis（neton-redis） | 跨进程共享；二进制序列化（默认 ProtoBuf），高吞吐 |

**关键规则**：

- L1 TTL 不会长于 L2 TTL，避免「幽灵缓存」（L1 命中但 L2 已过期）。
- 写操作默认采用 **Cache-aside** 策略：写 DB 后失效缓存（evict），下次读时自动回填。
- 进程内同一 key 的并发 `getOrPut` 自动 **singleflight**（只执行一次 loader），避免缓存击穿。

---

## 二、安装

缓存必须显式安装才可用，且 L2 就是 Redis，所以要先装 `redis { }`：

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

只装 `cache { }` 而不装 `redis { }` 会在启动时直接失败，而不是退化成「只有 L1」——
那样每个实例的行为都不一样。

也可以写在 `config/cache.conf` 里：

```toml
[caches.users]
ttlMs = 300000
maxSize = 10000
enableL1 = true
```

DSL 显式设置优先于文件。未知的 codec、非数字的 `ttlMs` / `maxSize`、非布尔的开关都会在启动时报错，
不会被悄悄替换成默认值。

---

## 三、缓存接口（编程式 API）

`Cache` 接口提供五个核心操作：

```kotlin
interface Cache<K, V> {
    suspend fun get(key: K): V?
    suspend fun put(key: K, value: V, ttl: Duration? = null)
    suspend fun delete(key: K)
    suspend fun clear()
    suspend fun getOrPut(key: K, ttl: Duration? = null, loader: suspend () -> V?): V?
}
```

| 方法 | 说明 |
|------|------|
| `get(key)` | 先查 L1，miss 查 L2，再 miss 返回 null |
| `put(key, value, ttl)` | 写入 L2 并回填 L1 |
| `delete(key)` | 删除 L2 和 L1 中对应的 key |
| `clear()` | 清空该缓存实例的全部条目（L1 + L2） |
| `getOrPut(key, ttl, loader)` | Cache-aside 核心方法：miss 时执行 loader 回源，结果非 null 则回填 L2 + L1 |

### 编程式使用示例

```kotlin
// 获取 CacheManager
val cacheManager = ctx.get(CacheManager::class)

// 获取名为 "users" 的缓存实例
val userCache = cacheManager.getCache<User>("users")

// 读取缓存，miss 时从数据库加载
val user = userCache.getOrPut("user:$id") {
    UserTable.get(id)
}

// 手动写入缓存
userCache.put("user:$id", updatedUser, ttl = 5.minutes)

// 删除缓存
userCache.delete("user:$id")
```

---

## 四、缓存配置

每个缓存实例（按 name 区分）可独立配置：

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `name` | String | 缓存名，对应 `getCache(name)`，用于命名空间 |
| `ttl` | Duration | 默认过期时间 |
| `nullTtl` | Duration? | 空值缓存 TTL，null 表示不缓存空值（防止缓存穿透） |
| `maxSize` | Int? | L1 最大条目数（LRU 淘汰），null 表示不限（仅 TTL 淘汰） |
| `enableL1` | Boolean | 是否启用 L1 本地缓存，默认 true |

### Key 的完整结构

业务只需关心 key 模板（如 `"id:123"`），框架自动拼接完整的 Redis key：

```
RedisConfig.keyPrefix + ":" + "cache" + ":" + cacheName + ":" + keyPart

示例：neton:cache:users:id:123
```

- `keyPrefix` 来自 Redis 全局配置（默认 `"neton"`）
- `cache` 为缓存模块固定命名空间
- `cacheName` 为缓存实例名称
- `keyPart` 为业务 key（由模板或参数哈希生成）

---

## 五、注解驱动缓存

Neton 提供三个缓存注解，覆盖「读/写/删」三种场景。注解由 KSP 在编译期织入，零反射、零运行时扫描。

::: warning 织入点限制
这些注解**只对 `@Controller` 的路由方法**生效，因为织入点就是生成的 RouteHandler。标在
Logic/Service 上、或标在 Controller 里没有 HTTP 注解的辅助方法上，都会**编译期报错**，
而不是静默失效。要在 Logic 里缓存，请直接调用 `CacheManager`。
:::

### 5.1 @Cacheable -- 读缓存 + 回源 + 回填

最常用的注解。语义等价于 `getOrPut`：命中直接返回，miss 则执行方法体并回填缓存。

```kotlin
@Cacheable(name = "users", key = "{id}", ttlMs = 300_000)
suspend fun getUser(id: Long): User? = UserTable.get(id)
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `name` | String | 缓存名，对应 CacheConfig |
| `key` | String | key 模板，`{paramName}` 从方法参数取值；空则用参数哈希 |
| `ttlMs` | Long | TTL（毫秒），0 表示使用 CacheConfig 的默认 TTL |

**行为说明**：

- **缓存命中**：直接返回缓存值，不执行方法体。
- **缓存 miss**：执行方法体（作为 loader），非 null 结果写入缓存。
- **异常处理**：方法抛异常时不写入缓存，singleflight 等待方共享同一异常。

### 5.2 @CachePut -- 先执行业务，再更新缓存

用于更新场景。**先执行方法体**，成功后将返回值写入缓存。

```kotlin
@Put("/users/{id}")
@CachePut(name = "users", key = "{id}")
suspend fun updateUser(id: Long, @Body user: User): User {
    UserTable.update(user)
    return user
}
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `name` | String | 缓存名 |
| `key` | String | key 模板 |
| `ttlMs` | Long | TTL（毫秒），0 表示使用默认 |

**行为说明**：

- 方法**始终执行**（不检查缓存是否已有值）。
- 方法正常返回后，用返回值执行 `put(key, result, ttl)`。
- 方法抛异常时，不执行 put。

### 5.3 @CacheEvict -- 失效缓存条目

用于删除场景。**先执行方法体**，成功后删除对应缓存。

```kotlin
@CacheEvict(name = "users", key = "{id}")
suspend fun deleteUser(id: Long) {
    UserTable.destroy(id)
}
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `name` | String | 缓存名 |
| `key` | String | key 模板 |
| `allEntries` | Boolean | 为 true 时清空该缓存所有条目（默认 false） |

**行为说明**：

- 方法正常返回后，`allEntries=false` 时执行 `delete(key)`，`allEntries=true` 时执行 `clear()`。
- 方法抛异常时，不删除缓存。

清空所有条目示例：

```kotlin
@CacheEvict(name = "users", allEntries = true)
suspend fun reloadAllUsers() {
    // 重新加载所有用户数据
}
```

---

## 六、完整示例

以下展示一个典型的用户服务缓存方案：

```kotlin
@Controller
class UserController {

    /**
     * 查询用户：优先读缓存，miss 时查数据库并回填。
     * 缓存 5 分钟（300 秒）。
     */
    @Get("/users/{id}")
    @Cacheable(name = "users", key = "{id}", ttlMs = 300_000)
    suspend fun getUser(@PathVariable id: Long): User? {
        return UserTable.get(id)
    }

    /**
     * 更新用户：先执行更新，成功后刷新缓存。
     */
    @Put("/users/{id}")
    @CachePut(name = "users", key = "{id}")
    suspend fun updateUser(
        @PathVariable id: Long,
        @Body user: User
    ): User {
        UserTable.update(user)
        return user
    }

    /**
     * 删除用户：先执行删除，成功后失效缓存。
     */
    @Delete("/users/{id}")
    @CacheEvict(name = "users", key = "{id}")
    suspend fun deleteUser(@PathVariable id: Long) {
        UserTable.destroy(id)
    }
}
```

### Key 模板规则

以下规则由 KSP 在**编译期**强制——key 区分不了两个请求时，后果是「错误命中」而不是报错，
所以必须在编译期拦住。

- `{paramName}`：从方法参数按名称取值；模板为空时改用参数的稳定哈希。
- **key 只能引用 path 和 query 参数**。key 是从 `HandlerArgs` 算出来的，它只装这两类值；
  body、header、cookie、表单、以及注入的框架类型（`HttpContext`、`Identity`、上传文件）
  取到的都是 null，参与进去等于没参与，两个不同请求会算出同一个 key。默认 hash 遇到这类参数
  会直接报错，要求你显式写 `key`。
- **占位符写绑定名，不是 Kotlin 参数名**。`@PathVariable("id") userId: Long` 在运行时的键是
  `id`，所以要写 `{id}`；写 `{userId}` 会编译期报错并提示正确写法。
- 只支持一级占位符。`{user.id}` 会报错——它本来会静默解析成空串。
- 与 `@Lock` 注解使用相同的模板解析机制，心智统一。
- v1 不支持 SpEL 或复杂表达式。

---

## 七、注意事项

1. **返回值约束**：`@Cacheable` 和 `@CachePut` 标注的方法，其返回类型必须是 `@Serializable` 的（用于二进制序列化存入 Redis）。允许 `T?` 类型。`Unit`、`Nothing`、`Flow<T>` 会在编译期报错——没有值可存。

2. **序列化**：L2 缓存默认使用 ProtoBuf 二进制序列化（性能优先），不默认 JSON。如需调试可在 CacheConfig 中显式切换为 JSON（仅限调试环境）。

3. **空值缓存**：通过 `nullTtl` 配置可缓存空结果（较短 TTL），防止缓存穿透。

4. **分布式锁与缓存的区别**：缓存使用进程内 singleflight 防止击穿，不引入 Redis 锁。如需跨进程互斥，请使用 `@Lock` 注解（见 [Redis 与分布式锁指南](./redis.md)）。

---

## 八、相关文档

- [缓存规范](/zh-hans/spec/cache) -- 缓存底座的完整技术规范（L1/L2、序列化、TTL、singleflight、注解式缓存等）
- [Redis 与分布式锁指南](./redis.md) -- Redis 组件安装与分布式锁使用
