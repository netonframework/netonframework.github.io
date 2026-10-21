# client-comment 评论区与「我的评论」

> 标识：NETON-APP-CLIENT-COMMENT
> 日期：2026-10-22 · 状态：Draft r1（待评审，未实现）
> 仓库：`neton-application-client-comment`
> 依赖：底座公开路由契约 `neton-application-client/docs/spec/public-routes.md`（插槽、水合、`requireLogin`、`ObjectStateBatcher`）；服务端 [comment-module.md](comment-module.md) 的 App 接口
> 评论区只认 `ObjectRef`：挂在任何声明了 `public.object.after` 插槽、且对象具备 `comment` 能力的详情页上，不认识 content。

## 1. 边界

**负责**：对象详情页下的评论区（服务端输出第一页供收录，客户端接管发表、回复、投票、排序、翻页、举报、删除）；评论分享定位；热评榜页；`comment.comment` 卡片渲染器（筛选器频道里的热评）；页头「回复我的」红点；控制台「我的评论」「回复我的」。

**不负责**：对象本身、对象的评论开关（由对象的访问策略与 comment 的 target 设置决定）；通知推送。

## 2. manifest

```ts
export default defineFrontModule({
  id: "comment",
  contractVersion: "1.1.0",
  locales: [{ lang: "zh-CN", entry: "zh-CN" }, { lang: "en-US", entry: "en-US" }],
  slots: [
    { target: "public.object.after", id: "comment.thread", entry: "thread", rendering: "hybrid", capability: "comment", order: 10 },
    { target: "public.header.actions", id: "comment.replies-badge", entry: "replies-badge", rendering: "client", order: 50 },
    { target: "console.header.actions", id: "comment.replies-badge", entry: "replies-badge", rendering: "client", order: 50 },
  ],
  publicRoutes: [
    { key: "comment.locate", pattern: "/comment/:id", params: { id: "id" }, entry: "locate", cache: "list", indexable: false },
    { key: "comment.ranking", pattern: "/hot/comments", query: ["period"], entry: "ranking", cache: "list", indexable: false },
  ],
  cardRenderers: [{ objectType: "comment.comment", entry: "comment-card" }],
  pages: [
    { key: "comment/mine/index", path: "/comment/mine", entry: "mine", rendering: "client", title: "我的评论" },
    { key: "comment/replies/index", path: "/comment/replies", entry: "replies", rendering: "client", title: "回复我的" },
  ],
});
```

## 3. 评论区插槽 `comment.thread`

### 3.1 服务端部分（可收录）

| 方面 | 约定 |
| --- | --- |
| 取数 | `GET /app/comment/list?targetType&targetId&mode={对象的缺省形态}&order=latest`（匿名）；第一页附带置顶、精选、热门评论与对象的评论数、状态（comment-module §10） |
| 形态 | 以服务端返回的对象缺省形态为准：楼中楼 `thread`（顶层 + 预览回复 + 「查看全部 N 条回复」）或盖楼 `stack`（引用链，长链折叠为「展开隐藏的 N 层」）；两种形态的 HTML 结构都由本模块渲染 |
| 内容 | 每条评论 `<article id="comment-{id}">`：头像、昵称、楼号、时间（`<time datetime>`）、IP 属地、设备小尾巴或客户端（§3.4）、正文、支持 / 反对数、回复数；占位状态按可见性矩阵（comment-module §3.4）显示「该评论已删除」等，文案走语言包 |
| 正文 | 纯文本按原样转义输出，保留换行；不自动转链接（第一版）；表情占位符由本模块渲染为图片或 emoji |
| 图片 | 评论图是 `comment.image`（`DELEGATED`），列表里给的是短期签名地址，**不能写进缓存的 HTML**：服务端只输出占位（宽高比框 + 数量），客户端岛水合后取新地址再显示（或改用稳定媒体地址，site-module §9） |
| 对象不可评论 | 对象没有 `comment` 能力时插槽不渲染；评论已关闭或锁定时只读展示已有评论，评论框换成「评论已关闭」 |
| 缓存 | 插槽自己的缓存单元，`list` 档（30 秒新鲜、60 秒重验证）；标签 `thread:{targetType}:{targetId}`、每条评论的 `obj:comment.comment:{id}`、渲染出的用户 `obj:account.user:{userId}`（头像昵称变化） |
| 失败 | 评论服务出错时插槽显示「评论加载失败，点此重试」（客户端岛负责重试），不影响正文与状态码 |

