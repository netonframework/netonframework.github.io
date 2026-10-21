# module-filter 通用筛选器

> 标识：NETON-APP-FILTER
> 日期：2026-10-17 · 状态：Draft r4（r2：放置位改为挂载，节点 code 对外、筛选器 id 内部绑定；r3：直接访问——模块原生接口带 `filter` 参数与统一接口，`publicAccess` 开关；r4：按 F1–F3 实现校准，见「实现状态」与各节的「实现」注）
> 仓库：`neton-application-contract`（契约 `contract.filter`）、`neton-application-module-filter`（服务端）、`neton-application-front-filter`（后台页面）
> 一份「存下来的查询」，任何模块的对象都能被它筛选；筛选器按 id 挂载到频道、楼层、分类节点、合集分区等节点上，对外请求节点（如 `/app/channel/fabuhui`）即返回挂载筛选器的结果；推送订阅、开放 API 也只引用筛选器。

## 实现状态（2026-10-17，F1–F3）

| 项 | 状态 |
| --- | --- |
| 契约 `contract.filter`（`neton-application-contract`）：SPI、值与条件树、公开 JSON 格式 `filterFormat: 1`、编译（§5.5 校验）、规范化器、参考求值器、排序、维度 / 数据源 / 挂载点注册表、`FilterEngine` / `FilterMounts`、一致性套件 | 已实现；内存数据源跑通套件，并验证套件能抓出「忽略 not」的错误实现 |
| module-filter：筛选器（草稿 / 已发布版本、保存即校验、成本上限、`broken` 与重新校验、引用关系、`FILTER_IN_USE`）、单源执行（游标绑定版本、卡片丢弃补足、`limit.max`、`partial`）、`publicAccess`、预览与执行计划、频道 / 楼层节点、挂载（有效期、一个节点一个生效挂载）、审计日志、后台与 App 接口 | 已实现（真库测试） |
| content：`content.item` 数据源（一致性套件真库全绿）、`content.term` 挂载点（REPLACE / PREPEND / APPEND）、`item/query` 的 `filter` 参数 | 已实现 |
| comment：`comment.comment` 数据源（一致性套件真库全绿） | 已实现 |
| itwind 宿主装配 + 端到端（`tests/e2e/filter-e2e.sh`） | 已实现 |
| 后台页面 `neton-application-front-filter` | 未做（接口已就绪，见 §14.1） |
| 跨源（维度空间、联邦归并）、子筛选器、维度映射到实体（`entity.*`） | 延后（F4）：编译时分别报 `CROSS_SOURCE_UNSUPPORTED`、`SUBFILTER_UNSUPPORTED` |
| 多键排序 | 延后（F4）：F1–F3 每个筛选器一个排序键（`SORT_UNSUPPORTED`） |
| content 内置筛选器 `content.collection:<code>`、合集分区挂载点 `content.collection_section`（规则条目） | 延后 |
| content 字段 `fields.<key>` | 延后（依赖 content P2 的 `content_field_index`） |
| 订阅匹配（`FilterObjectChanged` / `FilterMatched`，F5）、维度索引与物化（F6）、`filter_materialized` / `filter_index_entries` 表、结果缓存（§6.5） | 延后；一致性套件的「事件」组记为 skipped |
| 引用对象被删除时的即时重新校验 | 用定时任务 `filter-revalidate`（每 10 分钟）与后台「重新校验」代替；数据源 `schemaVersion` 变化在执行时即时校验 |

## 0. 一句话

**筛选能力属于平台，筛选对象属于模块。** 筛选器不放在 content 里：契约 `contract.filter` 在共享契约库，实现是独立的 module-filter；content、comment 与未来的商城、评测等模块只实现并注册数据源。这样跨源筛选器不归属任何业务模块，没装 content 的宿主（纯商城）也能用，业务模块之间也不产生依赖。 filter 模块只理解「结构」（数据源、字段、维度、条件树、排序、游标），不理解任何业务字段；分类、标签、合集、品牌、价格……全部由拥有数据的模块以「数据源」的形式声明并执行。未来的商城、评测、发布会、实体库模块接入，只需实现一个 `FilterSource` 并通过一致性套件。

## 1. 目标与边界

### 1.1 要解决的问题

| 场景 | 今天的做法 | 问题 |
| --- | --- | --- |
| App 顶部导航「最新 / 热榜 / 热评 / 事件 / 小米」 | 客户端写死几个、再拼服务端栏目 | 来自不同模块、列表项不是同一种对象，接不进来；运营不能配置 |
| 合集规则条目（content §7，P2） | 计划在 content 内写一条查询规则 | 只能筛 content，复用不了 |
| 推送圈人、「我关注的品牌有新内容」 | 未实现 | 每个模块各写一套「命中判断」 |
| 「所有跟小米有关的：新闻、商品、评测、发布会」 | 做不到 | 没有跨模块的统一语义 |

### 1.2 做什么

- **数据源注册**：模块声明可被筛选的对象类型、字段、运算符、排序键，以及字段对应的平台维度。
- **维度**：跨模块统一的语义坐标（时间、词条、实体、作者、地区、热度、价格……），让一条条件能同时作用于多个模块。
- **筛选器**：数据源（或维度空间）+ 条件树 + 排序 + 数量上限，保存时类型检查，有版本。
- **执行**：联邦执行（默认）与索引执行（规模化），对使用方透明；统一返回对象引用流（卡片）。
- **订阅匹配**：对象发布或变化时判断命中了哪些筛选器（推送、关注、缓存失效的基础）。
- **挂载**：把筛选器挂到节点上（频道、楼层、分类节点、合集分区……），对外请求节点、返回筛选器结果。
- **一致性套件**：证明任一数据源实现语义正确。

### 1.3 不做

- 任意 SQL、任意未声明字段、跨模块 join 表——模块之间只经契约组合（§7）。
- 全文检索的相关性排序——属于 search（§12.3），筛选器经维度 `text.query` 委托给它。
- 个性化推荐算法——推荐可以作为一个数据源接入（§12.4），筛选器不内置算法。
- 页面布局、模板渲染——挂载只描述「什么数据、什么卡片样式」，排版归客户端。

## 2. 概念

| 概念 | 说明 |
| --- | --- |
| **数据源 FilterSource** | 一类可被筛选的对象，由拥有它的模块实现，如 `content.item`、`comment.comment`、`commerce.product`、`review.review`、`launch.event`。code 与 `ObjectRef.type` 一致 |
| **字段 Field** | 数据源上可筛选的属性，带类型、允许的运算符、是否多值；可映射到一个维度 |
| **维度 Dimension** | 平台级语义坐标，跨数据源同名同义，如 `term.tag`、`entity.brand`、`time.published` |
| **排序键 Sort** | 数据源支持的稳定排序；跨源排序必须基于维度排序键 |
| **筛选器 Filter** | 一个已命名、已校验、有版本的查询定义 |
| **执行计划 Plan** | 规划器对筛选器选择的执行方式（单源 / 联邦归并 / 索引） |
| **卡片 Card** | 结果项：`ObjectRef` + `ObjectResolver` 解析出的显示摘要 + 排序值 |
| **订阅 Subscription** | 一个筛选器被声明为「需要推送命中」，对象变化时参与匹配 |
| **挂载 Mount** | 把筛选器（按 id）挂到一个节点上：频道、楼层、分类节点、合集分区……对外请求节点，返回筛选器结果 |

## 3. 维度

### 3.1 为什么需要维度

如果每个模块各自声明「品牌」字段，筛选器永远只能单源；「小米」在 content 里是标签、在商城里是品牌字段、在评测里是被评产品的品牌，彼此无法对齐。维度把这些字段**映射到同一个语义坐标**，坐标的值是对象引用而不是字符串，于是「小米」在所有模块里都是同一个 `catalog.brand:12`。

