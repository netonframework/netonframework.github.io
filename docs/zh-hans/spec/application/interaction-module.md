# module-interaction 通用互动模块

> 标识：NETON-APP-INTERACTION
> 日期：2026-10-22 · 状态：Draft（2026-10-15 按 P1 实现校准；2026-10-22 itwind C4：列表封面地址、「我的」概览、真库契约测试）
> 仓库：`neton-application-module-interaction`（服务端）、`neton-application-front-interaction`（后台页面）
> 用户对任意对象的轻量互动：收藏、点赞、关注、浏览足迹。对象用套件统一的 ObjectRef 指代（[套件架构](content-platform-architecture.md) §5）。

## 实现状态（2026-10-15）

| 项 | 状态 |
| --- | --- |
| 收藏 / 取消、点赞 / 取消（幂等，按用户限流 60 次/分钟） | 已实现 |
| 我的收藏、我的足迹（游标分页，失效对象占位） | 已实现 |
| 足迹：订阅通用 `ObjectViewed` 写入；保留期 / 每人上限由 `interaction-history-trim` 任务（每小时）清理 | 已实现 |
| 计数表 + 通用 `ObjectCounterChanged`（同事务、绝对值） | 已实现 |
| 批量状态查询 `POST state`（匿名只返回计数） | 已实现 |
| 「我的收藏 / 足迹」条目的封面地址 `coverUrl`（一页一次批量展开，按访问者可读性；宽度档 w360） | 已实现（2026-10-22） |
| 「我的」概览 `GET mine/summary`（收藏、足迹按对象类型计数） | 已实现（2026-10-22） |
| 真库契约测试 `postgresContractTest`（收藏幂等与计数、state 匿名 / 登录、游标分页与失效占位、封面、概览、足迹写入与清理） | 已实现（2026-10-22） |
| 对象失效：订阅 `ObjectUnavailable`，`permanent = true` 时清理互动记录；暂时下线只在列表显示失效 | 已实现 |
| 事件 `InteractionRecorded`（`interaction.favorite/like.added/removed`） | 已实现 |
| 后台：互动记录查询、对象计数查询、日趋势统计 | 已实现 |
| 关注 follow 与通知开关（`interaction_follows` 表、`follow` 接口） | 延后（P2；计数表已预留 `follows` 列，事件 kind 已预留 `follow`） |
| 收藏夹 `interaction_favorite_folders`（含默认收藏夹）；`interaction_favorites.folder_id` 已建列但未使用 | 延后（P2） |
| 后台足迹保留配置页 | 延后（保留期走系统配置 `interaction.history.retention_days` / `interaction.history.max_per_user`） |

## 1. 边界

**负责**：收藏（含收藏夹）、点赞、关注、足迹，以及它们的计数和「我的」列表。

**不负责**：
- 对象本身：标题、链接、可见性由对象所属模块的 `ObjectResolver` / `ObjectAccessPolicy` 提供。
- 评论的支持 / 反对：属于评论模块。支持 / 反对带「反对」语义，计入热度公式，与点赞不同。
- 通知下发：只发事件。

四种互动**共享对象引用和授权接入方式，但各有各的表和规则**：

| 互动 | 语义 | 生命周期 | 能力声明 |
| --- | --- | --- | --- |
| 收藏 favorite | 用户想留着以后再看 | 持久，用户主动取消；可放进收藏夹 | `favorite` |
| 点赞 like | 一次轻量表态 | 可撤销；以计数为主 | `like` |
| 关注 follow | 订阅对象后续动态（关注车系、作者、话题） | 持久；可选择是否接收通知 | `follow` |
| 足迹 history | 浏览记录 | 自动产生；有保留期，用户可清空 | `history` |

对象摘要的 `capabilities` 不含对应能力时，该互动不可用；用户操作前一律调用 `ObjectAccessPolicy.check(viewer, ref, action)`，action 为 `favorite` / `like` / `follow` / `view`。

## 2. 数据模型

| 表 | 关键字段 | 约束 |
| --- | --- | --- |
| `interaction_favorites` | id, user_id, object_type, object_id, folder_id?（P2 用）, note?, created_at | 唯一(user_id, object_type, object_id) |
| `interaction_favorite_folders`（P2，未建表） | id, user_id, name, sort, is_default, item_count, created_at | 每个用户一个默认收藏夹 |
| `interaction_likes` | id, user_id, object_type, object_id, created_at | 唯一(user_id, object_type, object_id) |
| `interaction_follows`（P2，未建表） | id, user_id, object_type, object_id, notify, created_at | 唯一(user_id, object_type, object_id) |
| `interaction_histories` | id, user_id, object_type, object_id, view_count, first_viewed_at, last_viewed_at | 唯一(user_id, object_type, object_id) |
| `interaction_counters` | id, object_type, object_id, favorites, likes, follows, updated_at | 唯一(object_type, object_id) |

