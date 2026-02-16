# Neton Jobs 定时任务规范 v1（设计冻结）

> **定位**：基于 coroutine 的定时任务调度框架。提供 `@Job` 注解声明任务，KSP 编译期发现并生成 `GeneratedJobRegistry`，运行时由 `CoroutineJobScheduler` 驱动执行。支持 cron 与固定间隔两种调度模式，通过 `ExecutionMode`（`SINGLE_NODE` / `ALL_NODES`）控制执行语义，`SINGLE_NODE` 模式通过 `LockManager` 实现多实例互斥。
>
> **状态**：**v1 设计冻结**。实现只允许按本规范填空；「十、实现冻结约束」为工程约束，必须遵守。
>
> **v1 范围**：`JobExecutor` 接口 + `@Job` 注解 + `ExecutionMode` 枚举；KSP 生成 `GeneratedJobRegistry`；coroutine 调度（cron + fixedRate）；`SINGLE_NODE` 模式复用 `LockManager` 互斥；`jobs.conf` 配置覆盖；`JobExecutionListener` 回调接口；**不做** DB Job Store、动态创建任务、任务依赖编排、自动续租。

---

## 一、目标与原则

| 原则 | 说明 |
|------|------|
| **编译期确定** | 任务定义来自代码（`@Job`），不来自数据库。与 neton `@Controller`、`@NetonConfig` 一致：KSP 编译期发现，运行时直接使用。 |
| **配置可覆盖** | `jobs.conf` 覆盖注解默认值（cron、enabled 等），无需改代码重新编译。运维友好。 |
| **coroutine 原生** | 调度和执行均基于 Kotlin coroutine，不引入线程池、不引入 Java Timer/ScheduledExecutor。 |
| **SINGLE_NODE 复用锁** | `SINGLE_NODE` 模式下多实例互斥直接复用 [Neton-Redis-Lock-Spec-v1](./redis-lock.md) 的 `LockManager`，不另起炉灶。`ALL_NODES` 模式不使用锁。 |
| **框架与业务分层** | 框架（neton-jobs）提供调度引擎 + `JobExecutionListener` 接口；执行日志写数据库是业务层（neton-backend）的事。 |
| **v1 最小集** | 不做 DB Job Store、不做动态任务、不做任务依赖、不做 Web UI 控制（启停走配置文件或后台 API）。 |

---

## 二、核心抽象（冻结）

### 2.1 JobExecutor 接口

```kotlin
package neton.jobs

interface JobExecutor {
    /** 任务执行逻辑。框架保证每次调度调用一次，异常由框架捕获并通知 listener。 */
    suspend fun run(ctx: JobContext)
}
```

- **一个 JobExecutor 实现类 = 一个定时任务**。
- 实现类通过构造函数注入依赖（与 Controller 一致）。
- `run()` 中可访问数据库、Redis、Storage 等任意已注册服务。

### 2.2 JobContext

```kotlin
package neton.jobs

class JobContext(
    /** 当前任务 ID（来自 @Job.id） */
    val jobId: String,
    /** 应用上下文，可通过 ctx.get<T>() 访问所有已注册服务 */
    val ctx: NetonContext,
    /** 本次触发时间（UTC epoch millis） */
    val fireTime: Long,
    /** 预绑定的 Logger（tag = "neton.jobs.{jobId}"） */
    val logger: Logger
)
```

- `fireTime`：调度器决定触发的时间点，非实际开始执行的时间（如果等待锁，实际执行会晚于 fireTime）。
- `ctx`：与 `NetonContext.current()` 同一实例，提供完整的 DI 能力。
- `logger`：使用 `LoggerFactory.get("neton.jobs.$jobId")` 创建，每个任务独立 logger，便于日志过滤。

### 2.3 @Job 注解

```kotlin
package neton.jobs

/** 任务执行模式 */
enum class ExecutionMode {
    /** 每个实例都执行（不使用分布式锁） */
    ALL_NODES,
    /** 多实例只允许一个执行（使用 LockManager 协调） */
    SINGLE_NODE
}

@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.SOURCE)
annotation class Job(
    /** 任务唯一标识，全局不可重复。建议 kebab-case，如 "clean-expired-tokens" */
    val id: String,
    /** cron 表达式（5 段：分 时 日 月 周）。与 fixedRate 二选一，不可同时设置。 */
    val cron: String = "",
    /** 固定间隔（毫秒）。与 cron 二选一，不可同时设置。 */
    val fixedRate: Long = 0,
    /** 首次执行延迟（毫秒）。默认 0 表示立即执行。仅对 fixedRate 有效，cron 忽略此值。 */
    val initialDelay: Long = 0,
    /** 执行模式。默认 SINGLE_NODE，集群只允许一个节点执行。 */
    val mode: ExecutionMode = ExecutionMode.SINGLE_NODE,
    /** 分布式锁 TTL（毫秒）。仅 SINGLE_NODE 模式有效。应大于任务最大执行时间。 */
    val lockTtlMs: Long = 30_000,
    /** 是否启用。可被 jobs.conf 覆盖。 */
    val enabled: Boolean = true
)
```

**v1 冻结行为**：

