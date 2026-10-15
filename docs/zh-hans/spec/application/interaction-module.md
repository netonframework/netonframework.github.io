# module-interaction 通用互动模块

> 标识：NETON-APP-INTERACTION
> 日期：2026-10-15 · 状态：Draft
> 仓库：`neton-application-module-interaction`（服务端）、`neton-application-front-interaction`（后台页面）
> 用户对任意对象的轻量互动：收藏、点赞、关注、浏览足迹。对象用套件统一的 ObjectRef 指代（[套件架构](content-platform-architecture.md) §5）。

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
| `interaction_favorites` | id, user_id, object_type, object_id, folder_id?, note?, created_at | 唯一(user_id, object_type, object_id) |
| `interaction_favorite_folders` | id, user_id, name, sort, is_default, item_count, created_at | 每个用户一个默认收藏夹 |
| `interaction_likes` | user_id, object_type, object_id, created_at | 唯一(user_id, object_type, object_id) |
| `interaction_follows` | id, user_id, object_type, object_id, notify, created_at | 唯一(user_id, object_type, object_id) |
| `interaction_histories` | user_id, object_type, object_id, view_count, first_viewed_at, last_viewed_at | 唯一(user_id, object_type, object_id) |
| `interaction_counters` | object_type, object_id, favorites, likes, follows | 主键(object_type, object_id) |

- 足迹只为登录用户记录；同一对象重复浏览只更新 `last_viewed_at` 和次数。
- 足迹保留期和每人上限可配置（默认 180 天、1000 条），由定时任务清理超出部分。
- 计数在互动写入的同一事务内按差值更新。

## 3. 规则

- 收藏、点赞、关注都是幂等的：重复收藏返回成功、不重复计数；取消不存在的收藏也返回成功。
- 按用户限流（默认每分钟 60 次写操作），防刷计数。
- 对象下线或删除时（收到对象所属模块的事件），互动记录保留，「我的」列表里显示为「已失效」，计数不再对外展示；对象彻底删除时清理对应记录。
- 列表接口批量解析对象摘要；无法解析或当前用户不可见的对象显示为失效占位，而不是让整页报错。

## 4. 事件

| 事件 | 投递方式 | 用途 |
| --- | --- | --- |
| `interaction.counter.changed` | 同步（事务内） | 对象所属模块回写自己的冗余计数（如 content 的 favorite_count） |
| `interaction.favorite.added` / `removed`、`interaction.like.added` / `removed`、`interaction.follow.added` / `removed` | 可重试 | 通知、推荐、统计 |

订阅：
- `content.item.viewed`（及其他模块的「已浏览」事件）→ 写足迹。
- 各模块的对象删除事件 → 清理对应互动记录。

## 5. 接口

**App（`/app/interaction/*`，需账号令牌；计数查询可匿名）**

| 接口 | 说明 |
| --- | --- |
| `POST favorite`、`DELETE favorite` | 收藏 / 取消：objectType, objectId, folderId? |
| `GET favorite/page?folderId&objectType&cursor` | 我的收藏（附对象摘要） |
| `GET/POST/PUT/DELETE favorite/folder…` | 收藏夹管理 |
| `POST like`、`DELETE like` | 点赞 / 取消 |
| `POST follow`、`DELETE follow`、`PUT follow/notify` | 关注 / 取消 / 通知开关 |
| `GET follow/page?objectType&cursor` | 我的关注 |
| `GET history/page?objectType&cursor`、`DELETE history`（全部或指定对象） | 足迹 |
| `POST state` | 批量查询：一组对象的计数和当前用户的收藏 / 点赞 / 关注状态（列表页和详情页用） |

**后台（`/admin/interaction/*`）**：按对象查看计数和最近互动用户、按用户查看互动记录、互动统计（日趋势）、足迹保留配置。

权限点：`interaction:record:view`、`interaction:stats:view`。

## 6. 分期

| 期 | 内容 |
| --- | --- |
| P1 | 收藏（含默认收藏夹）、点赞、足迹、计数、批量状态查询、对象失效处理、后台查询 |
| P2 | 关注与通知开关、多收藏夹、统计报表 |
