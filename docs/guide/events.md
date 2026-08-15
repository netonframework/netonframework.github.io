# Domain events

> This guide shows how to decouple modules with Neton's domain event bus: the module where
> something happens publishes an event, other modules subscribe, and the publisher never has to
> know who is listening. The bus lives in `neton-core` and is bound by the framework at startup,
> so it works out of the box.

---

## 1. Why events instead of direct calls

When a payment succeeds, three things need to happen: credit the wallet, unlock the content, send
a notification. With direct calls, `PayOrderLogic` invokes three other Logic classes in turn — the
payment module now knows about wallets, content and notifications, and every new consumer means
another edit to payment code.

With events, payment publishes one `PayOrderPaidEvent` and each consumer subscribes. Payment does
not know who is listening or how many. A fourth consumer plugs in without touching payment at all.

---

## 2. Defining an event

An event is a plain Kotlin class implementing the `DomainEvent` marker, **declared in the module
where it originates**:

```kotlin
package event

import neton.core.event.DomainEvent

data class PayOrderPaidEvent(val order: PayOrder) : DomainEvent
```

Events that will be persisted for delivery (see section 5) must be **named top-level or nested
classes**. Anonymous and local classes have no stable type name and are rejected.

Events are often modelled as a sealed hierarchy so consumers can subscribe to the whole family or
to one member:

```kotlin
sealed interface PayOrderEvent : DomainEvent
data class PayOrderPaidEvent(val order: PayOrder) : PayOrderEvent
data class PayOrderRefundedEvent(val order: PayOrder) : PayOrderEvent
```

A listener subscribed to `PayOrderEvent` receives both subtypes — the bus matches with
`isInstance`, not exact type equality.

---

## 3. Publishing

The publisher holds a `DomainEventBus` and publishes **inside the same transaction** as its
business write:

```kotlin
class PayOrderLogic(
    private val log: Logger,
    private val events: DomainEventBus,        // non-nullable
) {
    suspend fun markPaid(orderId: Long) = db.transaction {
        val paid = PayOrderTable.update(orderId) { status = PAID }
        events.publish(PayOrderPaidEvent(paid))
        paid
    }
}
```

Two rules:

- **The `events` field is non-nullable**, obtained with `ctx.get(DomainEventBus::class)`, not
  `getOrNull`. The framework guarantees the bus exists. A nullable field with
  `events?.publish(...)` turns a missing wiring into a whole chain that silently does nothing.
- **Publish inside a transaction.** Synchronous listeners join the same transaction; persisted
  events must commit or roll back with the business write. Publishing a persisted event outside a
  transaction fails immediately.

---

## 4. Subscribing

Implement `DomainEventListener<E>` and register it during module initialisation:

```kotlin
class WalletRechargePaidListener(
    private val wallets: PayWalletLogic,
) : DomainEventListener<PayOrderPaidEvent> {

    override val eventType = PayOrderPaidEvent::class
    override val listenerId = "payment.wallet-recharge-paid"   // explicit, and never changed afterwards
    override val mode = DeliveryMode.SYNC

    override suspend fun onEvent(event: PayOrderPaidEvent) {
        val rechargeId = parse(event.order.merchantOrderId) ?: return
        wallets.markRechargePaid(rechargeId, event.order.channelCode ?: "")
    }
}
```

```kotlin
// in the module's runtime bootstrap
ctx.get(DomainEventBus::class).register(
    WalletRechargePaidListener(ctx.get(PayWalletLogic::class))
)
```

`listenerId` is a persistence routing key and is written to the database; prefix it with the
module name to avoid collisions. A blank or duplicate id fails startup.

Registration is startup-only. The framework seals the bus after module initialisation; a later
`register` throws.

---

## 5. Choosing a delivery mode

`mode` decides when a listener runs and what happens when it fails.

| Mode | When | On failure | Use when |
|---|---|---|---|
| `SYNC` | Synchronously, inside the publisher's transaction | Exception propagates; the publisher's transaction rolls back | The side effect must **succeed or fail together** with the main flow. Payment succeeded → wallet credited: both or neither |
| `BEST_EFFORT` | Synchronously, inside the publisher's transaction | Exception swallowed and logged as `event.listener.failed` at warn; publisher and other listeners unaffected | Nice-to-have work that must not take the main flow down. Updating a counter |
| `RETRYABLE` | Persisted in the transaction, delivered asynchronously after commit | Exponential backoff; terminal failure after the retry limit | The side effect **calls an external system** — a callback, an SMS. Doing that in the main transaction holds locks longer and turns remote flakiness into local failures |

`SYNC` is the default. Rule of thumb: **network call inside the listener → `RETRYABLE`;
otherwise `SYNC`.**

### What RETRYABLE additionally requires

- **The listener must be idempotent.** Delivery is at-least-once: crash recovery and timeout
  reclaim can both deliver the same record twice.
- The application must wire persistence (a `DomainEventStore` implementation plus a
  `DomainEventCodec`). A `RETRYABLE` listener with no store **fails startup** and names the
  listener — it does not silently degrade.
- The reference implementation lives in `neton-application-module-infra`: a PostgreSQL outbox
  table, the dispatch job, an admin surface under `/infra/domain-event` (paging, detail, `stats`,
  requeue, discard), a daily cleanup job, and a `[domain_events]` section in `infra.conf`. The
  dispatch job logs `event.backlog` at warn when work piles up or terminal failures appear.

---

## 6. Errors and debugging

| Symptom | Cause |
|---|---|
| Startup: "listener X declares RETRYABLE but DomainEventStore is missing" | No persistence wired. Wire it, or change the listener to `SYNC` / `BEST_EFFORT` |
| Startup: "duplicate listenerId" / "blank listenerId" | Two listeners share an id, or one forgot to declare it |
| Publish: "must be published inside a database transaction" | A `RETRYABLE` event was published outside `db.transaction { }` |
| Publish: "DomainEventCodec cannot serialize" | The codec does not know this event type; add it |
| Runtime: "DomainEventBus is sealed" | `register` / `attachStore` was called after startup |
| Event published, listener never runs, no error | Check whether the publisher's `events` is nullable with `?.` — exactly the failure the framework-bound bus exists to remove |

A `CancellationException` thrown by a listener is not a failure: `BEST_EFFORT` does not swallow
it, and the dispatcher does not record a retry for it.

---

## 7. Related

- Domain event specification (in-repo, `docs/zh-hans/spec/event.md`, Chinese) — contract, delivery semantics, outbox design, multi-node analysis, framework/application boundary
- [Redis and distributed locks](./redis.md) — why the dispatcher does **not** use a distributed lock (specification, section 10)
- [Database](./database.md) — `db.transaction { }` and `inTransaction()`
