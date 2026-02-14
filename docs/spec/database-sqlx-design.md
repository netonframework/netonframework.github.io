# Neton Database 模块 - 纯 sqlx4k 架构设计

> **状态**：本设计已由 [database-sqlxstore-v2](./database-sqlxstore-v2.md) 落地。  
> 目标：neton-database **仅依赖 sqlx4k**，实现更强、更安全、更易用、更高性能的数据访问层。  
> **业务层 API** 以 Entity 为中心：`User.get`、`User.destroy`、`User.update`、`User.where`、`user.save`、`user.delete`，见 [database-query-dsl](./database-query-dsl.md)。本文描述内部架构与 sqlx4k 集成。

---

## 1. 当前架构概览

### 1.1 现状

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

### 1.2 设计背景（已解决）

迁移前问题（MemoryStore/SqliteStore 占位、手拼 SQL）已由 **SqlxStore + 参数化 Statement** 解决。当前实现见 [database-sqlxstore-v2](./database-sqlxstore-v2.md)。

---

## 2. 设计目标

| 目标 | 含义 |
|------|------|
| **更强** | 生产级连接池、事务、迁移 |
| **更安全** | 参数化 SQL、类型安全映射、无拼接 |
| **更易用** | 保持 Store DSL，与 Neton Config SPI 集成 |
| **性能更好** | 异步 I/O、连接池、预编译语句、KSP 零反射 |

---

## 3. 目标架构（纯 sqlx4k）

### 3.1 依赖关系

```
neton-database
  └── sqlx4k-sqlite   // 或 sqlx4k-postgres / sqlx4k-mysql，按需选择
  └── sqlx4k-codegen  // KSP，可选，用于实体 ↔ SQL 生成
  └── neton-core
```

**移除**：自研 MemoryStore、SqliteConnectionFactory、任何非 sqlx4k 的 DB 实现。

### 3.2 目录结构

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

### 3.3 数据流

```
UserStore (object 单例，KSP 生成) — 主路径；AutoStore 已 deprecated
    → SqlxStore<User>(sqlxDatabase, UserStatements, UserMapper)
    → sqlx4k: db.execute(stmt) / db.fetchAll(stmt, mapper)
```

- Store 以 **object 单例**形式存在，不每次 `getStore()` 新建
- Statement 由 KSP 生成 `XxxStatements` object，classloader 级共享

---

## 4. 核心设计

### 4.1 sqlx4k 作为唯一底层

- **SQLite**：开发/测试用 `sqlite::memory:`，生产用 `sqlite://path/to/db`
- **PostgreSQL / MySQL**：通过 sqlx4k-postgres / sqlx4k-mysql
- **Memory**：不再自研，统一用 `sqlite::memory:`

### 4.2 实体映射：KSP + RowMapper

**方案 A（推荐）**：KSP 生成

- 使用 sqlx4k-codegen：`@Table` + expect/actual 生成 `insert()`、`update()`、`delete()` Statement
- 或自研 KSP：扫描 `@Entity`，生成 `UserRowMapper`、CRUD Statement 构建逻辑

**方案 B**：手写 RowMapper

- 每个实体实现 `RowMapper&lt;T&gt;`
- 适合实体少、结构稳定的场景

**原则**：避免运行时反射，优先 KSP 生成。

### 4.3 Store 实现：SqlxStore

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

### 4.4 QueryBuilder：生成 SQL + Statement

- `SqlxQueryBuilder` 内部构建 `WHERE`、`ORDER BY`、`LIMIT` 等
- 输出 `Statement` + 参数列表，交给 `db.fetchAll(stmt, mapper)`
- 禁止手拼 SQL，一律参数化

### 4.5 DatabaseManager 与生命周期（legacy）

- **主路径**：`database { storeRegistry = { clazz -> UserStore } }`，直接传入 KSP 生成的 Store，不依赖 DatabaseManager。
- **DatabaseManager**：仅被 AutoStore、RepositoryProcessor 等 legacy 路径使用；`ConnectionFactory` 已移除，仅保留 `storeRegistry` / `getStore` 桥接。

### 4.6 事务

- 使用 sqlx4k 的 `db.transaction { }`
- Store 层可提供 `suspend fun &lt;T&gt; withTransaction(block: suspend () -> T): T`

---

## 5. 安全性

| 措施 | 说明 |
|------|------|
| **参数化查询** | 全部使用 `Statement.bind()`，禁止 `"$var"` 拼接 |
| **类型安全映射** | RowMapper 或 KSP 生成，避免运行时反射 |
| **连接安全** | 密码等敏感信息不落日志 |
| **迁移** | 使用 sqlx4k `db.migrate()` 管理 schema 版本 |

