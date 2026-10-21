# module-comment 通用评论模块

> 标识：NETON-APP-COMMENT
> 日期：2026-10-15 · 状态：Draft r3（对齐套件架构 r2：可见性矩阵、计数定义、一致性、授权分离、媒体引用、投递保证；2026-10-15 按 P1 实现校准；2026-10-18 补 IP 属地、回复我的未读状态，定下不提供编辑）
> 仓库：`neton-application-module-comment`（服务端）、`neton-application-front-comment`（后台页面）
> 参照：网易新闻的「盖楼」、IT之家的楼层评论与热评榜。评论可以挂在任何对象上：文章、视频、商品、帖子……

## 实现状态（2026-10-15）

| 项 | 状态 |
| --- | --- |
| 评论树、楼层号、盖楼 `stack` / 楼中楼 `thread`、引用链与展开、楼层深度上限 | 已实现 |
| 支持 / 反对（改票、撤销、不能投自己）、热度分（Wilson × 讨论度 × 时间衰减）、热门评论、置顶、精选 | 已实现 |
| 最热排序翻页快照：有 Redis 存 Redis（TTL），否则存 `comment_hot_snapshots` 表，`comment-hot-snapshot-cleanup` 任务清理 | 已实现 |
| 审核模式 `post` / `pre` / `off`（全局配置 + 单对象覆盖） | 已实现（`pre` 原计划 P2） |
| 敏感词（block / review / mask，AC 自动机）、可替换 `CommentContentFilter` | 已实现 |
| 举报（不同用户达到阈值自动送审）、自动折叠（反对 / 支持比例 + 最低票数）、作者删除、管理员隐藏 / 删除 / 恢复 | 已实现（自动折叠原计划 P2） |
| 我的评论、回复我的（被回复）；条目带被回复的评论，回复我的带未读标记、未读数与标记已读（§4.6） | 已实现（未读状态 2026-10-18） |
| 热评榜 `ranking`（简化版：节点内存缓存 5 分钟） | 已实现（原计划 P2） |
| 评论图片（上传业务类型 `comment.image`，经 `POST /app/infra/file/upload` 上传、发评论时 attach，§9.1）、评论导入 `CommentImporter` | 已实现（原计划 P2） |
| IP 属地（服务端按可信客户端地址经 `contract.core.IpRegionResolver` 解析，§3.2）、设备小尾巴；两者都可全局关闭或按对象类型关闭 | 已实现（2026-10-18） |
| 设备小尾巴的字符集与长度校验（原生评论不合规即 `INVALID_DEVICE_TAIL`）、导入评论带设备小尾巴（`ImportedComment.deviceTail`，§3.2 / §6） | 已实现（2026-10-21） |
| 编辑评论 | 不提供（§4.7，有意不做） |
| 对象删除清理评论（订阅 `ObjectUnavailable`，`permanent = true`） | 已实现 |
| 用户装饰 `CommentUserDecorator` 默认实现（经 account 的 `port.AccountProfileReader` 批量取昵称、头像） | 已实现 |
| 事件 `CommentActivity`（created / replied / voted / hidden / removed / deleted / restored）、评论数走通用 `ObjectCounterChanged` | 已实现 |
| @提及（`mentions` 列已建，未解析）、`comment.comment.mentioned` 事件、「@我的」 | 延后 |
| 禁言（§7.5） | 延后 |
| 按对象类型分别配置（P1 是全局配置 + 单对象覆盖审核模式与展示形态；IP 属地与设备小尾巴已能按类型关闭） | 延后 |
| 被删除评论正文保留期后清空、新注册账号冷却期、按 IP 限流、风控事件 | 延后 |
| 外部 / AI 内容安全过滤器、评论统计报表 | 延后（P3） |
| 筛选器数据源 `comment.comment`（字段 targetType / target / origin / createdAt / author / topLevel，排序 hot / popularity / support / latest，[filter-module](filter-module.md) §4.4） | 已实现（2026-10-17；一致性套件真库全绿）。只取 `visible`、对象未锁定且对访问者可见的评论；归一化热度 `p = s / (s + 20)`，`s = 支持数 + 回复总数` |

## 1. 目标与边界

**负责**：评论与回复、盖楼、楼层号、支持 / 反对、热门评论、精选与置顶、跨对象的热评榜、折叠、举报、敏感词、审核、禁言、限流、「我的评论」「回复我的」。

**不负责**：
- 被评论对象本身：通过套件统一的对象解析（`ObjectResolver`，见 [content-platform-architecture.md](content-platform-architecture.md) §4.2）询问对象所在模块；对象的 capabilities 含 `comment` 才可评论。
- 用户资料、等级、勋章：通过装饰端口从 member 等模块读取。
- 通知下发：只发出事件（被回复、被 @、被赞），由通知或推送模块决定是否提醒。