| 行为 | 说明 |
|------|------|
| **id 唯一性** | KSP 编译期检查：同一编译单元内 id 重复 → 编译错误。 |
| **cron 与 fixedRate 互斥** | 两者都为空/零 → 编译错误；两者都非空/非零 → 编译错误。 |
| **initialDelay** | 仅 fixedRate 模式使用。cron 模式忽略此值（cron 的首次执行时间由表达式决定）。 |
| **mode 默认 SINGLE_NODE** | 安全优先。多实例部署时默认只有一个节点执行，避免任务重复。如果存在 `SINGLE_NODE` 任务但 `LockManager` 未绑定（未安装 neton-redis），`JobsComponent.init()` 直接 **fail-fast** 报错。每个节点都需执行的任务（如清理本地临时文件）显式设为 `ALL_NODES`。 |
| **lockTtlMs 与 mode** | `lockTtlMs` 仅 `SINGLE_NODE` 模式有效。`ALL_NODES` 模式忽略此值（KSP 可给 warn）。 |
| **enabled 覆盖** | 注解为默认值；`jobs.conf` 中 `enabled = false` 可覆盖。优先级：配置文件 > 注解。 |
| **lockTtlMs** | 必须大于 0（KSP 校验）。长任务应设足够大的 TTL，v1 不做自动续租。 |

### 2.4 JobDefinition

```kotlin
package neton.jobs

data class JobDefinition(
    val id: String,
    val schedule: JobSchedule,
    val mode: ExecutionMode,
    val lockTtlMs: Long,
    val enabled: Boolean,
    /** 工厂函数：从 NetonContext 创建 JobExecutor 实例（KSP 生成，自动解析构造函数依赖） */
    val factory: (NetonContext) -> JobExecutor
)
```

### 2.5 JobSchedule

```kotlin
package neton.jobs

sealed class JobSchedule {
    data class Cron(val expression: String) : JobSchedule()
    data class FixedRate(val intervalMs: Long, val initialDelayMs: Long = 0) : JobSchedule()
}
```

### 2.6 JobRegistry 接口

```kotlin
package neton.jobs

interface JobRegistry {
    val jobs: List<JobDefinition>
}
```

- KSP 生成 `GeneratedJobRegistry : JobRegistry`。
- 框架在 `JobsComponent.init()` 中读取 registry，合并配置覆盖。

---

## 三、KSP 代码生成（冻结）

### 3.1 JobProcessor

新增 `neton.ksp.JobProcessor`，与 `NetonConfigProcessor` 同级。

**扫描规则**：
1. 扫描所有标注 `@Job` 的类。
2. 验证该类实现了 `neton.jobs.JobExecutor` 接口，否则编译错误。
3. 验证 `id` 不为空，且在编译单元内不重复。
4. 验证 `cron` 和 `fixedRate` 互斥（不可同时非空/非零，不可同时为空/零）。
5. 验证 `lockTtlMs > 0`。

**构造函数依赖解析**：与 `ControllerProcessor.buildControllerInstantiation()` 完全一致：
- `NetonContext` → `ctx`
- `Logger` → `ctx.get(LoggerFactory::class).get("完全限定类名")`
- 其他类型 → `ctx.get(Type::class)`

### 3.2 生成 GeneratedJobRegistry

**输出文件**：`neton.jobs.generated.GeneratedJobRegistry`

```kotlin
// AUTO-GENERATED - DO NOT EDIT
package neton.jobs.generated

import neton.jobs.*
import neton.core.component.NetonContext

object GeneratedJobRegistry : JobRegistry {
    override val jobs: List<JobDefinition> = listOf(
        JobDefinition(
            id = "clean-expired-tokens",
            schedule = JobSchedule.Cron("0 3 * * *"),
            mode = ExecutionMode.SINGLE_NODE,
            lockTtlMs = 60_000,
            enabled = true,
            factory = { ctx: NetonContext ->
                com.example.jobs.CleanExpiredTokensJob(
                    ctx.get(com.example.service.TokenService::class)
                )
            }
        ),
        JobDefinition(
            id = "sync-member-level",
            schedule = JobSchedule.FixedRate(intervalMs = 300_000, initialDelayMs = 10_000),
            mode = ExecutionMode.SINGLE_NODE,
            lockTtlMs = 30_000,
            enabled = true,
            factory = { ctx: NetonContext ->
                com.example.jobs.SyncMemberLevelJob(
                    ctx.get(com.example.service.MemberService::class),
                    ctx.get(neton.logging.LoggerFactory::class).get("com.example.jobs.SyncMemberLevelJob")
                )
            }
        )
    )
}
```

### 3.3 平台 actual 绑定

与 `GeneratedNetonConfigRegistry` 模式一致，通过 `expect/actual` 函数提供 registry：

```kotlin
// commonMain
expect fun defaultJobRegistry(): JobRegistry?

// 各平台 actual（KSP 输出到对应 sourceSet）
actual fun defaultJobRegistry(): JobRegistry? = GeneratedJobRegistry
```

---

## 四、配置系统（冻结）

### 4.1 jobs.conf

```toml
[jobs]
enabled = true                        # 全局开关，false = 所有任务不调度

[[jobs.items]]
id = "clean-expired-tokens"
enabled = true
cron = "0 4 * * *"                    # 覆盖注解中的 cron，改为 4 点执行

[[jobs.items]]
id = "sync-member-level"
enabled = false                       # 临时关闭这个任务
fixedRate = 600000                    # 覆盖为 10 分钟间隔
```

