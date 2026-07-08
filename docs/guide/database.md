# 数据库指南

Neton 的数据库层遵循 **Entity = 纯数据，Table = 表级入口** 的设计原则。没有 companion object 魔法，没有运行时反射，所有代码由 KSP 在编译期生成，确保 Kotlin/Native 原生兼容。

## 设计原则

| 概念 | 职责 | 说明 |
|------|------|------|
| **Controller** | HTTP 端点 | 接收请求、参数校验、调用 Logic |
| **Logic** | 业务聚合 | 手写，处理 JOIN、事务、缓存等业务用例 |
| **Table** | 单表 CRUD | KSP 自动生成，提供 `get`/`save`/`where`/`destroy` 等操作 |
| **Entity** | 纯数据类 | `data class`，用 `@Serializable` + `@Table` 标注 |

关键约束：
- Entity 不包含任何数据库逻辑，不使用 companion object
- Table 由 KSP 根据 Entity 注解自动生成，无需手写
- 不依赖运行时反射，完全编译期代码生成

## 定义实体

使用 `@Serializable`、`@Table` 和 `@Id` 注解定义实体类：

```kotlin
import kotlinx.serialization.Serializable
import neton.database.annotations.Table
import neton.database.annotations.Id

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

### 注解说明

| 注解 | 作用 | 参数 |
|------|------|------|
| `@Table("表名")` | 标记数据库表，指定表名 | `value`: 表名，默认使用类名小写 |
| `@Id` | 标记主键字段 | `autoGenerate`: 是否自动生成，默认 `true` |
| `@Column` | 自定义列映射 | `name`: 列名；`nullable`: 是否可空；`ignore`: 是否忽略 |
| `@CreatedAt` | 插入时自动填充当前时间（epoch millis, UTC） | 无 |
| `@UpdatedAt` | 插入/更新时自动填充当前时间（epoch millis, UTC） | 无 |

主键字段类型为 `Long?`，新建实体时传 `null`，数据库自动生成。

### 更多实体示例

```kotlin
@Serializable
@Table("roles")
data class Role(
    @Id val id: Long?,
    val name: String
)

@Serializable
@Table("user_roles")
data class UserRole(
    @Id val id: Long?,
    val userId: Long,
    val roleId: Long
)
```

## Table 操作（KSP 生成）

KSP 会为每个标注了 `@Table` 的 Entity 自动生成对应的 Table 对象（如 `User` -> `UserTable`）。Table 实现了 `Table&lt;T, ID&gt;` 接口（ID 由主键类型推导，常见为 Long），提供完整的单表 CRUD 能力：

### 基础 CRUD

```kotlin
// 按 ID 查询
val user: User? = UserTable.get(1L)

// 查询所有
val allUsers: List<User> = UserTable.findAll()

// 新建
val newUser = UserTable.insert(User(null, "Alice", "alice@example.com", 1, 25))

// 更新
UserTable.update(existingUser.copy(name = "New Name"))

// 删除
UserTable.destroy(1L)

// 计数
val total: Long = UserTable.count()

// 是否存在
val exists: Boolean = UserTable.exists(1L)
```

### 批量操作

```kotlin
// 批量插入
val users = listOf(user1, user2, user3)
UserTable.insertBatch(users)

// 批量更新
UserTable.updateBatch(users)
```

`insert` 返回数据库中的最终实体，包括数据库生成的主键。`insertBatch` 只返回影响行数，
不会修改传入实体，也不返回每行的生成主键；需要这些主键时，应在显式事务中逐条调用 `insert`。

## 查询 DSL

Neton 提供类型安全的查询 DSL，通过 `query { where { } }` 构建条件。`where` 块内使用 `ColumnRef` 与 `PredicateScope` 的 `all`、`and`、`or` 等：

```kotlin
import neton.database.dsl.ColumnRef
```

### 基础查询

```kotlin
// 等值查询
val activeUsers = UserTable.query { where { ColumnRef("status") eq 1 } }.list()

// 比较查询
val adults = UserTable.query { where { ColumnRef("age") gt 18 } }.list()

// 模糊查询
val matched = UserTable.query { where { ColumnRef("name") like "%Alice%" } }.list()

