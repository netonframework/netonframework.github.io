# module-system 错误码

system（管理员登录 / MFA / 用户、角色、部门、岗位、菜单 / 字典 / 公告与站内信 / 消息通道与模板 / 日志 / 系统配置 /
网络准入 / 健康检查）抛出的业务错误，响应信封里的 `message` 一律是本模块的机器码（`^[A-Z][A-Z0-9_]{2,}$`），
不放中英文句子、不带 `CODE: detail` 前缀、不做插值或拼接；数字 `code` 仍取 `NetonErrorCode` 的类别（参数错 / 不存在 /
已存在 / 冲突 / 无权限 / 服务不可用 …），HTTP 状态由框架按类别推导。
跟请求字段有关的细节放字段级错误 `errors = [{ field, message: CODE, code: CODE }]`（message 与 code 同为机器码）；
只对排障有用的细节（被拒的模板编码、邮件厂商名、下游失败原因等）写服务端日志，不进响应。

- 码集中定义在 `logic.SystemErrorCodes`；字段错误用 `SystemErrorCodes.field(path, CODE)` 构造。
- `@RateLimit(message = …)` 会原样进 429 信封的 `message`（数字 code `10300`），同样只写机器码（写句子编译失败）。
- 声明式校验（`@Pattern(message = SystemErrorCodes.MOBILE_INVALID)`）的字段错误 `code` 与 `message` 都是该机器码；
  不写 message 时是框架内建码（`REQUIRED` / `TOO_SHORT` …）。前端运行时只按字段 `code` 翻译（[错误码规范](../error-codes.md)）。
- 后台前端 `neton-application-front-system` 在 `src/locales/{zh-CN,en-US}.ts` 里以 `error.<CODE>` 翻译，页面经
  `useDescribeError("system")`、资源页经 `errorNamespace: "system"` 显示；登录页同样用 `system` 命名空间。
  vben 后台（`neton-application-admin` 及兼容发行版）在 `langs/<语言>/error-system.json` 里翻译，
  `api/request.ts` 的错误提示按 `error-*` 语言包查机器码。
- 新增码顺序：`SystemErrorCodes` → 本表 → 新 front 两种语言 → vben 两种语言。模块 `macosArm64Test` 里的
  `ErrorMessageGuardTest`（共享夹具 `contract.testing.ErrorMessageGuard`）扫描 `src/commonMain`，异常构造、
  `ValidationError`、本模块的 `ProviderNotImplementedException` 与 `@RateLimit` 出现非机器码 message 即失败。

登录类错误的类别刻意保持 `INVALID_PARAMS`（400）而不是 401：后台前端收到 401 会直接跳登录页，登录页本身、
刷新令牌与 MFA 失败都需要把原因显示出来。

## 登录与会话

| 机器码 | NetonErrorCode | 场景 | 字段 |
|---|---|---|---|
| `INVALID_CREDENTIALS` | INVALID_PARAMS | 用户名密码登录 / 短信登录：用户不存在、密码错误、账号停用统一一个码（防枚举） | — |
| `LOGIN_REQUIRED` | INVALID_PARAMS | 刷新令牌或 MFA 完成时会话已失效：域不对、会话版本变了、会话被吊销、刷新令牌被重放、用户停用 | — |
| `REFRESH_TOKEN_INVALID` | INVALID_PARAMS | 刷新令牌验签失败或过期 | — |
| `ACCOUNT_DISABLED` | INVALID_PARAMS | 第三方登录绑定的管理员已停用 | — |
| `LOGIN_LOCKED` | RATE_LIMIT_EXCEEDED | 同一账号同一来源连续失败后冷却，带 `Retry-After`（`LoginThrottle`，account 的终端用户登录共用） | — |
| `LOGIN_RATE_LIMITED` | RATE_LIMIT_EXCEEDED | 登录入口按 IP 限流 | — |
| `REFRESH_RATE_LIMITED` | RATE_LIMIT_EXCEEDED | 刷新令牌入口按 IP 限流 | — |
| `SMS_LOGIN_RATE_LIMITED` | RATE_LIMIT_EXCEEDED | 短信登录入口按 IP 限流 | — |
| `SMS_SEND_RATE_LIMITED` | RATE_LIMIT_EXCEEDED | 发短信验证码入口按 IP 限流 | — |
| `PASSWORD_RESET_RATE_LIMITED` | RATE_LIMIT_EXCEEDED | 短信重置密码入口按 IP 限流 | — |
| `SOCIAL_LOGIN_RATE_LIMITED` | RATE_LIMIT_EXCEEDED | 第三方登录入口按 IP 限流 | — |
| `MFA_RATE_LIMITED` | RATE_LIMIT_EXCEEDED | MFA 绑定 / 验证入口按 IP 限流 | — |