## 2. 两种展示形态，一套数据

| 形态 | 代表 | 样子 |
| --- | --- | --- |
| **盖楼 `stack`** | 网易新闻 | 每条评论（包括回复）都按时间出现在主列表里。回复会把它回复的那条链从最早的祖先开始逐层嵌套引用，看起来像一层层楼叠上去；链太长时折叠中间部分，显示「展开隐藏的 N 层」 |
| **楼中楼 `thread`** | IT之家 | 主列表只放顶层评论；回复收在顶层评论下面，显示「A 回复 B：……」，超过几条就显示「查看全部 N 条回复」 |

两种形态底层是同一棵评论树，区别只在查询和渲染。对象类型可以设默认形态，客户端也可以按页面需要自己选。

```
盖楼（stack）                              楼中楼（thread）
┌──────────────────────────┐              ┌──────────────────────────┐
│ 12楼  王五                 │              │ 3楼  张三：苹果又涨价了       │
│ ┌───────────────────────┐ │              │   ├ 李四 回复 张三：没涨啊    │
│ │ 3楼 张三：苹果又涨价了    │ │              │   └ 王五 回复 李四：看清楚    │
│ │ ┌───────────────────┐ │ │              │   查看全部 5 条回复 >         │
│ │ │ 7楼 李四：没涨啊      │ │ │              └──────────────────────────┘
│ │ └───────────────────┘ │ │
│ └───────────────────────┘ │
│ 看清楚，是 Pro 涨了          │
└──────────────────────────┘
```

## 3. 数据模型

### 3.1 评论对象

`comment_targets`：每个被评论过的对象一行。

| 字段 | 说明 |
| --- | --- |
| id, target_type, target_id | 自增主键；(target_type, target_id) 唯一（如 `content.item` + `1024`） |
| next_floor | 下一个楼层号，发评论时原子自增；楼号不重复、不复用，删除也不回收 |
| total_count / visible_count | 全部 / 可见评论数（visible 是对外展示的评论数） |
| participant_count | 参与人数 |
| last_comment_at | 最近评论时间 |
| state | `open` / `closed`（不再接受新评论，已有评论照常展示） / `locked`（全部隐藏） |
| settings | 本对象的覆盖设置（text JSON：审核模式、展示形态），通常为空，用全局默认值 |

### 3.2 评论

`comment_comments`

| 分组 | 字段 |
| --- | --- |
| 归属 | id, target_type, target_id, user_id?（导入的评论可以没有平台账号）, external_author?（text JSON：名称、头像，导入时使用）, origin(`native`/`imported`), source_ref?（来源记录，如采集记录 ID；(target, source_ref) 部分唯一）, import_batch?（导入批次）, external_identity_id?（导入评论作者的外部站点身份，弱引用 external_site_users.id） |
| 树 | parent_id?（回复的是哪条）, root_id（所在顶层评论）, path（祖先 ID 串 `/1/5/`，从顶层到父级，varchar）, depth, reply_to_user_id? |
| 楼层 | floor：**每条评论都有楼号**（含回复），唯一(target_type, target_id, floor)。盖楼形态下引用链上每一层都显示自己的楼号；楼中楼形态下只在顶层显示 |
| 内容 | content（纯文本，最长可配置）, mentions（text JSON：@ 的用户；P1 未使用）, images（text JSON：fileId 数组，上传业务类型 `comment.image`）, emoji 用文本占位符表示，客户端渲染 |
| 环境 | ip_region（「IP 属地」展示文本，服务端解析，客户端传不进来，见下）, device_tail（设备小尾巴：原生评论是客户端上报的机型，导入评论是来源站点展示的机型；varchar(64)，规则见下，后台可关）, client（app / web / wap）。不存原始 IP |
| 互动 | support_count, against_count, reply_count（直接回复数）, descendant_count（整条链下的回复总数）, report_count |
| 排序 | hot_score（double，§5.2）, hot_eligible（导入评论可配置为不参与热门） |
| 状态 | status：`visible` / `pending`（待审） / `folded`（折叠，§7.4） / `hidden`（管理员隐藏，可恢复） / `removed`（管理员删除） / `deleted`（作者删除）；各状态的可见范围见 §3.4 |
| 标记 | pinned（对象内置顶）, featured（精选 / 神评）, author_badge（作者 / 编辑 / 官方，由解析端口提供） |
| 时间 | created_at, updated_at |

