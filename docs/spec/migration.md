# Neton Migration Boundary Spec

> *Schema Governance — runtime 不参与 schema 演进*

> **状态**：边界冻结（Boundary Frozen）
> **实现状态**：暂缓（Deferred）
> **当前权威路径**：手动 SQL migration scripts（`sql/{dialect}/V*.sql`）
> **未来方向**：独立 `neton-migrate` CLI（不嵌入运行时）
> **明确禁止**：运行时自动 schema 变更
> **标签**：No runtime ALTER — Manual SQL is authoritative — CLI-only future evolution

---

## 目录

1. [设计原则](#一设计原则)
2. [模块边界](#二模块边界)
3. [当前权威路径](#三当前权威路径)
4. [`ensureTable()` 定位](#四ensuretable-定位)
5. [未来 neton-migrate CLI 边界](#五未来-neton-migrate-cli-边界)
6. [版本表规范](#六版本表规范)
7. [明确禁止事项](#七明确禁止事项)
8. [冻结约束](#八冻结约束)

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
| **`neton-database`** | 运行时 DB 访问（连接、查询、事务、Entity ↔ Row 映射） | 不做 schema 变更，不做版本管理 |
| **`neton-migrate`**（未来） | 迁移命令、版本表、SQL 脚本扫描与执行 | 不嵌入运行时，不在 app 启动期被调用 |
| **`neton-app`**（业务应用） | 启动 HTTP/数据库/任务/路由等组件 | 不 ALTER、不自动 migrate、不依赖 schema 变更 |

**关键约束**：`neton-database` 与 `neton-migrate` 是**互不依赖**的两个模块。运行时代码不允许 import migrate 能力；migrate CLI 也不应启动业务应用上下文。

---

## 三、当前权威路径

### 3.1 目录约定

```
neton-application/sql/
├── mysql/
│   ├── V001__create_tables.sql
│   ├── V002__init_data.sql
│   └── V003__add_indexes.sql
├── postgresql/
│   └── ...
└── sqlite/
    └── ...
```

### 3.2 命名规范

`V<version>__<description>.sql`

- `V` 大写前缀
- `<version>` 三位以上零填充数字（`001`、`002`、…），保证字典序 = 执行序
- 双下划线 `__` 分隔
- `<description>` 用 snake_case，简短描述

> 命名格式与 Flyway 兼容，但**不引入** Flyway 依赖。未来 `neton-migrate` 自己解析。

### 3.3 执行规则

- **本地开发**：开发者自行执行（`mysql < V001__create_tables.sql` 或 IDE 工具）
- **测试环境**：CI pipeline 显式执行 migration 步骤
- **生产环境**：由 CI/CD 部署流水线或 DBA 显式执行
- **顺序**：严格按版本号升序，不允许跳跃或乱序

### 3.4 与应用启动的关系

应用启动**只做**：
- 数据库连接探活（连不上则 fail-fast）
- （可选）读取版本表，校验当前 schema 版本是否在应用所需的兼容范围内

应用启动**不做**：
- 创建表、修改表、删除表
- 写入版本表
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

## 五、未来 neton-migrate CLI 边界

> **本节是预留设计，不是立即实现承诺**。当前不要写代码。

### 5.1 命令集（最小集）

| 命令 | 行为 | 备注 |
|------|------|------|
| `neton migrate status` | 显示已执行 / 未执行脚本列表，与 checksum 一致性 | 只读 |
| `neton migrate up` | 按版本顺序执行所有未执行的脚本，失败中断 | 默认行为 |
| `neton migrate verify` | 校验已执行脚本的 checksum 是否与磁盘一致 | 检测脚本被篡改 |

### 5.2 `down` 不在最小集内

- 生产环境通常**不允许**自动回滚（数据可能已写入新结构，回滚会丢数据）
- 如果未来要支持 `down`，必须设为 opt-in 且默认禁用
- 可以提供"生成 down SQL 模板"的能力，由人工执行

### 5.3 执行机制

```
1. 连接数据库
2. 确保版本表存在（neton_schema_history）
3. 扫描 sql/{dialect}/V*.sql，按版本号排序
4. 与版本表对比，找出未执行脚本
5. 顺序执行：
   a. 计算脚本 checksum
   b. 执行 SQL（在 transaction 内，如果方言支持 DDL transaction）
   c. 写入版本表（version, checksum, executed_at, duration_ms, success=true）
6. 任意一步失败 → 中断、写入失败记录、返回非 0 exit code
```

### 5.4 退出码契约

| Exit Code | 含义 |
|-----------|------|
| `0` | 全部成功（或已无需执行） |
| `1` | 有未执行脚本（用于 `status` 命令的 dry-run 模式） |
| `2` | 执行中失败 |
| `3` | checksum 校验失败（脚本被篡改） |
| `4` | 数据库连接失败 |

CI/CD 可基于退出码判断是否阻塞部署。

---

## 六、版本表规范

### 6.1 表名

`neton_schema_history`

### 6.2 表结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `version` | `VARCHAR(50)` PRIMARY KEY | 版本号，如 `001`、`002` |
| `description` | `VARCHAR(200)` | 脚本描述（取自文件名） |
| `script` | `VARCHAR(255)` | 脚本文件名 |
| `checksum` | `VARCHAR(64)` | SHA-256 hex |
| `executed_at` | `TIMESTAMP` | 执行时间 |
| `duration_ms` | `BIGINT` | 执行耗时 |
| `success` | `BOOLEAN` | 是否成功 |
| `error_message` | `TEXT` NULL | 失败时的错误信息 |

### 6.3 写入规则

- 每个脚本执行前后写一条记录
- 失败的执行也要记录（`success=false` + `error_message`）
- 已记录 `success=true` 的版本不再重复执行
- 已记录 `success=false` 的版本：默认要求人工介入（不自动重试）

---

## 七、明确禁止事项

> 以下事项是**架构红线**，任何 PR 都不允许引入。

```
禁止：

- App startup 时自动执行 migration
- 运行时自动 ALTER TABLE / DROP / RENAME
- ensureTable() 隐式升级已存在的 schema
- 在 ModuleInitializer 中调用 ensureTable()
- 将 Flyway / Liquibase / sqlx::migrate! 等运行时迁移工具内置进 neton-database
- 从远程 URL / 配置中心下载 SQL 脚本执行
- 多节点并发抢跑 migration（即使有了 CLI 也应在部署流程中保证单点执行）
- 把 migration 能力放在 neton-database 模块内
- 用 ORM 反向工程（reverse engineering）从 entity 推导出"应有"的 schema 并自动应用
```

---

## 八、冻结约束

| 维度 | 冻结内容 |
|------|----------|
| **运行时行为** | Neton app 启动**永远不**执行 schema 变更 |
| **`ensureTable()`** | 能力不再扩展，文档明确"非生产" |
| **当前路径** | `sql/{dialect}/V*.sql` 是 schema 唯一权威 |
| **未来扩展** | 只能通过独立 `neton-migrate` CLI 模块；不进 `neton-database` |
| **默认命令集** | `status` / `up` / `verify`；`down` 不承诺 |
| **版本表** | `neton_schema_history`，结构如 §6.2 |

---

## 附录 A：常见误区

**Q：现在前端 Vue 项目都能 hot-reload，为什么数据库不能 hot-migrate？**
A：前端 hot-reload 影响的是单个浏览器 session；数据库 schema 变更影响的是**所有现存与未来**的应用实例 + 已存数据。两者风险量级完全不同。

**Q：开发环境很方便啊，启动就建表，为什么不延伸到生产？**
A：开发环境的便利来自"数据可以随时丢"。生产数据不能丢。区分开发/生产是有意为之，不是缺陷。

**Q：用 Flyway/Liquibase 不就解决了？为什么不直接集成？**
A：可以用，但**不要内置进 neton-database**。如果团队选用 Flyway，应在部署流水线中独立调用，与 `neton-app` 启动解耦。本 spec 描述的 `neton-migrate` CLI 是 Neton 自有的轻量替代，避免引入 Java 生态依赖。

**Q：那 Rails、Django 都有 `rake db:migrate` / `manage.py migrate`，它们也是运行时执行？**
A：不是。`rake db:migrate` 是**独立 CLI 命令**，由部署人员或 CI 显式调用，与 web server 启动是两件事。Neton 的设计与之一致。
