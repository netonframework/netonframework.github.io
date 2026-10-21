# client-content 内容的门户页面与投稿控制台

> 标识：NETON-APP-CLIENT-CONTENT
> 日期：2026-10-22 · 状态：**Accepted r3**（P1–P2 与 P3 的归档、410 已随 itwind C2 实现，见 §12；G7 的多比例图片待 infra M2）
> 仓库：`neton-application-client-content`（C 端模块，装配进 `neton-application-client` 的 fork）
> 依赖：底座公开路由契约 `neton-application-client/docs/spec/public-routes.md`（client-contract 1.1.0）；服务端 [content-module.md](content-module.md) 的 App 接口；失效与推送由 [site-module.md](site-module.md) 负责
> 套件定位：[content-platform-architecture.md](content-platform-architecture.md) §8 末条——「面向用户的展示因平台而异，套件只提供客户端 SDK 和可选的基础组件」。本模块就是 Web 端的这一份：通用的内容门户页面，产品通过站点配置调 URL、通过外壳决定布局，不改模块。

## 1. 边界

**负责**：内容详情、栏目页、标签页、作者页、热榜、搜索结果、日期归档、单页、专题的公开页面；`content.item` 卡片渲染器；内容的 sitemap 与 RSS；详情页的分享按钮；控制台的「我的投稿」与投稿表单。

**不负责**：
- 首页的布局：归产品外壳与 fork 页面（站点配置 `pages`）。
- 频道页（筛选器节点）：标准模块 `neton-application-client-filter`（产品决定 2，C1 已实现：公开路由 `filter.channel` `/channel/:code`、频道 sitemap、`./data` 取数给外壳与首页）。
- 评论区、收藏按钮：由 client-comment、client-interaction 经插槽挂到详情页，本模块只声明插槽。
- 缓存失效与搜索引擎推送：服务端 site 模块。

## 2. manifest

```ts
export default defineFrontModule({
  id: "content",
  contractVersion: "1.1.0",
  locales: [{ lang: "zh-CN", entry: "zh-CN" }, { lang: "en-US", entry: "en-US" }],
  publicRoutes: [
    { key: "content.item", pattern: "/article/:id", params: { id: "id" }, entry: "item", cache: "object", indexable: true, instantiable: true, goneAware: true },
    { key: "content.page", pattern: "/p/:slug", params: { slug: "slug" }, entry: "page", cache: "static", indexable: true, goneAware: true },
    { key: "content.category", pattern: "/category/:slug", params: { slug: "slug" }, query: ["cursor"], entry: "category", cache: "list", indexable: true },
    { key: "content.tag", pattern: "/tag/:slug", params: { slug: "slug" }, query: ["cursor"], entry: "tag", cache: "list", indexable: true },
    { key: "content.author", pattern: "/author/:id", params: { id: "id" }, query: ["cursor"], entry: "author", cache: "list", indexable: true },
    { key: "content.ranking", pattern: "/hot", query: ["period", "by"], entry: "ranking", cache: "list", indexable: true },
    { key: "content.search", pattern: "/search", query: ["q", "cursor"], entry: "search", cache: "dynamic", indexable: false },
    { key: "content.archive", pattern: "/archive/:y/:m/:d", params: { y: "int", m: "int", d: "int" }, entry: "archive", cache: "list", indexable: true },
    { key: "content.topic", pattern: "/topic/:code", params: { code: "slug" }, entry: "topic", cache: "list", indexable: true },
  ],
  slots: [{ target: "public.object.toolbar", id: "content.share", entry: "share", rendering: "client", objectTypes: ["content.item"], order: 90 }],
  cardRenderers: [{ objectType: "content.item", entry: "item-card" }],
  sitemaps: [{ id: "content", entry: "items", news: true }, { id: "content-terms", entry: "terms" }],
  feeds: [{ id: "content.latest", pattern: "/rss.xml", entry: "latest" }, { id: "content.category", pattern: "/category/:slug/rss.xml", entry: "category" }],
  pages: [
    { key: "content/submission/index", path: "/content/submissions", entry: "submission-list", rendering: "client", title: "我的投稿" },
    { key: "content/submission/new", path: "/content/submissions/new", entry: "submission-form", rendering: "client", standalone: true, title: "投稿" },
  ],
});
```

