# client-interaction 收藏按钮、我的收藏与足迹

> 标识：NETON-APP-CLIENT-INTERACTION
> 日期：2026-10-22 · 状态：**Accepted r3**（P1 已实现，itwind C4；r3：插槽按底座契约改为 server + 激活器，匿名不请求 state，控制台首页概览，服务端补 `mine/summary` 与 `coverUrl`）
> 仓库：`neton-application-client-interaction`
> 依赖：底座公开路由契约 `neton-application-client/docs/spec/public-routes.md`；服务端 [interaction-module.md](interaction-module.md) 的 App 接口
> 与评论区一样只认 `ObjectRef`：收藏按钮挂在任何具备 `favorite` 能力的对象详情页上。

## 1. 边界

**负责**：公开页的收藏按钮（及可选的点赞按钮）；控制台「我的收藏」「我的足迹」。

**不负责**：足迹的产生（由对象模块在浏览时发 `ObjectViewed`，Web 端靠 client-content 的浏览信标，client-content §4.1）；分享（client-content）；关注、收藏夹（服务端 P2）。

## 2. manifest

```ts
export default defineFrontModule({
  id: "interaction",
  contractVersion: "1.1.0",
  locales: [{ lang: "zh-CN", entry: "zh-CN" }, { lang: "en-US", entry: "en-US" }],
  slots: [
    { target: "public.object.toolbar", id: "interaction.favorite", entry: "favorite-button", rendering: "server", capability: "favorite", order: 20 },
    { target: "public.object.bar", id: "interaction.favorite", entry: "favorite-bar", rendering: "server", capability: "favorite", order: 20 },
    { target: "console.home", id: "interaction.overview", entry: "overview", rendering: "client", order: 20 },
  ],
  pages: [
    { key: "interaction/favorite/index", path: "/interaction/favorites", entry: "favorites", rendering: "client", title: "我的收藏" },
    { key: "interaction/history/index", path: "/interaction/history", entry: "history", rendering: "client", title: "我的足迹" },
  ],
});
```

- 底座契约没有 `hybrid`（public-routes §10.2）：「服务端出首屏 + 客户端接管」= server 插槽里渲染一个激活器包着静态按钮（§3）。
- 点赞按钮随 P2（服务端点赞已有，网页端 C4 不装；产品要时加 `interaction.like` 插槽，形状与收藏同构）。

## 3. 收藏按钮

| 阶段 | 行为 |
| --- | --- |
| 服务端 | 插槽用 `summary.favoriteCount` 渲染未按下态的「☆ 收藏 N」（工具栏：带字的圆角按钮，`id="interaction-favorite"`；吸底条：星标 + 数字，`aria-label="收藏，N 人收藏"`）。不额外请求（计数随详情页缓存，允许滞后）；缓存的 HTML 里没有任何「我的」状态 |
| 激活器（约 1 KB，进公开页共享块） | 原样显示静态按钮，外层 `display: contents` 不改排版。**登录用户**在浏览器空闲时接管：按需加载交互岛，岛向 `ObjectStateBatcher` 登记本对象（键 `interaction.state`，`type:id`）；同一节拍里全页的登记（工具栏与吸底条是同一个对象）合并成一次 `POST /app/interaction/state`。**匿名访客不请求**：计数用缓存里的（§5 允许滞后），不为每个匿名浏览多打一次接口 |
| 点击（未登录） | `requireLogin({ returnTo: "#interaction-favorite" })`，不发请求；登录回来地址带锚点 → 岛接管后收藏一次（已收藏则不动）并去掉锚点（刷新不会重复）；同页两个按钮只做一次 |
| 点击（接管前、已登录） | 交给岛重放：等我的状态到了再切换 |
| 点击（已登录） | 乐观切换（计数 ±1，不低于 0）；`POST /app/interaction/favorite` 或 `DELETE favorite?objectType&objectId`，以响应里的状态为准；请求在途时按钮 `aria-busy`、忽略连点。失败回滚并提示（`useDescribeError("interaction")`：`INTERACTION_RATE_LIMITED`、`INVALID_OBJECT_REF`、`OBJECT_NOT_FOUND`、`ACTION_NOT_SUPPORTED` 等）；会话过期（401）去登录。成功提示「已加入收藏 / 已取消收藏」2 秒 |
| 无障碍 | `<button aria-pressed>`，计数 `aria-live="polite"`，提示 `role="status"`（错误 `role="alert"`） |

交互岛（批量器、接口调用、错误说明）不进任何公开路由的首屏 JS（public-routes §10.6）；itwind 文章页路由自身 JS 16.2 KB（C3 15.0 KB，增量是激活器）。

