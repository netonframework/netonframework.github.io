# Neton 内容平台套件架构

> 标识：NETON-APP-CONTENT-PLATFORM
> 日期：2026-10-15 · 状态：Draft
> 范围：content、comment、collect、push 以及后续 catalog、review、interaction、search 等开源模块的总体架构、统一契约和接入方式。各模块细节见各自规范。

## 1. 定位

一组**开源、可独立装配**的 Neton Application 模块，用来搭建「资讯 + 评测 + 社区」类平台。开发者（或通过 MCP 驱动的 AI 编程助手）挑选模块、注册自己的类型、写少量产品代码，就能得到一个完整产品：

| 平台形态 | 例子 | 主要用到 |
| --- | --- | --- |
| 科技资讯 | IT之家、cnBeta | content、comment、collect、push、search |
| 汽车资讯与评测 | 懂车帝、汽车之家、易车 | 上面全部 + catalog（车型库与参数）、review（口碑评分）、interaction（关注车系） |
| 数码评测 | 中关村在线、太平洋电脑网 | 同上，catalog 换成手机 / 电脑产品库 |
| 垂直知识 / 行业资讯 | 游戏、财经、医疗资讯 | content、comment、collect、search |

**itwind** 是官方样板应用（科技资讯），用来验证这套架构，并作为开源示例：谁能谈下内容合作，就可以基于同一套模块运营自己的平台。

## 2. 分层

```
┌──────────────────────────────────────────────────────────────────┐
│ 产品层       itwind · 汽车评测样板 · 你的应用                        │
│              品牌、类型注册、栏目配置、产品特有模块（如 newsroom）      │
├──────────────────────────────────────────────────────────────────┤
│ 内容平台套件  content · comment · collect · push                     │
│              catalog · review · interaction · search（规划中）       │
├──────────────────────────────────────────────────────────────────┤
│ 基础模块      system · infra · account · member · platform           │
├──────────────────────────────────────────────────────────────────┤
│ 契约库        neton-application-contract（对象引用、解析、事件信封）    │
├──────────────────────────────────────────────────────────────────┤
│ Neton 框架    core · http · routing · database · redis · jobs · ai    │
└──────────────────────────────────────────────────────────────────┘
```

依赖只能自上而下：
- 套件模块之间**互不依赖实现**，只依赖对方的契约（§4）。
- 基础模块不知道套件模块的存在。
- 框架不知道 Application 的存在。

## 3. 模块地图

| 模块 | 状态 | 一句话 | 规范 |
| --- | --- | --- | --- |
| content | 规范已定 | 通用 CMS：内容类型、分类法、合集（专题 / 推荐位）、版本审核、查询 | [content-module.md](content-module.md) |
| comment | 规范已定 | 通用评论：盖楼、楼中楼、支持反对、热评、治理、导入 | [comment-module.md](comment-module.md) |
| collect | 规范已定 | 通用采集：源、任务、内置 / 外部采集器、清洗、按规则投递 | [collect-module.md](collect-module.md) |
| push | 规范已定 | 通用推送：设备、主题、下发、多通道 | [push-module.md](push-module.md) |
| **catalog** | 规划 | 实体库：品牌 → 车系 → 车型、手机型号等层级实体；参数模板、参数配置表、对比 | 待写 |
| **review** | 规划 | 口碑评价：多维度评分、评价正文、聚合分与分布、真实性标记 | 待写 |
| **interaction** | 第一阶段 | 通用互动：收藏、点赞、关注、浏览足迹，可作用于任何对象 | 待写 |
| **search** | 规划 | 跨模块统一搜索：各模块推送索引文档，统一查询与联想 | 待写 |

社区（圈子 / 论坛 / 问答）、视频直播、报价与经销商这类形态差异大、领域性强的能力不放进套件，由产品层或后续独立模块解决。

### 3.1 拆分原则

一个能力单独成模块，要同时满足三条：
1. 至少两类平台形态都需要。
2. 能作用于多种对象，不绑定某一种业务实体。
3. 有自己的数据和生命周期。

不满足的能力留在使用它的模块里，或者放到产品层。例如：
- 收藏、足迹不放在 content 里：车型、评价也需要被收藏，所以从一开始就由 interaction 负责。
- 「热榜」只是查询方式，留在各自模块里。

## 4. 统一契约（neton-application-contract）

一个极小的公共库，只放跨模块共享的类型和接口，不含实现，不依赖任何模块：

### 4.1 对象引用

```kotlin
data class ObjectRef(val type: String, val id: String)   // 如 ObjectRef("content.item", "1024")
```