`/rss.xml` 声明为站点 feed 的一员（底座聚合，public-routes §11.3）。

## 3. URL 与服务端分享链接必须一致

服务端用 `content.site.base_url` + 路径模板生成 `shareUrl`（content-module §5.6），缺省模板 `/{type}/{id}`——文章即 `/article/{id}`，与本模块缺省路由一致。产品若改了一边，另一边要同步：

- fork 改 `routes.override["content.item"]` 时，后台同时改 `content.share.path_pattern`（或类型的 `sharePath`）。
- 详情页每次渲染都比对：`shareUrl` 与站点同源时，其路径必须等于当前请求路径，不等就 308 到 `shareUrl`（覆盖 slug 变化、模板变化、通过别的实例访问到的情况）。`shareUrl` 指向外站（编辑填了外站 `canonical_url`）时不重定向，只把 canonical 设为它。
- `shareUrl` 为空（后台没配 `base_url`）时用本站路由生成 canonical，并在服务端日志告警一次 `content.share_url.missing`。

### 3.1 转载内容的 canonical（产品决定 3）

- 缺省：canonical 指向本站文章页，JSON-LD `isBasedOn` 署名原文（来源名 + 原文地址）。理由：本站页面承载了评论、互动与站内推荐，是用户实际到达的页面；署名满足来源方的引用要求。
- 按来源可配成指向原文：content 的来源记录（采集来源 / 转载来源）新增布尔字段 `canonicalToSource`（后台按来源设置，缺省 false）；为 true 时服务端在详情里下发 `canonicalUrl = sourceUrl`，本模块按 §3 的规则把它当作外站 canonical 原样输出、不做 308。放在**服务端来源记录**而不是站点配置：canonical 是每个来源与本站之间的授权约定，随来源走；App 分享、sitemap（指向原文的条目不进 sitemap）与网页需要同一个答案。
- 编辑在单篇上填的 `canonical_url` 优先于来源设置。

## 4. 公开页面

### 4.1 内容详情 `content.item`（缺省 `/article/:id`，可实例化）

| 方面 | 约定 |
| --- | --- |
| 取数 | `GET /app/content/item/get/{id}?view=false`（**缺口 G1**：服务端渲染不计浏览）；实例的固定参数 `type` 与返回的 `type` 不一致 → `not_found` |
| 状态 | 成功 200；`CONTENT_NOT_FOUND` → `not_found`（404）；撤回 / 归档 / 回收站 → `unavailable`（404 + noindex）；彻底删除 → `gone`（页面层 404 并记入已删除集合，此后 proxy 给 410；正常路径是 site 模块的已删除台账同步，见产品决定 4）（**缺口 G2**：要求服务端区分这三种）；会员可见、密码访问的内容 → 200 + `noindex`，主体渲染「登录后查看」占位，登录后客户端用会话重新取（不进缓存）；有 `redirectUrl` 的跳转型内容 → 307 到该地址，且不进 sitemap |
| 渲染 | 标题、副标题、发布时间（`<time datetime>`）、来源与作者、栏目面包屑、封面、正文；正文由本模块的块渲染器在服务端把结构化正文（12 种块 + 行内标记）渲染成语义 HTML（`h2`/`h3`、`figure` + `figcaption`、`blockquote`、`pre><code`、`table`），代码块在服务端高亮，不发客户端 JS |
| 来源署名 | `origin = reprint`：显示「来源：{sourceName}」，有 `sourceUrl` 时链到原文（`rel="nofollow noopener"`，新窗口）；`origin = compiled`：显示「综合自 {sourceName}」；`original`：不显示来源。作者：有 `authorUserId` 时链到作者页，否则显示 `authorName` 纯文本 |
| 外链 | 正文里的外部链接一律 `rel="nofollow noopener"`；站内链接（同 `origin`）不加 |
| 图片 | 经底座的 `MediaImage`（public-routes §10，产品可换图片加载器）：首图（封面或正文首图）`fetchpriority="high"`、不懒加载，其余 `loading="lazy"`；必须带宽高或按 `listStyle` 的固定比例占位，避免 CLS（**缺口 G7**：媒体宽高） |
| 插槽 | `public.object.toolbar`、`public.object.after`、`public.object.aside`，参数 `ref = content.item:{id}`、`summary = { capabilities, commentCount, favoriteCount, viewCount, link }` |
| 浏览计数 | 客户端岛 `ViewBeacon` 在页面可见 1 秒后发 `POST /app/content/item/view/{id}`（**缺口 G1**），带会话时服务端发 `ObjectViewed` 带上访问者，interaction 据此写足迹；同一标签页只发一次 |
| 缓存 | `object` 档；标签 `obj:content.item:{id}`、`node:content.term:{主栏目 id}`、`site:nav` |