- **IP 属地**：发评论时取框架解析后的可信客户端地址 `HttpRequest.clientAddress`（受 routing 的 `ratelimit.trusted_proxies` 约束，伪造的 `X-Forwarded-For` 改变不了结果），经套件端口 `contract.core.IpRegionResolver`（[content-platform-architecture.md](content-platform-architecture.md) §5.6，infra 默认实现）解析，保存 `IpRegion.display`：中国大陆显示省级，其他国家和地区显示国家 / 地区名，私有地址与库里查不到的显示「未知」。端口缺失、解析器给不出结论（库未配置、地址不合法）或失败时不记录（null），不阻断发评论。导入评论的属地由导入方给出。
- **设备小尾巴**：评论旁的机型 / 客户端名（「iPhone 16 Pro Max」「Xiaomi 15」「HUAWEI Mate 80 Pro 雪域白」）。**只是展示文本**：原生评论来自客户端上报，导入评论来自来源站点，都不可信，不参与鉴权、风控、限流或统计。服务端统一规范化：去掉控制字符与不可见格式字符（Unicode Cf：零宽、双向覆盖等），各种空白合并为一个空格并去首尾；字符集为字母（含中日韩文字）、数字、空格与 `- _ . + ( ) / & ' · # , :`。
  - 原生评论（`POST create` 的 `deviceTail`）：规范化后超过 **32** 个字符或含字符集以外的字符 → `400 INVALID_DEVICE_TAIL`，整条评论不发表（客户端应先按同样规则清洗：丢掉其他字符、截到 32）。为空视为没有。
  - 导入评论（`ImportedComment.deviceTail`）：外部数据不因尾巴拒绝整条评论——丢掉字符集以外的字符，截到 **64** 个字符；什么都不剩视为没有。复查时只补空的，已有的不覆盖。
  - 对象类型关闭了设备小尾巴（下条）时，原生与导入都不记录。
- **开关**：`comment.ip_region.enabled` / `comment.device_tail.enabled` 全局开关，`comment.ip_region.disabled_types` / `comment.device_tail.disabled_types`（逗号分隔的对象类型）按类型关闭。关闭后不再记录，**已存的也不再展示**（接口返回 null）。
- **path 用于盖楼**：查一页评论后，一次批量取出它们所有祖先，在服务端拼好引用链，避免客户端逐条请求。
- **楼层深度上限**（默认 50）：超过上限的回复不再继续嵌套，而是作为新的一层，只引用直接父评论，防止引用链无限变长。
- 删除和隐藏的评论在链中保留占位，楼层结构不塌；占位文案按状态区分（§3.4）。

### 3.3 其他表

| 表 | 用途 |
| --- | --- |
| `comment_votes` | 投票：唯一(comment_id, user_id)，value 1 / -1 |
| `comment_reports` | 举报：唯一(comment_id, user_id)，status、handled_by、result |
| `comment_sensitive_words` | 敏感词：word（唯一）、action(`block`/`review`/`mask`)、status |
| `comment_review_logs` | 审核与处置日志：from_status → to_status、operator_type / operator_id、reason |
| `comment_participants` | 参与人计数：每人在对象下计入评论数的评论条数，归零即不再算参与人 |
| `comment_hot_snapshots` | 最热翻页快照（没有 Redis 时使用），按 expires_at 定时清理 |
| `comment_inbox_states` | 「回复我的」已读位置：每个用户一行 `replies_read_at`（毫秒），未读数按它之后的回复计算（§4.6，V002） |

JSON 字段一律存 `text` 列，不用 jsonb（套件统一约定）。

### 3.4 可见性矩阵

| 状态 | 作者本人 | 其他用户 | 对象拥有者 | 管理员 | 在链中的占位 |
| --- | --- | --- | --- | --- | --- |
| visible | 正文 | 正文 | 正文 | 正文 | — |
| pending | 正文 + 「审核中」 | 不可见 | 不可见 | 正文 | 不出现（审核前不进入他人的链） |
| folded | 正文 + 「已折叠」 | 折叠，点开看正文 | 折叠，点开看正文 | 正文 | 「该评论已被折叠」 |
| hidden | 「该评论已被隐藏」 | 「该评论已被隐藏」 | 同左 | 正文 | 「该评论已被隐藏」 |
| removed | 「该评论因违规已删除」 | 「该评论已删除」 | 同左 | 正文 + 处理记录 | 「该评论已删除」 |
| deleted | 「你已删除该评论」 | 「该评论已删除」 | 同左 | 正文（保留期内） | 「该评论已删除」 |

- 评论所在对象不可见时（对象撤回、删除，或当前用户无权查看对象），该对象下的全部评论对该用户不可见，评论接口返回对象不可用的错误码。
- 被删除评论的正文在保留期后清空，只留结构字段。