- 类型命名 `<模块>.<实体>`：`content.item`、`content.collection`、`catalog.entity`、`review.review`、`comment.comment`。
- 所有「作用于任意对象」的模块（comment、interaction、review、push 深链、search）都用 ObjectRef 指代目标，而不是各自约定字段。

### 4.2 对象解析

```kotlin
interface ObjectResolver {
    val type: String
    suspend fun resolve(ids: List<String>, viewer: Viewer?): Map<String, ObjectSummary>
}

data class ObjectSummary(
    val exists: Boolean,
    val visible: Boolean,                  // 对当前查看者是否可见
    val title: String,
    val summary: String?,
    val cover: String?,
    val link: ObjectLink,                  // app 深链 + web 地址
    val ownerUserIds: List<Long>,
    val capabilities: Set<String>,         // 如 "comment"、"favorite"、"review"、"share"
)
```

- 拥有对象的模块实现并注册解析器（content 注册 `content.item`，catalog 注册 `catalog.entity`）。
- 使用方模块通过 `ObjectRegistry` 批量解析，用于展示「原文：xxx」、校验对象能否被评论 / 收藏 / 评价、过滤已下线对象。
- `capabilities` 让对象自己声明能被做什么，例如单页（page）不可评论，草稿不可收藏。使用方不再各写判断。

### 4.3 事件

基于框架的 `DomainEventBus`：同步派发，或标记为可重试，由事件存储落库后异步投递。统一事件信封：

| 字段 | 说明 |
| --- | --- |
| `type` | `<模块>.<实体>.<动作>`，过去式：`content.item.published`、`comment.comment.created`、`collect.record.delivered` |
| `version` | 事件载荷版本，载荷不兼容变更时加一 |
| `subject` | ObjectRef |
| `actor` | 触发者（用户 / 管理员 / 系统 / 外部应用） |
| `occurredAt` | 发生时间 |
| `data` | 载荷：只放 ID 和少量摘要，消费方需要更多就回查 |

各模块在规范里列出自己发布的事件，这是公开契约的一部分。

### 4.4 投递 / 写入端口的放置

跨模块写入用的端口（`ContentDraftWriter`、`CommentImporter`、`CollectSink`……）定义在**提供方模块的 `contract` 子工程**里，见 §5.1。使用方只依赖这个子工程，不依赖实现；装配时由提供方注册实现，没装提供方时使用方拿不到实现，按「能力不可用」处理。

## 5. 模块标准结构

### 5.1 仓库与工程

```
neton-application-module-<name>/
├── contract/        # 公开契约：端口接口、DTO、事件类型、类型注册 API（纯 Kotlin，可被其他模块依赖）
├── src/             # 实现：controller / logic / model / table / init
├── sql/postgresql/  # 迁移脚本（编译进二进制，只经 migrate 执行）
├── mcp/             # MCP 能力声明（§7）
├── docs/            # 模块 README、接口文档、示例
└── build.gradle.kts
neton-application-front-<name>/   # 后台页面（front 模块契约）
```

### 5.2 必须遵守的约定

| 方面 | 约定 |
| --- | --- |
| 数据 | 只支持 PostgreSQL；表名以模块名为前缀；只经 migrate 建表和升级；不读别的模块的表 |
| 接口分组 | `/app/<模块>/*`（终端用户，账号令牌）、`/admin/<模块>/*`（后台，管理员令牌）、`/open/<模块>/*`（外部系统，platform appKey 签名） |
| 分页 | 列表默认游标分页（`cursor` + `limit`，响应带 `nextCursor`）；后台表格可用页码分页 |
| 写接口 | 支持 `Idempotency-Key` 请求头；批量接口返回逐条结果 |
| 错误 | 统一错误信封与错误码段（每个模块分配独立码段），用户可见文案走 i18n，不暴露内部异常 |
| 权限 | 权限点 `<模块>:<资源>:<动作>`，只声明，角色由 system 管理 |
| 配置 | 类型化配置定义，归 system 配置体系；不在代码里散落魔法值 |
| 类型扩展 | 内容类型、分类法、记录类型、字段类型、块类型等都通过注册表在代码中声明，后台只管实例数据 |
| 国际化 | 后台页面与错误文案中英双语起步；内容本身的多语言由 content 的多语言关联负责 |
| 测试 | 单元测试 + 真库测试（PostgreSQL）+ 契约测试（端口与事件载荷） |
| 文档 | 每个模块一份规范（本目录）+ 仓库内 README（安装、配置、示例） |

## 6. 装配与发行

