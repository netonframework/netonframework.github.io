# Neton 日志规范 v1（设计冻结）

> **定位**：neton-logging 是 Neton 的日志能力核心。不是「打印日志」，而是：**可观测性入口**、**故障定位唯一事实源**、**分布式系统的最低公共语言**。
>
> **状态**：**v1 设计冻结**。以下 7 件事为冻结范围；实现只允许按本规范填空。所有 neton-* 模块**只能**依赖本规范定义的 Logger API，禁止 `println` / println-like。
>
> **v1 范围**：唯一 Logger API、结构化日志默认、Trace/Request Context、HTTP 访问日志字段、异常日志规则、内建脱敏、日志等级与采样策略。实现可放在 neton-runtime / neton-logging-impl，KMP 友好（Native / JVM / JS 均可落盘）。

---

## 一、目标与原则

| 原则 | 说明 |
|------|------|
| **地基模块** | neton-logging 是 Neton 的地基；cache / lock / http / ksp / validation 均依赖本体系，无强约束 logging 会导致后续返工。 |
| **唯一 Logger API** | 所有 neton-* 模块只依赖本接口；实现藏在 neton-runtime / neton-logging-impl，业务与其它模块不直接依赖实现。 |
| **结构化优先** | 日志是结构化事件，fields 是一等公民，message 只是摘要；禁止在 msg 里拼业务数据。 |
| **上下文必做** | Trace/Request Context（traceId、spanId 等）存在于 CoroutineContext / NetonContext，logger 自动注入，业务不手传 traceId。 |
| **脱敏内建** | 脱敏是框架内建能力，不是业务责任；日志输出前统一脱敏，业务代码永远不直接脱敏。 |

---

## 二、唯一 Logger API（硬约束，冻结）

**禁止**：`println`、`print`、以及任何「绕过 Logger 接口」的类 println 输出。

所有 neton-* 模块**只能**使用下述接口：

```kotlin
interface Logger {
    fun trace(msg: String, fields: Fields = emptyFields())
    fun debug(msg: String, fields: Fields = emptyFields())
    fun info(msg: String, fields: Fields = emptyFields())
    fun warn(msg: String, fields: Fields = emptyFields(), cause: Throwable? = null)
    fun error(msg: String, fields: Fields = emptyFields(), cause: Throwable? = null)
}
```

- **实现**：由 neton-runtime / neton-logging-impl 提供；neton-core 只做 Logger 的 **bind**（注入/获取）。
- **KMP**：接口与数据类型放在 neton-logging（commonMain），实现可多平台 expect/actual 或共用 JsonLogger。

---

## 三、结构化日志是默认（不是可选）

日志不是「字符串」，而是**结构化事件**。`Fields` 类型冻结为 `Map&lt;String, Any?&gt;`；**Fields 的 value 只允许**：String、Number、Boolean、Enum、List/Map（递归同规则）；**禁止**任意业务对象（避免大对象/循环引用、保证可序列化与聚合）。

输出形态（v1 建议 JSON）示例：

```json
{
  "ts": "2026-02-09T10:21:33.123Z",
  "level": "INFO",
  "service": "user-service",
  "env": "prod",
  "traceId": "a1b2c3",
  "spanId": "s9x",
  "msg": "http request",
  "method": "GET",
  "path": "/users/1",
  "status": 200,
  "latencyMs": 12
}
```

| 规则 | 说明 |
|------|------|
| fields 是一等公民 | 业务数据放在 `Fields` 中，不拼进 `msg`。 |
| message 只是摘要 | `msg` 用于人类可读简短描述，便于检索时扫一眼。 |
| 禁止在 msg 里拼业务数据 | 例如禁止 `"user id: $id"` 把 id 放进 msg；应 `fields = mapOf("userId" to id)`。 |

---

## 四、Trace / Request Context（必做）

neton-logging 必须能访问「请求上下文」，用于自动注入 traceId、spanId 等。

```kotlin
data class LogContext(
    val traceId: String,
    val spanId: String? = null,
    val requestId: String? = null,
    val userId: String? = null
)
```

