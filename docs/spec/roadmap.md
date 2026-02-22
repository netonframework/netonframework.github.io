# Neton Roadmap v1（冻结版）

> **定位**：除 **LOG（P0 地基）** 之外的 9 个方向 v1 边界、最小接口与最少改动路径，面向可扩展的服务集群。
>
> **状态**：**v1 设计冻结**。本文档定义各方向 v1 坚决不做的范围、最小交付接口草案、以及基于现有模块的最少改动路径。实现只允许在本边界内填空。
>
> **beta1 进度快照（2026-02-17）**：
> - Config：✅ 已实现（TOML ConfigLoader + 环境覆盖 + 模块独立文件）
> - Runtime/DI：✅ 已实现（NetonContext bind/get + KSP 构造注入 + ModuleInitializer 拓扑排序）
> - Jobs：✅ neton-jobs 模块已建立（@Job 注解 + CronParser + CoroutineJobScheduler + KSP JobProcessor）
> - Security：✅ JWT/Mock 认证 + permission implies auth + 契约测试 26 条
> - LOG：✅ 已冻结实现（3 文件分流 + 结构化 JSON）
>
> **正确实施顺序**（再次强调）：
> - **P0**：LOG（已冻结，见 [Neton-Logging-Spec-v1.md](./logging.md)）
> - **P1**：Config → Metrics/Health → DI/Runtime → Trace
> - **P2**：Discovery/LB → Resilience → Jobs → MQ/Event → 部署/运维基建

---

## 一、总览

| # | 方向 | 解决什么 | v1 最小交付 |
|---|------|----------|-------------|
| 1 | Neton Config | 多环境配置、分层覆盖、热更新（可选） | application.conf（TOML）+ env 覆盖 + typed access（无远程 config） |
| 2 | Neton Runtime/DI | Controller/Service/Component 生命周期、构造注入、条件装配 | 现有 ctx.bind/get 升级为构造注入 + 单例/原型（不搞复杂条件） |
| 3 | Neton Metrics/Health | QPS、延迟、错误率、线程/协程池、Redis/DB 指标；健康探针 | /health + /metrics（标准指标文本格式） |
| 4 | Neton Trace | 跨服务 traceId/spanId 传播、关键 span（http/db/redis） | traceId/spanId 传播 + span 事件打到 log（先不接外部 Trace SDK） |
| 5 | Neton Discovery/LB | 服务注册、发现、客户端负载均衡、重试策略 | 静态服务列表 + round-robin（先不引入注册中心） |
| 6 | Neton Resilience | 下游慢/挂时不拖死全站；限并发、舱壁、熔断 | timeout + retry（带退避）+ bulkhead（并发上限） |
| 7 | Neton Jobs | 定时任务、延迟任务、分布式 job 互斥 | ✅ neton-jobs 已实现：@Job + cron/fixedRate + SINGLE_NODE/ALL_NODES + KSP JobProcessor |
| 8 | Neton MQ/Event | 异步解耦、最终一致性、事件驱动 | 消息队列任选一种适配（v1 先做一种） |
| 9 | 部署与运维基建 | 标准化启动参数、镜像、滚动升级、灰度、回滚、配置注入 | --port/--env/--config + readiness/liveness + structured logs（与 LOG 对齐） |

---

## 二、各方向 v1 边界、接口草案与最少改动路径

---

### 1) Neton Config

**要解决**：多环境配置、分层覆盖、热更新（可选）。

**v1 边界（坚决不做）**：
- 不做远程配置中心。
- 不做配置热更新（v1 仅启动时加载；热更新留 v2）。
- 不做多格式混用（v1 唯一 TOML，文件名 .conf，不混用）。

**最小接口草案**：

```kotlin
// 配置源：application + 环境覆盖
interface NetonConfigSource {
    fun get(path: String): Any?
    fun getOrNull(path: String): Any?
    fun has(path: String): Boolean
}

// 类型化访问（可选 v1 最小：仅 String/Int/Boolean 与嵌套 Map）
fun NetonConfigSource.getString(path: String, default: String? = null): String?
fun NetonConfigSource.getInt(path: String, default: Int? = null): Int?
fun NetonConfigSource.getBoolean(path: String, default: Boolean? = null): Boolean?
```

