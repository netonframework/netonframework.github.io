# Neton Database API Freeze v2

> **状态**：v2 API Freeze  
> **定位**：Entity 纯数据模型 + Table 表级入口，无 companion、无反射、无动态魔法。  
> **原则**：Kotlin Native 友好、IDE 首次打开即友好、语义清晰、可长期维护。  
> **生效**：直接替换 v1（User.Companion 扩展形式），无兼容层。  
> **标签**：No companion — No reflection — Adapter-based — Stateless

---

## 一、定型 API 总览

| 层级 | 形态 | 示例 |
|------|------|------|
| **实体** | 纯 data class，无 companion | `data class User(...)` |
| **表级入口** | `object &lt;Entity&gt;Table : Table&lt;Entity&gt;` | `object UserTable : Table&lt;User&gt;` |
| **表级调用** | `UserTable.get` / `destroy` / `update` / `where` | `UserTable.get(id)` |
| **实例级** | `user.save()` / `user.delete()` | `user.save()` |

---

## 二、实体层（不写 companion）

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

---

## 三、KSP 生成

### 3.1 生成对象命名与类型

| 规则 | 值 |
|------|-----|
| 对象命名 | `&lt;EntityName&gt;Table` |
| 对象类型 | `Table&lt;Entity&gt;`（不暴露底层实现） |
| 示例 | `object UserTable : Table&lt;User&gt; by SqlxTableAdapter(...)` |
| 实现层 | `neton.database.adapter.sqlx.SqlxTableAdapter&lt;T&gt;`（adapter 包） |

**原则**：
- 对外只暴露 `Table&lt;T&gt;` 接口，组合/委托而非继承
- 无 UserTableImpl 等多余实体，直接 `by SqlxTableAdapter(...)` 实例
- 实现归属 `neton.database.adapter.sqlx`，便于未来换引擎

### 3.2 生成结构

```
@Table("users") data class User
    ↓ KSP
UserMeta          (internal, 元数据)
UserRowMapper     (internal, 行映射)
UserTable         (public, object : Table<User> by SqlxTableAdapter(...))
UserExtensions    (UserUpdateScope + UserTable.update + User.save/delete)
```

**包与命名冻结**：
- SQLx 实现：`neton.database.adapter.sqlx.SqlxTableAdapter`
- 生成物：`object &lt;Entity&gt;Table : Table&lt;Entity&gt;`（public）

### 3.3 表级 API

```kotlin
object UserTable : Table<User> by SqlxTableAdapter(...)

// Table 接口提供（get/destroy 保留，符合 Laravel 风格）：
UserTable.get(id)                              // 主键查询
UserTable.destroy(id)                          // 按主键删除
UserTable.update(id) { name = x; email = y }   // KSP 生成 mutate 风格
UserTable.where { User::status eq 1 }.list()
UserTable.findAll()
UserTable.count()
UserTable.ensureTable()
UserTable.getOrThrow(id)   // 抛 NotFoundException，HTTP 层可映射 404
```

### 3.4 AutoStore（legacy，不推荐新项目）

- **主路径**：KSP 生成 `object UserTable : Table&lt;User&gt; by SqlxTableAdapter(...)`，无 AutoStore。
- **AutoStore**：`@deprecated LEGACY`，仅提供最小 CRUD + transaction；不提供 updateById、query、where（均 throw UnsupportedOperationException）。
- **更新 / Query DSL**：由 KSP Table（UserTable.update / UserTable.where）统一提供。

### 3.5 实例级 API

```kotlin
// KSP 生成
suspend fun User.save(): User
suspend fun User.delete(): Boolean
```

---

## 四、冻结约束（必须遵守）

### 4.1 单 DB 与多 DB（v2 冻结）

- **v2 默认单 DB**：`SqlxDatabase.require()` 单例，KSP 生成 `dbProvider = { SqlxDatabase.require() }`（Table 适配器）
- **多 DB（命名连接/读写分离/多租户）**：留 v3，不在此版实现
- **扩展点已预留**：`SqlxTableAdapter(dbProvider: () -> SQLite = { SqlxDatabase.require() }, ...)`，v3 可传 `{ SqlxDatabase.get("analytics") }` 等，无需重构

### 4.2 SqlxTableAdapter 必须无状态（stateless）

- **不得持有可变状态**
- **不缓存 query 结果**
- **不缓存 entity**
- **仅允许缓存**：prepared statement / SQL 字符串（若需）
- 违反将导致一致性 bug，禁止。

### 4.3 id 类型与强类型（v2 冻结 / v2.1 预留）

- **v2**：`get(id: Any)`、`destroy(id: Any)`、`exists(id: Any)` 仅作过渡
- **KSP 生成的 Table**：必须在 adapter 内部明确 ID 类型（Long/ULong/String），不得把 id 当作字符串拼接
- **getOrThrow**：提供 `getOrThrow(id: ID)` 泛型重载，调用处类型推导安全；异常 message 含 `id (类型)` 便于排查
- **v2.1 建议**：`Table&lt;T, ID : Any&gt;` 强类型，避免 Any 破坏类型安全

### 4.4 NotFoundException 与 HTTP 404

- **NotFoundException** 位于 `neton.core.http`，继承 `HttpException(HttpStatus.NOT_FOUND)`
- **HTTP 适配器**：catch 到 NotFoundException 时统一映射 404，禁止出现「有的 NotFound 走 500」的分裂

### 4.5 AutoStore 异常文案（便于日志聚合）

- **格式**：`AutoStoreFeatureNotSupported: &lt;method&gt;. Use KSP Table (UserTable.xxx)`
- **示例**：`updateById`、`query`、`where` 均使用此格式，便于日志聚合「哪些项目误用 AutoStore」

