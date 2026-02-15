# Neton 缓存规范

> **定位**：Neton 统一缓存抽象，**性能优先**。一级缓存（L1）本地内存 + 二级缓存（L2）**强绑定 neton-redis**，用户不关心层级，只关心「读/写/失效」语义与吞吐。
>
> **状态**：**v1 设计冻结**。实现只允许按本规范填空，不新增抽象；「九、实现冻结约束」6 条为工程约束，必须遵守。
>
> **v1 范围**：Cache / CacheManager / CacheConfig / Cacheable / CachePut / CacheEvict；L1(LRU+TTL) + L2(仅 neton-redis)；Cache-aside；key 前缀由 CacheConfig；**二进制序列化**（不默认 JSON）；进程内 singleflight；注解式缓存。

---

## 一、目标与原则

| 原则 | 说明 |
|------|------|
| **性能优先** | 序列化用二进制（见第四节），避免 JSON 在热路径上的开销；L1 本地命中零网络。 |
| **L2 强绑定** | v1 的 L2 **仅** neton-redis 实现，不做可插拔 L2；保证行为与依赖可控。 |
| **用户不关心层级** | 业务只面对 `Cache` / `@Cacheable`，由框架负责 L1→L2→loader 的透明分层。 |
| **Cache-aside** | 读：先 L1 → miss 再 L2 → miss 再 loader 回填 L2+L1；写：默认 evict（最一致），可选 put。 |
| **声明式缓存** | 读 = getOrPut 声明式；更新/删除 = 方法成功返回后再 put/delete；key 写法直觉。 |

---

## 二、核心抽象（准冻结）

### 2.1 Cache

```kotlin
interface Cache<K, V> {
    suspend fun get(key: K): V?
    suspend fun put(key: K, value: V, ttl: Duration? = null)
    suspend fun delete(key: K)
    suspend fun clear()
    /** Cache-aside：无则加载并回填 */
    suspend fun getOrPut(key: K, ttl: Duration? = null, loader: suspend () -> V?): V?
}
```

- `get`：先 L1，miss 则 L2，再 miss 返回 null（不主动调 loader，由上层或 `getOrPut` 负责）。
- `getOrPut`：get 为 null 时执行 `loader()`，结果非 null 则 put 回 L2+L1，并支持 null 缓存（见 4.3）。
- `put` / `delete`：写 L2 并删除 L1 对应 key；`clear()` 清空该 cache 全部条目（L1+L2），L2 实现见「实现冻结约束」。
- **getOrPut 异常语义（v1 冻结）**：loader 抛异常时**不写入缓存**（不写 null、不写占位）；进程内 singleflight 时，等待方**共享同一异常**（共享失败）。
- **getOrPut 并发（v1 冻结）**：进程内 **per-key** singleflight（如 Mutex/Deferred），同一 key 只执行一次 loader；**不跨 key 串行**。
- **v1 不提供** `contains(key)`；统计/调试用途留 v2。

### 2.2 CacheManager

```kotlin
interface CacheManager {
    fun <K, V> getCache(name: String): Cache<K, V>
    fun getCacheNames(): Set<String>
}
```

- 按 `name` 获取 Cache；每个 name 对应一套 L1+L2 的配置（来自 CacheConfig）。

### 2.3 CacheConfig（按 cacheName 的配置）

**key 前缀（v1 实现）**：**由 neton-redis RedisConfig.keyPrefix 统一配置**，不在 CacheConfig 中单独配置。缓存命名空间固定为 `cache:name`，最终 Redis key = `keyPrefix + ":" + "cache" + ":" + name + ":" + keyPart`（如 RedisConfig.keyPrefix = "neton" → `neton:cache:user:123`）。

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `name` | String | 缓存名，与 `getCache(name)` 一致；用于命名空间 `cache:name`。 |
| **`codec`** | **CacheCodecKind** | **默认 PROTOBUF**；JSON 仅调试、须显式开启；v1 冻结见 9.1。 |
| `ttl` | Duration | 默认 TTL。 |
| `nullTtl` | Duration? | 空值缓存 TTL，null 表示不缓存空值。 |
| `maxSize` | Int? | L1 最大条目数（LRU），null 表示不限制（仅 TTL）。 |
| `enableL1` | Boolean | 是否启用 L1，默认 true。 |
| **`allowKeysClear`** | **Boolean** | **默认 false**。为 true 时允许 clear() 降级使用 KEYS（危险，生产禁用）；v1 冻结见 9.2。 |
| `keyGenerator` | (String, Array&lt;out Any?&gt;) -> String | 见 2.5，可选；未设置时用默认规则。 |