为什么第一页按「最新」而不是「最热」：最热排序有 10 分钟快照与快照过期码（comment-module §3.7），不适合放进缓存的 HTML；热门评论已经在第一页的附带字段里单独展示。

### 3.2 客户端岛（交互）

- 以服务端数据为初始值（TanStack Query `initialData`，`staleTime` 60 秒），不重复请求第一页。
- **排序切换**（最新 / 最早 / 最热）、**翻页**（游标「加载更多」）、**展开回复**（`GET replies?rootId&cursor`）、**展开引用链**（`GET chain/{id}`）都在客户端，经底座代理匿名调用。
- **我的投票**：水合后对页面上的评论 ID 批量取我的投票状态，经 `ObjectStateBatcher` 合并（**缺口 C1**）；拿到前按钮显示中性态。
- **发表与回复**：`POST /app/comment/create`（`{ targetType, targetId, parentId?, content, images?, client: "web" }`）。未登录时评论框显示「登录后发表评论」，点击 `requireLogin({ returnTo: "#comments" })`。发表成功：可见的插到列表顶部（最新排序）或回复区；`pending` 的只对作者显示并标「审核中」。
- **图片**：先 `POST /app/infra/file/upload`（`businessType = comment.image`）拿 `fileId`，再随评论提交；张数上限取服务端配置（第一页附带的对象设置），超出前端先拦。
- **投票**：`POST vote`（1 / -1 / 0），乐观更新，失败回滚。
- **举报**：`POST report`，理由选项走语言包。
- **删除**：`DELETE delete/{id}`，只对自己的评论显示；成功后就地变成「你已删除该评论」占位。
- **限流与错误**：所有错误经 `useDescribeError("comment")`；`INVALID_DEVICE_TAIL`、`IMAGES_NOT_ALLOWED`、`TOO_MANY_IMAGES`、敏感词拒绝、频率限制等都有词条。
- **定位**：URL 带 `#comment-{id}` 时，岛在第一页里找不到就调 `GET get/{id}` 与 `GET chain/{id}` 把它和上下文插到顶部并高亮。

### 3.3 与缓存的关系

- 用户自己发的评论只在自己的客户端立即可见；其他访客在评论区缓存过期（≤ 60 秒）后看到，这是有意的取舍：评论区不因每条新评论失效整页。
- **管理员隐藏 / 删除**一条评论后必须很快从所有缓存里消失：服务端 site 模块收到评论的不可见事件后失效 `obj:comment.comment:{id}`（mode = `expire`），并刷新对象页的 CDN（site-module §5）。
- 对象页的 HTML 里同时有正文与评论区，CDN 层的时效取两者较短者（public-routes §8.1 的 `object` 档 CDN 只有 60 秒）。

### 3.4 设备小尾巴与客户端

- Web 端发评论传 `client: "web"`，**不传 `deviceTail`**：浏览器 UA 推出来的机型不可靠，也不应把 UA 当身份展示。
- 展示：评论有 `deviceTail` 时显示它；没有时按 `client` 显示「来自网页版」「来自手机网页」一类词条（`client = web` / `wap`）；`client = app` 且无尾巴时不显示。IP 属地、小尾巴被服务端关闭时接口返回 null，不显示。
- 是否把窄屏访问记为 `wap`：第一版统一 `web`（开放项）。

## 4. SEO

- 评论是用户生成内容：评论区里任何链接（以后支持自动链接时）一律 `rel="ugc nofollow noopener"`。
- 文章的 `NewsArticle.commentCount` 由 client-content 输出；本模块不额外输出评论的 JSON-LD（Google 的讨论区结构化数据针对论坛，不适用于文章评论）。
- 评论区放在 `<section id="comments" aria-labelledby>` 里，标题「网友评论（N）」。

## 5. 公开页面

### 5.1 评论定位 `comment.locate`（`/comment/:id`）

分享单条评论用的地址。`GET /app/comment/get/{id}` → 取所属对象的 `link.web`，302 到 `{link.web}#comment-{id}`；评论不可见或对象不可见 → `not_found`。恒为 `noindex`，不进 sitemap。

### 5.2 热评榜 `comment.ranking`（`/hot/comments`）