### 3.5 计数定义

| 计数 | 包含 | 不包含 |
| --- | --- | --- |
| 对象评论数 `visible_count`（对外展示的「N 评」） | visible、folded 的顶层评论和回复 | pending、hidden、removed、deleted |
| 对象全部评论数 `total_count`（后台） | 全部状态 | — |
| 回复数 `reply_count` / `descendant_count` | 计入对象评论数的那些状态 | 同上 |
| 参与人数 `participant_count` | 有至少一条计入对象评论数的评论的不同用户（导入评论按外部作者计） | — |

计数在评论状态变化的同一事务内更新，并发出通用事件 `contract.core.ObjectCounterChanged`（`object.counter_changed`，counter = `comments`，value 为对象的 visible_count 绝对值；同步投递），对象所在模块据此回写自己的冗余计数。

### 3.6 一致性

- **楼号**：在 `comment_targets` 行上原子自增分配，同一对象内唯一、单调递增；事务回滚造成的空号不复用。
- **投票**：以 (comment_id, user_id) 唯一约束保证一人一票，计数按差值在同一事务内更新。

### 3.7 分页语义

| 排序 | 排序键与游标 | 承诺 |
| --- | --- | --- |
| 最新 / 最早 | `(created_at, id)`，游标为最后一条的键值 | 遍历期间**一直存在且一直对当前用户可见**的评论，恰好返回一次。遍历开始后新发的评论不会插进已经翻过的页：最新排序下客户端重新拉第一页获取（没有单独的增量接口）；最早排序下出现在后面的页里 |
| 最热 | 第一页生成快照（排好序的 ID 列表，默认保留 10 分钟，`comment.hot.snapshot_seconds`；有 Redis 存 Redis，否则存 `comment_hot_snapshots` 表），游标为快照 ID + 位置 | 在快照有效期内按快照顺序翻页，不因热度变化而重复或跳动。快照过期返回专门的错误码，客户端从第一页重新开始 |
| 回复列表 | `(created_at, id)` | 同最新 / 最早 |

- 遍历期间状态变化的评论（被删除、隐藏、送审、折叠）：已经返回过的不撤回；尚未返回的按返回时的状态处理，可能显示为占位，也可能不出现，取决于 §3.4 的可见性。
- 不承诺对「无限实时变化的结果集」绝对不遗漏；需要强一致计数的场景用对象的评论数，不用列表条数推算。

## 4. 盖楼与回复

### 4.1 发评论

`parentId` 为空是顶层评论；不为空是回复。回复任意一层都可以，服务端据此计算 root_id、path、depth。

### 4.2 盖楼的引用链

查询时对每条回复返回 `quoteChain`。链长 ≤ 6 层时完整返回；超过时返回最早 2 层 + 最近 3 层，中间给出隐藏层数，客户端点「展开」再调接口拿完整链。

### 4.3 楼中楼的回复区

每条顶层评论附带最早或最热的前 N 条回复（默认 3）和回复总数；完整回复分页单独查询。

### 4.4 @提及（延后）

内容里 @ 的用户解析成 mentions，发出事件；被 @ 和被回复的用户可以在「回复我的」里看到。P1 的「回复我的」只含被回复。

### 4.5 对象作者标记

对象作者（如文章编辑）发的评论带「作者」标记，由解析端口提供作者 ID 判断。

### 4.6 回复我的（通知列表）

「回复我的」是评论模块自己的站内通知列表：别人对我的评论的**直接回复**，只取平台账号发的（导入评论不算）、计入评论数的状态，所属对象对我不可见的不出现。推送 / 系统通知仍由订阅 `CommentActivity`（`replied`）的模块决定。

- **条目**（`mine` 与 `replies-to-me` 同形）：`{ comment, available, targetTitle, targetAppLink, targetWebLink, parent, unread }`。`comment` 是回复本身（带盖楼引用链）；`parent` 是被回复的那条（「回复我的」里就是我的评论，「我的评论」里是我回复的那条；按当前用户的可见性渲染，不带引用链；顶层评论为 null）；`unread` 只在「回复我的」里有意义。
- **已读位置**：每个用户一个时间点（`comment_inbox_states.replies_read_at`），晚于它的回复是未读。`POST replies-to-me/read`（`readAt` 缺省为现在，不能超过现在）只前进不后退，重复调用幂等；没有逐条已读——通知列表打开即全部已读，与常见社区产品一致。
- **未读数**：`GET replies-to-me/unread-count` → `{ count, readAt }`，`count` 封顶 1000（客户端显示「99+」之类）。为了能廉价地做红点，未读数**不逐条检查对象可见性**，所属对象撤回后的回复可能仍计入，列表里不出现。被删除、隐藏、送审的回复不计入。

