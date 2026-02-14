# Redis 与分布式锁指南

> 本指南介绍 Neton 的 Redis 组件安装、配置，以及基于 `@Lock` 注解的分布式锁使用方法。Neton 的 Redis 组件提供极简 API，业务层零侵入；分布式锁基于 `SET NX PX` + Lua 脚本释放，安全可靠。

---

## 一、安装 Redis 组件

在应用入口通过 `redis { }` DSL 安装 Redis 组件：

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
            // keyPrefix 默认 "neton"，锁 key = neton:lock:xxx
        }
    }
}
```

安装后，框架自动创建 `RedisClient` 并绑定到上下文，业务代码通过 `ServiceFactory.getService(RedisClient::class)` 或 `ctx.getRedis()` 获取客户端。

---

## 二、Redis 配置

在 `config/application.conf`（TOML 格式）中配置 Redis 连接信息：

```toml
[redis]
host = "localhost"
port = 6379
db = 0
keyPrefix = "neton"
password = ""
poolSize = 10
timeout = 3000
```

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `host` | String | `"localhost"` | Redis 服务器地址 |
| `port` | Int | `6379` | Redis 端口 |
| `db` | Int | `0` | 数据库编号 |
| `keyPrefix` | String | `"neton"` | 全局 key 前缀，所有模块共享 |
| `password` | String | `""` | 认证密码，空则不认证 |
| `poolSize` | Int | `10` | 连接池大小 |
| `timeout` | Int | `3000` | 连接超时（毫秒） |

### keyPrefix 的作用

`keyPrefix` 是所有 Redis 数据的统一前缀，由 `RedisClient` 在底层自动添加。各模块在此基础上再加自己的命名空间：

```
keyPrefix + ":" + 模块命名空间 + ":" + 业务 key

缓存示例：neton:cache:users:id:123
锁示例：  neton:lock:order:456
KV 示例： neton:kv:session:abc
```

业务代码和注解中**永远不需要手写前缀**，只需写业务 key 部分。

---

## 三、Redis 基础操作

`RedisClient` 提供类型安全的极简 API：

```kotlin
val redis = ctx.getRedis()

// 基础 KV
redis.set("user:1", userJson, ttl = 5.minutes)
val value = redis.get("user:1")             // String?
val user = redis.get<User>("user:1")         // 泛型反序列化

// remember：先读缓存，miss 则加载并写入
val user = redis.remember<User>("user:1", ttl = 5.minutes) {
    UserTable.findById(1)
}

// Hash
redis.hset("user:1:profile", "name", "Alice")
val name = redis.hget("user:1:profile", "name")

// List
redis.lpush("queue:tasks", taskJson)
val task = redis.lpop("queue:tasks")

// 删除与检查
redis.delete("user:1")
val exists = redis.exists("user:1")
```

---

## 四、分布式锁

### 4.1 为什么需要分布式锁

当多个服务实例并发处理同一资源时（如支付、库存扣减），需要跨进程互斥。Neton 提供基于 Redis 的分布式锁，适用于：

- 防止重复支付
- 库存扣减幂等
- 定时任务单实例执行
- 资源竞争控制

### 4.2 使用 @Lock 注解

最简单的使用方式是在 Controller 方法上标注 `@Lock`：

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

#### 注解参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `key` | String | -- | 业务 key，支持 `{paramName}` 模板 |
| `ttlMs` | Long | `10_000` | 锁过期时间（毫秒），防止死锁 |
| `waitMs` | Long | `0` | 等待时间，0 表示拿不到锁立即失败 |
| `retryMs` | Long | `50` | 等待时轮询间隔（毫秒） |

#### 锁 key 的完整格式

注解中只写业务 key，框架自动拼接完整 Redis key：

```
keyPrefix + ":" + "lock:" + 业务 key

示例：@Lock(key = "demo:{resourceId}")
      → resourceId = "order-001"
      → 完整 Redis key = neton:lock:demo:order-001