| 规则 | 说明 |
|------|------|
| 存放位置 | 请求入口由 neton-http 注入：v1 使用 [CurrentLogContext]（set/clear 包裹 handler），Logger 实现从 CurrentLogContext.get() 读取；亦可与 CoroutineContext 并存。 |
| 自动注入 | Logger 实现层从当前 Context（如 CurrentLogContext）读取 LogContext，每条日志自动带上 traceId、spanId 等，业务代码**不需要**手动传 traceId。 |
| 用途 | 锁、cache、db、http 等模块在排查「锁没释放？cache 穿透？redis 慢？」时，可凭 traceId 串联全链路。 |
| **v1 与 OTel** | **v1 不实现** tracing SDK；traceId/spanId 由 Neton 自己生成。v2 可选与 OpenTelemetry 对接，但不影响本规范。 |

---

## 五、HTTP 访问日志（自动，字段冻结）

neton-http 启动后**自动**产生：

- **access log**（info 级别）
- **error log**（warn / error，请求异常或 5xx 时）

**与业务日志统一**：access log 使用**同一** `Logger.info`，仅 **msg 固定**（如 `"http.access"`），便于统一采样、统一输出、对接日志采集系统。

**v1 冻结字段**（实现必须包含，可增不可删）：

| 字段 | 必须 | 说明 |
|------|------|------|
| method | ✅ | HTTP 方法 |
| path | ✅ | 请求路径 |
| status | ✅ | HTTP 状态码 |
| latencyMs | ✅ | 请求耗时（毫秒） |
| bytesIn / bytesOut | ✅ | 请求/响应体大小（可选键名，但必须有「入/出」字节数） |
| traceId | ✅ | 来自 LogContext |

---

## 六、异常日志规则（极其重要，冻结）

| 级别 | throwable | 说明 |
|------|-----------|------|
| error | **必须有** cause | 记录错误时必须传 `cause: Throwable`，便于堆栈与聚合。 |
| warn | 可有 cause | 可选。 |
| info / debug | **禁止** cause | 不提供带 Throwable 的重载，避免误用。 |

**正确示例**：

```kotlin
logger.error(
    "redis lock release failed",
    fields = mapOf("key" to lockKey),
    cause = e
)
```

**禁止**：

```kotlin
logger.error("xxx ${e.message}")  // 无 cause，且业务数据在 msg 里
```

---

## 七、脱敏是内建能力（不是业务责任）

内建 **SensitiveFieldFilter**（或等价机制），在日志**输出前**统一脱敏。业务代码永远不直接脱敏。

**v1 冻结规则**：

| 位置 | 脱敏键（或键名匹配） |
|------|------------------------|
| header | Authorization, Cookie |
| query | token, password |
| body | v1 可选不做；若做则 password、token、secret 等 |

- 实现层在序列化/写出前对上述键做脱敏（如 `***` 或 `[REDACTED]`）。
- 不在业务代码里对上述字段做字符串替换后再打日志。

---

## 八、日志等级与采样（prod 必须）

v1 **最小实现**：

| 环境 | 策略 |
|------|------|
| dev | 全量 debug。 |
| prod | info：100%；debug：采样（如 1%）或关闭；error：100%。 |

- 采样策略由实现层（neton-logging-impl）或配置决定，API 层不暴露「是否被采样」给业务。
- 等级配置建议通过环境变量或 Neton 统一配置（如 `LOG_LEVEL=INFO`）。

---

## 九、@Log 与 Logger 注入（v1 冻结）

### 9.1 为什么不能无参 get()？

在 KMP 中，构造函数/属性初始化阶段**没有**稳定、跨平台的「当前类上下文」；JVM 的 StackTrace 慢且混淆后不可靠，Native/JS 更无此能力。故 **LoggerFactory 无参 get() 在 v1 不可实现**，命名来源必须由调用方或框架提供。

### 9.2 分层规则（冻结）

