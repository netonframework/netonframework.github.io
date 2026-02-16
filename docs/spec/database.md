# Neton 数据库规范

> **状态**：正式规范  
> **定位**：Entity 纯数据模型 + Table 表级入口，无 companion、无反射、无动态魔法。  
> **原则**：Kotlin Native 友好、IDE 首次打开即友好、语义清晰、可长期维护。  
> **标签**：No companion — No reflection — Adapter-based — Stateless

---

## 目录

1. [总览](#一总览)
2. [API 设计](#二api-设计)
3. [Query DSL](#三query-dsl)
4. [架构实现（sqlx4k）](#四架构实现sqlx4k)
5. [SqlxStore 内部接口](#五sqlxstore-内部接口)
6. [Phase 1 执行规范](#六phase-1-执行规范)
7. [Contract Tests](#七contract-tests)
8. [冻结约束](#八冻结约束)

---

## 一、总览

### 1.1 定型 API 总览

| 层级 | 形态 | 示例 |
|------|------|------|
| **实体** | 纯 data class，无 companion | `data class User(...)` |
| **表级入口** | `object <Entity>Table : Table<Entity, ID>` | `object UserTable : Table<User, Long>` |
| **表级调用** | `UserTable.get` / `destroy` / `update` / `query` | `UserTable.get(id)` |
| **实例级** | `user.save()` / `user.delete()` | `user.save()` |

### 1.2 核心思想

neton-database 的「灵魂层」设计：

- **SQLx 只做 driver / pool**
- **KSP 生成 glue code**
- **API 以 Entity 为中心**（而不是 Store / Repo / Impl）
- **极轻量 + 强类型 + 零心智负担的 Query DSL**

**目标不是：**

- ❌ jOOQ（太重、DSL 过度工程化）
- ❌ MyBatis Plus（Wrapper 太 Java 味）
- ❌ 方法名爆炸

**而是：**

⭐ **Laravel 手感 + Kotlin DSL + 编译期安全**

### 1.3 与行业对标

| 框架 | 对应形态 |
|------|----------|
| Exposed | `object Users : Table` |
| jOOQ | `USERS` 常量 |
| SQLDelight | `userQueries` |
| Prisma | `prisma.user` |
| Room | `UserDao` |
| **neton-database** | `object UserTable : Table<User, Long>` |

---

## 二、API 设计

### 2.1 实体层（不写 companion）

```kotlin
@Serializable
@Table("users")
data class User(
    @Id val id: Long?,
    val name: String,
    val email: String,
    val status: Int,
    val age: Int
)
```

- 实体 = 纯数据模型，不承担持久化语义
- 无 `companion object`
- 无反射、无 KClass 扩展

### 2.2 KSP 生成

#### 2.2.1 生成对象命名与类型

| 规则 | 值 |
|------|-----|
| 对象命名 | `<EntityName>Table` |
| 对象类型 | `Table<Entity, ID>`（不暴露底层实现） |
| 示例 | `object UserTable : Table<User, Long> by SqlxTableAdapter<User, Long>(...)` |
| 实现层 | `neton.database.adapter.sqlx.SqlxTableAdapter<T, ID>`（adapter 包） |

**原则**：
- 对外只暴露 `Table<T, ID>` 接口，组合/委托而非继承
- 无 UserTableImpl 等多余实体，直接 `by SqlxTableAdapter(...)` 实例
- 实现归属 `neton.database.adapter.sqlx`，便于未来换引擎

#### 2.2.2 生成结构

```
@Table("users") data class User
    ↓ KSP
UserMeta          (internal, 元数据)
UserRowMapper     (internal, 行映射)
UserTable         (public, object : Table<User, Long> by SqlxTableAdapter<User, Long>(...))
UserExtensions    (UserUpdateScope + UserTable.update + User.save/delete)
```

**包与命名冻结**：
- SQLx 实现：`neton.database.adapter.sqlx.SqlxTableAdapter`
- 生成物：`object <Entity>Table : Table<Entity, ID>`（public，ID 由主键类型推导）

#### 2.2.3 表级 API

```kotlin
object UserTable : Table<User, Long> by SqlxTableAdapter<User, Long>(...)

// Table 接口提供（get/destroy 保留，符合 Laravel 风格）：
UserTable.get(id)                              // 主键查询
UserTable.destroy(id)                          // 按主键删除
UserTable.update(id) { name = x; email = y }   // KSP 生成 mutate 风格
UserTable.query { where { ColumnRef("status") eq 1 } }.list()
UserTable.findAll()
UserTable.count()
UserTable.ensureTable()
UserTable.getOrThrow(id)   // 抛 NotFoundException，HTTP 层可映射 404
UserTable.many(ids)        // 批量按 id 取
UserTable.destroyMany(ids) // 批量删除（含软删语义）
```

#### 2.2.4 AutoStore（legacy，不推荐新项目）

- **主路径**：KSP 生成 `object UserTable : Table<User> by SqlxTableAdapter(...)`，无 AutoStore。
- **AutoStore**：legacy，仅提供最小 CRUD + transaction；不提供 query（均 throw UnsupportedOperationException）。
- **更新 / Query DSL**：由 KSP Table（UserTable.update / UserTable.query）统一提供。

#### 2.2.5 实例级 API

```kotlin
// KSP 生成
suspend fun User.save(): User
suspend fun User.delete(): Boolean
```

### 2.3 Table 接口（Phase 1 冻结）

```kotlin
interface Table<T : Any, ID : Any> {
    // ----- CRUD（id 为泛型 ID） -----
    suspend fun get(id: ID): T?
    suspend fun insert(entity: T): T
    suspend fun update(entity: T): Boolean
    suspend fun save(entity: T): T
    suspend fun destroy(id: ID): Boolean
    suspend fun delete(entity: T): Boolean
    suspend fun exists(id: ID): Boolean
    suspend fun transaction(block: suspend Table<T, ID>.() -> R): R

    // ----- 查询：唯一入口 query { } -----
    fun query(block: QueryScope<T>.() -> Unit): EntityQuery<T>

    // ----- 便捷：单条 / 存在 / 批量 -----
    suspend fun oneWhere(block: PredicateScope<T>.() -> Predicate): T?
    suspend fun existsWhere(block: PredicateScope<T>.() -> Predicate): Boolean
    suspend fun many(ids: Collection<ID>): List<T>
    suspend fun destroyMany(ids: Collection<ID>): Int
}
```

**不暴露** `updateById(id, block)`：更新统一由 KSP 生成的 `UserTable.update(id) { ... }`（强类型）提供。

### 2.4 Table 与 Store 职责边界（定型）

| 层级 | 职责 | 允许 |
|------|------|------|
| **Table** | 表级 CRUD | 单表 get/insert/update/destroy/where/list/count |
| **Store** | 聚合/联查（业务仓库） | JOIN、CTE、复杂 SQL，返回 DTO（如 UserWithRoles） |
| **SqlRunner** | 底层执行器 | fetchAll/execute，由 adapter 实现 |

**冻结三条**：
1. **Table 不做 JOIN** — 单表 DSL 仅 `query { where { } }`，不出现 JOIN。
2. **Store 允许 JOIN** — 多表联查、聚合对象、复杂 SQL 归属 Store。
3. **Store 不直接依赖 sqlx4k Row** — 使用 `neton.database.api.Row` 抽象（long/string/int 等）。

**推荐写法**：

```kotlin
// 表级（KSP 生成）
object UserTable : Table<User, Long> by SqlxTableAdapter<User, Long>(...)
object RoleTable : Table<Role, Long> by SqlxTableAdapter<Role, Long>(...)
object UserRoleTable : Table<UserRole, Long> by SqlxTableAdapter<UserRole, Long>(...)

// 聚合 Store（手写，构造注入 SqlRunner）
class UserStore(private val db: SqlRunner) : SqlRunner by db {
    suspend fun getWithRoles(userId: Long): UserWithRoles? {
        val sql = """
            SELECT u.id, u.name, u.email, r.id AS role_id, r.name AS role_name
            FROM users u
            LEFT JOIN user_roles ur ON ur.user_id = u.id
            LEFT JOIN roles r ON r.id = ur.role_id
            WHERE u.id = :uid
        """.trimIndent()
        val rows = fetchAll(sql, mapOf("uid" to userId))
        if (rows.isEmpty()) return null
        val first = rows.first()
        val user = User(id = first.long("id"), name = first.string("name"), ...)
        val roles = rows.mapNotNull { r ->
            r.longOrNull("role_id")?.let { Role(id = it, name = r.string("role_name")) }
        }.distinctBy { it.id }
        return UserWithRoles(user, roles)
    }
}

// 调用：val user = UserStore(sqlRunner()).getWithRoles(1)
```

---

## 三、Query DSL

### 3.1 设计目标（必须满足）

#### 1️⃣ 极简人体工程学

```kotlin
UserTable.query { where { ColumnRef("status") eq 1 } }.list()
```

#### 2️⃣ 强类型

- `ColumnRef("age") gt 18`（where 块内使用 ColumnRef 与 PredicateScope）

#### 3️⃣ 不暴露 SQLx

用户永远不知道底层是 sqlx4k / jdbc / sqlite / pg。

#### 4️⃣ 零对象创建负担

Query 是轻量 struct（builder），不是 ORM Session。

#### 5️⃣ 90% CRUD 场景一行解决

### 3.2 最终 API 预览（完整使用形态）

#### 查询

**唯一入口**：`query { where { } }`。where 块内使用 `ColumnRef` 与 `PredicateScope` 的 `all`、`and`、`or` 等。

**基础：**

```kotlin
UserTable.get(id)           // 主键查询
UserTable.query { where { all() } }.list()
UserTable.count()
```

**where：**

```kotlin
UserTable.query { where { ColumnRef("status") eq 1 } }.list()
```

**多条件：**

```kotlin
UserTable.query {
    where { and(ColumnRef("status") eq 1, ColumnRef("age") gt 18) }
}.list()
```

**like：**

```kotlin
UserTable.query { where { ColumnRef("name") like "%jack%" } }.list()
```

**orderBy + limitOffset：**

```kotlin
UserTable.query {
    where { ColumnRef("status") eq 1 }
    orderBy(ColumnRef("age").desc())
    limitOffset(20, 0)
}.list()
```

**分页：**

```kotlin
UserTable.query { where { ColumnRef("status") eq 1 } }.page(1, 20)
// 返回：Page<User>（items, total, page, size, totalPages）
```

**单条 / exists：**

```kotlin
UserTable.oneWhere { ColumnRef("email") eq email }
UserTable.existsWhere { ColumnRef("email") eq email }
```

#### 删除（按 id / 实例）

```kotlin
UserTable.destroy(id)       // 按主键删除一条
user.delete()               // 实例删除
```

#### 定型 API（KSP 生成）

```kotlin
UserTable.get(id)                           // 主键查询
UserTable.destroy(id)                       // 按 id 删除
UserTable.update(id) { name = x; email = y }  // mutate 风格：lambda 内直接赋值，copy 由 KSP 内部生成
UserTable.query { where { } }.list() / .page()
user.save()
user.delete()
```

**按 id 更新（mutate 风格）**：KSP 为每个实体生成 `XxxUpdateScope`（仅非 id 的 var 属性），`UserTable.update(id) { block: XxxUpdateScope.() -> Unit }` 内部实现为：取当前实体 → 构造 Scope(initial) → 执行 block → `current.copy(...)` → 保存并返回。

### 3.3 核心 DSL 设计（类型结构）

#### 1️⃣ EntityQuery（query { } 返回）

```kotlin
interface EntityQuery<T : Any> {
    suspend fun list(): List<T>
    suspend fun count(): Long
    suspend fun page(page: Int, size: Int): Page<T>
    fun select(vararg columnNames: String): ProjectionQuery
}
```

#### 2️⃣ QueryScope（query { } 块内）

```kotlin
class QueryScope<T>(meta: QueryMeta<T>) {
    fun where(block: PredicateScope.() -> Predicate)
    fun orderBy(vararg os: Ordering)
    fun select(vararg cols: ColumnRef)
    fun limitOffset(limit: Int, offset: Int)
    fun withDeleted()
}
```

#### 3️⃣ PredicateScope（where { } 块内）

```kotlin
class PredicateScope {
    fun all(): Predicate
    fun and(vararg ps: Predicate): Predicate
    fun or(vararg ps: Predicate): Predicate
    fun whenPresent(v: V?, block: (V) -> Predicate): Predicate
    fun whenNotBlank(v: String?, block: (String) -> Predicate): Predicate
    fun whenNotEmpty(v: Collection<V>?, block: (Collection<V>) -> Predicate): Predicate
}
```

#### 4️⃣ ColumnRef 与运算符

```kotlin
infix fun ColumnRef.eq(v: Any?): Predicate
infix fun ColumnRef.gt(v: Any?): Predicate
infix fun ColumnRef.like(v: String): Predicate
fun ColumnRef.asc(): Ordering
fun ColumnRef.desc(): Ordering
```

### 3.4 KSP 生成结构（关键）

每个 Entity 生成 **UserTable**（委托 SqlxTableAdapter）与 **UserExtensions**（UserUpdateScope + 实例级扩展）：

```kotlin
object UserTable : Table<User, Long> by SqlxTableAdapter<User, Long>(...)

class UserUpdateScope(initial: User) {
    var name: String
    var email: String
    var status: Int
    var age: Int
    init { name = initial.name; email = initial.email; ... }
}

suspend fun UserTable.update(id: Long, block: UserUpdateScope.() -> Unit): User?
suspend fun User.save(): User = UserTable.save(this)
suspend fun User.delete(): Boolean = UserTable.delete(this)
```

**业务层写法**：`UserTable.get(id)`、`UserTable.query { where { } }.list()`、`UserTable.update(id) { name = x }`、`user.save()`。

### 3.5 内部实现层级（架构原则）

| 层级 | 内容 |
|------|------|
| **上层（用户 API）** | `UserTable.query { where { } }` |
| **中层（Query DSL）** | `EntityQuery`、`Predicate`、`ColumnRef`、`QueryScope` |
| **底层（驱动）** | `SqlxTableAdapter`、`SqlBuilder`、`Dialect` |

**只有底层依赖 SQLx。**

⭐ **Query 层 = 纯抽象**  
未来若要换 jdbc / native sqlite / postgres driver，可零改动。

### 3.6 查询类型与 Page

**query { }** 返回 **EntityQuery<T>**；调用 **select(...)** 后变为 **ProjectionQuery**，返回行数据，避免同一链上 `list()` 既返回 `T` 又返回 `Row` 的类型分叉。

#### Page 类型（冻结）

- 分页页码：**从 1 开始**（符合后台习惯）。

```kotlin
data class Page<T>(
    val items: List<T>,
    val total: Long,
    val page: Int,   // 从 1 开始
    val size: Int
) {
    val totalPages: Long get() = if (size > 0) (total + size - 1) / size else 0L
}
```

#### EntityQuery 与 ProjectionQuery（冻结）

```kotlin
interface EntityQuery<T : Any> {
    suspend fun list(): List<T>
    suspend fun count(): Long
    suspend fun page(page: Int, size: Int): Page<T>

    /** 指定列后变为投影查询，返回 Row，不再返回 T。Phase 1 只支持 ColumnRef（如 UserMeta.id），不支持 KProperty 反射 */
    fun select(vararg cols: ColumnRef): ProjectionQuery
}

interface ProjectionQuery {
    suspend fun rows(): List<Row>
    suspend fun count(): Long
    suspend fun page(page: Int, size: Int): Page<Row>
}
```

- `count()` 与当前 where 完全一致，只发 `SELECT COUNT(*) ... WHERE ...`。
- **orderBy** 最小能力（冻结）：支持 `.orderBy(UserMeta.id.desc())`、`.orderBy(UserMeta.name.asc())`，以及 vararg 多列排序；Phase 1 只支持 ColumnRef（UserMeta），不要求 KProperty 反射、不要求复杂排序 DSL。

### 3.7 条件可选（PredicateScope 内）

在 **where { }** 内部使用，值为 null/空时**不**追加条件（不生成 `= null`）。

```kotlin
// 语义：value 非 null 时才加 (UserMeta.status eq value)
inline fun <T : Any, V> PredicateScope<T>.whenPresent(value: V?, block: (V) -> Predicate): Predicate =
    if (value != null) block(value) else Predicate.True

// 语义：text 非 null 且 isNotBlank 时才加 like
inline fun <T : Any> PredicateScope<T>.whenNotBlank(text: String?, block: (String) -> Predicate): Predicate =
    if (!text.isNullOrBlank()) block(text) else Predicate.True

// 语义：集合非空才加 in
inline fun <T : Any, V> PredicateScope<T>.whenNotEmpty(list: Collection<V>?, block: (Collection<V>) -> Predicate): Predicate =
    if (!list.isNullOrEmpty()) block(list) else Predicate.True
```

示例：

```kotlin
UserTable.query {
    where {
        whenPresent(status) { UserMeta.status eq it }
        whenNotBlank(keyword) { UserMeta.name like "%$it%" }
        whenNotEmpty(ids) { UserMeta.id in it }
    }
    orderBy(UserMeta.id.desc())
}.page(page = 1, size = 20)
```

### 3.8 与目标对比

| 目标 | 是否满足 |
|------|----------|
| Laravel 手感 | ✅ |
| Kotlin 风格 | ✅ |
| 强类型 | ✅ |
| 无字符串 SQL | ✅ |
| 无 Impl 类 | ✅ |
| 不暴露 sqlx | ✅ |
| list / count / page | ✅ |
| 低心智负担 | ✅ |
| 可长期冻结 | ✅ |

---

## 四、架构实现（sqlx4k）

### 4.1 当前架构概览

```
neton-database/
├── api/Store.kt              # 统一 CRUD + QueryBuilder 接口
├── annotations/              # @Table, @Id, @Column (SOURCE)
├── config/                   # TOML 解析、DatabaseConfig
├── core/
│   └── AutoStore.kt          # legacy，委托 DatabaseManager
├── adapter/sqlx/             # SqlxStoreAdapter + SqlxDatabase（主路径）
└── DatabaseExtensions.kt     # database { storeRegistry } DSL
```

### 4.2 设计目标

| 目标 | 含义 |
|------|------|
| **更强** | 生产级连接池、事务、迁移 |
| **更安全** | 参数化 SQL、类型安全映射、无拼接 |
| **更易用** | 保持 Store DSL，与 Neton Config SPI 集成 |
| **性能更好** | 异步 I/O、连接池、预编译语句、KSP 零反射 |

### 4.3 目标架构（纯 sqlx4k）

#### 依赖关系

```
neton-database
  └── sqlx4k-sqlite   // 或 sqlx4k-postgres / sqlx4k-mysql，按需选择
  └── sqlx4k-codegen  // KSP，可选，用于实体 ↔ SQL 生成
  └── neton-core
```

**移除**：自研 MemoryStore、SqliteConnectionFactory、任何非 sqlx4k 的 DB 实现。

#### 目录结构

```
neton-database/
├── api/
│   └── Store.kt              # 保留，高层 API
├── annotations/              # SOURCE，供 KSP 用
├── config/                   # TOML → sqlx4k 连接参数
├── core/
│   └── AutoStore.kt          # legacy，DatabaseManager 仅被 AutoStore 依赖
├── adapter/sqlx/             # SqlxStoreAdapter + SqlxDatabase（主路径）
├── query/                    # Query DSL、QueryRuntime、EntityPersistence
└── DatabaseExtensions.kt
```

#### 数据流

```
UserStore (object 单例，KSP 生成) — 主路径；AutoStore 已 deprecated
    → SqlxStore<User>(sqlxDatabase, UserStatements, UserMapper)
    → sqlx4k: db.execute(stmt) / db.fetchAll(stmt, mapper)
```

- Store 以 **object 单例**形式存在，不每次 `getStore()` 新建
- Statement 由 KSP 生成 `XxxStatements` object，classloader 级共享

### 4.4 核心设计

#### sqlx4k 作为唯一底层

- **SQLite**：开发/测试用 `sqlite::memory:`，生产用 `sqlite://path/to/db`
- **PostgreSQL / MySQL**：通过 sqlx4k-postgres / sqlx4k-mysql
- **Memory**：不再自研，统一用 `sqlite::memory:`

#### 实体映射：KSP + RowMapper

**方案 A（推荐）**：KSP 生成

- 使用 sqlx4k-codegen：`@Table` + expect/actual 生成 `insert()`、`update()`、`delete()` Statement
- 或自研 KSP：扫描 `@Entity`，生成 `UserRowMapper`、CRUD Statement 构建逻辑

**方案 B**：手写 RowMapper

- 每个实体实现 `RowMapper<T>`
- 适合实体少、结构稳定的场景

**原则**：避免运行时反射，优先 KSP 生成。

#### Store 实现：SqlxStore

```kotlin
class SqlxStore<T : Any>(
    private val db: Database,           // sqlx4k PostgreSQL/SQLite/MySQL
    private val tableName: String,
    private val idColumn: String,
    private val mapper: RowMapper<T>,
    private val insertStmt: (T) -> Statement,
    private val updateStmt: (T) -> Statement,
    private val deleteStmt: (T) -> Statement
) : Store<T> {
    override suspend fun findById(id: Any): T? = 
        db.fetchAll(Statement.create("SELECT * FROM $tableName WHERE $idColumn = :id").bind("id", id), mapper).getOrThrow().firstOrNull()
    
    override suspend fun insert(entity: T): Boolean = 
        db.execute(insertStmt(entity)).getOrThrow() > 0
    // ...
}
```

- CRUD 全部走 `Statement` + 绑定参数，无字符串拼接
- 连接、事务由 sqlx4k 管理

#### QueryBuilder：生成 SQL + Statement

- `SqlxQueryBuilder` 内部构建 `WHERE`、`ORDER BY`、`LIMIT` 等
- 输出 `Statement` + 参数列表，交给 `db.fetchAll(stmt, mapper)`
- 禁止手拼 SQL，一律参数化

#### DatabaseManager 与生命周期（legacy）

- **主路径**：`database { storeRegistry = { clazz -> UserStore } }`，直接传入 KSP 生成的 Store，不依赖 DatabaseManager。
- **DatabaseManager**：仅被 AutoStore、RepositoryProcessor 等 legacy 路径使用；`ConnectionFactory` 已移除，仅保留 `storeRegistry` / `getStore` 桥接。

#### 事务

- 使用 sqlx4k 的 `db.transaction { }`
- Store 层可提供 `suspend fun <T> transaction(block: suspend () -> T): T`

### 4.5 安全性

| 措施 | 说明 |
|------|------|
| **参数化查询** | 全部使用 `Statement.bind()`，禁止 `"$var"` 拼接 |
| **类型安全映射** | RowMapper 或 KSP 生成，避免运行时反射 |
| **连接安全** | 密码等敏感信息不落日志 |
| **迁移** | 使用 sqlx4k `db.migrate()` 管理 schema 版本 |

### 4.6 易用性

| 改进 | 说明 |
|------|------|
| **业务 API** | `UserTable.get`、`UserTable.query { where { } }.list()`、`user.save()` 等，Store 不暴露 |
| **主路径** | KSP 生成 `object UserStore : Store<User> by SqlxStoreAdapter`，AutoStore 已 deprecated |
| **@DatabaseConfig** | 通过 Config SPI 注册数据源，与 security/routing 一致 |
| **URI 配置** | 继续支持 `database.conf` 中的 `uri`、`driver` |
| **Memory 模式** | `uri: sqlite::memory:` 作为默认开发配置 |

### 4.7 性能

| 优化 | 说明 |
|------|------|
| **连接池** | 使用 sqlx4k 的 `Pool.Options`（maxConnections、idleTimeout 等） |
| **预编译语句** | 复用 `Statement` 结构，仅变化参数 |
| **异步 I/O** | 全部 suspend，不阻塞线程 |
| **批量操作** | `insertBatch` 使用 sqlx4k 批量 API 或事务内循环 |
| **KSP 生成** | 消除反射，减少运行时开销 |

### 4.8 与 sqlx4k 的映射

| neton-database | sqlx4k |
|----------------|--------|
| User.get(id)（内部 Store.findById） | db.fetchAll(stmt, mapper).firstOrNull() |
| Store.insert | db.execute(entity.insert()) |
| Store.query().fetch() | db.fetchAll(buildSelectStmt(), mapper) |
| 事务 | db.transaction { } |
| 连接池 | Driver.Pool.Options |
| 迁移 | db.migrate(path) |
| Memory | SQLite("sqlite::memory:") |

### 4.9 设计原则（强制）

| 原则 | 说明 |
|------|------|
| **Store 是唯一数据访问抽象** | 业务层只通过 Store 访问数据 |
| **禁止直接使用 sqlx Database** | 业务层不得持有或调用 Database |
| **禁止运行时反射** | 实体映射用 KSP 或手写 RowMapper |
| **禁止拼接 SQL** | 一律参数化 Statement |
| **单一实现** | 只有 SqlxStore，无 memory/sqlite 多套 |
| **Store 必须无状态（stateless）** | 不得在 Store 内缓存 entity 或持有 mutable 状态；Store = 纯函数式 + db 代理 |
| **Store 单例化** | 使用 `object UserStore` 而非每次 `getStore()` 新建实例 |

### 4.10 不做的事情

- 不自研数据库驱动
- 不在运行时用反射解析实体
- 不手拼 SQL 字符串
- 不维护多套 Store 实现（memory/sqlite 等），统一为 SqlxStore + 不同 sqlx4k 后端

---

## 五、SqlxStore 内部接口

> **业务层请以 Entity 为中心 API 为准**：`UserTable.get(id)`、`UserTable.destroy(id)`、`UserTable.update(id){ }`、`UserTable.query { where { } }`、`user.save()`、`user.delete()`。  
> **主路径**：KSP 生成 `object UserStore : Store<User> by SqlxStoreAdapter`，`database { storeRegistry = { ... } }` 传入，不依赖 DatabaseManager。  
> 本节为 **Store 内部实现与设计原则** 参考，不暴露 Repository/Impl。

### 5.1 长期规范（铁律）

| 规则 | 表述 |
|------|------|
| **Store 无状态 + 线程安全** | `Store MUST be stateless and thread-safe.` `Store MUST NOT hold mutable state or cache entities.` |
| **SQL 编译期生成** | `All SQL must be compile-time generated by KSP.` `Manual string concatenation SQL is forbidden.` |
| **唯一 Store 实现** | `SqlxStore is the only official Store implementation.` `Custom Store implementations are not supported.` 缓存/多数据源应作为 Store 的包装层，而非替代实现。 |

### 5.2 核心 API 草图

#### Store 接口（保持 + 扩展）

```kotlin
interface Store<T : Any> {
    // ===== 基础 CRUD =====
    suspend fun findById(id: Any): T?
    suspend fun findAll(): List<T>
    suspend fun insert(entity: T): T
    suspend fun update(entity: T): Boolean
    suspend fun save(entity: T): T
    suspend fun delete(entity: T): Boolean
    suspend fun deleteById(id: Any): Boolean
    suspend fun count(): Long
    suspend fun exists(id: Any): Boolean
    
    // ===== Batch API（新增）======
    suspend fun insertBatch(entities: List<T>): Int
    suspend fun updateBatch(entities: List<T>): Int
    suspend fun saveAll(entities: List<T>): List<T>
    
    // ===== Query DSL =====
    fun query(): QueryBuilder<T>
    
    // ===== 事务 =====
    suspend fun <R> transaction(block: suspend Store<T>.() -> R): R
}
```

#### ActiveRecord 风格扩展（语法糖）

```kotlin
// 实体基类（可选，给需要 Active Record 体验的实体用）
abstract class Entity<T : Any> {
    abstract val id: Any?
    
    suspend fun save(): T = store<T>().save(this as T)
    suspend fun delete(): Boolean = store<T>().delete(this as T)
    suspend fun refresh(): T? = id?.let { store<T>().findById(it) }
    
    protected fun store(): Store<T> = ...  // legacy：主路径使用 KSP UserStore，不继承 Entity
    protected abstract fun entityClass(): KClass<T>
}

// 或通过扩展函数（不改实体继承）
suspend fun <T : Any> T.save(store: Store<T>): T = store.save(this)
suspend fun <T : Any> T.delete(store: Store<T>): Boolean = store.delete(this)

// 定型 API（KSP 生成，业务层只写这些）
UserTable.get(id)
UserTable.destroy(id)
UserTable.update(id) { name = x; email = y }  // mutate 风格，KSP 生成 XxxUpdateScope，copy 在内部
UserTable.query { where { } }.list()
user.save()
user.delete()
```

**当前规范**：不暴露 Store/Repository，KSP 生成 Companion 与实例扩展。

### 5.3 Statement 缓存（静态化）

#### KSP 生成 Statements object（推荐）

```kotlin
// KSP 生成 - classloader 级共享，零实例分配
object UserStatements {
    val selectById = Statement.create("SELECT * FROM users WHERE id = :id")
    val selectAll = Statement.create("SELECT * FROM users")
    val countAll = Statement.create("SELECT COUNT(*) FROM users")
    val insert = Statement.create("INSERT INTO users (id, name, age) VALUES (:id, :name, :age)")
    val update = Statement.create("UPDATE users SET name = :name, age = :age WHERE id = :id")
    val deleteById = Statement.create("DELETE FROM users WHERE id = :id")
}
```

#### SqlxStore 引用静态 Statement

```kotlin
// EntityStatements 接口约束
interface EntityStatements {
    val selectById: Statement
    val selectAll: Statement
    val countAll: Statement
    val insert: Statement
    val update: Statement
    val deleteById: Statement
}

// Store 单例化：object 而非每次 new（主路径用 SqlxStoreAdapter + SqlxDatabase.require()）
object UserStore : SqlxStore<User>(
    db = SqlxDatabase.require(),
    statements = UserStatements,
    mapper = UserRowMapper,
    toParams = { mapOf("id" to it.id, "name" to it.name, "age" to it.age) },
    getId = { it.id }
)

class SqlxStore<T : Any>(
    private val db: Database,
    private val statements: EntityStatements,
    private val mapper: RowMapper<T>,
    private val toParams: (T) -> Map<String, Any?>,
    private val getId: (T) -> Any?
) : Store<T> {
    override suspend fun findById(id: Any): T? =
        db.fetchAll(statements.selectById.bind("id", id), mapper).getOrThrow().firstOrNull()
    // ...
}
```

#### 要点

- Statement 在 **object** 中，classloader 级共享
- Store 使用 **object 单例**，主路径不依赖 DatabaseManager，由 storeRegistry 注入
- 由 KSP 按 `@Entity` 生成 `XxxStatements`

### 5.4 Batch API 实现

```kotlin
override suspend fun insertBatch(entities: List<T>): Int {
    if (entities.isEmpty()) return 0
    return db.transaction {
        var count = 0
        for (e in entities) {
            execute(statements.insert.bind(toParams(e))).getOrThrow()
            count++
        }
        count
    }.getOrThrow()
}

override suspend fun updateBatch(entities: List<T>): Int {
    if (entities.isEmpty()) return 0
    return db.transaction {
        var count = 0
        for (e in entities) {
            execute(statements.update.bind(toParams(e))).getOrThrow()
            count++
        }
        count
    }.getOrThrow()
}

override suspend fun saveAll(entities: List<T>): List<T> {
    return db.transaction {
        entities.map { e ->
            val id = getId(e)
            if (id == null || isNew(id)) {
                execute(statements.insert.bind(toParams(e))).getOrThrow()
                e
            } else {
                execute(statements.update.bind(toParams(e))).getOrThrow()
                e
            }
        }
    }.getOrThrow()
}
```

- 批量操作在**单事务**内执行
- 若 sqlx4k 提供 `executeBatch`，可再优化

### 5.5 QueryBuilder 类型安全 DSL（目标形态）

```kotlin
// 用法
val users = UserStore.query {
    where(User::age gt 18)
    and(User::status eq "active")
    orderBy(User::createdAt.desc())
    limit(20)
}.fetch()

// 实现：KProperty1 -> column name
fun <T : Any, V> QueryContext<T>.field(prop: KProperty1<T, V>): TypedFieldRef<T, V>

// 运算符
infix fun <V> TypedFieldRef<T, V>.eq(value: V): QueryCondition
infix fun <V : Comparable<V>> TypedFieldRef<T, V>.gt(value: V): QueryCondition
// ...
```

- 由 KSP 或注解生成 `User::age` → `"age"` 的列名映射
- 避免字符串、保证编译期类型检查

### 5.6 KSP 自动生成 Store（可选）

```kotlin
@Entity("users")
data class User(
    @Id val id: Long = 0,
    val name: String,
    val age: Int
)

// KSP 生成：UserStatements + UserStore
object UserStatements : EntityStatements { /* ... */ }

object UserStore : SqlxStore<User>(
    db = DatabaseManager.require(),
    statements = UserStatements,
    mapper = UserRowMapper,
    toParams = { mapOf("id" to it.id, "name" to it.name, "age" to it.age) },
    getId = { it.id }
)
```

- 用户只需 `@Entity` + data class
- KSP 生成 Statements、Store、RowMapper
- 业务层：`UserTable.get(1)` 或 `UserTable.query { where { } }.list()`（主路径）

### 5.7 接口定型清单

| API | 说明 |
|-----|------|
| `Store.findById/findAll` | 保留 |
| `Store.insert/update/delete` | 保留，insert 返回 T（含生成 id） |
| `Store.save` | 保留，upsert 语义 |
| `Store.insertBatch/updateBatch/saveAll` | 新增 |
| `Store.query()` | 保留，后续演进为类型安全 DSL |
| `Store.transaction` | 新增 |
| `EntityStatements` | 新增，KSP 生成 `XxxStatements` object |
| `object UserStore : SqlxStore<User>` | 单例 Store |
| `interface UserRepository : Store<User>` | 可选，业务层类型语义 |
| `AutoStore.of<T>()` | legacy，不推荐 |
| `user.save(store)` | 新增，扩展函数 |
| `User.findById(id)` | 新增，伴生对象风格，可选 |

### 5.8 实施优先级

1. **Statement 静态化**：KSP 生成 `XxxStatements` object
2. **Store 单例化**：`object UserStore : SqlxStore<User>`
3. **Batch API**：insertBatch、updateBatch、saveAll
4. **ActiveRecord 扩展**：`save(store)`、`delete(store)` 扩展函数
5. **transaction**：Store 级事务封装
6. **Typed Query DSL**：`where(User::email eq ...)`，KProperty → column，最高 DX 价值
7. **Stream/Flow 查询**：v3 可选，大表场景

---

## 六、Phase 1 执行规范

> **目标**：脚手架能落地的「底座」——缺一不可。  
> **验收闭环**：用 Postgres/MySQL 跑通「后台列表页」：分页 + 可选筛选 + 软删 + AutoFill。  
> **命名**：统一用 Neton 风格。

### 6.1 前置结论（冻结）

#### 数据库支持策略

| 数据库 | 策略 | 说明 |
|--------|------|------|
| **PostgreSQL** | P0，参考实现/默认 | 优先保证行为一致、测试覆盖 |
| **MySQL** | P0，必须同批支持 | 中国生态现实 |
| **SQLite** | 可选保留 | 仅用于 demo / local / CI；脚手架默认不用；若维护成本大可后续移除 |

- 方言层：`Dialect`（Postgres / MySQL / SQLite optional）
- 占位符：Postgres `$1,$2...`，MySQL `?`
- **分页语义**：统一为 limit + offset；SQL 语法由 Dialect 输出（PG: `LIMIT x OFFSET y`；MySQL: `LIMIT y, x`）
- 时间/布尔类型：冻结映射规则，避免边缘 bug

**Phase 1 方言边界（冻结）**：仅保证分页语义（limit+offset）、`LIKE`、`IN`、`COUNT(*)`、基础比较运算在 PG/MySQL 一致；不做复杂 JSON/ARRAY/RETURNING 等差异处理，留 P2。

#### 命名冻结表

| 能力 | 命名 | 说明 |
|------|------|------|
| 查询入口 | `query { }` | 构造查询，内含 where / orderBy / select |
| 列表 | `.list()` | 取列表 |
| 分页 | `.page(page, size)` | 返回 `Page<T>` |
| 计数 | `.count()` | 与 where 一致，走 `SELECT COUNT(*)` |
| 单条 | `oneWhere { }` | 单条件/多条件返回一条 |
| 存在 | `existsWhere { }` | 条件是否存在 |
| 批量 get | `many(ids)` | 批量按 id 取 |
| 批量删除 | `destroyMany(ids)` | 批量删除（含软删语义） |
| 条件可选 | `whenPresent(value) { field eq it }` | 值非 null 才加条件 |
| 条件可选 | `whenNotBlank(text) { field like "%$it%" }` | 非空字符串才 like |
| 条件可选 | `whenNotEmpty(list) { field in it }` | 非空集合才 in |
| 投影 | `select(prop1, prop2)` | 指定列，避免 `SELECT *` |
| 软删 | `destroy(id)` | 行为由 `@SoftDelete` 决定：UPDATE 或 DELETE |
| 审计 | `@AutoFill` | 自动填 createdAt/updatedAt/createdBy/updatedBy |

**保留不动**：`get(id)`、`destroy(id)`、`save(entity)`、`update(entity)`、`exists(id)`、`transaction { }`。

#### 主键与批量类型

- **`Table<T, ID : Any>` 泛型主键**。ID 类型由实体主键字段决定（如 `Long`、`String`、`UUID`）。
- `get(id: ID)`, `destroy(id: ID)`, `exists(id: ID)` — id 类型为泛型 ID
- `many(ids: Collection<ID>)`, `destroyMany(ids: Collection<ID>)` — 批量 API 与主键类型一致
- **Phase 1 脚手架默认主键类型：`Long`**。KSP 从实体的 `@Id` 字段推导 ID 类型，常见为 Long。

### 6.2 Phase 1（P0）能力清单

| 编号 | 能力 | 验收标准 |
|------|------|----------|
| **P0-1** | PostgreSQL + MySQL 支持 | 同一套 Table/Query 在 Postgres、MySQL 均可运行；Dialect + 占位符 + 分页 + 类型映射冻结 |
| **P0-2** | where DSL 打通 | `query { [where { };] orderBy(...) }.list()/.page()/.count()` 全链路可用；where 可选；count 为真 `COUNT(*)` |
| **P0-3** | @SoftDelete | destroy → UPDATE；所有 SELECT 默认加 `deleted = ?`（参数绑定 false）；可逃逸查询已删（如 `withDeleted { }`） |
| **P0-4** | @AutoFill | insert/update 自动填 createdAt/updatedAt/createdBy/updatedBy；提供注入点取当前用户 |
| **P0-5** | 条件可选 | whenPresent / whenNotBlank / whenNotEmpty 在 where 块内可用 |
| **P0-6** | SELECT 指定列 | `select(prop1, prop2)` 得到 ProjectionQuery，用 `.rows()` / `.page()` 取 `List<Row>` / `Page<Row>` |
| **P0-7** | count 真实现 | 与 where 完全一致，仅发 `SELECT COUNT(*)`，禁止 `findAll().size` |

### 6.3 @SoftDelete

#### 脚手架默认（冻结）

- 注解名：`@SoftDelete`（字段级）。
- **Phase 1 只支持一套「脚手架默认」**，不做多种类型混用：
  - **deleted: Boolean**，`false` = 未删除。
  - **deletedAt: Long?**（可选），软删时填 epoch millis。
- 默认过滤语义：**WHERE ... AND deleted = ?**（参数绑定 false，Phase 1 全部走参数绑定，不拼 literal；MySQL tinyint(1) 由驱动正确映射）。其他软删字段类型留 v2.2 扩展。

#### 行为（冻结）

| 操作 | 有 @SoftDelete | 无 @SoftDelete |
|------|----------------|----------------|
| `destroy(id)` | `UPDATE t SET deleted = true [, deletedAt = ?] WHERE id = ?` | `DELETE FROM t WHERE id = ?` |
| 所有 SELECT（get/query/oneWhere 等） | 自动追加 `AND deleted = ?`（参数绑定 false） | 不追加 |
| 逃逸 | `withDeleted { query { }.list() }` 可查已删 | — |

- **SoftDelete 条件注入位置（冻结）**：注入发生在 **QueryBuilder 构建 SQL 阶段**，不写在 PredicateScope 内，避免污染用户条件。最终 SQL 形态为 `WHERE (user_conditions) AND deleted = ?`（参数绑定 false），软删条件始终位于用户条件之后、以 AND 形式追加。Phase 1 建议全部走参数绑定，不拼 literal。
- **withDeleted**：为 **QueryBuilder 层级的开关**（非 Predicate 层），用于逃逸时跳过上述注入。
- destroy 时由 Adapter 走 UPDATE 分支。

### 6.4 @AutoFill

#### 脚手架默认字段与类型（冻结）

- 注解：`@AutoFill(on = INSERT | INSERT_UPDATE, value = NOW | CURRENT_USER)`。
- **字段名与类型（v1 只支持这一套）**：
  - **createdAt: Long**（epoch millis）
  - **updatedAt: Long**（epoch millis）
  - **createdBy: Long?**
  - **updatedBy: Long?**
- 时间统一用 **epoch millis（Long）**，避免 PG/MySQL 时间类型与时区差异；Phase 1 求稳。

#### 行为（冻结）

| 操作 | 填充 |
|------|------|
| insert | createdAt, updatedAt, createdBy, updatedBy |
| update | updatedAt, updatedBy |

- 非 HTTP 场景：允许不注入当前用户（createdBy/updatedBy 可为空或由调用方显式传）。

#### 注入点

- 提供 `AutoFillProvider` 或等价接口，由应用绑定「当前用户 ID」（如从 NetonContext / Identity 取），类型与 createdBy/updatedBy 一致（Long）。

### 6.5 SELECT 指定列

- 在 **query { }** 内调用 `select(UserMeta.id, UserMeta.name)` 后，返回类型变为 **ProjectionQuery**。Phase 1 只支持 ColumnRef 版本（如 UserMeta.id），不支持 KProperty 反射版本（或标为 P2）。
- 生成 SQL：`SELECT id, name FROM users WHERE ...`，禁止该路径下 `SELECT *`。
- 取数据用 **`.rows(): List<Row>`**，分页用 **`.page(page, size): Page<Row>`**；不与 EntityQuery 的 `.list(): List<T>` 混用，类型自洽。

### 6.6 最终验收闭环（Phase 1 完成标准）

以下用 **PostgreSQL 或 MySQL** 跑通即视为 Phase 1 达标：

1. **后台列表页**
   - `GET /users?page=1&size=20&status=1&keyword=tom`
   - 实体列表：`UserTable.query { where { ... }; orderBy(UserMeta.id.desc()) }.page(1, 20)` → `Page<User>`。
   - 指定列列表：`UserTable.query { where { ... }; orderBy(UserMeta.id.desc()); select(UserMeta.id, UserMeta.name, UserMeta.status) }.page(1, 20)` → `Page<Row>`（ProjectionQuery）。
   - 返回：items、total（count）、page（从 1 开始）、size、totalPages。

2. **删除**
   - `destroy(id: ID)` 对带 `@SoftDelete` 的表执行软删（UPDATE deleted = true）。

3. **更新**
   - `update(entity)` 时，`updatedAt` / `updatedBy` 由 @AutoFill 自动填充（类型 Long/Long?）。

4. **count**
   - 列表与 total 使用同一 where 条件，total 来自 `query { ... }.count()`，且为 `SELECT COUNT(*)`。

### 6.7 Phase 1 实现层结构

保持 Neton 风格：少抽象、可维护、便于 debug。实现落点稳定在 4 个核心组件。

#### 四层总结构

```
UserTable.query { ... }  →  QueryAst（纯数据结构）
                          →  SqlBuilder + Dialect  →  BuiltSql(sql, args)
                          →  SqlxTableAdapter      →  list() / count() / page() / rows()
```

| 层级 | 职责 |
|------|------|
| **Query AST** | 纯数据结构，描述 query；可打印便于 debug |
| **Dialect** | 占位符、标识符 quoting、分页语法差异 |
| **SqlBuilder** | AST → SQL 字符串 + 参数列表 |
| **SqlxTableAdapter** | 执行 SQL、映射结果，不膨胀为巨型类 |

#### Query AST（Phase 1 最小形态）

```kotlin
data class QueryAst<T : Any>(
    val table: TableMeta,
    val where: Predicate? = null,           // 可空，无 where 则不生成 WHERE
    val orderBy: List<Ordering> = emptyList(),
    val limit: Int? = null,
    val offset: Int? = null,
    val projection: List<ColumnRef> = emptyList(),  // 空 = SELECT *
    val includeDeleted: Boolean = false              // withDeleted 开关
)

data class Ordering(val column: ColumnRef, val dir: Dir)  // ASC / DESC
data class ColumnRef(val name: String)  // 实际 SQL 列名，由 KSP TableMeta/UserMeta 提供
```

**Predicate**（与现有 PredicateScope 对应）：Phase 1 最小集——True、And(list)、Or(list)（可选）、Eq/Like/In、Gt/Lt/Ge/Le；whenPresent 系列返回 `Predicate.True`，SqlBuilder 阶段将 True 视为无条件。ColumnRef 与列名映射由 KSP 生成的 EntityMeta 提供。

#### SoftDelete 注入落点

- 注入**不**写在 PredicateScope，写在 **SqlBuilder 使用 AST 之前**。
- 对 QueryAst 做一次 **normalize**：若实体带 @SoftDelete 且 `includeDeleted == false`，则将 `where` 置为 `And(原 where, Eq(deletedColumn, false))`；若无原 where，则 `where = Eq(deletedColumn, false)`。SqlBuilder 将 `Eq(col, false)` 输出为 `column = ?`，args 含 `false`（参数绑定，不拼 literal）。
- 接口建议：`fun QueryAst<T>.normalizeForSoftDelete(meta: EntityMeta): QueryAst<T>`，在 `buildSelect` / `buildCount` 前调用。

#### Dialect 抽象（冻结）

方言层设计决定后续 JOIN / JSON / RETURNING 等能否平稳扩展；Phase 1 冻结接口与 PG/MySQL 实现。

**接口（冻结）**：

```kotlin
interface Dialect {
    val name: String

    /** 占位符 */
    fun placeholder(index: Int): String

    /** 标识符引用（列名 / 表名） */
    fun quoteIdent(name: String): String

    /** LIMIT/OFFSET 语法：入参为已替换占位符的字符串（如 "$1" 或 "?"） */
    fun limitOffset(limit: String?, offset: String?): String

    /** LIKE 表达式（列名与占位符已 quote/placeholder）；若需 ESCAPE 子句由实现决定 */
    fun likeExpression(column: String, placeholder: String): String
}
```

**PostgreSQL**：

```kotlin
object PostgresDialect : Dialect {
    override val name = "postgres"
    override fun placeholder(index: Int) = "$$index"
    override fun quoteIdent(name: String) = "\"$name\""
    override fun limitOffset(limit: String?, offset: String?): String = when {
        limit != null && offset != null -> "LIMIT $limit OFFSET $offset"
        limit != null -> "LIMIT $limit"
        else -> ""
    }
    override fun likeExpression(column: String, placeholder: String) = "$column LIKE $placeholder"
}
```

**MySQL**：

```kotlin
object MySqlDialect : Dialect {
    override val name = "mysql"
    override fun placeholder(index: Int) = "?"
    override fun quoteIdent(name: String) = "`$name`"
    override fun limitOffset(limit: String?, offset: String?): String = when {
        limit != null && offset != null -> "LIMIT $offset, $limit"
        limit != null -> "LIMIT $limit"
        else -> ""
    }
    override fun likeExpression(column: String, placeholder: String) = "$column LIKE $placeholder"
}
```

**⚠️ LIMIT 语法差异（必须遵守）**：MySQL 为 `LIMIT offset, limit`（先 offset 后 limit），PostgreSQL 为 `LIMIT limit OFFSET offset`。SqlBuilder 调用 `dialect.limitOffset(limitPh, offsetPh)` 时传入的占位符顺序与参数列表顺序必须与 Dialect 约定一致，避免分页错乱。

#### SqlBuilder 输出

- 输出类型冻结：`data class BuiltSql(val sql: String, val args: List<Any?>)`。
- WHERE 子句生成时参数按递增编号；`In(list)` 展开为 `IN ($1,$2,...)` 或 `IN (?,?,...)`。
- Phase 1 主键为泛型 ID（Long/String/UUID 等），条件值与参数类型由 Dialect 统一处理。
- LIKE 需做 escape 处理（规范层可注明：Phase 1 至少对 `%`/`_` 做转义，避免注入与误匹配）。

#### SqlxTableAdapter 职责

- 接收 **QueryAst**（或已包装的 EntityQuery/ProjectionQuery 持有 AST）。
- 调用 **SqlBuilder** 得到 `BuiltSql`，再交 sqlx4k 执行。
- **EntityQuery**：`list()` = buildSelect(select *) + 执行 + RowMapper → List<T>；`count()` = buildCount + 执行取 Long；`page()` = 先 count 再 buildSelect(limit/offset)。
- **ProjectionQuery**：`rows()` = buildSelect(projection 列) + 执行 → List<Row>；`page()` 同理。Row 使用 neton 自有轻量接口，不泄漏 sqlx4k Row。

#### page() 执行策略（冻结）

- **Phase 1 明确执行两条 SQL**：先 `COUNT(*)`，再 `SELECT ... LIMIT ? OFFSET ?`。
- 不做窗口函数或 `COUNT(*) OVER()`，留 P2。

#### DSL 层：ColumnRef 与 KSP（推荐）

- **Phase 1 冻结**：select / where / orderBy 仅支持 **ColumnRef**（如 UserMeta.id），不支持 KProperty 反射版本；KProperty 版本若保留则标为 P2。
- **推荐**：由 KSP 生成 **ColumnRef** 与 **UserMeta**，where / select / orderBy 全部走 ColumnRef，无反射（Native 友好）。

**ColumnRef**（泛型可选，Phase 1 至少 name: String）：

```kotlin
class ColumnRef<T : Any, V : Any>(val name: String)
```

**KSP 生成示例**：

```kotlin
object UserMeta {
    val id = ColumnRef<User, Long>("id")
    val name = ColumnRef<User, String>("name")
    val status = ColumnRef<User, Int>("status")
    // ...
}
```

**DSL 写法**：

```kotlin
UserTable.query {
    where {
        UserMeta.status eq 1
        whenPresent(keyword) { UserMeta.name like "%$it%" }
    }
    orderBy(UserMeta.id.desc())
}.page(1, 20)
```

- PredicateScope 内使用 `UserMeta.column` 与 `eq`/`like`/`in` 等组合，生成 Predicate；AST 中只存 ColumnRef.name（或 ColumnRef 本身），SqlBuilder 用 `quoteIdent(column.name)` 生成 SQL。

#### 契约测试：COUNT 与 page().total 一致

**必须**有一条契约测试，保证同一 where 条件下 count 与分页 total 一致，否则将来 count 与 page 条件易分叉：

```kotlin
val page = UserTable.query {
    where { UserMeta.status eq 1 }
}.page(1, 10)

val manualCount = UserTable.query {
    where { UserMeta.status eq 1 }
}.count()

assert(page.total == manualCount)
```

- 实现 Phase 1 时将此测试加入必跑用例；CI 通过作为「count 与 list/page 同源」的验收依据。

### 6.8 Phase 1 实现检查清单

实现者按此清单逐项验收，避免走偏。

| 类别 | 检查项 |
|------|--------|
| **数据库底座** | [ ] PostgreSQL 通过 |
| | [ ] MySQL 通过 |
| | [ ] LIMIT/OFFSET 语法按 Dialect（PG: LIMIT x OFFSET y；MySQL: LIMIT y, x） |
| | [ ] LIKE 统一 |
| | [ ] COUNT(*) 正确（与 where 一致，非 findAll().size） |
| | [ ] 契约测试：同一 where 下 `page().total == count()` |
| **DSL** | [ ] query { } 支持空 where（无 where 时不生成 WHERE 子句） |
| | [ ] whenPresent / whenNotBlank / whenNotEmpty 正确 |
| | [ ] orderBy asc/desc、vararg 多列 |
| | [ ] many(ids) / destroyMany(ids) 的 IN 生成正确占位符（ID） |
| **软删** | [ ] destroy(id) → UPDATE deleted = true（及可选 deletedAt） |
| | [ ] 所有 SELECT 自动过滤 deleted = ?（参数绑定 false，注入在 QueryBuilder 构建阶段，AND 追加） |
| | [ ] withDeleted { } 可逃逸（QueryBuilder 层级开关） |
| **AutoFill** | [ ] insert 自动填 createdAt、updatedAt、createdBy、updatedBy（Long / Long?） |
| | [ ] update 自动填 updatedAt、updatedBy |
| **投影** | [ ] select(...) 返回 ProjectionQuery |
| | [ ] ProjectionQuery.rows() 返回 List<Row> |
| | [ ] EntityQuery.list() 仅返回 List<T>，不返回 Row |
| **类型与入口** | [ ] 主键与批量 API 均为泛型 ID / Collection<ID> |
| | [ ] 无 Table.updateById；更新仅 KSP UserTable.update(id){ } 与 update(entity) |
| | [ ] 唯一条件查询入口为 query { } |

### 6.9 Phase 2 / Phase 3 简述（不展开）

- **Phase 2（P1）**：聚合函数与 groupBy/having、Migration（schema 版本化）、@Version 乐观锁（可选）。
- **Phase 3（P2）**：JOIN DSL 延后；raw SQL 封装（Repository runner）按需。

JOIN 在 Phase 1/2 用「聚合 Store + raw SQL」即可满足脚手架需求。

---

## 七、Contract Tests（语义升级锁死）

| 测试 | 目的 | 验证方式 |
|------|------|----------|
| **生成物 Contract** | KSP 对 @Table 实体必须生成 `object UserTable : Table<User, Long>` | `mvc` 编译通过 + `TableUserContractTest` |
| **禁止回潮** | Store 不实现 Table，无法作为 tableRegistry 返回值 | `Table` 为唯一单表接口；Store 不实现 Table 类型约束 |
| **COUNT 一致性** | 同一 where 条件下 count 与分页 total 一致 | 契约测试：`page().total == query().count()` |

- **Test 1**：`neton-database/commonTest` 中 `TableUserContractTest` 验证 Table 接口契约（get/where 等）。
- **Test 2**：通过约束 A（Store 不实现 Table），编译期天然防止「Store 被当作 Table 使用」。
- **Test 3**：契约测试保证 count 与 list/page 同源，防止未来条件分叉。

---

## 八、冻结约束（必须遵守）

### 8.1 单 DB 与多 DB

- **默认单 DB**：`SqlxDatabase.require()` 单例，KSP 生成 `dbProvider = { SqlxDatabase.require() }`（Table 适配器）
- **多 DB（命名连接/读写分离/多租户）**：留 v3，不在此版实现
- **扩展点已预留**：`SqlxTableAdapter(dbProvider: () -> SQLite = { SqlxDatabase.require() }, ...)`，v3 可传 `{ SqlxDatabase.get("analytics") }` 等，无需重构

### 8.2 SqlxTableAdapter 必须无状态（stateless）

- **不得持有可变状态**
- **不缓存 query 结果**
- **不缓存 entity**
- **仅允许缓存**：prepared statement / SQL 字符串（若需）
- 违反将导致一致性 bug，禁止。

### 8.3 id 类型与强类型

- **Table<T, ID : Any>**：主键为泛型 ID，`get(id: ID)`、`destroy(id: ID)`、`exists(id: ID)`、`many(ids: Collection<ID>)`、`destroyMany(ids: Collection<ID>)` 均为强类型
- **KSP 生成的 Table**：从实体主键字段推导 ID 类型（如 Long、String、UUID），生成 `Table<User, Long>` 等
- **getOrThrow**：`getOrThrow(id: ID)` 泛型扩展，调用处类型推导安全；异常 message 含 id 便于排查

### 8.4 NotFoundException 与 HTTP 404

- **NotFoundException** 位于 `neton.core.http`，继承 `HttpException(HttpStatus.NOT_FOUND)`
- **HTTP 适配器**：catch 到 NotFoundException 时统一映射 404，禁止出现「有的 NotFound 走 500」的分裂

### 8.5 AutoStore 异常文案（便于日志聚合）

- **格式**：`AutoStoreFeatureNotSupported: <method>. Use KSP Table (UserTable.xxx)`
- **示例**：`query` 等均使用此格式，便于日志聚合「哪些项目误用 AutoStore」

### 8.6 ensureTable 行为

- **Table 接口默认**：`ensureTable()` 默认 no-op（空实现）
- **SqlxTableAdapter 实现**：仅当实体存在 DDL 元数据时（如 UserMeta 含列定义）才执行建表
- 用户不得假定 `ensureTable` 必然成功；无 DDL 元数据时可为 no-op 或抛异常

### 8.7 约束 A：Store 的命名空间必须固定为「Aggregate Store」

- **`Table<T, ID>` 是唯一单表 CRUD 入口**；Store 仅承载跨表/聚合语义。
- **Store 不得实现 Table 接口** — Store 不是 CRUD 接口。
- **Store 不应提供 get(id)、query { } 等 Table 通用方法** — 除非明确为聚合查询（如 getWithRoles(id)）。
- **Store 允许且仅允许**：`getWithRoles`、`listUsersWithRoles`、`assignRole`/`removeRole` 等跨表/聚合语义。
- **违反后果**：语义回潮，Table/Store 职责混淆，禁止。

### 8.8 约束 B：KSP 生成物命名规则写死

| 规则 | 值 | 禁止 |
|------|-----|------|
| 表级生成物 | `EntityNameTable`（单数） | `UsersTable`、`UserTables`、`Users` |
| 聚合 Store | `EntityNameStore` 或 `DomainStore` | `UserRepositories`、`UserStoreImpl` |

- **KSP 对 @Table("users") data class User 必须生成**：`object UserTable : Table<User, Long>`
- **禁止复数**：`Users`、`UserTables`。
- **禁止歧义**：`UserTables` 易与「多个 UserTable」混淆。
- **违反后果**：命名漂移、双轨回潮，禁止。

### 8.9 实现来源约束（语义约束）

- **`Table<T>` 仅由 KSP 生成物或框架内部 Adapter 实现。**
- **业务代码不得自行实现 `Table<T>`。**
- 本约束为语义冻结约束，不通过 sealed/interface 机制强制。

### 8.10 长期规范（铁律，3~5 年稳定性的保险）

| 规则 | 表述 |
|------|------|
| **Store 无状态 + 线程安全** | `Store MUST be stateless and thread-safe.` `Store MUST NOT hold mutable state or cache entities.` |
| **SQL 编译期生成** | `All SQL must be compile-time generated by KSP.` `Manual string concatenation SQL is forbidden.` |
| **唯一 Store 实现** | `SqlxStore is the only official Store implementation.` `Custom Store implementations are not supported.` 缓存/多数据源应作为 Store 的包装层，而非替代实现。 |

---

## 九、未来扩展性（预留）

- `UserTable.columns.id` / `UserTable.columns.name` — 可引入 Schema 时使用
- `UserTable.insert { ... }` / `UserTable.batchInsert { ... }`
- `UserTable.indexes` / `UserTable.migrations`

若引入真正的 TableSchema（DDL/列定义），建议单独 `UserSchema` 或 `TableMeta`，不与 Table 混用。

---

## 十、参考实现

- `neton/examples/mvc` — 完整 MVC 示例（users/roles/user_roles + 聚合 Store）
- `neton/neton-ksp/EntityStoreProcessor.kt` — KSP 生成逻辑

---

## 十一、结论与建议

**建议：将本套 API 定为 neton-database 正式规范。**

然后：

- KSP 生成 UserTable（get / destroy / update / query / save / delete）
- Query 作为唯一 DSL
- Store 退到 internal，不暴露
- 禁止 Repository / Impl，API 以 Entity 为中心

**已落地：**  
query 包（QueryAst、Predicate、ColumnRef、EntityQuery、Page）、KSP 生成 UserTable + XxxUpdateScope + user.save/delete。