**SEO**

| 项 | 取值 |
| --- | --- |
| title | `seoTitle` ∥ `title` |
| description | `seoDescription` ∥ `summary` ∥ 正文纯文本前 120 字 |
| keywords | `seoKeywords` ∥ 标签名 |
| canonical | `shareUrl`（§3）；转载内容按来源设置可改为原文（§3.1） |
| robots | 公开内容 index；`max-image-preview:large` |
| Open Graph | `type = article`；`images` 取封面（无封面取正文首图）；`article:published_time` = `publishedAt`，`modified_time` = 线上版本更新时间（**缺口 G6**），`section` = 主栏目名，`tag` = 标签 |
| JSON-LD | `NewsArticle`（类型可由产品按内容类型映射：`article` → `NewsArticle`，`page` → `WebPage`，其余缺省 `Article`）+ `BreadcrumbList` |

`NewsArticle` 字段：

| 字段 | 来源 |
| --- | --- |
| `headline` | `title`，超过 110 字符截断 |
| `datePublished` | `publishedAt`（转载内容的 `publishedAt` 已经等于来源时间与本站时间的较早者，content-module §5.1；不另用 `originalPublishedAt`） |
| `dateModified` | 线上版本更新时间（G6）；没有就省略，不用行的 `updatedAt` 冒充 |
| `author` | 有 `authorUserId`：`Person`（`name`、`url` = 作者页）；只有 `authorName`：`Person { name }`；都没有：省略 |
| `publisher` | `Organization`：站点品牌名、Logo（站点配置） |
| `image` | 封面与正文图片，有派生规格时给 16:9、4:3、1:1 三种（G7） |
| `mainEntityOfPage` | canonical |
| `isBasedOn` | `origin` 为 `reprint` / `compiled` 且有 `sourceUrl`：`{ "@type": "CreativeWork", url: sourceUrl, publisher: { name: sourceName } }` |
| `commentCount` | `commentCount`（缓存时效内的值） |
| `articleSection` / `keywords` | 主栏目名 / 标签名 |
| `isAccessibleForFree` | 会员可见内容为 `false` |

### 4.2 单页 `content.page`（`/p/:slug`）

`GET /app/content/item/resolve?type=page&slug={slug}&view=false`。用于关于、协议、隐私政策等页脚链接。`static` 档；JSON-LD `WebPage`；标签 `obj:content.item:{id}`。服务端单页类型的 `sharePath` 是 `/p/{slug}`（content-module §5.6 的例子），与本路由一致。

### 4.3 栏目页 `content.category`（`/category/:slug`）

| 方面 | 约定 |
| --- | --- |
| 取数 | 栏目：`GET /app/content/term/tree?taxonomy=category`（整棵树缓存，标签 `site:nav`，按 slug 找节点）；列表：`GET /app/content/item/query?category={slug}&cursor&limit=20`（服务端自动应用筛选器挂载，filter-module §10.4） |
| 状态 | slug 不在树里 → `not_found`；栏目 `kind = link` → 307 到其链接 |
| 渲染 | 栏目名、简介、子栏目导航、卡片列表（按 `listStyle`）、「下一页」链接（`?cursor=`，同时由客户端改为「加载更多」） |
| SEO | title = 栏目 SEO 标题 ∥ 栏目名；description = 栏目 SEO 描述 ∥ 简介；第一页 index，带 `cursor` 的页 `noindex, follow`、canonical 指向自己；`pagination.next` 指向下一页；JSON-LD `CollectionPage` + `BreadcrumbList` + `ItemList`（本页条目的规范地址） |
| 缓存 | `list` 档；标签 `node:content.term:{id}`、`feed:content.item`、每个条目的 `obj:content.item:{id}` |