| 层级 | 用法 | 说明 |
|------|------|------|
| **业务 / Controller / Service** | **仅**通过构造注入 `Logger`，**禁止**直接调用 `LoggerFactory.get()` | 使用 `@Log` + 构造参数 `log: Logger`，由 KSP 在实例化时注入。 |
| **框架 / KSP / runtime** | 允许 `LoggerFactory.get(name)`、`LoggerFactory.get(clazz)` | 用于生成「属于当前类的 Logger」并注入到带 `@Log` 的类。 |

- 业务代码 **0 认知** LoggerFactory；不出现 `get(this)` / `get(Class)` 的重复书写。
- **禁止**：业务中 `loggerFactory.get()`、`loggerFactory.get(this)`（不可实现或不稳定）。

### 9.3 @Log 注解与注入规则（v1）

- **注解**：`@Log` 标注在**类**上（如 Controller、Service），表示该类需要注入一个「属于当前类」的 Logger。
- **构造注入**：类必须有一个类型为 `Logger` 的构造参数（名称不限，如 `log`、`logger`）；KSP 在生成 Controller 实例化代码时，对该参数传入 `ctx.get(LoggerFactory::class).get("完全限定类名")`。
- **命名规则**：Logger 的 name 固定为类的**完全限定名**（如 `neton.example.controller.UserController`），不由业务指定。
- **v1 不做**：AOP、方法级 @Log、自定义 name；仅做「构造参数解析 + 注入」。

### 9.4 推荐写法（业务层）

```kotlin
@Controller
@Log
class UserController(
    private val userService: UserService,
    private val log: Logger
) {
    @Get("/user/{id}")
    suspend fun getUser(ctx: HttpContext, id: Long): User? {
        log.info("getUser", mapOf("id" to id))
        return userService.findById(id)
    }
}
```

框架层（KSP 生成）等价于：`UserController(ctx.get(UserService::class), ctx.get(LoggerFactory::class).get("neton.example.controller.UserController"))`。

---

## 十、模块结构（不膨胀）

**API 层（neton-logging）**——所有模块只依赖此层：

```
neton-logging/
├── Logger.kt              // 唯一 Logger 接口（冻结）
├── LoggerFactory.kt       // get(name) / get(clazz)；框架层 API
├── Log.kt                 // @Log 注解（类级，表需注入 Logger）
├── LogContext.kt          // 请求上下文数据类
├── Fields.kt              // 结构化字段类型 + emptyFields()
├── SensitiveFilter.kt     // 脱敏规则/接口（v1 规则冻结）
└── LogLevel.kt            // 等级枚举（trace/debug/info/warn/error）
```

**实现层（可晚一点，如 neton-logging-impl 或 neton-runtime）**：

```
neton-logging-impl/
├── JsonLogger.kt          // stdout JSON 实现
├── ContextInjector.kt      // 从 CoroutineContext/NetonContext 取 LogContext
└── SamplingPolicy.kt      // 等级与采样策略
```

neton-core 只负责 **bind Logger**（在启动/请求链中注入 Logger 实现）。

---

## 十一、实现冻结约束（工程约束）

1. **禁止**在任何 neton-* 源码中使用 `println`、`print`、或等价「直接写标准输出」的方式记录业务/框架日志；必须通过 `Logger` 接口。
2. **禁止**在 `msg` 中拼接业务数据（如 id、key）；一律使用 `fields`。
3. **error 级别**调用必须带 `cause`；实现层可对「无 cause 的 error」打 warn 或补全堆栈信息。
4. **HTTP 访问日志**字段（method、path、status、latencyMs、bytesIn/bytesOut、traceId）为 v1 必须，实现不得省略。
5. **脱敏**在实现层统一做，脱敏键（Authorization、Cookie、token、password）按本节与第七节执行。
6. **LogContext** 由框架在请求入口注入，Logger 实现从 Context 自动取 traceId/spanId 等，不在业务 API 中增加「传 traceId」参数。
7. **Logger 实现层必须输出**：**ts**（UTC，ISO-8601）、**level**、**msg**；可增不可删，保证下游聚合与检索。
8. **Native FileSink（v1 冻结）**：FileSink 仅支持**追加写**（append-only），禁止随机写/覆盖；日志行必须以 **\n 结尾**（单行 JSON），否则多线程写会互相污染。

