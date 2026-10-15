# module-push 通用推送模块

> 标识：NETON-APP-PUSH
> 日期：2026-10-14 · 状态：Draft（2026-10-15 按 P1 实现校准）
> 仓库：`neton-application-module-push`（服务端）、`neton-application-front-push`（后台页面）

## 实现状态（2026-10-15）

| 项 | 状态 |
| --- | --- |
| 设备登记（登录 / 匿名登记覆盖 user_id）、令牌转移停用旧设备（`TOKEN_MOVED`）、首次登记自动订阅默认主题 | 已实现 |
| 主题订阅 / 退订、主题列表（带当前设备订阅状态） | 已实现 |
| 下发端口 `PushSender`（主题 / 用户 / 设备，可带 actor） | 已实现 |
| 异步分批下发（`push-dispatch` 任务）、退避重试、令牌无效自动停用、送达记录清理（`push-delivery-cleanup`） | 已实现 |
| 通道：`log`（记录型，缺省仅 dev 开启）、FCM HTTP v1（服务账号 + 可选出口代理） | 已实现 |
| 通道登记表 `PushProviderRegistry`（产品可登记自有通道） | 已实现 |
| 后台：主题 CRUD、手动推送、推送记录与送达明细、设备查询与停用 | 已实现 |
| APNs、小米、华为、OPPO、vivo 等厂商通道 | 延后（按需逐个加，业务接口不变） |
| 送达统计报表（按日趋势） | 延后（P1 只有消息级 total / success / failure） |

## 1. 边界

**负责**：设备登记、主题订阅、消息下发（按主题 / 用户 / 设备）、多通道适配、送达记录、无效令牌清理。

**不负责**：决定推什么。业务模块（如 content 的「已发布」事件）或运营后台调用本模块的下发端口。

## 2. 数据模型

| 表 | 关键字段 |
| --- | --- |
| `push_devices` | id, device_id（客户端生成，唯一）, user_id?, platform(`android`/`ios`/`harmony`), provider（通道编码，须已登记，如 `fcm`/`log`）, token, app_version, locale, enabled, disabled_reason, last_seen_at, created_at, updated_at |
| `push_subscriptions` | id, device_id, topic, created_at；唯一(device_id, topic) |
| `push_topics` | id, code（唯一）, name, description, default_subscribed, status, sort |
| `push_messages` | id, title, body, link（深链）, image?, data（text JSON）, target_kind(`topic`/`user`/`device`), target（text）, status(`queued`/`sending`/`done`/`failed`), total, success, failure, expanded, expand_cursor, created_by, source, finished_at, created_at |
| `push_deliveries` | message_id, device_id, provider, status（`pending` → 终态）, error, attempts, next_attempt_at, locked_until, sent_at；唯一(message_id, device_id)（只保留近期，定时清理） |

- 用户登录或退出时客户端重新登记：登录态登记绑定当前用户，匿名登记解除绑定，同一设备换账号后不会收到上一个账号的推送。
- 同一通道令牌出现在另一台设备上时，旧设备以 `TOKEN_MOVED` 停用。
- 通道返回「令牌无效」时自动停用该设备。
- 种子主题：`headline`（头条，默认订阅）。
- JSON 字段（`data`）存 `text` 列，不用 jsonb（套件统一约定）。

## 3. 通道适配

```kotlin
interface PushProvider {
    val code: String                 // 与设备登记的 provider 一致，如 fcm、apns、log
    val maxBatchSize: Int get() = 100
    suspend fun send(batch: List<PushTarget>, payload: PushPayload): List<PushResult>
}

class PushProviderRegistry { fun register(provider: PushProvider); fun get(code: String): PushProvider?; fun codes(): Set<String> }
```

- `PushTarget(deviceId, token, platform, locale?)`；`PushResult(deviceId, outcome, error?, retryAfterMillis?)`，`outcome` 为 `SENT` / `INVALID_TOKEN`（停用设备）/ `TRANSIENT`（退避重试）/ `PERMANENT`（不重试）。
- 每个目标都必须返回一个结果；整批无法发送时返回全部 `TRANSIENT` 或抛异常。实现方不得记录令牌或密钥原文。
- 本模块在 bootstrap 里登记内置通道（`log`、已配置的 `fcm`）；登记表用 `bindIfAbsent`，产品可预先绑定或之后登记自己的通道，同编码后登记者覆盖。
- 第一期实现 **FCM**（HTTP v1，服务账号私钥签 RS256 JWT 换 OAuth2 令牌）；APNs、小米、华为、OPPO、vivo 按需逐个加，业务接口不变。出口代理按通道配置（`config/push.conf` 的 `[fcm] https_proxy`，例如 FCM 走墙外中转）。FCM 未配置时 fcm 设备的送达记为 `PROVIDER_NOT_CONFIGURED`。

