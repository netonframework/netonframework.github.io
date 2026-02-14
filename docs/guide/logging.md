# 日志指南

Neton 提供统一的结构化日志 API，所有模块和业务代码通过 `Logger` 接口输出日志。日志以 JSON 格式输出，支持异步写入、多目标路由和请求链路追踪上下文自动注入。

## 核心理念

Neton 日志系统的设计遵循以下原则：

- **结构化优先**：业务数据放在 Fields 中，`msg` 仅作为事件摘要
- **禁止 println**：所有日志输出必须通过 Logger 接口，禁止直接使用 `println`
- **编译期注入**：通过 `@Log` 注解 + 构造函数注入获取 Logger，由 KSP 自动处理
- **上下文自动注入**：traceId、spanId 等链路信息由框架自动注入，业务层无需手动传递

## Logger API

`Logger` 接口提供五个日志级别的方法：

```kotlin
interface Logger {
    fun trace(msg: String, fields: Fields = emptyFields())
    fun debug(msg: String, fields: Fields = emptyFields())
    fun info(msg: String, fields: Fields = emptyFields())
    fun warn(msg: String, fields: Fields = emptyFields(), cause: Throwable? = null)
    fun error(msg: String, fields: Fields = emptyFields(), cause: Throwable? = null)
}
```

其中 `Fields` 是 `Map&lt;String, Any?&gt;` 的类型别名：

```kotlin
typealias Fields = Map<String, Any?>
```

### 日志级别说明

| 级别 | 用途 | cause 参数 |
|------|------|-----------|
| `trace` | 最详细的跟踪信息，通常仅开发时使用 | 不支持 |
| `debug` | 调试信息，排查问题时使用 | 不支持 |
| `info` | 正常运行的关键事件 | 不支持 |
| `warn` | 警告，可能存在问题但不影响运行 | 可选 |
| `error` | 错误，需要关注和处理 | 建议必传 |

## 获取 Logger

通过 `@Log` 注解标注类，并在构造函数中声明 `Logger` 参数。KSP 会在编译期自动生成注入代码：

```kotlin
import neton.logging.Logger
import neton.logging.Log
import neton.core.annotations.*

@Controller("/api/users")
@Log
class UserController(private val log: Logger) {

    @Get("/{id}")
    suspend fun get(id: Long): User? {
        log.info("user.get", mapOf("userId" to id))
        return UserTable.get(id)
    }

    @Post
    suspend fun create(@Body user: User): User {
        log.info("user.create", mapOf("name" to user.name, "email" to user.email))
        return UserTable.save(user)
    }
}
```

构造函数参数名可以是 `log` 或 `logger`，KSP 会识别并注入通过 `LoggerFactory.get("完全限定类名")` 创建的 Logger 实例。

**重要**：业务层禁止直接调用 `LoggerFactory.get()`，必须通过 `@Log` 注解 + 构造注入方式获取 Logger。

## 结构化日志规则

### msg 是事件摘要

`msg` 参数应该是一个简短的事件标识符，采用点分命名法。不要在 msg 中拼接业务数据：

```kotlin
// 正确：msg 是事件标识，数据在 fields 中
log.info("user.get", mapOf("userId" to id))
log.info("order.created", mapOf("orderId" to order.id, "amount" to order.total))
log.error("payment.failed", mapOf("orderId" to orderId, "reason" to "余额不足"), cause = ex)

// 错误：业务数据拼进了 msg
log.info("Getting user $id")              // 不要这样做
log.info("Order ${order.id} created")     // 不要这样做
```

### Fields 承载业务数据

所有需要记录的业务数据都放在 `Fields`（即 `Map&lt;String, Any?&gt;`）中：

```kotlin
log.info("http.request", mapOf(
    "method" to "GET",
    "path" to "/api/users/1",
    "status" to 200,
    "duration" to 15
))

log.warn("cache.miss", mapOf(
    "key" to cacheKey,
    "region" to "user-profile"
))

log.error("db.query.failed", mapOf(
    "table" to "users",
    "operation" to "select",
    "sql" to query
), cause = exception)
```

### error 级别必须传 cause

当记录错误日志时，应始终传入异常对象，以便保留完整的堆栈信息：

```kotlin
try {
    // 业务操作
} catch (e: Exception) {
    log.error("user.update.failed", mapOf(
        "userId" to userId,
        "operation" to "update"
    ), cause = e)  // 必须传 cause
}
```

## 日志配置

日志配置在 `config/application.conf` 的 `[logging]` 节中：

```toml
[logging]
level = "INFO"

[logging.async]
enabled = true
queueSize = 8192
flushEveryMs = 200
flushBatchSize = 64
shutdownFlushTimeoutMs = 2000

[[logging.sinks]]
name = "access"
file = "logs/access.log"
levels = "INFO"
route = "http.access"

[[logging.sinks]]
name = "error"
file = "logs/error.log"
levels = "ERROR,WARN"

[[logging.sinks]]
name = "all"
file = "logs/all.log"
levels = "ALL"
```

### 全局级别

`level` 设置全局最低日志级别。低于此级别的日志不会被处理：

| 级别 | 包含 |
|------|------|
| `"TRACE"` | TRACE, DEBUG, INFO, WARN, ERROR |
| `"DEBUG"` | DEBUG, INFO, WARN, ERROR |
| `"INFO"` | INFO, WARN, ERROR |
| `"WARN"` | WARN, ERROR |
| `"ERROR"` | ERROR |

