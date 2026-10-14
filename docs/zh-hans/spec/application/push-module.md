# module-push 通用推送模块

> 标识：NETON-APP-PUSH
> 日期：2026-10-14 · 状态：Draft
> 仓库：`neton-application-module-push`（服务端）、`neton-application-front-push`（后台页面）

## 1. 边界

**负责**：设备登记、主题订阅、消息下发（按主题 / 用户 / 设备）、多通道适配、送达记录、无效令牌清理。

**不负责**：决定推什么。业务模块（如 content 的「已发布」事件）或运营后台调用本模块的下发端口。

## 2. 数据模型

| 表 | 关键字段 |
| --- | --- |
| `push_devices` | id, device_id（客户端生成，唯一）, user_id?, platform(`android`/`ios`/`harmony`), provider(`fcm`/`apns`/`xiaomi`/`huawei`/…), token, app_version, locale, enabled, last_seen_at |
| `push_subscriptions` | device_id, topic；唯一(device_id, topic) |
| `push_topics` | code, name, description, default_subscribed |
| `push_messages` | id, title, body, link（深链）, image?, target_kind(`topic`/`user`/`device`), target, status(`queued`/`sending`/`done`/`failed`), total, success, failure, created_by, created_at |
| `push_deliveries` | message_id, device_id, provider, status, error, sent_at（只保留近期，定时清理） |

- 用户登录或退出时更新设备的 user_id，同一设备换账号后不会收到上一个账号的推送。
- 通道返回「令牌无效」时自动停用该设备。

## 3. 通道适配

```kotlin
interface PushProvider {
    val code: String
    suspend fun send(batch: List<PushTarget>, payload: PushPayload): List<PushResult>
}
```

第一期实现 **FCM**（HTTP v1，服务账号）；APNs、小米、华为、OPPO、vivo 按需逐个加，业务接口不变。出口代理按通道配置（例如 FCM 走墙外中转）。

## 4. 下发端口（供业务模块调用）

```kotlin
interface PushSender {
    suspend fun sendToTopic(topic: String, payload: PushPayload): Long   // 返回 message id
    suspend fun sendToUsers(userIds: List<Long>, payload: PushPayload): Long
}
```

下发异步执行（neton-jobs 队列），分批调用通道并记录结果。

## 5. 接口

**App（`/app/push/*`）**：`POST device/register`（登记或更新令牌）、`POST subscription`（订阅 / 退订主题）、`GET topic/list`。
**后台（`/admin/push/*`）**：主题管理、手动推送、推送记录与送达统计、设备查询。

权限点：`push:topic:manage`、`push:send`、`push:device:view`。
