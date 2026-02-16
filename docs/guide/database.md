# 数据库指南

Neton 的数据库层遵循 **Entity = 纯数据，Table = 表级入口** 的设计原则。没有 companion object 魔法，没有运行时反射，所有代码由 KSP 在编译期生成，确保 Kotlin/Native 原生兼容。

## 设计原则

| 概念 | 职责 | 说明 |
|------|------|------|
| **Entity** | 纯数据类 | `data class`，用 `@Serializable` + `@Table` 标注 |
| **Table** | 单表 CRUD | KSP 自动生成，提供 `get`/`save`/`where`/`destroy` 等操作 |
| **Store** | 跨表聚合 | 手写，处理 JOIN、多表关联等复杂查询 |

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
| `@Timestamp` | 时间戳自动填充 | `onCreate`: 创建时设置；`onUpdate`: 更新时设置 |

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

// 新建（id 传 null，自动生成）
val newUser = UserTable.save(User(null, "Alice", "alice@example.com", 1, 25))

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

// 批量保存（返回列表）
val saved = UserTable.saveAll(users)

// 批量更新
UserTable.updateBatch(users)
```

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

在应用入口 DSL 中配置 `database` 组件，注册所有 Table：

```kotlin
import neton.core.Neton
import neton.http.http
import neton.database.database
import neton.routing.routing

fun main(args: Array<String>) {
    Neton.run(args) {
        http { port = 8081 }

        database {
            tableRegistry = { clazz ->
                @Suppress("UNCHECKED_CAST")
                when (clazz) {
                    User::class -> UserTable
                    Role::class -> RoleTable
                    UserRole::class -> UserRoleTable
                    else -> null
                }
            }
        }

        routing { }

        onStart {
            // 启动时确保表结构存在
            UserTable.ensureTable()
            RoleTable.ensureTable()
            UserRoleTable.ensureTable()
        }
    }
}
```

`tableRegistry` 是一个从 `KClass` 到 `Table` 实例的映射函数，框架通过它在运行时查找 Table 对象。`ensureTable()` 在应用启动时创建表结构（如果不存在）。

## CRUD 控制器示例

结合路由注解，构建完整的 RESTful API 控制器：

```kotlin
import model.User
import model.UserTable
import neton.database.dsl.ColumnRef
import neton.core.annotations.*
import neton.core.http.*
import neton.logging.Logger
import neton.logging.Log

@Controller("/api/users")
@Log
class UserController(private val log: Logger) {

    @Get
    suspend fun all(): List<User> =
        UserTable.query { where { ColumnRef("status") eq 1 } }.list()

    @Get("/{id}")
    suspend fun get(id: Long): User? {
        log.info("user.get", mapOf("userId" to id))
        return UserTable.get(id)
    }

    @Post
    suspend fun create(@Body user: User): User =
        UserTable.save(user)

    @Put("/{id}")
    suspend fun update(id: Long, @Body user: User): User {
        val current = UserTable.get(id)
            ?: throw NotFoundException("User $id not found")
        val updated = current.copy(
            name = user.name,
            email = user.email,
            status = user.status,
            age = user.age
        )
        UserTable.update(updated)
        return updated
    }

    @Delete("/{id}")
    suspend fun delete(id: Long) {
        UserTable.destroy(id)
    }
}
```

## Store 模式：跨表 JOIN

当需要跨多张表进行联合查询时，使用 Store 模式。Store 通过 `SqlRunner` 执行原生 SQL，处理 Table 无法覆盖的复杂聚合场景。

### 定义聚合 DTO

```kotlin
@Serializable
data class UserWithRoles(
    val user: User,
    val roles: List<Role>
)
```

### 实现 Store

```kotlin
import neton.database.api.SqlRunner
import neton.database.sqlRunner

class UserStore(private val db: SqlRunner = sqlRunner()) : SqlRunner by db {

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

### 在控制器中使用 Store

```kotlin
@Controller("/api/users")
class UserController(
    private val userStore: UserStore = UserStore()
) {
    @Get("/{id}/with-roles")
    suspend fun getWithRoles(id: Long): UserWithRoles? =
        userStore.getWithRoles(id)
}
```

### Table vs Store 职责边界

| 维度 | Table | Store |
|------|-------|-------|
| 生成方式 | KSP 自动生成 | 手动编写 |
| 操作范围 | 单表 CRUD | 跨表 JOIN / 聚合 |
| SQL 编写 | 无需，DSL 自动生成 | 手写原生 SQL |
| 适用场景 | 标准增删改查 | 复杂报表、关联查询 |

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

在 `onStart` 回调中调用 `ensureTable()` 确保表结构存在：

```kotlin
onStart {
    UserTable.ensureTable()
    RoleTable.ensureTable()
    UserRoleTable.ensureTable()
}
```

`ensureTable()` 是幂等的，已存在的表不会被重复创建或修改。

## 事务支持

使用 `transaction` 在事务中执行多个操作：

```kotlin
UserTable.transaction {
    val user = save(User(null, "Alice", "alice@example.com", 1, 25))
    // 如果后续操作失败，整个事务回滚
    destroy(user.id!!)
}
```

## 相关文档

- [数据库 API 规格](/spec/database-api) -- Table 接口完整定义
- [数据库查询 DSL 规格](/spec/database-query-dsl) -- 查询 DSL 详细设计
- [数据库 SQLx 设计](/spec/database-sqlx-design) -- 底层 SQLx 集成方案