> **格式说明**：使用 `[[jobs.items]]` 数组格式，与 neton 框架的 `[[sources]]` 配置风格统一。每个 item 通过 `id` 字段匹配注解中的任务。

### 4.2 配置覆盖规则

**优先级**（从高到低）：
1. `jobs.conf` 中 `[[jobs.items]]` 匹配 `id` 的字段
2. `@Job` 注解中的值

**可覆盖字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | Boolean | 启用/禁用 |
| `cron` | String | 覆盖 cron 表达式 |
| `fixedRate` | Long | 覆盖固定间隔（毫秒） |
| `initialDelay` | Long | 覆盖首次延迟（毫秒） |
| `lockTtlMs` | Long | 覆盖锁 TTL（毫秒） |
| `mode` | String | 覆盖执行模式（`"ALL_NODES"` 或 `"SINGLE_NODE"`） |

**不可覆盖**：`id`（标识符，不可更改）。

**全局开关**：`[jobs].enabled = false` 时，所有任务不调度，即使单个任务 enabled = true。

### 4.3 合并逻辑

```kotlin
/** 从 [[jobs.items]] 数组中按 id 查找覆盖配置 */
fun findOverride(items: List<Map<String, Any?>>, jobId: String): Map<String, Any?>? {
    return items.find { it["id"] == jobId }
}

fun mergeConfig(definition: JobDefinition, override: Map<String, Any?>?): JobDefinition {
    if (override == null) return definition
    return definition.copy(
        schedule = resolveSchedule(definition.schedule, override),
        mode = (override["mode"] as? String)?.let { ExecutionMode.valueOf(it) } ?: definition.mode,
        lockTtlMs = (override["lockTtlMs"] as? Long) ?: definition.lockTtlMs,
        enabled = (override["enabled"] as? Boolean) ?: definition.enabled
    )
}
```

---

## 五、调度引擎（冻结）

### 5.1 JobScheduler 接口

```kotlin
package neton.jobs

interface JobScheduler {
    /** 启动所有已启用任务的调度 coroutine */
    suspend fun start()

    /** 优雅停机：停止调度新任务，等待执行中的任务完成（超时后取消） */
    suspend fun shutdown(timeout: Duration = 30.seconds)

    /** 立即触发一次指定任务（忽略 cron/fixedRate，但仍走分布式锁） */
    suspend fun trigger(jobId: String)

    /** 获取所有任务的运行状态快照 */
    fun snapshot(): List<JobStatus>
}
```

### 5.2 JobStatus

```kotlin
package neton.jobs

data class JobStatus(
    val id: String,
    val enabled: Boolean,
    val schedule: JobSchedule,
    val mode: ExecutionMode,
    val lastFireTime: Long?,          // 上次触发时间（epoch millis），null = 从未执行
    val lastDuration: Long?,          // 上次执行耗时（毫秒）
    val lastResult: JobResult?,       // 上次执行结果
    val nextFireTime: Long?,          // 下次预计触发时间（epoch millis）。精度：fixedRate=毫秒，cron=分钟（秒数固定为 0）
    val runCount: Long,               // 总执行次数
    val failCount: Long               // 失败次数
)

enum class JobResult {
    SUCCESS, FAILED, SKIPPED          // SKIPPED = 未获取到锁，被其他实例执行
}
```

### 5.3 CoroutineJobScheduler 实现

```kotlin
internal class CoroutineJobScheduler(
    private val definitions: List<JobDefinition>,
    private val config: JobsConfig,
    private val ctx: NetonContext
) : JobScheduler {
    
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val statuses = ConcurrentHashMap<String, MutableJobStatus>()
    private val lockManager: LockManager? = ctx.getOrNull(LockManager::class)
    private val listener: JobExecutionListener? = ctx.getOrNull(JobExecutionListener::class)
    private val loggerFactory: LoggerFactory = ctx.get(LoggerFactory::class)
    
    // ...
}
```

**调度流程（每个任务一个 coroutine）**：

```
scope.launch {
    if (schedule is FixedRate) delay(initialDelay)
    
    while (isActive) {
        val nextDelay = calculateNextDelay(schedule)
        delay(nextDelay)
        
        executeJob(definition)
    }
}
```

### 5.4 单次执行流程（executeJob）

```
1. 检查全局开关 → 关闭则 return
2. 检查任务 enabled → 禁用则 return
3. 创建 JobContext（jobId, ctx, fireTime = currentTimeMillis(), logger）
4. 如果 mode = SINGLE_NODE：
   a. lockManager.tryLock("job:{id}", lockTtlMs.milliseconds)
   b. lock == null → 记录 SKIPPED，logger.info("job.skipped", ...)，通知 listener.onSkipped()，return
   c. lock != null → try { 执行 } finally { lock.release() }
5. 如果 mode = ALL_NODES：
   直接执行（不调用 LockManager）
6. 执行：
   a. logger.info("job.started", ...)
   b. 通知 listener.onStart(jobId, fireTime)
   c. val startTime = currentTimeMillis()
   d. try {
        job.run(jobContext)
        val duration = currentTimeMillis() - startTime
        更新 status（lastResult = SUCCESS, runCount++）
        logger.info("job.done", ...)
        通知 listener.onSuccess(jobId, duration)
      } catch (e: Throwable) {
        val duration = currentTimeMillis() - startTime
        更新 status（lastResult = FAILED, runCount++, failCount++）
        logger.error("job.failed", ...)
        通知 listener.onFailure(jobId, duration, e)
      }
```

