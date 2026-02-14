# Neton Redis 分布式锁规范 v1（设计冻结）

> **定位**：分布式锁属于 **neton-redis**（并发控制语义），与 neton-cache（数据一致性与读写语义）无关。业务需要跨进程互斥（幂等、任务调度、资源竞争）时使用 `@Lock` 或编程式 `LockManager`。
>
> **状态**：**v1 设计冻结**。实现只允许按本规范填空；「八、实现冻结约束」为工程约束，必须遵守。
>
> **v1 范围**：单 Redis 实例锁（SET NX PX）；token 校验释放（Lua，推荐 EVALSHA）；`DistributedLock` / `LockManager`；**lock key 前缀**（实现层自动加 `lock:`）；`@Lock` 注解（key 模板、TTL、wait/retry；获取失败**固定 409**）；**不做 RedLock、v1 不做自动续租**。

---

## 一、目标与原则

| 原则 | 说明 |
|------|------|
| **锁归 redis** | 分布式锁由 neton-redis 提供，neton-cache 只做进程内 singleflight，不引入 Redis 锁。 |
| **尽力锁** | v1 明确语义：这是「尽力锁」，非强一致。正确用法：TTL 必填（防死锁）、释放必须校验 token（防误删）、长任务可选续租（v2）。 |
| **单实例 v1** | 不做 RedLock（争议大、实现易踩坑，Kotlin Native 多平台时钟/网络更敏感）；v1 仅单 Redis 实例 `SET key token NX PX ttlMillis`。 |
| **DX 友好** | 提供 `@Lock` 注解（类似 lock4j），key 支持简单模板 `{paramName}`，与 Cache key 模板一致。 |

---

## 二、核心抽象（冻结）

### 2.1 DistributedLock

```kotlin
interface DistributedLock {
    val key: String
    val token: String
    /** 释放锁；仅当当前 Redis 中该 key 的 value 等于本 token 时才 DEL，返回是否成功释放 */
    suspend fun release(): Boolean
}
```

- 持有锁的句柄；**释放必须通过 token 校验**（见 2.4 Lua 释放脚本），避免误删其他客户端的锁。

### 2.2 LockManager

