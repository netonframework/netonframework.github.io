# client-interaction 收藏按钮、我的收藏与足迹

> 标识：NETON-APP-CLIENT-INTERACTION
> 日期：2026-10-22 · 状态：Draft r1（待评审，未实现）
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
    { target: "public.object.toolbar", id: "interaction.favorite", entry: "favorite-button", rendering: "hybrid", capability: "favorite", order: 20 },
    { target: "public.object.toolbar", id: "interaction.like", entry: "like-button", rendering: "hybrid", capability: "like", order: 10 },
  ],
  pages: [
    { key: "interaction/favorite/index", path: "/interaction/favorites", entry: "favorites", rendering: "client", title: "我的收藏" },
    { key: "interaction/history/index", path: "/interaction/history", entry: "history", rendering: "client", title: "我的足迹" },
  ],
});
```

点赞按钮默认装配但对象没有 `like` 能力时不渲染；产品不要可在站点配置 `slots.hide`。

## 3. 收藏按钮

| 阶段 | 行为 |
| --- | --- |
| 服务端 | 用插槽参数 `summary.favoriteCount` 渲染「收藏 N」，未按下态。不额外请求（计数随详情页一起缓存，允许滞后） |
| 水合后 | 向 `ObjectStateBatcher` 登记本对象；同一帧内全页的登记合并为一次 `POST /app/interaction/state`（`objects: [{ objectType, objectId }]`，匿名也可调，只返回计数）；用返回的计数与我的状态更新 |
| 点击（未登录） | `requireLogin({ returnTo })`，不发请求 |
| 点击（已登录） | 乐观切换；`POST /app/interaction/favorite` 或 `DELETE favorite?objectType&objectId`；失败回滚并提示（`useDescribeError("interaction")`，限流 `INTERACTION_RATE_LIMITED`、`INVALID_OBJECT_REF`、拒绝类码）。接口幂等，重复点击不产生重复数据 |
| 无障碍 | `<button aria-pressed>`，计数变化用 `aria-live="polite"` |

点赞按钮同构（`POST like` / `DELETE like`）。

批量加载器注册在 `ObjectStateBatcher` 里（键 `interaction.state`），评论区等其他模块的状态请求互不干扰。

## 4. 控制台

| 页面 | 路径 | 接口 | 要点 |
| --- | --- | --- | --- |
| 我的收藏 | `/interaction/favorites` | `GET /app/interaction/favorite/page?objectType&cursor&limit=20` | 条目带对象摘要（标题、摘要、封面、`link.web`）；`available = false` 显示「已失效」占位，仍可取消收藏；按对象类型筛选（标签页：全部 / 文章……，类型名走语言包 `objectType.<type>`，没有词条显示类型 code） |
| 我的足迹 | `/interaction/history` | `GET history/page?cursor`、`DELETE history`（清空）、`DELETE history?objectType&objectId`（删一条） | 按 `lastViewedAt` 日期分组（今天 / 昨天 / 日期）；清空前确认；失效对象占位同上 |

- 点击条目跳 `link.web`：与站点同源时站内跳转（离开控制台到门户），否则新窗口打开。
- 列表首屏前不渲染骨架以外的内容；空状态文案走语言包。

## 5. 与缓存的关系

- 缓存的 HTML 只含计数，不含任何「我的」状态（public-routes §1 决议 3）。
- 收藏不触发页面失效：计数允许在缓存时效内滞后，客户端水合后由 `state` 接口给出准确值。服务端 `ObjectCounterChanged` 不进 site 模块的失效订阅。

## 6. 语言包与错误

命名空间 `interaction`，zh-CN / en-US：按钮文案（收藏 / 已收藏、赞）、计数格式（大于一万显示「1.2万」按 Intl 紧凑格式）、列表与空状态、清空确认、失效占位、错误码词条。

## 7. 服务端缺口

| 编号 | 缺口 | 建议 |
| --- | --- | --- |
| I1 | Web 端足迹依赖详情读取发出的 `ObjectViewed` 带访问者，而服务端渲染没有访问者 | 由 content 的浏览信标补（client-content G1）；interaction 本身不改 |
| I2 | `state` 接口经底座代理匿名调用 | 依赖底座代理的匿名转发（public-routes §9.3）；服务端已是 `@AllowAnonymous`，不改 |
| I3 | 对象摘要 `link.web` 为空时控制台无处可跳 | 不改服务端；前端隐藏跳转，只保留取消收藏 |

## 8. 分期

| 期 | 内容 |
| --- | --- |
| P1 | 收藏按钮、我的收藏、我的足迹 |
| P2 | 点赞按钮；收藏夹（随服务端 P2） |

## 9. 开放项

| 项 | 默认 |
| --- | --- |
| 匿名访客能否看到收藏数 | 能（计数公开，与 App 一致） |
| 足迹是否在门户里有入口 | 只在控制台；页头用户菜单放「我的收藏」「我的足迹」两个链接 |
