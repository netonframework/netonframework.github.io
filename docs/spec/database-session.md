# Database Session and Transaction Contract

> Status: Accepted, implementation in progress
> Track: NETON-DB-SESSION-P0
> Target: Neton 1.0
> Kotlin baseline: 2.3.10

## 1. Purpose

Neton database execution has one authoritative path:

```text
Table / Query DSL / raw escape hatch
        -> DbContext
        -> current DbSession
        -> database adapter
        -> driver
```

No Table, generated source, query object, or business module may retain or resolve a driver executor directly.

This contract replaces the previous split execution model where `DbContext` used one path while
`SqlxTableAdapter`, `QueryRuntime`, and `EntityPersistence` could use global executors.

## 2. Runtime model

### 2.1 DbSession

`DbSession` is the smallest provider-neutral execution boundary. It owns the effective dialect and
executes `BuiltSql` values. It does not expose sqlx4k, connection, transaction, or driver types.

```kotlin
interface DbSession {
    val dialect: Dialect
    suspend fun query(statement: BuiltSql): List<Row>
    suspend fun execute(statement: BuiltSql): Long
}
```

### 2.2 DbSessionProvider

`DbSessionProvider` owns the root database session and resolves the session associated with the
current coroutine transaction scope.

```kotlin
interface DbSessionProvider {
    suspend fun current(): DbSession
    suspend fun <R> transaction(block: suspend () -> R): R
}
```

The production implementation stores only transaction scope in `CoroutineContext`. It must not use
thread-local state, process-global mutable state, or `NetonContext.current()`.

### 2.3 DbContext

`DbContext` remains the application execution facade. Every operation delegates to
`DbSessionProvider.current()` and applies interceptors exactly once.

Table implementations receive `DbContext` through construction. Generated Table code must not
import `adapter.sqlx.*` or resolve a global database object.

## 3. Transaction semantics

The standard application form is:

```kotlin
db.transaction {
    userTable.update(user)
    roleTable.insert(role)
}
```

All Table and Query DSL calls inside the block use the same transaction session automatically.

The following behavior is mandatory:

1. Normal return commits once.
2. Any thrown `Throwable`, including cancellation, rolls back once and is rethrown unchanged.
3. A nested `transaction` joins the existing transaction in v1; savepoints are not implied.
4. A transaction session cannot be used after the outer transaction completes.
5. Concurrent database operations in one transaction are unsupported in v1. Applications must not
   use `launch`, `async`, or parallel Flow collection for work sharing one transaction.
6. Child coroutines inherit transaction context only for structured, sequential work completed
   before the transaction block returns.
7. Lazy query objects and Flows must resolve and execute inside their collection call. A Flow created
   in a transaction must not be collected after that transaction has completed.

## 4. Table contract

Table is a single-table data access service. It is stateless and safe to share, but it is an instance
created by the application graph rather than a global driver holder.

The 1.0 write surface is explicit:

- `insert(entity)`
- `insertBatch(entities)`
- `update(entity)` or generated `update(id) { ... }`
- `updateBatch(entities)`
- `destroy(id)`
- `destroyMany(ids)`

The following APIs are removed before the 1.0 ABI baseline:

- `save(entity)` and `saveAll(entities)`
- entity ActiveRecord extensions such as `entity.save()` and `entity.delete()`
- `delete(entity)`
- Table-owned `transaction {}`
- legacy `QueryRuntime` and `EntityPersistence`

Create and update semantics must never be inferred from whether an id is null or zero.

## 5. Adapter boundary

The sqlx4k adapter is responsible only for:

- creating the root executor
- adapting a root executor to `DbSession`
- adapting a sqlx4k transaction to `DbSession`
- converting named parameters and driver rows
- closing driver resources when supported

No sqlx4k type may appear in public Neton database API or generated application source.

## 6. Configuration and lifecycle

`DatabaseComponent` creates one `DbSessionProvider`, one `DbContext`, and the generated Table
services. It binds provider-neutral interfaces to the startup registry.

Invalid or unreadable production database configuration fails startup. Falling back to an in-memory
database requires an explicit development/test configuration and is never an error recovery path.

## 7. Acceptance gates

NETON-DB-SESSION-P0 is complete only when all gates pass:

1. Root Table CRUD uses the root session.
2. Two different Tables inside one transaction use the same transaction session.
3. Commit makes all writes visible.
4. Exception rollback makes no writes visible.
5. Cancellation rollback makes no writes visible.
6. Nested transaction joins the outer transaction and commits or rolls back atomically.
7. Query DSL, projection, JOIN, raw SQL, batch operations, soft delete, and interceptors use the
   current session.
8. No application-generated Table source imports sqlx4k or `SqlxDatabase`.
9. `QueryRuntime`, `EntityPersistence`, ActiveRecord writes, and Table-owned transaction are absent.
10. Framework database tests and the real `neton-application` composite build pass without `clean`.

## 8. Non-goals for 1.0

- savepoints or `REQUIRES_NEW`
- distributed transactions
- parallel statements on one transaction
- runtime database driver switching
- implicit schema creation or migration during application startup

