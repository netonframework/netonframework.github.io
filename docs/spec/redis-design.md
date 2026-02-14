# Neton Redis 架构设计

> neton-redis 的设计目标：极简手感、业务零侵入、不暴露底层驱动。

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
│  redis.get<T>(key) / redis.set(...) / redis.remember<T>(...) │
└──────────────────────────┬──────────────────────────────────┘
                           │ 仅依赖 RedisClient + 扩展
┌──────────────────────────▼──────────────────────────────────┐
│  neton.redis                                                 │
│  RedisClient（接口）  RedisPipeline（Pipeline DSL）            │
│  RedisExtensions（get/ get<T>/ remember<T>）                  │
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

## 五、实现约束（当前）

- **后端**：使用协程、RESP 协议的底层 Redis 驱动，支持连接池。
- **序列化**：KV 的 value 在 DefaultRedisClient 内转为 String：String/Number/Boolean 直接，其它 `toString()`；扩展侧 `get&lt;T&gt;`/`remember&lt;T&gt;` 使用 kotlinx.serialization 的 `Json.decodeFromString(serializer(), s)`。
- **Pipeline**：内部 `PipelineRunner` 收集 block 内操作，块结束后顺序 `op()`。

---

## 六、与 neton-core 的集成

- 通过 **NetonComponent** 与 **ConfigLoader**：组件 key `"redis"`，配置可从 `ConfigLoader.loadComponentConfig("RedisComponent")` 的 `redis` 段合并。
- 业务获取客户端：`NetonContext.getRedis()`（扩展）或 `ServiceFactory.getService(RedisClient::class)`，不直接依赖 DefaultRedisClient。

---

## 七、后续可演进点

- **Pipeline**：改用底层驱动的 pipeline API，减少 RTT。
- **对象 set 序列化**：在 DefaultRedisClient.serialize 中对 `kotlinx.serialization.Serializable` 使用 Json，使 `remember&lt;T&gt;` 与 `get&lt;T&gt;` 对自定义类型形成完整 JSON 往返。
- **健康检查**：可选在 RedisComponent.onStart 中 ping 或暴露健康端点。
- **指标**：可选对 get/set/delete/pipeline 做简单计数或延迟统计（不改变现有 API）。
