# module-content 通用内容模块（CMS）

> 标识：NETON-APP-CONTENT
> 日期：2026-10-15 · 状态：Draft r2
> 仓库：`neton-application-module-content`（服务端）、`neton-application-front-content`（后台页面）
> 参照：WordPress、PHPCMS、DedeCMS 的内容建模方式，取其通用部分，去掉模板引擎、静态生成等与 headless 架构无关的部分。

## 1. 目标与原则

一个模块覆盖「文章站、资讯站、产品展示、下载站、知识库、单页官网」这类站点的内容管理需求，靠**配置和类型定义**适配不同业务，而不是每个产品各写一套。

| 原则 | 含义 |
| --- | --- |
| **一张内容表** | 所有内容（文章、单页、视频、下载、产品……）都存在 `content_items`；差异由「内容类型」描述，类型特有字段放 `fields`（jsonb）。不像 DedeCMS 那样一个模型一张附加表，也就不需要运行期建表 |
| **分类法统一** | 栏目、标签、品牌、地区……都是「分类法」下的「词条」，一套表、一套接口（WordPress 的 taxonomy 模型） |
| **合集统一** | 专题、推荐位、幻灯、头条、编辑精选、碎片，都是「合集」（PHPCMS 推荐位 + DedeCMS 专题 / 自由列表合并成一个概念） |
| **类型在代码里定义** | 内容类型、字段、分类法由模块或产品在代码中注册，有类型、可校验、可评审；后台只做实例数据（栏目、词条、合集、内容）的管理。这和 system 模块的类型化配置定义（ConfigDefinition）同一思路 |
| **Headless** | 只提供数据和接口，不渲染页面、不生成静态 HTML；正文是结构化块，App 和 Web 各自渲染 |
| **能力按需开启** | 版本、评论、投稿、收藏、定时发布等都是类型上的开关，不用的类型不产生额外数据 |

**不做**：模板引擎和静态页生成、站点导航菜单、广告位投放、问答 / 留言板 / 投票等独立应用、多站点 / 多租户、会员体系（交给 account / member）、评论（交给 [module-comment](comment-module.md)）、推送（交给 [module-push](push-module.md)）、附件存储（交给 infra 文件服务）。

## 2. 概念对照

| 本模块 | WordPress | PHPCMS | DedeCMS |
| --- | --- | --- | --- |
| 内容类型 ContentType | Post Type | 模型 | 频道模型（channeltype） |
| 字段定义 FieldDefinition | Custom Fields / post meta | 模型字段 | 附加表字段 |
| 内容 Item | Post | 内容 | 文档（archives + addon） |
| 分类法 Taxonomy | Taxonomy | — | — |
| 词条 Term | Term | 栏目 / 关键词 | 栏目（arctype）/ Tag |
| 栏目（分类法 `category`） | Category | 栏目 | 栏目 |
| 合集 · 专题 Collection(`topic`) | — | 专题 | 专题 |
| 合集 · 推荐位 Collection(`slot`) | Sticky / 小工具 | 推荐位 | 头条 / 推荐 / 幻灯等属性、自由列表 |
| 版本 Revision | Revision | — | — |
| 投稿 Submission | Contributor 草稿 | 投稿 | 会员投稿 |

## 3. 内容类型与字段

### 3.1 内容类型

```kotlin
ContentTypeDefinition(
    code = "article",                 // 唯一，进库
    name = I18nText("文章", "Article"),
    features = setOf(                 // 能力开关，见下表
        Feature.BODY, Feature.SUMMARY, Feature.COVER, Feature.AUTHOR, Feature.SOURCE,
        Feature.REVISIONS, Feature.SCHEDULE, Feature.COMMENTS, Feature.FAVORITES,
        Feature.SUBMISSION, Feature.SEO,
    ),
    taxonomies = listOf("category", "tag"),     // 可挂的分类法
    fields = listOf(/* FieldDefinition，见 3.2 */),
    slugPolicy = SlugPolicy.AUTO,               // 自动 / 手填 / 不用
)
```

