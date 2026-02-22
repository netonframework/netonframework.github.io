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
5. [SqlxTableAdapter 内部接口](#五sqlxtableadapter-内部接口)
6. [Phase 1 执行规范](#六phase-1-执行规范)
7. [Contract Tests](#七contract-tests)
8. [冻结约束](#八冻结约束)

---

## 一、总览

### 1.1 定型 API 总览

| 层级 | 形态 | 示例 |
|------|------|------|
| **实体** | 纯 data class，无 companion | `data class User(...)` |
| **表级入口** | `object &lt;Entity&gt;Table : Table&lt;Entity, ID&gt;` | `object UserTable : Table&lt;User, Long&gt;` |
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
| **neton-database** | `object UserTable : Table&lt;User, Long&gt;` |

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
| 对象命名 | `&lt;EntityName&gt;Table` |
| 对象类型 | `Table&lt;Entity, ID&gt;`（不暴露底层实现） |
| 示例 | `object UserTable : Table&lt;User, Long&gt; by SqlxTableAdapter&lt;User, Long&gt;(...)` |
| 实现层 | `neton.database.adapter.sqlx.SqlxTableAdapter&lt;T, ID&gt;`（adapter 包） |

**原则**：
- 对外只暴露 `Table&lt;T, ID&gt;` 接口，组合/委托而非继承
- 无 UserTableImpl 等多余实体，直接 `by SqlxTableAdapter(...)` 实例
- 实现归属 `neton.database.adapter.sqlx`，便于未来换引擎

#### 2.2.2 生成结构

```
@Table("users") data class User
    ↓ KSP
UserMeta          (internal, 元数据 + 类型安全 ColumnRef 属性)
UserRowMapper     (internal, 行映射)
UserTable         (public, object : Table<User, Long> by SqlxTableAdapter<User, Long>(...))
UserExtensions    (UserUpdateScope + UserTable.update + User.save/delete)
```

KSP 自动检测：
- **`@SoftDelete`** — 在生成的 `SqlxTableAdapter` 中传入 `softDeleteConfig` 参数，启用自动软删过滤
- **`@Id`** — 推导主键列名与 ID 类型
- **`@Column`** — 自定义列名映射

生成的 `UserMeta` 仅包含元数据，不暴露 ColumnRef 属性（用户层统一使用 `Entity::property` 列引用）：

```kotlin
internal object UserMeta : EntityMeta<User> {
    override val table = "users"
    override val idColumn = "id"
    override val columns = listOf("id", "name", "email", "status", "deleted")
    override val columnTypes = mapOf(...)
}
```

业务层使用 `User::status eq 1` 而非 `ColumnRef("status") eq 1`（见 §3.3.5 KProperty1 DSL 冻结规则）。

**包与命名冻结**：
- SQLx 实现：`neton.database.adapter.sqlx.SqlxTableAdapter`
- 生成物：`object &lt;Entity&gt;Table : Table&lt;Entity, ID&gt;`（public，ID 由主键类型推导）

#### 2.2.3 表级 API

```kotlin
object UserTable : Table<User, Long> by SqlxTableAdapter<User, Long>(...)

// Table 接口提供（get/destroy 保留，符合 Laravel 风格）：
UserTable.get(id)                              // 主键查询
UserTable.destroy(id)                          // 按主键删除
UserTable.update(id) { name = x; email = y }   // KSP 生成 mutate 风格
UserTable.query { where { User::status eq 1 } }.list()
UserTable.findAll()
UserTable.count()
UserTable.ensureTable()
UserTable.getOrThrow(id)   // 抛 NotFoundException，HTTP 层可映射 404
UserTable.many(ids)        // 批量按 id 取
UserTable.destroyMany(ids) // 批量删除（含软删语义）
```

#### 2.2.4 AutoStore（legacy，不推荐新项目）

- **主路径**：KSP 生成 `object UserTable : Table&lt;User&gt; by SqlxTableAdapter(...)`，无 AutoStore。
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

### 2.4 应用分层架构（v1 冻结）

> Store 层废除。Table 已升级为完整数据访问层（单表 CRUD + JOIN DSL + typed projection），
> Store 不再需要。详见 [JOIN 查询规范](./database-join.md)。

#### 冻结分层

| # | 层级 | 职责 | 依赖规则 |
|---|------|------|---------|
| 1 | **Controller** | HTTP 端点、DTO 绑定、鉴权注解、参数校验 | 只依赖 Logic，**禁止直接引用 Table** |
| 2 | **Logic**（Service） | 业务用例：聚合/事务/缓存/事件/审计/权限策略 | 依赖 Table（单表 CRUD + JOIN DSL） |
| 3 | **Table** | 数据访问（KSP 生成）：CRUD + query DSL + JOIN DSL + typed projection | 无业务规则 |
| 4 | **Model** | 实体：纯 `@Table data class` | 无依赖 |

#### 硬约束

| 约束 | 规则 | 说明 |
|------|------|------|
| C1 | **Controller 禁止引用 Table** | 防止"Controller 写 SQL"的失控。所有数据操作必须经过 Logic 层 |
| C2 | **Logic 是唯一业务聚合层** | 事务、跨表用例、缓存/锁/审计/事件 全部在此层 |
| C3 | **Table 是唯一数据访问入口** | 不允许 Logic 层直接拼 raw SQL。80% 用 DSL，20% 用 `DbContext`（逃生口） |
| C4 | **Model 是纯 data class** | 不含业务方法、不含数据访问代码 |
| C5 | **Logic 只依赖稳定面** | Logic 层只允许依赖 `DbContext`、`Table`、`SelectBuilder`（NetonSQL）。**禁止依赖 `adapter.sqlx.*`**（internal 包从模块边界阻断） |
| C6 | **DbContext 是唯一 SQL 执行入口** | 所有 SQL 执行必须经过 `DbContext`（或 `TxContext`）。`SqlxDatabase.require()` 只存在于 adapter 内部（internal），Logic/Controller 禁止直接调用 |
| C7 | **事务只有 `transaction { }` 一种写法** | `DbContext.transaction { }` 是唯一事务入口。禁止 `begin()` / `commit()` / `rollback()` 暴露给业务层 |

### 2.5 判定规则与反模式

#### 判定规则

| 场景 | 正确归属 | 说明 |
|------|----------|------|
| 单表筛选 + 分页 + DTO 映射 | Logic → Table | 典型读模型查询 |
| 多对多联表查询（如 UserWithRoles） | Logic → Table（JOIN DSL） | 不再需要 Store |
| 事务性写入（如创建用户 + 初始化角色） | Logic（transaction 块） | 事务边界在 Logic 层 |
| 领域规则集中（如禁用用户 → 踢下线 + 撤销 token） | Logic | 复合业务操作 |

#### 反模式

- **Controller 直接调用 Table** — 禁止（约束 C1）。即使是简单 CRUD 也必须经过 Logic 层。
- **Logic 直接拼 raw SQL** — 禁止（约束 C3）。SQL 操作通过 Table DSL 或 DbContext。
- **为每个 Table 创建同名 Logic** — 退化成转发器，违反聚合语义。Logic 按业务用例组织，不按表组织。
- **Logic 引用 `adapter.sqlx.*`** — 禁止（约束 C5）。Logic 只依赖 `DbContext`、`Table`、`SelectBuilder`。
- **Logic/Controller 直接调用 `SqlxDatabase.require()`** — 禁止（约束 C6）。连接获取只在 adapter 内部。
- **暴露 `begin()` / `commit()` / `rollback()` 给业务层** — 禁止（约束 C7）。事务只有 `transaction { }` 一种写法。

#### Store 废除路径

| 阶段 | 状态 |
|------|------|
| v1（当前） | Store 废除；Table 升级支持 JOIN DSL；所有聚合逻辑归属 Logic 层 |

#### 推荐目录结构

```
app/src/commonMain/kotlin/
├── controller/
│   └── UserController.kt          # HTTP 端点
├── logic/
│   ├── UserLogic.kt                # 用户业务用例（分页/筛选/CRUD）
│   ├── AuthLogic.kt                # 认证用例（登录/token/权限）
│   └── RoleLogic.kt                # 角色业务用例（分配/撤销/联查）
├── model/
│   ├── SystemUser.kt               # @Table data class
│   ├── Role.kt                     # @Table data class
│   ├── UserRole.kt                 # @Table data class
│   └── dto/
│       ├── UserWithRoles.kt        # 聚合 DTO
│       └── LoginRequest.kt         # 请求 DTO
└── build/generated/ksp/.../
    ├── SystemUserTable.kt          # KSP 生成
    ├── RoleTable.kt                # KSP 生成
    └── UserRoleTable.kt            # KSP 生成
```

#### v1 推荐写法

```kotlin
// Logic 层（手写）— 业务用例
class UserLogic(private val ctx: NetonContext) {

    // 单表分页（直接调 Table）
    suspend fun page(username: String?, status: Int?, page: Int, size: Int): Page<SystemUser> =
        SystemUserTable.query {
            where {
                and(
                    whenNotBlank(username) { SystemUser::username like "%$it%" },
                    whenPresent(status) { SystemUser::status eq it }
                )
            }
            orderBy(SystemUser::createdAt.desc())
        }.page(page, size)

    // 联表查询（v1 JOIN DSL，不再需要 Store）
    suspend fun getWithRoles(userId: Long): Pair<SystemUser, List<Role>>? {
        val (q, U) = from(SystemUserTable)
        val UR = q.leftJoin(UserRoleTable).on { U.id eq it.userId }
        val R  = q.leftJoin(RoleTable).on { UR.roleId eq it.id }

        val rows = q.where(U.id eq userId)
            .select(U.id, U.username, R.id, R.name)
            .fetch()

        return rows.firstOneToMany(
            one = { it.into<SystemUser>() },
            many = { it.intoOrNull<Role>("role_", Role::id) },
            manyKey = { it.id }
        )
    }
}
```

---

## 三、Query DSL

### 3.1 设计目标（必须满足）

#### 1️⃣ 极简人体工程学

```kotlin
UserTable.query { where { User::status eq 1 } }.list()
```

#### 2️⃣ 强类型

- `User::age gt 18`（where 块内使用 KProperty1 与 PredicateScope）

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
UserTable.query { where { User::status eq 1 } }.list()
```

**多条件：**

```kotlin
UserTable.query {
    where { and(User::status eq 1, User::age gt 18) }
}.list()
```

**like：**

```kotlin
UserTable.query { where { User::name like "%jack%" } }.list()
```

**orderBy + limitOffset：**

```kotlin
UserTable.query {
    where { User::status eq 1 }
    orderBy(User::age.desc())
    limitOffset(20, 0)
}.list()
```

**分页：**

```kotlin
UserTable.query { where { User::status eq 1 } }.page(1, 20)
// 返回：Page<User>（items, total, page, size, totalPages）
```

**单条 / exists：**

```kotlin
UserTable.oneWhere { User::email eq email }
UserTable.existsWhere { User::email eq email }
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

#### 5️⃣ KProperty1 DSL（v1 冻结 — 唯一合法列引用方式）

v1 只允许使用 `Entity::property` 作为列引用。`ColumnRef` 操作符为 `internal`，用户不可见。

```kotlin
// 属性引用 → 自动 camelCase → snake_case → ColumnRef
SystemUser::username like "%admin%"   // → ColumnRef("username") like "%admin%"
SystemUser::status eq 1               // → ColumnRef("status") eq 1
SystemUser::createdAt.desc()          // → ColumnRef("created_at").desc()
```

**支持的运算符**：

```kotlin
infix fun KProperty1<*, *>.eq(v: Any?): Predicate
infix fun KProperty1<*, *>.like(v: String): Predicate
infix fun KProperty1<*, *>.`in`(vs: Collection<Any?>): Predicate
infix fun KProperty1<*, *>.gt(v: Any?): Predicate
infix fun KProperty1<*, *>.ge(v: Any?): Predicate
infix fun KProperty1<*, *>.lt(v: Any?): Predicate
infix fun KProperty1<*, *>.le(v: Any?): Predicate
fun KProperty1<*, *>.asc(): Ordering
fun KProperty1<*, *>.desc(): Ordering
```

**实现原理**：`KProperty1.name`（Kotlin/Native stdlib，非反射）→ camelToSnake → `ColumnRef`。

**禁止其他列引用方式（冻结）**：

| 写法 | 状态 | 说明 |
|------|------|------|
| `SystemUser::username` | 唯一合法 | IDE 重构安全、零字符串、编译期类型检查 |
| `SystemUserMeta.username` | 禁止 | Meta 不再生成 ColumnRef 属性 |
| `ColumnRef("username")` | 禁止 | ColumnRef 操作符已设为 internal |
| `SystemUser.username` (companion) | 禁止 | 不要求实体声明 companion object |

**完整使用示例**：

```kotlin
class UserService(private val log: Logger) {
    suspend fun page(page: Int, size: Int, username: String?, status: Int?): PageResponse<UserVO> {
        val query = SystemUserTable.query {
            where {
                and(
                    whenNotBlank(username) { SystemUser::username like "%$it%" },
                    whenPresent(status) { SystemUser::status eq it }
                )
            }
            orderBy(SystemUser::id.desc())
        }
        val result = query.page(page, size)
        // ...
    }
}
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

**query { }** 返回 **EntityQuery&lt;T&gt;**；调用 **select(...)** 后变为 **ProjectionQuery**，返回行数据，避免同一链上 `list()` 既返回 `T` 又返回 `Row` 的类型分叉。

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

    /** 指定列后变为投影查询，返回 Row，不再返回 T */
    fun select(vararg cols: ColumnRef): ProjectionQuery
}

interface ProjectionQuery {
    suspend fun rows(): List<Row>
    suspend fun count(): Long
    suspend fun page(page: Int, size: Int): Page<Row>
}
```

- `count()` 与当前 where 完全一致，只发 `SELECT COUNT(*) ... WHERE ...`。
- **orderBy** 最小能力（冻结）：支持 `.orderBy(User::id.desc())`、`.orderBy(User::name.asc())`，以及 vararg 多列排序。

### 3.7 条件可选（PredicateScope 内）

在 **where { }** 内部使用，值为 null/空时**不**追加条件（不生成 `= null`）。

```kotlin
// 语义：value 非 null 时才加 (User::status eq value)
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
        whenPresent(status) { User::status eq it }
        whenNotBlank(keyword) { User::name like "%$it%" }
        whenNotEmpty(ids) { User::id `in` it }
    }
    orderBy(User::id.desc())
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
├── api/
│   ├── Table.kt              # 统一 CRUD + Query 接口
│   └── DbContext.kt          # raw SQL 执行上下文（Logic 层逃生口）
├── annotations/              # @Table, @Id, @Column (SOURCE)
├── config/                   # TOML 解析、DatabaseConfig
├── core/
│   └── AutoStore.kt          # legacy，委托 DatabaseManager
├── adapter/sqlx/             # SqlxTableAdapter + SqlxDatabase（主路径）
└── DatabaseExtensions.kt     # database { tableRegistry } DSL
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
│   ├── Table.kt              # 统一 CRUD + Query 接口
│   └── DbContext.kt          # raw SQL 执行上下文（Logic 层逃生口）
├── annotations/              # SOURCE，供 KSP 用
├── config/                   # TOML → sqlx4k 连接参数
├── core/
│   └── AutoStore.kt          # legacy，DatabaseManager 仅被 AutoStore 依赖
├── adapter/sqlx/             # SqlxTableAdapter + SqlxDbContext + SqlxDatabase（主路径）
├── query/                    # Query DSL、QueryRuntime、EntityPersistence
└── DatabaseExtensions.kt
```

#### 数据流

```
UserTable (object 单例，KSP 生成) — 主路径；AutoStore 已 deprecated
    → SqlxTableAdapter<User, Long>(sqlxDatabase, UserMeta, UserRowMapper, ...)
    → sqlx4k: db.execute(stmt) / db.fetchAll(stmt, mapper)
```

- Table 以 **object 单例**形式存在，KSP 生成 `object UserTable : Table&lt;User, Long&gt; by SqlxTableAdapter(...)`
- SQL 由 SqlxTableAdapter 内部根据 EntityMeta 动态构建（参数化）

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

- 每个实体实现 `RowMapper&lt;T&gt;`
- 适合实体少、结构稳定的场景

**原则**：避免运行时反射，优先 KSP 生成。

#### Table 实现：SqlxTableAdapter

```kotlin
class SqlxTableAdapter<T : Any, ID : Any>(
    private val dbProvider: () -> Database = { SqlxDatabase.require() },
    private val meta: EntityMeta<T>,
    private val mapper: RowMapper<T>,
    private val toParams: (T) -> Map<String, Any?>,
    private val getId: (T) -> ID?,
    private val softDeleteConfig: SoftDeleteConfig? = null,
    private val autoFillConfig: AutoFillConfig? = null
) : Table<T, ID> {
    override suspend fun get(id: ID): T? = /* 参数化 SELECT WHERE id = ? */
    override suspend fun save(entity: T): T = /* INSERT + 返回生成 id */
    override suspend fun destroy(id: ID): Boolean = /* DELETE 或 UPDATE（软删） */
    // ...
}
```

- CRUD 全部走参数化 SQL，无字符串拼接
- 连接、事务由 sqlx4k 管理

#### QueryBuilder：生成 SQL + Statement

- `SqlxQueryBuilder` 内部构建 `WHERE`、`ORDER BY`、`LIMIT` 等
- 输出 `Statement` + 参数列表，交给 `db.fetchAll(stmt, mapper)`
- 禁止手拼 SQL，一律参数化

#### DatabaseManager 与生命周期（legacy）

- **主路径**：`database { tableRegistry = { clazz -> UserTable } }`，直接传入 KSP 生成的 Table，不依赖 DatabaseManager。
- **DatabaseManager**：仅被 AutoStore 等 legacy 路径使用；`ConnectionFactory` 已移除，仅保留 `tableRegistry` 桥接。

#### 事务

- 使用 sqlx4k 的 `db.transaction { }`
- Store 层可提供 `suspend fun &lt;T&gt; transaction(block: suspend () -> T): T`

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
| **业务 API** | `UserTable.get`、`UserTable.query { where { } }.list()`、`user.save()` 等 |
| **主路径** | KSP 生成 `object UserTable : Table&lt;User, Long&gt; by SqlxTableAdapter(...)`，AutoStore 已 deprecated |
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
| UserTable.get(id) | db.fetchAll(stmt, mapper).firstOrNull() |
| UserTable.save(entity) | db.execute(insertStmt) |
| UserTable.query { }.list() | db.fetchAll(buildSelectStmt(), mapper) |
| 事务 | db.transaction { } |
| 连接池 | Driver.Pool.Options |
| 迁移 | db.migrate(path) |
| Memory | SQLite("sqlite::memory:") |

### 4.9 设计原则（强制）

| 原则 | 说明 |
|------|------|
| **Table 是唯一数据访问抽象** | 业务层通过 Table（单表 CRUD + DSL）和 DbContext（raw SQL 逃生口）访问数据 |
| **禁止直接使用 sqlx Database** | 业务层不得持有或调用 Database |
| **禁止运行时反射** | 实体映射用 KSP 或手写 RowMapper |
| **禁止拼接 SQL** | 一律参数化 Statement |
| **单一实现** | 只有 SqlxTableAdapter，无 memory/sqlite 多套 |
| **Table 必须无状态（stateless）** | 不得在 Table 内缓存 entity 或持有 mutable 状态；Table = 纯函数式 + db 代理 |
| **Table 单例化** | 使用 `object UserTable` 而非每次新建实例 |

### 4.10 不做的事情

- 不自研数据库驱动
- 不在运行时用反射解析实体
- 不手拼 SQL 字符串
- 不维护多套 Table 实现（memory/sqlite 等），统一为 SqlxTableAdapter + 不同 sqlx4k 后端

---

## 五、SqlxTableAdapter 内部接口

> **业务层请以 Entity 为中心 API 为准**：`UserTable.get(id)`、`UserTable.destroy(id)`、`UserTable.update(id){ }`、`UserTable.query { where { } }`、`user.save()`、`user.delete()`。  
> **主路径**：KSP 生成 `object UserTable : Table&lt;User, Long&gt; by SqlxTableAdapter&lt;User, Long&gt;(...)`。
> 本节为 **SqlxTableAdapter 内部实现与设计原则** 参考。

### 5.1 长期规范（铁律）

| 规则 | 表述 |
|------|------|
| **Table 无状态 + 线程安全** | `Table MUST be stateless and thread-safe.` `Table MUST NOT hold mutable state or cache entities.` |
| **SQL 编译期生成** | `All SQL must be compile-time generated by KSP.` `Manual string concatenation SQL is forbidden.` |
| **唯一 Table 实现** | `SqlxTableAdapter is the only official Table implementation.` 缓存/多数据源应作为 Table 的包装层，而非替代实现。 |

### 5.2 SqlxTableAdapter 核心职责

`SqlxTableAdapter&lt;T, ID&gt;` 是 `Table&lt;T, ID&gt;` 接口的唯一官方实现，由 KSP 生成的 `object XxxTable` 通过 `by` 委托使用。

```kotlin
class SqlxTableAdapter<T : Any, ID : Any>(
    private val dbProvider: () -> Database = { SqlxDatabase.require() },
    private val meta: EntityMeta<T>,
    private val mapper: RowMapper<T>,
    private val toParams: (T) -> Map<String, Any?>,
    private val getId: (T) -> ID?,
    private val softDeleteConfig: SoftDeleteConfig? = null,
    private val autoFillConfig: AutoFillConfig? = null
) : Table<T, ID> {
    // CRUD 操作内部构建参数化 SQL，交由 sqlx4k 执行
    // Query DSL 通过 QueryAst → SqlBuilder → BuiltSql → sqlx4k 执行链路
}
```

**关键特性**：
- 无状态：不缓存 entity、不持有可变状态
- 参数化 SQL：全部通过 `Statement.bind()` 绑定参数，禁止字符串拼接
- 软删自动注入：根据 `softDeleteConfig` 在查询阶段自动追加 `AND deleted = ?`
- 审计字段：根据 `autoFillConfig` 在 insert/update 时自动填充时间戳

### 5.3 DbContext（SQL 执行 + 事务唯一入口）

DbContext 是 Logic 层的**唯一 SQL 执行上下文**，封装当前数据源、事务上下文、执行策略。
当 Table DSL 无法覆盖复杂场景（如多表 JOIN、动态 SQL）时，Logic 层通过 DbContext 执行原生参数化 SQL。

```kotlin
interface DbContext {
    /** 执行查询，返回行列表 */
    suspend fun fetchAll(sql: String, params: Map<String, Any?> = emptyMap()): List<Row>

    /** 执行写操作，返回影响行数 */
    suspend fun execute(sql: String, params: Map<String, Any?> = emptyMap()): Long

    /** 唯一事务入口（约束 C7） */
    suspend fun <R> transaction(block: suspend DbContext.() -> R): R
}
```

#### 职责边界（冻结）

| 规则 | 说明 |
|------|------|
| **唯一执行入口** | 所有 SQL 执行必须经过 DbContext（或事务内的 TxContext），禁止绕过直接拿连接/adapter（约束 C6） |
| **SqlxDatabase.require() 仅 adapter 内部** | `SqlxDatabase` 在 `adapter.sqlx` 包内、`internal` 可见性，业务层/Logic 层不可直接调用 |
| **事务只有 `transaction { }`** | 禁止 `begin()` / `commit()` / `rollback()` 暴露给业务层（约束 C7）。与 jOOQ `dsl.transaction { }` 对齐 |
| **未来可扩展** | DbContext 是 interceptor / slow SQL sampling / multi-tenant injection / query cache 的注入点 |

#### 工厂函数收口

```kotlin
// 当前（v1）：全局工厂，internal 可见性
internal fun dbContext(): DbContext = SqlxDbContext

// 未来（v3 multi-source）：从 NetonContext 获取
// val db = ctx.get(DbContext::class)           // 默认数据源
// val db = ctx.get(DbContext::class, "analytics")  // 命名数据源
```

`dbContext()` 全局工厂标记为 **internal**。Logic 层通过构造函数注入 `DbContext`（默认值 `dbContext()`），
为未来 multi-source / transaction-scoped context 预留替换点，不会被全局工厂卡住。

#### 使用方式

```kotlin
class UserLogic(private val db: DbContext = dbContext()) : DbContext by db {

    // raw SQL 逃生口
    suspend fun getWithRoles(userId: Long): UserWithRoles? {
        val rows = fetchAll("SELECT ... FROM users u LEFT JOIN ...", mapOf("uid" to userId))
        // 手动映射
    }

    // 事务（唯一写法）
    suspend fun createWithRoles(user: User, roleIds: List<Long>) {
        db.transaction {
            val saved = UserTable.save(user)
            roleIds.forEach { roleId ->
                UserRoleTable.save(UserRole(null, saved.id!!, roleId))
            }
        }
    }
}
```

**约束**：DbContext 仅在 Logic 层使用，Controller 禁止直接持有 DbContext（约束 C6）。

### 5.4 Batch API 实现

```kotlin
// Table 接口提供批量操作
suspend fun insertBatch(entities: List<T>): Int
suspend fun updateBatch(entities: List<T>): Int
suspend fun saveAll(entities: List<T>): List<T>
```

- 批量操作在**单事务**内执行
- 若 sqlx4k 提供 `executeBatch`，可再优化

### 5.5 接口定型清单

| API | 说明 |
|-----|------|
| `Table.get/findAll` | 主键查询 / 全量查询 |
| `Table.insert/update/delete` | 基础 CRUD，insert 返回 T（含生成 id） |
| `Table.save` | upsert 语义 |
| `Table.destroy(id)` | 按主键删除（含软删语义） |
| `Table.insertBatch/updateBatch/saveAll` | 批量操作 |
| `Table.query { }` | Query DSL 入口 |
| `Table.transaction` | 事务封装 |
| `DbContext.fetchAll/execute` | Logic 层 raw SQL 逃生口 |
| `user.save()` / `user.delete()` | KSP 生成的实例级扩展 |

### 5.6 实施优先级

1. **SqlxTableAdapter 核心 CRUD**：get/save/update/destroy/findAll
2. **Query DSL 打通**：query { where { } }.list() / .page() / .count()
3. **Batch API**：insertBatch、updateBatch、saveAll
4. **ActiveRecord 扩展**：`user.save()`、`user.delete()` 扩展函数
5. **transaction**：Table 级事务封装
6. **DbContext**：Logic 层 raw SQL 逃生口
7. **Stream/Flow 查询**：v3 可选，大表场景

---

## 六、Phase 1 执行规范

> **目标**：脚手架能落地的「底座」——缺一不可。  
> **验收闭环**：用 Postgres/MySQL 跑通「后台列表页」：分页 + 可选筛选 + 软删 + @CreatedAt/@UpdatedAt。  
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
| 分页 | `.page(page, size)` | 返回 `Page&lt;T&gt;` |
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
| 审计 | `@CreatedAt` / `@UpdatedAt` | 自动填 createdAt/updatedAt（epoch millis） |

**保留不动**：`get(id)`、`destroy(id)`、`save(entity)`、`update(entity)`、`exists(id)`、`transaction { }`。

#### 主键与批量类型

- **`Table&lt;T, ID : Any&gt;` 泛型主键**。ID 类型由实体主键字段决定（如 `Long`、`String`、`UUID`）。
- `get(id: ID)`, `destroy(id: ID)`, `exists(id: ID)` — id 类型为泛型 ID
- `many(ids: Collection&lt;ID&gt;)`, `destroyMany(ids: Collection&lt;ID&gt;)` — 批量 API 与主键类型一致
- **Phase 1 脚手架默认主键类型：`Long`**。KSP 从实体的 `@Id` 字段推导 ID 类型，常见为 Long。

### 6.2 Phase 1（P0）能力清单

| 编号 | 能力 | 验收标准 |
|------|------|----------|
| **P0-1** | PostgreSQL + MySQL 支持 | 同一套 Table/Query 在 Postgres、MySQL 均可运行；Dialect + 占位符 + 分页 + 类型映射冻结 |
| **P0-2** | where DSL 打通 | `query { [where { };] orderBy(...) }.list()/.page()/.count()` 全链路可用；where 可选；count 为真 `COUNT(*)` |
| **P0-3** | @SoftDelete | destroy → UPDATE；所有 SELECT 默认加 `deleted = ?`（参数绑定 false）；可逃逸查询已删（如 `withDeleted { }`） |
| **P0-4** | @CreatedAt / @UpdatedAt | insert 自动填 createdAt + updatedAt；update 自动填 updatedAt（epoch millis, UTC） |
| **P0-5** | 条件可选 | whenPresent / whenNotBlank / whenNotEmpty 在 where 块内可用 |
| **P0-6** | SELECT 指定列 | `select(prop1, prop2)` 得到 ProjectionQuery，用 `.rows()` / `.page()` 取 `List&lt;Row&gt;` / `Page&lt;Row&gt;` |
| **P0-7** | count 真实现 | 与 where 完全一致，仅发 `SELECT COUNT(*)`，禁止 `findAll().size` |

### 6.3 @SoftDelete

#### 脚手架默认（冻结）

- 注解名：`@SoftDelete`（字段级）。
- **支持两种字段类型**：
  - **deleted: Boolean**，`false` = 未删除，`notDeletedValue = false`。
  - **deleted: Int**，`0` = 未删除，`notDeletedValue = 0`。
  - **deletedAt: Long?**（可选），软删时填 epoch millis。
- KSP 根据 `@SoftDelete` 标注字段的类型自动推导 `notDeletedValue`：Int/Long → `0`，Boolean → `false`。
- 默认过滤语义：**WHERE ... AND deleted = ?**（参数绑定 `notDeletedValue`，Phase 1 全部走参数绑定，不拼 literal）。

#### 行为（冻结）

| 操作 | 有 @SoftDelete | 无 @SoftDelete |
|------|----------------|----------------|
| `destroy(id)` | `UPDATE t SET deleted = true [, deletedAt = ?] WHERE id = ?` | `DELETE FROM t WHERE id = ?` |
| 所有 SELECT（get/query/oneWhere 等） | 自动追加 `AND deleted = ?`（参数绑定 false） | 不追加 |
| 逃逸 | `withDeleted { query { }.list() }` 可查已删 | — |

- **SoftDelete 条件注入位置（冻结）**：注入发生在 **QueryBuilder 构建 SQL 阶段**，不写在 PredicateScope 内，避免污染用户条件。最终 SQL 形态为 `WHERE (user_conditions) AND deleted = ?`（参数绑定 false），软删条件始终位于用户条件之后、以 AND 形式追加。Phase 1 建议全部走参数绑定，不拼 literal。
- **withDeleted**：为 **QueryBuilder 层级的开关**（非 Predicate 层），用于逃逸时跳过上述注入。
- destroy 时由 Adapter 走 UPDATE 分支。

### 6.4 @CreatedAt / @UpdatedAt（v1 冻结）

#### 注解定义

```kotlin
@Target(AnnotationTarget.PROPERTY)
@Retention(AnnotationRetention.SOURCE)
annotation class CreatedAt   // insert 时自动填充

@Target(AnnotationTarget.PROPERTY)
@Retention(AnnotationRetention.SOURCE)
annotation class UpdatedAt   // insert/update 时自动填充
```

#### 字段类型（冻结）

- 类型：**Long**（epoch millis, UTC）。
- 时间统一用 epoch millis，避免 PG/MySQL 时间类型与时区差异；Phase 1 求稳。

#### 行为（冻结）

| 操作 | 填充字段 |
|------|----------|
| insert | @CreatedAt + @UpdatedAt（均填当前时间） |
| update | @UpdatedAt（填当前时间） |

#### 实体示例

```kotlin
@Table("system_users")
data class SystemUser(
    @Id val id: Long?,
    val username: String,
    @CreatedAt val createdAt: Long = 0,
    @UpdatedAt val updatedAt: Long = 0
)
```

KSP 自动生成 `AutoFillConfig(createdAtColumn = "created_at", updatedAtColumn = "updated_at")`，
`SqlxTableAdapter` 在 insert/update 时自动覆盖对应列值为 `Clock.System.now().toEpochMilliseconds()`。

#### v1 不内建用户审计

- 不内建 `@CreatedBy` / `@UpdatedBy`，不提供默认 actor 语义。
- 若业务需要 createdBy/updatedBy，在应用层自行实现（service 层手动赋值）。

### 6.5 SELECT 指定列

- 在 **query { }** 内调用 `select("id", "name")` 后，返回类型变为 **ProjectionQuery**。
- 生成 SQL：`SELECT id, name FROM users WHERE ...`，禁止该路径下 `SELECT *`。
- 取数据用 **`.rows(): List&lt;Row&gt;`**，分页用 **`.page(page, size): Page&lt;Row&gt;`**；不与 EntityQuery 的 `.list(): List&lt;T&gt;` 混用，类型自洽。

### 6.6 最终验收闭环（Phase 1 完成标准）

以下用 **PostgreSQL 或 MySQL** 跑通即视为 Phase 1 达标：

1. **后台列表页**
   - `GET /users?page=1&size=20&status=1&keyword=tom`
   - 实体列表：`UserTable.query { where { ... }; orderBy(User::id.desc()) }.page(1, 20)` → `Page&lt;User&gt;`。
   - 指定列列表：`UserTable.query { where { ... }; orderBy(User::id.desc()) }.select("id", "name", "status").page(1, 20)` → `Page&lt;Row&gt;`（ProjectionQuery）。
   - 返回：items、total（count）、page（从 1 开始）、size、totalPages。

2. **删除**
   - `destroy(id: ID)` 对带 `@SoftDelete` 的表执行软删（UPDATE deleted = true）。

3. **更新**
   - `update(entity)` 时，`updatedAt` 由 @UpdatedAt 自动填充（类型 Long）。

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
- 接口建议：`fun QueryAst&lt;T&gt;.normalizeForSoftDelete(meta: EntityMeta): QueryAst&lt;T&gt;`，在 `buildSelect` / `buildCount` 前调用。

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

- 输出类型冻结：`data class BuiltSql(val sql: String, val args: List&lt;Any?&gt;)`。
- WHERE 子句生成时参数按递增编号；`In(list)` 展开为 `IN ($1,$2,...)` 或 `IN (?,?,...)`。
- Phase 1 主键为泛型 ID（Long/String/UUID 等），条件值与参数类型由 Dialect 统一处理。
- LIKE 需做 escape 处理（规范层可注明：Phase 1 至少对 `%`/`_` 做转义，避免注入与误匹配）。

#### SqlxTableAdapter 职责

- 接收 **QueryAst**（或已包装的 EntityQuery/ProjectionQuery 持有 AST）。
- 调用 **SqlBuilder** 得到 `BuiltSql`，再交 sqlx4k 执行。
- **EntityQuery**：`list()` = buildSelect(select *) + 执行 + RowMapper → List&lt;T&gt;；`count()` = buildCount + 执行取 Long；`page()` = 先 count 再 buildSelect(limit/offset)。
- **ProjectionQuery**：`rows()` = buildSelect(projection 列) + 执行 → List&lt;Row&gt;；`page()` 同理。Row 使用 neton 自有轻量接口，不泄漏 sqlx4k Row。

#### page() 执行策略（冻结）

- **Phase 1 明确执行两条 SQL**：先 `COUNT(*)`，再 `SELECT ... LIMIT ? OFFSET ?`。
- 不做窗口函数或 `COUNT(*) OVER()`，留 P2。

#### DSL 层：ColumnRef 与 KSP（推荐）

- **v1 冻结**：where / orderBy 统一使用 `Entity::property`（KProperty1）作为列引用。
- `KProperty1.name` → camelToSnake → `ColumnRef`（框架内部转换），无反射（Native 友好）。

**DSL 写法**：

```kotlin
UserTable.query {
    where {
        User::status eq 1
        whenPresent(keyword) { User::name like "%$it%" }
    }
    orderBy(User::id.desc())
}.page(1, 20)
```

- PredicateScope 内使用 `Entity::property` 与 `eq`/`like`/`in` 等组合，框架内部转为 Predicate AST，SqlBuilder 用 `quoteIdent(column.name)` 生成 SQL。

#### 契约测试：COUNT 与 page().total 一致

**必须**有一条契约测试，保证同一 where 条件下 count 与分页 total 一致，否则将来 count 与 page 条件易分叉：

```kotlin
val page = UserTable.query {
    where { User::status eq 1 }
}.page(1, 10)

val manualCount = UserTable.query {
    where { User::status eq 1 }
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
| **@CreatedAt/@UpdatedAt** | [ ] insert 自动填 createdAt、updatedAt（Long，epoch millis UTC） |
| | [ ] update 自动填 updatedAt |
| **投影** | [ ] select(...) 返回 ProjectionQuery |
| | [ ] ProjectionQuery.rows() 返回 List&lt;Row&gt; |
| | [ ] EntityQuery.list() 仅返回 List&lt;T&gt;，不返回 Row |
| **类型与入口** | [ ] 主键与批量 API 均为泛型 ID / Collection&lt;ID&gt; |
| | [ ] 无 Table.updateById；更新仅 KSP UserTable.update(id){ } 与 update(entity) |
| | [ ] 唯一条件查询入口为 query { } |

### 6.9 后续 Phase 简述

- **Phase 2~4（JOIN 查询）**：强类型列引用、Typed Projection、JOIN AST，详见 [JOIN 查询规范](./database-join.md)。
- **执行链与约束**：DbContext 统一执行门面、QueryInterceptor 拦截链，详见 [执行链与约束规范](./database-execution.md)。

---

## 七、Contract Tests（语义升级锁死）

| 测试 | 目的 | 验证方式 |
|------|------|----------|
| **生成物 Contract** | KSP 对 @Table 实体必须生成 `object UserTable : Table&lt;User, Long&gt;` | `mvc` 编译通过 + `TableUserContractTest` |
| **禁止回潮** | Store 不实现 Table，无法作为 tableRegistry 返回值 | `Table` 为唯一单表接口；Store 不实现 Table 类型约束 |
| **COUNT 一致性** | 同一 where 条件下 count 与分页 total 一致 | 契约测试：`page().total == query().count()` |
| **[[sources]] 配置契约** | database/redis/storage 三模块配置解析一致 | 缺 sources / 空 sources / 无 default / duplicate name → fail-fast |

- **Test 1**：`neton-database/commonTest` 中 `TableUserContractTest` 验证 Table 接口契约（get/where 等）。
- **Test 2**：通过约束 A（Store 废除），编译期天然防止「Store 被当作 Table 使用」。
- **Test 3**：契约测试保证 count 与 list/page 同源，防止未来条件分叉。
- **Test 4**：`[[sources]]` 配置契约测试（database / redis / storage 每个模块一份），验证：
  - 缺少 `[[sources]]` → fail-fast with `&lt;module&gt;.conf: missing [[sources]]`
  - 空 `[[sources]]` → fail-fast
  - 无 `default` 数据源 → fail-fast with `&lt;module&gt;.conf: no default source`
  - `name` 重复 → fail-fast with `&lt;module&gt;.conf: duplicate source name '&lt;name&gt;'`
  - 错误消息必须含 `&lt;module&gt;.conf:` 前缀 + 缺失项，三模块保持一致格式

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

- **Table&lt;T, ID : Any&gt;**：主键为泛型 ID，`get(id: ID)`、`destroy(id: ID)`、`exists(id: ID)`、`many(ids: Collection&lt;ID&gt;)`、`destroyMany(ids: Collection&lt;ID&gt;)` 均为强类型
- **KSP 生成的 Table**：从实体主键字段推导 ID 类型（如 Long、String、UUID），生成 `Table&lt;User, Long&gt;` 等
- **getOrThrow**：`getOrThrow(id: ID)` 泛型扩展，调用处类型推导安全；异常 message 含 id 便于排查

### 8.4 NotFoundException 与 HTTP 404

- **NotFoundException** 位于 `neton.core.http`，继承 `HttpException(HttpStatus.NOT_FOUND)`
- **HTTP 适配器**：catch 到 NotFoundException 时统一映射 404，禁止出现「有的 NotFound 走 500」的分裂

### 8.5 AutoStore 异常文案（便于日志聚合）

- **格式**：`AutoStoreFeatureNotSupported: &lt;method&gt;. Use KSP Table (UserTable.xxx)`
- **示例**：`query` 等均使用此格式，便于日志聚合「哪些项目误用 AutoStore」

### 8.6 ensureTable 行为

- **Table 接口默认**：`ensureTable()` 默认 no-op（空实现）
- **SqlxTableAdapter 实现**：仅当实体存在 DDL 元数据时（如 UserMeta 含列定义）才执行建表
- 用户不得假定 `ensureTable` 必然成功；无 DDL 元数据时可为 no-op 或抛异常

### 8.7 约束 A：Store 废除，Logic 层替代

- **`Table&lt;T, ID&gt;` 是唯一数据访问入口**（单表 CRUD + Query DSL + JOIN DSL）。
- **Store 作为框架层概念已废除**。Store 的唯一存在理由（手写 JOIN SQL）已被 NetonSQL v1 JOIN DSL 和 DbContext 取代。
- **跨表/聚合逻辑归属 Logic 层**：`getWithRoles`、`listUsersWithRoles`、`assignRole`/`removeRole` 等用例在 Logic 层实现，通过 Table DSL 或 DbContext 访问数据。
- **Controller 禁止直接引用 Table**（约束 C1），所有数据操作必须经过 Logic 层。

### 8.8 约束 B：KSP 生成物命名规则写死

| 规则 | 值 | 禁止 |
|------|-----|------|
| 表级生成物 | `EntityNameTable`（单数） | `UsersTable`、`UserTables`、`Users` |
| Logic 层 | `EntityNameLogic` 或 `DomainLogic` | `UserStoreImpl`、`UserRepository` |

- **KSP 对 @Table("users") data class User 必须生成**：`object UserTable : Table&lt;User, Long&gt;`
- **禁止复数**：`Users`、`UserTables`。
- **禁止歧义**：`UserTables` 易与「多个 UserTable」混淆。
- **违反后果**：命名漂移、双轨回潮，禁止。

### 8.9 实现来源约束（语义约束）

- **`Table&lt;T&gt;` 仅由 KSP 生成物或框架内部 Adapter 实现。**
- **业务代码不得自行实现 `Table&lt;T&gt;`。**
- 本约束为语义冻结约束，不通过 sealed/interface 机制强制。

### 8.10 约束 C：列引用冻结规则（v1）

- **v1 只允许使用 `Entity::property`（KProperty1）作为列引用。**
- **ColumnRef 操作符（eq/like/gt/ge/lt/le/in/asc/desc）为 `internal`，用户层不可见。**
- **KSP 生成的 Meta 不包含 ColumnRef 属性。**
- **禁止 `ColumnRef("xxx")`、`XxxMeta.xxx`、`Entity.xxx`（companion）等其他列引用方式。**
- **`KProperty1.name` → camelToSnake → `ColumnRef` 为唯一映射路径，由框架内部 `toColumnRef()` 实现。**
- 违反后果：设计分裂，多种列引用风格共存，禁止。

### 8.11 长期规范（铁律，3~5 年稳定性的保险）

| 规则 | 表述 |
|------|------|
| **Table 无状态 + 线程安全** | `Table MUST be stateless and thread-safe.` `Table MUST NOT hold mutable state or cache entities.` |
| **SQL 编译期生成** | `All SQL must be compile-time generated by KSP.` `Manual string concatenation SQL is forbidden.` |
| **唯一 Table 实现** | `SqlxTableAdapter is the only official Table implementation.` 缓存/多数据源应作为 Table 的包装层，而非替代实现。 |

---

## 九、未来扩展性（预留）

- `UserTable.columns.id` / `UserTable.columns.name` — 可引入 Schema 时使用
- `UserTable.insert { ... }` / `UserTable.batchInsert { ... }`
- `UserTable.indexes` / `UserTable.migrations`

若引入真正的 TableSchema（DDL/列定义），建议单独 `UserSchema` 或 `TableMeta`，不与 Table 混用。

---

## 十、参考实现

- `neton/examples/mvc` — 完整 MVC 示例（Controller → Logic → Table → Model）
- `neton/neton-ksp/EntityTableProcessor.kt` — KSP 生成逻辑

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
