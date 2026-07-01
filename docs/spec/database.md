# Neton Database Specification

> Status: Accepted, 1.0 convergence in progress
> Baseline: Kotlin 2.3.10
> Related: [Database Session and Transaction Contract](./database-session.md), [Migration](./migration.md)

## 1. Positioning

Neton Database is a Native-first, KSP-generated data access layer. Its authoritative execution path is:

```text
Entity Table / Query DSL / raw SQL
        -> DbContext
        -> current DbSession
        -> database adapter
        -> driver
```

The design is deliberately small:

- Entity is a pure data class.
- KSP generates metadata, row mapping, Table and typed update extensions.
- Table owns single-table operations but no connection or transaction state.
- DbContext is the provider-neutral execution and transaction facade.
- sqlx4k is an internal adapter detail.

Neton does not provide runtime entity scanning, reflection mapping, Active Record, repository method-name parsing, automatic production schema upgrades, or a second runtime Table registry.

## 2. Entity Contract

```kotlin
@Serializable
@Table("users")
data class User(
    @Id val id: Long?,
    val name: String,
    val email: String,
    val status: Int,
)
```

Entities must remain persistence-free:

- no `save()` or `delete()` member or generated extension
- no driver, DbContext or Table reference
- no persistence behavior in companion objects
- no runtime reflection requirement

`@Id` defines the only identity used by primary-key CRUD. Application conventions may further require Long ids or 0/1 flag fields, but those are not universal framework constraints.

## 3. Generated Surface

For each `@Table` entity, KSP generates:

```text
UserMeta           internal table and column metadata
UserEntityMapper   internal Row -> User mapping
UserTable          public Table<User, Long> facade
UserUpdateScope    typed mutable update scope
UserExtensions     UserTable.update(id) { ... }
```

Generated source must not resolve a driver executor or import sqlx4k types. It delegates execution through the framework Table adapter and the current DbContext session.

The public usage surface is:

```kotlin
UserTable.get(id)
UserTable.insert(user)
UserTable.update(user)
UserTable.update(id) { name = "New name" }
UserTable.destroy(id)
UserTable.query { where { User::status eq 1 } }.list()
```

## 4. Table Contract

`Table<T, ID>` is a stateless, shareable single-table data access service.

### 4.1 Reads

```kotlin
suspend fun get(id: ID): T?
suspend fun findAll(): List<T>
suspend fun many(ids: Collection<ID>): List<T>
suspend fun oneWhere(block: PredicateScope.() -> Predicate): T?
suspend fun exists(id: ID): Boolean
suspend fun existsWhere(block: PredicateScope.() -> Predicate): Boolean
suspend fun count(): Long
```

`many(emptyList())` returns an empty list without executing invalid SQL. Soft-deleted rows are excluded consistently from `get`, `findAll`, `count` and Query DSL reads.

### 4.2 Writes

```kotlin
suspend fun insert(entity: T): T
suspend fun insertBatch(entities: List<T>): Int
suspend fun update(entity: T): Boolean
suspend fun updateBatch(entities: List<T>): Int
suspend fun destroy(id: ID): Boolean
suspend fun destroyMany(ids: Collection<ID>): Int
```

Write intent is always explicit. The framework must not infer insert versus update from a null, zero, empty or otherwise special id.

`insert(entity)` returns the authoritative persisted row. When the primary key is database-generated,
the returned entity must contain that generated id. PostgreSQL and SQLite use `RETURNING`; MySQL
reads `LAST_INSERT_ID()` on the same transaction/session.

`insertBatch(entities)` returns only the affected-row count. It does not mutate the input entities
and does not return generated ids. Code that needs generated ids must call `insert` for each entity
inside an explicit transaction until a separate batch-returning API is specified.

The following APIs are forbidden in the 1.0 public ABI:

- `save` and `saveAll`
- `delete(entity)`
- `entity.save()` and `entity.delete()`
- `Table.transaction { }`
- runtime `QueryRuntime`, `EntityPersistence` or KClass-to-Table registries

All destructive single-resource operations use the primary key. Domain-specific natural-key operations must first resolve identity or use an explicitly named business method in Logic.

## 5. Query DSL

The canonical typed query form is:

```kotlin
val page = UserTable.query {
    where {
        (User::status eq 1) and (User::name like "%neton%")
    }
    orderBy(User::id.desc())
}.page(page = 1, size = 20)
```

The same normalized AST is used for `list`, `count`, `page`, projection, update and delete execution. Soft-delete conditions and QueryInterceptor rewrites are applied once before SQL generation.

Rules:

- values are always bound parameters
- user values must never be interpolated into SQL
- pagination is one-based at the public API
- `Page<T>` contains `items`, `total`, `page`, `size` and computed `totalPages`
- raw string column names are compatibility/escape-hatch APIs, not the preferred typed path

## 6. DbContext and Transactions

Logic receives `DbContext` through construction. Controller code must not execute database operations directly.

```kotlin
class UserLogic(private val db: DbContext) {
    suspend fun createWithRoles(user: User, roleIds: List<Long>) = db.transaction {
        val created = UserTable.insert(user)
        UserRoleTable.insertBatch(roleIds.map { UserRole(created.id!!, it) })
        created
    }
}
```

Every Table operation inside the block resolves the same coroutine-scoped transaction session. Nested transactions join the outer transaction in 1.0. Exceptions and cancellation roll back and propagate unchanged.

Raw SQL is an intentional Logic-layer escape hatch:

```kotlin
db.fetchAll(sql, params)
db.execute(sql, params)
```

Raw SQL still uses the current session and the same execution observers. It does not bypass transactions, metrics or error reporting.

## 7. Interceptors

`QueryInterceptor` has two responsibilities only:

- rewrite a query AST before SQL generation
- observe successful or failed SQL execution

It must not mutate fetched entities, run additional SQL, own business rules, or become a hidden authorization service. Each rewrite and execution callback runs exactly once per operation.

## 8. Soft Delete and Audit Fill

`@SoftDelete` changes `destroy` into an update and automatically filters normal reads. Numeric flag columns use `1` for deleted and `0` for active; Boolean columns use `true` and `false`.

`@CreatedAt` and `@UpdatedAt` may fill timestamps at the Table boundary. Database defaults and migration SQL remain authoritative for schema shape and constraints.

## 9. Schema Lifecycle

Production schema evolution uses versioned SQL migrations only. Application startup checks migration state but never silently alters schema.

`ensureTable()` is restricted to demos and ephemeral tests. It must not be called by application startup, ModuleInitializer or RuntimeBootstrap.

## 10. Layering Rules

| Layer | May depend on | Must not depend on |
|---|---|---|
| Controller | Logic, DTO, HTTP annotations | Table, DbContext, sqlx4k |
| Logic | Table, DbContext, domain services | `adapter.sqlx.*`, driver types |
| Generated Table | Neton database API/SPI | application Logic, driver executor |
| Entity | serialization and mapping annotations | Table, DbContext, Logic |

Store/Repository wrappers are allowed only when they add a real domain boundary. A pass-through wrapper around generated Table is not part of the standard application shape.

## 11. Acceptance Gates

The database surface is ready for the 1.0 ABI baseline only when:

1. All Table, Query DSL, projection, JOIN, raw SQL and batch operations use the current DbSession.
2. Cross-table commit, rollback, cancellation and nested transaction contracts pass.
3. QueryInterceptor rewrite and observation callbacks execute exactly once.
4. Generated source imports no sqlx4k or global database executor.
5. Active Record, implicit save, Table-owned transaction and runtime Table registry APIs are absent.
6. KSP clean, no-op, add, modify and delete fixtures pass for all supported Native targets.
7. Framework examples and real application composite builds compile without requiring `clean`.
8. The public API has explicit visibility and an approved binary compatibility baseline.

## 12. Schema Migration

The application owns the migration history table name. A production application must declare it
explicitly in `config/database.conf`; the framework default exists only for tests and legacy
fixtures.

```toml
[migration]
history_table = "neton_schema_history"
```

The identifier must match `[A-Za-z_][A-Za-z0-9_]{0,62}`. Every history DDL, existence check, read
and write uses the configured name. PostgreSQL existence checks are scoped to `current_schema()`,
and subsequent history reads/writes use a schema-qualified table reference. Migration scripts may
change `search_path` (for example `pg_dump` output); this must not make history writes depend on
the script's session state.

On PostgreSQL and SQLite, cold-start creation executes `CREATE TABLE IF NOT EXISTS` and an
accessibility query on one pinned transaction session. The transaction must commit before the
engine uses another session. Applying a migration script and inserting its successful history row
are one transaction, so neither schema changes nor success history may commit alone. A failed
script rolls back first; its failure record is then written separately.

MySQL DDL implicitly commits and cannot provide the same rollback guarantee. Migration SQL for
MySQL must therefore keep each version forward-only and safe for operator-led recovery.

Only one deployment migrator may execute `migrate up` for an application database at a time.
Cross-process migration locking is not part of R0; deployment orchestration must serialize it.