## 短信与验证码

| 机器码 | NetonErrorCode | 场景 | 字段 |
|---|---|---|---|
| `SMS_NOT_CONFIGURED` | SERVICE_UNAVAILABLE | 未装配验证码服务（无 Redis） | — |
| `SMS_SCENE_INVALID` | INVALID_PARAMS | 发码用途不是 `login` / `reset_password` | `scene` |
| `SMS_CODE_INVALID` | INVALID_PARAMS | 短信验证码错误、过期，或重置密码时手机号不属于任何管理员 | `smsCode` |
| `SMS_CODE_LOCKED` | INVALID_PARAMS | 同一挑战猜错次数到上限，需重新获取 | `smsCode` |
| `MOBILE_INVALID` | INVALID_PARAMS | 手机号格式（`@Pattern`，字段错误 `code = Pattern`） | `mobile` |
| `VERIFICATION_UNAVAILABLE` | SERVICE_UNAVAILABLE | 验证码服务没有 Redis | — |
| `VERIFICATION_CHANNEL_UNAVAILABLE` | SERVICE_UNAVAILABLE | 没有可用的发送通道 / 模板 | — |
| `VERIFICATION_SEND_FAILED` | SERVICE_UNAVAILABLE | 通道发送失败（原因见消息日志） | — |
| `VERIFICATION_TOO_FREQUENT` | RATE_LIMIT_EXCEEDED | 同一接收方冷却期内重复发码；冷却剩余秒数在响应头 `Retry-After` | — |
| `VERIFICATION_DAILY_LIMIT` | DAILY_QUOTA_EXCEEDED | 同一接收方当日发码次数用完 | — |
| `VERIFICATION_DAILY_BUDGET_EXHAUSTED` | SERVICE_UNAVAILABLE | 全站当日发码预算用完 | — |

## MFA

| 机器码 | NetonErrorCode | 场景 | 字段 |
|---|---|---|---|
| `MFA_NOT_CONFIGURED` | SERVICE_UNAVAILABLE | 服务器没有配置 MFA 主密钥 | — |
| `MFA_CHALLENGE_INVALID` | INVALID_PARAMS | 挑战令牌格式不对、不存在、过期、尝试次数用尽，或期间改过密码 / 策略 | — |
| `MFA_CODE_INVALID` | INVALID_PARAMS | 动态码错误或挑战已过期 / 重放 | `code` |
| `MFA_SELF_RESET_FORBIDDEN` | PERMISSION_DENIED | 管理员重置自己的 MFA | — |
| `USER_NOT_FOUND` | RESOURCE_NOT_FOUND | 查 / 设 / 重置 MFA 的用户不存在 | — |

## 第三方登录

| 机器码 | NetonErrorCode | 场景 | 字段 |
|---|---|---|---|
| `SOCIAL_LOGIN_NOT_CONFIGURED` | SERVICE_UNAVAILABLE | 未装配第三方登录 | — |
| `SOCIAL_PROVIDER_NOT_CONFIGURED` | INVALID_PARAMS | 请求的第三方类型没有对应 provider | `socialType` |
| `SOCIAL_PROVIDER_NOT_IMPLEMENTED` | SERVICE_UNAVAILABLE | Google / Telegram 占位 provider（未接入，不伪造成功） | — |
| `SOCIAL_USER_INFO_FAILED` | INVALID_PARAMS | provider 没返回 openId | — |
| `SOCIAL_ACCOUNT_NOT_BOUND` | INVALID_PARAMS | 第三方账号未绑定管理员 | — |
| `SOCIAL_BOUND_USER_NOT_FOUND` | RESOURCE_NOT_FOUND | 绑定的管理员已不存在 | — |
| `SOCIAL_ACCOUNT_ALREADY_BOUND` | RESOURCE_ALREADY_EXISTS | 该用户已绑定过同类型第三方账号 | — |
| `SOCIAL_ACCOUNT_BOUND_TO_OTHER` | OPERATION_CONFLICT | 该第三方账号已绑定其他用户 | — |
| `SOCIAL_BINDING_NOT_FOUND` | RESOURCE_NOT_FOUND | 解绑时找不到绑定 | — |
| `SOCIAL_USER_NOT_FOUND` | RESOURCE_NOT_FOUND | 按 id 查第三方账号不存在 | — |