带游标的页也渲染完整 HTML：游标是键集游标（排序键 + ID），同一个游标永远指向「某条之后」，URL 稳定，爬虫可以顺着「下一页」走完整个栏目。

### 4.4 标签页 `content.tag`（`/tag/:slug`）

- 取数：标签按 slug 取（**缺口 G3**：`GET /app/content/term/get?taxonomy=tag&slug=`，含名称、描述、SEO 字段、`itemCount`）；列表 `item/query?tags={slug}`。
- **薄页**：`itemCount` 少于站点配置的阈值（缺省 3）时 `noindex, follow`，也不进 sitemap，避免大量只有一两篇的标签页稀释站点质量。
- 其余同栏目页；标签 `node:content.term:{id}`、`feed:content.item`。

### 4.5 作者页 `content.author`（`/author/:id`）

- 取数：作者资料（**缺口 G5**：`GET /app/content/author/{userId}`，经 content 规范里延后的 `ContentAuthorResolver` 给出昵称、头像、简介，只含公开字段）；列表 `item/query?author={userId}`（参数名以服务端为准，content-module §8 的 `authorUserId`）。
- 没有资料且没有已发布内容 → `not_found`。只有字符串 `authorName`（转载作者）的不建作者页。
- SEO：JSON-LD `ProfilePage`，`mainEntity` 为 `Person`；`list` 档；标签 `obj:account.user:{id}`（资料变化时由 site 模块失效，若 account 发布对象事件，见 site-module §9）、`feed:content.item`。

### 4.6 热榜 `content.ranking`（`/hot`）

- 取数：`GET /app/content/item/ranking?period={day|week|month}&by={views|comments}&limit=50`；`period` 缺省 day、`by` 缺省 views，非法值 → `not_found`。
- 只有缺省组合（`/hot`）index，其他组合 `noindex, follow`、canonical 指向自己。
- JSON-LD `ItemList`（带名次 `position`）；`list` 档，CDN 时长可单独调大（排行按日统计，变化慢）。

### 4.7 搜索 `content.search`（`/search?q=`）

- 取数：`GET /app/content/item/search?q&cursor&limit=20`，经 `ctx.backend.withClient()` 转发客户端 IP（服务端按 IP 限流）；`q` 去首尾空白后为空 → 只渲染搜索框；超过 100 字截断。
- 恒为 `noindex, follow`，`dynamic` 档（不缓存）；robots.txt 缺省也把 `/search` 列为 Disallow（底座站点配置）。
- 被限流（429）时渲染提示（`useDescribeError("content")` 翻译 `RATE_LIMITED` 一类机器码），HTTP 状态 429。
- 站点级 `WebSite` JSON-LD 的 `SearchAction` 指向本路由（底座在有搜索路由时自动输出）。

### 4.8 日期归档 `content.archive`（`/archive/:y/:m/:d`）

- 取数：`item/query?publishedAfter={当日 00:00}&publishedBefore={次日 00:00}&sort=published`，在 `load` 里按游标取完当日（上限 500 条），只渲染标题列表。时区取站点配置（缺省 Asia/Shanghai）。
- 日期不合法或在未来 → `not_found`；当日没有内容 → 200 + `noindex`。
- 页内带「前一天 / 后一天」链接，加上 sitemap，搜索引擎不靠游标翻页也能走到全部历史内容。
- 历史日期（早于 2 天前）走 `static` 档，当天与昨天走 `list` 档。
- 产品不需要可在站点配置 `routes.disable`。

### 4.9 专题 `content.topic`（`/topic/:code`）