| Feature | 打开后 |
| --- | --- |
| `BODY` | 有结构化正文（§5） |
| `SUMMARY` / `COVER` | 摘要 / 封面图（多图：主图 + 三图样式） |
| `AUTHOR` / `SOURCE` | 作者（用户或署名）/ 来源名称与原文链接（原创、转载、整理） |
| `REVISIONS` | 保存即生成版本，线上版本与草稿分离（§6） |
| `REVIEW` | 发布前必须审核（也可以在栏目上单独配置，§4.2） |
| `SCHEDULE` | 定时发布、定时下线 |
| `COMMENTS` | 注册为 comment 模块的可评论对象 |
| `FAVORITES` / `HISTORY` | 收藏 / 浏览足迹 |
| `SUBMISSION` | 允许终端用户投稿 |
| `SEO` | SEO 标题、关键词、描述、规范链接 |
| `PASSWORD` / `MEMBERS_ONLY` | 密码访问 / 登录可见 |

内置两个类型：`article`（文章）、`page`（单页，无分类、无评论，用于关于我们、协议等）。产品按需注册更多类型，例如 `video`（时长、播放地址）、`download`（版本、大小、下载地址）、`product`（价格、规格、图集）。

### 3.2 字段

```kotlin
FieldDefinition(
    key = "duration", type = FieldType.INT, label = I18nText("时长(秒)", "Duration"),
    required = false, filterable = true, sortable = true,
    validation = FieldValidation(min = 0),
)
```

- **字段类型**：`text`、`textarea`、`rich`（结构化块）、`int`、`decimal`、`bool`、`date`、`datetime`、`select`（单选 / 多选，选项在定义里）、`image`、`images`（图集）、`file`、`url`、`color`、`item_ref`（引用其他内容）、`term_ref`（引用词条）、`json`（逃生口）。
- 字段类型本身也可扩展：`FieldTypeRegistry.register(...)`，提供校验和后台编辑控件的 key。
- 值统一存在 `content_items.fields`（jsonb），写入时按定义校验，未定义的键拒绝。
- **只有标记 `filterable` / `sortable` 的字段**会同步一份到 `content_field_index`（键值索引表），用于按字段筛选和排序；其余字段不建索引，不付额外成本。
- 字段增删不需要 DDL：jsonb 和索引表都是通用结构。字段改类型或下线时，迁移脚本（migrate）负责清理旧值。

### 3.3 注册方式

模块或产品在初始化时注册：

```kotlin
contentRegistry.registerType(ArticleType)
contentRegistry.registerTaxonomy(BrandTaxonomy)
```

注册结果和数据库里已有数据做一致性检查：库里存在、代码里已删除的类型，启动时报警并拒绝写入该类型，不静默丢数据。

## 4. 分类法与栏目

### 4.1 分类法

```kotlin
TaxonomyDefinition(
    code = "category", name = I18nText("栏目", "Category"),
    hierarchical = true,          // 树形（栏目）还是扁平（标签）
    multiple = false,             // 一条内容可挂一个还是多个词条
    required = true,
    freeInput = false,            // 编辑时能否直接输入新词（标签是 true）
)
```

内置：`category`（栏目：树形、单选、必填）、`tag`（标签：扁平、多选、可自由输入）。产品可以注册 `brand`、`region`、`series` 等。

### 4.2 词条与栏目设置

- 词条：名称、slug、父级、排序、描述、封面、SEO，以及 `settings`（jsonb，按分类法定义的设置项校验）。
- 树用「父 ID + 物化路径」存储，查「某栏目及所有子栏目」是一次前缀查询。
- **栏目（`category` 的词条）额外设置**，对应 PHPCMS / DedeCMS 栏目属性：

| 设置 | 说明 |
| --- | --- |
| `kind` | `list`（列表栏目）/ `page`（单页栏目，直接绑定一条 page）/ `link`（外链栏目） |
| `allowedTypes` | 允许发布的内容类型，如资讯栏目只允许 `article` |
| `requireReview` | 本栏目内容是否必须审核 |
| `allowSubmission` | 是否接受用户投稿 |
| `allowComment` | 是否允许评论（类型开了 `COMMENTS` 才有意义） |
| `listOrder` | 默认排序：发布时间 / 权重 / 更新时间 |
| `visible` | 是否在 App / Web 的栏目列表里出现（隐藏栏目仍可通过接口访问） |
| `extra` | 产品自定义的展示参数（列表样式、图标等），模块原样透传 |

### 4.3 栏目级权限（可选）

角色和权限点由 system 模块管理，本模块只声明权限点（§11）。如需「编辑 A 只能管 手机 栏目」，用 `content_term_grants(role_id, term_id, actions)` 声明栏目范围，授权到某栏目即包含其子栏目。不配置时按权限点全局生效。

## 5. 内容

### 5.1 字段