**框架内置日志（event msg 风格）**：

| event | 时机 | 结构化字段 |
|-------|------|-----------|
| `job.started` | 开始执行 | `jobId`, `fireTime` |
| `job.done` | 执行成功 | `jobId`, `fireTime`, `duration` |
| `job.failed` | 执行异常 | `jobId`, `fireTime`, `duration`, `error` |
| `job.skipped` | 未获取锁 | `jobId`, `fireTime` |

```kotlin
// 示例日志输出
logger.info("job.started", "jobId" to jobId, "fireTime" to fireTime)
logger.info("job.done", "jobId" to jobId, "duration" to duration)
logger.error("job.failed", "jobId" to jobId, "duration" to duration, "error" to e.message)
logger.info("job.skipped", "jobId" to jobId, "fireTime" to fireTime)
```

**关键约束**：

| 约束 | 说明 |
|------|------|
| **不并发** | 同一任务的 coroutine 是串行的（上一次执行完才计算下一次延迟）。不会出现同一任务的两次执行重叠。 |
| **异常不中断** | 单次执行失败不影响后续调度。`SupervisorJob` 保证子 coroutine 异常不传播。 |
| **SINGLE_NODE 锁释放** | 必须在 `finally` 中调用 `lock.release()`。与 [Redis-Lock-Spec](./redis-lock.md) 约束一致。 |
| **锁 key 前缀** | `LockManager` 传入 `"job:{id}"` 作为业务 key。最终 Redis key = `{keyPrefix}:lock:job:{id}`（如 `neton:lock:job:clean-expired-tokens`）。 |
| **ALL_NODES 不调锁** | `mode = ALL_NODES` 时绝不调用 `LockManager`，每个节点独立执行。 |

### 5.5 Graceful Shutdown

```kotlin
override suspend fun shutdown(timeout: Duration) {
    // 1. 取消调度（停止 delay 循环）
    scope.coroutineContext[Job]?.cancel()
    
    // 2. 等待执行中的任务完成
    withTimeoutOrNull(timeout) {
        scope.coroutineContext[Job]?.join()
    }
    
    // 3. 超时后强制取消
    scope.cancel()
    
    logger.info("JobScheduler shutdown complete")
}
```

### 5.6 手动触发（trigger）

```kotlin
override suspend fun trigger(jobId: String) {
    val definition = definitions.find { it.id == jobId }
        ?: throw IllegalArgumentException("Job not found: $jobId")
    
    // 在独立 coroutine 中执行，不影响调度循环
    scope.launch {
        executeJob(definition)
    }
}
```

**trigger() 语义冻结**：

| 检查项 | 是否生效 | 说明 |
|--------|---------|------|
| 全局 `[jobs].enabled` | **不生效** | 手动触发跳过全局开关检查，允许在全局禁用时单独触发调试 |
| 单任务 `enabled` | **不生效** | 同上，手动触发意味着明确意图 |
| 分布式锁 | **生效** | 如果 `mode = SINGLE_NODE`，仍走 `tryLock`，确保多实例安全 |
| "已在运行" | **生效** | 如果该任务当前正在执行（调度触发的），trigger 排队等待或跳过（v1 跳过） |

- 不影响 cron/fixedRate 的正常调度周期。

---

## 六、Cron 解析器（冻结）

### 6.1 v1 范围

v1 实现**极简 5 段 cron**，满足绝大多数定时任务需求：

```
┌───────────── 分 (0-59)
│ ┌───────────── 时 (0-23)
│ │ ┌───────────── 日 (1-31)
│ │ │ ┌───────────── 月 (1-12)
│ │ │ │ ┌───────────── 周 (0-6, 0=周日)
│ │ │ │ │
* * * * *
```

### 6.2 支持的语法

| 语法 | 示例 | 说明 |
|------|------|------|
| `*` | `* * * * *` | 每分钟 |
| 固定值 | `0 3 * * *` | 每天 3:00 |
| 列表 | `0 3,15 * * *` | 每天 3:00 和 15:00 |
| 范围 | `0 9-17 * * *` | 每天 9:00-17:00 整点 |
| 步长 | `*/5 * * * *` | 每 5 分钟 |
| 范围+步长 | `0 9-17/2 * * *` | 9:00-17:00 每 2 小时 |

### 6.3 v1 不支持

| 不支持 | 说明 |
|--------|------|
| 秒级精度 | 不支持 6 段 cron（加秒）。最小粒度为分钟。 |
| `L`（最后一天） | 不支持月末。需要时用 `28-31` 近似。 |
| `W`（工作日） | 不支持。 |
| `#`（第几个周几） | 不支持。 |
| `?`（不指定） | 不支持。日和周都必须写。 |
| 年份段 | 不支持。 |

### 6.3.1 日/周冲突语义（冻结）

当日（第 3 段）和周（第 5 段）同时指定非 `*` 值时，采用 **AND** 语义：必须同时满足日和周的条件才触发。

```
# 示例：每月 15 号 且 是周一 的 3:00 才触发
0 3 15 * 1
```