`GET /app/comment/ranking?period={day|week|month}`：评论正文、作者、支持数、原文标题与链接（`targetWebLink`）。`noindex, follow`（聚合的用户内容，本身不作为收录目标）；`list` 档；标签 `feed:comment.comment` 与各条评论的 `obj:`。

### 5.3 卡片渲染器 `comment.comment`

筛选器频道里的热评卡片（`cardStyle = quote`）：引用样式的正文、作者、支持数，下方是原文标题链接。

## 6. 「回复我的」红点

`replies-badge`：会话就绪后 `GET /app/comment/replies-to-me/unread-count`，显示 `count`（> 99 显示「99+」）；点击进控制台「回复我的」。页面可见时每 60 秒刷新一次，不可见时停。未登录不渲染。

## 7. 控制台

| 页面 | 路径 | 接口 | 要点 |
| --- | --- | --- | --- |
| 我的评论 | `/comment/mine` | `GET /app/comment/mine?cursor` | 条目 `{ comment, available, targetTitle, targetWebLink, parent }`；对象失效显示「原文已失效」；点击跳 `/comment/{id}` 定位；可删除 |
| 回复我的 | `/comment/replies` | `GET replies-to-me?cursor`、`POST replies-to-me/read` | 打开即标记已读（只前进不后退）；未读条目高亮；「回复」直接在条目下展开回复框（`POST create`，`parentId` = 该回复） |

跳到公开页用 `targetWebLink`（同源时站内跳转）；为空时（服务端没配站点地址）隐藏跳转。

## 8. 语言包与错误

命名空间 `comment`，zh-CN / en-US。可见性占位文案（comment-module §3.4 的六种状态 × 作者本人 / 其他人）、排序名、「查看全部 N 条回复」（复数规则）、「展开隐藏的 N 层」、举报理由、客户端标签、错误码词条（`INVALID_DEVICE_TAIL`、`IMAGES_NOT_ALLOWED`、`TOO_MANY_IMAGES`、热门快照过期码、限流码、infra `MediaErrorCode`）。

## 9. 服务端缺口

| 编号 | 缺口 | 建议 |
| --- | --- | --- |
| C1 | 列表若带「我的投票」等访问者字段，服务端渲染（匿名）拿不到，客户端又不该为此重拉整页 | 列表接口对匿名与登录用户返回同形数据，访问者字段拆到 `POST /app/comment/viewer-state`（body：`commentIds[]` ≤ 100 → `{ votes: { id: 1 \| -1 } , mine: [id] }`）；若列表本来就不含访问者字段，只需新增此接口 |
| C2 | 评论被隐藏、删除时只发 `CommentActivity`（comment 契约） | 同时发通用 `ObjectUnavailable(subject = comment.comment:{id})`，恢复时 `ObjectAvailable`；site 模块只订阅通用事件（site-module §9） |
| C3 | `comment.comment` 的 `ObjectSummary.link.web` 是否带 `#comment-{id}` 未定义 | 定义为「对象的 `link.web` + `#comment-{id}`」，site 模块刷新 CDN 时去掉锚点 |
| C4 | 评论图只有短期签名地址 | 第一版客户端水合后再取；长期见 site-module §9 稳定媒体地址 |
| C5 | 第一页附带的对象设置是否含图片上限、是否允许匿名查看 | 第一页返回 `settings: { imagesMax, closed, locked, mode }`，前端据此渲染评论框 |

## 10. 分期

| 期 | 内容 |
| --- | --- |
| P1 | 评论区（服务端第一页 + 客户端发表 / 回复 / 投票 / 翻页 / 排序 / 删除 / 举报）、控制台两页、红点 |
| P2 | 评论图片、定位页、热评榜、`comment.comment` 卡片、缓存标签接入 site 失效；C1–C3、C5 |
| P3 | 稳定媒体地址（C4）后评论图进服务端 HTML |

## 11. 开放项

| 项 | 默认 |
| --- | --- |
| 窄屏访问是否记 `client = wap` | 不区分，统一 `web` |
| 服务端第一页条数 | 20 条顶层评论 + 每条 3 条预览回复（`comment.thread.preview_replies`） |
| 是否自动把正文里的网址转成链接 | 第一版不转；转的话一律 `ugc nofollow` 并经外链安全策略 |
