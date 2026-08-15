# Neton 领域事件规范 v1（框架契约冻结）

> **定位**：模块间解耦的进程内事件总线。事件由**发生方所在模块**定义，消费方订阅；发生方不需要认识任何消费方。需要脱离主流程的监听者可声明持久化投递，由事务性 outbox 落库后异步重试。
>
> **状态**：
> - **框架契约：冻结**。`DomainEvent` / `DomainEventListener` / `DomainEventBus` / `DomainEventStore` / `DomainEventCodec` 在 neton-core，语义见二至六节；框架不选载体、不依赖数据库、不依赖序列化库。
> - **PostgreSQL 存储契约：冻结**。参考实现在应用层 infra，由真实 PostgreSQL 契约测试守着（9.1）。
> - **`RETRYABLE` 生产就绪：运维面已建立**（第八节）。参考实现具备终态失败出口、积压指标与告警、清理任务、配置接入，且全部在真实 PostgreSQL 上验证。可用于资金链路，前提仍是**监听者幂等**。
>
> **v1 范围**：三种投递模式（`SYNC` / `BEST_EFFORT` / `RETRYABLE`）；框架绑定总线 + 装配期封印；事务性 outbox 端口 + 可见性超时回收；**不做** 跨进程广播、事件溯源、投递顺序保证、恰好一次、事件版本演进。

---

## 一、目标与原则

| 原则 | 说明 |
|------|------|
| **发生方不认识消费方** | 事件定义在发生方模块，消费方订阅。这是它优于「直接回调某个业务端口」的地方：端口只能有一个实现，第二个消费方接入就得挤进第一方的实现里做分流，那个实现于是退化成认识所有下游的中央调度器。 |
| **默认同步同事务** | 发布点通常已在数据库事务中，同步派发让消费方的写入并入同一事务。改为异步就变成最终一致，需要额外自建重试与幂等，且中间存在「发布方已生效、消费方尚未生效」的可观察窗口。 |
| **代价由需要的人付** | 真的需要脱离主流程的监听者声明 `RETRYABLE`，走 outbox；其余监听者不为此付出任何复杂度。 |
| **框架只定义端口，实现禁止进框架** | 用什么载体投递（数据库 / 线程 / 中间件）是应用层的选择。core 不依赖数据库、不依赖序列化库，无持久化设施时框架仍可运行。**这是硬规则**：`DomainEventStore` 的任何实现、outbox 表与迁移、投递器、调度任务、运维接口，一律不得出现在 Neton 框架仓库，见第十二节。 |
| **装配期可变，服务期只读** | 监听者与持久化设施只在启动阶段登记，`seal()` 之后总线只读。运行期请求跑在多线程调度器上，一边遍历一边增删是数据竞争，而它表现出来的样子（偶发漏投递）极难定位。 |
| **配置错误在启动期暴露** | 声明了 `RETRYABLE` 却没装持久化设施，是装配遗漏而不是可降级的情况，`seal()` 直接失败。运行期静默降级会把「至少一次」变成「至多一次」，且把外部调用拖进主事务——恰好是声明该模式的人最想避免的两件事。 |

---

## 二、核心抽象（冻结）

```kotlin
package neton.core.event

interface DomainEvent

enum class DeliveryMode { SYNC, BEST_EFFORT, RETRYABLE }

interface DomainEventListener<E : DomainEvent> {
    val eventType: KClass<E>
    val listenerId: String                        // 必须显式声明
    val mode: DeliveryMode get() = DeliveryMode.SYNC
    suspend fun onEvent(event: E)
}
```

### 2.1 eventType 用 KClass 显式声明

不靠泛型推断：Kotlin/Native 没有完整反射，运行期拿不到被擦除的类型实参。

### 2.2 listenerId 必须显式声明，且此后不可更改

这个字符串会写进数据库，进程重启、版本升级之后还要能把积压的事件路由回来。

**不提供默认实现是刻意的**。曾经的默认值是 `this::class.simpleName ?: toString()`，而 Kotlin/Native 上匿名对象的 `simpleName` 是 `null`，于是落库的是 `Foo@710ae18`——一个内存地址。重启后必然对不上，那些行永远投递不出去，且没有任何信号。

取值建议带模块前缀，避免跨模块撞名：

```kotlin
override val listenerId = "payment.wallet-recharge-paid"
```

### 2.3 事件类型键用全限定名