> **决策依据**：AND 语义更直觉、更安全（缩小范围）。与 POSIX cron 的 OR 语义不同，但 5 段极简 cron 不支持 `?`，AND 是更合理的默认行为。

### 6.4 CronParser 接口

```kotlin
package neton.jobs.internal

internal object CronParser {
    /**
     * 给定当前时间，计算下一次触发的时间。
     * @param expression 5 段 cron 表达式
     * @param after 从此时间之后开始查找（epoch millis，UTC）
     * @return 下一次触发时间（epoch millis，UTC），找不到则返回 -1
     */
    fun nextFireTime(expression: String, after: Long): Long
    
    /**
     * 校验 cron 表达式是否合法。
     * @throws IllegalArgumentException 不合法时抛出
     */
    fun validate(expression: String)
}
```

**实现约束**：

- 所有时间计算基于 **UTC**。
- `nextFireTime` 从 `after + 1 分钟` 开始逐分钟检查，最多遍历 **370 天**（防止无效表达式死循环，370 天足以覆盖所有合法 5 段 cron 周期）。
- 代码量约 150-200 行，纯 Kotlin，无外部依赖。

---

## 七、JobExecutionListener（冻结）

### 7.1 接口定义

```kotlin
package neton.jobs

interface JobExecutionListener {
    /** 任务开始执行 */
    suspend fun onStart(jobId: String, fireTime: Long) {}
    
    /** 任务执行成功 */
    suspend fun onSuccess(jobId: String, fireTime: Long, duration: Long) {}
    
    /** 任务执行失败 */
    suspend fun onFailure(jobId: String, fireTime: Long, duration: Long, error: Throwable) {}
    
    /** 任务被跳过（未获取到分布式锁） */
    suspend fun onSkipped(jobId: String, fireTime: Long) {}
}
```

### 7.2 框架与业务的分层

- **框架（neton-jobs）**：调度引擎在执行的各阶段调用 listener 的对应方法。listener 为可选，未绑定则不调用。
- **业务（neton-backend）**：实现 `JobExecutionListener`，将执行日志写入数据库。

```kotlin
// 业务层实现示例（neton-backend/module/infra/service/JobLogService.kt）
class JobLogService(
    private val jobLogStore: JobLogStore
) : JobExecutionListener {
    
    override suspend fun onSuccess(jobId: String, fireTime: Long, duration: Long) {
        jobLogStore.insert(JobLog(
            jobId = jobId,
            status = 0,  // 成功
            startTime = fireTime,
            duration = duration,
            message = null
        ))
    }
    
    override suspend fun onFailure(jobId: String, fireTime: Long, duration: Long, error: Throwable) {
        jobLogStore.insert(JobLog(
            jobId = jobId,
            status = 1,  // 失败
            startTime = fireTime,
            duration = duration,
            message = error.stackTraceToString()
        ))
    }
}
```

### 7.3 绑定方式

业务层在 `JobsComponent.init()` 之前（或在 DSL 中）将 listener 绑定到 `NetonContext`：

```kotlin
// 方式 1：组件 init 中绑定
ctx.bind(JobExecutionListener::class, JobLogService(jobLogStore))

// 方式 2：DSL 配置
Neton.run(args) {
    jobs {
        listener = JobLogService(...)
    }
}
```

---

## 八、JobsComponent 组件（冻结）

### 8.1 组件定义

```kotlin
package neton.jobs

object JobsComponent : NetonComponent<JobsConfig> {

    override fun defaultConfig(): JobsConfig = JobsConfig()

    override suspend fun init(ctx: NetonContext, config: JobsConfig) {
        // 1. 加载 registry（KSP 生成）
        val registry = config.registry ?: defaultJobRegistry()
            ?: error("No JobRegistry found. Ensure @Job classes exist and KSP is configured.")
        
        // 2. 加载 jobs.conf 配置覆盖（从 NetonContext 读取 configPath 和 environment）
        val configPath = ctx.configPath   // 统一配置路径，不硬编码
        val env = ctx.environment         // 统一环境标识，不从 args 重新解析
        val jobsConf = ConfigLoader.loadModuleConfig("jobs", configPath, env)
        
        // 3. 全局开关
        val globalEnabled = jobsConf?.get("jobs")
            ?.let { (it as? Map<*, *>)?.get("enabled") as? Boolean }
            ?: config.enabled
        
        // 4. 合并配置：注解默认值 + jobs.conf [[jobs.items]] 覆盖
        val items = jobsConf?.get("jobs")
            ?.let { (it as? Map<*, *>)?.get("items") as? List<Map<String, Any?>> }
            ?: emptyList()
        val definitions = registry.jobs.map { def ->
            mergeConfig(def, findOverride(items, def.id))
        }
        
        // 5. 创建调度器
        val scheduler = CoroutineJobScheduler(
            definitions = definitions,
            config = config.copy(enabled = globalEnabled),
            ctx = ctx
        )
        ctx.bind(JobScheduler::class, scheduler)
    }

    override suspend fun start(ctx: NetonContext) {
        ctx.get<JobScheduler>().start()
    }

    override suspend fun stop(ctx: NetonContext) {
        ctx.get<JobScheduler>().shutdown()
    }
}
```

### 8.2 JobsConfig