**跨模块统一靠共享语义坐标，不靠共享数据库。**

### 3.2 定义

```kotlin
// contract.filter
data class DimensionDefinition(
    val code: String,                 // "entity.brand"，<命名空间>.<名称>
    val name: String,                 // 「品牌」
    val valueType: FilterValueType,   // REF / ENUM / NUMBER / MONEY / DATETIME / BOOLEAN / TEXT / GEO
    val refType: String? = null,      // REF 时取值的对象类型，如 "catalog.brand"；后台据此提供选择器
    val multiple: Boolean = false,    // 一个对象可以有多个值（标签）
    val sortable: Boolean = false,    // 可作为跨源排序键
    val unit: String? = null,         // NUMBER 的单位；MONEY 自带币种
)
```

- 注册到 `FilterDimensionRegistry`（契约里定义；filter 模块 bootstrap 时 `bindIfAbsent`；装配期可变，`seal` 后只读——与 `CollectRecordTypeRegistry` 同一模式）。
- **谁定义谁负责语义**：平台内置一组通用维度；实体类维度由拥有实体的模块定义（品牌由 catalog 定义）。同一 code 只能注册一次，重复注册在启动时报错。
- 维度一经发布**不改语义**；需要变化时注册新 code（如 `metric.popularity.v2`），旧的标记弃用并给出迁移期。

### 3.3 内置维度

| code | 类型 | 说明 |
| --- | --- | --- |
| `time.published` | DATETIME，可排序 | 对外发布时间（UTC 毫秒） |
| `time.updated` | DATETIME，可排序 | 最近一次对外可见的更新 |
| `term.category` | REF `content.term`，多值 | 栏目类词条 |
| `term.tag` | REF `content.term`，多值 | 标签类词条 |
| `actor.author` | REF `account.user` 或外部作者 | 作者 / 发布者 |
| `geo.region` | GEO（行政区划码） | 地区 |
| `text.query` | TEXT（仅 match） | 关键词，委托 search（§12.3） |
| `metric.popularity` | NUMBER 0–1，可排序 | 归一化热度（§3.4） |
| `metric.price` | MONEY，可排序 | 价格（最小货币单位 + 币种） |
| `origin.source` | ENUM | 来源：原创 / 转载 / 采集 / 用户投稿 |

`entity.brand`、`entity.product`、`entity.series` 等由 catalog 模块注册；在 catalog 上线前，品牌类筛选用 `term.tag` 表达，catalog 上线后 content 可以把「关联实体」字段映射到 `entity.*`。

### 3.4 可排序维度的归一化

跨源结果要放在一起排序，排序值必须**可比**：

- 时间类维度天然可比。
- `metric.popularity` 由每个数据源自行换算到 [0, 1]：content 用阅读、评论、收藏的加权与时间衰减；商城用销量与转化；评测用有用数。**换算公式归数据源所有，但必须单调、有界、可复现**，并在数据源文档里写明。一致性套件校验取值区间与单调性（§9）。
- 金额只在同币种之间可比；混币种排序时规划器拒绝执行（`MIXED_CURRENCY_SORT`）。
- **实现**：首批数据源的换算都**不含时间衰减**——同一对象的热度随时间漂移会让键集游标在翻页中途失效；「新且热」用时间条件配合热度排序表达。
  - `content.item`：`s = 阅读 + 10 × 评论 + 5 × 收藏`，`p = s / (s + 1000)`。
  - `comment.comment`：`s = 支持 + 回复总数`，`p = s / (s + 20)`。评论自己的「最热」排序（`hot`，含时间锚的热度分）不映射到 `metric.popularity`，它不在 [0, 1] 内。

## 4. 数据源

### 4.1 SPI

```kotlin
// contract.filter —— 由拥有数据的模块实现
interface FilterSource {
    val code: String                          // == ObjectRef.type，如 "content.item"
    val name: String
    val schemaVersion: Int                    // 字段或语义变化时 +1
    val fields: List<FilterField>
    val sorts: List<FilterSortKey>
    val capabilities: Set<FilterCapability>

    /** 后台选择器候选值（栏目树、标签搜索、合集列表……）。只用于编辑，不参与执行。 */
    suspend fun options(field: String, query: String?, limit: Int, viewer: Viewer): List<FilterOption>

    /** 校验数据相关的部分（引用的词条是否存在等）；结构与类型已由平台检查。 */
    suspend fun validate(where: FilterExpr): List<FilterIssue>

    /** 执行：只会收到规范化后的、属于本源的条件。 */
    suspend fun execute(request: FilterExecRequest): FilterExecPage

    /** 订阅匹配与索引执行用：对象当前的维度与字段取值。 */
    suspend fun snapshot(ids: List<String>): Map<String, FilterSnapshot>

    /** 命中数；不支持时返回 null（预览显示「≥ N」）。now 与执行相同（可见性里的过期判断要用它）。 */
    suspend fun count(where: FilterExpr, viewer: Viewer, now: Long): Long?
}

data class FilterField(
    val key: String,                          // "category"、"tag"、"collection"、"hasCover"
    val label: String,
    val valueType: FilterValueType,
    val refType: String? = null,
    val multiple: Boolean = false,
    val operators: Set<FilterOp>,
    val dimension: String? = null,            // 映射到的维度，如 "term.tag"
    val adminOnly: Boolean = false,           // 只在后台可用（如审核状态），对外筛选器不可用
    val hasOptions: Boolean = false,          // 后台能否经 options 取候选值
    val includeChildren: Boolean = false,     // 层级词条：in 包含子节点（§5.3 第 5 条）
)

data class FilterSortKey(
    val key: String,                          // "published"、"views"、"ranking"
    val label: String,
    val dimension: String? = null,            // 可跨源时必须映射到可排序维度
    val windows: Set<String> = emptySet(),    // 需要周期的排序（"day"/"week"/"month"）
    val stable: Boolean = true,               // 能否支撑稳定游标（§6.4）
)

enum class FilterCapability { COUNT, SNAPSHOT, SUBSCRIBE, INDEX_EXPORT, TEXT_QUERY }
```

```kotlin
data class FilterExecRequest(
    val where: FilterExpr,                    // 规范化后的条件（§5.4），只含本源字段
    val sort: List<FilterSortSpec>,
    val viewer: Viewer,
    val cursor: String?,                      // 本源自己的不透明游标
    val limit: Int,
    val now: Long,                            // 相对时间已按此解析；数据源不得自取时钟
)
data class FilterExecPage(val items: List<FilterHit>, val nextCursor: String?)
data class FilterHit(val id: String, val sortValues: List<FilterValue>)   // 排序值供跨源归并
```

- **实现**：F1–F3 的 `sort` 恰好一个键；数据源遇到不支持的条件抛 `FilterUnsupportedException(FilterIssue)`，平台记日志并返回空页（不返回错误页）。
- **运算符对否定封闭**：规范化把 `not(a eq x)` 改写成 `a ne x`、`not(a in X)` 改写成 `a notIn X`，所以声明了 `eq` 的字段必须也能执行 `ne`，`in` 与 `notIn` 同理；`FilterSourceRegistry.check` 与一致性套件都检查这一点。

### 4.2 数据源的义务

1. **可见性**：只返回 `viewer` 有权看见、当前对外可用的对象（content：已发布、在有效期、可见性允许）。筛选器无法绕过访问策略。
2. **规范化输入**：只需处理 §5.4 的规范形式；遇到不支持的运算符返回 `FilterIssue`，不得静默忽略条件。
3. **稳定游标**：声明 `stable` 的排序键必须带唯一的决胜键（通常是 id），翻页期间有新对象插入也不重不漏（§6.4）。
4. **时钟**：使用请求里的 `now`，保证同一次执行跨源一致、可复现。
5. **维度一致**：字段映射到维度后，执行结果在该维度上的取值必须满足条件（一致性套件逐条校验）。
6. **事件**：声明 `SUBSCRIBE` 的数据源，在对象对外可见状态或维度取值变化时发布 `FilterObjectChanged`（§8.1）。

