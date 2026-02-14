# Neton 缓存注解规范 v1（设计冻结）

> **定位**：在 [Neton-Cache-Spec-v1](./cache.md) 底座（L1/L2、singleflight、TTL、null、clear、codec）之上，提供注解式缓存 DX：一句注解表达「读缓存 + 回源 + 回填」或「先执行业务，再处理缓存」。
>
> **状态**：**v1 设计冻结**。只做 3 个注解，语义与 key 规则写死；实现按本规范填空。
>
> **v1 范围**：**@Cacheable**、**@CachePut**、**@CacheEvict**；key 仅 `{paramName}` 模板（与 @Lock/binding 同一套解析）或默认 hash(args)；**先执行方法、再处理缓存**（Put/Evict）；**不做** condition/unless、beforeInvocation、多 cacheName、分布式 cachefill。

---

## 一、目标与原则

| 原则 | 说明 |
|------|------|
| **声明式缓存** | 读 = getOrPut 声明式；更新/删除 = 方法成功返回后再 put/delete；key 写法直觉。 |
| **方法缓存场景顺手** | 注解即「缓存名 + key 模板 + 可选 TTL」一处写完，不散落配置。 |
| **复用现有体系** | key 模板 `{paramName}` 与 @Lock、Parameter Binding 同一套解析；CacheName 即 cache 命名空间，不要求业务手写前缀。 |
| **v1 最小集** | 只做 3 个注解；不做 condition/unless、beforeInvocation、多 cacheName、分布式锁 cachefill（业务显式用 @Lock 包 loader）。 |

---

## 二、三个注解（v1 仅此三个）

### 2.1 @Cacheable —— 读缓存 + 回源 + 回填

**语义**：等价于对「方法返回值」做 **getOrPut**：命中直接返回；miss 执行方法体（loader），结果非 null 则 put，null 是否缓存由 CacheConfig.nullTtl 决定；进程内 per-key singleflight（底座已实现）。

```kotlin
@Target(AnnotationTarget.FUNCTION)
@Retention(AnnotationRetention.SOURCE)
annotation class Cacheable(
    val name: String,           // 缓存名，对应 CacheConfig.name / getCache(name)
    val key: String = "",       // 空则默认 hash(args)；否则模板，如 "id:{id}"，占位符 {paramName}
    val ttlMs: Long = 0,        // 0 表示用 CacheConfig.ttl；>0 表示该条 TTL 毫秒
)
```

**v1 冻结行为**：

| 行为 | 说明 |
|------|------|
| 命中 | 直接返回缓存值，不执行方法。 |
| miss | 执行方法体，返回值作为 loader 结果。 |
| 回填 | 结果非 null → put(key, value, ttl)；null → 若 config.nullTtl != null 则缓存 null（底座语义）。 |
| 异常 | 方法抛异常 → 不写入缓存；singleflight 时等待方共享同一异常。 |
| TTL | ttlMs > 0 用注解 ttl（毫秒转 Duration），否则用 CacheConfig.ttl。 |
| key | key 非空则按模板解析（见 2.4）；空则默认 hash(方法参数列表)。 |

**示例**：

```kotlin
@Cacheable(name = "user", key = "id:{id}", ttlMs = 10_000)
suspend fun getUser(id: Long): User?
```

---

### 2.2 @CachePut —— 方法成功返回后 put

**语义**：**先执行方法，成功返回后再 put**（失败不 put）。用于更新缓存（如更新用户后写回缓存）。

```kotlin
@Target(AnnotationTarget.FUNCTION)
@Retention(AnnotationRetention.SOURCE)
annotation class CachePut(
    val name: String,
    val key: String = "",
    val ttlMs: Long = 0,         // 0 表示用 CacheConfig.ttl
)
```

**v1 冻结行为**：

| 行为 | 说明 |
|------|------|
| 执行顺序 | **先执行方法体**，再根据返回值处理缓存。 |
| 成功 | 方法正常返回（非异常）→ put(key, 返回值, ttl)。 |
| 失败 | 方法抛异常 → **不 put**。 |
| key / ttl | 同 @Cacheable：key 模板或 hash(args)；ttlMs 为 0 用 config.ttl。 |