| 分组 | 字段 |
| --- | --- |
| 身份 | id, type, slug（类型内唯一）, locale?, translation_group?（多语言版本互相关联，可选） |
| 标题 | title, subtitle?, title_style?（颜色 / 加粗，DedeCMS 的标题样式） |
| 列表展示 | summary, cover(jsonb：主图 + 可选多图), list_style?（大图 / 单图 / 三图 / 无图，空则客户端自动判断） |
| 正文 | body（结构化块，见 5.2）, fields（jsonb，类型字段） |
| 归属 | primary_term_id（主栏目，决定默认链接）, 作者：author_user_id? / author_name, 来源：source_name? / source_url?, origin(`original`/`reprint`/`compiled`) |
| 状态 | status（§6）, visibility(`public`/`members`/`password`), password_hash?, redirect_url?（跳转型内容） |
| 时间 | published_at, scheduled_at?, expire_at?, created_at, updated_at |
| 排序 | weight（越大越靠前）, pinned_until?（全局置顶到期时间）；栏目内置顶见 5.3 |
| 计数 | view_count, comment_count, favorite_count（冗余计数，详细统计见 §9） |
| SEO | seo_title, seo_keywords, seo_description, canonical_url |
| 生产 | producer?, producer_ref?（外部写入方标识，§10.3）, submitter_user_id?（投稿人，§11）, published_revision_id |

### 5.2 结构化正文

正文是有序的块数组，不存 HTML：

| 块 | 属性 |
| --- | --- |
| `paragraph` | 文本 + 行内标记（粗体、斜体、下划线、删除线、行内代码、链接、@内容引用） |
| `heading` | 级别 2–4、文本 |
| `image` | url、宽、高、说明、alt |
| `gallery` | 图片数组、展示方式 |
| `quote` | 文本、出处 |
| `list` | 有序 / 无序、条目（可嵌套一层） |
| `code` | 语言、代码 |
| `table` | 表头、行 |
| `divider` | — |
| `video` / `audio` | url、封面、时长 |
| `embed` | provider、url、数据（扩展用；客户端不认识时降级为链接卡片） |
| `item_card` | 引用站内另一条内容 |

- 块类型可扩展（`BlockTypeRegistry`），新块必须声明降级方式。
- 导入 HTML（编辑器粘贴、外部写入方）时按白名单转换为块，转不了的标签丢弃并记录。
- 提供 `blocks → HTML` 和 `blocks → 纯文本` 两个转换器，分别给 Web SSR 和搜索、摘要生成使用。

### 5.3 内容与词条、合集

- `content_item_terms(item_id, term_id, taxonomy, sort)`：内容挂多个分类法的词条；主栏目另存在 `primary_term_id`，同时也在关联表里。
- **栏目内置顶**：关联表上的 `pinned_until`，只在该栏目列表里置顶。
- 推荐、头条、幻灯这类 DedeCMS 属性**不做成内容上的标记位**，统一放进合集（§7），一条内容可以同时在多个推荐位里、各自有排序和有效期。

### 5.4 相关内容

`content_item_relations(item_id, related_id, kind, sort)`：手动指定相关内容、系列上下篇等。没有手动指定时，详情接口按「同标签 > 同栏目」自动补齐。

## 6. 状态、版本与审核

```
draft ──提交──► pending ──通过──► published ──下线──► offline
  ▲               │  └──定时──► scheduled ──到点──┘      │
  └──── 驳回 ◄────┘                                     ▼
                                    trash（回收站，可恢复；定期彻底删除）
```

- **版本**（类型开了 `REVISIONS`）：每次保存生成 `content_revisions` 记录，保存标题、摘要、封面、正文、字段、词条快照。线上只展示 `published_revision_id` 指向的版本；已发布内容再编辑，新版本审核通过前线上保持旧版本。
- **自动保存**：编辑器每隔一段时间写一个自动保存版本，同一编辑者只保留最新一份，不进版本列表。
- **编辑锁**：打开编辑时加锁（带心跳），别人打开时提示「xx 正在编辑」，可强制接管。
- **审核**：类型或栏目要求审核时走 pending；通过、驳回（附原因）、下线都写 `content_review_logs`。审核策略可替换：`ContentPublishPolicy` 决定某次提交是否免审（例如外部写入方的自动发布规则）。
- **定时**：定时发布、定时下线由 neton-jobs 扫描执行。
- **删除**：进回收站（`trash`），保留期后由任务彻底删除，删除时发出事件让评论、收藏等关联数据一并清理。

## 7. 合集：专题与推荐位