**加载规则**：
- 主配置：`config/application.conf`（或 `--config-path` 指定目录下的 `application.conf`，TOML 格式）。
- 环境覆盖：`--env=dev` → 加载 `application.dev.conf`，与主配置深度合并（后者覆盖前者）。
- 合并后单例注入 `NetonContext`，各 Component 通过 `ctx.get&lt;NetonConfigSource&gt;()` 读取。

**需要现有模块的最少改动**：
- **neton-core**：在 `LaunchBuilder.startSync` 中，在创建 `NetonContext` 后、各 component onInit 前：用现有 `ConfigLoader.loadApplicationConfig(configPath, env)` 加载；从 `configPath + "/application.conf"` 与 `application.<env>.conf` 读 TOML 并解析。把合并后的 `Map` 包装为 `NetonConfigSource` 实现并 `ctx.bind(NetonConfigSource::class, impl)`。详见 [config-spi](./config-spi.md)。
- **neton-core**：端口等从 `ConfigLoader.getConfigValue(config, "server.port")` 或 `NetonConfigSource.getInt("server.port")` 读取，与 `--port` 参数叠加（命令行优先）。
- **neton-logging-impl**：`LoggingConfig` 从 `NetonConfigSource` 读 `logging.level`、`logging.sampling` 等，不再依赖未定义的入口；若 ctx 中无 `NetonConfigSource` 则用默认值。

---

### 2) Neton Runtime/DI

**要解决**：Controller/Service/Component 的生命周期、构造注入、条件装配。

**v1 边界（坚决不做）**：
- 不做复杂条件装配（无 `@ConditionalOnClass` 等）。
- 不做 AOP/代理（v1 仅构造注入 + 单例/原型）。
- 不做 XML/脚本式配置，仅代码 + 注解。

**最小接口草案**：

```kotlin
// 在现有 NetonContext 上扩展
// 单例：同一 KClass 只一个实例，由容器创建并缓存
fun <T : Any> NetonContext.registerSingleton(type: KClass<T>, factory: (NetonContext) -> T)
fun <T : Any> NetonContext.getOrCreateSingleton(type: KClass<T>): T

// 原型：每次 get 都调用 factory
fun <T : Any> NetonContext.registerPrototype(type: KClass<T>, factory: (NetonContext) -> T)

// 构造注入：根据 KClass 的构造函数解析依赖，递归 get 后构造实例（v1 仅支持单构造、参数类型均在 ctx 中已注册）
fun <T : Any> NetonContext.resolve(type: KClass<T>): T
```

**生命周期**：
- 启动阶段：先 bind 基础设施（LoggerFactory、NetonConfigSource、HttpAdapter、RequestEngine 等），再对标记了 `@Controller` / `@Service` 的类做 `resolve` 或 `registerSingleton`，最后把 Controller 实例交给 neton-routing 注册。
- v1 不引入「Bean 定义」DSL，仅：已 `bind` 的 + 可 `resolve` 的（构造参数皆在 ctx）。

**需要现有模块的最少改动**：
- **neton-core NetonContext**：增加 `registerSingleton` / `registerPrototype` / `resolve`；`resolve` 内部对给定 KClass 取首个构造函数，对每个参数类型 `get(parameterType)` 后 `constructor.call(...)`，若为单例则缓存到 registry。
- **neton-routing**：Controller 不再由用户手动 `components(RoutingComponent(...))` 里传实例，改为从 ctx 按 `@Controller` 类列表 `ctx.resolve(ControllerClass)` 获取；或保持「用户可传实例」同时支持「从 ctx 按类型取」两种方式，v1 二选一即可。
- **neton-ksp**：若有 Controller 扫描，可生成「需在启动时 resolve 的类列表」，供 Neton 在 bind 完基础设施后依次 resolve 并 bind 回 ctx。

---

### 3) Neton Metrics/Health