`GET /app/content/collection/get/{code}`：只渲染 `kind = topic` 的合集（推荐位不出页面）；分区 + 条目卡片 + 专题正文。`list` 档，标签 `obj:content.collection:{id}` 与各条目的 `obj:`。

## 5. 卡片渲染器 `content.item`

- 输入：`item/query` 的卡片（与筛选器 `Card.view` 同形，filter-module §6.7），或 `ObjectSummary`。
- 样式：`listStyle` 的大图 / 单图（右侧）/ 三图 / 无图；挂载的 `cardStyle = auto` 时按 `listStyle`。
- 元信息：相对时间（服务端输出绝对时间，水合后换相对，public-routes §9.5）、来源名、评论数；置顶标记。
- 链接：`shareUrl` 与站点同源时用其路径（站内跳转），否则用本站路由（`ctx.href("content.item", { id })`）；有 `redirectUrl` 时链到它（外部加 `rel="nofollow noopener"`）。
- 图片懒加载，列表首屏前 3 张不懒加载。

## 6. sitemap 与 RSS

| 贡献 | 内容 | 数据 |
| --- | --- | --- |
| `content`（分片） | 已发布、公开、非跳转型内容的规范地址；`lastmod` = 线上版本更新时间；带封面图 `image:image` | **缺口 G4**：`GET /app/content/sitemap/shards` → `[{ id: "2026-10", lastmod, count }]`（按 `published_at` 所在月分片，单月超过 50 000 条再按半月拆）；`GET /app/content/sitemap/items?shard=&cursor=` → `{ list: [{ id, type, slug, shareUrl, publishedAt, updatedAt, cover? }], nextCursor }`（轻量，不含正文，单页 ≤ 5000） |
| `content`（news） | 近 48 小时发布的文章，≤ 1000 条 | `item/query?types=article&publishedAfter={now-48h}&sort=published`，按游标取够 |
| `content-terms` | 可见栏目、达到阈值的标签 | `term/tree`、`term/list?taxonomy=tag`（需要能按 `itemCount` 过滤，**G3** 一并补） |

- 往月分片标 `immutable`（底座按 `static` 档缓存），只有当月和上月走 `list` 档。
- RSS：站点最新 `/rss.xml`（`item/query?sort=published&limit=50`）、栏目 `/category/:slug/rss.xml`；条目只给摘要；`list` 档、`feed:content.item`。

## 7. 控制台

| 页面 | 路径（相对控制台前缀） | 接口 | 要点 |
| --- | --- | --- | --- |
| 我的投稿 | `/content/submissions` | `GET /app/content/submission/mine?cursor` | 状态（待审 / 已发布 / 驳回）、驳回原因 `reviewNote`、已发布的链到公开页（`shareUrl`）；游标分页 |
| 投稿 | `/content/submissions/new` | `GET submission/form?type`、`POST submission/create`、`POST /app/infra/file/upload`（`businessType = content.image`） | 表单字段按 `form` 返回的开关显示（标题、摘要、正文、封面、标签、链接、栏目）；正文用纯文本 + 图片的简化编辑，转成结构化正文提交；限流 429 `CONTENT_SUBMIT_RATE_LIMITED`；字段错误按 `describeFieldErrors` 显示 |

门户页头的「投稿」入口跳 `{consoleBasePath}/content/submissions/new`（未登录先过 `requireLogin`）。

## 8. 语言包与错误

- 命名空间 `content`；zh-CN、en-US 两份，key 集合一致（`check:locales`）。页面里不出现硬编码中文。
- 公开页的固定文案（「来源」「综合自」「下一页」「相关阅读」「热榜」「日榜 / 周榜 / 月榜」……）、`<title>` 模板外的标题后缀都走 `getServerT("content")`。
- 机器码翻译放 `error.<CODE>`：`CONTENT_NOT_FOUND`、`CONTENT_SUBMIT_RATE_LIMITED`、`CATEGORY_REQUIRED`、`CATEGORY_SUBMISSION_DISABLED`、`FIELD_NOT_SUBMITTABLE`、`INVALID_LINK`、`LINK_TOO_LONG`、`LINK_NOT_SUPPORTED`，以及 infra 上传的 `MediaErrorCode`。