### 4.3 注册

```kotlin
// 模块 bootstrap（只依赖契约）
ctx.getOrNull(FilterSourceRegistry::class)?.register(ContentItemFilterSource(...))
```

- `FilterSourceRegistry` 在契约里定义。**实现**：数据源模块与 filter 模块都 `ctx.bindIfAbsent(FilterSourceRegistry::class, FilterSourceRegistry())` 后注册，与装配先后无关（与 `CollectSinkRegistry` 相同）；filter 在启动阶段（所有模块装配完之后的生命周期 `start`）`seal` 并检查，不通过直接启动失败。
- **宿主没装 filter 模块时**，注册表只是闲置，`ctx.getOrNull(FilterEngine::class)` / `FilterMounts` 为 null，模块照常运行——业务模块永远不依赖 filter 模块，只依赖契约。
- 数据源 code 必须已在 `ObjectRegistry` 注册了 `ObjectResolver`（结果要能解析成卡片），否则启动报错。

### 4.4 首批数据源

| 数据源 | 提供方 | 字段（→ 维度） | 排序键 |
| --- | --- | --- | --- |
| `content.item` | content | `type`；`category`（含子栏目，→ `term.category`）；`tag`（→ `term.tag`）；`collection`、`section`；`author`（→ `actor.author`）；`source`（→ `origin.source`）；`publishedAt`（→ `time.published`）；`hasCover`；`fields.<key>`（filterable 字段，延后）；`keyword`（→ `text.query`） | `published`（→ `time.published`）、`updated`（→ `time.updated`）、`views`、`comments`、`favorites`、`ranking`（day/week/month，非稳定）、`popularity`（→ `metric.popularity`）、`weight` |
| `comment.comment` | comment | `targetType`；`target`（REF 任意类型；子筛选器随 F4，§7.1）；`origin`；`createdAt`（→ `time.published`）；`author`（→ `actor.author`）；`topLevel` | `hot`（热度分，不映射维度）、`popularity`（→ `metric.popularity`）、`support`、`latest`（→ `time.published`） |

**实现说明**：

- `content.item` 的可见性与 content §8 通用查询相同（已发布、未过期、匿名看不到会员内容），另外单页（`page`）不进列表；不做置顶（排序只由排序键与 id 决定，可复现）。`category` 的快照取值是内容所在栏目及其全部祖先，`in` 因此命中子栏目；`source` 是来源类型（original / reprint / compiled）；`collection` / `section` 看合集手动条目，不看条目在位时间；`keyword` 是标题、摘要、正文纯文本的包含匹配（pg_trgm 之外的相关性排序归 search）。`ranking` 按统计表在「截止于请求 now 的窗口」内的阅读数排序，不在窗口里的计 0（排序不改变成员）；它依赖统计窗口，快照不提供它的排序值，一致性套件对它只比较集合。
- `comment.comment` 只取 `visible` 状态、所在对象未被锁定、且所在对象对访问者可见（经 `ObjectRegistry.describe`）。对象可见性不在评论库里，执行时按键集顺序批量扫描并跳过对象不可见的评论，所以不支持计数（`count` 返回 null）。

后续（各自模块上线时）：`newsroom.event`（itwind）、`commerce.product`、`review.review`、`catalog.entity`、`launch.event`、`video.video`。

## 5. 筛选器

### 5.1 定义

```json
{
  "code": "brand-xiaomi",
  "name": "小米",
  "scope": { "sources": ["content.item"] },
  "where": { "and": [
    { "target": "field:tag", "op": "in", "value": { "ref": ["content.term:18", "content.term:19"] } },
    { "not": { "target": "field:category", "op": "in", "value": { "ref": ["content.term:7"] } } }
  ]},
  "sort": [{ "key": "published", "dir": "desc" }],
  "limit": { "max": 500 }
}
```

| 部分 | 说明 |
| --- | --- |
| `scope.sources` | 一个数据源：条件可用该源的字段与维度。多个数据源：**跨源筛选器**，条件只能写在维度上（§7.2） |
| `where` | 条件树（§5.2） |
| `sort` | 排序键列表；跨源时只能用可排序维度 |
| `limit.max` | 结果总数上限（翻页到此为止），防止无界扫描；默认 1000，上限由配置决定 |

### 5.2 条件树（AST）

```
Expr      := And(Expr+) | Or(Expr+) | Not(Expr) | Pred
Pred      := (Target, Op, Value)
Target    := field:<key> | dim:<code>
Value     := Literal | Literal[] | Variable | SubFilter
Variable  := now | now-<duration> | viewer.<path>
SubFilter := { filter: <code>, project: dim:<code> | id }
```

值的 JSON 写法（公开格式，§15）：

| 值 | 写法 |
| --- | --- |
| 引用 | `{"ref": "content.term:18"}`；集合 `{"ref": ["content.term:18", "content.term:19"]}` |
| 文本 / 枚举 / 地区 | `"news"`；集合 `["news", "review"]` |
| 数字 / 时间（UTC 毫秒） / 布尔 | `5`、`1760000000000`、`true` |
| 金额 | `{"money": 1999, "currency": "CNY"}` |
| 变量 | `{"var": "now"}`、`{"var": "now-7d"}`、`{"var": "viewer.userId"}`（`account.user` 引用）；其他 `viewer.*` 由调用方经 `vars` 提供，取不到时与缺失值比较 |
| 范围 | `{"gte": …, "lt": …}`（`gte` / `gt` 二选一，`lte` / `lt` 二选一），边界可以是变量 |
| 时间窗（within） | `"7d"`，单位 `ms` / `s` / `m` / `h` / `d` / `w` |
| exists | `true` / `false` |
| 子筛选器 | `{"filter": "<code>", "project": "dim:<code>" | "id"}`（F4） |

谓词可带 `"optional": true`（§7.2）。规范化结果里的常量写作 `{"const": true}`（只出现在执行计划里）。

运算符（按值类型允许的子集，数据源在 `operators` 里声明自己支持哪些）：

| 运算符 | 语义 |
| --- | --- |
| `eq` / `ne` | 等于 / 不等于 |
| `in` / `notIn` | 属于集合；多值字段上 `in` 为**任一命中** |
| `all` | 多值字段**全部包含** |
| `range` | `{gte?, gt?, lte?, lt?}` |
| `within` | 相对时间窗：`within 7d` ≡ `range {gte: now-7d, lte: now}` |
| `exists` | 有值（`true`）/ 无值（`false`） |
| `match` | 关键词匹配，仅 `text.query` |

### 5.3 语义（规范性条款，一致性套件逐条测试）

1. **空值**：除 `exists` 与两个否定运算符外，任何比较对缺失值都为假；`not` 作用于缺失值为真（`not(tag in [x])` 命中没有标签的对象）。`ne` / `notIn` 定义为 `eq` / `in` 的**否定**，对缺失值为真——这样 `not(a in X)` ≡ `a notIn X`，否定范式的改写不改变语义。
2. **多值**：把取值看成元素列表（单值一个元素、缺失为空列表）：`eq` / `in` / `range` / `match` 为「存在一个元素满足」，`all` 为全部包含（值集合非空，编译时检查），`notIn` 为一个都不含。
3. **时间**：统一 UTC 毫秒；相对时间在一次执行开始时按 `now` 解析一次。
4. **REF 值**：以 `ObjectRef` 比较，不按名称；引用对象被删除时筛选器进入「需修复」（§5.6）。
5. **词条层级**：`term.category` 默认包含子栏目，由字段声明 `includeChildren`，不在运算符层面隐式展开。
6. **决定性**：同一筛选器、同一 `now`、同一数据快照，结果与顺序完全相同。