### 4.7 不提供编辑

评论发出后不能修改，只能删除重发。理由：盖楼与楼中楼都会把被回复的评论原文引用进别人的楼层，编辑会让引用、支持 / 反对、举报和审核记录对应的不再是同一段文字；先发后审模式下编辑还能绕过审核。参照的网易新闻、IT之家同样不提供编辑。需要「编辑窗口」的产品属于纯产品特殊规则，不进入本模块。

## 5. 支持、反对与热门

### 5.1 投票

- 只有登录用户能投；每人对每条评论只有一票，可以改票（支持 ↔ 反对）或撤销，计数按差值增量更新。
- 不能给自己的评论投票。
- 按用户限流（60 次/分钟），防刷票；按 IP 限流与「同一设备多账号投票计入风控事件」延后。

### 5.2 热度分

`hot_score` 在每次投票、回复后更新：

- 主体用 **Wilson 下限**：按「支持 / (支持 + 反对)」的置信下限排序，票少的评论不会因为一两个赞就排在前面。
- 乘以回复数加权（被讨论得多的更热）和时间衰减（新对象的评论不被老评论压死）。
- 衰减以发表时间为锚、在对数空间相加，只在投票 / 回复时重算，不需要定时刷新。
- 公式常量放在配置里（`comment.hot.z`、`comment.hot.reply_weight`、`comment.hot.decay_hours`）。

### 5.3 热门评论

- 每个对象的评论区第一页顶部单独显示「热门评论」：`support_count ≥ 阈值`（`comment.hot.threshold`，默认 10），按 hot_score 取前 N（`comment.hot.size`）。
- 热门评论同时出现在下面的「最新」列表里，客户端可选择去重。
- **精选 / 神评**：编辑或对象作者手动标记的评论，排在热门之前。
- **置顶**：对象内置顶（如官方说明），排在最前。

### 5.4 热评榜

跨对象的评论排行，对应 IT之家的「热评」频道：

- 按时间窗口（日 / 周 / 月）取支持数最高的评论，每条附带所属对象的标题和链接（解析端口提供）。
- 只取可见、未折叠、所属对象仍公开的评论；同一对象最多取 K 条，避免一篇文章刷屏。
- P1 简化实现：查询时计算，按「窗口 + 对象类型」在本节点内存缓存 5 分钟；只取对匿名访客公开的对象。

## 6. 导入

评论可以从外部批量导入（如 [module-collect](collect-module.md) 采到的评论），用于迁移旧站数据或给内容补充讨论。

```kotlin
// contract.comment，由 comment 实现并 bindIfAbsent；使用方 ctx.getOrNull(CommentImporter::class)
interface CommentImporter {
    /** 按 sourceRef 幂等。replyToSourceRef 指向同批或已导入的另一条评论，用于还原盖楼关系。 */
    suspend fun import(target: ObjectRef, items: List<ImportedComment>, options: CommentImportOptions = CommentImportOptions()): CommentImportResult
}
// ImportedComment(sourceRef, content, authorName?, authorAvatarUrl?, userId?, publishedAt, likes = 0, ipRegion?,
//                 deviceTail?,                                                            // 设备小尾巴（§3.2，可空，向后兼容）
//                 replyToSourceRef?, siteId?, siteUserId?, siteUsername?, siteUserUrl?)   // 后四项：外部站点身份（可空，向后兼容）
// CommentImportOptions(likesAsSupport = true, countTowardsHot = true, batch?)
// CommentImportResult(imported, skipped, failed: List<String>)   // 每条 "<sourceRef>:<错误码>"，错误码见 CommentImportCodes
```

- 失败错误码（`CommentImportCodes`）：`INVALID_SOURCE_REF`、`CONTENT_REQUIRED`、`CONTENT_TOO_LONG`（超过 `comment.content.max_length`）、`AUTHOR_REQUIRED`、`INVALID_PUBLISHED_AT`、`INVALID_REPLY_TO`、`CONTENT_BLOCKED`（敏感词拦截）属于 `REJECTIONS`：评论本身不被接受，原样再导入结果不变，调用方不应自动重试（collect 记为 `Rejected`）；`OBJECT_NOT_FOUND`、`PARENT_NOT_FOUND`、`IMPORT_FAILED` 可能随时间恢复。

