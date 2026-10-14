# module-comment 通用评论模块

> 标识：NETON-APP-COMMENT
> 日期：2026-10-14 · 状态：Draft
> 仓库：`neton-application-module-comment`（服务端）、`neton-application-front-comment`（后台页面）
> 评论可以挂在任何对象上：文章、商品、视频、帖子……只要该对象所在的模块注册一个解析器。

## 1. 边界

**负责**：评论与回复、楼层、支持 / 反对、举报、敏感词、审核、限流、评论计数事件、「我的评论」。

**不负责**：被评论对象本身。comment 不知道文章或商品长什么样，通过 §4 的解析端口询问对象所在模块。

## 2. 数据模型

| 表 | 关键字段 |
| --- | --- |
| `comment_comments` | id, target_type, target_id, user_id, root_id?, parent_id?, reply_to_user_id?, floor, content, images(jsonb), ip_region, device_tail, support_count, against_count, reply_count, status(`visible`/`pending`/`hidden`/`deleted`), created_at |
| `comment_floors` | target_type, target_id, next_floor；发评论时原子取号，楼号不重复、不复用 |
| `comment_votes` | comment_id, user_id, value(+1/-1)；唯一(comment_id, user_id)，改票只改值 |
| `comment_reports` | comment_id, reporter_id, reason, status, created_at |
| `comment_sensitive_words` | word, level(`block`/`review`), enabled |
| `comment_review_logs` | comment_id, action, operator_id, reason, created_at |

- **楼层**只给顶层评论编号；回复挂在顶层评论下（两级结构：root + 回复，回复里用 reply_to_user_id 指明对谁说）。
- **IP 属地**由服务端按请求的客户端地址解析（复用 geolite），客户端传不进来。
- **设备小尾巴**来自客户端上报的机型，限长、过滤后保存，可在后台全局关闭。

## 3. 规则

- 发评论需要登录；按用户和 IP 限流；同一用户对同一对象短时间内重复发相同内容视为重复提交。
- 敏感词：`block` 级直接拒绝，`review` 级进入待审（`pending`，只有作者自己可见）。被举报达到阈值自动转待审。
- 删除：作者可删自己的评论（软删，楼层保留，显示「该评论已删除」）；管理员可隐藏。
- 支持 / 反对：同一用户对同一评论只有一票，可以改票或撤销；计数增量更新。

## 4. 解析端口（被评论对象所在模块实现）

```kotlin
interface CommentTargetResolver {
    val targetType: String                       // 如 "content.item"
    suspend fun resolve(targetId: String): CommentTarget?   // 不存在或不可评论返回 null
}

data class CommentTarget(
    val allowComment: Boolean,
    val title: String,          // 「我的评论」和后台列表里展示「原文：xxx」
    val link: String,           // App 深链或 Web 地址
    val ownerUserId: Long?,     // 对象作者，用于回复通知
)
```

- 每个对象类型一个解析器，模块初始化时注册到 `CommentTargetRegistry`；未注册的类型一律拒绝。
- 评论数变化时发出 `CommentCountChanged(targetType, targetId, visibleCount)`，对象所在模块自行回写计数。

## 5. 接口

**App（`/app/comment/*`）**

| 接口 | 说明 |
| --- | --- |
| `GET page?targetType&targetId&order=latest\|earliest\|hot&cursor` | 顶层评论，每条带前 N 条回复和回复总数 |
| `GET replies?rootId&cursor` | 某条评论的全部回复 |
| `POST create` | 发评论或回复（需登录） |
| `POST vote` | 支持 / 反对 / 撤销 |
| `POST report` | 举报 |
| `DELETE delete/{id}` | 删除自己的评论 |
| `GET mine?cursor` | 我的评论（带对象标题和链接） |

**后台（`/admin/comment/*`）**：按对象 / 用户 / 状态查询；待审队列（通过、隐藏）；举报处理；敏感词管理；审核日志。

权限点：`comment:review`、`comment:report:handle`、`comment:sensitive:manage`。

## 6. 后台前端（neton-application-front-comment）

评论列表、待审队列、举报、敏感词。沿用 front 的 i18n、权限、资源页规范。