```kotlin
package neton.jobs

data class JobsConfig(
    /** 全局开关，false = 所有任务不调度。可被 jobs.conf 覆盖。 */
    var enabled: Boolean = true,
    /** Graceful shutdown 超时时间 */
    var shutdownTimeout: Duration = 30.seconds,
    /** 外部注入 registry（测试用）；null 时使用 KSP 生成的 defaultJobRegistry() */
    var registry: JobRegistry? = null,
    /** 外部注入 listener（可选） */
    var listener: JobExecutionListener? = null
)
```

### 8.3 DSL 语法糖

```kotlin
fun Neton.LaunchBuilder.jobs(block: JobsConfig.() -> Unit = {}) {
    install(JobsComponent, block)
}
```

**使用示例**：

```kotlin
Neton.run(args) {
    http { port = 8080 }
    redis { }
    jobs {
        enabled = true
        shutdownTimeout = 60.seconds
    }
}
```

---

## 九、后台管理端点（业务层设计指导）

以下端点属于 **neton-backend 业务层**（`module/infra/controller/admin/JobController.kt`），不属于 neton-jobs 框架。

### 9.1 任务管理端点

| 端点 | 说明 | 数据来源 |
|------|------|---------|
| `GET /admin/job/list` | 任务列表 | `JobScheduler.snapshot()` — 内存 |
| `GET /admin/job/get?id=xxx` | 任务详情 + 运行状态 | `JobScheduler.snapshot().find { it.id == id }` — 内存 |
| `POST /admin/job/trigger?id=xxx` | 手动触发一次 | `JobScheduler.trigger(id)` |
| `PUT /admin/job/update-status` | 启用/禁用 | 修改 `jobs.conf` 或运行时 toggle |

### 9.2 执行日志端点

| 端点 | 说明 | 数据来源 |
|------|------|---------|
| `GET /admin/job-log/page` | 执行日志分页 | 数据库（JobLog 表） |
| `GET /admin/job-log/get?id=xxx` | 日志详情 | 数据库 |
| `DELETE /admin/job-log/clean` | 清理历史日志 | 数据库 |

### 9.3 说明

- 任务列表和状态从 **内存**（`JobScheduler.snapshot()`）读取，不查数据库。
- 执行日志从 **数据库** 读取，由 `JobExecutionListener` 写入。
- `update-status` 的运行时 toggle：v1 建议在 `CoroutineJobScheduler` 中维护一个 `runtimeOverrides: MutableMap<String, Boolean>`，API 修改此 map。重启后失效（回到 jobs.conf 的值）。如需持久化，写入 jobs.conf 或数据库（v2）。

---

## 十、实现冻结约束（v1.0 附录）

以下为 **v1 实现必须遵守** 的约束。

| # | 约束 | 说明 |
|---|------|------|
| 1 | **编译期确定** | 任务定义来自 `@Job` + KSP，不来自数据库。运行时不可动态创建新任务。 |
| 2 | **id 全局唯一** | KSP 编译期校验 id 不重复；运行时 JobScheduler 初始化时再校验一次（防止多模块合并冲突）。 |
| 3 | **cron 与 fixedRate 互斥** | KSP 编译期校验。两者不可同时设置，不可同时为空。 |
| 4 | **cron 5 段** | v1 只支持 5 段 cron（分 时 日 月 周），不支持秒级。最小精度为分钟。 |
| 4.1 | **cron 扫描上限** | `nextFireTime` 最多遍历 370 天。超过仍未命中则返回 -1。 |
| 4.2 | **nextFireTime 精度** | `fixedRate` 模式：毫秒精度。`cron` 模式：分钟精度（秒固定为 0）。 |
| 4.3 | **cron 日/周 AND** | 日（第 3 段）和周（第 5 段）同时指定非 `*` 值时，采用 AND 语义（必须同时满足）。 |
| 5 | **串行执行** | 同一任务的调度是串行的。上一次执行完成后才计算下一次触发时间。不会重叠。 |
| 6 | **SINGLE_NODE 锁复用** | `mode = SINGLE_NODE` 时复用 `LockManager.tryLock()`，key 为 `"job:{id}"`，不另实现锁机制。`ALL_NODES` 不调用锁。 |
| 7 | **锁为 tryLock 不等待** | `wait = Duration.ZERO`，拿不到立即跳过（SKIPPED），不阻塞。与 HTTP @Lock 的 409 不同，任务不抛异常。 |
| 8 | **异常不中断调度** | 单次执行失败（异常）不影响后续调度。`SupervisorJob` + catch。 |
| 9 | **Graceful shutdown** | `stop()` 先取消调度，再等待执行中的任务完成（带超时），最后强制取消。 |
| 10 | **UTC 时间** | cron 表达式基于 UTC 计算。fireTime 为 UTC epoch millis。 |
| 11 | **不做自动续租** | v1 不做锁自动续租。长任务应设足够大的 `lockTtlMs`。 |
| 12 | **listener 可选** | 未绑定 `JobExecutionListener` 时正常运行，只是不记录日志。 |
| 13 | **构造函数注入** | JobExecutor 实现类的构造函数依赖从 `NetonContext` 解析，与 Controller 一致。 |
| 14 | **trigger 跳过开关** | `trigger(jobId)` 不受全局/单任务 enabled 影响，但仍受 `SINGLE_NODE` 锁和串行检查约束。 |

---

## 十一、模块与依赖

### 11.1 模块结构