- 导入的评论 `origin=imported`：没有平台账号时用 external_author 展示名称和头像；也可以指定平台账号（如迁移旧站用户）。
- 楼层按原始发布时间顺序分配；同一批里先导入被回复的评论，盖楼关系照常还原。
- 原始点赞数可以作为初始支持数（按参数决定），之后的投票正常累加。采集源第二次复查时，若评论正文不变、点赞数变化（`sourceRef` 已存在），对**导入评论**（`origin=imported`、`likesAsSupport=true`）同步 `support_count` 与 `hot_score`（不新建、不动楼号 / 可见数）；平台原生评论的支持数来自真实投票，不被采集覆盖。
- 设备小尾巴：来源站点展示的发帖机型（如 IT之家评论的 `Ta`）由导入方放进 `deviceTail`，按 §3.2 规范化后记录（不合规字符丢弃、截到 64，不拒绝评论）；复查时只给原来没有的补上。
- 外部站点身份（[external-identity-module](external-identity-module.md)）：`ImportedComment` 带齐 `siteId + siteUserId` 且 `ExternalSiteIdentityWriter` 已绑定时，导入先 upsert 一条外部身份，写进 `comment_comments.external_identity_id`（弱引用，不加外键；模块没装时为 null）。未认领前仍按「来自 X 的网友 + 昵称」展示。
- 导入的评论同样过敏感词和审核模式；不发 `CommentActivity` 事件，因此不触发「被回复 / 被 @」通知。
- 后台可以按 origin 和来源筛选，批量隐藏或删除某次导入。
- 导入也会更新对象的评论数，并参与热门评论计算（`countTowardsHot = false` 时不参与）。

## 7. 治理

### 7.1 审核模式

全局配置 `comment.moderation.mode`，单个对象可以在 `comment_targets.settings` 覆盖（按对象类型分别配置延后）：

| 模式 | 行为 |
| --- | --- |
| `post`（先发后审，默认） | 直接可见；命中敏感词或被举报到阈值才送审 |
| `pre`（先审后发） | 全部待审，审核通过才可见 |
| `off` | 不审（只做敏感词拦截） |

### 7.2 敏感词与内容过滤

- 敏感词三种处理：`block` 直接拒绝发布并告知原因、`review` 送审、`mask` 替换成 *** 后发布。
- 过滤器可替换：`CommentContentFilter` 接口，默认实现是敏感词表（AC 自动机，不区分大小写）；可以叠加外部或 AI 内容安全服务（产品先于 comment 绑定即可覆盖，comment 只 `bindIfAbsent`）。

```kotlin
interface CommentContentFilter {
    suspend fun check(content: String, context: CommentFilterContext): CommentFilterResult
}
// CommentFilterContext(targetType, targetId, userId?, imported)
// CommentFilterResult(verdict: PASS / MASK / REVIEW / BLOCK, content?（MASK 后正文）, hits)；多条命中取最严：BLOCK > REVIEW > MASK > PASS
// 实现失败应抛异常（发表失败，而不是放行）
```

### 7.3 举报

举报达到阈值（`comment.report.threshold`，默认 3 个不同用户）自动转待审；管理员处理时可以一并隐藏（一并禁言作者随禁言延后）。

### 7.4 折叠

- 反对数远高于支持数（比例 `comment.fold.ratio` 和最低票数 `comment.fold.min_against` 可配置）的评论自动折叠，显示「该评论已被折叠，点击查看」。
- 管理员也可以手动折叠。折叠不同于隐藏：内容仍可点开查看。

### 7.5 禁言（延后，P1 未实现）

- 按全局、对象类型或单个对象禁言，可设到期时间。
- 被禁言用户发评论时返回明确的错误码和到期时间，客户端据此提示。

### 7.6 删除

- 作者可删除自己的评论（软删，保留占位和楼号）。
- 管理员隐藏；对象彻底删除时（通用事件 `ObjectUnavailable`，`permanent = true`；listenerId `comment.purge-on-target-removed`，可重试），该对象下的全部评论一并清理。

## 8. 限流与防刷

- 发评论：按用户限流（10 次/分钟）；同一用户对同一对象在 `comment.duplicate.window_seconds` 内重复发送相同内容视为重复提交。按 IP 限流、新注册账号冷却期延后。
- 投票（60 次/分钟）、举报（10 次/分钟）、删除（30 次/分钟）：按用户限流。
- 全部经 Neton 路由限流和 Redis 计数实现，阈值在配置里。
- **匿名读取不按 IP 限流**（产品决定 8，[site-module](site-module.md) §13）：`list`、`replies`、`chain`、`get`、`ranking` 是匿名、可缓存的只读接口，网页服务的渲染都来自同一个出口，按 IP 限流等于所有访客一起被限；滥用防护放在边缘（CDN / nginx）。写接口按用户限流（见上）。

## 9. 扩展端口

### 9.1 对象解析与授权