---

## 十一 A、Multi-Sink 配置（Phase 1，v1.1 对齐 Core 配置体系）

| 规则 | 说明 |
|------|------|
| **配置来源** | 仅从 `application.conf` 的 `[logging]` + `[[logging.sinks]]` 读取；**禁止** `logging.conf`（与 Core v1.1 配置冻结一致）。 |
| **ConfigLoader 职责** | Neton 在 startSync 时加载 application.conf，将 `config["logging"]` 传给 defaultLoggerFactory；Logger 实现**不读文件**。 |
| **sinks 为空/缺失** | `[logging]` 缺失或 `sinks` 为空 → parseLoggingConfig 返回 null → 使用 defaultLoggingConfig（all/error/access + stdout）。不解释为「禁用文件仅 stdout」。 |
| **stdout 规则** | 有 sinks 配置时**默认关闭**（避免双写 IO）；无配置时默认开启；需 stdout 时显式加 `name=stdout` sink。 |
| **写入模式** | Phase 1 为**同步写入**；高吞吐场景建议 Phase 2 启用 Async dispatcher。 |
| **error/warn 强保证** | Phase 1 同步写保证不丢；Phase 2 async 时 warn/error 仍不得丢（队列满时同步 fallback 或阻塞）。 |

---

## 十一 B、Async Dispatcher（Phase 2，v1.2 设计冻结）

**目标**：在 Phase 1 同步写（Logger → Router → Sink）的基础上，引入异步写入队列降低请求路径的文件 IO 阻塞；同时保持 WARN/ERROR 强保证不丢。

**范围**：仅改变实现层的写入策略（Router→Sink 的匹配规则与字段规范不变），不改变 Logger API、LogContext、HTTP access log 字段与脱敏规则。

**平台**：Native-only（POSIX FileSink）。

### 11B.1 配置项（application.conf）

Phase 2 由配置显式开启；未开启时保持 Phase 1 同步写行为。

```toml
[logging.async]
enabled = true
queueSize = 8192                # 有界队列大小（必须有界）
flushEveryMs = 200              # 定时 flush 周期
flushBatchSize = 64             # 批量写阈值
shutdownFlushTimeoutMs = 2000   # 关闭时最大 flush 等待
```

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| enabled | bool | false | 是否启用 async dispatcher；false 时退回 Phase 1 同步写。 |
| queueSize | int | 8192 | 有界队列容量；必须有界，禁止无限队列。 |
| flushEveryMs | int | 200 | writer 定时 flush 周期（毫秒）。 |
| flushBatchSize | int | 64 | writer 批量写入阈值（条数）。 |
| shutdownFlushTimeoutMs | int | 2000 | 停机时 drain+flush 最大等待（毫秒）。 |

注意：配置来源与 Phase 1 一致，仅从 application.conf 的 [logging] 读取（Core v1.1 配置体系），Logger 实现不读文件。

### 11B.2 运行架构（冻结）

Phase 2 引入 dispatcher，但保持「结构化 JSON 单行」与 routing 规则不变。

```
Logger.emit(event)
  → formatter.format(event) -> line (single-line JSON)
  → router.match(event) -> sinks[]
  → dispatcher.enqueue(level, sinks[], line)
       ├─ enabled=false → 直接同步写入 sinks（Phase 1）
       └─ enabled=true  → 入队（MPSC 有界队列）
             → writer loop: dequeue → batch/flush → write sinks
```

- **队列模型**：多生产者（请求协程/线程）→ 单消费者（writer），避免并发写交叉污染。
- **写入目标**：FileSinkNative / StdoutSink；写入仍为 append-only、单行 JSON。

### 11B.3 队列满策略（冻结）

核心原则：DEBUG/INFO 可丢；WARN/ERROR 不得丢。

| level | 队列满行为 | 说明 |
|-------|------------|------|
| DEBUG / INFO / TRACE | 允许丢弃 | 丢弃时累加 droppedCount，不抛异常、不阻塞请求。 |
| WARN / ERROR | 不得丢弃 | 必须保证最终落盘：队列满时同步 fallback 或阻塞入队（见 11B.4）。 |