```kotlin
fun DomainEvent.eventTypeKey(): String = this::class.qualifiedName ?: ...
```

同理，这个字符串跨进程存活。`simpleName` 会让不同包下的两个 `OrderPaid` 撞成同一个键。拿不到 `qualifiedName`（匿名类、局部类）时**抛错**而不是退回 `toString()`——后者在 Native 上含内存地址。要落库的事件必须是具名类。

---

## 三、投递模式（冻结）

| 模式 | 时机 | 失败处理 | 用途 |
|---|---|---|---|
| `SYNC` | 发布方事务内同步 | **异常上抛**，发布方事务一并回滚 | 必须与发布方原子生效的副作用；中间状态业务上不可接受 |
| `BEST_EFFORT` | 发布方事务内同步 | 异常吞掉并记录，不影响发布方与其它监听者 | 「做了更好、失败也不该拖垮主流程」；注意仍占用主流程耗时 |
| `RETRYABLE` | 事务内**落库**，提交后由调度任务异步投递 | 按退避重试，超上限转终态失败 | 耗时的、或依赖外部系统的副作用 |

选择规则：

- 副作用与主流程**必须同生共死** → `SYNC`。代价是一个有缺陷的监听者会阻断发布方主流程。
- 副作用**调用外部系统**（网络、第三方接口）→ `RETRYABLE`。放进主事务会拉长事务持有时间、把外部系统的抖动变成本方的失败。
- 其余 → `BEST_EFFORT`。

`RETRYABLE` 的落库与发布方同事务，因此不存在「主流程成功了事件却丢了」；投递**至少一次**，**监听者必须自己保证幂等**。

---

## 四、匹配规则（冻结）

`publish` 用 `isInstance` 匹配，而非精确类型相等：

```kotlin
if (!listener.eventType.isInstance(event)) continue
```

事件常被设计成密封层级，订阅父类型的监听者应当收到全部子类型。若用精确匹配，这类订阅会**静默失效**——不报错、也不触发，是最难排查的一类缺陷。

### 4.1 不提供按事件类型的订阅查询

总线**只提供** `hasAnyListener()`，不提供 `hasListeners(type)`。

按类型判定在 Kotlin/Native 上没法正确实现：没有完整反射，拿不到 `isSubclassOf`；而 `isInstance` 需要一个实例，可实例还没构造正是要判定的原因。曾经有过一个用精确类型相等实现的版本，与 `publish` 的 `isInstance` 不一致：订阅父类型的监听者在它那里被判为「无人订阅」，发布方据此跳过事件构造，事件静默丢失。

与其留一个只在精确类型下正确、在密封层级下悄悄骗人的方法，不如不提供。事件构造真的昂贵时，把昂贵的部分放进监听者。

---

## 五、生命周期（冻结）

总线由**框架**在启动最早期绑定，早于组件初始化与模块初始化：

```
bind(NetonContext) → bind(DomainEventBus) → 组件 init → 模块 init → seal() → freeze → 服务
                                              ↑            ↑
                                        发布方持有它    监听者 register / attachStore
```

### 5.1 为什么由框架绑定而不是应用装配层

因为「忘了绑」的后果是全链路静默空转。发布方取不到总线就会写成 `events?.publish(...)`，漏装配时没有任何信号——曾经真的发生过：在线充值的自动到账监听者从未注册，支付成功后余额不入账，只能靠后台手工点，而链路上没有一行错误日志。

由框架保证它一定存在，这个失败模式就不存在了。应用侧因此**必须用 `ctx.get(DomainEventBus::class)` 而不是 `getOrNull`**，发布方持有的字段**必须非可空**——空总线本身已经是无副作用的空操作，不需要再用 `null` 表达一次。

### 5.1.1 框架绑定的总线必须带错误记录

`BEST_EFFORT` 的契约是「异常被吞掉**并记录**」。`DomainEventBus` 构造器的 `onError` 有一个空实现默认值——那是给单元测试用的，框架绑定时**必须**注入真实回调，否则契约里的"记录"在运行时不存在。

框架绑定早于 Logger 就绪，因此回调在**调用时**才通过 `CoreLog` 取 Logger，并以 `event.listener.failed` 结构化记录（字段：`listener`、`event`、`mode`，附异常）。这条由装配级测试 `EventBusAssemblyTest` 守着：完整走 `Neton.run`，注册一个抛异常的 `BEST_EFFORT` 监听者，断言日志里出现该记录。变异验证过：回调换回默认空实现，测试即红。