使用套件统一的 `ObjectResolver` 和 `ObjectAccessPolicy`（契约库），不单独定义评论专用的解析器：

- **展示与快速过滤**：对象摘要的 `capabilities` 不含 `comment` 时，客户端不显示评论入口，列表接口直接返回「不支持评论」。
- **授权**：发评论、投票、举报前，必须调用对象拥有模块的 `ObjectAccessPolicy.check(viewer, target, "comment")`；查看评论列表前调用 `check(viewer, target, "view")`。拒绝时原样返回拥有模块给出的原因码。本模块自己的规则（禁言、限流、敏感词）在此之后判断。
- 「原文：xxx」、热评榜和「我的评论」里的标题与链接：取摘要的 `title`、`link`。
- 「作者」标记和回复通知：取摘要的 `ownerUserIds`。
- 评论对象的 `targetType` 就是 ObjectRef 的 `type`（如 `content.item`、`review.review`）。

comment 自己也注册 `comment.comment`（`CommentObjectTypes.COMMENT`）解析器与访问策略，供 interaction（点赞收藏评论）、推送深链和评论图片的委托访问使用。

评论图片：上传业务类型 `comment.image`（`DELEGATED`、jpeg/png/gif/webp、≤10MB、不可复用、托管生命周期，assetDir `comment-image`）。客户端先 `POST /app/infra/file/upload`（multipart：`file` + `businessType=comment.image`）拿到 `fileId`（此时是 temporary，只有上传者能读），再在 `create` 的 `images` 里带上；发评论时在同一事务里 attach 到 `comment.comment:<id>`，任何一张被 infra 拒绝（不是本人上传、类型不对、已被引用……）整条评论失败，错误码即 infra 的 `MediaErrorCode`。张数上限 `comment.images.max`（0 = 不允许图片，`IMAGES_NOT_ALLOWED`；超出 `TOO_MANY_IMAGES`）。展示时按访问者展开成短期签名地址（`images: [{ fileId, url, mimeType }]`），看不到正文的状态（隐藏、删除）不给图片。作者删除、管理员隐藏 / 删除不解除引用（正文与图片都在保留期内供后台查看）；对象彻底删除时 `detachAll`，图片进入孤儿宽限期后由 infra 清理。bootstrap 里按套件约定 `bindIfAbsent` 唯一的 `port.MediaOwnerAccess`，按类型经 `ObjectRegistry.check(…, view)` 路由。

### 9.2 用户装饰

```kotlin
interface CommentUserDecorator {
    suspend fun decorate(userIds: List<Long>): Map<Long, CommentUserView>
}
// CommentUserView(userId, nickname?, avatarUrl?, attributes: Map<String, String>)：等级、勋章、头像挂件……由提供方决定，模块原样透传
```

默认实现经 account 的公开资料端口 `port.AccountProfileReader` 批量读取昵称和头像（端口缺失或失败时只给 userId，导入评论用 external_author）；有等级、勋章体系的产品自行实现并先于 comment 绑定。评论接口批量调用一次，不逐条查。

### 9.3 事件

| 事件 | 类型 | 投递方式 | 用途 |
| --- | --- | --- | --- |
| `object.counter_changed`（counter = `comments`） | `contract.core.ObjectCounterChanged` | 同步（事务内） | 对象所在模块回写评论数 |
| `comment.comment.created`、`comment.comment.replied`、`comment.comment.voted` | `contract.comment.CommentActivity(kind, target, commentId, authorUserId?, replyToUserId?, parentId?, vote?)`，subject 为 `comment.comment:<id>` | 可重试 | 通知、互动统计、搜索 |
| `comment.comment.hidden`、`comment.comment.removed`、`comment.comment.deleted`、`comment.comment.restored` | 同上 | 可重试 | 通知、搜索、缓存 |
| `comment.comment.mentioned` | — | — | 延后（随 @提及） |

不再单独定义 `comment.target.count_changed`。对象所在模块订阅 `ObjectCounterChanged`（counter = `comments`）回写自己的评论数；通知模块订阅 `CommentActivity`。上述事件都在 bootstrap 里登记到 `SerializerDomainEventCodec`。

### 9.4 配置

目标是按对象类型定义；P1 是全局的类型化配置（归 system 的配置体系），单个对象可覆盖审核模式与展示形态。P1 的配置项：`comment.display.mode`、`comment.moderation.mode`、`comment.content.max_length`、`comment.images.max`、`comment.hot.threshold` / `size` / `z` / `reply_weight` / `decay_hours` / `snapshot_seconds`、`comment.fold.ratio` / `min_against`、`comment.depth.max`、`comment.device_tail.enabled` / `disabled_types`、`comment.ip_region.enabled` / `disabled_types`、`comment.duplicate.window_seconds`、`comment.report.threshold`、`comment.thread.preview_replies`。限流阈值写在接口注解上。