**示例**：

```kotlin
@CachePut(name = "user", key = "id:{id}")
suspend fun updateUser(id: Long, req: UpdateUserReq): User
```

---

### 2.3 @CacheEvict —— 方法成功返回后 delete / clear

**语义**：**先执行方法，成功返回后再删缓存**（失败不删）。单 key 删除或 allEntries 时 clear。

```kotlin
@Target(AnnotationTarget.FUNCTION)
@Retention(AnnotationRetention.SOURCE)
annotation class CacheEvict(
    val name: String,
    val key: String = "",       // 空且 allEntries=false 时用 hash(args)
    val allEntries: Boolean = false,
)
```

**v1 冻结行为**：

| 行为 | 说明 |
|------|------|
| 执行顺序 | **先执行方法体**，再根据结果处理缓存。 |
| 成功 | 方法正常返回 → allEntries=false 则 delete(key)；allEntries=true 则 clear()。 |
| 失败 | 方法抛异常 → **不 delete / 不 clear**。 |
| key | allEntries=false 时：key 非空按模板，空则 hash(args)；allEntries=true 时 key 忽略。 |

**示例**：

```kotlin
@CacheEvict(name = "user", key = "id:{id}")
suspend fun deleteUser(id: Long)

@CacheEvict(name = "user", allEntries = true)
suspend fun reloadAllUsers()
```

---

## 三、Key 表达式（v1 冻结）

- **只支持**：
  - **`{paramName}`**：从方法参数按名取值，与 @Lock、Parameter Binding 同一套解析（建议复用 neton 已有 key 模板解析）。
  - **可选**：`{param.property}`（嵌套属性）；v1 若支持需谨慎，KMP 反射成本高，**更建议 KSP 展开为显式参数参与 key**，避免运行时反射。
- **默认**：未提供 key 或 key 为空时，**hash(方法参数列表)** 作为 keyPart（与底座 2.5 一致）。
- **v1 明确不做**：❌ SpEL、❌ 复杂表达式、❌ 函数调用。

**与 @Lock 一致**：key 模板解析逻辑应与 [Neton-Redis-Lock-Spec-v1](./redis-lock.md) 的 @Lock key 一致，便于复用和心智统一。

---

## 四、CacheName 与前缀（不要求业务手写）

- 业务只写 **name**（如 `"user"`），不写 Redis 前缀。
- **v1 冻结 key 结构（三段）**：
  1. **RedisClient 全局前缀**：如 `neton:`（由 RedisConfig.keyPrefix 配置）
  2. **模块命名空间**：cache / lock / kv 等由各模块自己加（cache 层用 `cache:{name}`）
  3. **业务 key**：`{cacheName}:{keyPart}`（如 `user:id:123`）
- 最终示例：`neton:cache:user:id:123`、lock 为 `neton:lock:order:123`。所有 Redis 数据一眼可辨模块；clear/scan 的 match 规则简单、不误删；用户永远不手写前缀。
- 注解层仅传递 **name** 与 **解析后的 keyPart**，由 CacheManager.getCache(name) 与底层 Redis 完成完整 key 拼接。

---

## 五、KSP 织入模板（与 CacheManager/Cache 对接）

### 5.1 生成代码与底座的对接方式

- 在 **编译期** 识别带 @Cacheable / @CachePut / @CacheEvict 的 **suspend 函数**。
- 生成逻辑为「在方法外围包一层」：先解析 key（模板或 hash），再调用 Cache 的 getOrPut / put / delete / clear。

**（v1 冻结）CacheManager 的获取方式**：生成代码**必须**通过 HttpContext 的应用上下文获取 CacheManager，不得在各模块自建获取方式：

```kotlin
val ctx = context.getApplicationContext() ?: throw HttpException(500, "Cache annotations require NetonContext")
val cacheManager = ctx.get(neton.cache.CacheManager::class) ?: throw HttpException(500, "CacheManager not bound. Install cache { } to enable @Cacheable/@CachePut/@CacheEvict.")
```