**要解决**：QPS、延迟、错误率、线程/协程池、Redis/DB 指标；健康探针。

**v1 边界（坚决不做）**：
- 不做多维标签的复杂指标（v1 仅单维或固定维度，如 path/method）。
- 不做 Push 模式（仅 Pull：/metrics 被拉取）。
- 不做自定义健康端点命名（仅 `/health`、`/metrics`）。

**最小接口草案**：

```kotlin
// 指标注册（Counter / Timer / Gauge 概念即可）
interface MeterRegistry {
    fun counter(name: String, tags: Map<String, String> = emptyMap()): Counter
    fun timer(name: String, tags: Map<String, String> = emptyMap()): Timer
    fun gauge(name: String, tags: Map<String, String>, valueSupplier: () -> Double): Unit
}
interface Counter { fun increment(amount: Double = 1.0) }
interface Timer { fun record(amount: Long, unit: TimeUnit); fun <T> record(block: () -> T): T }

// 健康检查
interface HealthIndicator {
    fun check(): HealthResult  // HealthResult = Up(details) | Down(cause, details)
}
interface HealthAggregator {
    fun add(name: String, indicator: HealthIndicator)
    fun check(): Map<String, HealthResult>  // 聚合所有 indicator
}
```

**暴露**：
- `GET /health`：返回 200 + JSON `{ "status": "UP", "components": { "redis": "UP", "db": "UP" } }`，任一下则 503。
- `GET /metrics`：返回标准指标文本格式（`# TYPE xxx counter` / `xxx_total{} 123`），无需 `/metrics/{name}`。

**需要现有模块的最少改动**：
- **neton-core 或新 neton-metrics 模块**：提供 `MeterRegistry`、`HealthAggregator` 实现并 bind 到 ctx；在启动时挂载 /health、/metrics 两条路由。
- **neton-http**：在请求入口记录请求计数 + 耗时（调用 `MeterRegistry.timer("http.requests").record { ... }`），并写入 `MeterRegistry`；可选在 neton-core 的 routing 层统一做。
- **neton-redis / neton-database**：各提供一个 `HealthIndicator`，在 `GET /health` 时被聚合调用（ping 或简单查询）。

---

### 4) Neton Trace

**要解决**：跨服务 traceId/spanId 传播、关键 span（http/db/redis）。

**v1 边界（坚决不做）**：
- 不接 OpenTelemetry SDK（v1 仅 Neton 内生成与传播）。
- 不做采样决策逻辑（v1 全量记录 span 事件到 log，采样留给 log 层）。
- 不做 B3/W3C 之外的其他格式。

**最小接口草案**：

```kotlin
// 与 neton-logging LogContext 对齐
data class TraceContext(
    val traceId: String,
    val spanId: String,
    val parentSpanId: String? = null
)

// 传播：从 HTTP 头读取/写入（traceparent 或 X-Trace-Id / X-Span-Id）
fun TraceContext.toHeaders(): Map<String, String>
fun TraceContext.Companion.fromHeaders(headers: Map<String, String>): TraceContext?

// span 事件：仅打日志，不送 OTel
fun withSpan(name: String, block: () -> T): T  // 生成子 spanId，执行前后打 log 事件
```

**约定**：neton-http 在入口从 header 解析或生成 `TraceContext`，写入 `CurrentLogContext` / `CoroutineContext`；neton-logging 的 Logger 实现从 Context 取 traceId/spanId 写入每条 log；db/redis 调用前 `withSpan("db.query")` / `withSpan("redis.get")` 打 span 事件到 log。

**需要现有模块的最少改动**：
- **neton-logging**：已具备 `LogContext(traceId, spanId)`，确保与 `TraceContext` 可复用或同一数据（可 typealias 或 LogContext 持有 TraceContext）。
- **neton-http**：在 handler 最外层从 request headers 取或生成 traceId/spanId，设置到 `CurrentLogContext` 并响应头回写；在 access log 中已带 traceId，保持即可。
- **neton-core / neton-redis / neton-database**：在关键调用外包裹 `withSpan("...")`，内部仅打一条结构化 log（如 `msg="span" name="db.query" durationMs=...`），不依赖 OTel。