- 足迹只为登录用户记录；同一对象重复浏览只更新 `last_viewed_at` 和次数。
- 足迹保留期和每人上限可配置（`interaction.history.retention_days` 默认 180 天、`interaction.history.max_per_user` 默认 1000 条），由定时任务 `interaction-history-trim`（每小时，单节点）清理超出部分。
- 计数在互动写入的同一事务内按差值更新，并发布变化后的绝对值。

## 3. 规则

- 收藏、点赞、关注都是幂等的：重复收藏返回成功、不重复计数；取消不存在的收藏也返回成功。
- 按用户限流（默认每分钟 60 次写操作），防刷计数；超限 429，信封 `message = INTERACTION_RATE_LIMITED`（数字 code 10300）。
- 对象下线或删除时（收到对象所属模块的事件），互动记录保留，「我的」列表里显示为「已失效」，计数不再对外展示；对象彻底删除时清理对应记录。
- 列表接口批量解析对象摘要（`ObjectRegistry.describe`）；无法解析或当前用户不可见的对象返回 `available = false` 的失效占位（标题、摘要、封面、链接置空），而不是让整页报错。
- 对象引用不合法时返回 `INVALID_OBJECT_REF`；能力或授权不满足时按 `AccessDecision` 映射成 HTTP 错误。

## 4. 事件

| 事件 | 类型 | 投递方式 | 用途 |
| --- | --- | --- | --- |
| `object.counter_changed` | `contract.core.ObjectCounterChanged`（counter = `favorites` / `likes`，value 为绝对值） | 同步（事务内） | 对象所属模块回写自己的冗余计数（如 content 的 favorite_count） |
| `interaction.favorite.added` / `removed`、`interaction.like.added` / `removed`（P2：`interaction.follow.*`） | `contract.interaction.InteractionRecorded(kind, added, userId)`，type 由 kind + added 拼出 | 可重试 | 通知、推荐、统计 |

不再单独定义 `interaction.counter.changed`，统一用套件通用的 `ObjectCounterChanged`。

订阅（均为 `RETRYABLE`，幂等）：
- 通用 `ObjectViewed`（`object.viewed`，任何拥有对象的模块在详情读取时发布）→ 写足迹，listenerId `interaction.history-on-viewed`。不存在 `content.item.viewed` 这类模块专属浏览事件。
- 通用 `ObjectUnavailable`（`object.unavailable`）→ `permanent = true` 时清理对应互动记录，listenerId `interaction.purge-on-removed`。

`ObjectViewed` / `ObjectUnavailable` / `ObjectAvailable` / `ObjectCounterChanged` / `InteractionRecorded` 都在 bootstrap 里登记到 `SerializerDomainEventCodec`。

## 5. 接口

**App（`/app/interaction/*`，需账号令牌；计数查询可匿名）**

| 接口 | 说明 |
| --- | --- |
| `POST favorite`（body：objectType, objectId）、`DELETE favorite?objectType&objectId` | 收藏 / 取消 |
| `GET favorite/page?objectType&cursor&limit` | 我的收藏（附对象摘要；`coverUrl` 是封面的列表缩略图地址，媒体服务没装或不可读时为空） |
| `GET/POST/PUT/DELETE favorite/folder…` | 收藏夹管理（P2，未实现） |
| `POST like`（body）、`DELETE like?objectType&objectId` | 点赞 / 取消 |
| `POST follow`、`DELETE follow`、`PUT follow/notify` | 关注 / 取消 / 通知开关（P2，未实现） |
| `GET follow/page?objectType&cursor` | 我的关注（P2，未实现） |
| `GET history/page?objectType&cursor&limit`、`DELETE history`（不带参数清空；带 objectType + objectId 删一条） | 足迹 |
| `GET mine/summary` | 「我的」概览：`{ favorites: [{ objectType, count }], histories: [...] }`，条数多的类型在前（网页控制台首页与列表的类型标签页） |
| `POST state`（`@AllowAnonymous`，body：objects[]） | 批量查询：一组对象的计数和当前用户的收藏 / 点赞状态；匿名只返回计数 |

**后台（`/admin/interaction/*`）**：

| 接口 | 权限点 |
| --- | --- |
| `GET record/page?kind&userId&objectType&objectId`（kind = favorite / like / history，缺省 favorite） | `interaction:record:query` |
| `GET counter/page?objectType&objectId&sort` | `interaction:counter:query` |
| `GET stats/trend?days`（默认 30 天） | `interaction:stats:query` |

权限点命名 `interaction:<resource>:<action>`，资源段与路由段一致；三个都是 V001 菜单种子里的页面（type=2），默认授予 `super_admin`。

## 6. 分期

| 期 | 内容 |
| --- | --- |
| P1（已实现） | 收藏、点赞、足迹、计数、批量状态查询、对象失效处理、后台查询与日趋势 |
| P2 | 关注与通知开关、收藏夹（含默认收藏夹）、统计报表 |