## 9. 服务端缺口

本模块开工前需要 content（及 infra）补齐的接口与语义，按 §4.2 定制三分法均属「缺少通用扩展机制」，补进 content-module / infra-media 规范后实现：

| 编号 | 缺口 | 为什么需要 | 建议 |
| --- | --- | --- | --- |
| G1 | 详情读取总是计一次浏览并发 `ObjectViewed` | 服务端渲染被缓存后，一次渲染对应成千上万次访问；渲染时又没有访问者身份，足迹记不上 | `item/get`、`item/resolve` 加 `view=false`（不计数、不发事件）；新增 `POST /app/content/item/view/{id}`（匿名可调，按 IP + 对象限流去重；带令牌时 `ObjectViewed` 带访问者） |
| G2 | 不存在 / 暂时下线 / 已删除都返回不可见 | 404 与 410 的区分（public-routes §7） | 三个机器码：`CONTENT_NOT_FOUND`、`CONTENT_UNAVAILABLE`（撤回、归档、回收站）、`CONTENT_GONE`（彻底删除）；彻底删除保留墓碑行 `content_item_tombstones(id, type, slug, deleted_at)` 供判断 |
| G3 | 标签只能列表，不能按 slug 取 | 标签页标题、SEO、薄页判断 | `GET /app/content/term/get?taxonomy&slug`（含 SEO 字段、`itemCount`）；`term/list` 支持 `minItems` |
| G4 | 没有面向 sitemap 的全量遍历接口 | `item/query` 带卡片字段、限额小，遍历几十万条成本高 | `sitemap/shards`、`sitemap/items`（§6），只读已发布公开内容 |
| G5 | 作者只有 `author_user_id` / `author_name` | 作者页 | 落 content 规范里延后的 `ContentAuthorResolver`，加 `GET /app/content/author/{userId}`（只含公开资料） |
| G6 | 没有「线上版本更新时间」 | `dateModified`、sitemap `lastmod`、`og:modified_time` 不能被计数回写之类的行更新带偏 | 内容行加 `content_updated_at`：线上版本被替换时更新（首次发布 = `published_at`），卡片与详情返回 `contentUpdatedAt` |
| G7 | `MediaView` 没有宽高与派生规格；`content.*` 媒体是 `DELEGATED`，只发 10 分钟签名地址 | CLS；缓存的 HTML 里签名地址会过期，图片搜索与 OG 图失效 | 见 [infra-media.md](infra-media.md) §7.3「CDN 地址策略」（产品决定 1）与 infra M2 图片派生 |
| G8 | 首次发布不发 `ObjectAvailable`；线上版本更新没有通用事件 | site 模块只订阅通用事件就能失效缓存、推送收录 | 首次发布也发 `ObjectAvailable`；新增通用 `ObjectUpdated`（线上表示变化：新版本上线、slug 变化），见 site-module §9 |

**服务端实现状态（2026-10-22，module-content `V004__web_portal_reads.sql`，接口见 [content-module.md](content-module.md) §6.2、§12）**：G1、G2（含墓碑）、G3、G4、G5、G6、G8 与 §3.1 的来源记录已实现，真库测试全绿；content 的匿名可缓存读取已去掉 IP 限流（comment 的匿名读取本来就没有）。与上表的出入：

- `CONTENT_GONE` 的信封码是 10203（`RESOURCE_DELETED`），框架映射成 HTTP 404 而不是 410——客户端只看机器码；网页的 410 由已删除台账给出（public-routes §7.2），页面层照常返回 `gone`。
- 信标去重：同一访问者（登录按账号、匿名按客户端地址）在 `content.view.dedup_seconds` 内只计一次，返回 `{ counted }`；接口另按 IP 限流（每分钟 120 次）。会员可见 / 密码内容匿名上报返回 `LOGIN_REQUIRED`。
- 会员可见 / 密码内容的详情匿名读取仍返回 `LOGIN_REQUIRED`（本模块据此渲染「登录后查看」占位）。
- `term/get` 返回物化路径 `path`（面包屑）与设置 `settings`（栏目 `kind = link` 时有 `linkUrl`，供 307）。
- sitemap 分片按 UTC 月；分片内条目已排除跳转型、非公开、规范链接指向外站（含来源记录指向原文）的内容。