### 5.2 seal()

在 `validateRuntimeGraph` 之后、`ctx.freeze()` 之前调用，做两件事：

1. 转只读。此后 `register` / `attachStore` 抛错。
2. 校验 `listenerId`：空白或重复都**启动失败**。重复时 `listenerOf` 只会命中第一个，后注册者的积压事件永远投给别人——静默地。
3. 校验：存在 `RETRYABLE` 监听者时，必须已 `attachStore`，否则**启动失败**并指名是哪个监听者、缺什么。

---

## 六、事务性 outbox（冻结）

### 6.1 为什么是存表而不是消息中间件

投递记录与发布方的业务写入落在**同一个本地事务**里，这是消息中间件给不了的：

- 先写库再发消息 → 两者之间有丢消息的窗口
- 先发消息再写库 → 可能投递一个并未真正发生的事件

事务性 outbox 用一次本地事务消除了这个窗口。

### 6.2 端口

```kotlin
interface DomainEventStore {
    suspend fun append(record: PendingEventRecord)                                  // 必须在调用方事务内
    suspend fun claimDue(now: Long, limit: Int, staleBefore: Long): List<StoredEventRecord>
    suspend fun markDelivered(id: Long, claimToken: String, now: Long): Boolean
    suspend fun markFailed(id: Long, claimToken: String, now: Long, nextAttemptAt: Long?, error: String): Boolean
}

interface DomainEventCodec {
    fun encode(event: DomainEvent): String?
    fun decode(eventType: String, payload: String): DomainEvent?
}
```

`PendingEventRecord` **不带时间戳**：时间由实现方在写入时取。曾经这里有个 `createdAt`，而总线拿不到时钟只能恒传 `0`，落库的每一行 `created_at` 都是 epoch 0——一个看着有意义、实际永远是假值的字段，排查积压时反而误导，而下面的滞留回收恰好要靠时间戳。

`encode` 返回 `null` 时总线**抛错**，不改走同步执行。那是应用层漏注册事件类型，属于配置错误。

**`append` 必须断言处在事务内**（`DbContext.inTransaction()`）。事务外写入会立即提交，随后业务失败也收不回来，等于投出了一个并未发生的事件——恰好是选事务性 outbox 要消除的问题。这类错误在单元测试里几乎不会暴露，只有生产上某次业务写入失败时才显形，因此不能留给注释，必须 fail-fast。参考实现在这里报错并指名事件与监听者。

### 6.3 状态机

```
0 待投递 ──claimDue──> 1 投递中 ──markDelivered──> 2 已投递
   ↑                      │
   └──markFailed(可重试)───┤
                          └──markFailed(超上限)──> 3 终态失败
   ↑
   └──可见性超时回收───────┘
```

### 6.4 领取令牌（fencing）：正确性的真正来源

**行锁只覆盖 `claimDue` 那一条语句**，监听者执行期间早已释放。领取者 A 超时后被 B 重领，A 迟到的 `markDelivered` / `markFailed` 若只按 `id` 匹配，会把 B 已完成的记录改回待重试或终态失败——一条已经成功的事件被重投，或者被标成失败。

因此每次领取都生成新的 `claim_token`，随记录返回，落定时**必须校验**：

```sql
UPDATE ... SET status = 2 WHERE id = :id AND status = 1 AND claim_token = :token
```

令牌不匹配时更新 0 行、返回 `false`，本次落定作废，**不抛错**——迟到的旧领取者本来就该安静退出。投递器据此不把它计入成功。

这意味着「多节点不需要 Redis 锁」的正确理由是：**数据库原子领取负责互斥，claim 令牌负责落定的所有权**；Redis 只能承担唤醒等性能优化。不能写成「行锁覆盖整个投递过程」——它不覆盖。

### 6.5 可见性超时是「至少一次」成立的前提

**实现方必须回收滞留的「投递中」记录。**

领取之后、`markDelivered` / `markFailed` 之前进程崩溃，记录会卡在状态 1。若没有回收机制，它既不会被再次领取、也不会报错，事件就此**永久静默丢失**——而「不丢」正是选用事务性 outbox 的全部理由。

因此 `claimDue` 同时领取两类记录：

1. 到期待投递的（`status = 0` 且 `next_attempt_at <= now`）
2. 滞留的（`status = 1` 且 `updated_at <= staleBefore`）