### 5.4 规范化

规划器在执行前把条件树转成规范形式，数据源只需处理规范形式：

1. 变量替换（`now-7d` → 具体时间；`viewer.followedBrands` → 引用集合）。
2. 否定下推到谓词（否定范式），`not(a in X)` → `a notIn X` 等。
3. 合并同目标谓词（两个 `range` 取交集；`in` 与 `in` 取交集；空集直接判假，整个分支短路）。**只对单值字段合并**：多值字段上 `tag in [a,b] and tag in [b,c]` 不等于 `tag in [b]`。
4. 维度谓词按数据源的字段映射**改写**为字段谓词（`dim:term.tag` → `field:tag`）；某源没有映射该维度时，该谓词对此源为假（或按 §7.2 的 `optional` 规则跳过）。
5. 常量折叠与扁平化（`and(and(a,b),c)` → `and(a,b,c)`）。

**实现**：规范形式里 `not` 只直接包着没有补运算符的谓词（`all`、`range`、`match`）；`within` 已展开为 `range`；变量已替换（取不到的变量使谓词为假）。可选谓词在没有映射时从父节点去掉，父节点变空时继续向上去掉。

### 5.5 校验（保存时，等同编译）

| 检查 | 失败码 |
| --- | --- |
| 数据源存在且当前角色有权使用 | `SOURCE_UNKNOWN` / `SOURCE_FORBIDDEN` |
| 目标存在；维度被所选数据源至少一个映射 | `TARGET_UNKNOWN` / `DIMENSION_UNMAPPED` |
| 运算符被该目标允许；值类型匹配 | `OPERATOR_NOT_ALLOWED` / `VALUE_TYPE_MISMATCH` |
| 引用的对象存在（数据源 `validate`） | `REF_NOT_FOUND` |
| 排序键存在；跨源时为可排序维度且各源都有映射 | `SORT_UNKNOWN` / `SORT_NOT_COMPARABLE` |
| 子筛选器存在、无环、投影维度类型匹配 | `SUBFILTER_UNKNOWN` / `SUBFILTER_CYCLE` / `PROJECTION_MISMATCH` |
| 成本：深度 ≤ 8、谓词 ≤ 64、`in` 集合 ≤ 1000、子筛选器嵌套 ≤ 2 | `FILTER_TOO_COMPLEX` |
| `adminOnly` 字段不能出现在可对外发布的筛选器中 | `ADMIN_ONLY_FIELD` |

所有错误带 JSON 路径（`where.and[1].not.value`），后台定位到具体条件。

**实现**：

- 另有结构类的码：`DEFINITION_INVALID`、`FORMAT_UNSUPPORTED`、`SCOPE_REQUIRED`、`EXPR_INVALID`、`LIMIT_INVALID`（`limit.max` 1..10000，默认 1000）；F4 之前的 `CROSS_SOURCE_UNSUPPORTED`、`SUBFILTER_UNSUPPORTED`、`SORT_UNSUPPORTED`（多于一个排序键）。
- 结构与类型检查在契约里（`FilterCompiler`），数据源权限（`filter:source:<code>`）与数据相关检查（数据源 `validate`）在 filter 模块。
- 保存草稿就做完整检查，不通过拒绝保存；接口返回 400、消息 `FILTER_INVALID`，`errors` 里每条是 `{field: JSON 路径, code, message}`。`POST /admin/filter/filter/validate` 只校验不保存，`POST /admin/filter/preview/run` 返回问题列表而不是错误。
- `ADMIN_ONLY_FIELD` 在发布时与开启 `publicAccess` 时检查（任何已发布的筛选器都可能被挂载对外）。

### 5.6 版本与生命周期

- 筛选器有**草稿**与**已发布版本**（`version` 递增）；挂载、订阅、子筛选器引用的都是已发布版本。编辑草稿不影响线上，预览用草稿。
- 每个已发布版本记录它校验时各数据源的 `schemaVersion`。数据源升级 schema 后，平台对引用它的已发布版本**重新校验**：
  - 通过：静默更新记录的 schemaVersion；
  - 不通过：状态改为 `broken`，原版本继续按「最后一次可执行的计划」服务或返回空（按筛选器设置 `onBroken: keep | empty`，默认 `keep`），后台告警并列出受影响的挂载节点。
- 引用的对象被删除（如标签被删）同样触发重新校验。
- 删除筛选器前检查被引用情况（挂载、订阅、其他筛选器的子筛选器），被引用时拒绝删除（`FILTER_IN_USE`）。
- **实现**：重新校验在三处触发——执行时发现记录的 `schemaVersion` 与数据源当前值不同（即时）、定时任务 `filter-revalidate`（每 10 分钟，覆盖引用对象被删除）、后台 `POST /admin/filter/filter/revalidate/{id}`。校验不通过时也记下当前 schema，避免每次请求重复校验。`keep` 按最后一次发布的定义继续执行；那份定义已无法在当前数据源上编译时返回空页。修复后（重新校验通过）状态回到 `active` 并写审计。停用（`disabled`）的筛选器：直接访问返回 `FILTER_DISABLED`，挂载节点回落到原列表。

## 6. 执行

### 6.1 入口

```kotlin
interface FilterEngine {   // filter 模块实现，契约里定义，使用方经 ctx.getOrNull 获取；按筛选器 id 寻址（§6.7 第 5 条）
    suspend fun run(filterId: Long, viewer: Viewer, cursor: String?, limit: Int,
                    vars: Map<String, FilterValue> = emptyMap(), access: FilterAccess = FilterAccess.DIRECT): CardPage
    /** 只要引用（模块原生接口自己装配 DTO）；source 不为 null 时要求范围恰好是这个数据源。 */
    suspend fun refs(filterId: Long, viewer: Viewer, cursor: String?, limit: Int,
                     vars: Map<String, FilterValue> = emptyMap(), access: FilterAccess = FilterAccess.DIRECT, source: String? = null): RefPage
    suspend fun explain(filterId: Long, viewer: Viewer): FilterPlan          // 后台「执行计划」
}
enum class FilterAccess { DIRECT, MOUNT, ADMIN }   // DIRECT 受 publicAccess 约束，挂载与后台不受
data class CardPage(val cards: List<Card>, val nextCursor: String?, val partial: Boolean = false)
data class Card(val ref: ObjectRef, val summary: ObjectSummary, val sortValues: List<FilterValue>, val view: JsonObject? = null)
```

- 结果经 `ObjectRegistry.describe` 批量解析成卡片；解析后不可见的对象（解析与执行之间状态变化）被丢弃，并向后补足本页。
- 卡片的 `view` 是拥有对象的模块给出的列表视图（`ObjectResolver.views`，content-platform-architecture §5.2），与该模块原生列表接口里的一项同形：`content.item` 是 `item/query` 的文章卡片，`comment.comment` 是「我的评论」的条目（`{comment, available, targetTitle, targetAppLink, targetWebLink}`）。`ObjectSummary` 只够通用客户端显示标题与封面（没有多图、列表样式、时间、计数、作者），原生客户端按 `ref.type` 解析 `view` 并沿用已有卡片；类型没有视图时 `view` 为 null。
- 访问方式见 §6.7（直接访问）与 §10.6（挂载节点）。

### 6.7 直接访问：模块原生接口与统一接口

筛选器不挂载也能被直接取用，有两种入口，按筛选器的范围选择：