| kind | 用途 | 有落地页 | 分区 |
| --- | --- | --- | --- |
| `topic` | 专题（发布会专题、年度盘点） | 有：标题、横幅、导语、正文块 | 有（如「新闻」「评测」「图赏」） |
| `slot` | 推荐位 / 碎片：首页幻灯、头条、编辑精选、侧栏推荐 | 无，只被页面调用 | 无 |

**数据**

| 表 | 关键字段 |
| --- | --- |
| `content_collections` | id, kind, code（推荐位按 code 调用）, title, slug, cover, banner, intro, body（块，仅 topic）, settings(jsonb), status, start_at?, end_at?, sort |
| `content_collection_sections` | id, collection_id, title, sort, rule?(jsonb) |
| `content_collection_entries` | id, collection_id, section_id?, item_id?, 或外链（title、url、image）, title_override?, cover_override?, summary_override?, sort, start_at?, end_at? |

- **手动条目**：编辑把内容加进合集，可以为这个位置单独改标题和封面（首页幻灯常用短标题、横图），可设置在位时间。外链条目用于推广活动页等站外内容（PHPCMS 碎片的用途）。
- **规则条目**：分区或推荐位可以配一条查询规则（§8 的查询条件），自动填充，例如「手机栏目近 24 小时阅读量前 5」；手动条目优先，规则补足数量。
- 推荐位 `slot` 的数量、图片尺寸要求等写在 `settings`，后台按此校验。

## 8. 查询

一个通用的列表查询（相当于 WordPress 的 WP_Query、DedeCMS 的 arclist 标签），App、Web、合集规则都用它：

| 条件 | 说明 |
| --- | --- |
| `types` | 内容类型 |
| `terms` | 词条（可指定是否包含子栏目），多个分类法之间是「且」，同一分类法内可选「或 / 且」 |
| `collection` / `section` | 合集或分区内的条目 |
| `author` / `source` | 作者 / 来源 |
| `fields` | 按 filterable 字段筛选：等于、范围、包含 |
| `keyword` | 关键词（走 §9 搜索） |
| `publishedAfter` / `publishedBefore` | 时间范围 |
| `hasCover` | 只要有图的（幻灯规则常用） |
| `exclude` | 排除的 ID |
| `sort` | `published` / `updated` / `weight` / `views` / `comments` / `favorites` / `ranking(day\|week\|month)` / sortable 字段 |
| 分页 | 游标分页（列表、无限滚动）或页码分页（后台、Web 列表页） |

- 默认只返回 `published`、在有效期内、可见性允许当前用户的内容；置顶内容排在前面。
- 返回字段可选：列表默认不含正文和 fields，需要时按字段名声明（`include=fields.duration`），控制响应体大小。
- 后台查询额外支持状态、编辑者、审核人等条件。

## 9. 统计、排行与搜索

- **阅读计数**：浏览事件先在 Redis 累加，定时批量回写 `view_count` 和按日统计表 `content_item_stats_daily(item_id, day, views, comments, favorites)`。同一设备短时间内重复浏览只计一次。
- **排行**：日 / 周 / 月榜按日统计表聚合，结果缓存，定时刷新。
- **搜索**：`ContentSearchEngine` 接口。默认实现用 PostgreSQL `pg_trgm` 索引标题、摘要和正文纯文本，`ILIKE` 加相似度排序；需要中文分词或大规模检索时换成 zhparser 或外部搜索引擎，接口不变。搜索只覆盖已发布、公开的内容。

## 10. 扩展点

### 10.1 事件

`ContentSaved`、`ContentSubmitted`、`ContentPublished`、`ContentUnpublished`、`ContentTrashed`、`ContentDeleted`、`TermChanged`、`CollectionChanged`。事件携带 ID 和必要摘要，订阅方按需回查。推送、搜索索引、缓存失效、静态站重建等都靠订阅事件实现，不写进本模块。

### 10.2 端口

| 端口 | 用途 | 默认实现 |
| --- | --- | --- |
| `ContentRegistry` | 注册类型、分类法、字段类型、块类型 | 内置 |
| `ContentPublishPolicy` | 决定一次提交是否免审 | 按类型 / 栏目配置 |
| `ContentSearchEngine` | 搜索 | pg_trgm |
| `ContentAuthorResolver` | 作者展示资料（昵称、头像） | 经 member 适配器读取 |
| `ContentMediaResolver` | 图片和附件地址、尺寸 | infra 文件服务 |
| `CommentTargetResolver`（实现方） | 向 comment 模块声明可评论对象 | 类型开了 `COMMENTS` 时自动注册 |