```
neton-jobs/
├── build.gradle.kts
└── src/
    └── commonMain/kotlin/neton/jobs/
        ├── JobExecutor.kt                # JobExecutor 接口
        ├── JobContext.kt                 # 执行上下文
        ├── ExecutionMode.kt              # ALL_NODES / SINGLE_NODE 枚举
        ├── Job.kt                        # @Job 注解
        ├── JobDefinition.kt              # 任务定义数据类
        ├── JobSchedule.kt               # 调度模式密封类
        ├── JobRegistry.kt               # Registry 接口
        ├── JobScheduler.kt              # Scheduler 接口
        ├── JobStatus.kt                 # 运行状态数据类
        ├── JobExecutionListener.kt      # 执行回调接口
        ├── JobsConfig.kt                # 配置类
        ├── JobsComponent.kt             # NetonComponent 实现
        └── internal/
            ├── CoroutineJobScheduler.kt  # 调度引擎实现
            └── CronParser.kt            # 极简 cron 解析器
```

### 11.2 依赖关系

```
neton-jobs
├── neton-core          # NetonComponent, NetonContext, ConfigLoader
├── neton-logging       # Logger, LoggerFactory
├── neton-redis         # LockManager（可选依赖，mode=SINGLE_NODE 时需要）
└── kotlinx-coroutines  # coroutine 调度
```

**neton-redis 为可选依赖**：如果所有任务 `mode = ALL_NODES`，则不需要 Redis。`CoroutineJobScheduler` 在初始化时检查：如果存在 `SINGLE_NODE` 任务但 `LockManager` 未绑定，则 **fail-fast** 报错。

### 11.3 KSP 处理器

在 `neton-ksp` 模块中新增 `JobProcessor`，与 `ControllerProcessor`、`NetonConfigProcessor`、`ValidationProcessor` 并列。

```
neton-ksp/src/main/kotlin/neton/ksp/
├── ControllerProcessor.kt       # 已有
├── NetonConfigProcessor.kt      # 已有
├── ValidationProcessor.kt       # 已有
├── RepositoryProcessor.kt       # 已有
└── JobProcessor.kt              # 新增
```

### 11.4 build.gradle.kts

```kotlin
plugins {
    alias(libs.plugins.kotlin.multiplatform)
}

kotlin {
    macosArm64()
    macosX64()
    linuxX64()
    linuxArm64()
    mingwX64()

    sourceSets {
        val commonMain by getting {
            dependencies {
                implementation(project(":neton-core"))
                implementation(project(":neton-logging"))
                compileOnly(project(":neton-redis"))   // 可选：LockManager
                implementation(libs.kotlinx.coroutines.core)
            }
        }
    }
}
```

---

## 十二、使用示例

### 12.1 定义 Job

```kotlin
package com.example.jobs

import neton.jobs.*

@Job(
    id = "clean-expired-tokens",
    cron = "0 3 * * *",
    lockTtlMs = 60_000
)
class CleanExpiredTokensJob(
    private val tokenService: TokenService
) : JobExecutor {
    override suspend fun run(ctx: JobContext) {
        val count = tokenService.deleteExpired()
        ctx.logger.info("Cleaned $count expired tokens")
    }
}
```

### 12.2 固定间隔任务

```kotlin
@Job(
    id = "sync-member-level",
    fixedRate = 300_000,          // 每 5 分钟
    initialDelay = 10_000,        // 启动后 10 秒再首次执行
    lockTtlMs = 30_000
)
class SyncMemberLevelJob(
    private val memberService: MemberService,
    private val logger: Logger
) : JobExecutor {
    override suspend fun run(ctx: JobContext) {
        memberService.syncLevels()
        logger.info("Member levels synced")
    }
}
```

### 12.3 所有节点执行的任务

```kotlin
@Job(
    id = "cleanup-temp-files",
    cron = "0 2 * * *",
    mode = ExecutionMode.ALL_NODES   // 每个节点各自清理本地临时文件
)
class CleanupTempFilesJob(
    private val storage: StorageOperator
) : JobExecutor {
    override suspend fun run(ctx: JobContext) {
        // 清理本地临时文件
    }
}
```

### 12.4 应用入口

```kotlin
fun main(args: Array<String>) {
    Neton.run(args) {
        http { port = 8080 }
        redis { }
        jobs { }
    }
}
```

### 12.5 配置覆盖

```toml
# config/jobs.conf

[jobs]
enabled = true

[[jobs.items]]
id = "clean-expired-tokens"
cron = "0 4 * * *"                # 改为凌晨 4 点

[[jobs.items]]
id = "sync-member-level"
enabled = false                   # 临时关闭

[[jobs.items]]
id = "cleanup-temp-files"
mode = "ALL_NODES"                # 每个节点都执行
```

---

## 十三、与其他模块的关系

| 模块 | 关系 |
|------|------|
| **neton-core** | neton-jobs 是 `NetonComponent`，遵循 init/start/stop 生命周期。 |
| **neton-redis** | 复用 `LockManager` 实现分布式互斥。锁 key = `"job:{id}"`。 |
| **neton-cache** | 无直接关系。任务内部可自由使用 `@Cacheable` 等（通过 Service 调用）。 |
| **neton-ksp** | `JobProcessor` 扫描 `@Job` 生成 `GeneratedJobRegistry`。与 `ControllerProcessor` 同级。 |
| **neton-http** | 无直接关系。后台管理端点（JobController）是业务层通过 `@Controller` 实现的。 |
| **neton-backend** | 业务层实现 `JobExecutionListener`（写执行日志到数据库）和 `JobController`（后台管理端点）。 |