| 入口 | 适用 | 返回 |
| --- | --- | --- |
| **模块原生接口 + `filter` 参数**，如 `GET /app/content/item/query?filter=50`、未来 `GET /app/commerce/product/query?filter=88` | 单源筛选器，且数据源属于该模块 | 该模块自己的列表 DTO，与不带 `filter` 时结构完全相同；客户端沿用已有模型与卡片 |
| **统一接口** `GET /app/filter/{id}?cursor=&limit=` | 跨源筛选器；或只需要卡片流的通用客户端、开放接口 | 卡片（`ObjectRef` + `ObjectSummary` + 排序值），客户端按 `ref.type` 渲染 |

规则：

1. **语义只有一份**：模块原生接口收到 `filter` 后交给 `FilterEngine`（契约里定义的执行入口，宿主没装 filter 时返回 `FILTER_UNAVAILABLE`），拿回 ID 与游标，再用自己的方式装配 DTO。模块不得自行解释条件树。
2. **范围必须匹配**：原生接口只接受 `scope.sources` 恰好是本接口数据源的筛选器，否则 `FILTER_SOURCE_MISMATCH`。
3. **不叠加条件**：带 `filter` 时，原生接口的其他条件参数（分类、标签、排序……）一律拒绝（`FILTER_EXCLUSIVE_PARAMS`），只保留分页与 `include` 这类返回控制参数。结果只由筛选器决定，不出现「两套条件混用、说不清结果怎么来的」。
4. **对外访问需显式开启**：筛选器有 `publicAccess` 开关（默认关）。关闭时两种直接入口都返回 `FILTER_NOT_PUBLIC`，筛选器只能经挂载对外或在后台预览——筛选器可能包含内部条件，且自增 id 可被遍历。挂载不受此开关影响（挂载本身就是发布行为）。
5. **按 id 寻址**：直接入口用筛选器 id（与挂载一致）；筛选器换 code 不影响已对接方。
6. 后台接口 `/admin/filter/preview/{id}` 可预览草稿，不受 `publicAccess` 限制，需 `filter:filter:query`。

错误码与 HTTP 状态（消息即机器码）：`FILTER_NOT_FOUND`（不存在或未发布，404）、`FILTER_DISABLED`（404）、`FILTER_NOT_PUBLIC`（403）、`FILTER_SOURCE_MISMATCH`（400）、`FILTER_EXCLUSIVE_PARAMS`（400）、`FILTER_UNAVAILABLE`（宿主没装 filter，503）、`CURSOR_STALE`（409）、`INVALID_CURSOR`（400）。content 的原生接口里，只有 `include`、`cursor`、`limit` 可以与 `filter` 同时出现。

### 6.2 执行策略

| 策略 | 何时 | 做法 |
| --- | --- | --- |
| **单源** | `scope.sources` 只有一个 | 规范化后直接交给该源 `execute` |
| **联邦归并** | 多个源，未启用索引 | 每源执行自己的部分（各取 `limit` 条），按维度排序值做多路归并；游标为各源游标的组合 |
| **索引** | 跨源且该筛选器启用了索引（或规划器判断联邦代价过高） | 在统一维度索引上执行，得到引用后批量解析（§6.3） |

规划器按「涉及的源、各源能力、历史耗时」选择策略；`explain` 返回选择结果与原因。**使用方对策略无感知，接口与结果语义相同**——这是允许系统从联邦起步、规模化后切换索引而不改任何使用方的前提。

### 6.3 维度索引（P3）

- 声明 `INDEX_EXPORT` 的数据源在对象变化时推送维度快照：`(ref, dims, sortValues, visibility, updatedAt)`。
- 初版存在 filter 模块自己的表 `filter_index_entries`（PostgreSQL：维度用 GIN 索引的数组列与范围列）；接口 `FilterIndexBackend` 可替换为 OpenSearch / Meilisearch。
- 索引里的可见性只是**粗过滤**：最终可见性仍由 `ObjectResolver` 在解析时判定（与 §6.1 的丢弃补足一致），所以索引滞后不会泄露不可见对象。
- 该索引与 search 模块共享（§12.3）。

### 6.4 游标与稳定性

- 单源游标由数据源生成，对平台不透明。
- 联邦游标 = `base64(json{ sources: { "content.item": "<游标>", "commerce.product": "<游标>" }, lastSortValues, filterVersion })`。
- 游标绑定筛选器版本：版本变化后旧游标返回 `CURSOR_STALE`，客户端从第一页重新加载（与 comment 热评快照过期同样处理）。
- 稳定性：排序键 + 决胜键（id）构成全序，数据源按「大于上一页最后一条」续取（keyset 分页），不用 offset。
- **实现**：单源游标也由平台包一层 `base64url(json{t: 版本标签, n: 首页的 now, c: 已返回条数, s: 数据源游标})`：版本标签不一致返回 `CURSOR_STALE`；整轮翻页沿用首页的 `now`（相对时间窗不漂移）；已返回条数用于 `limit.max`。决胜键 id 按（长度, 字典序）比较，对非负整数 id 等同数值顺序，方向与排序键相同。

### 6.5 缓存与物化

- 结果缓存键：`(筛选器版本, 规范化后的变量值, 游标, limit, viewer 可见性分组)`；可见性分组由数据源声明（如「匿名 / 登录 / 会员」），个性化变量（`viewer.*`）的筛选器不跨用户共享缓存。
- **物化**（按筛选器开关）：定时刷新前 N 条引用存入 `filter_materialized`，供首页、高频频道读取；订阅匹配（§8）可在命中时增量失效。

### 6.6 限额

单次执行超时（默认 3 秒）、每源单页上限、子筛选器结果集上限（默认 10 000，超出时报 `SUBFILTER_TOO_LARGE` 并在保存时提示）。超时返回已得到的部分与 `partial: true`，不返回错误页。

## 7. 跨模块组合

模块之间**不 join 表**。组合只有两种方式，都只经契约。

### 7.1 子筛选器（半连接）

条件的值可以是另一个筛选器的结果，在某个维度上的投影：

```json
{ "target": "dim:entity.product", "op": "in",
  "value": { "filter": "review-score-gt8", "project": "dim:entity.product" } }
```

「评分 8 分以上的评测所评的商品」= 商城数据源 + 上面的条件。执行时先跑子筛选器（取已发布版本，结果集有上限），把投影出的引用集合代入外层，再交给外层数据源。子筛选器结果可缓存，与外层独立。

### 7.2 跨源筛选器（维度空间）

`scope.sources` 有多个时，条件只能写在维度上，排序只能用可排序维度：

```json
{
  "code": "xiaomi-everything",
  "scope": { "sources": ["content.item", "commerce.product", "review.review", "launch.event"] },
  "where": { "target": "dim:entity.brand", "op": "in", "value": { "ref": ["catalog.brand:12"] } },
  "sort": [{ "key": "dim:time.published", "dir": "desc" }]
}
```

- 某源没有映射条件里的维度：默认该源对这条谓词为假（不贡献结果）；谓词可标 `optional: true`，表示「该源没有这个维度时忽略这条谓词」。
- 后台的预览显示每个源贡献了多少条，以及哪些源因为维度缺失被排除，避免「以为跨了四个源、其实只命中一个」。
- 跨源结果的卡片类型各不相同，客户端按 `ref.type` 选择卡片样式（§10.2）。

## 8. 订阅匹配

同一份筛选器定义，既能**拉**（查询），也能**推**（命中通知）。

### 8.1 事件

```kotlin
// contract.filter；数据源在对象对外可见状态或维度取值变化时发布（可重试投递，事件信封同套件约定）
data class FilterObjectChanged(
    val ref: ObjectRef,
    val change: String,                       // "available" / "updated" / "unavailable"
    val snapshot: FilterSnapshot?,            // unavailable 时为 null
    val occurredAt: Long,
)
data class FilterSnapshot(val fields: Map<String, FilterValue>, val dims: Map<String, FilterValue>, val sortValues: Map<String, FilterValue>)
```