---

## 6. 易用性

| 改进 | 说明 |
|------|------|
| **业务 API** | `User.get`、`User.where { }.list()`、`user.save()` 等，Store 不暴露 |
| **主路径** | KSP 生成 `object UserStore : Store&lt;User&gt; by SqlxStoreAdapter`，AutoStore 已 deprecated |
| **@DatabaseConfig** | 通过 Config SPI 注册数据源，与 security/routing 一致 |
| **URI 配置** | 继续支持 `database.conf` 中的 `uri`、`driver` |
| **Memory 模式** | `uri: sqlite::memory:` 作为默认开发配置 |

---

## 7. 性能

| 优化 | 说明 |
|------|------|
| **连接池** | 使用 sqlx4k 的 `Pool.Options`（maxConnections、idleTimeout 等） |
| **预编译语句** | 复用 `Statement` 结构，仅变化参数 |
| **异步 I/O** | 全部 suspend，不阻塞线程 |
| **批量操作** | `insertBatch` 使用 sqlx4k 批量 API 或事务内循环 |
| **KSP 生成** | 消除反射，减少运行时开销 |

---

## 8. 实施步骤

1. **接入 sqlx4k**：添加 sqlx4k-sqlite（及按需 postgres/mysql）依赖
2. **实现 SqlxStore**：基于 sqlx4k 实现 `Store&lt;T&gt;`
3. **实现 SqlxQueryBuilder**：输出 `Statement`，走参数化查询
4. **实体映射**：先手写 RowMapper，再考虑 KSP 生成
5. **DatabaseManager 改造**：持有 sqlx4k Database，按 URI 创建
6. **移除 MemoryStore**：用 `sqlite::memory:` 替代
7. **DatabaseComponent**：从配置创建 sqlx4k 实例并初始化 DatabaseManager
8. **迁移**：支持 `db.migrate("./db/migrations")`

---

## 9. 与 sqlx4k 的映射

| neton-database | sqlx4k |
|----------------|--------|
| User.get(id)（内部 Store.findById） | db.fetchAll(stmt, mapper).firstOrNull() |
| Store.insert | db.execute(entity.insert()) |
| Store.query().fetch() | db.fetchAll(buildSelectStmt(), mapper) |
| 事务 | db.transaction { } |
| 连接池 | Driver.Pool.Options |
| 迁移 | db.migrate(path) |
| Memory | SQLite("sqlite::memory:") |

---

## 10. 设计原则（强制）

| 原则 | 说明 |
|------|------|
| **Store 是唯一数据访问抽象** | 业务层只通过 Store 访问数据 |
| **禁止直接使用 sqlx Database** | 业务层不得持有或调用 Database |
| **禁止运行时反射** | 实体映射用 KSP 或手写 RowMapper |
| **禁止拼接 SQL** | 一律参数化 Statement |
| **单一实现** | 只有 SqlxStore，无 memory/sqlite 多套 |
| **Store 必须无状态（stateless）** | 不得在 Store 内缓存 entity 或持有 mutable 状态；Store = 纯函数式 + db 代理 |
| **Store 单例化** | 使用 `object UserStore` 而非每次 `getStore()` 新建实例 |

### 10.1 长期规范（铁律）

| 规则 | 表述 |
|------|------|
| **Store 无状态 + 线程安全** | `Store MUST be stateless and thread-safe.` `Store MUST NOT hold mutable state or cache entities.` |
| **SQL 编译期生成** | `All SQL must be compile-time generated by KSP.` `Manual string concatenation SQL is forbidden.` |
| **唯一 Store 实现** | `SqlxStore is the only official Store implementation.` `Custom Store implementations are not supported.` Redis/Cache 作为 Store 包装层，不作为替代实现。 |

---

## 11. 不做的事情

- 不自研数据库驱动
- 不在运行时用反射解析实体
- 不手拼 SQL 字符串
- 不维护多套 Store 实现（memory/sqlite 等），统一为 SqlxStore + 不同 sqlx4k 后端

---

## 12. 后续演进

详见 [SqlxStore v2 接口设计](./database-sqlxstore-v2.md)：Statement 静态化、Store 单例、Batch API、ActiveRecord 语法糖。

**下一阶段优先级**：Typed Query DSL > 事务 DSL > Stream/Flow > Migration > AutoInstall

**v3 可选**：Stream/Flow 流式查询（`fun stream(): Flow&lt;T&gt;`），大表场景避免一次性 `List`。