`staleBefore = now - visibilityTimeoutMillis`，默认 5 分钟。该值要明显大于单条投递的最长耗时，否则正在正常执行的记录会被另一个节点重复领走；又不能太大，否则崩溃后恢复要等很久。

正因为有这条回收，同一条记录**可能被投递多次**，监听者必须幂等。改成恰好一次需要把「业务副作用」和「标记完成」放进同一个事务，而副作用往往在外部系统里，那是分布式事务的范畴，代价远大于让消费方做幂等。

### 6.6 领取用条件占位，不用先查后改

先查后改会让多个实例领到同一批。参考实现用 PostgreSQL 的 `FOR UPDATE SKIP LOCKED` 单语句领取：并发领取者各自跳过对方已锁定的行，一次往返拿到互不重叠的一批。

逐行条件更新（1 次 SELECT + N 次 UPDATE）也能保证互斥，但一批 100 条就是 101 次往返，且多实例下大量更新会落空。

### 6.7 退避

指数退避并**封顶**。不封顶的话尾部重试会被推到几天之后，等于永远不再投递；封顶后即使多次失败也仍以固定节奏重试，恢复后能自愈。超过 `maxAttempts` 转终态失败，等待人工介入——无限重试会让一条坏记录永远占着投递批次，把后面的事件一起拖住。

监听者下线或载荷无法还原时**直接转终态**，不重试：重试多少次结果都一样。

### 6.8 取消不是失败

监听者抛出 `CancellationException`（应用关闭、任务取消）时，总线与投递器都**必须原样上抛**，不能当成普通失败：`BEST_EFFORT` 不能吞它，投递器不能为它写重试状态。吞掉取消信号会让关闭流程无法收敛；记成失败会污染重试计数。取消时记录留在「投递中」，由可见性超时回收后重投。

### 6.9 解码失败与类型不匹配都是终态

`codec.decode` **抛异常**与返回 `null` 同等对待——JSON 解码遇坏数据就是抛，不是返回 null。解码必须放在投递器的 `try` 里：放在外面，一条毒消息会让整批中断，其余记录不处理，超时后毒消息重现、再中断，整个链路被一条坏数据卡死。解码异常转终态，`CancellationException` 例外，原样上抛。

解出的对象若不是监听者 `eventType` 的实例，同样直接终态，不交给 `onEvent`。否则会以 `ClassCastException` 的形式在监听者里失败，被当成普通错误反复重试直至耗尽。

### 6.10 失去所有权后不再上报

`markFailed` 返回 `false` 说明令牌已换、本 worker 已失去所有权，这条失败已不归它管。**不得再调用 `onError`**——那会制造一条并不存在的重试或终态告警。只在落定成功（返回 `true`）时上报。

### 6.11 令牌只保护落定，不保护副作用

`claim_token` 保证的是**数据库落定的所有权**：迟到的旧领取者不能覆盖新领取者写的状态。它**不能**阻止超时后两个消费者都执行了外部副作用——A 超时前已经调了第三方接口，B 重领后又调一次。这正是「至少一次」的含义，**监听者幂等要求不因令牌而放松**。

---

## 七、明确的非保证

以下都不是缺陷，是 v1 的边界。依赖它们的业务必须自己处理。

| 非保证 | 说明 |
|---|---|
| **无投递顺序** | 同一聚合根的多个事件可能乱序投递。多节点并行消费 + `SKIP LOCKED` 不保证 id 序。需要顺序的场景请把状态判断写进监听者（读当前状态再决定），而不是依赖到达顺序。 |
| **非恰好一次** | 见 6.4。监听者必须幂等。 |
| **无跨进程广播** | 总线是进程内的。`RETRYABLE` 的异步投递也只是「本进程落库、任一节点消费」，不是发布订阅广播。 |
| **无事件版本演进** | `payload` 是不透明字符串。事件类改了形状后，积压的旧行 `decode` 失败即转终态失败。有此风险时请在 payload 里自带版本字段，由 codec 兼容。 |
| **无事件溯源** | outbox 表是投递队列不是事实来源，已投递的记录可被清理。 |

---

## 八、运维面（参考实现，应用层）

语义正确只是前半段，「失败了有人看得见、看见了有办法处置」是后半段。以下全部在 `neton-application-module-infra`，不在框架。