## 用户、角色、部门、岗位、菜单

| 机器码 | NetonErrorCode | 场景 | 字段 |
|---|---|---|---|
| `USER_NOT_FOUND` | RESOURCE_NOT_FOUND | 按 id 查 / 改 / 删 / 授角色的用户不存在 | — |
| `USERNAME_EXISTS` | RESOURCE_ALREADY_EXISTS | 新建用户用户名重复 | `username` |
| `OLD_PASSWORD_INCORRECT` | INVALID_PARAMS | 本人改密码，当前密码不对 | `oldPassword` |
| `NEW_PASSWORD_SAME_AS_OLD` | INVALID_PARAMS | 本人改密码，新旧相同 | `newPassword` |
| `ROLE_NOT_FOUND` | RESOURCE_NOT_FOUND | 角色不存在 | — |
| `ROLE_CODE_EXISTS` | RESOURCE_ALREADY_EXISTS | 角色编码重复 | `code` |
| `DEPT_NOT_FOUND` | RESOURCE_NOT_FOUND | 部门不存在 | — |
| `DEPT_PARENT_SELF` | INVALID_PARAMS | 上级部门选了自己 | `parentId` |
| `DEPT_HAS_CHILDREN` | OPERATION_CONFLICT | 删除仍有子部门的部门 | — |
| `POST_NOT_FOUND` | RESOURCE_NOT_FOUND | 岗位不存在 | — |
| `POST_CODE_EXISTS` | RESOURCE_ALREADY_EXISTS | 岗位编码重复 | `code` |
| `MENU_NOT_FOUND` | RESOURCE_NOT_FOUND | 菜单不存在 | — |
| `MENU_PARENT_SELF` | INVALID_PARAMS | 上级菜单选了自己 | `parentId` |
| `MENU_HAS_CHILDREN` | OPERATION_CONFLICT | 删除仍有子菜单的菜单 | — |

## 字典

| 机器码 | NetonErrorCode | 场景 | 字段 |
|---|---|---|---|
| `DICT_TYPE_NOT_FOUND` | RESOURCE_NOT_FOUND | 字典类型不存在 | — |
| `DICT_TYPE_EXISTS` | RESOURCE_ALREADY_EXISTS | 字典类型标识重复 | `type` |
| `DICT_TYPE_IMMUTABLE` | INVALID_PARAMS | 修改字典类型标识（它是字典数据与缓存的外键） | `type` |
| `DICT_TYPE_HAS_DATA` | OPERATION_CONFLICT | 删除仍有字典数据的类型 | — |
| `DICT_DATA_NOT_FOUND` | RESOURCE_NOT_FOUND | 字典数据不存在 | — |

## 公告、站内信、消息通道与模板