### 10.3 外部写入端口

供其他模块交付内容，例如 [module-collect](collect-module.md) 的 `content.draft` 投递端口、产品的 AI 编辑部、导入工具：

```kotlin
interface ContentDraftWriter {
    /** 按 (producer, producerRef) 幂等：已有内容就新增一个版本，没有就新建草稿。 */
    suspend fun upsertDraft(input: ContentDraftInput): ContentDraftResult
    suspend fun submit(itemId: Long, note: String? = null)
}
```

写入的数据同样经过类型校验和审核流程；是否免审由 `ContentPublishPolicy` 决定（写入方可以注册自己的规则）。本模块不依赖任何写入方。

## 11. 用户侧能力

- **投稿**（类型开了 `SUBMISSION`、栏目允许投稿）：终端用户提交的内容直接进 `content_items`，状态 pending，记录投稿人 `submitter_user_id`；后台审核通过即发布，或转给编辑继续加工。投稿人可在「我的投稿」查看状态和驳回原因。投稿只开放类型声明为可投稿的字段。
- **收藏 / 足迹**：`content_favorites`、`content_histories`（同一内容重复浏览只更新时间，按用户保留最近 N 条）。

## 12. 接口

**App / Web（`/app/content/*`，匿名可读，写操作需账号令牌）**

| 接口 | 说明 |
| --- | --- |
| `GET term/tree?taxonomy=category` | 栏目树（只含 visible） |
| `GET term/list?taxonomy=tag&...` | 词条列表（热门标签等） |
| `GET item/query` | §8 通用查询 |
| `GET item/get/{id}`、`GET item/resolve?type&slug` | 详情（按 ID 或 slug）；记一次浏览，登录用户写足迹 |
| `GET item/ranking?period&by` | 排行 |
| `GET item/search?q` | 搜索 |
| `GET collection/get/{code}` | 推荐位或专题（含分区与条目） |
| `POST/DELETE favorite/{id}`、`GET favorite/page` | 收藏 |
| `GET history/page`、`DELETE history` | 足迹 |
| `GET submission/form?type`、`POST submission/create`、`GET submission/mine` | 投稿 |

**后台（`/admin/content/*`）**：类型与字段（只读，展示注册结果）、分类法与词条、栏目设置、内容（列表、编辑器、版本对比与回滚、提交、审核、定时、置顶、回收站）、合集（专题、推荐位、条目编排）、投稿审核、审核日志、统计。

**开放接口（`/open/content/*`，platform appKey 签名）**：给外部系统的只读查询和受控写入（写入走 §10.3 同一套校验）。

## 13. 数据表汇总

| 表 | 说明 |
| --- | --- |
| `content_types` / `content_taxonomies` | 注册结果的持久化快照，用于一致性检查和后台展示 |
| `content_terms` | 词条（含栏目设置） |
| `content_term_grants` | 栏目级授权（可选） |
| `content_items` | 内容 |
| `content_field_index` | filterable / sortable 字段的键值索引 |
| `content_item_terms` | 内容—词条 |
| `content_item_relations` | 相关内容 |
| `content_revisions` | 版本与自动保存 |
| `content_edit_locks` | 编辑锁 |
| `content_collections` / `_sections` / `_entries` | 合集 |
| `content_favorites` / `content_histories` | 收藏 / 足迹 |
| `content_item_stats_daily` | 按日统计 |
| `content_review_logs` | 审核日志 |

全部经 migrate 建表，不在运行期做 DDL。

## 14. 权限点

`content:term:manage`、`content:item:create`、`content:item:edit`、`content:item:edit-others`、`content:item:review`、`content:item:publish`、`content:item:delete`、`content:collection:manage`、`content:submission:review`、`content:stats:view`。

## 15. 分期

| 期 | 内容 |
| --- | --- |
| P1 | 类型注册（article、page）、分类法（category、tag）、内容 CRUD、结构化正文、版本、审核、定时、通用查询、合集（手动条目）、搜索（pg_trgm）、阅读计数与排行、收藏足迹、投稿、外部写入端口、后台全套页面 |
| P2 | 自定义字段的筛选排序索引、合集规则条目、栏目级权限、编辑锁与自动保存、回收站任务、多语言关联 |
| P3 | 开放接口、HTML 导入工具（WordPress WXR 等）、更多字段类型与块类型 |

itwind 第一期用到：P1 全部 + 合集里的首页幻灯和专题；它的 AI 编辑部通过外部写入端口交付稿件。