- 拿不到 NetonContext 或 CacheManager 时，**抛 HttpException 500**（与 validation registry 的 warn 规则相比更硬，避免静默回退导致行为不一致）。
- 这样 KSP 模板唯一，不会出现“各写各的”分歧。

**（v1 冻结）返回值与序列化器约束**：

- v1 **只支持** 返回类型为 **@Serializable** 且能稳定拿到 **serializer()** 的类型。
- 返回类型**允许 T?**（Cacheable 常见）。
- **不支持**：Result\<T\>、Flow\<T\>、List\<T\> 等复杂泛型（除非实现验证过 serializer 可稳定获取）。
- **Unit / Nothing**：**不允许**标注 @Cacheable / @CachePut（KSP 编译期报错）。
- 上述写进规范后，KSP 实现不再纠结边界情况。

**（v1 冻结）key 默认 hash(args) 的稳定性**：

- **必须稳定、可重现**，否则版本升级会导致 key 变化、缓存全失效。
- **输入**：按**参数声明顺序**，**包含 null**；使用**稳定编码**（禁止依赖 `toString()` 等不稳定表示）。
- **输出**：v1 写死一种算法，例如 **xxHash / Murmur3 / SHA-256 截断** 之一，生成**定长 hex 字符串**；实现与文档一致，不可随版本更换算法。

**（v1 冻结）@CacheEvict allEntries 的 L2 行为**：

- `allEntries=true` → 调用 `cache.clear()`；其 L2 行为**直接遵循 [Neton-Cache-Spec-v1](./cache.md) 9.2**：SCAN 优先，无 SCAN 时在 allowKeysClear 下可 KEYS 过渡并 WARN，否则抛异常。注解层不再单独定义 clear 语义。

### 5.2 @Cacheable 织入骨架

```kotlin
// 伪代码：KSP 为 suspend fun getUser(id: Long): User? 生成（handler 内）
val ctx = context.getApplicationContext() ?: throw HttpException(500, "Cache annotations require NetonContext")
val cacheManager = ctx.get(neton.cache.CacheManager::class) ?: throw HttpException(500, "CacheManager not bound. Install cache { } to enable @Cacheable.")
val cache = cacheManager.getCache<User>("user")
val key = if (keyTemplate.isEmpty()) stableHashKey(args) else resolveKeyTemplate(keyTemplate, args)  // 与 @Lock 同套解析
val ttl = if (annotation.ttlMs > 0) annotation.ttlMs.toLong().milliseconds else null
return cache.getOrPut(key, ttl) { ctrl.getUser(id) }
```

- **resolveKeyTemplate**：与 @Lock 的 key 解析同一套（如 `args.first("id")` 等拼成 key 字符串）。
- **stableHashKey(args)**：按 5.1 的 hash 稳定性规则，按参数声明顺序生成稳定 hex。
- **ctrl.getUser(id)**：原方法调用（参数列表与 handler 入参一致）。

### 5.3 @CachePut 织入骨架

```kotlin
val result = ctrl.updateUser(id, req)  // 先执行业务
val ctx = context.getApplicationContext() ?: throw HttpException(500, "...")
val cacheManager = ctx.get(neton.cache.CacheManager::class) ?: throw HttpException(500, "...")
val cache = cacheManager.getCache<User>("user")
val key = if (keyTemplate.isEmpty()) stableHashKey(args) else resolveKeyTemplate(keyTemplate, args)
val ttl = if (annotation.ttlMs > 0) annotation.ttlMs.toLong().milliseconds else null
cache.put(key, result, ttl)
return result
```

- **先执行方法**，再 put；若方法抛异常，不执行 put。

### 5.4 @CacheEvict 织入骨架