// 查询全部
val all = UserTable.query { where { all() } }.list()
```

### 组合条件

```kotlin
// AND 组合
val result = UserTable.query {
    where { and(ColumnRef("status") eq 1, ColumnRef("age") gt 18) }
}.list()

// OR 组合
val result = UserTable.query {
    where { or(ColumnRef("name") eq "Alice", ColumnRef("name") eq "Bob") }
}.list()
```

### 排序、分页

```kotlin
// 排序 + 分页（page 从 1 开始）
val sorted = UserTable.query {
    where { ColumnRef("status") eq 1 }
    orderBy(ColumnRef("age").desc())
    limitOffset(20, 0)
}.list()

// 分页（含 total、totalPages）
val pageResult = UserTable.query { where { ColumnRef("status") eq 1 } }.page(1, 20)
// pageResult.items      -> List<User>
// pageResult.total      -> 总记录数
// pageResult.page       -> 当前页
// pageResult.size       -> 每页大小
// pageResult.totalPages -> 总页数
```

### 单条查询与计数

```kotlin
// 单条（等价于 list().firstOrNull()）
val first = UserTable.query { where { ColumnRef("status") eq 1 }; limitOffset(1, 0) }.list().firstOrNull()

// 条件查单条（便捷方法）
val one = UserTable.oneWhere { ColumnRef("email") eq "alice@example.com" }

// 条件是否存在
val exists = UserTable.existsWhere { ColumnRef("email") eq "alice@example.com" }

// 计数
val count = UserTable.query { where { ColumnRef("status") eq 1 } }.count()
```

## 安装数据库组件

在应用入口 DSL 中安装 `database` 组件。KSP 生成的 Table 不需要运行时注册：

```kotlin
import neton.core.Neton
import neton.http.http
import neton.database.database
import neton.routing.routing

fun main(args: Array<String>) {
    Neton.run(args) {
        http { port = 8081 }

        database { }

        routing { }

    }
}
```

数据库组件初始化 `DbSessionProvider` 和 `DbContext`。正式应用的表结构由 migration SQL 管理，启动过程不调用 `ensureTable()`。

## CRUD 控制器示例

结合路由注解，构建完整的 RESTful API 控制器。注意：Controller 不直接引用 Table，所有数据操作通过 Logic 层：

```kotlin
import logic.UserLogic
import model.User
import neton.core.annotations.*
import neton.core.http.*
import neton.logging.Logger
import neton.logging.Log

@Controller("/api/users")
@Log
class UserController(
    private val log: Logger,
    private val userLogic: UserLogic = UserLogic()
) {

    @Get
    suspend fun all(): List<User> = userLogic.all()

    @Get("/{id}")
    suspend fun get(id: Long): User? {
        log.info("user.get", mapOf("userId" to id))
        return userLogic.get(id)
    }

    @Post
    suspend fun create(@Body user: User): User = userLogic.create(user)

    @Put("/{id}")
    suspend fun update(id: Long, @Body user: User): User =
        userLogic.update(id, user)

    @Delete("/{id}")
    suspend fun delete(id: Long) = userLogic.delete(id)
}
```

## Logic 层：跨表聚合

当需要跨多张表进行联合查询、事务操作或业务聚合时，使用 Logic 层。Logic 通过 `DbContext` 执行原生 SQL，或通过 Table DSL 进行单表操作，是 Controller 与 Table 之间的唯一业务层。

### 定义聚合 DTO

```kotlin
@Serializable
data class UserWithRoles(
    val user: User,
    val roles: List<Role>
)
```

### 实现 Logic

```kotlin
import neton.database.api.DbContext
class UserLogic(private val db: DbContext) : DbContext by db {

    suspend fun all(): List<User> =
        UserTable.query { where { User::status eq 1 } }.list()

    suspend fun get(id: Long): User? = UserTable.get(id)

    suspend fun create(user: User): User = UserTable.insert(user)