| 能力 | 落地 |
|---|---|
| **终态失败出口** | `GET /infra/domain-event/page?status=3` 查、`GET /get/{id}` 看载荷与错误、`POST /requeue/{id}` 重投、`POST /discard/{id}` 丢弃。权限 `infra:domain-event:query` / `infra:domain-event:manage` |
| **积压指标** | `GET /infra/domain-event/stats`：各状态计数、最老待投递年龄、最老投递中年龄。投递任务每轮读一次，超阈值以 `event.backlog` 记 warn——终态失败 > 0、待投递超 `backlog_warn_pending`、最老年龄超 `backlog_warn_age_ms` |
| **清理** | `DomainEventCleanupJob`，`@Job(cron = "17 3 * * *", SINGLE_NODE)`，分批删除已投递 / 已丢弃且超过 `retention_days` 的行 |
| **配置** | `infra.conf` 的 `[domain_events]` 段：`batch_size` / `max_attempts` / `base_backoff_ms` / `max_backoff_ms` / `visibility_timeout_ms` / `retention_days` / `backlog_warn_pending` / `backlog_warn_age_ms`。类型不对直接抛，不回退 |

### 8.1 状态 4：已丢弃

在原来的 0–3 之外增加 `4 = 已丢弃（人工）`。丢弃不删行——保留审计，随已投递记录一起被清理任务回收。领取语句只看 0 和滞留的 1，天然忽略 4。

### 8.2 重投与丢弃的状态约束

| 操作 | 允许的起点 | 理由 |
|---|---|---|
| 重投 | 仅终态失败（3） | 待投递 / 投递中本来就在流转，重投只会制造重复；已投递 / 已丢弃重投是业务决定，不该藏在按钮后面 |
| 丢弃 | 待投递（0）或终态失败（3） | 投递中（1）可能正被某节点执行，丢弃与执行并发让状态不可解释，等它落定 |

重投时 `attempts` 归零（重新享受完整重试预算）、`claim_token` 清空（旧领取者的令牌不能复活）。

### 8.3 非阻塞的后续项

以下两项**不影响正确性与生产就绪**，是便利性扩展。记录在这里是为了划清边界：它们不是"未完成"，是"未选择做"。

| 项 | 现状 | 边界条件 |
|---|---|---|
| **KSP 生成 codec** | 应用手写 `DomainEventCodec`，按事件类型分派 `Json.encodeToString` / `decodeFromString`。几十行，一次性工作 | 生成器可放 `neton-ksp`；生成物（codec 实现与事件类型表）**必须落在应用项目**，框架内不得出现事件注册表（见十一节）。要做时以 `@Serializable` + `DomainEvent` 双标记为发现条件 |
| **指标导出** | `stats` 通过 HTTP 接口与 `event.backlog` 日志告警暴露 | 接 Prometheus 等拉取端点属于应用监控栈的选择，与事件总线无关；`DomainEventStats` 的字段已是导出所需的全部 |

## 九、参考实现

框架只定义端口，以下是应用层的一种落地（见 `neton-application-module-infra`）：

| 组件 | 职责 |
|---|---|
| `PostgresDomainEventStore` | `DomainEventStore` 的 PostgreSQL 实现，表 `infra_domain_events`（V008 / V009 / V010）。构造时校验方言，非 PG 直接失败——`SKIP LOCKED` 与 `UPDATE … RETURNING` 都是 PG 语法。 |
| `DomainEventDispatcher` | 领取 → 交回监听者 → 标记完成 / 退避重排 |
| `DomainEventDispatchJob` | `@Job(fixedRate = 10s, mode = ALL_NODES)` 周期调用投递器 |

投递任务用 `ALL_NODES` 而不是 `SINGLE_NODE`：领取本身已互斥，积压时多实例一起消费能更快追平。

### 9.1 真实 PostgreSQL 契约测试（发布门禁）

`PostgresDomainEventStoreDbTest` 在真实 PostgreSQL 上验证存储契约本身，FakeStore 单测验不了这些。它由**独立的 Gradle 任务 `postgresContractTest`** 运行，不在普通 `macosArm64Test` 里——普通单元测试在任何机器上不配数据库都必须绿，而门禁套件缺数据库必须红，两者不能共存于一个任务。四条设计规则：

