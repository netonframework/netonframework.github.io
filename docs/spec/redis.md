# Neton Redis 规范

> neton-redis 的设计目标：极简手感、业务零侵入、不暴露底层驱动。提供 Redis 客户端能力与分布式锁支持。

---

## 一、设计目标

### 要什么

- **极简 API**：`get` / `set` / `delete` / `remember` / `pipeline`，无 Template、无 Ops 封装层。
- **类型安全**：`redis.get&lt;User&gt;("user:1")`、`redis.remember&lt;User&gt;("key", ttl) { fetch() }`，基于 reified + kotlinx.serialization。
- **业务零侵入**：业务只依赖 `RedisClient` 接口与扩展方法，不依赖具体实现类。
- **可替换实现**：接口与实现分离，理论上可换底层驱动。

### 不要什么

- ❌ 不暴露 Template / Operations 等中间抽象。
- ❌ 不在业务层出现底层驱动、连接、RESP 等概念。
- ❌ 不支持多后端并存（当前只维护单一实现链路）。

---

## 二、分层与职责

```
┌─────────────────────────────────────────────────────────────┐
│  业务层（Controller / Service）                               │
│  redis.get&lt;T&gt;(key) / redis.set(...) / redis.remember&lt;T&gt;(...) │
└──────────────────────────┬──────────────────────────────────┘
                           │ 仅依赖 RedisClient + 扩展
┌──────────────────────────▼──────────────────────────────────┐
│  neton.redis                                                 │
│  RedisClient（接口）  RedisPipeline（Pipeline DSL）            │
│  RedisExtensions（get/ get&lt;T&gt;/ remember&lt;T&gt;）                  │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  DefaultRedisClient（唯一实现）                               │
│  委托底层 Redis 驱动，序列化、Pipeline 排队执行                │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  底层 Redis 驱动（协程、RESP、连接池、多平台）                  │
└─────────────────────────────────────────────────────────────┘
```

| 层次 | 类型 | 职责 |
|------|------|------|
| 业务 | 任意 | 通过 `ctx.getRedis()` 或 `ServiceFactory.getService(RedisClient::class)` 取得 `RedisClient`，只调用接口与扩展。 |
| 接口 | `RedisClient`、`RedisPipeline` | 定义 KV / Hash / List / Set / Pipeline 能力，不暴露实现。 |
| 扩展 | `RedisExtensions` | `get(key): String?`、`get&lt;T&gt;(key): T?`、`remember&lt;T&gt;(key, ttl) { }`，基于 `getValue` + JSON/基本类型解码。 |
| 实现 | `DefaultRedisClient` | 委托底层 Redis 驱动，实现所有接口方法；Pipeline 当前为顺序执行。 |
| 组件 | `RedisComponent` | Neton 组件，`redis { }` DSL，合并 config/redis.conf，创建并绑定 `RedisClient`。 |
| 配置 | `RedisConfig` | host / port / database / poolSize / password / timeoutMs，`fromMap` 兼容 TOML 解析后的 Map。 |

---

## 三、接口设计

### 3.1 RedisClient

- **KV**：`getValue(key): String?`、`set(key, value: Any, ttl?: Duration)`、`delete`、`exists`、`expire`、`incr`、`decr`。
- **Hash**：`hset`、`hget`、`hgetAll`。
- **List**：`lpush`、`rpush`、`lpop`、`lrange(start, end)`。
- **Set**：`sadd`、`smembers`。
- **Pipeline**：`pipeline(block: RedisPipeline.() -> Unit)`，块内排队，块结束顺序执行。

设计要点：

- 只提供「能力」，不提供「实现细节」；`getValue` 返回原始 String，类型化由扩展完成。
- `set` 的 `value: Any` 由实现侧做字符串序列化（当前 DefaultRedisClient：String/Number/Boolean 直接，其它 `toString()`；若需对象 JSON 往返，可在此处扩展 Json.encodeToString）。
- 不提供 `remember` 在接口层：带类型的「先读缓存再解码」由扩展 `remember&lt;T&gt;` 提供，避免接口与 reified 的冲突。