## 4. 控制台

| 页面 | 路径 | 接口 | 要点 |
| --- | --- | --- | --- |
| 我的收藏 | `/interaction/favorites` | `GET /app/interaction/favorite/page?objectType&cursor&limit=20` | 条目带对象摘要（标题、摘要、封面缩略图 `coverUrl`、`link.web`）；`available = false` 显示「该内容已失效」占位，仍可取消收藏；「取消收藏」就地移除；按对象类型的标签页（全部 / 文章……，类型名走语言包 `objectType.<type>`，没有词条显示类型 code；类型与条数来自 `GET mine/summary`，只有一种类型时不显示标签页） |
| 我的足迹 | `/interaction/history` | `GET history/page?cursor`、`DELETE history`（清空）、`DELETE history?objectType&objectId`（删一条） | 按 `lastViewedAt` 的本地日期分组（今天 / 昨天 / 日期，跨年带年份）；「看过 N 次」；清空前就地确认；失效对象占位同上 |
| 首页卡片 | `console.home` | `GET mine/summary`、`GET favorite/page?limit=3` | 「收藏与足迹」：收藏数、足迹数（链到两页）与最近 3 条收藏 |

- 点击条目跳 `link.web`：与站点同源时站内地址（离开控制台到门户，同一标签页），否则新窗口打开；`link.web` 为空不给跳转（I3）。
- 封面地址没有 CDN 时是后端中转地址（`/app/…`），经底座代理 `/api/backend` 取（`browserMediaUrl`）。
- 与 App 同一账号同一张表：App 收藏的网页能看到，反之亦然；足迹同理（网页端由文章页的浏览信标产生，client-content §4.1）。

## 5. 与缓存的关系

- 缓存的 HTML 只含计数，不含任何「我的」状态（public-routes §1 决议 3）。
- 收藏不触发页面失效：计数允许在缓存时效内滞后，客户端水合后由 `state` 接口给出准确值。服务端 `ObjectCounterChanged`（收藏、点赞）不进 site 模块的失效订阅——C4 起在发布端就筛掉（site 的计数监听者 `accepts` 只收评论数，框架 `DomainEventListener.accepts`），收藏 / 点赞不再为 site 写待投递事件行（实测 30 次收藏 / 取消 / 点赞：0 行，此前每次 1 行）。

## 6. 语言包与错误

命名空间 `interaction`，zh-CN / en-US：按钮文案（收藏 / 已收藏、赞）、计数格式（大于一万显示「1.2万」按 Intl 紧凑格式）、列表与空状态、清空确认、失效占位、错误码词条。

## 7. 服务端缺口

| 编号 | 缺口 | 处理 |
| --- | --- | --- |
| I1 | Web 端足迹依赖详情读取发出的 `ObjectViewed` 带访问者，而服务端渲染没有访问者 | 由 content 的浏览信标补（client-content G1）；interaction 本身不改。C4 实测：登录后打开文章，页面可见满 1 秒后足迹出现 |
| I2 | `state` 接口经底座代理匿名调用 | 底座代理的匿名转发已在 C1 实现；网页端只为登录用户调（§3） |
| I3 | 对象摘要 `link.web` 为空时控制台无处可跳 | 不改服务端；前端隐藏跳转，只保留取消收藏 |
| I4（C4 已实现） | 列表封面只有 `coverFileId`，网页逐条换地址要 20 次请求 | 列表接口按访问者批量展开封面，给 `coverUrl`（宽度档 w360，没有时原图地址；interaction-module §5） |
| I5（C4 已实现） | 标签页与首页卡片要「我有哪些类型、各几条」 | `GET /app/interaction/mine/summary` |

## 8. 分期

| 期 | 内容 |
| --- | --- |
| P1（已实现，itwind C4） | 收藏按钮（工具栏与吸底条）、我的收藏、我的足迹、控制台首页卡片 |
| P2 | 点赞按钮；收藏夹（随服务端 P2） |

## 9. 开放项

| 项 | 默认 |
| --- | --- |
| 匿名访客能否看到收藏数 | 能（计数公开，与 App 一致） |
| 足迹是否在门户里有入口 | 只在控制台；页头用户菜单放「我的收藏」「我的足迹」两个链接（底座 `PublicUserMenu links`，外壳给出） |
| 匿名访客是否请求 `state` 拿实时计数 | **不请求**（r3）：缓存里的计数允许滞后（§5），匿名浏览量远大于登录浏览量，不值得多一次接口 |