| 机器码 | NetonErrorCode | 场景 | 字段 |
|---|---|---|---|
| `NOTICE_NOT_FOUND` | RESOURCE_NOT_FOUND | 公告不存在 | — |
| `NOTIFY_TEMPLATE_NOT_FOUND` | RESOURCE_NOT_FOUND | 站内信 / 通知模板不存在（按 id 或按编码发送） | — |
| `NOTIFY_TEMPLATE_CODE_EXISTS` | RESOURCE_ALREADY_EXISTS | 站内信模板编码重复 | `code` |
| `NOTIFY_TEMPLATE_UNLINKED` | OPERATION_CONFLICT | 按通知模板发送，但它没关联消息模板 | — |
| `MESSAGE_TEMPLATE_NOT_FOUND` | RESOURCE_NOT_FOUND | 消息模板不存在（含按编码发送、通知模板关联的模板已删） | — |
| `MESSAGE_TEMPLATE_CODE_EXISTS` | RESOURCE_ALREADY_EXISTS | 消息模板编码重复 | `code` |
| `MESSAGE_CHANNEL_NOT_FOUND` | RESOURCE_NOT_FOUND | 消息通道不存在（含模板引用的通道已删） | — |
| `MESSAGE_CHANNEL_CODE_EXISTS` | RESOURCE_ALREADY_EXISTS | 通道编码重复 | `code` |
| `MESSAGE_PROVIDER_UNAVAILABLE` | SERVICE_UNAVAILABLE | 通道类型没有装配发送实现 | — |
| `SMS_PROVIDER_NOT_CONFIGURED` | SERVICE_UNAVAILABLE | 短信通道没填账号（通道配置或 `SMS_SMSBAO_*` 环境变量） | — |
| `SMTP_TRANSPORT_UNAVAILABLE` | SERVICE_UNAVAILABLE | 邮箱账号选了 smtp，但应用没有装配 `SmtpTransport` | — |
| `MESSAGE_ENDPOINT_FORBIDDEN` | SERVICE_UNAVAILABLE | 消息渠道配置的地址（短信 `apiUrl`、邮件 `endpoint`、SMTP 主机）被运维出站策略 `[egress]` 拒绝：回环 / 内网 / 链路本地 / 端口不在放行列表 / 解析不出（细节记日志） | — |
| `EMAIL_VENDOR_UNSUPPORTED` | SERVICE_UNAVAILABLE | 邮箱账号的厂商不是 smtp / resend / sendgrid / mailgun / brevo / http（厂商名记日志） | — |

provider 的异常在正常发送路径里被 `MessageSendLogic` 接住并记成发送失败，`message_log.error_message` 里记的就是机器码；
只有「测试发送」会把它原样返回给后台。

## 日志、配置、网络准入、健康检查、开发工具

| 机器码 | NetonErrorCode | 场景 | 字段 |
|---|---|---|---|
| `MESSAGE_LOG_NOT_FOUND` | RESOURCE_NOT_FOUND | 发送记录不存在 | — |
| `OPERATE_LOG_NOT_FOUND` | RESOURCE_NOT_FOUND | 操作日志不存在 | — |
| `LOGIN_LOG_NOT_FOUND` | RESOURCE_NOT_FOUND | 登录日志不存在 | — |
| `SETTING_NOT_DEFINED` | RESOURCE_NOT_FOUND | 按 key 写配置，但代码里没声明这个定义 | `key` |
| `SETTING_VALUE_INVALID` | INVALID_PARAMS | 配置值不能被定义解析（类型、范围、长度、空串） | `value` |
| `IP_NOT_ALLOWED` | PERMISSION_DENIED | 路由组配置了 allowlist，来源地址不在其中（网络准入闸，403） | — |
| `SERVICE_DEGRADED` | SERVICE_UNAVAILABLE | `/system/health/ready` 有依赖不可用；每个不可用依赖一条字段错误 | 依赖名（`database` / `redis`），`code = DEPENDENCY_UNAVAILABLE` |
| `DEPENDENCY_UNAVAILABLE` | — | 只出现在 `SERVICE_DEGRADED` 的字段错误里 | — |
| `SIMULATED_CODE_NOT_FOUND` | RESOURCE_NOT_FOUND | 开发验证码查询：模拟未开启、没有记录、realm / purpose 不匹配一律此码（不透露开关状态） | — |
| `VERIFICATION_CHANNEL_INVALID` | INVALID_PARAMS | 开发验证码查询的 channel 不是 sms / email | `channel` |
| `RECEIVER_REQUIRED` | INVALID_PARAMS | 开发验证码查询缺 receiver | `receiver` |

启动期的配置错误（JWT 密钥、Cookie、allowlist 格式、验证码模拟开关等）是 `check` / `require` / `error`，进程直接起不来，
不进任何 HTTP 响应，不在本表范围内。