---

### 5) Neton Discovery/LB

**要解决**：服务注册、发现、客户端负载均衡、重试策略。

**v1 边界（坚决不做）**：
- 不引入注册中心。
- 不做服务端负载均衡（仅客户端 LB）。
- 不做健康检查驱动实例摘除（v1 静态列表即可）。

**最小接口草案**：

```kotlin
interface ServiceInstance(val id: String, val host: String, val port: Int, val metadata: Map<String, String> = emptyMap())
interface ServiceDiscovery {
    fun getInstances(serviceId: String): List<ServiceInstance>
}
interface LoadBalancer {
    fun choose(serviceId: String): ServiceInstance?
}

// v1 实现：静态列表 + round-robin
class StaticServiceDiscovery(private val instancesByService: Map<String, List<ServiceInstance>>) : ServiceDiscovery
class RoundRobinLoadBalancer(private val discovery: ServiceDiscovery) : LoadBalancer
```

**配置**：v1 从 `NetonConfigSource` 读静态列表，例如 `services.user-service.instances=[{host,port},...]`，注入 `StaticServiceDiscovery`；`RoundRobinLoadBalancer` 持 discovery 引用，`choose` 时轮询。

**需要现有模块的最少改动**：
- **neton-core**：无必须改动；若已有「发 HTTP 到下游服务」的封装，可依赖 `ServiceDiscovery` + `LoadBalancer` 选实例再发请求。
- **新模块 neton-discovery**（或放在 neton-core 内）：实现 `StaticServiceDiscovery`、`RoundRobinLoadBalancer`，并在启动时从 Config 构建并 bind。

---

### 6) Neton Resilience

**要解决**：超时、重试（带退避）、熔断、隔离（舱壁）。

**v1 边界（坚决不做）**：
- 不做熔断器状态机（v1 仅 timeout + retry + bulkhead）。
- 不做指标导出到 Metrics（v1 仅行为正确，指标可选 v2）。
- 不做注解驱动（v1 仅 API：`runWithTimeout` / `runWithRetry` / `runWithBulkhead`）。

**最小接口草案**：

```kotlin
// 超时
suspend fun <T> runWithTimeout(timeoutMs: Long, block: suspend () -> T): T

// 重试（带退避）
suspend fun <T> runWithRetry(
    maxAttempts: Int,
    backoff: BackoffStrategy,  // BackoffStrategy = Fixed(ms) | Exponential(initial, max)
    retryOn: (Throwable) -> Boolean,
    block: suspend () -> T
): T

// 舱壁（并发上限）
class Bulkhead(val maxConcurrency: Int)
suspend fun <T> Bulkhead.runWithBulkhead(block: suspend () -> T): T
```

**需要现有模块的最少改动**：
- **新模块 neton-resilience**：实现上述三个能力（timeout 用 withTimeout，retry 用循环+delay，bulkhead 用 Semaphore）；不依赖 neton-core 除 Kotlin 协程外的能力。
- **neton-http / neton-redis / neton-database**：在调用下游处可选使用 `runWithTimeout`/`runWithRetry`，由配置开关控制（v1 可硬编码默认超时/重试）。

---

### 7) Neton Jobs ✅ beta1 已实现

**要解决**：定时任务、延迟任务、分布式 job 互斥。

**v1 边界（坚决不做）**：
- 不做分布式调度中心。
- 不做任务持久化与恢复（v1 内存调度即可）。

**beta1 已实现（neton-jobs 模块）**：

| 组件 | 说明 |
|------|------|
| `@Job` 注解 | 声明 cron/fixedRate、executionMode、lockTtlMs |
| `JobExecutor` 接口 | 业务实现 `suspend fun execute(ctx: JobContext)` |
| `CronParser` | 5 段 cron 解析（分时日月周），支持 `*`/列表/范围/步长，UTC |
| `CoroutineJobScheduler` | coroutine 调度引擎，fixedRate + cron 双模式 |
| `ExecutionMode` | `ALL_NODES`（每实例都跑）/ `SINGLE_NODE`（分布式锁互斥） |
| `JobsComponent` | NetonComponent 生命周期，读 jobs.conf 配置覆盖 |
| KSP `JobProcessor` | 编译期扫描 @Job，生成 `GeneratedJobRegistry`，校验 id 唯一/cron+fixedRate 互斥 |

