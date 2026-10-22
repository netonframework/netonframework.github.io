# client-comment 评论区与「我的评论」

> 标识：NETON-APP-CLIENT-COMMENT
> 日期：2026-10-22 · 状态：**Accepted r3**（P1–P2 已实现，随 itwind C3 交付，见 §12；P3 待稳定媒体地址）
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
    { target: "public.object.after", id: "comment.thread", entry: "thread", rendering: "server", capability: "comment", order: 10 },   // server 组件渲染客户端岛（契约不单列 hybrid）
    { target: "public.object.bar", id: "comment.bar", entry: "bar", rendering: "client", capability: "comment", order: 10 },        // 手机吸底条：写评论 + 评论数
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
| 图片 | 评论图是 `comment.image`（`DELEGATED`），列表里给的是短期签名地址，**不能写进缓存的 HTML**：服务端只输出占位（宽高比框 + 数量），客户端岛水合后取新地址再显示（或按 infra-media §7.3 的 CDN 地址策略给出可缓存的地址） |
| 对象不可评论 | 对象没有 `comment` 能力时插槽不渲染；评论已关闭或锁定时只读展示已有评论，评论框换成「评论已关闭」 |
| 缓存 | 插槽自己的缓存单元，`list` 档（30 秒新鲜、60 秒重验证）；标签 `thread:{targetType}:{targetId}`、每条评论的 `obj:comment.comment:{id}`、渲染出的用户 `obj:account.user:{userId}`（头像昵称变化） |
| 失败 | 评论服务出错时插槽显示「评论加载失败，点此重试」（客户端岛负责重试），不影响正文与状态码 |

为什么第一页按「最新」而不是「最热」：最热排序有 10 分钟快照与快照过期码（comment-module §3.7），不适合放进缓存的 HTML；热门评论已经在第一页的附带字段里单独展示。

### 3.2 客户端岛（交互）

- 服务端输出静态评论区；交互岛按需加载（见 §12），接管时取一次第一页，之后的状态都在岛里（不依赖 TanStack Query）。
- **排序切换**（最新 / 最早 / 最热）、**翻页**（游标「加载更多」）、**展开回复**（`GET replies?rootId&cursor`）、**展开引用链**（`GET chain/{id}`）都在客户端，经底座代理匿名调用。
- **我的投票**：水合后对页面上的评论 ID 批量取我的投票状态，经 `ObjectStateBatcher` 合并（**缺口 C1**）；拿到前按钮显示中性态。
- **发表与回复**：`POST /app/comment/create`（`{ targetType, targetId, parentId?, content, images?, client: "web" }`）。未登录时评论框显示「登录后发表评论」，点击 `requireLogin({ returnTo: "#comment-new" })`（评论框自己的锚点，登录回来后岛看到它就展开并聚焦评论框；回复、投票、举报回到 `#comment-{id}`）。发表成功：可见的插到列表顶部（最新排序）或回复区；`pending` 的只对作者显示并标「审核中」。
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
- **已决（产品决定 5）**：网页端一律 `client = "web"`，不传 `deviceTail`，不区分 `wap`。理由：响应式单域名，窄屏与宽屏是同一个网页端；按视口宽度区分只是猜测，且会让同一个人在不同窗口宽度下得到两种标签。

## 4. SEO

- 评论是用户生成内容：评论区里任何链接（以后支持自动链接时）一律 `rel="ugc nofollow noopener"`。
- 文章的 `NewsArticle.commentCount` 由 client-content 输出；本模块不额外输出评论的 JSON-LD（Google 的讨论区结构化数据针对论坛，不适用于文章评论）。
- 评论区放在 `<section id="comments" aria-labelledby>` 里，标题「网友评论（N）」。

## 5. 公开页面

### 5.1 评论定位 `comment.locate`（`/comment/:id`）