```kotlin
// 单 key
ctrl.deleteUser(id)  // 先执行业务
val ctx = context.getApplicationContext() ?: throw HttpException(500, "...")
val cacheManager = ctx.get(neton.cache.CacheManager::class) ?: throw HttpException(500, "...")
val cache = cacheManager.getCache<Any?>("user")  // 仅 delete/clear，类型可擦除
val key = resolveKeyTemplate(keyTemplate, args)
cache.delete(key)
// return 原方法返回值（Unit 则 return Unit）

// allEntries = true
ctrl.reloadAllUsers()
val cache = cacheManager.getCache<Any?>("user")
cache.clear()  // L2 行为遵循 Neton-Cache-Spec-v1 9.2（SCAN 优先、KEYS 过渡）
```

- **先执行方法**，再 delete 或 clear；若方法抛异常，不删缓存。**allEntries 时 clear() 的 L2 语义见底座规范 9.2**。

### 5.5 依赖与放置

- **注解定义**：放在 **neton-cache**（与 Cache/CacheManager 同模块）。
- **KSP 处理器**：放在 **neton-ksp**（与 @Lock 织入一起）；生成代码 import neton.cache.*，应用模块需依赖 neton-cache。
- **CacheManager 注入**：v1 固定为 **context.getApplicationContext()!!.get(CacheManager::class)**，拿不到则抛 HttpException 500（见 5.1）。

---

## 六、v1 不做的（明确边界）

| 不做 | 说明 |
|------|------|
| condition / unless | 不按条件决定是否缓存/失效；v2 可选。 |
| beforeInvocation | Put/Evict 一律 **方法成功返回后** 再写/删。 |
| 多 cacheName 组合 | 一个注解只绑一个 name。 |
| 分布式 cachefill | 不做「跨实例 singleflight」；业务需时在 loader 外包 @Lock，显式选锁 key。 |
| SpEL / 复杂 key 表达式 | 仅 `{paramName}`（及可选 `{param.property}` + KSP 展开）。 |

---

## 七、与底座规范的关系

- **Neton-Cache-Spec-v1**：定义 Cache、CacheManager、CacheConfig、L1/L2、getOrPut、singleflight、TTL、null、clear、codec、key 前缀与 9.1/9.2 约束。
- **本规范**：在上述底座之上，定义 **注解 API + 织入语义**；key 规则与底座 2.5 一致（模板 + hash(args)），前缀由底座统一，注解层不引入新 key 前缀语义。

---

## 八、冻结清单（v1.0）

- [x] 仅 3 个注解：@Cacheable、@CachePut、@CacheEvict。
- [x] @Cacheable = getOrPut 声明式；key、name、ttl 一处配置。
- [x] @CachePut / @CacheEvict：**先执行方法，成功后再 put/delete/clear**；失败不写不删。
- [x] key 仅 `{paramName}` 模板（与 @Lock 同套）或默认 hash(args)；可选 {param.property} 建议 KSP 展开。
- [x] 不要求业务写前缀；CacheName 即 cache 命名空间。
- [x] v1 不做 condition/unless、beforeInvocation、多 cacheName、分布式 cachefill。
- [x] KSP 织入模板与 CacheManager/Cache 对接方式（5.2–5.5）固定，实现按此填空。
- [x] **CacheManager 获取**：生成代码通过 `context.getApplicationContext()!!.get(CacheManager::class)`，拿不到抛 500。
- [x] **返回值约束**：仅 @Serializable 且可拿 serializer()；允许 T?；不支持 Result/Flow/List 等；Unit/Nothing 禁止 @Cacheable/@CachePut。
- [x] **key 默认 hash**：按参数声明顺序、含 null、稳定编码；算法 v1 写死一种（如 xxHash/Murmur3/SHA-256 截断），输出定长 hex。
- [x] **@CacheEvict allEntries**：即 cache.clear()，L2 行为遵循底座 9.2（SCAN 优先、KEYS 过渡）。

---

**文档状态**：**v1 设计冻结**。注解 API 与织入语义按本规范实现；与 [Neton-Cache-Spec-v1](./cache.md) 共同构成 Neton 缓存 v1 的完整边界。
