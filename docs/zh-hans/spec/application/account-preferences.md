# module-account 账号偏好

> 标识：NETON-APP-ACCOUNT-PREFERENCES
> 日期：2026-10-18 · 状态：Draft（已在本地实现，未部署）
> 仓库：`neton-application-module-account`
> 给 App 存「跟着账号走」的小块客户端设置（频道排序、首页 tab、阅读主题等），换设备、重装后还在。通用套件能力，不含任何产品专属分支。

## 1. 实现状态（2026-10-18）

| 项 | 状态 |
| --- | --- |
| `account_preferences` 表（迁移 `V002__account_preferences.sql`） | 已实现 |
| 读、列、写（乐观并发）、删 | 已实现 |
| 值大小、命名空间数量、命名空间格式限额 | 已实现，默认值见 §3 |
| 写接口按用户限流 60 次 / 60 秒 | 已实现 |
| 自助注销时清理 | 已实现（`AccountAuthLogic.deleteOwnAccount`） |
| 真实数据库契约（`AccountPreferenceDbTest`，`postgresContractTest`） | 已实现：版本冲突、用户隔离、并发同版本覆盖只成功一个、并发创建不越过数量上限 |
| 后台查看 / 运营修改 | 不做（偏好是用户私有数据） |

## 2. 模型

一条偏好 = 用户 + 命名空间 → 一份 JSON 文档 + 版本号。

| 字段 | 说明 |
| --- | --- |
| `user_id` | 会话身份，只能读写自己的 |
| `namespace` | `^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)*$`，1–64 字符。约定 `<app 或模块>.<用途>`，如 `app.channels`、`itwind.feed_tabs` |
| `value` | 任意非 null JSON（对象、数组、标量），按紧凑编码存 `text`。服务端不解读内容、不按字段查询，所以不用 `jsonb` |
| `version` | 不存在 = 0；创建 = 1；之后每次写入 +1 |
| `created_at` / `updated_at` | 毫秒时间戳；`updated_at` 单调不回退 |

主键 `(user_id, namespace)`。服务端不认识任何具体命名空间，也不做跨命名空间合并；结构演进由客户端在值里带自己的 schema 字段处理。

## 3. 限额

| 限额 | 默认 | 超出时 |
| --- | --- | --- |
| 命名空间长度 | 64 字符 | 400 `INVALID_PREFERENCE_NAMESPACE` |
| 单个值大小（紧凑 JSON 的 UTF-8 字节数） | 16 KB（16384） | 400 `PREFERENCE_VALUE_TOO_LARGE`（code 10106） |
| 每用户命名空间数 | 64 | 400 `PREFERENCE_NAMESPACE_LIMIT_EXCEEDED`（code 10103）；已存在的命名空间仍可更新 |
| 写入频率（PUT + DELETE） | 60 次 / 60 秒 / 用户 | 429（路由限流） |

产品装配层可在 account bootstrap 之前 `ctx.bind(AccountPreferenceLogic.Limits::class, …)` 覆盖前三项；命名空间长度上限不能超过列宽 64。读接口不单独限流。

数量上限的计数与插入是原子的：同一用户的「新建命名空间」在事务级咨询锁（`pg_advisory_xact_lock(hashtextextended('account_preferences:<uid>', 0))`）下串行，更新不加锁。

## 4. 接口（App 组，需登录）

响应统一走信封 `{ "code": 0, "message": "OK", "data": … }`；错误时 `code` 为数字错误码，`message` 为下表的机器码。

### 4.1 读取

`GET /app/account/preferences/{namespace}`

```json
{ "namespace": "app.channels", "value": { "order": ["tech", "news"] }, "version": 3, "updatedAt": 1760760000000 }
```

不存在不是 404，而是 `{ "namespace": "app.channels", "value": null, "version": 0, "updatedAt": null }`，客户端拿 `version = 0` 直接创建。

### 4.2 列出

`GET /app/account/preferences`

