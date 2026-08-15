# 领域事件

> 本指南介绍如何用 Neton 的领域事件总线让模块解耦：发生方发布事件，消费方订阅；发生方不需要认识任何消费方。总线在 `neton-core`，由框架在启动时自动绑定，开箱即用。

---

## 一、为什么用事件而不是直接调用

支付成功后要做三件事：钱包入账、解锁内容、发通知。直接调用的写法是让 `PayOrderLogic` 依次调这三个 Logic——于是支付模块认识了钱包、内容、通知三个模块，每加一个下游就改一次支付代码。

事件的写法是支付模块只发布 `PayOrderPaidEvent`，三个下游各自订阅。支付模块不知道谁在听、有多少人在听。第四个下游接入时支付代码一行不动。

---

## 二、定义事件

事件是普通的 Kotlin 类，实现 `DomainEvent` 标记接口，**定义在发生方模块**：

```kotlin
package event

import neton.core.event.DomainEvent

data class PayOrderPaidEvent(val order: PayOrder) : DomainEvent
```

要落库投递的事件（见第五节）必须是**具名的顶层类或嵌套类**，匿名类和局部类拿不到稳定的类型名，会被拒绝。

事件常做成密封层级，让消费方既能整体订阅、也能只订阅其中一种：

```kotlin
sealed interface PayOrderEvent : DomainEvent
data class PayOrderPaidEvent(val order: PayOrder) : PayOrderEvent
data class PayOrderRefundedEvent(val order: PayOrder) : PayOrderEvent
```

订阅 `PayOrderEvent` 的监听者会收到两种子类型——总线用 `isInstance` 匹配，不是精确类型相等。

---

## 三、发布事件

发布方持有 `DomainEventBus`，在业务写入的**同一个事务里**发布：

```kotlin
class PayOrderLogic(
    private val log: Logger,
    private val events: DomainEventBus,        // 非可空
) {
    suspend fun markPaid(orderId: Long) = db.transaction {
        val paid = PayOrderTable.update(orderId) { status = PAID }
        events.publish(PayOrderPaidEvent(paid))
        paid
    }
}
```

两点必须遵守：

- **`events` 字段非可空**，装配时用 `ctx.get(DomainEventBus::class)` 而不是 `getOrNull`。总线由框架保证一定存在；写成可空配 `events?.publish(...)`，漏装配时整条链路会静默空转，没有任何信号。
- **在事务里发布**。同步监听者的写入要并入同一事务；落库投递的记录也要与业务写入同生共死。事务外发布落库事件会直接报错。

---

## 四、订阅事件

实现 `DomainEventListener<E>`，在模块初始化时注册：

```kotlin
class WalletRechargePaidListener(
    private val wallets: PayWalletLogic,
) : DomainEventListener<PayOrderPaidEvent> {

    override val eventType = PayOrderPaidEvent::class
    override val listenerId = "payment.wallet-recharge-paid"   // 必须显式声明，此后不可更改
    override val mode = DeliveryMode.SYNC

    override suspend fun onEvent(event: PayOrderPaidEvent) {
        val rechargeId = parse(event.order.merchantOrderId) ?: return
        wallets.markRechargePaid(rechargeId, event.order.channelCode ?: "")
    }
}
```

```kotlin
// 模块的 RuntimeBootstrap
ctx.get(DomainEventBus::class).register(
    WalletRechargePaidListener(ctx.get(PayWalletLogic::class))
)
```

`listenerId` 是持久化路由键，会写进数据库；建议带模块前缀，避免跨模块撞名。空白或重复的 id 会让启动失败。

注册只能在启动阶段做。框架在模块初始化结束后封印总线，之后再 `register` 会抛错。

---

## 五、选择投递模式

`mode` 决定监听者什么时候跑、失败了怎么办。

| 模式 | 时机 | 失败处理 | 什么时候用 |
|---|---|---|---|
| `SYNC` | 发布方事务内同步 | 异常上抛，发布方事务一并回滚 | 副作用必须与主流程**同生共死**。例：支付成功 → 余额入账，两者要么都成立要么都不成立 |
| `BEST_EFFORT` | 发布方事务内同步 | 异常吞掉并以 `event.listener.failed` 记录 warn，不影响发布方与其它监听者 | 做了更好、失败也不该拖垮主流程。例：更新统计计数 |
| `RETRYABLE` | 事务内落库，提交后异步投递 | 指数退避重试，超上限转终态失败 | 副作用**调用外部系统**。例：对第三方发回调、发短信。放进主事务会拉长事务、把外部抖动变成本方失败 |

`SYNC` 是默认值。一条经验规则：**监听者里有网络调用就用 `RETRYABLE`，否则用 `SYNC`**。

### RETRYABLE 的额外要求

- **监听者必须幂等**。投递是至少一次：崩溃恢复、超时重领都可能让同一条被投递两次。
- 应用要装配持久化设施（`DomainEventStore` 实现 + `DomainEventCodec`）。有 `RETRYABLE` 监听者却没装配，**启动直接失败**并指名是哪个监听者——不会静默降级。
- 参考实现在 `neton-application-module-infra`：PostgreSQL outbox 表、投递任务、运维接口（`/infra/domain-event`：分页、详情、`stats`、重投、丢弃）、每日清理任务、`infra.conf` 的 `[domain_events]` 配置段。投递任务在积压或出现终态失败时以 `event.backlog` 记 warn。

---

## 六、错误处理与调试

| 现象 | 原因 |
|---|---|
| 启动报「监听者 X 声明了 RETRYABLE，但启动结束时仍缺少 DomainEventStore」 | 没装配持久化设施。装上，或把该监听者改成 `SYNC` / `BEST_EFFORT` |
| 启动报「listenerId 重复」或「为空白」 | 两个监听者用了同一个 id，或忘了声明 |
| 发布时报「必须在数据库事务内发布」 | `RETRYABLE` 事件在 `db.transaction { }` 外发布了 |
| 发布时报「DomainEventCodec 无法序列化」 | codec 不认识这个事件类型，去 codec 实现里补上 |
| 运行期报「DomainEventBus 已结束装配」 | 在启动阶段之后调了 `register` / `attachStore` |
| 事件发了但监听者没收到，也没报错 | 检查发布方的 `events` 是不是可空类型配了 `?.`——这正是总线由框架绑定要消除的问题 |

监听者抛出的 `CancellationException` 不被当作失败：`BEST_EFFORT` 不吞它，投递器不为它写重试状态。

---

## 七、相关文档

- 领域事件规范（仓库内 `docs/zh-hans/spec/event.md`）—— 契约、投递语义、outbox 设计、多节点分析、框架/应用边界
- [Redis 与分布式锁](./redis.md) —— 投递任务为什么**不**用分布式锁，见规范第十节
- [数据库操作](./database.md) —— `db.transaction { }` 与 `inTransaction()`