**SINGLE_NODE 模式**：复用 neton-redis `LockManager.tryLock()`，拿到锁才执行，否则跳过。

**配置覆盖**（jobs.conf）：
```toml
[jobs]
enabled = true
shutdownTimeout = 30000

[[jobs.items]]
id = "cleanup"
enabled = false
cron = "0 2 * * *"
```

---

### 8) Neton MQ/Event

**要解决**：异步解耦、最终一致性、事件驱动。

**v1 边界（坚决不做）**：
- 不做多 MQ 同时抽象（v1 只做 Kafka 或 Rabbit 其一）。
- 不做事务型 outbox（v1 仅发/收单条消息）。
- 不做 Schema Registry 集成。

**最小接口草案**：

```kotlin
// 生产者
interface MessageProducer {
    suspend fun send(topic: String, key: String?, payload: ByteArray)
    suspend fun send(topic: String, key: String?, payload: String)
}

// 消费者（v1 拉模式或推送回调二选一）
interface MessageConsumer {
    fun subscribe(topic: String, groupId: String, handler: suspend (key: String?, payload: ByteArray) -> Unit)
    fun start()
    fun stop()
}
```

**需要现有模块的最少改动**：
- **新模块 neton-mq**：实现 `MessageProducer`/`MessageConsumer`，配置从 `NetonConfigSource` 读 bootstrap.servers 等；与 neton-core 无强耦合，仅依赖 Config 与 Logger。

---

### 9) 部署与运维基建

**要解决**：标准化启动参数、镜像、滚动升级、灰度、回滚、配置注入。

**v1 边界（坚决不做）**：
- 不做 K8s Operator 或 Helm chart 自动生成（v1 文档约定即可）。
- 不做内置灰度路由（v1 依赖 LB/Config 简单切换）。
- 不做配置热更新（与 Config v1 一致）。

**最小交付**：
- **启动参数**：`--port`、`--env`、`--config-path` 标准化，与 Config 一致；在 Neton.run 入口解析并传入 `NetonContext`。 
- **健康探针**：与 Metrics/Health 一致，提供 `/health`（readiness/liveness 可同端点或 liveness 仅进程存活）；K8s 的 `readinessProbe`/`livenessProbe` 指向 `/health`。
- **结构化日志**：与 [Neton-Logging-Spec-v1.md](./logging.md) 完全对齐，保证 JSON、traceId、字段规范，便于日志采集系统解析。

**需要现有模块的最少改动**：
- **neton-core**：在 `Neton.run(args)` 中解析 `--port`、`--env`、`--config-path`，与 Config 加载、端口绑定一致；确保 `onStart` 后进程可对外提供 `/health`。
- **neton-logging-impl**：已满足 v1 规范；部署文档中明确「禁止 println、统一 Logger、结构化输出」。

---

## 三、依赖关系与实施顺序（小结）

```
P0: LOG（已冻结）
    ↓
P1: Config（Metrics/Health/DI/Trace 都依赖配置与上下文）
    ↓
    Metrics/Health（上线必看）
    DI/Runtime（开发体验，框架核心能力）
    Trace（可先 log-span，与 LOG 协同）
    ↓
P2: Discovery/LB → Resilience → Jobs → MQ/Event → 部署/运维（按需迭代）
```

每个方向的 **v1 边界** 在本文档内冻结；**最小接口** 实现时可略做命名调整，但语义不变；**最少改动路径** 保证在现有 neton-core、neton-http、neton-logging、neton-redis 等基础上最小侵入完成 v1 闭环。

---

*文档版本：v1（冻结）+ beta1 进度快照 2026-02-17*