1. **必须显式提供 `EVENT_DB_URI`，无 fallback，源码里不得出现任何凭据**。任务在 `doFirst` 里检查，缺了直接拒绝执行。
2. **每个用例在随机命名的临时数据库里跑 infra 的真实迁移**（V001–V010，来自构建期生成的 `InfraMigrationResources`），再用迁移建出来的默认表测试。迁移缺列、顺序错、执行失败都会在这里暴露；手抄一份表结构测不到。之所以用临时库不用临时 schema：`SET search_path` 是会话级的，sqlx 走连接池，且迁移引擎的 history 表若已在 public，会把脚本全判成"已应用"——第一版就是这样把测试数据泄漏进了真实表。
3. **`finally` 里 `DROP DATABASE` 并关连接**，用例失败也照做（验证过）。随机库名让并行 job 互不干扰。
4. 库名替换保留 URI 的查询参数（`?sslmode=…`），远程测试库也能用。

**关闭标准**：真实 PostgreSQL 上 `postgresContractTest` 全绿，且变异验证证明能抓回归——**已满足**。CI job `outbox-postgres-contract` 已配置（起临时 PG、建 `CREATEDB` 角色、跑该任务、`always()` 断言无残留）；它是应用工程的运维事项，不作为框架冻结条件。

用例：

| 用例 | 守的是 |
|---|---|
| 事务外 `append` 被拒；事务回滚后无残留、提交后存在 | 6.2「必须在事务内」不是注释，是断言 |
| 两个领取者并发领取，id 集合互不重叠、并集覆盖全部 | 6.6 `SKIP LOCKED` 真的互斥 |
| 投递中记录未超时不重领、超时后重领且换令牌 | 6.5 滞留回收 |
| A 超时被 B 重领后，A 迟到的 `markDelivered` / `markFailed` 均作废（双向） | 6.4 fencing |
| 同一令牌落定后再落定被拒 | CAS 同时看状态与令牌 |
| 终态不被到期领取也不被滞留回收；重试尊重 `next_attempt_at` 并累加 `attempts` | 6.3 状态机 |
| `stats` 各状态计数与年龄正确 | 8 积压指标 |
| 重投只接受终态失败，归零 `attempts`、清空令牌，重投后能被再领 | 8.2 |
| 丢弃接受 0/3、拒绝 1，已丢弃不被领取 | 8.1 / 8.2 |
| 清理只删 2/4 且超保留期，分批 | 8 清理 |

变异验证过：去掉 `claim_token` 校验 → fencing 三个用例失败；去掉 `SKIP LOCKED` → 并发不重叠用例 3/3 稳定失败。这套测试是真门禁。

---

## 十、多节点执行与分布式锁（分析结论）

常见直觉是「多节点消费同一张表，要用分布式锁互斥」。**这个直觉在这里是错的**，记录理由以免日后反复。

### 10.1 结论：outbox 投递不使用分布式锁

领取语句本身就是互斥原语：

```sql
UPDATE ... WHERE id IN (SELECT id FROM ... FOR UPDATE SKIP LOCKED) RETURNING ...
```

**领取的原子性 + 落定的 claim 令牌**才是正确性来源（见 6.4），Redis 锁在这里没有位置。四条理由：

| # | 理由 | 说明 |
|---|---|---|
| 1 | **已经互斥了** | `SKIP LOCKED` 领取保证同一条不被两个节点同时取走；`claim_token` 保证迟到的落定作废。注意行锁**只覆盖领取语句**，不覆盖投递过程——所以真正防覆盖的是令牌，不是锁。再加 Redis 锁是重复。 |
| 2 | **会把并行变串行** | `SKIP LOCKED` 让 N 个节点各领一批互不重叠，吞吐随节点数线性增长。全局锁则同一时刻只有一个节点在投递——**积压时最需要并行，恰好被锁死**。 |
| 3 | **Redis 锁会在持有中过期** | 锁有 TTL，投递耗时超过 TTL 就自动释放，第二个节点进入，两个投递器并发且互不知情。数据库行锁绑定事务生命周期，不会中途失效。 |
| 4 | **两个真相源** | 领取状态在数据库（`status` 列），锁在 Redis。网络分区后两者会不一致，而事件投递的正确性只能有一个真相源。 |

第 3 条对 Neton 尤其致命：[Redis 规范](./redis.md) 明确声明 `LockManager` 是**「尽力锁」、非强一致**，不做 RedLock、v1 不做自动续租。用一把自家规范都说了不强一致的锁，去保证带钱的事件投递互斥，是违反规范的用法。

### 10.2 Redis 在事件体系里的正确位置