```json
{ "items": [ { "namespace": "app.channels", "version": 3, "sizeBytes": 31, "updatedAt": 1760760000000 } ] }
```

按命名空间排序，不含值。

### 4.3 写入（乐观并发）

`PUT /app/account/preferences/{namespace}`，`Content-Type: application/json`

```json
{ "value": { "order": ["news", "tech"] }, "version": 3 }
```

- `version` 是客户端读到的版本。缺省或 `0` = 只创建，已存在则冲突；`N > 0` = 仅当当前版本恰为 `N` 时覆盖，不存在也算冲突。
- 成功返回与 §4.1 相同结构，`version` 为新版本（创建为 1）。
- 没有「无条件覆盖」：两台设备同时改时，后写的一方必须先看到前者的结果，不会静默丢失修改。

冲突处理：409，`code = 10205`，`message = "PREFERENCE_VERSION_CONFLICT"`。客户端重新 GET，把本地改动合并到最新值上，带新版本重试。

### 4.4 删除

`DELETE /app/account/preferences/{namespace}[?version=N]`

- 不带 `version`：无条件删除，不存在也成功（幂等）。
- 带 `version`：只删该版本；不存在或版本不符 → 409 `PREFERENCE_VERSION_CONFLICT`。
- 删除后再创建，版本从 1 重新开始。

### 4.5 错误码

| HTTP | code | message | 场景 |
| --- | --- | --- | --- |
| 400 | 10100 | `INVALID_PREFERENCE_NAMESPACE` | 命名空间格式或长度不合法 |
| 400 | 10100 | `PREFERENCE_VALUE_REQUIRED` | `value` 缺失或为 JSON null（删除请用 DELETE） |
| 400 | 10100 | `INVALID_PREFERENCE_VERSION` | PUT 的 `version < 0`；DELETE 的 `version <= 0` |
| 400 | 10106 | `PREFERENCE_VALUE_TOO_LARGE` | 值超过大小上限 |
| 400 | 10103 | `PREFERENCE_NAMESPACE_LIMIT_EXCEEDED` | 新建时已达命名空间数量上限 |
| 409 | 10205 | `PREFERENCE_VERSION_CONFLICT` | 版本对不上（含「只创建」碰上已存在） |
| 429 | 10300 | 限流文案 | 写入过于频繁 |
| 500 | 7 | `PREFERENCE_CORRUPT` | 库内值不是合法 JSON（绕过接口写坏），记 `account.preferences.corrupt` |

## 5. 客户端约定

- 启动或登录后 GET 所需命名空间并缓存 `version`；本地修改后防抖（建议 ≥ 1 秒）再 PUT，避免拖拽排序时每一步都写。
- 409 时按 §4.3 合并重试，不要把 `version` 改成服务端最新值后直接覆盖——那等于无条件覆盖。
- 值里不要放凭证、令牌、手机号等敏感信息；偏好不加密存储。

## 6. 生命周期

- 自助注销（`POST /app/auth/delete-account`）在撤销会话、落 `DELETED` 状态之后调用 `AccountPreferenceLogic.deleteAllFor(uid)`；重复注销会再执行一遍，失败可重试补上。
- 产品若有其他物理删除账号的路径，须同样调用 `deleteAllFor`。
- 偏好不进账号资料、不随 IM 资料同步、不对外可见。

## 7. 实现位置

| 内容 | 位置 |
| --- | --- |
| 迁移 | `sql/postgresql/V002__account_preferences.sql` |
| 逻辑 | `logic/AccountPreferenceLogic.kt` |
| 接口 | `controller/app/account/AccountPreferenceController.kt`、`dto/AccountPreferenceDtos.kt` |
| 装配 | `init/AccountRuntimeBootstrap.kt` |
| 测试 | `AccountPreferenceLogicTest`（输入校验先于 SQL）、`AccountPreferenceDbTest`（`ACCOUNT_DB_URI=… gradlew postgresContractTest`） |