### 异步日志

生产环境建议开启异步日志，避免 I/O 阻塞业务线程：

| 配置项 | 说明 |
|--------|------|
| `enabled` | 是否启用异步模式 |
| `queueSize` | 异步队列容量，队列满时日志会被丢弃并警告 |
| `flushEveryMs` | 定时刷新间隔（毫秒），即使批次未满也会刷新 |
| `flushBatchSize` | 达到此数量时立即刷新 |
| `shutdownFlushTimeoutMs` | 应用关闭时等待日志刷新的超时时间 |

### Sink 路由

每个 sink 定义一条日志输出规则：

- `name`：sink 名称，用于标识
- `file`：输出文件路径
- `levels`：匹配的日志级别，逗号分隔（如 `"ERROR,WARN"`）或 `"ALL"`
- `route`：可选，匹配日志消息前缀（如 `"http.access"` 只捕获 HTTP 访问日志）

一条日志可以同时匹配多个 sink，实现多路输出。例如上述配置中，一条 ERROR 级别的日志会同时写入 `error.log` 和 `all.log`。

## 链路追踪上下文

Neton 的 Logger 会自动注入请求级别的追踪上下文信息，无需业务代码手动传递：

```kotlin
data class LogContext(
    val traceId: String,       // 链路追踪 ID
    val spanId: String?,       // 跨度 ID
    val requestId: String?,    // 请求 ID
    val userId: String?        // 当前用户 ID
)
```

当 HTTP 请求进入时，框架会自动设置 `LogContext`。在该请求的整个处理链路中，所有通过 Logger 输出的日志都会自动包含这些上下文字段，便于日志聚合和问题排查。

业务代码无需关心 traceId 的传递：

```kotlin
@Get("/{id}")
suspend fun get(id: Long): User? {
    // traceId、spanId 会自动注入到日志输出中
    log.info("user.get", mapOf("userId" to id))
    return UserTable.get(id)
}
```

## JSON 输出格式

日志以单行 JSON 格式输出，便于日志采集系统解析：

```json
{
  "ts": "2026-02-14T08:30:00.123Z",
  "level": "INFO",
  "msg": "user.get",
  "traceId": "abc123def456",
  "spanId": "span-001",
  "requestId": "req-789",
  "userId": "admin-user",
  "userId_field": 42
}
```

字段说明：

| 字段 | 来源 | 说明 |
|------|------|------|
| `ts` | 自动生成 | UTC 时间戳，ISO 8601 格式 |
| `level` | 日志级别 | TRACE / DEBUG / INFO / WARN / ERROR |
| `msg` | 第一个参数 | 事件摘要标识 |
| `traceId` | LogContext | 链路追踪 ID，自动注入 |
| `spanId` | LogContext | 跨度 ID，自动注入 |
| `requestId` | LogContext | 请求 ID，自动注入 |
| `userId` | LogContext | 当前用户 ID，自动注入 |
| 其他字段 | Fields | 业务数据，直接展开到 JSON 顶层 |
| `error` | cause | 异常消息（仅 warn/error 级别） |
| `stackTrace` | cause | 异常堆栈（仅 warn/error 级别） |

### 敏感信息过滤

Logger 会自动对敏感字段进行脱敏处理。匹配敏感 key 名称的字段值会被替换为 `[REDACTED]`，防止密码、Token 等信息泄露到日志中。

## 使用规范速查

| 规则 | 说明 |
|------|------|
| 禁止 `println` | 所有输出必须通过 Logger |
| msg 不拼业务数据 | `log.info("user.get", ...)` 而非 `log.info("Getting user $id")` |
| 业务数据放 Fields | `mapOf("userId" to id, "name" to name)` |
| error 必传 cause | `log.error("xxx", fields, cause = ex)` |
| 用 @Log 获取 Logger | 禁止直接调用 `LoggerFactory.get()` |
| 结构化 key 命名 | 点分法：`"user.get"`、`"order.created"`、`"http.access"` |

## 完整示例

```kotlin
import neton.core.annotations.*
import neton.core.http.*
import neton.logging.Logger
import neton.logging.Log

@Controller("/api/orders")
@Log
class OrderController(private val log: Logger) {

    @Get
    suspend fun list(
        @QueryParam("status") status: Int?
    ): List<Order> {
        log.info("order.list", mapOf("status" to status))
        return if (status != null) {
            OrderTable.where { Order::status eq status }.list()
        } else {
            OrderTable.findAll()
        }
    }

    @Post
    suspend fun create(@Body order: Order): Order {
        log.info("order.create", mapOf(
            "customerId" to order.customerId,
            "amount" to order.amount
        ))
        return try {
            OrderTable.save(order)
        } catch (e: Exception) {
            log.error("order.create.failed", mapOf(
                "customerId" to order.customerId,
                "amount" to order.amount
            ), cause = e)
            throw e
        }
    }

    @Delete("/{id}")
    suspend fun cancel(id: Long) {
        log.warn("order.cancel", mapOf("orderId" to id))
        OrderTable.destroy(id)
    }
}
```

## 相关文档

- [日志规格说明](/spec/logging) -- 日志模块完整设计规格
- [配置指南](/guide/configuration) -- 日志配置在 application.conf 中的详细说明