- 示例：name = "user"、RedisConfig.keyPrefix = "neton" → 实际 key 如 `neton:cache:user:123`。

### 2.4 CachePolicy（注解或 DSL 用）

- 可从 CacheConfig 继承，也可在注解上覆盖单次操作的 TTL、是否用 L1、key 等。
- 字段建议：`ttl`、`nullTtl`、`enableL1`、`key`（模板，如 `"user:{id}"`）、`keyGenerator`。

### 2.5 Key 生成规则

- **默认**：`keyPart = cacheName + ":" + hash(args)`（参数列表的稳定哈希）；最终 Redis key = `keyPrefix + ":cache:" + name + ":" + keyPart`（keyPrefix 来自 RedisConfig）。
- **显式模板**：支持 `"user:{id}"` 形式，从方法参数按名取值；最终 key = `keyPrefix + ":cache:" + name + ":" + 替换后的模板`（如 name="user" → `neton:cache:user:1`）。
- **前缀**：由 neton-redis RedisConfig.keyPrefix 统一配置；业务只需关心 key 模板或 args 哈希。
- **v1 冻结**：❌ 不支持 SpEL、❌ 不支持复杂表达式、❌ 不支持函数调用；仅「模板占位 + 默认 hash(args）」两种方式。

---

## 三、L1 / L2 与一致性

### 3.1 L1（本地）

- **实现**：进程内 LRU + TTL，建议有 `maxSize` 上限，避免内存无界。
- **存储**：与 L2 一致使用「序列化后的字节或统一值类型」便于与 L2 对齐；或 L1 存对象、L2 存字节，实现时保证类型一致即可。
- **TTL 协调（v1 冻结）**：**L1 TTL 不得长于 L2 TTL**（否则会产生「幽灵缓存」：L1 仍命中而 L2 已过期）。实现时 L1 TTL = L2 TTL 或更短（如 `min(config.ttl, ttl)`）。

### 3.2 L2（强绑定 neton-redis）

- **v1 规定**：L2 **仅** neton-redis 的实现（如通过 `RedisClient` 或 neton-redis 提供的 CacheBacking 接口），不开放其它 L2 实现。
- **读写**：SET/GET/DEL 等；Redis 协议**二进制安全**，key 和 value 均可用 raw bytes。
- **TTL（v1 冻结）**：`put(key, ttl = null)` 时使用 **CacheConfig.ttl** 作为默认；即 L2 TTL = `ttl ?: config.ttl`。
- **clear() 的 L2 实现（v1 冻结）**：**优先 SCAN**（SCAN cursor MATCH prefix:* COUNT N → pipeline DEL）；**严禁线上默认 KEYS**。仅当 **allowKeysClear=true** 时允许降级 KEYS，且实现必须 **WARN**；文档明确生产禁用。见 9.2。

### 3.3 读路径（Cache-aside）

1. 读 L1 → 命中返回。
2. L1 miss → 读 L2 → 命中则回填 L1 并返回。
3. L2 miss → 返回 null；若调用方是 `getOrPut`，则执行 loader，结果 put 到 L2 再回填 L1。

### 3.4 写路径

- **v1 推荐**：写 DB 后 **evict**（delete/clear），不写回缓存；下次读时 getOrPut 自然回填。若业务需要 put，可提供 `put`，但默认策略为 evict 以保证一致性。

---

## 四、序列化（性能优先）

### 4.1 为何不用 JSON

- JSON 在热路径上解析/序列化成本高，且 Redis 本身**支持 raw bytes**（SET/GET 二进制安全），用二进制可显著降低 CPU 与带宽，更符合「性能优先」和「我们又不是 Java」的诉求。

### 4.2 Redis 与 raw bytes

- **Redis 支持**：SET/GET 的 value 是二进制安全的字符串（字节数组）；neton-redis 若暴露 `setBytes`/`getBytes` 或等价能力，即可直接存 ByteArray。
- **v1 约定**：L2 存 value 使用**二进制序列化**，不默认 JSON。

### 4.3 推荐方案（v1）

| 方案 | 说明 |
|------|------|
| **kotlinx.serialization BinaryFormat** | 使用 kotlinx 的二进制格式（如 `ProtoBuf`、或社区 `CBOR` 等），与现有 `@Serializable` 一致，无额外模型定义。 |
| **ProtoBuf** | 若已有 .proto 或希望跨语言，可选用；v1 也可预留 Codec 扩展点，默认实现用一种二进制格式。 |
| **Raw bytes 约定** | 实现层：L2 的 value = 版本字节(可选) + 二进制 payload；L1 可与 L2 同格式或存反序列化后的对象（由实现决定）。 |

- **结论**：v1 规范只约束「L2 使用二进制序列化」；**默认 ProtoBuf**，**JSON 仅调试、须显式开启**。
- **v1 实现**：默认 **kotlinx-serialization-protobuf**；可选 **JSON**（CacheConfig.codec = JSON），**仅用于调试/排障**，严禁线上默认 JSON（性能/内存/GC 风险）。v1 **value 必须带 codec header**（见 9.1），切换 codec 不炸旧数据。
- **v1 冻结声明**：**v1 不承诺缓存值的人类可读性，只承诺性能与一致性。**
- **内部 Codec 抽象（v1 冻结）**：实现层内部统一 **CacheCodec**（encode/decode）；CacheConfig 提供 **codec: CacheCodecKind**（PROTOBUF/JSON），默认 PROTOBUF。

### 4.4 空值（null）缓存

- 可选支持，避免缓存穿透；由 CacheConfig 的 `nullTtl`、以及策略里的「是否缓存 null」控制；v1 建议默认支持，nullTtl ≤ 主 TTL。
- **null 编码（v1 冻结）**：收敛进 **9.1 Codec Header**；CODEC=0x00 表示 null（无 payload），0x01/0x02 为 ProtoBuf/Json 正常值。

---

## 五、注解式缓存（v1 最小集）

### 5.1 @Cacheable —— 读缓存 + 回源 + 回填

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
| key | key 非空则按模板解析（见 5.5）；空则默认 hash(方法参数列表)。 |

**示例**：

```kotlin
@Cacheable(name = "user", key = "id:{id}", ttlMs = 10_000)
suspend fun getUser(id: Long): User?
```

---

### 5.2 @CachePut —— 方法成功返回后 put

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

### 5.3 @CacheEvict —— 方法成功返回后 delete / clear

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

### 5.4 编程式 API

- `cacheManager.getCache<User, User>("user").getOrPut(id) { userRepo.findById(id) }`
- 或由 KSP/字节码在 `@Cacheable` 方法外围生成等价 getOrPut + 调用。

### 5.5 Key 表达式（v1 冻结）

- **只支持**：
  - **`{paramName}`**：从方法参数按名取值，与 @Lock、Parameter Binding 同一套解析。
  - **可选**：`{param.property}`（嵌套属性）；v1 若支持需谨慎，KMP 反射成本高，**更建议 KSP 展开为显式参数参与 key**，避免运行时反射。
- **默认**：未提供 key 或 key 为空时，**hash(方法参数列表)** 作为 keyPart（与底座 2.5 一致）。
- **v1 明确不做**：❌ SpEL、❌ 复杂表达式、❌ 函数调用。

### 5.6 CacheName 与前缀（不要求业务手写）

- 业务只写 **name**（如 `"user"`），不写 Redis 前缀。
- **v1 冻结 key 结构（三段）**：
  1. **RedisClient 全局前缀**：如 `neton:`（由 RedisConfig.keyPrefix 配置）
  2. **模块命名空间**：cache / lock / kv 等由各模块自己加（cache 层用 `cache:{name}`）
  3. **业务 key**：`{cacheName}:{keyPart}`（如 `user:id:123`）
- 最终示例：`neton:cache:user:id:123`、lock 为 `neton:lock:order:123`。所有 Redis 数据一眼可辨模块；clear/scan 的 match 规则简单、不误删；用户永远不手写前缀。
- 注解层仅传递 **name** 与 **解析后的 keyPart**，由 CacheManager.getCache(name) 与底层 Redis 完成完整 key 拼接。

---

## 六、KSP 织入模板（与 CacheManager/Cache 对接）

### 6.1 生成代码与底座的对接方式

- 在 **编译期** 识别带 @Cacheable / @CachePut / @CacheEvict 的 **suspend 函数**。
- 生成逻辑为「在方法外围包一层」：先解析 key（模板或 hash），再调用 Cache 的 getOrPut / put / delete / clear。

**（v1 冻结）CacheManager 的获取方式**：生成代码**必须**通过 HttpContext 的应用上下文获取 CacheManager，不得在各模块自建获取方式：

```kotlin
val ctx = context.getApplicationContext() ?: throw HttpException(500, "Cache annotations require NetonContext")
val cacheManager = ctx.get(neton.cache.CacheManager::class) ?: throw HttpException(500, "CacheManager not bound. Install cache { } to enable @Cacheable/@CachePut/@CacheEvict.")
```

- 拿不到 NetonContext 或 CacheManager 时，**抛 HttpException 500**（与 validation registry 的 warn 规则相比更硬，避免静默回退导致行为不一致）。
- 这样 KSP 模板唯一，不会出现"各写各的"分歧。

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

- `allEntries=true` → 调用 `cache.clear()`；其 L2 行为**直接遵循 9.2**：SCAN 优先，无 SCAN 时在 allowKeysClear 下可 KEYS 过渡并 WARN，否则抛异常。注解层不再单独定义 clear 语义。

### 6.2 @Cacheable 织入骨架

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
- **stableHashKey(args)**：按 6.1 的 hash 稳定性规则，按参数声明顺序生成稳定 hex。
- **ctrl.getUser(id)**：原方法调用（参数列表与 handler 入参一致）。

### 6.3 @CachePut 织入骨架

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

### 6.4 @CacheEvict 织入骨架

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
cache.clear()  // L2 行为遵循 9.2（SCAN 优先、KEYS 过渡）
```

- **先执行方法**，再 delete 或 clear；若方法抛异常，不删缓存。**allEntries 时 clear() 的 L2 语义见 9.2**。

### 6.5 依赖与放置

- **注解定义**：放在 **neton-cache**（与 Cache/CacheManager 同模块）。
- **KSP 处理器**：放在 **neton-ksp**（与 @Lock 织入一起）；生成代码 import neton.cache.*，应用模块需依赖 neton-cache。
- **CacheManager 注入**：v1 固定为 **context.getApplicationContext()!!.get(CacheManager::class)**，拿不到则抛 HttpException 500（见 6.1）。

---

## 七、并发与进阶（v1 可选）

- **Singleflight（进程内）**：同一进程内、同一 key、并发 getOrPut 时，只执行一次 loader，其余等待并共享结果；v1 **只做进程内 singleflight**，避免惊群。
- **v1 不做**：❌ Redis 分布式锁、❌ RedLock、❌ 跨进程 singleflight（复杂度与错误成本极高，真需要的场景极少）。**分布式锁**由 **neton-redis** 提供，见相关 Lock 规范；业务需跨进程互斥时使用 `@Lock` 或 `LockManager`，与缓存语义分离。
- **缓存预热**：v1 可不做，由业务在启动时主动 getOrPut 或 put。

---

## 八、模块与依赖

- **neton-cache**：定义 `Cache`、`CacheManager`、`CacheConfig`、注解；实现 L1(LRU+TTL)；**依赖 neton-redis**，L2 仅使用 neton-redis 提供的接口（如 RedisClient 或专为 cache 封装的 Backing）。
- **neton-redis**：需提供可供 cache 使用的「按 key 读写二进制或字符串」的能力；若当前仅有 String，可先扩展 `getBytes`/`setBytes` 或约定 value 为 UTF-8 编码的字符串（过渡），再在 cache 侧用二进制 codec 写入前序列化为 bytes 再转 String 存（不理想）；**更推荐 neton-redis 直接支持 ByteArray value**，供 neton-cache 存二进制 payload。

---

## 九、实现冻结约束（v1.0 附录）

### 9.1 Codec Header（v1.0）

L2 存 value **必须**带 2 字节头，实现自描述、切换 codec 不炸旧数据：

```
[ MAGIC 1B = 0x4E ('N') ][ CODEC 1B ][ payload... ]
CODEC: 0x00 = null（无 payload）；0x01 = ProtoBuf；0x02 = Json
```

- 实现必须遵守；v2 增 CBOR 等仅扩展 CODEC 枚举，不破坏格式。

### 9.2 clear() 语义（v1.0）

1. **优先 SCAN**：实现为 **SCAN cursor MATCH prefix:* COUNT N**，逐批 pipeline DEL。
2. **严禁线上默认 KEYS**：KEYS 会阻塞 Redis（O(N)），大 keyspace 可能打挂实例。
3. **KEYS 仅作临时降级**：仅当 **CacheConfig.allowKeysClear = true** 时允许降级 KEYS；实现必须 **启动或执行时打印 WARN**，文档明确**生产环境禁用**。
4. 若 neton-redis 未提供 SCAN 或 SCAN 失败，且 allowKeysClear=false，实现应**抛异常**并提示启用 scan 或显式允许 KEYS。

### 9.3 其余约束（v1.0）

| # | 约束 | 说明 |
|---|------|------|
| 3 | **TTL 协调** | L2 TTL = `ttl ?: config.ttl`；**L1 TTL 不得长于 L2 TTL**（避免幽灵缓存）。 |
| 4 | **loader 异常** | getOrPut 的 loader 抛异常时：**不写入缓存**（不写 null、不写占位）；singleflight 时等待方**共享同一异常**。 |
| 5 | **getOrPut 并发** | 进程内 **per-key** singleflight（如 Mutex/Deferred），同一 key 只执行一次 loader；**不跨 key 串行**。 |
| 6 | **Codec 默认** | 默认 **ProtoBuf**；JSON 仅调试、须显式开启（CacheConfig.codec）；value 带 9.1 header。 |

---

## 十、v1 准冻结清单

- [x] Cache / CacheManager 接口签名（不含 contains）
- [x] CacheConfig（name、**codec**、ttl、nullTtl、maxSize、enableL1、**allowKeysClear**；前缀由 neton-redis 统一管理）
- [x] Key 规则：默认 hash(args)；支持 `"user:{id}"` 模板；**前缀由 RedisConfig.keyPrefix + cache:name**；❌ 无 SpEL/复杂表达式/函数调用
- [x] L2 强绑定 neton-redis，不开放其它 L2
- [x] 序列化：**默认 ProtoBuf**，可选 JSON（仅调试）；**value 带 Codec Header（9.1）**；Redis raw bytes
- [x] Cache-aside 读路径；写默认 evict（delete/clear）
- [x] @Cacheable / @CachePut / @CacheEvict：仅 key/ttl/allEntries，❌ 无 condition/unless/beforeInvocation
- [x] 进程内 singleflight；❌ 无分布式锁/RedLock/跨进程 singleflight
- [x] 可选：null 缓存
- [x] **实现冻结约束（v1.0）**：见第九节，共 6 条，实现必须遵守
- [x] **KSP 织入模板**：通过 HttpContext 获取 CacheManager；返回值仅 @Serializable；key hash 稳定性；@CacheEvict allEntries 遵循 9.2

---

## 十一、v1 不做的（明确边界）

| 不做 | 说明 |
|------|------|
| condition / unless | 不按条件决定是否缓存/失效；v2 可选。 |
| beforeInvocation | Put/Evict 一律 **方法成功返回后** 再写/删。 |
| 多 cacheName 组合 | 一个注解只绑一个 name。 |
| 分布式 cachefill | 不做「跨实例 singleflight」；业务需时在 loader 外包 @Lock，显式选锁 key。 |
| SpEL / 复杂 key 表达式 | 仅 `{paramName}`（及可选 `{param.property}` + KSP 展开）。 |
| 其它 L2 实现 | v2 预留（如 Caffeine-only、其它分布式缓存）。 |
| contains(key) | v2 预留，统计/调试用途。 |

---

## 十二、v2 预留

- 其它 L2 实现（如 Caffeine-only、其它分布式缓存）
- JSON 作为可选 Codec（调试或兼容）、contains(key)、统计指标
- 更多 key 策略、多级 TTL、condition/unless

---

## 十三、下一步（实现顺序）

1. **最小可用版本（不做注解）**：neton-cache 模块；Cache / CacheManager / CacheConfig；L1(LRU+TTL)；L2(neton-redis)；getOrPut + **进程内 singleflight**。✅ 已完成。
2. **注解层**：@Cacheable / @CachePut / @CacheEvict + KSP 织入；语义与 API 见第五、六节（3 个注解、key 模板与 @Lock 同套）。
3. **neton-redis**：ByteArray 读写、SCAN/KEYS 降级已就绪。

---

**文档状态**：**v1 设计冻结**。实现须遵守「九、实现冻结约束（v1.0 附录）」6 条；注解层按第五、六节填空；后续扩展走 v2，不推翻本版。