### 3.2 RedisPipeline

DSL 仅用于「排队」：`set`、`delete`、`incr`、`decr`、`hset`、`lpush`、`rpush`、`sadd`。当前实现为在块结束时**顺序执行**这些挂起的 suspend 调用；后续若需真正 MULTI/EXEC 或批量发送，可在 DefaultRedisClient 内替换为底层驱动的 pipeline API。

### 3.3 扩展（RedisExtensions）

- **get(key): String?**：委托 `getValue(key)`，与接口 `getValue` 区分命名，避免与 `get&lt;T&gt;` 递归。
- **get&lt;T&gt;(key): T?**：`getValue(key)` 非 null 时，按 T 为 String/Int/Long/Double/Float/Boolean 或其它（JSON 反序列化）解码。
- **remember&lt;T&gt;(key, ttl, block)**：先 `getValue(key)`，能解码为 T 则返回；否则执行 `block()`，再 `set(key, value, ttl)` 并返回。对象类型依赖 JSON；当前实现中 `set` 对非基本类型使用 `toString()`，若需完整 JSON 往返，建议在 DefaultRedisClient.serialize 中对可序列化类型使用 `Json.encodeToString`。

---

## 四、配置与组件

- **RedisConfig**：DSL 与 `config/redis.conf` 的承载对象，`fromMap` 兼容 `redis.host`、`redis.port`、`redis.database`、`redis.poolSize`（或 `maxConnections`）、`redis.password`、`redis.timeout`、`redis.debug`。
- **RedisComponent**：`NetonComponent&lt;RedisConfig&gt;`，key = `"redis"`；onInit 时 `mergeWithFile(config)`，校验通过后 `DefaultRedisClient(effective)`，`ctx.bind(RedisClient::class, client)`。
- **安装方式**：`Neton.LaunchBuilder.redis(block: RedisConfig.() -> Unit)` 调用 `install(RedisComponent, block)`，与 `http { }`、`routing { }` 同级。

---

## 五、分布式锁

> **定位**：分布式锁属于 neton-redis（并发控制语义），与 neton-cache（数据一致性与读写语义）无关。业务需要跨进程互斥（幂等、任务调度、资源竞争）时使用 `@Lock` 或编程式 `LockManager`。
>
> **v1 范围**：单 Redis 实例锁（SET NX PX）；token 校验释放（Lua，推荐 EVALSHA）；`DistributedLock` / `LockManager`；lock key 前缀（实现层自动加 `lock:`）；`@Lock` 注解（key 模板、TTL、wait/retry；获取失败固定 409）；不做 RedLock、v1 不做自动续租。

### 5.1 目标与原则

| 原则 | 说明 |
|------|------|
| **锁归 redis** | 分布式锁由 neton-redis 提供，neton-cache 只做进程内 singleflight，不引入 Redis 锁。 |
| **尽力锁** | v1 明确语义：这是「尽力锁」，非强一致。正确用法：TTL 必填（防死锁）、释放必须校验 token（防误删）、长任务可选续租（v2）。 |
| **单实例 v1** | 不做 RedLock（争议大、实现易踩坑，Kotlin Native 多平台时钟/网络更敏感）；v1 仅单 Redis 实例 `SET key token NX PX ttlMillis`。 |
| **DX 友好** | 提供 `@Lock` 注解（类似 lock4j），key 支持简单模板 `{paramName}`，与 Cache key 模板一致。 |

### 5.2 LockManager