## 10. 接口

**App / Web（`/app/comment/*`，读匿名，写需账号令牌）**

| 接口 | 说明 |
| --- | --- |
| `GET list?targetType&targetId&mode=stack\|thread&order=latest\|earliest\|hot&cursor` | 评论列表。第一页额外返回置顶、精选、热门评论和对象的评论数、状态 |
| `GET replies?rootId&order&cursor` | 楼中楼：某条顶层评论的全部回复 |
| `GET chain/{id}` | 盖楼：某条评论的完整引用链（展开折叠层） |
| `GET get/{id}` | 单条评论（分享、跳转定位用） |
| `POST create` | 发评论或回复：`{ targetType, targetId, parentId?, content, images?: [fileId], client?: app\|web\|wap, deviceTail?: 机型（≤32 字，字符集见 §3.2，不合规 `INVALID_DEVICE_TAIL`） }`；返回新评论（`ipRegion` 由服务端填） |
| `POST vote` | 支持 / 反对 / 撤销：commentId, value(1 / -1 / 0) |
| `POST report` | 举报 |
| `DELETE delete/{id}` | 删除自己的评论 |
| `GET mine?cursor` | 我的评论（带对象标题和链接） |
| `GET replies-to-me?cursor` | 回复我的（@我的延后）：条目带 `parent`、`unread`（§4.6） |
| `GET replies-to-me/unread-count` | 未读数 `{ count, readAt }` |
| `POST replies-to-me/read` | 标记已读 `{ readAt? }`（缺省为现在），返回 `{ count, readAt }` |
| `GET ranking?period=day\|week\|month&targetType?` | 热评榜 |

**后台（`/admin/comment/*`）**：

| 接口 | 权限点 |
| --- | --- |
| `GET comment/page`（按对象 / 用户 / 状态 / 关键词 / 来源）、`GET comment/get/{id}` | `comment:comment:query` |
| `PUT comment/update-status/{id}`、`PUT comment/update-status-by-batch`（隐藏、删除、恢复、折叠） | `comment:comment:update` |
| `PUT comment/pin/{id}` | `comment:comment:pin` |
| `PUT comment/feature/{id}` | `comment:comment:feature` |
| `GET review/page` | `comment:review:query` |
| `PUT review/handle/{id}`（通过、隐藏、折叠） | `comment:review:handle` |
| `GET report/page` | `comment:report:query` |
| `PUT report/handle/{id}` | `comment:report:handle` |
| `GET sensitive-word/page`、`GET sensitive-word/get/{id}` | `comment:sensitive-word:query` |
| `POST sensitive-word/create` / `PUT sensitive-word/update` / `DELETE sensitive-word/delete/{id}` | `comment:sensitive-word:create` / `update` / `delete` |
| `GET target/page` | `comment:target:query` |
| `PUT target/update`（关闭、锁定、覆盖设置） | `comment:target:update` |
| `GET review-log/page` | `comment:review-log:query` |

禁言、统计延后。

## 11. 权限点

命名 `comment:<resource>:<action>`，资源段与后台路由段一致（含连字符，如 `sensitive-word`、`review-log`）：

`comment:comment:query` / `update` / `pin` / `feature`、`comment:review:query` / `handle`、`comment:report:query` / `handle`、`comment:sensitive-word:query` / `create` / `update` / `delete`、`comment:target:query` / `update`、`comment:review-log:query`。

全部写在 V001 菜单种子里（六个页面 type=2 用 query，其余为按钮 type=3），默认授予 `super_admin`。禁言权限点随禁言延后。

## 12. 后台前端（neton-application-front-comment）

评论列表（可切换盖楼 / 楼中楼预览）、待审队列、举报、敏感词、评论对象、审核日志。禁言、热评榜页面延后。沿用 front 的 i18n、权限、资源页规范。

## 13. 分期

| 期 | 内容 |
| --- | --- |
| P1（已实现） | 评论树与楼层、两种展示形态、支持 / 反对、热度分与热门评论、置顶精选、敏感词、三种审核模式、举报、自动折叠、删除、限流、我的评论、回复我的（含未读状态）、热评榜（简化）、图片评论、IP 属地与设备小尾巴、评论导入、解析与装饰端口、后台基础页面 |
| P2 | 禁言、@提及与「@我的」、按对象类型配置、热评榜定时计算与后台页面 |
| P3 | 外部 / AI 内容安全过滤器、风控事件、评论统计报表 |

itwind 第一期用 P1，热评榜随 P2 跟上（IT之家的「热评」频道）。
