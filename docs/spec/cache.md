# Neton 缓存规范 v1（设计冻结）

> **定位**：Neton 统一缓存抽象，**性能优先**。一级缓存（L1）本地内存 + 二级缓存（L2）**强绑定 neton-redis**，用户不关心层级，只关心「读/写/失效」语义与吞吐。
>
> **状态**：**v1 设计冻结**。实现只允许按本规范填空，不新增抽象；「九、实现冻结约束」6 条为工程约束，必须遵守。
>
> **v1 范围**：Cache / CacheManager / CacheConfig / Cacheable / CacheEvict；L1(LRU+TTL) + L2(仅 neton-redis)；Cache-aside；key 前缀由 CacheConfig；**二进制序列化**（不默认 JSON）；进程内 singleflight。

---

## 一、目标与原则

| 原则 | 说明 |
|------|------|
| **性能优先** | 序列化用二进制（见第四节），避免 JSON 在热路径上的开销；L1 本地命中零网络。 |
| **L2 强绑定** | v1 的 L2 **仅** neton-redis 实现，不做可插拔 L2；保证行为与依赖可控。 |
| **用户不关心层级** | 业务只面对 `Cache` / `@Cacheable`，由框架负责 L1→L2→loader 的透明分层。 |
| **Cache-aside** | 读：先 L1 → miss 再 L2 → miss 再 loader 回填 L2+L1；写：默认 evict（最一致），可选 put。 |

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

## 五、注解与 DX（v1 最小集）

### 5.1 @Cacheable（v1 冻结行为）

- 方法级：返回值按 key 缓存；key 由 CacheConfig 的 key 模板或默认 hash(args) 决定；TTL 可覆盖 CacheConfig。
- 示例：`@Cacheable("user", key = "user:{id}")`，或仅 `@Cacheable("user")` 用参数哈希。
- **v1 不支持**：`condition`、`unless`、`beforeInvocation`、复杂组合（划清界限）。

### 5.2 @CacheEvict（v1 冻结行为）

- 方法**执行后**触发失效；默认只 delete 对应 key；`allEntries = true` 时 clear 该 cache。
- **v1 不支持**：condition、unless、beforeInvocation、复杂组合。

### 5.3 编程式 API

- `cacheManager.getCache&lt;User, User&gt;("user").getOrPut(id) { userRepo.findById(id) }`
- 或由 KSP/字节码在 `@Cacheable` 方法外围生成等价 getOrPut + 调用。

---

## 六、并发与进阶（v1 可选）

- **Singleflight（进程内）**：同一进程内、同一 key、并发 getOrPut 时，只执行一次 loader，其余等待并共享结果；v1 **只做进程内 singleflight**，避免惊群。
- **v1 不做**：❌ Redis 分布式锁、❌ RedLock、❌ 跨进程 singleflight（复杂度与错误成本极高，真需要的场景极少）。**分布式锁**由 **neton-redis** 提供，见 [Neton-Redis-Lock-Spec-v1](./redis-lock.md)；业务需跨进程互斥时使用 `@Lock` 或 `LockManager`，与缓存语义分离。
- **缓存预热**：v1 可不做，由业务在启动时主动 getOrPut 或 put。

---

## 七、模块与依赖

- **neton-cache**：定义 `Cache`、`CacheManager`、`CacheConfig`、注解；实现 L1(LRU+TTL)；**依赖 neton-redis**，L2 仅使用 neton-redis 提供的接口（如 RedisClient 或专为 cache 封装的 Backing）。
- **neton-redis**：需提供可供 cache 使用的「按 key 读写二进制或字符串」的能力；若当前仅有 String，可先扩展 `getBytes`/`setBytes` 或约定 value 为 UTF-8 编码的字符串（过渡），再在 cache 侧用二进制 codec 写入前序列化为 bytes 再转 String 存（不理想）；**更推荐 neton-redis 直接支持 ByteArray value**，供 neton-cache 存二进制 payload。

---

## 八、v1 准冻结清单

- [x] Cache / CacheManager 接口签名（不含 contains）
- [x] CacheConfig（name、**codec**、ttl、nullTtl、maxSize、enableL1、**allowKeysClear**；前缀由 neton-redis 统一管理）
- [x] Key 规则：默认 hash(args)；支持 `"user:{id}"` 模板；**前缀由 RedisConfig.keyPrefix + cache:name**；❌ 无 SpEL/复杂表达式/函数调用
- [x] L2 强绑定 neton-redis，不开放其它 L2
- [x] 序列化：**默认 ProtoBuf**，可选 JSON（仅调试）；**value 带 Codec Header（9.1）**；Redis raw bytes
- [x] Cache-aside 读路径；写默认 evict（delete/clear）
- [x] @Cacheable / @CacheEvict：仅 key/ttl/allEntries，❌ 无 condition/unless/beforeInvocation
- [x] 进程内 singleflight；❌ 无分布式锁/RedLock/跨进程 singleflight
- [x] 可选：null 缓存
- [x] **实现冻结约束（v1.0）**：见下一节，共 6 条，实现必须遵守。

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

## 十、v2 预留

- 其它 L2 实现（如 Caffeine-only、其它分布式缓存）
- JSON 作为可选 Codec（调试或兼容）、contains(key)、统计指标
- 更多 key 策略、多级 TTL、condition/unless

---

## 十一、下一步（实现顺序）

1. **最小可用版本（不做注解）**：neton-cache 模块；Cache / CacheManager / CacheConfig；L1(LRU+TTL)；L2(neton-redis)；getOrPut + **进程内 singleflight**。✅ 已完成。
2. **注解层**：@Cacheable / @CachePut / @CacheEvict + KSP 织入；语义与 API 见 **[Neton-Cache-Annotation-Spec-v1](./cache-annotation.md)**（3 个注解、key 模板与 @Lock 同套）。
3. **neton-redis**：ByteArray 读写、SCAN/KEYS 降级已就绪。

---

**文档状态**：**v1 设计冻结**。实现须遵守「九、实现冻结约束（v1.0 附录）」6 条；注解层按 [Neton-Cache-Annotation-Spec-v1](./cache-annotation.md) 填空；后续扩展走 v2，不推翻本版。