```kotlin
interface LockManager {
    /**
     * 尝试获取锁。
     * @param key 业务 key（如 "order:{orderId}"）；本层只传 "lock:" + key 给 RedisClient，keyPrefix 由 neton-redis 统一加
     * @param ttl 锁过期时间（必填，防死锁）
     * @param wait 等待时间，ZERO 表示不等待、立即返回
     * @param retryInterval 轮询间隔；wait > 0 时**必须** delay(retryInterval)，禁止 busy loop
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

### 2.3 异常

```kotlin
/** 在 wait 为 0 或等待超时后仍未获取到锁时抛出。v1 固定：neton-core 统一映射为 HTTP 409 Conflict。 */
class LockNotAcquiredException(
    message: String = "Lock not acquired",
    val key: String,
    cause: Throwable? = null
) : Exception(message, cause)
```

- v1 约定：**获取不到锁** → 抛 `LockNotAcquiredException`；neton-core **固定**映射为 **HTTP 409**。若需 423 等，留 v2 或框架全局配置。

---

## 三、Redis 实现规则（必须遵守）

### 3.1 获取锁

- **命令**：`SET key token NX PX ttlMillis`
- **key**：LockManager 只传 **"lock:" + 业务 key** 给 RedisClient；**keyPrefix（如 "neton"）由 neton-redis 层在 RedisClient 内统一加**（与 cache L2 一致），最终 Redis key = keyPrefix + ":" + "lock:" + key（例：`neton:lock:order:1`）。业务/注解只写 `"order:{orderId}"`，不手写前缀。
- **token**：由实现生成，用于释放时校验，**必须存为 value**。**v1 冻结**：须用 **UUID 或 128-bit 及以上随机**；禁止用时间戳、自增计数等弱 token；**长度不少于 16 字节**（如 UUID 字符串 36 字符），降低碰撞与猜测风险。
- **NX**：仅当 key 不存在时设置。
- **PX**：过期时间毫秒，**v1 必填**。

### 3.2 释放锁（Lua）

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

- 调用：`EVAL script 1 &lt;key&gt; &lt;token&gt;`；返回 1 表示释放成功，0 表示未持有或已过期被他人占用。
- **性能建议（v1 推荐）**：实现时先 `SCRIPT LOAD` 得到 SHA，后续用 `EVALSHA sha 1 &lt;key&gt; &lt;token&gt;`，减少每次传脚本文本的开销；若 Redis 未持久化脚本，需在重连或 NOSCRIPT 时回退到 EVAL。

### 3.3 续租（v2 预留）

- v1 **不做**自动续租；业务应把 TTL 设合理，长任务续租留 v2。
- v2 若实现：续租须 **PEXPIRE + token 校验**（同样用 Lua：GET key == token 再 PEXPIRE），避免给别人的锁续期。

---

## 四、@Lock 注解（Neton DX）

### 4.1 注解定义

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

### 4.2 行为（v1 冻结）

| 行为 | 说明 |
|------|------|
| **key 与前缀** | 注解写业务 key（如 `"order:{orderId}"`）；LockManager 只传 `lock:` + key；keyPrefix 由 neton-redis（RedisClient）统一加，与 cache L2 一致。 |
| **key 模板** | 支持简单占位 `{paramName}`，从方法参数按名取值，与 Cache key 模板一致；❌ 无 SpEL、无复杂表达式。 |
| **waitMs == 0** | 拿不到锁立即失败 → 抛 `LockNotAcquiredException` → 框架**固定**映射 **HTTP 409**。 |
| **waitMs > 0** | 轮询重试，**必须**每次间隔 `delay(retryMs)`，禁止 busy loop；超时仍抛 `LockNotAcquiredException` → 409。 |
| **执行与释放** | 拿到锁后执行方法；**finally 中 token 校验释放**，确保不误删。 |

### 4.3 示例

```kotlin
@Post("/orders/{orderId}/pay")
@Lock(key = "order:{orderId}", ttlMs = 15_000, waitMs = 0)
suspend fun pay(orderId: String, body: PayRequest): Result {
    // 同一 orderId 跨实例互斥；拿不到锁直接 409
}
```

---

## 五、与缓存的关系（避免误用）

| 能力 | 用途 |
|------|------|
| **cache** | 读多写少、提升吞吐；L1 + L2；进程内 singleflight；不引入分布式锁。 |
| **lock** | 写冲突 / 并发互斥 / 幂等；跨进程互斥；TTL + token 释放。 |

- cache v1 只做进程内 singleflight：不引入 Redis 锁成本、不把缓存当一致性系统、不引入死锁/续租/超时语义。
- 若业务要「跨实例 singleflight」：可用 `UserCache.getOrPut(...)`（进程内） + 在 loader 外包一层 `@Lock("cachefill:{key}")`（跨进程），由业务显式选择，**不是** cache 默认行为。

---

## 六、模块与依赖

| 模块 | 职责 |
|------|------|
| **neton-redis** | 提供 `LockManager`、`DistributedLock`、`LockNotAcquiredException`；实现 SET NX PX + Lua 释放（及 v2 续租 Lua）；可基于现有 `RedisClient` 或底层连接封装。 |
| **neton-ksp** | 对 Controller/Service 方法上的 `@Lock` 织入：解析 key 模板取参 → `LockManager.withLock(key, ttl, wait, retry) { 调用原方法 }`；拿不到锁时抛 `LockNotAcquiredException`。 |
| **neton-core** | 统一异常映射：`LockNotAcquiredException` → **HTTP 409**（v1 固定），与现有 HttpException 体系一致。 |

- **@Lock 注解**：可定义在 neton-redis（与 LockManager 同模块）或 neton-core（与其它 HTTP 相关注解一起）；若 KSP 在 neton-ksp，注解需被 neton-ksp 依赖，建议放 neton-redis，neton-ksp 依赖 neton-redis 做织入。

---

## 七、v1 准冻结清单

- [x] `DistributedLock`（key、token、release()）
- [x] `LockManager`（tryLock、withLock；ttl 必填，wait/retryInterval 可选）
- [x] 获取：SET key token NX PX ttlMillis
- [x] 释放：Lua 脚本比较 token 再 DEL
- [x] v1 不做 RedLock；v1 不做自动续租
- [x] `@Lock`：key 模板 `{paramName}`、ttlMs/waitMs/retryMs；业务 key + 实现层 lock 前缀；拿不到 → LockNotAcquiredException → **固定 409**
- [x] **实现冻结约束**：见下一节。

---

## 八、实现冻结约束（v1.0 附录）

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

## 九、落地顺序（推荐）

1. **neton-redis**：实现 `LockManager`（SET NX PX + Lua release）、`DistributedLock`、`LockNotAcquiredException`；暴露给 Neton 组件或 `RedisComponent` 同机绑定。
2. **neton-ksp**：为带 `@Lock` 的方法生成「key 模板解析 → withLock(key, ttl, wait, retry) { 调用原方法 }」；拿不到锁抛 `LockNotAcquiredException`。
3. **neton-core**：统一异常映射 `LockNotAcquiredException` → **HTTP 409**（v1 固定），与现有异常处理一致。

---

## 十、v2 预留

- RedLock（若后续有明确需求与运维约束）
- 自动续租（长任务）、可配置续租间隔与上限
- 可选的 lock key 前缀配置（与 CacheConfig.keyPrefix 类似）
- **可重入锁（可选）**：同一协程/请求链路内重复进入同一 @Lock 方法或嵌套调用时「自己锁自己」；v1 不实现；v2 可预留 reentrant via **request-scoped token cache**（如 NetonContext / CoroutineContext 缓存 key → token，同一 key 且 token 一致则计数加减，不重复 SET/DEL）
- **failCode 可配置**：若需 423 等，放框架全局配置或 v2 注解可选

---

**文档状态**：**v1 设计冻结**。实现须遵守「八、实现冻结约束」，再按「九、落地顺序」实施；扩展走 v2，不推翻本版。