分享单条评论用的地址。`GET /app/comment/get/{id}` → 取所属对象的 `link.web`，307 到 `{link.web}#comment-{id}`（同源时为站内路径；路由契约的非永久跳转即 307）；评论不可见或对象不可见 → `not_found`。恒为 `noindex`，不进 sitemap。

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
| C1（**已实现**，module-comment cea7b4b） | 列表若带「我的投票」等访问者字段，服务端渲染（匿名）拿不到，客户端又不该为此重拉整页 | 列表对匿名与登录用户同形（登录用户的 `myVote` 照给，App 用；匿名为 0）；新增 `POST /app/comment/viewer-state`：需登录、按用户限流，body `{ commentIds: [id] }`（≤ 100，超出 400 `TOO_MANY_COMMENT_IDS`；空 → `{ votes: {}, mine: [] }`）→ `{ votes: { "<id>": 1 \| -1 }, mine: [id] }`；只回答此人看得到的评论，不认识或看不到的 ID 不出现 |
| C2（**已实现**） | 评论被隐藏、删除时只发 `CommentActivity`（comment 契约） | 隐藏、管理员删除、作者删除（以及送审）发 `ObjectUnavailable(subject = comment.comment:{id}, permanent = false)`，恢复 / 审核通过发 `ObjectAvailable`，折叠 ↔ 展开发 `ObjectUpdated(changes = visibility)`；都在状态变化的同一事务里、可重试投递。site 失效 `obj:comment.comment:{id}`（expire）；另外 site 按评论数（`ObjectCounterChanged(comments)`）在 10 秒窗口里刷新 `thread:{type}:{id}`，新评论对所有访客约 10 秒内可见（site-module §4） |
| C3（**已实现**） | `comment.comment` 的 `ObjectSummary.link.web` 是否带 `#comment-{id}` 未定义 | 「对象的 `link.web` + `#comment-{id}`」（对象地址已带锚点时替换）；隐藏 / 删除的评论照样给出地址（site 据此找到所在页面），别人的待审评论与看不到的对象不给。App 链接沿用对象深链。另：`GET get/{id}` 改为返回 `{ comment, available, targetTitle, targetAppLink, targetWebLink, parent }`，定位页直接据 `targetWebLink` 跳转 |
| C4 | 评论图只有短期签名地址 | 第一版客户端水合后再取；长期见 infra-media §7.3 CDN 地址策略 |
| C5（**已实现**） | 第一页附带的对象设置是否含图片上限、是否允许匿名查看 | 第一页返回 `settings: { imagesMax, contentMaxLength, closed, locked, mode }`（之后的页为 null；锁定时 `list` 为空、`locked = true`），前端据此渲染评论框 |

## 10. 分期

| 期 | 内容 |
| --- | --- |
| P1 | 评论区（服务端第一页 + 客户端发表 / 回复 / 投票 / 翻页 / 排序 / 删除 / 举报）、控制台两页、红点 |
| P2 | 评论图片、定位页、热评榜、`comment.comment` 卡片、缓存标签接入 site 失效；C1–C3、C5 |
| P3 | 稳定媒体地址（C4）后评论图进服务端 HTML |

## 11. 开放项

| 项 | 默认 |
| --- | --- |
| 窄屏访问是否记 `client = wap` | **已决（产品决定 5）**：不区分，统一 `web`，无设备小尾巴 |
| 服务端第一页条数 | 20 条顶层评论 + 每条 3 条预览回复（`comment.thread.preview_replies`） |
| 是否自动把正文里的网址转成链接 | 第一版不转；转的话一律 `ugc nofollow` 并经外链安全策略 |

## 12. 实现记录（itwind C3，2026-10-22）

仓库 `neton-application-client-comment`。与上文不同或补充的决定：

| 项 | 实现 |
| --- | --- |
| 评论区首屏 JS | **静态评论区 + 激活器**：服务端插槽把第一页渲染成没有客户端 JS 的静态标记（`views/static-thread.tsx`，可收录）；外面的激活器（约 1 KB）在读者第一次交互时（点任何带 `data-comment-action` 的按钮）才按需加载交互岛（`client/thread.tsx`）并重放这次操作，登录用户在浏览器空闲时自动接管（显示我的票、删除按钮），地址带 `#comment-new` / 不在第一页的 `#comment-{id}` 时立即接管。匿名读者点需要登录的按钮直接整页去登录，不加载岛。静态评论区与岛共用 `views/thread-view.tsx` 的标记，接管时页面不跳动。itwind 实测：文章页路由自身 JS 15.0 KB（接入评论前 C2 为 10.5 KB，增量主要是底座的批量状态与 Web Vitals 信标） |
| 为什么不是「岛 + 初始数据」或「Suspense 延迟水合」 | 底座把所有公开插槽的客户端岛放进每个公开路由共用的布局块：岛直接 import 会让每一页多出约 9 KB。用 Suspense + `React.lazy` 延迟水合则会触发 React 19 的流式外移：首 12.8 KB 之后、超过 500 字节的已完成 Suspense 边界被移到文档末尾的隐藏节点再由脚本搬回（`progressiveChunkSize`，itwind 实测评论区跑到页脚之后），不执行 JS 的爬虫看到的位置不对，也违反「主内容不进流式边界」 |
| 第一页取两次？ | 岛接管时自己再取一次第一页（登录用户带身份，自己审核中的评论也在里面）。只读的访客永远不触发；与「不重复请求第一页」的原设计相比，换来的是所有读者零评论区 JS |
| 折叠 | `<details>` / `<summary>`，不依赖 JS |
| 定位高亮 | CSS `:target`；不在第一页时 `get/{id}` + `chain/{id}` 插到顶部 |
| 我的状态 | `ObjectStateBatcher` loader `comment.viewer-state`（≤ 100 / 批），值 `{ vote, mine }`；发表成功即 `setObjectState(mine = true)` |
| 跨岛通信 | DOM 事件 `neton:comment:compose`（吸底条 → 评论框）、`neton:comment:replies-read`（回复我的 → 红点） |
| 控制台两页 | 原排在 itwind C4，随 P1 在 C3 一并交付 |
| 红点 | 同一个岛同时贡献给 `public.header.actions` 与 `console.header.actions`；底座在两处外层都挂会话水合 |