## 4. 下发端口（供业务模块调用）

```kotlin
interface PushSender {
    suspend fun sendToTopic(topic: String, payload: PushPayload, actor: Actor? = null): Long   // 返回 message id
    suspend fun sendToUsers(userIds: List<Long>, payload: PushPayload, actor: Actor? = null): Long
    suspend fun sendToDevices(deviceIds: List<String>, payload: PushPayload, actor: Actor? = null): Long
}

data class PushPayload(val title: String, val body: String, val link: String? = null, val image: String? = null, val data: Map<String, String> = emptyMap())
```

- 只把消息写入下发队列并返回消息 ID；在调用方的 `db.transaction { … }` 里调用时随业务写入一起提交或回滚（满足「提交前不向外部发送」）。
- 载荷校验 `PushPayloadRules`：标题 ≤128、正文 ≤1024、链接只允许 http(s) 或 App 深链（拒绝 `javascript`/`data`/`file`/`vbscript`/`about`/`blob`/`content`/`intent`；配置 `push.link.app_schemes` 时深链 scheme 必须在其中）、图片只允许 http(s)、data ≤20 项且不能占用保留键（`link`、`push_message_id`、`from`、`notification`、`google.*`、`gcm.*` 等）、总量 ≤3600 字节。不合法抛 `BadRequestException`，机器码 `PUSH_TITLE_REQUIRED` / `PUSH_TITLE_TOO_LONG` / `PUSH_BODY_REQUIRED` / `PUSH_BODY_TOO_LONG` / `PUSH_INVALID_LINK` / `PUSH_INVALID_IMAGE` / `PUSH_INVALID_DATA` / `PUSH_PAYLOAD_TOO_LARGE`。
- 下发由本模块的 `push-dispatch` 任务（3 秒一次，单节点）异步执行：分段展开目标设备 → 认领到期送达记录（`SKIP LOCKED` + 租约）→ 按「消息 × 通道」分批调用 → 逐条记录结果。临时失败按 `base × 2^(n-1)` 退避（封顶 1 小时，兼顾 Retry-After），超过最大次数记为失败。`push-delivery-cleanup` 按保留期清理送达记录。
- 配置项：`push.dispatch.batch_size`、`push.dispatch.max_attempts`、`push.dispatch.retry_base_seconds`、`push.delivery.retention_days`、`push.link.app_schemes`。

## 5. 事件

| 事件 | 主体 | 说明 |
| --- | --- | --- |
| `push.message.queued`（`PushMessageQueued`） | `push.message` | 一条推送进入下发队列，带 targetKind |
| `push.message.sent`（`PushMessageSent`） | `push.message` | 所有目标都有终态，status 为 `done` / `failed`，带 total / success / failure |
| `push.device.disabled`（`PushDeviceDisabled`） | `push.device` | 令牌无效、令牌转移或后台停用，带 reason |

事件都实现 `SuiteEvent`，在本模块事务内发布，并在 `SerializerDomainEventCodec` 登记以支持可重试订阅。

## 6. 接口

**App（`/app/push/*`，均可匿名，按 IP 限流）**：

| 接口 | 说明 |
| --- | --- |
| `POST device/register` | 登记或更新令牌；登录时绑定当前用户，匿名时解除绑定 |
| `POST subscription` | 订阅 / 退订主题：deviceId, topic, subscribed（`false` 为退订） |
| `GET topic/list?deviceId` | 启用的主题列表；带 deviceId 时附该设备的订阅状态 |

**后台（`/admin/push/*`）**：

| 接口 | 权限点 |
| --- | --- |
| `GET topic/page`、`GET topic/get/{id}` | `push:topic:query` |
| `POST topic/create` | `push:topic:create` |
| `PUT topic/update`、`PUT topic/update-status/{id}` | `push:topic:update` |
| `DELETE topic/delete/{id}` | `push:topic:delete` |
| `POST message/send`（手动推送，按用户限流） | `push:message:send` |
| `GET message/page`、`GET message/get/{id}`、`GET message/delivery-page/{id}` | `push:message:query` |
| `GET device/page`、`GET device/get/{id}` | `push:device:query` |
| `PUT device/update-status/{id}` | `push:device:update` |

权限点命名 `push:<resource>:<action>`，资源段与路由段一致；全部写在 V001 菜单种子里（页面 type=2 用 query / send，其余为按钮 type=3），默认授予 `super_admin`。