不是锁，是另外三处。共同的设计约束：**Redis 只允许出现在「失效后降级为性能损失、不影响正确性」的位置**。

| 用途 | 说明 | 依赖 | 前置 |
|---|---|---|---|
| **投递唤醒** | 现在靠 `fixedRate = 10s` 轮询，最坏延迟 10 秒。发布方提交后广播一个「有活了」信号，投递器立即醒。**Redis 挂了退回轮询**，只是慢，不会丢。 | pub/sub | `RedisClient` 需补 pub/sub |
| **广播投递** | 见 10.3。竞争消费之外的另一种语义。 | pub/sub 或 Streams | 同上 |
| **单例维护任务** | 清理已投递记录、扫描终态失败告警。不需要并行，重复执行也无害——**这正是「尽力锁」的适用场景**，用 `@Job(mode = SINGLE_NODE)` 即可。 | `LockManager` | 已具备 |

### 10.3 竞争消费 vs 广播：两种语义，不能混为一谈

当前 outbox 是**竞争消费**：一条事件对应一个监听者一行，任一节点消费掉即完成。这对「做一件事」类的副作用是正确的——余额入账只能加一次。

但另有一类需求是**广播**：每个节点都要收到。

| | 竞争消费（现状） | 广播（缺失） |
|---|---|---|
| 语义 | 恰好一个节点处理 | 每个节点都处理 |
| 例子 | 余额入账、发短信、对外回调 | 配置变更后各节点重载、清空各节点 L1 缓存、路由表刷新 |
| 载体 | 数据库 outbox | Redis pub/sub 或 Streams 消费者组 |
| 可靠性 | 至少一次，可重试 | 至多一次（订阅者离线即错过） |

Spring Cloud Bus 做的正是**广播**这一件事（配置刷新为主）。要在这个维度上超过它，需要新增一种投递模式，而不是强化现有的 outbox——两者解决的不是同一个问题。

**注意可靠性差异**：广播天然是至多一次。需要「广播 + 不丢」时，正确做法是每个节点在 outbox 里各有一行（按节点 id 分行），而不是指望 pub/sub 可靠。

### 10.4 顺序投递：用 SQL 谓词，不用租约

未来若要「同一聚合根的事件按序投递」，直觉方案是分区 + 租约：`hash(key) → N 个分区`，每个分区一个所有者。但租约又回到 TTL 安全问题（10.1 第 3 条）。

更好的方案是把约束表达进领取语句。给表加 `ordering_key`，领取时排除「同 key 存在更早的未完成行」：

```sql
AND NOT EXISTS (
    SELECT 1 FROM infra_domain_events e2
    WHERE e2.ordering_key = e.ordering_key
      AND e2.id < e.id
      AND e2.status IN (0, 1)
)
```

同一 key 的事件天然串行，不同 key 仍然全并行；**不需要任何租约、不需要领导者选举、真相源仍然只有数据库一个**。节点数可以任意增减，无需 rebalance。

**这个方案尚未冻结**，落地前必须先定义两件事：(a) 同 key 的某条进入终态失败后，后续事件是阻塞（保序优先）还是放行（可用性优先）；(b) `id` 是否等价于业务顺序——它是插入序，多事务并发写入时插入序未必是提交序。

### 10.5 两种架构如何同时支持

关键在于分层：**outbox 表不变，变的只是 relay**。

```
        发布方（本地事务）
              ↓
        outbox 表（本地可靠写入）        ← 两种架构下完全相同
              ↓
        ┌─────┴─────┐
   本进程投递        跨边界 relay
（负载均衡架构）    （分布式架构）
   直接调监听者      投到 Kafka / NATS / HTTP
```

- **当前（负载均衡，多实例共享一个数据库）**：投递器把事件交回本进程的监听者。不需要任何消息中间件。
- **未来（分布式，各服务独立数据库）**：投递器变成 relay，把事件搬到对外传输层，由对端服务消费。

「本地可靠写入」和「跨边界搬运」是两层职责。分开之后，今天写的业务代码在演进到分布式时**不需要改动**——发布方与监听者的契约不变，只是中间多了一跳。

### 10.6 对标应当对准 Spring Modulith，而不是 Spring Cloud Bus

- **Spring Cloud Bus** 是用消息代理广播控制面事件（主要是配置刷新），范围很窄，对应本规范 10.3 的「广播」一栏——那恰是我们目前缺失的。
- **Spring Modulith 的 Event Publication Registry** 才是真正的同类：事务内为每个（事件，监听者）写一行，监听者成功后标记完成，重启时重投未完成的。**这与本规范的设计是同一个东西**，核心思路已经对齐。