### 4.7 ensureTable 行为

- **Table 接口默认**：`ensureTable()` 默认 no-op（空实现）
- **SqlxTableAdapter 实现**：仅当实体存在 DDL 元数据时（如 UserMeta 含列定义）才执行建表
- 用户不得假定 `ensureTable` 必然成功；无 DDL 元数据时可为 no-op 或抛异常

### 4.8 约束 A：Store 的命名空间必须固定为「Aggregate Store」

- **`Table&lt;T&gt;` 是唯一单表 CRUD 入口**；Store 仅承载跨表/聚合语义。
- **Store 不得实现 Table 接口** — Store 不是 CRUD 接口。
- **Store 不应提供 get(id)、where { } 等 Table 通用方法** — 除非明确为聚合查询（如 getWithRoles(id)）。
- **Store 允许且仅允许**：`getWithRoles`、`listUsersWithRoles`、`assignRole`/`removeRole` 等跨表/聚合语义。
- **违反后果**：语义回潮，Table/Store 职责混淆，禁止。

### 4.9 约束 B：KSP 生成物命名规则写死

| 规则 | 值 | 禁止 |
|------|-----|------|
| 表级生成物 | `EntityNameTable`（单数） | `UsersTable`、`UserTables`、`Users` |
| 聚合 Store | `EntityNameStore` 或 `DomainStore` | `UserRepositories`、`UserStoreImpl` |

- **KSP 对 @Table("users") data class User 必须生成**：`object UserTable : Table&lt;User&gt;`
- **禁止复数**：`Users`、`UserTables`。
- **禁止歧义**：`UserTables` 易与「多个 UserTable」混淆。
- **违反后果**：命名漂移、双轨回潮，禁止。

### 4.10 实现来源约束（语义约束）

- **`Table&lt;T&gt;` 仅由 KSP 生成物或框架内部 Adapter 实现。**
- **业务代码不得自行实现 `Table&lt;T&gt;`。**
- 本约束为语义冻结约束，不通过 sealed/interface 机制强制。

---

## 五、命名规则（冻结）

| 项目 | 规则 | 说明 |
|------|------|------|
| 表级对象 | `&lt;EntityName&gt;Table` | 如 UserTable、OrderTable |
| 聚合对象 | `&lt;EntityName&gt;Store` | 如 UserStore、OrderStore（多表联查/聚合） |
| 禁止 | `Users`（复数） | 易与集合混淆 |
| 禁止 | `UserRepo` | 误导为接口 |
| 禁止 | `UserQueries` | 语义不完整 |

**Table 语义**：单表 CRUD 入口。**Store 语义**：聚合/联查，业务仓库。

---

## 六、Table 与 Store 职责边界（定型）

| 层级 | 职责 | 允许 |
|------|------|------|
| **Table** | 表级 CRUD（≈ MyBatis-Plus Mapper） | 单表 get/insert/update/destroy/where/list/count |
| **Store** | 聚合/联查（业务仓库） | JOIN、CTE、复杂 SQL，返回 DTO（如 UserWithRoles） |
| **SqlRunner** | 底层执行器 | fetchAll/execute，由 adapter 实现 |

**冻结三条**：
1. **Table 不做 JOIN** — 单表 DSL 仅 `where { }`，不出现 JOIN。
2. **Store 允许 JOIN** — 多表联查、聚合对象、复杂 SQL 归属 Store。
3. **Store 不直接依赖 sqlx4k Row** — 使用 `neton.database.api.Row` 抽象（long/string/int 等）。

**推荐写法**：

```kotlin
// 表级（KSP 生成）
object UserTable : Table<User> by SqlxTableAdapter(...)
object RoleTable : Table<Role> by SqlxTableAdapter(...)
object UserRoleTable : Table<UserRole> by SqlxTableAdapter(...)

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

## 七、未来扩展性（预留）

- `UserTable.columns.id` / `UserTable.columns.name` — 可引入 Schema 时使用
- `UserTable.insert { ... }` / `UserTable.batchInsert { ... }`
- `UserTable.indexes` / `UserTable.migrations`

若引入真正的 TableSchema（DDL/列定义），建议单独 `UserSchema` 或 `TableMeta`，不与 Table 混用。

---

## 八、与行业对标

| 框架 | 对应形态 |
|------|----------|
| Exposed | `object Users : Table` |
| jOOQ | `USERS` 常量 |
| SQLDelight | `userQueries` |
| Prisma | `prisma.user` |
| Room | `UserDao` |
| **neton-database** | `object UserTable : Table&lt;User&gt;` |

---

## 九、参考实现

- `neton/examples/mvc` — 完整 MVC 示例（users/roles/user_roles + 聚合 Store）
- `neton/neton-ksp/EntityStoreProcessor.kt` — KSP 生成逻辑

---

## 十、Contract Tests（语义升级锁死）

| 测试 | 目的 | 验证方式 |
|------|------|----------|
| **生成物 Contract** | KSP 对 @Table 实体必须生成 `object UserTable : Table&lt;User&gt;` | `mvc` 编译通过 + `TableUserContractTest` |
| **禁止回潮** | Store 不实现 Table，无法作为 tableRegistry 返回值 | `Table` 为唯一单表接口；Store 不实现 Table 类型约束 |

- **Test 1**：`neton-database/commonTest` 中 `TableUserContractTest` 验证 Table 接口契约（get/where 等）。
- **Test 2**：通过约束 A（Store 不实现 Table），编译期天然防止「Store 被当作 Table 使用」。