---

## 十四、v2 预留

| 功能 | 说明 |
|------|------|
| **DB Job Store** | 任务定义和状态持久化到数据库。支持后台 Web UI 动态创建/修改任务。 |
| **锁自动续租** | 长任务自动续锁（PEXPIRE + token 校验 Lua），防止执行时间超过 lockTtlMs 被误抢。 |
| **任务分组** | 按模块/业务域分组，支持按组启停。 |
| **任务依赖** | DAG 编排：任务 B 依赖任务 A 完成后才执行。 |
| **秒级 cron** | 支持 6 段 cron（加秒位）。 |
| **任务参数** | 手动触发时传入自定义参数（`trigger(jobId, params)`）。 |
| **重试策略** | 失败后自动重试（指数退避）。 |
| **限流** | 控制同一时间最多执行 N 个任务（全局或按组）。 |
| **Web Console** | 后台管理 UI：任务列表、执行日志、手动触发、实时状态。 |

---

## 十五、代码量估计

| 文件 | 行数 |
|------|------|
| JobExecutor + JobContext + @Job（注解） | ~40 |
| JobDefinition + JobSchedule + JobRegistry | ~30 |
| JobScheduler + JobStatus + JobResult | ~40 |
| JobExecutionListener | ~15 |
| JobsConfig + JobsComponent | ~80 |
| CoroutineJobScheduler | ~200 |
| CronParser | ~180 |
| JobProcessor（KSP） | ~200 |
| **合计** | **~785** |

---

## 十六、实现检查清单

| 类别 | 检查项 |
|------|--------|
| **注解** | [ ] `@Job` 定义正确（id, cron, fixedRate, initialDelay, mode, lockTtlMs, enabled） |
| **KSP** | [ ] `JobProcessor` 扫描 `@Job` 类 |
| | [ ] 验证实现了 `JobExecutor` 接口，否则编译错误 |
| | [ ] 验证 id 非空且不重复 |
| | [ ] 验证 cron 和 fixedRate 互斥 |
| | [ ] 验证 lockTtlMs > 0 |
| | [ ] 生成 `GeneratedJobRegistry` 正确 |
| | [ ] 构造函数依赖解析与 Controller 一致 |
| **配置** | [ ] 加载 `jobs.conf` 正确 |
| | [ ] 全局 `[jobs].enabled` 开关生效 |
| | [ ] `[[jobs.items]]` 按 id 匹配覆盖生效（enabled, cron, fixedRate, lockTtlMs, mode） |
| | [ ] 优先级：配置文件 > 注解默认值 |
| **Cron** | [ ] 5 段解析正确（分 时 日 月 周） |
| | [ ] 支持 `*`、固定值、列表、范围、步长、范围+步长 |
| | [ ] `nextFireTime` 计算正确 |
| | [ ] 非法表达式 → 异常 |
| **调度** | [ ] cron 模式下准时触发（精度 ≤ 1 分钟，即在目标分钟内触发） |
| | [ ] fixedRate 模式下间隔正确 |
| | [ ] initialDelay 生效 |
| | [ ] 串行执行：同一任务不重叠 |
| | [ ] 异常不中断后续调度 |
| **执行模式** | [ ] `SINGLE_NODE` 时使用 `LockManager.tryLock("job:{id}")` |
| | [ ] 未获取锁 → SKIPPED，不抛异常 |
| | [ ] 获取锁后 finally 中 release |
| | [ ] `ALL_NODES` 时不调用 LockManager |
| | [ ] LockManager 未绑定 + 有 `SINGLE_NODE` 任务 → fail-fast |
| | [ ] `ALL_NODES` + lockTtlMs 显式配置 → KSP warn（无效配置） |
| **Listener** | [ ] onStart 在执行前调用 |
| | [ ] onSuccess 在成功后调用，含 duration |
| | [ ] onFailure 在失败后调用，含 duration 和 error |
| | [ ] onSkipped 在未获取锁时调用 |
| | [ ] listener 未绑定时正常运行 |
| **生命周期** | [ ] `JobsComponent.init()` 正确创建 scheduler |
| | [ ] `JobsComponent.start()` 启动所有任务 coroutine |
| | [ ] `JobsComponent.stop()` graceful shutdown |
| | [ ] shutdown 超时后强制取消 |
| **手动触发** | [ ] `trigger(jobId)` 立即执行一次 |
| | [ ] 仍走分布式锁 |
| | [ ] jobId 不存在 → 抛异常 |
| **状态** | [ ] `snapshot()` 返回所有任务状态 |
| | [ ] lastFireTime、lastDuration、lastResult 正确更新 |
| | [ ] runCount、failCount 正确累加 |
| **跨平台** | [ ] macosArm64 编译通过 |
| | [ ] macosX64 编译通过 |
| | [ ] linuxX64 编译通过 |
| | [ ] linuxArm64 编译通过 |
| | [ ] mingwX64 编译通过 |

---

**文档状态**：**v1 设计冻结**。实现须遵守「十、实现冻结约束」，按本规范填空。扩展走 v2，不推翻本版。