差距与优势：

| | 现状 |
|---|---|
| 落后 | 生态成熟度：多种 store 实现、重启重投、可观测性集成、运维界面（见第八节） |
| 领先 | Kotlin/Native 无 JVM 开销；codec 可由 KSP 编译期生成而非反射序列化；三种投递模式在监听者上显式声明，比 `@TransactionalEventListener` 的 phase 语义更直白 |

### 10.7 演进路线

| 阶段 | 内容 | 解决什么 |
|---|---|---|
| **P1 运维面** ✅ | 终态失败查询与处置接口、积压指标与告警、清理任务、配置接入——已落地（第八节）。KSP 生成 codec 顺延 | `RETRYABLE` 可上生产 |
| **P2 延迟与顺序** | Redis pub/sub 唤醒（纯优化，失效退回轮询）；`ordering_key` + SQL 谓词保序 | 投递延迟从 10s 降到亚秒；支持有序场景 |
| **P3 广播** | `RedisClient` 补 pub/sub / Streams；新增广播投递模式；节点身份与消费者组 | 补上 Spring Cloud Bus 覆盖的那一类场景 |
| **P4 跨服务** | Relay 抽象：投递器与传输解耦；对外传输实现（Kafka / NATS / HTTP）；事件版本与 schema 演进 | 支撑分布式架构，且业务代码不改 |

P1 已完成，`RETRYABLE` 可承载关键业务；剩余阶段是能力扩展，不是正确性前提。

---

## 十一、框架 / 应用边界（硬规则）

**Event Bus 的契约在 neton-core，实现只允许在应用层。** 这不是分层洁癖，是框架定位：Neton 不选载体、不绑数据库、不替应用决定运维形态。守不住这条线，框架就得为某一种数据库、某一种调度、某一种监控背书，其它选择的用户被迫带着用不上的实现。

| 层 | 允许 | 禁止 |
|---|---|---|
| **neton-core** | `DomainEvent` / `DomainEventListener` / `DeliveryMode` / `DomainEventBus` / `DomainEventStore` / `DomainEventCodec` 契约；进程内派发；启动期绑定与 `seal()` | 任何 `DomainEventStore` 实现；任何序列化选型；任何数据库引用 |
| **neton-database** | 通用数据库能力（如 `inTransaction()`） | 任何带事件语义的代码 |
| **neton-ksp** | 通用生成器（如从 `@Serializable` 事件生成 codec） | 生成物落在框架里；框架内的事件注册表 |
| **应用 infra 模块** | outbox 表与迁移、`DomainEventStore` 实现、投递器、调度任务、配置、指标、告警、管理接口、**真实数据库集成测试** | — |
| **业务模块** | 具体事件、监听者、codec 实现、幂等 | — |

判据：**一段代码若删掉后框架仍能运行、只是某个应用少了一种投递方式，它就属于应用层。**

当前状态已核对符合：框架仓库里只有 `neton-core/event/` 三个契约文件 + `Neton.kt` 的绑定/封印两行 + 契约测试；`PostgresDomainEventStore`、`DomainEventDispatcher`、`DomainEventDispatchJob`、V008–V010 全部在 `neton-application-module-infra`。真实 PostgreSQL 并发领取与 fencing 契约测试位于 infra；CI job 已配置但不作为框架冻结条件。

## 十二、收尾状态

本规范所述的框架契约、PostgreSQL 存储契约与参考实现的运维面，均已达到可依赖的健壮性：

- 每条契约有对应测试；存储与运维行为在真实 PostgreSQL 上验证（9.1，13 例）
- 关键门禁经变异验证：去掉 `claim_token` 校验、去掉 `SKIP LOCKED`、回退空错误回调，对应测试均稳定失败
- 评审完成，无未决 P0/P1

后续变更应视为**演进**（第十节路线图），不再是收敛。修改二至六节的语义须重新走评审并更新版本号。

## 十三、相关规范

- [Core 规范](./core.md) —— 组件模型与启动流程
- [数据库会话与事务契约](./database-session.md) —— `append` 依赖的事务语义
- [定时任务规范](./jobs.md) —— 投递任务的调度设施
- [Redis 规范](./redis.md) —— `SINGLE_NODE` 互斥所用的分布式锁