```kotlin
interface LockManager {
    /**
     * 尝试获取锁。
     * @param key 业务 key（如 "order:{orderId}"）；本层只传 "lock:" + key 给 RedisClient，keyPrefix 由 neton-redis 统一加
     * @param ttl 锁过期时间（必填，防死锁）
     * @param wait 等待时间，ZERO 表示不等待、立即返回
     * @param retryInterval 轮询间隔；wait > 0 时必须 delay(retryInterval)，禁止 busy loop
     * @return 获取成功返回 DistributedLock，否则 null
     */
    suspend fun tryLock(
        key: String,
        ttl: Duration,
        wait: Duration = Duration.ZERO,
        retryInterval: Duration = 50.milliseconds
    ): DistributedLock?

    /**
     * 获取锁后执行 block，结束后在 finally 中释放（token 校验释放）。
     * 若 wait == ZERO 且未拿到锁，抛 LockNotAcquiredException。
     */
    suspend fun withLock(
        key: String,
        ttl: Duration,
        wait: Duration = Duration.ZERO,
        retryInterval: Duration = 50.milliseconds,
        block: suspend () -> Unit
    )
}
```

- `tryLock`：非阻塞或有限等待，返回 null 表示未拿到。
- `withLock`：拿不到且不等待时抛 `LockNotAcquiredException`；拿到则执行 block，**finally 中 release()**。

### 5.3 DistributedLock

```kotlin
interface DistributedLock {
    val key: String
    val token: String
    /** 释放锁；仅当当前 Redis 中该 key 的 value 等于本 token 时才 DEL，返回是否成功释放 */
    suspend fun release(): Boolean
}
```

- 持有锁的句柄；**释放必须通过 token 校验**，避免误删其他客户端的锁。

### 5.4 异常

```kotlin
/** 在 wait 为 0 或等待超时后仍未获取到锁时抛出。v1 固定：neton-core 统一映射为 HTTP 409 Conflict。 */
class LockNotAcquiredException(
    message: String = "Lock not acquired",
    val key: String,
    cause: Throwable? = null
) : Exception(message, cause)
```

- v1 约定：**获取不到锁** → 抛 `LockNotAcquiredException`；neton-core **固定**映射为 **HTTP 409**。若需 423 等，留 v2 或框架全局配置。

### 5.5 @Lock 注解

#### 注解定义

```kotlin
@Target(AnnotationTarget.FUNCTION)
annotation class Lock(
    val key: String,              // 业务 key，支持模板 "order:{orderId}"；实现层自动加 lock 前缀
    val ttlMs: Long = 10_000,
    val waitMs: Long = 0,         // 0 = 不等待，拿不到立即失败
    val retryMs: Long = 50
    // v1 不暴露 failCode：LockNotAcquiredException 固定映射 HTTP 409，避免 HTTP 语义泄漏到 service 层
)
```

#### 行为（v1 冻结）

| 行为 | 说明 |
|------|------|
| **key 与前缀** | 注解写业务 key（如 `"order:{orderId}"`）；LockManager 只传 `lock:` + key；keyPrefix 由 neton-redis（RedisClient）统一加，与 cache L2 一致。 |
| **key 模板** | 支持简单占位 `{paramName}`，从方法参数按名取值，与 Cache key 模板一致；❌ 无 SpEL、无复杂表达式。 |
| **waitMs == 0** | 拿不到锁立即失败 → 抛 `LockNotAcquiredException` → 框架固定映射 **HTTP 409**。 |
| **waitMs > 0** | 轮询重试，**必须**每次间隔 `delay(retryMs)`，禁止 busy loop；超时仍抛 `LockNotAcquiredException` → 409。 |
| **执行与释放** | 拿到锁后执行方法；**finally 中 token 校验释放**，确保不误删。 |

#### 示例

```kotlin
@Post("/orders/{orderId}/pay")
@Lock(key = "order:{orderId}", ttlMs = 15_000, waitMs = 0)
suspend fun pay(orderId: String, body: PayRequest): Result {
    // 同一 orderId 跨实例互斥；拿不到锁直接 409
}
```

### 5.6 Redis 实现规则（必须遵守）

