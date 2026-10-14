# module-content 通用内容模块

> 标识：NETON-APP-CONTENT
> 日期：2026-10-14 · 状态：Draft
> 仓库：`neton-application-module-content`（服务端）、`neton-application-front-content`（后台页面）
> 首个使用方：itwind（科技资讯）。设计目标是任何需要「文章 / 栏目 / 发布」的站点都能直接装配。

## 1. 边界

**负责**：栏目、内容条目（文章等）、标签、草稿与版本、审核发布、用户投稿、收藏与浏览足迹、搜索、阅读计数。

**不负责**：
- 评论：由 [module-comment](comment-module.md) 负责，content 只登记自己是一种「可评论对象」。
- 推送：由 [module-push](push-module.md) 负责，content 只发出「已发布」事件。
- 内容生产方式（人工、采集、AI）：生产方通过 §5 的写入端口把草稿交给 content，content 不关心草稿从哪来。
- 账号：作者和投稿人只记 user_id；展示资料经 member 适配器读取。

## 2. 数据模型（PostgreSQL，经 migrate 落库）

| 表 | 关键字段 |
| --- | --- |
| `content_categories` | id, parent_id, code（唯一）, name, sort, kind(`list`/`ranking`/`page`), allow_comment, status |
| `content_items` | id, type(`article`/`page`), category_id, title, summary, cover_url, blocks(jsonb), author_name, author_user_id?, origin_name?, origin_url?, status(`draft`/`reviewing`/`published`/`rejected`/`offline`), published_revision_id, published_at, pinned_until?, view_count, comment_count, favorite_count, created_at, updated_at |
| `content_revisions` | id, item_id, version, title, summary, cover_url, blocks(jsonb), origin(`editor`/`submission`/`external`), producer?（写入方标识，如 `newsroom`）, producer_ref?, editor_id?, note, created_at |
| `content_tags` / `content_item_tags` | 标签与关联 |
| `content_submissions` | id, user_id, title, content, link?, images(jsonb), status(`pending`/`accepted`/`rejected`), item_id?（采纳后生成的条目）, review_note, created_at |
| `content_favorites` | user_id, item_id, created_at；唯一(user_id, item_id) |
| `content_histories` | user_id, item_id, viewed_at；唯一(user_id, item_id)，重复浏览只更新时间 |
| `content_review_logs` | target_type(`item`/`submission`), target_id, revision_id?, action, operator_id, reason, created_at |

- **正文统一用结构化块 `blocks`**：`paragraph`（带行内标记：粗体、斜体、链接）、`heading`、`image`（url、宽高、说明）、`quote`、`list`、`code`、`divider`、`embed`（扩展类型，客户端不认识时降级为链接）。客户端原生渲染，不下发 HTML。
- **版本**：每次保存产生一个 revision；条目对外只展示 `published_revision_id` 指向的版本，编辑中的草稿不影响线上内容。
- **计数**：浏览量用 Redis 累加、定时回写；评论数由 comment 模块的事件更新（§6）。

## 3. 状态流转

```
draft ──提交──► reviewing ──通过──► published ──下线──► offline
  ▲                 │                   │
  └──── 驳回 ◄──────┘     再次提交新版本 ─┘（线上保持旧版本直到新版本通过）
```

- 栏目可以配置「免审直接发布」，按写入方配置「自动发布规则」（§5）。
- 所有审核动作写 `content_review_logs`。

## 4. 接口

**App（`/app/content/*`，匿名可读，写操作需账号令牌）**

| 接口 | 说明 |
| --- | --- |
| `GET category/list` | 栏目（客户端本地保存用户的排序和显隐） |
| `GET item/page?categoryId&cursor` | 游标分页，置顶优先，再按 published_at desc |
| `GET item/ranking?period=day\|week\|month&by=view\|comment\|favorite` | 排行 |
| `GET item/get/{id}` | 详情：blocks、标签、相关内容（同标签 / 同栏目）；记一次浏览，登录用户写足迹 |
| `GET item/search?q&cursor` | 搜索 |
| `POST favorite/{id}`、`DELETE favorite/{id}`、`GET favorite/page` | 收藏 |
| `GET history/page`、`DELETE history` | 足迹 |
| `POST submission/create`、`GET submission/mine` | 用户投稿 |

**后台（`/admin/content/*`）**：栏目管理；条目列表、编辑（新建版本）、提交审核、审核（通过 / 驳回）、下线、置顶；投稿审核（采纳时可直接生成草稿条目）；审核日志。

权限点：`content:category:manage`、`content:item:edit`、`content:item:review`、`content:item:offline`、`content:submission:review`。

## 5. 写入端口（供其他模块交付草稿）

```kotlin
interface ContentDraftWriter {
    /** 按 (producer, producerRef) 幂等：已有条目就新增一个版本，没有就新建条目。 */
    suspend fun upsertDraft(draft: ContentDraftInput): ContentDraftResult
    suspend fun submitForReview(itemId: Long, note: String?)
}
```

- `producer` 标识写入方（如 itwind 的 `newsroom`），`producerRef` 是写入方自己的 ID（如事件 ID）。
- 写入方可以注册自动发布规则：`ContentAutoPublishPolicy.shouldPublish(item, revision): Boolean`，例如「AI 报告无冲突且来源数 ≥ 3」。没注册就走人工审核。
- content 不依赖任何写入方，写入方依赖本端口。

## 6. 与其他模块的协作

| 方向 | 机制 |
| --- | --- |
| comment → content | content 实现 comment 的 `CommentTargetResolver`，类型为 `content.item`：校验条目存在、已发布、所在栏目允许评论，并提供标题和链接供评论列表展示 |
| comment → content | 订阅 `CommentCountChanged(targetType, targetId, count)`，回写 `comment_count` |
| content → push | 发布时发出 `ContentPublished(itemId, categoryId, title, summary, cover)`；push 模块或产品侧按规则决定是否推送 |
| content → member | 投稿人、作者展示资料经 member 读取适配器，content 不读 member 的表 |

事件走 Neton 进程内事件总线；跨进程部署时可以替换为消息队列，接口不变。

## 7. 搜索

第一期用 PostgreSQL：`pg_trgm` 索引 title + summary，`ILIKE` 加相似度排序。全文和中文分词（zhparser 或外部搜索引擎）作为可替换实现：`ContentSearchEngine` 接口，默认实现是 pg_trgm。

## 8. 后台前端（neton-application-front-content）

栏目、条目（列表、编辑器、版本对比、审核）、投稿、审核日志。编辑器直接编辑 blocks；导入 HTML 时按白名单转成 blocks。沿用 front 的 i18n、权限、资源页规范。