## 10. 分期

| 期 | 内容 | 依赖 |
| --- | --- | --- |
| P1 | 详情、单页、栏目、卡片渲染器、分享、控制台投稿 | 底座 P1；G1、G2（不含墓碑）、G6 |
| P2 | 标签、作者、热榜、搜索、专题；sitemap、RSS；缓存标签 | 底座 P2–P3；G3、G4、G5、G8 |
| P3 | 日期归档；410；结构化数据补全（图片多比例） | G2 墓碑、G7 |

## 11. 开放项

| 项 | 默认 |
| --- | --- |
| 转载内容的 canonical 指向本站还是原文 | **已决（产品决定 3）**：缺省指向本站 + `isBasedOn` 署名；按来源可配成指向原文，见 §3.1 |
| 正文外链是否经站内跳转提示页（`/go?url=`） | 不经，直接 `nofollow`；需要跳转提示的产品以后加可选路由（noindex） |
| 频道页（筛选器节点 `/app/channel/{code}`）放哪 | **已决（产品决定 2）**：标准模块 `client-filter`（C1 已实现）。理由：频道 / 楼层是 filter 模块的通用能力，任何装了 filter 的门户都要这一页，按定制三分法属于「缺通用扩展点」，不该让每个产品手写 |
| 相关阅读 | 服务端 `related` 延后；先用「同栏目最新 5 篇」填 `public.object.aside` |

## 12. 实现记录（itwind C2）

仓库 `neton-application-client-content`（本地，未推送）。与正文的出入与补充：

| 项 | 实现 |
| --- | --- |
| 归档路由参数 | 月、日是两位数的枚举（`/archive/2026/10/05`）：底座 `int` 规则拒绝前导零，一个日期只该有一个地址 |
| 站点 feed | `/rss.xml` 声明为 `site: true`（底座聚合站点 feed 的约定，public-routes §11.3） |
| 详情侧栏 | 模块自带两个 `public.object.aside` 服务端插槽：`content.category-latest`（同栏目最新 5 篇，§11 开放项的默认）、`content.ranking`（日榜）；产品用 `slots.order` / `slots.hide` 编排 |
| 封面与正文首图 | 正文有图时详情页不在正文上方重复放封面（采集 / 转载的封面通常就是正文首图）；首屏优先图是正文首图，正文没有图时才是封面。封面仍用于卡片、OG 与 JSON-LD |
| 详情页时间 | 详情页给精确的绝对时间，不在水合后换成相对时间（换了会改变这一行的折行，正文整体下移，实测 CLS 0.17）；卡片仍是相对时间 |
| 图片尺寸 | 每个图片位置给出 `displayWidth`（桌面上的最大 CSS 宽度），`src` / `srcset` 取它的 1×–2× 档；窄屏 `sizes` 写 `calc(100vw - 2rem)` |
| 卡片标题级别 | 卡片标题按列表给的 `headingLevel`（public-routes §10.3）；本模块的列表页（栏目、标签、作者、搜索）给 2 |
| 转载署名 | `origin = compiled` 显示「综合自 …」、没有 `sourceUrl` 时不输出 `isBasedOn`；AI 编辑部的合成稿以 `compiled` 交付（newsroom 1cc838b，itwind 迁移 V005 改正存量） |
| 公开岛屿的词条 | 客户端岛只用 `public.*` / `error.*` 词条（底座 check:locales 强制），公开页只预载这些 |
| 测试 | 单测 64 项（块渲染与转义、状态映射、SEO / JSON-LD、canonical 与 308、卡片链接与尺寸、sitemap 分片、feed、薄页、热榜参数、搜索规范化、二维码向量）；itwind-client 的 `e2e/c2.e2e.mts` 对真实后端验收 |