- 产品是一个 Neton 发行版（fork `neton-application`），在构建配置里列出要装配的模块；未装配的模块不进二进制。
- 产品层做三件事：
  1. 注册类型（内容类型、分类法、实体类型、记录类型）。
  2. 写产品特有模块（如 itwind 的 newsroom）。
  3. 提供配置和种子数据（栏目、评价维度、采集源）。
- 后台前端同理：fork `neton-application-front`，装配各模块的后台页面包。
- 客户端（GearUI Kit）只调用各模块的 `/app/*` 接口；后续提供一套客户端 SDK 和通用页面组件（列表、详情、评论区、评分卡片），供各产品复用。

## 7. MCP 接入

两类 MCP 服务，分别面向「用模块搭应用」和「用应用干活」：

### 7.1 构建期：Neton Builder MCP

给 AI 编程助手用，帮开发者组装产品：

| 工具 | 作用 |
| --- | --- |
| `list_modules` / `describe_module` | 列出可用模块、读取模块规范、契约、配置项、事件 |
| `create_distribution` | 从 neton-application 创建产品发行版（后端 + 后台前端） |
| `add_module` / `remove_module` | 修改装配清单和依赖 |
| `scaffold_type` | 生成内容类型 / 实体类型 / 记录类型的注册代码与字段定义 |
| `scaffold_module` | 按模板生成产品特有模块 |
| `check_distribution` | 运行构建、迁移检查、契约测试 |

数据来源就是各模块的规范和 `contract` 子工程，所以规范和契约必须准确、完整。

### 7.2 运行期：模块 MCP

给已运行的应用接 AI 助手（编辑助手、运营助手），把模块能力暴露为 MCP 工具和资源：

- 每个模块在 `mcp/` 下声明能力，例如：
  - content：`query_items`、`get_item`、`create_draft`、`submit_for_review`
  - comment：`list_comments`、`moderate_comment`
  - collect：`run_task`、`list_records`
- 由一个通用的 MCP 服务端（Neton 框架提供协议实现，Application 层的 mcp 模块做装配和鉴权）统一对外提供。
- 鉴权：每个 MCP 客户端是 platform 模块里的一个应用。工具调用映射到对应的后台权限点，没有授权的工具不出现在工具列表里。
- 写操作默认只能产出草稿或待审结果，发布、删除这类动作需要显式授权。
- 所有工具调用写审计日志。

## 8. 样板应用

### 8.1 itwind（科技资讯，官方样板）

content + comment + collect + push + 产品模块 newsroom（AI 编辑部）。规范见 itwind-docs。

### 8.2 汽车资讯与评测（验证架构通用性的第二个样板，规划）

| 需求 | 实现 |
| --- | --- |
| 资讯、评测文章、视频、图集 | content：类型 `article`、`video`、`gallery`；分类法 `category`、`tag`、`brand` |
| 车型库：品牌 → 车系 → 车型，参数配置表、车型对比 | catalog：层级实体类型 `brand` / `series` / `model`；参数模板（基本参数、车身、发动机、电机、底盘……） |
| 文章关联车型 | content 的分类法用 catalog 实体作为词条来源（ObjectRef 引用） |
| 口碑：外观、内饰、空间、动力、操控、能耗、舒适、性价比打分 + 评价 | review：维度集按实体类型配置，聚合到车系和车型 |
| 关注车系、收藏文章 | interaction |
| 评论文章、评论口碑 | comment（对象类型 `content.item`、`review.review`） |
| 参数和资讯的数据来源 | collect：记录类型 `article`、`spec`（参数）、`price`，投递给 content、catalog |
| 销量榜、口碑榜 | catalog 和 review 各自的排行查询 |

## 9. 开源与版本

- **许可证**：待定（套件与样板应用统一选型）。
- **版本**：每个模块独立 semver；`contract` 子工程的变更决定主版本号。1.0 之前允许不兼容变更，但必须在 CHANGELOG 里写清楚迁移方式。
- **兼容矩阵**：套件发布时给出「框架版本 × 模块版本」的兼容表。
- **仓库**：每个模块一对仓库（服务端 + 后台页面），规范统一在 neton-docs。
- **质量门槛**：CI 跑构建、单测、真库测试、契约测试、前端类型检查和依赖审计（与 neton-application 现有 CI 同一套）。

## 10. 路线

| 阶段 | 内容 |
| --- | --- |
| 1 | 契约库；content、collect、comment、push、interaction 的 P1；itwind 跑通 |
| 2 | search；各模块 P2；模块 MCP |
| 3 | catalog、review；汽车评测样板；Builder MCP；客户端 SDK 与通用页面组件 |