**11B.3.1 dropped 报警（冻结）**

- 对于 DEBUG/INFO/TRACE 的丢弃，必须计数 droppedCount。
- 每隔固定窗口（建议 10s）输出一条 WARN（不得丢），用于运维可见：
  - msg = "log.dropped"
  - fields 包含：dropped, queueSize, flushBatchSize, flushEveryMs

### 11B.4 WARN/ERROR 强保证策略（冻结）

当队列满且日志为 WARN/ERROR 时，必须满足「最终可落盘」。

v1.2 默认策略冻结为 A（可选支持 B，但默认必须 A）：

| 策略 | 名称 | 行为 |
|------|------|------|
| A（默认） | 同步 fallback 写 | 队列满时直接同步写入 sinks（FileSink/Stdout），确保 WARN/ERROR 不丢。 |
| B（可选） | 阻塞入队 | 队列满时阻塞直到队列有空间（可能增加请求延迟）。v1.2 可不实现。 |

- Phase 2 必须至少实现策略 A。
- fallback 写入必须遵循 v1 的脱敏与结构化规则；不得绕过 Logger API 直接拼字符串写文件。

### 11B.5 flush 策略（冻结）

writer 线程/循环使用批量写与定时 flush 的组合：

- 满足任一条件触发 flush：
  1. buffer 条数 ≥ flushBatchSize
  2. 距离上次 flush ≥ flushEveryMs

flush 定义：
- 对 FileSink：按行追加写入（可一次性写入多行或循环 write，但必须在同一 flush 周期完成）。
- v1.2 不强制 fsync（性能 tradeoff）；耐久性增强留 v2。

### 11B.6 shutdown flush 行为（冻结）

在应用 stop / HTTP 停机阶段：

1. dispatcher 进入 closing 状态，停止接收新日志（或只接收 WARN/ERROR fallback）
2. writer drain 队列并 flush
3. 最长等待 shutdownFlushTimeoutMs
4. 若超时仍有剩余：
   - 输出一条 ERROR：msg="log.flush_timeout"
   - fields 包含：remaining, timeoutMs

保证：尽最大努力 flush；不承诺进程被强杀时的 100% 落盘。

### 11B.7 Phase 2 契约测试（建议，v1.2 收口项）

建议在 neton-logging 的 native target tests 中补齐三类 contract：

1. **debug/info 可丢**：队列满时 droppedCount 增长，并出现 log.dropped warn
2. **warn/error 不丢**：队列满时仍能落盘（fallbackWritesCount > 0 或最终行数匹配）
3. **shutdown flush**：stop 后文件包含已入队日志，超时则输出 log.flush_timeout

### 11B.8 计数器字段名（冻结，供 metrics/health 采集）

| 字段名 | 语义 | 说明 |
|--------|------|------|
| droppedCount | DEBUG/INFO/TRACE 因队列满被丢弃的条数 | 累加，可被 log.dropped 的 fields 引用 |
| fallbackWritesCount | WARN/ERROR 因队列满走同步 fallback 的条数 | 累加，用于验证强保证策略 |

实现层内部维护，v1.2 不强制对外暴露 API；若后续增加 health/metrics 端点，可直接采用上述字段名，保证与 spec 一致。

---

**冻结说明**：Phase 2 只改变写入方式，不改变字段规范与路由匹配规则。WARN/ERROR 强保证不丢为 v1.2 的硬约束；debug/info 丢弃策略为 v1.2 的明确取舍。

---

## 十二、为什么 logging 是第一优先级（说人话）

已有能力：分布式锁、cache singleflight、redis、http、ksp。若出现：

- 锁没释放？
- cache 穿透？
- redis 慢？
- KSP 生成错？

**没有 logging**：只能猜，易返工、推翻架构。

**有 logging**：3 分钟定位、10 分钟修、不推翻架构。neton-logging 是地基，先冻结 v1 API，后续所有模块围着它长，即可避免返工。