### 8.2 匹配

- 筛选器设置 `subscribable: true` 后进入匹配集（要求其所有数据源声明 `SUBSCRIBE`，且条件不含 `viewer.*` 变量与排序相关条件）。
- 匹配器维护**谓词倒排**：从每个可订阅筛选器的规范形式中挑出最具选择性的等值 / `in` 谓词作为索引键；事件到达时按快照取候选筛选器，再对候选做精确求值（在快照上求值，不回查数据源）。
- 求值器就是 §5.3 语义的参考实现——同一份代码也用于一致性套件的断言，保证「查得到」与「推得到」一致。
- 命中结果发布 `FilterMatched(filterCode, version, ref, change)`；push、物化缓存、合集规则刷新各自订阅。
- **至少一次**：同一对象多次变化可能重复命中，消费方按 `(filterCode, ref, change)` 幂等。

### 8.3 用户订阅

用户「关注小米」= 一条以 `viewer` 无关条件表达的订阅筛选器 + 订阅关系（存在 interaction 的关注里，目标是 `filter.filter:<id>` 或 `catalog.brand:12`）。推送按 `FilterMatched` 查订阅者下发，push 只认对象与订阅关系，不理解条件。

## 9. 一致性套件

契约库提供 `FilterSourceConformanceSuite`（与 HTTP 引擎一致性套件同一思路）：数据源实现者提供一组样本对象与一个「写入样本 / 清理」的夹具，套件自动生成并执行测试。

| 组 | 内容 |
| --- | --- |
| 运算符语义 | §5.3 的每一条：空值、多值 `in` / `all` / `notIn`、范围边界、相对时间、`not` 对缺失值 |
| 参考求值对照 | 随机生成规范化条件树，`execute` 结果与参考求值器在 `snapshot` 上的结果必须相同（集合与顺序） |
| 游标稳定 | 逐页读取期间插入、删除对象，结果不重不漏；翻完一轮与一次读完相同 |
| 可见性 | 未发布、过期、无权限对象在任何条件、任何排序下都不出现 |
| 维度一致 | 结果的维度取值满足维度谓词；字段到维度的映射与 `snapshot` 一致 |
| 归一化 | `metric.popularity` 在 [0, 1]；对同一对象单调（热度只因计数增加而增加） |
| 决定性 | 同 `now`、同数据，两次执行完全相同 |
| 事件 | 可见状态与维度变化都发出 `FilterObjectChanged`，快照与 `snapshot()` 一致 |

**数据源合入的门槛是套件全绿**。未来商城、评测、发布会模块「接入筛选器做对了没有」由测试证明，不靠人工评审。

## 10. 挂载

筛选器本身没有对外地址。它通过**挂载**出现在某个节点上：频道、楼层、分类节点、合集分区、商品类目页……对外请求的是节点（`/app/channel/fabuhui`），返回的是挂在上面的筛选器（#50）的结果。

### 10.1 原则

1. **对外用节点的 code，内部绑定筛选器的 id。** 节点地址稳定；筛选器改名、改 code、换成另一个筛选器，客户端与已分享的链接不受影响。挂载按 `filter_id` 引用，不按 code。
2. **挂载改变节点「显示什么」，不改变「什么属于它」。** 分类「发布会」挂了筛选器后，该分类的对外列表返回筛选结果；但文章的分类归属、后台按分类查文章、面包屑、筛选器里的 `category in [发布会]` 条件，全部按**归属**计算，不受挂载影响。因此不会出现循环，也不会出现「文章在这个分类、后台却查不到」。
3. **挂的是已发布版本。** 编辑筛选器草稿不影响线上节点；筛选器发布新版本后，所有挂载点同时切换。
4. **谁能被挂载由拥有节点的模块声明**（与数据源同一模式），挂载关系统一存在 filter 模块，所有挂载可追踪、可告警。

### 10.2 挂载点类型（由模块注册）

```kotlin
// contract.filter
data class MountPointType(
    val code: String,                 // "filter.channel"、"content.term"、"content.collection_section"、"commerce.category"
    val name: String,
    val nodeRefType: String,          // 节点的 ObjectRef.type，挂载记录以 ObjectRef 指向节点
    val modes: Set<MountMode>,        // 节点支持的挂载方式
    val acceptSources: Set<String>?,  // 允许挂哪些数据源的筛选器；null = 任意
    val requiredPermission: String? = null,                 // 节点模块的权限，如 "content:term:update"
    val nodeExists: (suspend (id: String) -> Boolean)? = null, // 校验节点存在
)
enum class MountMode { REPLACE, PREPEND, APPEND }
```

**实现**：`filter.channel` / `filter.block` 的 `nodeRefType` 与挂载点同名，节点引用形如 `filter.channel:12`（节点 id）；`content.term` 的节点引用是 `content.term:<词条 id>`，`acceptSources = {content.item}`，要求 `content:term:update`。

- 注册到 `FilterMountRegistry`（契约里定义，filter 模块 `bindIfAbsent`、装配后 `seal`）。
- 首批挂载点：

| 挂载点 | 提供方 | 说明 | 方式 |
| --- | --- | --- | --- |
| `filter.channel` | filter | App 顶部导航频道 | REPLACE（频道本身没有原生列表） |
| `filter.block` | filter | 首页 / 落地页的分区块（标题 + N 条 + 「更多」） | REPLACE |
| `content.term` | content | 栏目 / 标签节点的对外列表 | REPLACE / PREPEND / APPEND |
| `content.collection_section` | content | 合集分区（即原「规则条目」，§12.1） | APPEND（手动条目在前，筛选器补足） |

- 节点要挂载才能存在的（频道、楼层），由 filter 自己管理节点；节点本来就存在的（分类、合集分区、商品类目），节点归原模块，filter 只存挂载关系。

### 10.3 挂载方式的语义

| 方式 | 结果 |
| --- | --- |
| `REPLACE` | 节点的对外列表 = 筛选器结果 |
| `PREPEND` | 筛选器结果在前（最多 `mount.limit` 条），节点原列表在后；按 `ref` 去重，筛选器结果优先 |
| `APPEND` | 节点原列表在前，原列表翻完后接筛选器结果；按 `ref` 去重 |

组合列表的游标由节点所属模块生成（它知道原列表的游标），内部记录「当前在原列表 / 在筛选器结果」与两边各自的游标。

**实现（content）**：游标为 `("m", 挂载 id, 阶段 f|n, 已取筛选器条数, 内层游标)`；挂载换了或被取消后旧游标返回 `CURSOR_STALE`。PREPEND 未设 `limit` 时取 20 条；原列表排除前 `limit` 条筛选器结果。APPEND 的筛选器结果里，属于该节点（原列表已出现过）的去掉。挂载只在「只按一个词条取列表」时生效：`category`（或 `categoryId`）、或恰好一个标签，且没有其他条件参数（`includeChildren`、`include`、`cursor`、`limit` 除外）；带任何其他条件的查询按归属执行，不受挂载影响。

### 10.4 节点模块如何接入

```kotlin
// contract.filter —— filter 模块实现，节点所属模块在返回节点列表时调用
interface FilterMounts {
    /** 节点当前生效的挂载（已过有效期、已停用的不返回）；没有返回 null。结果短时缓存。 */
    suspend fun mountOf(node: ObjectRef): FilterMount?
}
data class FilterMount(val filterId: Long, val version: Int, val mode: MountMode, val limit: Int?, val cardStyle: Map<String, String>)
```

content 返回分类列表时：

```kotlin
val mount = ctx.getOrNull(FilterMounts::class)?.mountOf(ObjectRef("content.term", termId))
when (mount?.mode) {
    null -> 原有列表
    REPLACE -> filterEngine.run(mount)                    // 只返回筛选结果
    PREPEND, APPEND -> 组合原列表与筛选结果（§10.3）
}
```