#### 获取锁

- **命令**：`SET key token NX PX ttlMillis`
- **key**：LockManager 只传 **"lock:" + 业务 key** 给 RedisClient；**keyPrefix（如 "neton"）由 neton-redis 层在 RedisClient 内统一加**（与 cache L2 一致），最终 Redis key = keyPrefix + ":" + "lock:" + key（例：`neton:lock:order:1`）。业务/注解只写 `"order:{orderId}"`，不手写前缀。
- **token**：由实现生成，用于释放时校验，**必须存为 value**。**v1 冻结**：须用 **UUID 或 128-bit 及以上随机**；禁止用时间戳、自增计数等弱 token；**长度不少于 16 字节**（如 UUID 字符串 36 字符），降低碰撞与猜测风险。
- **NX**：仅当 key 不存在时设置。
- **PX**：过期时间毫秒，**v1 必填**。

#### 释放锁（Lua）

- **禁止**：直接 `DEL key`（会误删其他客户端的锁）。
- **必须**：使用 Lua 脚本「比较 value 是否等于本锁的 token，相等才 DEL」。

```lua
-- 释放锁：仅当 value 等于传入的 token 时才删除
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
```

- 调用：`EVAL script 1 <key> <token>`；返回 1 表示释放成功，0 表示未持有或已过期被他人占用。
- **性能建议（v1 推荐）**：实现时先 `SCRIPT LOAD` 得到 SHA，后续用 `EVALSHA sha 1 <key> <token>`，减少每次传脚本文本的开销；若 Redis 未持久化脚本，需在重连或 NOSCRIPT 时回退到 EVAL。

#### 续租（v2 预留）

- v1 **不做**自动续租；业务应把 TTL 设合理，长任务续租留 v2。
- v2 若实现：续租须 **PEXPIRE + token 校验**（同样用 Lua：GET key == token 再 PEXPIRE），避免给别人的锁续期。

### 5.7 与缓存的关系（避免误用）

| 能力 | 用途 |
|------|------|
| **cache** | 读多写少、提升吞吐；L1 + L2；进程内 singleflight；不引入分布式锁。 |
| **lock** | 写冲突 / 并发互斥 / 幂等；跨进程互斥；TTL + token 释放。 |

- cache v1 只做进程内 singleflight：不引入 Redis 锁成本、不把缓存当一致性系统、不引入死锁/续租/超时语义。
- 若业务要「跨实例 singleflight」：可用 `UserCache.getOrPut(...)`（进程内） + 在 loader 外包一层 `@Lock("cachefill:{key}")`（跨进程），由业务显式选择，**不是** cache 默认行为。

### 5.8 模块与依赖

| 模块 | 职责 |
|------|------|
| **neton-redis** | 提供 `LockManager`、`DistributedLock`、`LockNotAcquiredException`；实现 SET NX PX + Lua 释放（及 v2 续租 Lua）；可基于现有 `RedisClient` 或底层连接封装。 |
| **neton-ksp** | 对 Controller/Service 方法上的 `@Lock` 织入：解析 key 模板取参 → `LockManager.withLock(key, ttl, wait, retry) { 调用原方法 }`；拿不到锁时抛 `LockNotAcquiredException`。 |
| **neton-core** | 统一异常映射：`LockNotAcquiredException` → **HTTP 409**（v1 固定），与现有 HttpException 体系一致。 |

- **@Lock 注解**：可定义在 neton-redis（与 LockManager 同模块）或 neton-core（与其它 HTTP 相关注解一起）；若 KSP 在 neton-ksp，注解需被 neton-ksp 依赖，建议放 neton-redis，neton-ksp 依赖 neton-redis 做织入。

---

## 六、实现约束（冻结）

### 6.1 Redis 客户端实现约束（当前）

