# module-cs 错误码

cs（客服：组织开通 / 坐席 / 访客进线 / 会话路由 / 审核 / 订阅）抛出的业务错误，响应信封里的 `message`
一律是本模块的机器码（`^[A-Z][A-Z0-9_]{2,}$`），不放中英文句子、不带 `CODE: detail` 前缀、不做插值或拼接；
数字 `code` 分两类：客服专属情形沿用 `CsErrorCode` 的 23000 段数字码（前端按它分支，码值对外后不改），
其余取 `NetonErrorCode` 的类别（参数错 / 越界 / 不存在 / 已存在 / 不允许 …），HTTP 状态由框架按数字码推导。
跟请求字段有关的细节放字段级错误 `errors = [{ path, message: CODE, code: CODE }]`（message 与 code 同为机器码）；
具体数值（试用名额、上限、坐席当前会话数、状态迁移的起止）不进响应，由前端按已知规则展示或写服务端日志。
码集中定义在 `error.CsErrorCodes`，后台前端 `neton-application-front-cs` 在 `src/locales/{zh-CN,en-US}.ts`
里以 `error.<CODE>` 翻译，页面经 `useDescribeError("cs")` / `useDescribeFieldErrors("cs")` 显示。
新增码顺序：`CsErrorCodes` →（需要专属数字码时）`CsErrorCode` → 本表 → 前端两种语言。模块 `macosArm64Test` 里的
`ErrorMessageGuardTest`（共享夹具 `contract.testing.ErrorMessageGuard`）扫描 `src/commonMain`，出现非机器码 message 即失败。

账号相关错误（登录、游客开通、token 等）由 account 模块抛出、走 `AccountErrorCodes`，cs 不改写、原样透传。

| 机器码 | 数字码 | 场景 | 字段 |
|---|---|---|---|
| `WIDGET_NOT_FOUND` | RESOURCE_NOT_FOUND | 访客进线：widgetKey 不存在或已失效 | `widgetKey` |
| `WIDGET_DISABLED` | CsErrorCode.WIDGET_DISABLED (23001) | 访客进线：店主关闭了 widget | — |
| `ORG_NOT_SERVICEABLE` | CsErrorCode.ORG_NOT_SERVICEABLE (23002) | 进线：组织待审 / 被拒 / 停服 | — |
| `TRIAL_EXPIRED` | CsErrorCode.TRIAL_EXPIRED (23003) | 进线：试用已到期 | — |
| `TRIAL_QUOTA_EXHAUSTED` | CsErrorCode.TRIAL_QUOTA_EXHAUSTED (23004) | 进线：试用期顾客名额用完（新顾客；含并发占名额失败） | — |
| `PAID_EXPIRED` | CsErrorCode.PAID_EXPIRED (23005) | 进线：付费已到期，不接新访客 | — |
| `INTAKE_RATE_LIMITED` | RATE_LIMIT_EXCEEDED | 匿名进线按 IP 限流（`@RateLimit` 的 message） | — |
| `DEVICE_ID_REQUIRED` | MISSING_REQUIRED_PARAM | 访客进线 deviceId 为空 | `deviceId` |
| `FIELD_TOO_LONG` | INVALID_PARAMS | 访客进线入参超长（deviceId 128 / displayName 64 / externalUserId 128 / contextJson 4096） | 对应字段 |
| `CUSTOMER_NOT_FOUND` | RESOURCE_NOT_FOUND | 进线后会话指向的顾客记录缺失 | — |
| `NO_ORGANIZATION` | CsErrorCode.NO_ORGANIZATION (23010) | 工作台：当前账号不属于任何组织，或同属多个未指定（前端据此进入开通引导） | — |
| `OWNER_REQUIRED` | CsErrorCode.OWNER_REQUIRED (23011) | 工作台：仅组织所有者可执行 | — |
| `ALREADY_OWNS_ORGANIZATION` | CsErrorCode.ALREADY_OWNS_ORGANIZATION (23012) | 开通：一个账号最多拥有一个组织（含并发唯一键冲突） | — |
| `ORGANIZATION_NOT_FOUND` | RESOURCE_NOT_FOUND | 按 id 查 / 审核 / 赠送 / 进线时组织不存在 | — |
| `ORGANIZATION_NAME_INVALID` | INVALID_PARAMS | 开通：组织名称为空或超过 64 字 | `name` |
| `INVITEE_NOT_REGISTERED` | RESOURCE_NOT_FOUND | 邀请坐席：手机号未注册或是游客（同一个码，防枚举） | `mobile` |
| `AGENT_ALREADY_IN_ORGANIZATION` | RESOURCE_ALREADY_EXISTS | 邀请坐席：该账号已在本组织 | `mobile` |
| `AGENT_NOT_IN_ORGANIZATION` | RESOURCE_NOT_FOUND | 移除坐席 / 转接目标不在本组织 | `toMemberId`（转接） |
| `CANNOT_REMOVE_OWNER` | OPERATION_NOT_ALLOWED | 移除坐席：目标是组织所有者 | — |
| `AGENT_HAS_ACTIVE_SESSIONS` | OPERATION_NOT_ALLOWED | 移除坐席：仍有进行中的会话，须先转接 | — |
| `SEAT_STATUS_INVALID` | INVALID_PARAMS | 坐席改接待状态：值不是合法状态（离线 / 可接待 / 忙碌 / 离开） | `seatStatus` |
| `MAX_SESSIONS_OUT_OF_RANGE` | PARAM_OUT_OF_RANGE | 坐席改接待上限：不在 1..100 | `maxSessionCount` |
| `CONVERSATION_NOT_FOUND` | RESOURCE_NOT_FOUND | 转接 / 关闭：会话不存在 | — |
| `CONVERSATION_ACCESS_DENIED` | PERMISSION_DENIED | 转接 / 关闭：会话不属于本组织 | — |
| `SEAT_UNAVAILABLE` | CsErrorCode.SEAT_UNAVAILABLE (23020) | 指派 / 转接：目标坐席不可接待或已满 | — |
| `STATE_CHANGED` | CsErrorCode.STATE_CHANGED (23030) | 审核 / 开通订阅时组织状态被并发变更，刷新后重试 | — |
| `PURCHASE_NOT_ALLOWED` | CsErrorCode.PURCHASE_NOT_ALLOWED (23031) | 购买：组织状态（被拒 / 待审 / 停服）不允许 | — |
| `ILLEGAL_TRANSITION` | CsErrorCode.ILLEGAL_TRANSITION (23032) | 审核：不允许的状态迁移 | `status` |
| `REVIEW_NOTE_REQUIRED` | MISSING_REQUIRED_PARAM | 审核拒绝未填理由 | `note` |
| `MONTHS_OUT_OF_RANGE` | PARAM_OUT_OF_RANGE | 购买 / 赠送时长不在 1..36 个月 | `months` |
| `WALLET_NOT_FOUND` | RESOURCE_NOT_FOUND | 购买：钱包不存在，需先充值 | — |
| `GRANT_NOTE_REQUIRED` | MISSING_REQUIRED_PARAM | 平台赠送时长未填原因 | `note` |