宿主没装 filter 时 `getOrNull` 为 null，节点按原样工作。

### 10.5 模型

| 表 | 关键字段 |
| --- | --- |
| `filter_nodes` | id, kind（`channel` / `block`）, code（唯一，对外地址）, name, settings（text JSON：`pinned`、`defaultVisible`、`userAddable`、图标、每页条数）, sort, status, start_at?, end_at? —— 只存 filter 自己管理的节点 |
| `filter_mounts` | id, mount_point（`filter.channel` / `content.term` / …）, node_ref（`type:id`）, filter_id, mode, item_limit?（`limit` 是保留字）, card_style（text JSON：每种对象类型的卡片样式，如 `{"content.item":"auto","comment.comment":"quote"}`）, status, start_at?, end_at?, created_by, updated_at；**唯一(node_ref, 生效中)**：一个节点同一时刻只有一个生效挂载 |

- 有效期：可以预先挂一个「发布会当天」的筛选器，到点生效、过期自动回落到节点原列表或上一个长期挂载（按 `start_at` / `end_at` 选生效的那条）。**实现**：生效挂载 = 启用、在有效期内、筛选器已发布且未停用的挂载里 `start_at` 最晚的一条（长期挂载 `start_at` 为空，视为最早）；两条启用挂载有效期重叠且开始时间相同时无法决定，保存时拒绝（`MOUNT_CONFLICT`）。`mountOf` 结果在本节点缓存 10 秒，挂载变更时清空。
- 挂载、换挂、取消写审计日志。
- `filter_references` 由挂载自动维护（referrer_kind = `mount`）：删除或停用筛选器前能看到它挂在哪些节点上；筛选器进入 `broken` 时告警到具体节点。

### 10.6 接口

| 接口 | 说明 |
| --- | --- |
| `GET /app/channel/list` | 频道列表（已按状态、有效期过滤），含每个频道的卡片样式 |
| `GET /app/channel/{code}?cursor=&limit=` | 频道内容：按 code 找到节点 → 生效挂载 → 筛选器已发布版本 → 卡片流 |
| `GET /app/block/{code}?limit=` | 楼层内容 |
| 节点所属模块的原接口 | 如 `GET /app/content/item/query?category=fabuhui`：按 §10.4 自动应用挂载，接口不变 |
| `GET /app/filter/{id}?cursor=&limit=` 与模块原生接口的 `filter` 参数 | 不经挂载、直接按筛选器取（§6.7）；需筛选器开启 `publicAccess` |

- 匿名只读接口（`/app/channel/*`、`/app/block/{code}`、`/app/filter/{id}`）不按 IP 限流：结果可缓存，网页服务端渲染的请求都来自同一个出口 IP，按 IP 限流会让所有访客一起被限（爬虫翻频道分页触发 429 还会让页面变成 500）；防刷由边缘（CDN / nginx）负责，搜索与写接口照常限流（public-routes §5、site-module §13）。
- 用户的频道定制（增删、排序）：未登录存在客户端；登录后存账号偏好（account 的偏好设置），服务端只校验频道仍存在且 `userAddable`。

**实现的响应形状**（统一信封 `{code, message, data}`）：

- `GET /app/channel/list` → `data: [{code, name, settings, sort, cardStyle}]`；没有生效挂载的频道不下发。`settings` 是节点设置原样（`pinned`、`defaultVisible`、`userAddable`、`icon`、`pageSize`……）。
- `GET /app/channel/{code}?cursor=&limit=` → `data: {node: {code, name, settings, sort, cardStyle}, list: [Card], nextCursor, partial}`；`limit` 默认取 `settings.pageSize`，否则 20，上限 100。频道不存在或不在有效期 404 `CHANNEL_NOT_FOUND`；没有生效挂载时 `list` 为空。
- `GET /app/block/{code}?limit=` → 同上，`nextCursor` 恒为 null；默认 `settings.pageSize`，否则 6，上限 50；不存在 404 `BLOCK_NOT_FOUND`。
- `GET /app/filter/{id}?cursor=&limit=` → `data: {list: [Card], nextCursor, partial}`。
- `Card` = `{ref: {type, id}, summary: ObjectSummary（exists、visible、title、summary、cover、link{app,web}、ownerUserIds、capabilities）, sortValues: [值], view?: 列表视图（§6.1）}`；值的 JSON 见 §5.2。
- 客户端按 `ref.type` + `card_style` 渲染；遇到不认识的卡片类型时跳过，不报错（新模块上线不破坏旧客户端）。
- 编辑型推荐（手工挑选、自定义标题封面）仍然是 content 的合集，不在 filter 里重做；频道要展示一个合集时，挂 content 提供的内置筛选器 `content.collection:<code>`。

## 11. 数据表

| 表 | 关键字段 |
| --- | --- |
| `filter_filters` | id, code（唯一）, name, scope（text JSON）, draft（text JSON：草稿定义）, published_version, status（`active` / `broken` / `disabled`）, on_broken, public_access, subscribable, materialize, remark, created_at, updated_at |
| `filter_versions` | id, filter_id, version, definition（text JSON）, normalized（text JSON：规范形式缓存）, source_schema（text JSON：{source: schemaVersion}）, published_by, published_at；唯一(filter_id, version) |
| `filter_references` | filter_id, referrer_kind（`mount` / `filter` / `subscription`）, referrer_id；唯一(filter_id, referrer_kind, referrer_id) |
| `filter_nodes`、`filter_mounts` | 见 §10.5 |
| `filter_materialized` | filter_id, version, position, ref, sort_values, refreshed_at |
| `filter_index_entries`（P3） | ref, source, dims（text JSON + 生成的数组 / 范围列）, sort_values, visibility_group, updated_at |
| `filter_audit_logs` | id, subject_type（`filter` / `node` / `mount`）, subject_id, action（created / updated / published / disabled / enabled / broken / repaired / deleted / mounted / remounted / unmounted）, actor_kind, actor_id, detail, created_at |

**实现**：V001 建了 `filter_filters`、`filter_versions`、`filter_references`、`filter_nodes`、`filter_mounts`、`filter_audit_logs` 与后台菜单；`filter_materialized`、`filter_index_entries` 随 F6。

所有 JSON 字段存 `text`（套件统一约定），需要时临时 `::jsonb`。

## 12. 与其他模块的关系

### 12.1 content

- 实现 `content.item` 数据源，内部复用 §8 的列表查询（补上 `or` / `not` 与 `notIn` / `all`）。
- `GET /app/content/item/query` 增加 `filter` 参数（§6.7），带它时由 `FilterEngine` 执行、content 装配原有 DTO。
- 合集规则条目（content §7，原 P2「`content_collection_sections.rule`」）改为**引用筛选器**：分区配 `filterCode`，手动条目优先，筛选器补足数量。content 只依赖契约里的 `FilterEngine`，宿主没装 filter 时规则条目不可用，手动条目照常。
- 提供内置筛选器 `content.collection:<code>`，让频道等节点直接挂载编辑型合集。

### 12.2 comment

实现 `comment.comment` 数据源；`target` 字段接受子筛选器（「小米文章下的热评」）。

### 12.3 search

search（套件架构 §2.1「待写」）负责**相关性**：分词、召回、打分。filter 负责**结构化条件**。两者的接合：

- `text.query` 维度的 `match` 谓词由 search 执行，返回候选引用集合与相关性分；filter 把它当作一个特殊的子筛选器与其他条件求交，排序可以用相关性。
- 维度索引（§6.3）与 search 的倒排索引是同一份对象快照的两种索引，写入口统一，避免各模块推两遍。search 规范写作时以本节为前提。

### 12.4 推荐