```

#### 并发行为

当同一 `resourceId` 的请求并发到达时：

- **第一个请求**：成功获取锁，执行方法体，返回正常结果。方法执行完毕后（无论成功还是异常），在 `finally` 中通过 token 校验释放锁。
- **后续请求**（`waitMs = 0` 时）：无法获取锁，立即抛出 `LockNotAcquiredException`，框架**固定映射为 HTTP 409 Conflict**。

```
请求 A → 获取锁成功 → 执行业务 → 释放锁 → 200 OK
请求 B → 获取锁失败 → 409 Conflict（{"success":false,"message":"Lock not acquired"}）
```

#### 等待模式

设置 `waitMs > 0` 时，拿不到锁的请求会轮询重试：

```kotlin
@Lock(key = "order:{orderId}", ttlMs = 15_000, waitMs = 5_000, retryMs = 100)
suspend fun processOrder(@PathVariable orderId: String): Result {
    // 等待最多 5 秒，每 100ms 重试一次
    // 超时仍拿不到锁 → 409
}
```

### 4.3 锁的安全性保证

Neton 分布式锁遵循以下安全规则：

| 规则 | 说明 |
|------|------|
| **TTL 必填** | 每把锁必须有过期时间，防止死锁 |
| **Token 校验释放** | 释放锁时通过 Lua 脚本比较 token，确保只释放自己持有的锁 |
| **强随机 Token** | 每次获取锁生成 UUID 级别的随机 token（不少于 16 字节） |
| **finally 释放** | KSP 织入的代码在 finally 中释放锁，确保异常时也能释放 |

释放锁使用的 Lua 脚本：

```lua
-- 仅当 value 等于本锁的 token 时才删除，防止误删他人的锁
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
```

### 4.4 LockManager 编程式 API

除了注解，也可以通过 `LockManager` 编程式使用分布式锁：

```kotlin
val lockManager = ctx.get(LockManager::class)

// 方式一：tryLock + 手动释放
val lock = lockManager.tryLock(
    key = "order:$orderId",
    ttl = 10.seconds
)
if (lock != null) {
    try {
        // 执行业务逻辑
    } finally {
        lock.release()
    }
}

// 方式二：withLock 自动管理（推荐）
lockManager.withLock(
    key = "order:$orderId",
    ttl = 10.seconds
) {
    // 执行业务逻辑
    // 块结束后自动在 finally 中释放锁
}
```

---

## 五、缓存与锁的区别

| 能力 | 适用场景 | 机制 |
|------|----------|------|
| **Cache** | 读多写少、提升吞吐 | L1 + L2；进程内 singleflight；不引入分布式锁 |
| **Lock** | 写冲突、并发互斥、幂等 | 跨进程互斥；TTL + token 释放 |

- 缓存的 singleflight 只做进程内合并（同一进程内同一 key 只执行一次 loader），不涉及跨进程协调。
- 若需要「跨实例的缓存回源互斥」，可在 loader 外层手动包一层 `@Lock`，由业务显式控制。

---

## 六、注意事项

1. **v1 为单 Redis 实例锁**：不做 RedLock 多节点投票，适用于大多数业务场景。

2. **不做自动续租**：v1 不支持锁的自动续期。长任务请将 TTL 设置为足够长的时间，避免业务未完成锁就过期。

3. **轮询禁止 busy loop**：`waitMs > 0` 时，框架使用 `delay(retryMs)` 进行等待，严禁忙等。

4. **409 状态码固定**：v1 中锁获取失败统一返回 HTTP 409 Conflict，不可自定义。

---

## 七、相关文档

- [Redis 设计规范](../spec/redis-design.md) -- Redis 组件的完整架构设计与 API 定义
- [分布式锁规范](../spec/redis-lock.md) -- 锁的技术规范（SET NX PX、Lua 释放、token 策略等）
- [缓存指南](./cache.md) -- 缓存体系的使用指南