    suspend fun getWithRoles(userId: Long): UserWithRoles? {
        val sql = """
            SELECT u.id, u.name, u.email, u.status, u.age,
                   r.id AS role_id, r.name AS role_name
            FROM users u
            LEFT JOIN user_roles ur ON ur.user_id = u.id
            LEFT JOIN roles r ON r.id = ur.role_id
            WHERE u.id = :uid
        """.trimIndent()

        val rows = fetchAll(sql, mapOf("uid" to userId))
        if (rows.isEmpty()) return null

        val first = rows.first()
        val user = User(
            id = first.long("id"),
            name = first.string("name"),
            email = first.string("email"),
            status = first.int("status"),
            age = first.int("age")
        )
        val roles = rows.mapNotNull { r ->
            r.longOrNull("role_id")?.let {
                Role(it, r.string("role_name"))
            }
        }.distinctBy { it.id }

        return UserWithRoles(user, roles)
    }
}
```

### 在控制器中使用 Logic

```kotlin
@Controller("/api/users")
class UserController(
    private val userLogic: UserLogic = UserLogic()
) {
    @Get
    suspend fun all(): List<User> = userLogic.all()

    @Get("/{id}")
    suspend fun get(id: Long): User? = userLogic.get(id)

    @Get("/{id}/with-roles")
    suspend fun getWithRoles(id: Long): UserWithRoles? =
        userLogic.getWithRoles(id)

    @Post
    suspend fun create(@Body user: User): User = userLogic.create(user)
}
```

### Table vs Logic 职责边界

| 维度 | Table | Logic |
|------|-------|-------|
| 生成方式 | KSP 自动生成 | 手动编写 |
| 操作范围 | 单表 CRUD + Query DSL | 跨表 JOIN / 事务 / 业务聚合 |
| SQL 编写 | 无需，DSL 自动生成 | 80% 用 Table DSL，20% 用 DbContext（raw SQL 逃生口） |
| 适用场景 | 标准增删改查 | 复合用例、报表、关联查询 |

## 数据库配置

在 `config/database.conf` 中配置数据库连接（TOML 格式）：

```toml
# config/database.conf
[default]
driver = "MEMORY"
uri = "sqlite::memory:"
debug = true
```

配置项说明：

| 配置项 | 说明 | 示例 |
|--------|------|------|
| `driver` | 数据库驱动 | `"MEMORY"`、`"SQLITE"`、`"POSTGRES"` |
| `uri` | 连接 URI | `"sqlite::memory:"`、`"postgres://localhost/mydb"` |
| `debug` | 调试模式（打印 SQL） | `true` / `false` |

支持多数据源配置，使用不同的 section 名称：

```toml
[default]
driver = "SQLITE"
uri = "sqlite:./data/main.db"
debug = true

[analytics]
driver = "POSTGRES"
uri = "postgres://localhost:5432/analytics"
debug = false
```

## 表初始化

`ensureTable()` 只用于 demo 或临时测试数据库：

```kotlin
UserTable.ensureTable()
```

正式应用禁止在启动阶段调用 `ensureTable()`；schema 演进必须使用版本化 migration SQL。

## 事务支持

通过注入的 `DbContext` 执行事务，块内所有 Table 自动使用同一个 transaction session：

```kotlin
db.transaction {
    val user = UserTable.insert(User(null, "Alice", "alice@example.com", 1, 25))
    // 如果后续操作失败，整个事务回滚
    UserTable.destroy(user.id!!)
}
```

## 相关文档

- [数据库规范](/spec/database) -- Entity/Table 模型、Query DSL、架构实现
- [JOIN 查询规范](/spec/database-join) -- 强类型列引用、Typed Projection、JOIN AST
- [执行链与约束规范](/spec/database-execution) -- DbContext 统一执行门面、QueryInterceptor、事务

## 数据库迁移（migration）

迁移能力内建于 neton-database（2026-06 起，独立的 neton-migrate CLI 已废弃）：

- **入口**：应用二进制自带子命令 —— `./application.kexe migrate up` 应用全部 pending
  迁移；每个模块自管自己的 SQL 与 history 表（如 `neton_schema_history_member`）。
- **SQL 编译进 binary**：每模块的 `sql/postgresql/V*.sql` 由 Gradle task 生成 Kotlin
  常量参与编译，运行期不读 .sql 文件（适配 K/N 单 binary 部署）。
- **启动纪律**：应用启动**绝不自动迁移**；检测到 pending migration 时拒绝启动并列出
  待执行项，提示先运行 `migrate up`。
- 模块声明：`@Module(migrations = true)`（KSP 一致性校验会检查该标记与 sql 目录的对应）。