个性化推荐作为一个数据源（如 `rec.feed`）接入：它的「条件」是推荐场景参数，结果是带分数的引用流。筛选器可以对推荐结果再做结构化过滤（子筛选器），频道可以挂推荐数据源的筛选器，与编辑筛选器并列。筛选器本身不内置推荐算法。

### 12.5 push 与 interaction

push 订阅 `FilterMatched` 按订阅关系下发；interaction 的「关注」目标可以是筛选器或实体。两者都不理解条件。

## 13. 权限点

| 权限点 | 用途 |
| --- | --- |
| `filter:filter:query` / `create` / `update` / `publish` / `delete` | 筛选器管理（发布与编辑分开，便于审核） |
| `filter:source:<source>` | 允许在某个数据源上建筛选器（没有商城权限的编辑看不到商城数据源） |
| `filter:node:query` / `create` / `update` / `delete` | 频道、楼层节点管理 |
| `filter:mount:update` | 在节点上挂载、换挂、取消挂载（节点所属模块的权限另需具备，如挂到分类需 `content:term:update`） |
| `filter:index:rebuild` | 重建维度索引（P3） |
| `filter:mount:query` | 挂载列表页 |
| `filter:audit-log:query` | 操作记录页 |

**实现**：菜单种子另有按钮「使用全部数据源」`filter:source:*`（通配，评估规则同 rbac-spec §4.2），默认授予 `super_admin`；没有它也没有 `filter:source:<code>` 的管理员在该数据源上建、改筛选器报 `SOURCE_FORBIDDEN`。

筛选器、节点与挂载的创建、发布、变更、删除写审计日志。

## 14. 后台（neton-application-front-filter）

- **筛选器编辑器**：先选数据源（或「跨源·按维度」），条件编辑器按 schema 动态生成——引用类字段弹出对应选择器（栏目树、标签搜索、合集列表，经数据源 `options`），值类型决定输入控件；支持 and / or / not 分组、变量、子筛选器。
- **实时预览**：命中数（或「≥ N」）、前 20 张卡片、每源贡献、被排除的源及原因。
- **执行计划**：`explain` 的结果——策略、规范化后的条件、各源耗时。
- **校验错误**定位到具体条件（§5.5 的 JSON 路径）。
- **引用关系**：每条筛选器显示挂在哪些节点上（频道、分类、合集分区……）以及被哪些订阅、筛选器引用；`broken` 状态置顶告警。
- **频道与挂载管理**：频道排序（拖拽）、有效期、卡片样式；在任意挂载点上选择筛选器与挂载方式（分类、合集分区的编辑页里也能直接挂）；预览按 App 的卡片样式渲染。

### 14.1 后台接口（已实现）

| 接口 | 权限点 |
| --- | --- |
| `GET filter/filter/page?keyword&status&source&pageNo&pageSize`（broken 置顶）、`GET filter/filter/get/{id}`（草稿、已发布定义、规范形式、引用）、`GET filter/filter/versions/{id}`、`GET filter/filter/references/{id}`、`POST filter/filter/validate`（`{definition, forPublish}` → `{ok, issues}`） | `filter:filter:query` |
| `POST filter/filter/create`（`{code, name, definition, publicAccess, onBroken, remark}`） | `filter:filter:create` |
| `PUT filter/filter/update`（同上 + `id`，保存草稿）、`PUT filter/filter/update-status/{id}?status=active|disabled`、`POST filter/filter/revalidate/{id}` | `filter:filter:update` |
| `POST filter/filter/publish/{id}` | `filter:filter:publish` |
| `DELETE filter/filter/delete/{id}` | `filter:filter:delete` |
| `GET filter/preview/{id}?cursor&limit`（草稿：`{ok, issues, count, cards, nextCursor, partial, plan}`）、`POST filter/preview/run`（未保存的 `{definition, limit}`） | `filter:filter:query` |
| `GET filter/source/list`（数据源字段 / 排序 / 能力 / 当前管理员是否可用、维度、挂载点）、`GET filter/source/options?source&field&query&limit` | `filter:filter:query` |
| `GET filter/node/page?kind&keyword&status`、`GET filter/node/get/{id}`（含生效挂载） | `filter:node:query` |
| `POST filter/node/create` / `PUT filter/node/update`（`{id, kind, code, name, settings, sort, status, startAt, endAt}`）/ `DELETE filter/node/delete/{id}`（同时取消其挂载） | `filter:node:create` / `update` / `delete` |
| `GET filter/mount/page?mountPoint&nodeRef&filterId`、`GET filter/mount/points`、`GET filter/mount/of?nodeRef`、`GET filter/mount/get/{id}` | `filter:mount:query` |
| `POST filter/mount/save`（`{id, mountPoint, nodeRef | nodeId, filterId, mode, limit, cardStyle, status, startAt, endAt}`，id 为 0 新建）、`DELETE filter/mount/delete/{id}` | `filter:mount:update`（+ 挂载点的 `requiredPermission`） |
| `GET filter/audit-log/page?subjectType&subjectId` | `filter:audit-log:query` |

（路径省略前缀 `/admin/`。）

## 15. 实现约定

- 契约（`contract.filter`）只放接口、数据结构、维度注册表、规范化与参考求值器、一致性套件；不含任何存储与 HTTP。参考求值器放在契约里，是为了让数据源实现者、订阅匹配器与一致性套件用同一份语义代码。
- 条件树、维度、运算符的 JSON 表示是**公开格式**，版本号 `filterFormat: 1` 写在定义里；格式升级提供迁移器，旧格式在迁移期内只读。
- 数据源不可以「顺手」接受未声明的字段或运算符——宽松实现会让筛选器在换源或换执行策略时行为改变。
- MCP：筛选器的「列出数据源 / 字段、校验、预览、发布」暴露为 Builder MCP 工具，让 AI 按自然语言建筛选器时也走同一套类型检查（套件架构 §9）。

## 16. 分期

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| F1 契约与核心 | `contract.filter`（SPI、AST、维度注册表、规范化、参考求值器、一致性套件）；module-filter：存储、版本、校验、单源执行、预览、`/app/filter/{id}`；后台编辑器（单源） | 契约单测；一致性套件能对一个内存数据源跑通 |
| F2 首批数据源 | content `content.item`、comment `comment.comment` | 两个源一致性套件全绿；后台建「小米」「热榜·周」「热评」三条筛选器并预览正确 |
| F3 挂载与 itwind | 频道 / 楼层节点，`content.term` 挂载点；itwind 顶部导航改为服务端下发（最新 / 热榜 / 热评 / 小米） | itwind 真机验收；E2E 覆盖频道增删与卡片混排 |
| F4 跨模块 | 维度映射、跨源联邦归并、子筛选器；content 合集规则条目改为引用筛选器 | 跨源 E2E（content + comment 混排）；子筛选器 E2E |
| F5 订阅 | `FilterObjectChanged`、匹配器、`FilterMatched`；push 按筛选器圈人 | 发布即命中、推送到设备的 E2E；查与推一致性测试 |
| F6 索引 | 维度索引、规划器自动选择、物化 | 跨源压测：同一筛选器联邦与索引结果一致，延迟对比 |

newsroom（itwind B2）、商城、评测、发布会等模块在各自上线时提供数据源，不排在本模块的分期里。

## 17. 待定项（有默认值，不阻塞开工）

| 项 | 默认 |
| --- | --- |
| 频道、楼层节点放在 filter 模块还是独立 feed 模块 | 放在 filter 模块（§10） |
| 内置维度的范围 | §3.3 所列；实体类维度归 catalog |
| 筛选器发布是否需要审核 | 不需要；`publish` 权限与编辑分开即可 |
| 用户频道定制存哪 | account 偏好设置 |
| 索引后端 | PostgreSQL 起步，`FilterIndexBackend` 可替换 |