- **后端**：使用协程、RESP 协议的底层 Redis 驱动，支持连接池。
- **序列化**：KV 的 value 在 DefaultRedisClient 内转为 String：String/Number/Boolean 直接，其它 `toString()`；扩展侧 `get&lt;T&gt;`/`remember&lt;T&gt;` 使用 kotlinx.serialization 的 `Json.decodeFromString(serializer(), s)`。
- **Pipeline**：内部 `PipelineRunner` 收集 block 内操作，块结束后顺序 `op()`。

### 6.2 分布式锁实现冻结约束（v1.0）

以下为 **v1 实现必须遵守** 的约束。

| # | 约束 | 说明 |
|---|------|------|
| 1 | **单实例** | 仅单 Redis 实例锁，不做 RedLock、不做多节点投票。 |
| 2 | **TTL 必填** | 获取锁时 ttl 必传；禁止无过期锁，防止死锁。 |
| 3 | **释放用 Lua** | 释放必须用 Lua：GET key == token 再 DEL；禁止仅 DEL key。 |
| 4 | **token 唯一与强度** | 每次 tryLock 生成唯一 token：**须用 UUID 或 128-bit 及以上随机**；禁止时间戳、自增计数等弱 token；**长度不少于 16 字节**，并作为 value 写入 Redis。 |
| 5 | **@Lock 释放** | 注解织入时，必须在 **finally** 中调用 `lock.release()`，且不吞异常（可记录日志）。 |
| 6 | **v1 不续租** | 不做自动续租；长任务由业务设足够 TTL 或 v2 再实现续租。 |
| 7 | **lock key 前缀** | LockManager 只传 `"lock:" + key` 给 RedisClient；keyPrefix（如 "neton"）由 neton-redis 层在 RedisClient 内统一加，与 cache L2 一致。注解/业务只写业务 key。 |
| 8 | **轮询必须 delay** | wait > 0 时，轮询间隔**必须**使用 `delay(retryInterval)`，**禁止 busy loop**。 |
| 9 | **Lua 用 EVALSHA（推荐）** | 释放与续租（v2）的 Lua 脚本建议先 `SCRIPT LOAD` 再 `EVALSHA`，减少带宽与解析；遇 NOSCRIPT 时回退 EVAL。 |

---

## 七、与 neton-core 的集成

- 通过 **NetonComponent** 与 **ConfigLoader**：组件 key `"redis"`，配置可从 `ConfigLoader.loadComponentConfig("RedisComponent")` 的 `redis` 段合并。
- 业务获取客户端：`NetonContext.getRedis()`（扩展）或 `ServiceFactory.getService(RedisClient::class)`，不直接依赖 DefaultRedisClient。

---

## 八、后续可演进点

### 8.1 Redis 客户端

- **Pipeline**：改用底层驱动的 pipeline API，减少 RTT。
- **对象 set 序列化**：在 DefaultRedisClient.serialize 中对 `kotlinx.serialization.Serializable` 使用 Json，使 `remember&lt;T&gt;` 与 `get&lt;T&gt;` 对自定义类型形成完整 JSON 往返。
- **健康检查**：可选在 RedisComponent.onStart 中 ping 或暴露健康端点。
- **指标**：可选对 get/set/delete/pipeline 做简单计数或延迟统计（不改变现有 API）。

### 8.2 分布式锁（v2 预留）

- RedLock（若后续有明确需求与运维约束）
- 自动续租（长任务）、可配置续租间隔与上限
- 可选的 lock key 前缀配置（与 CacheConfig.keyPrefix 类似）
- **可重入锁（可选）**：同一协程/请求链路内重复进入同一 @Lock 方法或嵌套调用时「自己锁自己」；v1 不实现；v2 可预留 reentrant via **request-scoped token cache**（如 NetonContext / CoroutineContext 缓存 key → token，同一 key 且 token 一致则计数加减，不重复 SET/DEL）
- **failCode 可配置**：若需 423 等，放框架全局配置或 v2 注解可选
