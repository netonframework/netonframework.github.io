# module-content 通用内容模块（CMS）

> 标识：NETON-APP-CONTENT
> 日期：2026-10-15 · 状态：Draft r3（对齐套件架构 r2：媒体引用、生命周期影响、授权分离、投递保证；2026-10-15 按 P1 实现校准）
> 仓库：`neton-application-module-content`（服务端）、`neton-application-front-content`（后台页面）
> 参照：WordPress、PHPCMS、DedeCMS 的内容建模方式，取其通用部分，去掉模板引擎、静态生成等与 headless 架构无关的部分。

## 实现状态（2026-10-15）

| 项 | 状态 |
| --- | --- |
| `ContentRegistry`（契约子工程）注册类型与分类法；内置 `article`、`page`、`category`、`tag` | 已实现 |
| 字段定义与写入校验（`fields` 存 text JSON） | 已实现 |
| 栏目与标签（物化路径、栏目设置）、内容 CRUD、结构化正文（12 种块 + 行内标记）、`blocks → HTML / 纯文本`、HTML 导入 | 已实现 |
| 状态机（§6 全部转换，每个转换一个权限点）、版本、版本对比与回滚、审核与审核日志、`ContentPublishPolicy` / `ContentPublishPolicies` | 已实现 |
| 定时发布 / 定时下线（`content-schedule` 任务，每分钟） | 已实现 |
| 回收站（trash / restore），彻底删除由后台手动执行 | 已实现 |
| 通用查询（§8，不含按自定义字段筛选）、排行（按日统计表）、搜索（pg_trgm，可替换 `ContentSearchEngine`） | 已实现 |
| 合集：专题、推荐位、分区、手动条目与外链条目 | 已实现 |
| 用户投稿、外部写入端口 `ContentDraftWriter`（含按写入方撤回；原始发布时间首次发布时作为发布时间，2026-10-17） | 已实现 |
| 媒体：注册 `content.cover` / `content.image` / `content.video` / `content.attachment`，保存时 attach / detach，响应经 `MediaService.resolve` 展开 | 已实现 |
| 对象解析与访问策略 `content.item`、`content.collection`；评论数 / 收藏数经 `ObjectCounterChanged` 同步回写 | 已实现 |
| 浏览：详情读取直接计数（`content.view.dedup_seconds` 内登录用户去重，需 Redis），发布通用 `ObjectViewed` | 已实现（与原设想「先 Redis 累加再批量回写」不同） |
| 注册结果持久化快照 `content_types` / `content_taxonomies` 与启动一致性检查 | 延后 |
| `content_field_index`（filterable / sortable 字段索引）与按字段筛选排序 | 延后（P2） |
| 合集规则条目（`content_collection_sections.rule` 列已建未使用）、撤回时自动隐藏合集条目 | 延后（P2） |
| 栏目级权限 `content_term_grants`、编辑锁与自动保存、回收站保留期自动清理、多语言关联 | 延后（P2） |
| 相关内容 `content_item_relations` | 延后 |
| `FieldTypeRegistry` / `BlockTypeRegistry` 扩展、`ContentAuthorResolver` | 延后 |
| 开放接口 `/platform/content/…` | 延后（P3） |
| 筛选器数据源 `content.item`、挂载点 `content.term`、`item/query` 的 `filter` 参数（[filter-module](filter-module.md) §4.4、§6.7、§10.4） | 已实现（2026-10-17；一致性套件真库全绿） |
| 内置筛选器 `content.collection:<code>`、合集分区挂载点 `content.collection_section` | 延后 |

## 1. 目标与原则

一个模块覆盖「文章站、资讯站、产品展示、下载站、知识库、单页官网」这类站点的内容管理需求，靠**配置和类型定义**适配不同业务，而不是每个产品各写一套。

| 原则 | 含义 |
| --- | --- |
| **一张内容表** | 所有内容（文章、单页、视频、下载、产品……）都存在 `content_items`；差异由「内容类型」描述，类型特有字段放 `fields`（text 列存 JSON，见 §13 说明）。不像 DedeCMS 那样一个模型一张附加表，也就不需要运行期建表 |
| **分类法统一** | 栏目、标签、品牌、地区……都是「分类法」下的「词条」，一套表、一套接口（WordPress 的 taxonomy 模型） |
| **合集统一** | 专题、推荐位、幻灯、头条、编辑精选、碎片，都是「合集」（PHPCMS 推荐位 + DedeCMS 专题 / 自由列表合并成一个概念） |
| **类型在代码里定义** | 内容类型、字段、分类法由模块或产品在代码中注册，有类型、可校验、可评审；后台只做实例数据（栏目、词条、合集、内容）的管理。这和 system 模块的类型化配置定义（ConfigDefinition）同一思路 |
| **Headless** | 只提供数据和接口，不渲染页面、不生成静态 HTML；正文是结构化块，App 和 Web 各自渲染 |
| **能力按需开启** | 版本、评论、投稿、收藏、定时发布等都是类型上的开关，不用的类型不产生额外数据 |

