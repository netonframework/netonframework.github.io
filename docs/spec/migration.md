# Neton Migration Boundary Spec

> *Schema Governance — runtime 不参与 schema 演进*

> **状态**：边界冻结（Boundary Frozen）
> **架构演进（2026-06-01）**：migration engine internalized — 详见 §0 Canonical Architecture
> **当前权威入口**：`./application.kexe migrate up | status | verify`
> **应用启动语义**：永远不变 — startup 不执行 schema 变更
> **明确禁止**：运行时自动 schema 变更
> **标签**：No runtime ALTER — `application.kexe migrate` is the canonical entry — Manual SQL still valid

---

## 目录

0. [Canonical Architecture（2026-06-01 update）](#零canonical-architecture2026-06-01)
1. [设计原则](#一设计原则)
2. [模块边界](#二模块边界)
3. [SQL 资源约定](#三sql-资源约定)
4. [`ensureTable()` 定位](#四ensuretable-定位)
5. [`application.kexe migrate` 子命令](#五applicationkexe-migrate-子命令)
6. [版本表规范](#六版本表规范)
7. [明确禁止事项](#七明确禁止事项)
8. [冻结约束](#八冻结约束)

附录:
- [附录 A: 常见误区](#附录-a常见误区)
- [附录 C: Legacy `neton-migrate` CLI v0.1（deprecated as primary entry）](#附录-clegacy-neton-migrate-cli-v01deprecated-as-primary-entry)

---

## 零、Canonical Architecture（2026-06-01）

Migration engine lives inside **`neton-database`**. The canonical execution entry is **`application.kexe migrate`**. The standalone `neton-migrate` binary is **deprecated as the primary Neton application migration entry**.

### 0.1 边界

| 关注点 | 归属 |
|---|---|
| Migration engine（扫描、计算 diff、写 history、事务、checksum） | `neton-database/.../migration/` |
| SQL migration **files** | 各 application module (`<module>/sql/{dialect}/V*.sql`) |
| 模块声明 migration source | `ModuleInitializer.migrations(): List<MigrationSource>` |
| 正式执行入口 | `application.kexe migrate <subcommand>` |
| 正常启动 | `./application.kexe` — **绝不**自动 migrate |
| 全局历史表 | `neton_schema_history`（`UNIQUE(module_id, version)`） |

### 0.2 正式命令

```bash
./application.kexe migrate status   # 列已应用 / 待应用
./application.kexe migrate verify   # 校验 checksum
./application.kexe migrate up       # 跑所有 pending
./application.kexe                  # 正常启动 server (不 migrate)
```

明确禁止：
```bash
./application.kexe
# must not auto migrate. schema 落后必须 fail-fast 报错退出。
```

### 0.3 `MigrationSource` API

模块**显式声明**自己的 SQL 路径,框架不硬编码约定:

```kotlin
interface ModuleInitializer {
    val moduleId: String
    val dependsOn: List<String>
    fun initialize(ctx: ModuleContext)

    /** Migration sources for this module. Empty list = module has no schema. */
    fun migrations(): List<MigrationSource> = emptyList()
}

data class MigrationSource(
    val moduleId: String,            // 用于 history table 的 module_id 列
    val dialect: String,             // "postgresql" | "mysql" | "sqlite"
    val resourcePath: String,        // 相对路径, e.g. "sql/postgresql"
)
```

### 0.4 全局 history 表（表名可配,**框架不锁死**）

每个 application 一张全局 history 表(跨模块共享),**表名由 application 配置**,框架提供默认 `neton_schema_history`。

`config/database.conf`(per-application 配):
```toml
[migration]
# 可选, 默认 neton_schema_history
history_table = "privchat_migrations"
```

不同应用按业务命名约定:
| 应用 | history_table |
|---|---|
| privchat-application | `privchat_migrations`(沿用业务现有约定) |
| game-application(若分离) | `game_migrations` |
| 其它 Neton 应用未配 | `neton_schema_history`(默认) |

**关键**:框架代码**不允许**硬编码 `neton_schema_history` 等具体名字,必须读 config。

**表结构(框架内置)**:
```
<history_table>
  module_id     VARCHAR(64)   NOT NULL
  version       VARCHAR(32)   NOT NULL
  description   VARCHAR(255)
  checksum      VARCHAR(128)
  installed_at  BIGINT
  execution_ms  BIGINT
  success       BOOLEAN
  error_message TEXT
  UNIQUE(module_id, version)
```

废弃旧的 per-module `neton_schema_history_<module>` 表(`_game / _member / _payment / _platform`)——一个应用就一张全局表,用 `module_id` 列区分。

### 0.5 与 Legacy `neton-migrate` CLI 的关系

The standalone `neton-migrate` binary is deprecated as the primary Neton application migration entry. The canonical entry is `application.kexe migrate`. The migration engine lives in `neton-database`.

CLI 仍可保留(用于没有 application 上下文的场景或离线调试),但不再作为正式 application 部署入口。文档 / 部署示例 / 教程一律改用 `application.kexe migrate`。

### 0.6 Application 启动行为(红线)

`./application.kexe`(无 `migrate` 子命令)启动时:
1. 读 config / 初始化 database
2. 检查 schema 版本(读 **configured history table** vs 模块声明的 latest version)
3. 如果**任一模块**有 pending migration → **fail-fast**,打印 `please run ./application.kexe migrate up` 并 exit 非 0
4. **绝不**自动跑 migration

至少有一个 boot smoke test 守住这条红线。

---

## 一、设计原则

### 1.1 为什么 Neton 不做运行时迁移

Schema 变更的本质是 **部署决策**，不是 **运行时行为**。把它放进 app 启动流程意味着：

| 风险 | 说明 |
|------|------|
| **不可审阅** | DDL 由代码隐式生成，无法在 PR/CR 阶段被人工 review |
| **不可灰度** | 多实例并发启动时，谁先抢到锁、谁执行成功、谁失败回滚，皆不可控 |
| **不可回滚** | 应用启动失败 ≠ schema 已回滚；schema 已变更 ≠ 应用必然成功 |
| **数据库差异** | MySQL/PostgreSQL/SQLite 的 DDL 方言、约束语义、ALTER 行为不一致，自动化掩盖差异 |
| **复杂演进无解** | 表拆分、列改名、数据回填、双写双读、灰度发布等场景，运行时自动迁移完全表达不了 |

### 1.2 核心立场

- Schema 演进 = **人工审阅 + 显式执行 + 版本化记录**
- Neton 框架运行时只关心"连接 DB、读写数据"，不关心"DB 长什么样"
- 框架可以**检查** schema 状态（连接探活、版本一致性校验），但**不执行**变更

---

## 二、模块边界

| 模块 | 职责 | 不做 |
|------|------|------|
| **`neton-database`** | 运行时 DB 访问(连接、查询、事务、Entity ↔ Row 映射) + **migration engine / history / checksum / script execution** | 不在 app 正常启动期自动 migrate |
| **`application`**(业务应用) | 启动 HTTP/database/scheduler 等组件;**提供 `migrate` 子命令**;收集 `ModuleInitializer.migrations()` 调用 engine | 正常启动绝不 ALTER、不自动 migrate;只检查 pending 决定是否 fail-fast |
| **Legacy `neton-migrate` CLI** | (历史保留)独立 binary,用于无 application 上下文的 low-level / offline / debug 场景 | **不再作为 application 部署的正式入口**;教程/文档/CI 一律改用 `application.kexe migrate` |

**关键约束**:
- migration engine **归 `neton-database`**;`application` 在 `migrate` 子命令里调用它,**不重新实现**
- `ModuleInitializer.initialize()` **不允许**触发 migration;只在 `application.kexe migrate` 子命令路径才执行
- application 正常启动(无 `migrate` arg)**只允许检查** schema 状态,**不允许执行**任何 DDL

---

## 三、SQL 资源约定

### 3.1 目录(模块自决,框架不锁死)

每个 application module 在 `ModuleInitializer.migrations()` 里**显式声明**资源路径。沿用业务现有约定:

```
<module>/sql/
├── mysql/
│   ├── V001__create_tables.sql
│   ├── V002__init_data.sql
│   └── V003__add_indexes.sql
├── postgresql/
│   └── ...
└── sqlite/
    └── ...
```

```kotlin
override fun migrations() = listOf(
    MigrationSource(
        moduleId   = "privchat-application",
        dialect    = "postgresql",
        resourcePath = "sql/postgresql",
    ),
)
```

### 3.2 命名规范

`V<version>__<description>.sql`

- `V` 大写前缀
- `<version>` 三位以上零填充数字(`001`、`002`、…),保证字典序 = 执行序
- 双下划线 `__` 分隔
- `<description>` 用 snake_case,简短描述

> 命名格式与 Flyway 兼容,但**不引入** Flyway 依赖;`neton-database/.../migration/` 自己解析。

### 3.3 执行规则

- **本地开发**:开发者跑 `./application.kexe migrate up`(或 IDE / dev script)
- **测试环境**:CI pipeline 跑 `./application.kexe migrate up`(必要时 `status` dry-run)
- **生产环境**:CI/CD 部署流水线在 service start **之前**执行 `./application.kexe migrate up`,由 DBA / SRE 把关
- **顺序**:同 module 内按 version 升序,跨模块按 `dependsOn` 拓扑序;不允许跳跃或乱序

### 3.4 与应用启动(serve 模式)的关系

`./application.kexe`(无 `migrate` 子命令)启动时**只做**:
- 数据库连接探活(连不上 fail-fast)
- 读 configured history 表,与各 module 声明的 latest version 对比
- 任一模块有 pending → **fail-fast**,打印 `please run ./application.kexe migrate up` 并 exit 非 0

`./application.kexe`(serve)**不做**:
- 创建表、修改表、删除表
- 写入 history 表
- 任何形式的 DDL 执行

---

## 四、`ensureTable()` 定位

`Table.ensureTable()` 在 `neton-database` 中保留，但严格限定用途。

### 4.1 仅用于

- demo 工程
- 本地开发的临时调试
- 单元测试 / 集成测试中的 ephemeral 数据库（如 `sqlite::memory:`）

### 4.2 禁止用于

- 生产环境的 schema 创建
- 生产环境的 schema 演进（它根本做不了 ALTER）
- CI release 部署
- 任何带"持久化"语义的数据库

### 4.3 能力清单

`ensureTable()` 只能做：
- `CREATE TABLE IF NOT EXISTS`，仅含主键列与从 `EntityMeta` 推导的基础列

`ensureTable()` 永远不会做：
- 新增/删除/修改字段
- 索引、唯一约束、外键
- 数据迁移、回填
- 表已存在时的任何 schema 调整

### 4.4 文档与代码标注

- 该方法的 KDoc 必须包含 `dev/demo only, not for production migration`
- `Main.kt` 与 `ModuleInitializer` 内**不允许**调用 `ensureTable()`
- examples 工程中调用时应附注释说明"仅 demo 用途"

---

## 五、`application.kexe migrate` 子命令

正式 application migration 执行入口。Engine 在 `neton-database`,application 主入口判 `args.firstOrNull() == "migrate"` 进入 migration 模式(不启动 server / scheduler / WebSocket)。

### 5.1 命令集(最小集)

| 命令 | 行为 | 备注 |
|------|------|------|
| `application.kexe migrate status` | 显示已应用 / 待应用 / changed(checksum 不一致)脚本列表 | 只读 |
| `application.kexe migrate up` | 按 `(moduleId, version)` 顺序执行所有 pending 脚本,任意失败中断 | 默认部署命令 |
| `application.kexe migrate verify` | 校验 history 表中已执行脚本的 checksum 是否与磁盘一致 | 只读,检测脚本被篡改 |

子命令以外的 `application.kexe`(无 args)**永远不**执行 migration —— 见 §0.6 / §七。

### 5.2 `down` 不在最小集内

- 生产环境通常**不允许**自动回滚(数据可能已写入新结构,回滚会丢数据)
- 如果未来要支持 `down`,必须设为 opt-in 且默认禁用
- 可以提供"生成 down SQL 模板"的能力,由人工执行

### 5.3 执行机制

```
1. 加载 application config (database / migration history_table)
2. 初始化 neton-database (driver = config 单一 driver, 与 serve 模式同一个)
3. 收集所有 ModuleInitializer.migrations() → List<MigrationSource>
4. 确保 configured history table 存在 (默认 neton_schema_history, 见 §0.4)
5. 按 (moduleId, version) 排序, 与 history 表对比, 找出 pending
6. 顺序执行 per (moduleId, version):
   a. 读 SQL 文件 + 计算 checksum
   b. 执行 SQL (在 transaction 内, 如果方言支持 DDL transaction)
   c. 写 history 一行 (module_id, version, checksum, installed_at, execution_ms, success=true)
7. 任意一步失败 → 中断, 写入失败记录, 非 0 exit code
```

**约束**:
- migration 模式**只在显式 `migrate` 子命令下**运行;`Neton.run { }` 正常启动路径**不允许**触发 engine
- 同一 application 进程只链一个 sqlx4k driver(参见 NETON-DB-VARIANT),migration 和 serve 共享 driver,避免 K/N 链接器多 driver 撞 `rust_eh_personality` 等符号

### 5.4 退出码契约

| Exit Code | 含义 |
|-----------|------|
| `0` | 全部成功(或已无需执行) |
| `1` | `status` 检测到有 pending 脚本(CI dry-run 使用) |
| `2` | `up` 执行中失败 |
| `3` | checksum 校验失败(脚本被篡改 / history 表不一致) |
| `4` | 数据库连接失败 |
| `64` | 命令行参数错误 |

CI/CD 可基于退出码判断是否阻塞部署。

---

## 六、版本表规范

### 6.1 表名(可配,**框架不锁死**)

每个 application 一张**全局**history 表,跨模块共享。**表名由 application config 决定**,框架提供默认值 `neton_schema_history`。详见 §0.4。

```toml
# config/database.conf
[migration]
history_table = "privchat_migrations"   # 可选, 默认 neton_schema_history
```

废弃 per-module 拆分(如 `neton_schema_history_game / _member / _payment / _platform`)——一个 application 就一张表,用 `module_id` 列区分模块。

### 6.2 表结构(框架内置)

| 字段 | 类型 | 说明 |
|------|------|------|
| `module_id` | `VARCHAR(64) NOT NULL` | 来源模块(对齐 `ModuleInitializer.moduleId`) |
| `version` | `VARCHAR(32) NOT NULL` | 版本号,如 `001`、`002` |
| `description` | `VARCHAR(255)` | 脚本描述(取自文件名 `__` 后的部分) |
| `checksum` | `VARCHAR(128)` | SHA-256 hex(或更长,容纳未来 hash 升级) |
| `installed_at` | `BIGINT` | 执行 epoch millis |
| `execution_ms` | `BIGINT` | 执行耗时 ms |
| `success` | `BOOLEAN` | 是否成功 |
| `error_message` | `TEXT` NULL | 失败时的错误信息 |

**主键约束**:`UNIQUE(module_id, version)` —— 同一 module 不允许同 version 出现两次;跨模块允许版本号重复(`member.V001` 与 `payment.V001` 互不冲突)。

### 6.3 写入规则

- 每个脚本执行前后写一条记录
- 失败的执行也要记录(`success=false` + `error_message`)
- 已记录 `success=true` 的 `(module_id, version)` 不再重复执行
- 已记录 `success=false` 的 `(module_id, version)`:默认要求人工介入(不自动重试)
- 框架代码**禁止**硬编码 `"neton_schema_history"` 字符串,所有访问必须经 config 读出

### 6.4 状态模型(DB-MIG-2 frozen)

`MigrationEngine` 给每个 (module_id, version) 返回 5 种可能状态:

| 磁盘 | history | history.success | state | SPEC 术语 |
|---|---|---|---|---|
| 有 | 无 | — | `PENDING` | pending |
| 有 | 有 | true,checksum 同 | `EXECUTED` | applied |
| 有 | 有 | true,checksum 不同 | `CHECKSUM_MISMATCH` | changed |
| 有 | 有 | false | `FAILED` | failed |
| 无 | 有 | — | `MISSING_ON_DISK` | — |
| 无 | 无 | — | (不进状态机) | — |

**优先级冻结**: 同一 row 上 `FAILED` 优先于 `CHECKSUM_MISMATCH`。`history.success=false` 且磁盘 checksum 也漂移时,engine 报 `FAILED` 而非 `CHECKSUM_MISMATCH`,因为 failed migration 必须先由操作员解决,checksum 漂移在那之后才有意义。

### 6.5 命令对状态的反应(三命令一致性)

| 状态 | `status` | `verify` | `up` |
|---|---|---|---|
| `PENDING` | 列示 | 忽略 | 顺序执行 |
| `EXECUTED` | 列示 | 校验 ok | 跳过 |
| `CHECKSUM_MISMATCH` | 列示 + 标 changed | 列入 `mismatches` | **Aborted** (在 pending 执行前) |
| `MISSING_ON_DISK` | 列示 | 列入 `missing` | 忽略(已应用的脚本被人为删,UP 不重发) |
| `FAILED` | 列示 + `error_message` | 忽略(verify 只看 success=true) | **Aborted** ("manual intervention required") |

三命令对 `CHECKSUM_MISMATCH` 的反应严格递进: status=show,verify=flag,up=block。

### 6.6 操作员从 `FAILED` 状态的恢复路径

框架**不**提供 `migrate reset` / `migrate retry` 命令(危险操作不暴露)。操作员步骤:

1. 排查失败原因(查 `error_message` + 数据库实际状态)
2. 手工修复 schema(回滚已部分 commit 的 DDL,尤其 MySQL — DDL autocommit 后无法 rollback)
3. 手工 `DELETE FROM <history_table> WHERE module_id=? AND version=?`
4. 重新 `./application.kexe migrate up`

**MySQL 警告**: 多语句脚本中第 K 条 DDL 失败时,前 K-1 条已 autocommit,schema 处于半成状态。这是 MySQL 限制,不是 engine bug。建议 MySQL migration 拆细颗粒(单脚本只做一个 DDL)以缩小破坏面。PG/SQLite 走事务整体回滚,不受影响。

### 6.7 DDL bit-exact(三方言)

`historyTableDdl(dialect, tableName)` 输出由 [SchemaHistoryContractTest](../../../privchat/neton/neton-database/src/commonTest/kotlin/neton/database/migration/SchemaHistoryContractTest.kt) golden 锁定。任何 DDL 字节级改动必须先更新该测试。约束:

- 三方言 UNIQUE 都用**行内** `UNIQUE(...)`(MySQL 不再用 `UNIQUE KEY uq_${table}_...` 命名索引,避免 table 名接近 63 char 上限时索引名超过 MySQL 64 char 限制)
- `success` 列类型按方言原生表示(SQLite INTEGER / PG BOOLEAN / MySQL TINYINT(1)),写入走 dialect-specific literal(`TRUE/FALSE` vs `1/0`),读出兼容 `t/true/1`
- MySQL 显式 `COLLATE=utf8mb4_bin` — 防 collation 漂移影响 UNIQUE 大小写敏感性

---

## 七、明确禁止事项

> 以下事项是**架构红线**,任何 PR 都不允许引入。

```
禁止:

- application.kexe 正常启动(无 migrate 子命令)自动执行 migration
- 在 ModuleInitializer.initialize() 内触发 migration / 调 MigrationEngine
- 提供 `Neton.run { migrateAutomatically() }` 这种 opt-in 自动迁移 API
- 运行时(serve 模式)执行 ALTER TABLE / DROP / RENAME 等 DDL
- ensureTable() 隐式升级已存在的 schema
- 在 ModuleInitializer 中调用 ensureTable()
- 将 Flyway / Liquibase / sqlx::migrate! 等第三方运行时迁移工具内置进 neton-database
  (Neton 自带的 MigrationEngine 是 neton-database 内部能力, 不算第三方)
- 从远程 URL / 配置中心下载 SQL 脚本执行
- 多节点并发抢跑 migration —— 即使有 `application.kexe migrate up`, 部署流程也须保证单点执行
- 框架代码硬编码 history 表名(必须读 config, 默认 `neton_schema_history`)
- 用 ORM 反向工程(reverse engineering)从 entity 推导出"应有"的 schema 并自动应用
- 让 Legacy `neton-migrate` 独立 CLI 作为 application 部署的正式入口
  (它只用于 low-level / offline / debug 场景; 文档 / 教程 / CI 一律用 `application.kexe migrate`)
```

---

## 八、冻结约束

| 维度 | 冻结内容 |
|------|----------|
| **运行时行为** | `application.kexe`(serve 模式)**永远不**执行 schema 变更;startup 只检查 pending → fail-fast |
| **Migration engine 归属** | **`neton-database/.../migration/`**(MigrationEngine / MigrationSource / SchemaHistoryRepository / MigrationCommand) |
| **正式执行入口** | **`application.kexe migrate up | status | verify`**(canonical) |
| **Legacy CLI** | `neton-migrate` 独立 binary **不再作为 application 部署的正式入口**;仅保留 low-level / offline / debug 场景 |
| **`ensureTable()`** | 能力不再扩展,文档明确"非生产" |
| **SQL 资源路径** | 由 `ModuleInitializer.migrations()` 中的 `MigrationSource.resourcePath` 显式声明(框架不锁死目录约定);沿用现状 `<module>/sql/{dialect}/V*.sql` |
| **History 表** | 每 application 一张全局表(`UNIQUE(module_id, version)`);**表名由 config 配**,默认 `neton_schema_history`,框架不硬编码具体名字 |
| **默认命令集** | `status` / `up` / `verify`;`down` 不承诺 |

---

## 附录 A：常见误区

**Q：现在前端 Vue 项目都能 hot-reload，为什么数据库不能 hot-migrate？**
A：前端 hot-reload 影响的是单个浏览器 session；数据库 schema 变更影响的是**所有现存与未来**的应用实例 + 已存数据。两者风险量级完全不同。

**Q：开发环境很方便啊，启动就建表，为什么不延伸到生产？**
A：开发环境的便利来自"数据可以随时丢"。生产数据不能丢。区分开发/生产是有意为之，不是缺陷。

**Q：用 Flyway/Liquibase 不就解决了？为什么不直接集成？**
A:不引入 Java 生态依赖。Neton 自带的 MigrationEngine 在 `neton-database/.../migration/` 内,与 application 共享同一个 sqlx4k driver(K/N 链接器约束,见 NETON-DB-VARIANT),通过 `application.kexe migrate` 子命令调用,无需第三方运行时迁移工具。

**Q:那 Rails、Django 都有 `rake db:migrate` / `manage.py migrate`,它们也是运行时执行?**
A:不是,且 Neton 与之一致 —— `application.kexe migrate` 是**显式子命令**,由部署人员或 CI 显式调用,与 `application.kexe` serve 模式是两件事;serve 模式永不自动 migrate。Rails / Django 的 `migrate` 也是同一形态。

---

## 附录 C：Legacy `neton-migrate` CLI v0.1（deprecated as primary entry）

> **状态(2026-06-01)**:`neton-migrate` 独立 binary **deprecated as the primary Neton application migration entry**。
>
> Application 正式部署入口已切到 **`./application.kexe migrate up | status | verify`**(见 §五)。
>
> 本附录仅保留给以下场景:
> - 无 application 上下文的 low-level / offline 调试
> - 手动指定任意 `--driver / --uri / --dir` 检查 / 修复历史 schema
> - Neton 框架自身的 e2e 测试夹具
>
> **官方部署文档 / 教程 / CI script 一律使用 `application.kexe migrate`。** 不要再把 `neton-migrate` 写进 service deploy runbook。

### C.1 命令一览

```bash
neton-migrate status   # 列出已执行 / 未执行 / changed 脚本（read-only）
neton-migrate up       # 顺序执行未执行脚本，写入 history
neton-migrate verify   # 校验已执行脚本的 checksum（read-only）
```

### C.2 配置来源

优先级：**CLI flag > `config/database.conf` `[default]` 段**

```toml
# config/database.conf
[default]
driver = "mysql"
uri    = "mysql://root:secret@127.0.0.1:3306/myapp"
```

### C.3 典型场景

#### 全 CLI flag（CI/CD 推荐）

```bash
neton-migrate up \
  --driver mysql \
  --uri "mysql://root:secret@db.internal:3306/myapp" \
  --dir sql/mysql
```

#### 复用 database.conf

```bash
# 在工作目录下有 config/database.conf
neton-migrate status --dir sql/mysql
neton-migrate up     --dir sql/mysql
neton-migrate verify --dir sql/mysql
```

#### 三方言示例

```bash
neton-migrate up --driver sqlite     --uri /var/lib/myapp/data.db        --dir sql/sqlite
neton-migrate up --driver postgresql --uri "postgresql://u:p@h:5432/db"  --dir sql/postgresql
neton-migrate up --driver mysql      --uri "mysql://u:p@h:3306/db"       --dir sql/mysql
```

### C.4 退出码

| Exit | 含义 | 典型用法 |
|------|------|---------|
| `0` | OK / nothing to do | 部署可继续 |
| `1` | `status`: 有未执行脚本 | CI dry-run 提示 |
| `2` | `up`: 执行失败 | 部署中断 |
| `3` | checksum 不一致 / `verify` 时 history 表不存在 | 阻塞部署 |
| `4` | 数据库连接失败 | 检查网络/凭据 |
| `64` | 命令行参数错误 | 修正调用 |

### C.5 v0.1 不做清单

与 spec §5 边界一致：
- ❌ `down`（生产回滚需人工 SQL）
- ❌ dry-run / baseline
- ❌ dialect 自动推断（`--dir` 必须显式指向 `sql/{dialect}/`）
- ❌ 多节点并发锁（部署流程保证单点执行）
- ❌ 远程 SQL 下载

### C.6 部署流程示例（legacy, 仅供 low-level 场景参考）

> **正式 application 部署请改用 `application.kexe migrate`(见 §五)。** 本节保留只为 low-level / offline 调试参考。

```bash
#!/bin/bash
set -euo pipefail

# 1. dry-run: 仅检查是否有未执行脚本
neton-migrate status --dir sql/mysql || PENDING=$?

if [ "${PENDING:-0}" = "1" ]; then
    echo "Pending migrations detected, applying..."
    neton-migrate up --dir sql/mysql      # 失败立即非 0 退出
    neton-migrate verify --dir sql/mysql  # 兜底校验
fi

# 2. 启动应用 — 应用启动本身永不执行 migration
exec /usr/local/bin/myapp --env=prod
```

**等价的 canonical 写法**(application 部署推荐):

```bash
#!/bin/bash
set -euo pipefail

# 1. 检查 + 应用 pending migrations(由 neton-database engine 跨模块统一调度)
./application.kexe migrate status || PENDING=$?
if [ "${PENDING:-0}" = "1" ]; then
    ./application.kexe migrate up
    ./application.kexe migrate verify
fi

# 2. 启动 serve 模式 — application.kexe 无 args 时永不自动 migrate, schema 落后会 fail-fast
exec ./application.kexe
```