**不做**：模板引擎和静态页生成、站点导航菜单、广告位投放、问答 / 留言板 / 投票等独立应用、多站点 / 多租户、会员体系（交给 account / member）、评论（交给 [module-comment](comment-module.md)）、收藏 / 点赞 / 足迹（交给 interaction 模块）、推送（交给 [module-push](push-module.md)）、附件存储（交给 infra 文件服务）。

套件统一契约（对象引用、对象解析、事件信封、模块结构）见 [content-platform-architecture.md](content-platform-architecture.md)。

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
// contract.content
ContentTypeDefinition(
    code = "article",                 // 唯一，进库
    name = I18nText("文章", "Article"),
    features = setOf(                 // 能力开关，见下表
        Feature.BODY, Feature.SUMMARY, Feature.COVER, Feature.AUTHOR, Feature.SOURCE,
        Feature.REVISIONS, Feature.SCHEDULE, Feature.COMMENTS, Feature.FAVORITES, Feature.LIKES,
        Feature.HISTORY, Feature.SUBMISSION, Feature.SEO, Feature.PASSWORD, Feature.MEMBERS_ONLY,
    ),
    taxonomies = listOf("category", "tag"),     // 可挂的分类法
    fields = listOf(/* FieldDefinition，见 3.2 */),
    slugPolicy = SlugPolicy.AUTO,               // AUTO 自动 / MANUAL 手填 / NONE 不用
    archivedReadable = true,                    // 归档后详情是否仍可读
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
| `FAVORITES` / `LIKES` / `HISTORY` | 在对象摘要的 capabilities 里声明可收藏 / 可点赞 / 记足迹，由 interaction 模块执行 |
| `SUBMISSION` | 允许终端用户投稿 |
| `SEO` | SEO 标题、关键词、描述、规范链接 |
| `PASSWORD` / `MEMBERS_ONLY` | 密码访问 / 登录可见 |

内置两个类型：`article`（文章）、`page`（单页，无分类、无评论、slug 手填，用于关于我们、协议等）。产品按需注册更多类型，例如 `video`（时长、播放地址）、`download`（版本、大小、下载地址）、`product`（价格、规格、图集）。

### 3.2 字段

```kotlin
FieldDefinition(
    key = "duration", type = FieldType.INT, label = I18nText("时长(秒)", "Duration"),
    required = false, filterable = true, sortable = true,   // filterable / sortable 在 P2 生效
    validation = FieldValidation(min = 0.0),                // 另有 max、minLength、maxLength、pattern、options、multiple、maxItems
    submittable = false,                                    // 终端用户投稿时是否开放（§11）
)
```

- **字段类型**：`text`、`textarea`、`rich`（结构化块）、`int`、`decimal`、`bool`、`date`、`datetime`、`select`（单选 / 多选，选项在定义里）、`image`、`images`（图集）、`file`、`video`（以上均存 MediaRef，§5.5）、`url`、`color`、`item_ref`（引用其他内容）、`term_ref`（引用词条）、`json`（逃生口）。
- 字段类型本身也可扩展：`FieldTypeRegistry.register(...)`，提供校验和后台编辑控件的 key（延后；P1 字段类型是固定枚举 `FieldType`）。
- 值统一存在 `content_items.fields`（text 列存 JSON），写入时按定义校验，未定义的键拒绝。
- **只有标记 `filterable` / `sortable` 的字段**会同步一份到 `content_field_index`（键值索引表），用于按字段筛选和排序；其余字段不建索引，不付额外成本（P2，表尚未建）。
- 字段增删不需要 DDL：JSON 字段和索引表都是通用结构。字段改类型或下线时，迁移脚本（migrate）负责清理旧值。

### 3.3 注册方式

模块或产品在初始化时注册：

```kotlin
// content 在 bootstrap 里 ctx.bindIfAbsent(ContentRegistry::class, ContentRegistry.withBuiltins())；
// 依赖 content、装配在其后的模块或产品在自己的 bootstrap 里：
ctx.get(ContentRegistry::class).registerTaxonomy(BrandTaxonomy)   // 先注册分类法
ctx.get(ContentRegistry::class).registerType(VideoType)
```

注册时校验 code（`^[a-z][a-z0-9_]{0,31}$`）、字段键、select 选项、正则、引用的分类法存在；装配期可变，`seal` 后只读。

注册结果和数据库里已有数据做一致性检查：库里存在、代码里已删除的类型，启动时报警并拒绝写入该类型，不静默丢数据（延后：P1 未持久化注册快照）。

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

- 词条（`content_terms`）：名称、slug（分类法内唯一）、父级、排序、描述、封面（cover_file_id）、SEO、item_count、status，以及 `settings`（text JSON，按分类法定义的设置项校验）。
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

### 4.3 栏目级权限（可选，延后）

角色和权限点由 system 模块管理，本模块只声明权限点（§14）。如需「编辑 A 只能管 手机 栏目」，用 `content_term_grants(role_id, term_id, actions)` 声明栏目范围，授权到某栏目即包含其子栏目。不配置时按权限点全局生效。

## 5. 内容

### 5.1 字段

| 分组 | 字段 |
| --- | --- |
| 身份 | id, type, slug（类型内唯一）, locale?, translation_group?（多语言版本互相关联，可选） |
| 标题 | title, subtitle?, title_style?（颜色 / 加粗，DedeCMS 的标题样式） |
| 列表展示 | summary, cover（text JSON：主图 + 可选多图，均为 fileId）, list_style?（大图 / 单图 / 三图 / 无图，空则客户端自动判断） |
| 正文 | body（text JSON 块数组，见 5.2）, body_text（纯文本，供搜索）, fields（text JSON，类型字段） |
| 归属 | primary_term_id（主栏目，决定默认链接）, 作者：author_user_id? / author_name, 来源：source_name? / source_url?, origin(`original`/`reprint`/`compiled`) |
| 状态 | status（§6）, previous_status（进回收站前的状态，恢复用）, visibility(`public`/`members`/`password`), password_hash?, redirect_url?（跳转型内容）, review_note |
| 时间 | published_at, first_published_at, original_published_at?, scheduled_at?, expire_at?, trashed_at?, created_at, updated_at |
| 排序 | weight（越大越靠前）, pinned_until?（全局置顶到期时间）；栏目内置顶见 5.3 |
| 计数 | view_count, comment_count, favorite_count（冗余计数：评论数、收藏数由通用事件 `ObjectCounterChanged`（counter = `comments` / `favorites`）同步回写，listenerId `content.counter-writeback`；详细统计见 §9） |
| SEO | seo_title, seo_keywords, seo_description, canonical_url |
| 生产 | producer?, producer_ref?（外部写入方标识，§10.3；(producer, producer_ref) 部分唯一）, submitter_user_id?（投稿人，§11）, current_revision_id, published_revision_id, attached_media（已 attach 的 fileId，用于差量 attach / detach）, version（单调递增，即事件的 subjectVersion）, created_by, updated_by |

**发布时间**：`published_at` 是对读者的发布时间，列表排序（`sort=published`）、`publishedAfter` / `publishedBefore`、筛选器字段 `publishedAt`（维度 `time.published`）及其时间窗、卡片与详情的 `publishedAt`、`content.item.published` 事件都只看它，不另做 `coalesce`。`original_published_at` 是外部写入方（采集、迁移工具，§10.3）给出的来源时间；`first_published_at` 是本站首次上线的时刻。

- 首次发布（审核通过、免审直接发布、定时到点）时：有 `original_published_at` 的内容 `published_at = min(original_published_at, now)`，没有的取 `now`；`first_published_at` 都取 `now`。转载的 IT之家文章因此按来源时间排序、进日 / 周 / 月时间窗，相对时间（「3 小时前」）也按来源算。
- 之后撤回、重新发布、再编辑、写入方重复投递都不改 `published_at`；写入方再次投递不带时间时保留已有的 `original_published_at`。后台编辑不改 `original_published_at`（只读展示）。
- 详情 VO 带 `originalPublishedAt`；后台编辑视图带 `firstPublishedAt`、`originalPublishedAt`。

### 5.2 结构化正文

正文是有序的块数组，不存 HTML：

| 块 | 属性 |
| --- | --- |
| `paragraph` | 文本 + 行内标记（粗体、斜体、下划线、删除线、行内代码、链接、@内容引用） |
| `heading` | 级别 2–4、文本 |
| `image` | media（fileId）、说明、alt；宽高由媒体服务提供 |
| `gallery` | fileId 数组、展示方式 |
| `quote` | 文本、出处 |
| `list` | 有序 / 无序、条目（可嵌套一层） |
| `code` | 语言、代码 |
| `table` | 表头、行 |
| `divider` | — |
| `video` / `audio` | media（fileId）、说明；封面、时长、清晰度由媒体服务提供 |
| `embed` | provider、url、数据（扩展用；客户端不认识时降级为链接卡片） |
| `item_card` | 引用站内另一条内容 |

- 块用一个扁平结构 `ContentBlock(type, text, marks, level, media, medias, caption, alt, display, cite, ordered, items, language, header, rows, provider, url, data, itemId)` 承载；行内标记 `ContentMark(type, start, end, href?, itemId?)`，区间按 UTF-16 下标半开。
- 块类型可扩展（`BlockTypeRegistry`），新块必须声明降级方式（延后）。
- 导入 HTML（编辑器粘贴、外部写入方、后台 `item/import-html`）时按白名单转换为块，转不了的标签丢弃并记录。
- 提供 `blocks → HTML` 和 `blocks → 纯文本` 两个转换器，分别给 Web SSR 和搜索、摘要生成使用。

### 5.3 内容与词条、合集

- `content_item_terms(item_id, term_id, taxonomy, sort)`：内容挂多个分类法的词条；主栏目另存在 `primary_term_id`，同时也在关联表里。
- **栏目内置顶**：关联表上的 `pinned_until`，只在该栏目列表里置顶。
- 推荐、头条、幻灯这类 DedeCMS 属性**不做成内容上的标记位**，统一放进合集（§7），一条内容可以同时在多个推荐位里、各自有排序和有效期。

### 5.4 相关内容（延后）

`content_item_relations(item_id, related_id, kind, sort)`：手动指定相关内容、系列上下篇等。没有手动指定时，详情接口按「同标签 > 同栏目」自动补齐。

### 5.5 媒体

- 封面、正文图片、图集、视频、附件都经 infra 媒体能力上传，内容里只存 `MediaRef(fileId)`，不存 URL（套件架构 §6）。
- 本模块注册上传业务类型（均 `DELEGATED`、`reusable`、`managedLifecycle`）：`content.cover`（≤10MB，assetDir `content-cover`）、`content.image`（≤20MB，可作 cover / image 用途）、`content.video`（≤500MB）、`content.attachment`（≤100MB），各自规定 MIME。图片派生规格、视频处理规格随 infra 媒体后续阶段。
- 保存版本时对新出现的媒体调用 `attach`（owner 为本条内容，usage 为对应的上传业务类型），替换或移除时 `detach`，内容彻底删除时 `detachAll`。attach 失败（不是本人上传的临时文件、用途不匹配、视频未处理完成）时保存失败并返回原因。
- 草稿和待审内容的媒体只有有权查看该内容的人能访问（`DELEGATED`：infra 回调唯一的 `port.MediaOwnerAccess`，由 `ObjectRegistry` 路由到本模块的访问策略判断），发布后对公众可见。
- 接口响应里的媒体由 `MediaService.resolve` 批量展开为地址、宽高、时长、派生版本。会员可见或密码访问的内容，其媒体的访问由本模块的访问策略回调授权。
- 外部写入（采集等）带来的外链图片（`ContentDraftInput.externalImageUrls`），在写入流程里经 `MediaService.importFromUrl` 转存为平台媒体；转存失败的图片丢弃。
- 来源原文链接、正文里的外链用 `ExternalLink` 保存，不是媒体。

## 6. 状态、版本与审核

```
draft ──提交──► pending ──通过──► published ──撤回──► withdrawn ──重新发布──► published
  ▲               │  └──定时──► scheduled ──到点──┘     │                │
  └──── 驳回 ◄────┘                                      └── 归档 ──► archived
                     任意非 published 状态 ──删除──► trash（回收站，可恢复；保留期后彻底删除）
```

| 状态 | 对外可见 | 说明 |
| --- | --- | --- |
| draft | 否 | 草稿，只有编辑可见 |
| pending | 否 | 待审 |
| scheduled | 否 | 已通过、等待定时发布 |
| published | 是 | 线上 |
| withdrawn | 否 | 撤回：内容有问题临时下线，可修改后重新发布 |
| archived | 按类型配置（默认只读可见，不进列表和搜索） | 归档：过期内容保留可访问的链接，但不再推荐 |
| trash | 否 | 回收站 |

- 不在上表箭头里的状态转换一律拒绝；每个转换对应一个权限点（§14）。
- 已发布内容必须先撤回才能删除，避免误删线上内容。

- **版本**（类型开了 `REVISIONS`）：每次保存生成 `content_revisions` 记录，保存标题、摘要、封面、正文、字段、词条快照。线上只展示 `published_revision_id` 指向的版本；已发布内容再编辑，新版本审核通过前线上保持旧版本。
- **自动保存**（延后）：编辑器每隔一段时间写一个自动保存版本，同一编辑者只保留最新一份，不进版本列表。
- **编辑锁**（延后）：打开编辑时加锁（带心跳），别人打开时提示「xx 正在编辑」，可强制接管。
- **审核**：类型或栏目要求审核时走 pending；通过、驳回（附原因）、下线都写 `content_review_logs`。审核策略可替换：`ContentPublishPolicy` 决定某次提交是否免审（`REVIEW` / `PUBLISH`）；查找顺序是 `ContentPublishPolicies` 里按 producer 登记的规则 → 上下文里绑定的整体策略 → 内置规则（类型或主栏目要求审核时待审，否则直接发布）。终端用户投稿一律待审，不经过策略。
- **定时**：定时发布、定时下线由 neton-jobs 任务 `content-schedule`（每分钟，单节点）扫描执行；定时下线进入 `withdrawn`。
- **删除**：进回收站（`trash`），可恢复到进入前的状态；彻底删除（purge）P1 由后台手动执行，保留期后自动清理延后。
- **归档**：只能从 `withdrawn` 归档。

### 6.1 生命周期影响

内容状态变化时，其他模块的行为由事件驱动、在各自规范中实现，本模块只负责在对象解析和访问策略里如实反映状态。除下表的 `content.item.*` 事件外，本模块同时发布通用对象事件，能力模块（评论、互动）只需订阅通用事件、不认识 content：撤回 / 归档 / 进回收站发 `ObjectUnavailable(permanent = false)`，重新发布发 `ObjectAvailable`，彻底删除发 `ObjectUnavailable(permanent = true)`。

| 事件 | 对外可见性 | 评论 | 收藏 / 足迹 | 搜索 | 推送深链 | 合集条目 |
| --- | --- | --- | --- | --- | --- | --- |
| 撤回 `content.item.withdrawn` | 详情返回「内容已撤回」 | 不可新增；已有评论随对象不可见 | 保留记录，列表中显示「已失效」 | 从索引移除 | 打开时提示已撤回 | 自动隐藏，重新发布后恢复（延后） |
| 归档 `content.item.archived` | 按类型配置 | 关闭新增，已有评论只读 | 保留 | 从索引移除 | 正常打开 | 移除 |
| 重新发布 `content.item.published` | 恢复 | 恢复 | 恢复 | 重新索引 | 正常 | 恢复 |
| 彻底删除 `content.item.deleted` | 404 | 由评论模块清理 | 由互动模块清理 | 移除 | 打开提示不存在 | 移除 |

## 7. 合集：专题与推荐位

| kind | 用途 | 有落地页 | 分区 |
| --- | --- | --- | --- |
| `topic` | 专题（发布会专题、年度盘点） | 有：标题、横幅、导语、正文块 | 有（如「新闻」「评测」「图赏」） |
| `slot` | 推荐位 / 碎片：首页幻灯、头条、编辑精选、侧栏推荐 | 无，只被页面调用 | 无 |

**数据**

| 表 | 关键字段 |
| --- | --- |
| `content_collections` | id, kind, code（唯一，推荐位按 code 调用）, title, slug, cover_file_id, banner_file_id, intro, body（块，仅 topic）, settings（text JSON）, status, start_at?, end_at?, sort, attached_media |
| `content_collection_sections` | id, collection_id, title, sort, rule?（text JSON；P2 使用） |
| `content_collection_entries` | id, collection_id, section_id?, item_id?, 或外链（link_title、link_url、link_image）, title_override?, cover_override?, summary_override?, sort, start_at?, end_at? |

- **手动条目**：编辑把内容加进合集，可以为这个位置单独改标题和封面（首页幻灯常用短标题、横图），可设置在位时间。外链条目用于推广活动页等站外内容（PHPCMS 碎片的用途）。
- **规则条目**（P2）：分区或推荐位引用一条筛选器（[filter-module](filter-module.md) §12.1），自动填充，例如「手机栏目近 24 小时阅读量前 5」；手动条目优先，筛选器补足数量。宿主没装 filter 时规则条目不可用。
- 推荐位 `slot` 的数量、图片尺寸要求等写在 `settings`，后台按此校验。

## 8. 查询

一个通用的列表查询（相当于 WordPress 的 WP_Query、DedeCMS 的 arclist 标签），App、Web、合集规则都用它：

| 条件 | 说明 |
| --- | --- |
| `types` | 内容类型 |
| `terms` | 词条：`categoryId` / `category`（slug，`includeChildren` 默认 true）、`tagIds` / `tags`；多个分类法之间是「且」 |
| `collection` / `section` | 合集或分区内的条目 |
| `author` / `source` | 作者（`authorUserId`）/ 来源名称（`source`） |
| `fields` | 按 filterable 字段筛选：等于、范围、包含（P2） |
| `keyword` | 关键词（走 §9 搜索） |
| `publishedAfter` / `publishedBefore` | 时间范围 |
| `hasCover` | 只要有图的（幻灯规则常用） |
| `exclude` | 排除的 ID |
| `sort` | `published` / `updated` / `weight` / `views` / `comments` / `favorites` / `ranking_day` / `ranking_week` / `ranking_month`（sortable 字段 P2）；为空时取栏目的 `listOrder` |
| 分页 | App 游标分页（`contract.core.CursorPage`，cursor + limit）；后台页码分页（pageNo + pageSize） |

- 默认只返回 `published`、在有效期内、可见性允许当前用户的内容；置顶内容排在前面。
- **`filter=<筛选器 id>`**（[filter-module](filter-module.md) §6.7）：结果只由筛选器决定，返回结构不变；只能与 `include`、`cursor`、`limit` 同时出现，其他条件参数返回 `FILTER_EXCLUSIVE_PARAMS`。筛选器范围不是 `content.item` 返回 `FILTER_SOURCE_MISMATCH`，未开启对外访问返回 `FILTER_NOT_PUBLIC`，宿主没装 filter 返回 `FILTER_UNAVAILABLE`。
- **挂载**（filter-module §10.4）：只按一个词条取列表（`category` / `categoryId`，或恰好一个标签；没有其他条件参数）且该词条有生效挂载时，按挂载方式（REPLACE / PREPEND / APPEND）返回；挂载只改变显示，归属、后台按分类查询、带其他条件的查询都按归属计算。
- 返回字段可选：列表默认不含正文和 fields，需要时按字段名声明（`include=…`，逗号分隔），控制响应体大小。
- 后台查询额外支持状态、编辑者、审核人等条件。

## 9. 统计、排行与搜索

- **阅读计数**：P1 在详情读取的事务里直接 `view_count + 1` 并 upsert 按日统计表 `content_item_stats_daily(item_id, day, views, comments, favorites)`，同时发布 `ObjectViewed`。登录用户在 `content.view.dedup_seconds` 内重复浏览只计一次（用 Redis `setIfAbsent`；没有 Redis 或匿名时每次都计）。原设想的「Redis 累加、定时批量回写」留待流量需要时再做。
- **排行**：日 / 周 / 月榜按日统计表聚合（聚合列取 `::bigint`，结果按整数读）。
- **归一化热度**（筛选器维度 `metric.popularity`，filter-module §3.4）：`s = 阅读 + 10 × 评论 + 5 × 收藏`，`p = s / (s + 1000)`；不含时间衰减，保证键集游标稳定。
- **搜索**：`ContentSearchEngine` 接口。默认实现用 PostgreSQL `pg_trgm`（GIN 索引 title、summary、body_text），`ILIKE` 加相似度排序；需要中文分词或大规模检索时换成 zhparser 或外部搜索引擎，接口不变。搜索只覆盖已发布、公开的内容，按 IP 限流。

```kotlin
interface ContentSearchEngine {
    suspend fun search(query: String, contentTypes: List<String>, offset: Int, limit: Int): ContentSearchHits   // ContentSearchHits(itemIds, nextOffset?)
}
// 产品在自己的 bootstrap 里 ctx.bind(ContentSearchEngine::class, …) 替换；content 在调用时读取
```

## 10. 扩展点

### 10.1 事件

事件采用套件统一信封。状态变更和待投递的事件记录在同一数据库事务里提交（事务性 outbox），提交后由投递器异步投递，至少一次；投递方式如下：

| 事件 | 类型（`contract.content`） | 投递方式 | 典型订阅方 |
| --- | --- | --- | --- |
| `content.item.saved`、`content.item.submitted` | `ContentItemSaved`（created, producer?）、`ContentItemSubmitted`（submitterUserId?） | 可重试 | 编辑台、产品的 AI 加工（如 itwind newsroom） |
| `content.item.published`、`content.item.withdrawn`、`content.item.archived`、`content.item.trashed`、`content.item.deleted` | `ContentItemPublished`（title, primaryTermId?, publishedAt, republished, revisionUpdate）、`ContentItemWithdrawn`（reason?）、`ContentItemArchived`、`ContentItemTrashed`、`ContentItemDeleted` | 可重试 | 搜索、推送、缓存 |
| `content.term.changed`、`content.collection.changed` | `ContentTermChanged` / `ContentCollectionChanged`（action = `created` / `updated` / `deleted`） | 可重试 | 缓存、搜索 |
| `object.viewed`、`object.unavailable`、`object.available` | 通用 `contract.core.ObjectViewed` / `ObjectUnavailable` / `ObjectAvailable` | 可重试 | 互动（足迹、失效）、评论（清理） |

- 内容事件都实现父接口 `ContentItemEvent : SuiteEvent`（itemId, contentType, status, revisionId?），subject 为 `content.item:<id>`，subjectVersion 为内容的 `version`。
- **没有单独的 `content.item.viewed`**：详情读取发布通用的 `ObjectViewed`（每次读取一次，匿名时 viewerUserId 为空），interaction 订阅它写足迹。
- 本模块订阅通用 `ObjectCounterChanged`（同步）回写 comment_count / favorite_count。
- 以上事件类型都在 bootstrap 里登记到 `SerializerDomainEventCodec`。

事件载荷只带 ID、状态、版本号和少量摘要，订阅方按需回查。推送、搜索索引、缓存失效、静态站重建都靠订阅事件实现，不写进本模块。

### 10.2 端口

| 端口 | 用途 | 默认实现 |
| --- | --- | --- |
| `ContentRegistry` | 注册类型、分类法（字段类型、块类型扩展延后） | 内置（`withBuiltins()`，bindIfAbsent） |
| `ContentPublishPolicy`（`fun interface`）+ `ContentPublishPolicies`（按 producer 登记） | 决定一次提交是否免审：`decide(ContentPublishRequest): ContentPublishDecision` | 按类型 / 栏目配置 |
| `ContentSearchEngine` | 搜索 | pg_trgm |
| `ContentAuthorResolver` | 作者展示资料（昵称、头像） | 延后（P1 只返回 author_user_id / author_name） |
| `MediaService`（使用方） | 上传业务类型注册、引用登记、媒体展开 | infra 媒体标准 |
| `ObjectResolver`（实现方） | 注册 `content.item`、`content.collection`：标题、链接、封面、拥有者和 capabilities（按类型能力与当前状态得出，如未发布不含 `comment`、`favorite`） | 内置 |
| `ObjectAccessPolicy`（实现方） | 回答「某人现在能否对某条内容做某事」：查看、评论、收藏、读取其媒体。考虑状态、可见性（会员 / 密码）、栏目的评论开关 | 内置 |

### 10.3 外部写入端口

供其他模块交付内容，例如 [module-collect](collect-module.md) 的 `content.draft` 投递端口、产品的 AI 编辑部、导入工具：

```kotlin
// contract.content；content 实现并绑定，使用方 ctx.getOrNull(ContentDraftWriter::class)（没装 content 时为 null）
interface ContentDraftWriter {
    /** 按 (producer, producerRef) 幂等：已有内容就新增一个版本，没有就新建草稿。 */
    suspend fun upsertDraft(input: ContentDraftInput): ContentDraftResult
    /** 提交审核（或按发布策略直接发布）。 */
    suspend fun submit(itemId: Long, actor: Actor, note: String? = null): ContentDraftResult
    /** 撤回由某个写入方记录产生的内容（采集源上游删除时用）。没有对应内容返回 false。 */
    suspend fun withdrawByProducer(producer: String, producerRef: String, actor: Actor, reason: String): Boolean
}
// ContentDraftInput(producer, producerRef, actor, type = "article", categoryCode?, title, subtitle?, summary?,
//   contentHtml? 或 blocksJson?, cover: List<MediaRef>, externalImageUrls, authorName?, sourceName?, sourceLink: ExternalLink?,
//   origin = "reprint", originalPublishedAt?（来源发布时间，记为 original_published_at，首次发布时作为 published_at，见 §5.1）, tags, submit = true)
// ContentDraftResult(itemId, revisionId, created, status)
```

主栏目为空时按配置 `content.writer.default_category` 取默认栏目。

写入的数据同样经过类型校验和审核流程；是否免审由 `ContentPublishPolicy` 决定（写入方可以注册自己的规则）。本模块不依赖任何写入方。

## 11. 用户投稿

- **投稿**（类型开了 `SUBMISSION`、栏目允许投稿）：终端用户提交的内容直接进 `content_items`，状态 pending，记录投稿人 `submitter_user_id`；后台审核通过即发布，或转给编辑继续加工。投稿人可在「我的投稿」查看状态和驳回原因。投稿只开放类型声明为可投稿的字段。

## 12. 接口

**App / Web（`/app/content/*`，匿名可读，写操作需账号令牌）**

| 接口 | 说明 |
| --- | --- |
| `GET term/tree?taxonomy=category` | 栏目树（只含 visible） |
| `GET term/list?taxonomy=tag&...` | 词条列表（热门标签等） |
| `GET item/query` | §8 通用查询 |
| `GET item/get/{id}`、`GET item/resolve?type&slug` | 详情（按 ID 或 slug；密码内容需带 password 且登录）；记一次浏览并发出通用 `ObjectViewed`，足迹由 interaction 订阅后记录 |
| `GET item/ranking?period&by&types&cursor&limit` | 排行（period 默认 day，by 默认 views） |
| `GET item/search?q&types&cursor&limit` | 搜索（按 IP 限流） |
| `GET collection/get/{code}` | 推荐位或专题（含分区与条目） |
| `GET submission/form?type`（匿名可读）、`POST submission/create`、`GET submission/mine` | 投稿 |

**后台（`/admin/content/*`）**：

| 接口 | 权限点 |
| --- | --- |
| `GET type/list`（只读，展示注册结果） | `content:type:query` |
| `GET term/page`、`term/tree`、`term/simple-list`、`term/get/{id}` | `content:term:query` |
| `POST term/create` / `PUT term/update` / `DELETE term/delete/{id}` | `content:term:create` / `update` / `delete` |
| `GET item/page`、`item/get/{id}`、`item/revisions/{id}`、`item/revision/{revisionId}` | `content:item:query` |
| `POST item/create` | `content:item:create` |
| `PUT item/update`、`POST item/rollback` | `content:item:update` |
| `POST item/import-html` | `content:item:import` |
| `POST item/submit/{id}` | `content:item:submit` |
| `POST item/approve/{id}`、`POST item/reject/{id}`（含定时发布） | `content:item:review` |
| `POST item/publish/{id}`（撤回后重新发布） | `content:item:publish` |
| `POST item/withdraw/{id}` | `content:item:withdraw` |
| `POST item/archive/{id}` | `content:item:archive` |
| `POST item/trash/{id}`、`POST item/restore/{id}`、`DELETE item/delete/{id}`（彻底删除） | `content:item:delete` |
| `PUT item/pin/{id}` | `content:item:pin` |
| `GET collection/page`、`collection/get/{id}` | `content:collection:query` |
| `POST collection/create` / `DELETE collection/delete/{id}` | `content:collection:create` / `delete` |
| `PUT collection/update`、`POST collection/section/save`、`DELETE collection/section/delete/{id}`、`POST collection/entry/save`、`DELETE collection/entry/delete/{id}` | `content:collection:update` |
| `GET submission/page` | `content:submission:query` |
| `POST submission/approve/{id}`、`POST submission/reject/{id}` | `content:submission:review` |
| `GET review-log/page` | `content:review-log:query` |

统计页延后。

**开放接口（`/platform/content/*`，签名鉴权；P3，未实现）**：给外部系统的只读查询和受控写入（写入走 §10.3 同一套校验）。开放分组由框架挂在 `/platform` 前缀下。

## 13. 数据表汇总

| 表 | 说明 |
| --- | --- |
| 表 | 说明 | P1 |
| --- | --- | --- |
| `content_types` / `content_taxonomies` | 注册结果的持久化快照，用于一致性检查和后台展示 | 未建（后台从内存注册表读取） |
| `content_terms` | 词条（含栏目设置），唯一(taxonomy, slug)，物化路径 + pg_trgm 名称索引 | 已建 |
| `content_term_grants` | 栏目级授权（可选） | 未建 |
| `content_items` | 内容；唯一(type, slug)、唯一(producer, producer_ref)（均为部分索引）；title / summary / body_text 的 pg_trgm GIN 索引 | 已建 |
| `content_field_index` | filterable / sortable 字段的键值索引 | 未建 |
| `content_item_terms` | 内容—词条（item_id, term_id, taxonomy, sort, pinned_until），唯一(item_id, term_id) | 已建 |
| `content_item_relations` | 相关内容 | 未建 |
| `content_revisions` | 版本（revision_no、状态、标题、摘要、封面、正文、字段、词条快照、备注、作者），唯一(item_id, revision_no) | 已建（自动保存未做） |
| `content_edit_locks` | 编辑锁 | 未建 |
| `content_collections` / `_sections` / `_entries` | 合集 | 已建 |
| `content_item_stats_daily` | 按日统计，唯一(item_id, day) | 已建 |
| `content_review_logs` | 审核日志（action, from_status, to_status, actor_kind, actor_id, note） | 已建 |

全部经 migrate 建表（`V001__baseline.sql`，含 `CREATE EXTENSION pg_trgm`；`V002__item_original_published_at.sql` 加 `content_items.original_published_at`），不在运行期做 DDL。JSON 字段（cover、body、fields、settings、attached_media 等）一律存 `text` 列，不用 jsonb：框架的行映射只支持基本类型（套件统一约定）。

## 14. 权限点

命名 `content:<resource>:<action>`，资源段与后台路由段一致（§12）。P1 实际权限点（全部写在 V001 菜单种子里，默认授予 `super_admin`）：

`content:type:query`、`content:term:query` / `create` / `update` / `delete`、`content:item:query` / `create` / `update` / `import` / `submit` / `review` / `publish` / `withdraw` / `archive` / `delete` / `pin`、`content:collection:query` / `create` / `update` / `delete`、`content:submission:query` / `review`、`content:review-log:query`。

状态机的每个转换对应其中一个权限点（`ContentStateMachine`）。原设想的 `content:item:edit-others`（改别人的内容）与 `content:stats:view` 未实现，随栏目级权限与统计页再加。

## 15. 分期

| 期 | 内容 |
| --- | --- |
| P1（已实现） | 类型注册（article、page）、分类法（category、tag）、内容 CRUD、结构化正文、HTML 导入、版本与回滚、审核、定时、回收站（手动彻底删除）、通用查询、合集（手动条目）、搜索（pg_trgm）、阅读计数与排行、投稿、对象解析与外部写入端口、后台页面（统计页除外） |
| P2 | 自定义字段的筛选排序索引、合集规则条目、栏目级权限、编辑锁与自动保存、回收站任务、多语言关联、注册快照与一致性检查、相关内容、统计页 |
| P3 | 开放接口（`/platform/content/…`）、批量导入工具（WordPress WXR 等）、更多字段类型与块类型 |

itwind 第一期用到：P1 全部 + 合集里的首页幻灯和专题；它的 AI 编辑部通过外部写入端口交付稿件。
