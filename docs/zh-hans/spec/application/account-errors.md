# module-account 错误码

account（账号：注册 / 登录 / 令牌 / 验证码 / 资料 / 举报 / 账号偏好 / 后台账号与昵称词库）抛出的业务错误，响应信封里的
`message` 一律是本模块的机器码（`^[A-Z][A-Z0-9_]{2,}$`），不放中英文句子、不带 `CODE: detail` 前缀、不做插值或拼接；
数字 `code` 取 `NetonErrorCode` 的类别（参数错 / 缺参数 / 凭据错 / 账号停用 / 不存在 / 已存在 / 冲突 / 限流 / 服务不可用 …），
HTTP 状态由框架按类别推导（客户端只看 body 的 `code`：凭据错 `INVALID_CREDENTIALS` = 10011 虽然 HTTP 是 401，
但不是会话失效，会话失效只有 `AUTH_REQUIRED` = 10000）。跟请求字段有关的问题另带字段级错误
`errors = [{ path, message: CODE, code: CODE }]`（message 与 code 同为机器码，`path` 是请求体字段名）；声明式校验
（`@Pattern(message = "INVALID_MOBILE")` 等）产生的字段错误 `code` 与 `message` 都是注解给的机器码，注解不写 message 时是
框架内建码（`REQUIRED` / `TOO_SHORT` …，见 [错误码规范](../error-codes.md)）。
只对排障有用的细节（被拒的值、文件业务类型、剩余冷却秒数以外的内部状态）写服务端日志，不进响应。
码集中定义在 `logic.AccountErrorCodes`；后台前端 `neton-application-front-account` 在 `src/locales/{zh-CN,en-US}.ts`
里以 `error.<CODE>` 翻译，页面经 `useDescribeError("account")` / `useDescribeFieldErrors("account")` 显示。
新增码顺序：`AccountErrorCodes` → 本表 → 前端两种语言。模块 `macosArm64Test` 里的 `ErrorMessageGuardTest`
（共享夹具 `contract.testing.ErrorMessageGuard`）扫描 `src/commonMain`，出现非机器码 message 即失败。

验证码发送本身的限制（冷却、日上限、通道不可用、发送失败）和登录失败冷却（`LoginThrottle.Locked`）由 system 模块抛出，
走 `SystemErrorCodes`，account 不改写、原样透传。

| 机器码 | NetonErrorCode | 场景 | 字段 |
|---|---|---|---|
| `INVALID_CREDENTIALS` | INVALID_CREDENTIALS | 手机号 + 密码 / 用户名 + 密码登录：账号不存在、没设过密码、密码错（同一个码，防枚举）；修改密码时当前密码不对 | 修改密码时 `oldPassword` |
| `ACCOUNT_DISABLED` | USER_BANNED | 登录（密码 / 短信 / 社交 / 用户名）或刷新令牌时账号已停用 | — |
| `ACCOUNT_DELETED` | USER_BANNED | 同上，账号已注销 | — |
| `ACCOUNT_NOT_FOUND` | RESOURCE_NOT_FOUND | 按会话 / id 找不到账号（注销、绑邮箱、换绑手机、改资料、改密码、社交登录绑定的账号缺失、后台编辑 / 重设密码） | — |
| `ACCOUNT_DELETION_DISABLED` | PERMISSION_DENIED | 部署关闭了 App 内自助注销 | — |
| `INVALID_REFRESH_TOKEN` | INVALID_TOKEN | 内置身份后端：刷新令牌验签失败 / 格式错 | — |
| `NOT_A_REFRESH_TOKEN` | INVALID_TOKEN | 内置身份后端：拿 access token 来刷新 | — |
| `INVALID_REFRESH_TOKEN_SUBJECT` | INVALID_TOKEN | 内置身份后端：令牌主体不是账号 id | — |
| `REFRESH_TOKEN_EXPIRED` | REFRESH_TOKEN_EXPIRED | 内置身份后端：刷新令牌过期 / 会话记录已不存在 | — |
| `REFRESH_TOKEN_REVOKED` | REFRESH_TOKEN_REVOKED | 内置身份后端：会话已撤销（退出、改密、注销） | — |
| `DEVICE_ID_REQUIRED` | MISSING_REQUIRED_PARAM | 刷新令牌没带 `deviceId` | `deviceId` |
| `INVALID_MOBILE` | INVALID_PARAMS | 手机号不是 E.164（`+` + 国家码 + 号码，如 `+8615000000000`）：登录、短信登录、发码、换绑、找回密码；注册流程绑定时号码为空；后台编辑手机号格式不对 | `mobile` |
| `MOBILE_IN_USE` | RESOURCE_ALREADY_EXISTS | 换绑手机（发码时与提交时各查一次）：号码已属于另一个账号 | `mobile` |
| `MOBILE_ALREADY_BOUND` | OPERATION_CONFLICT | 注册流程免验证绑定手机号：当前账号已绑过（改号走带验证码的换绑） | — |
| `MOBILE_ALREADY_TAKEN` | RESOURCE_ALREADY_EXISTS | 注册流程免验证绑定手机号：号码已属于另一个账号 | `mobile` |
| `MOBILE_NOT_BOUND` | INVALID_PARAMS | 登录态发「修改密码」验证码，当前账号没绑手机号 | — |
| `SMS_CODE_REQUIRED` | MISSING_REQUIRED_PARAM | 短信登录没带验证码 | `smsCode` |
| `SMS_CODE_INVALID` | INVALID_PARAMS | 短信验证码不对 | `smsCode` |
| `SMS_CODE_EXPIRED` | INVALID_PARAMS | 短信验证码过期 / 未发送；找回密码时号码未注册也是它（不暴露号码是否注册） | `smsCode` |
| `SMS_CODE_ATTEMPTS_EXCEEDED` | INVALID_PARAMS | 短信验证码猜错到上限，这条码已作废，需重新获取 | `smsCode` |
| `INVALID_SCENE` | INVALID_PARAMS | 发码的 `scene` 不认识（短信场景值 / 邮箱场景名） | `scene` |
| `SCENE_REQUIRES_AUTH` | INVALID_PARAMS | 匿名发码接口（`/auth/send-sms-code`、`/auth/send-email-code`）收到需要登录的场景 | `scene` |
| `SCENE_NOT_ALLOWED` | INVALID_PARAMS | 登录态发码接口（`/member/user/send-sms-code`）收到登录 / 忘记密码场景 | `scene` |
| `VERIFICATION_UNAVAILABLE` | SERVICE_UNAVAILABLE | 验证码服务未装配（没有 Redis） | — |
| `INVALID_EMAIL` | INVALID_PARAMS | 邮箱格式不对 | `email` |
| `EMAIL_TAKEN` | RESOURCE_ALREADY_EXISTS | 绑定邮箱（发码时与提交时）：邮箱已属于另一个账号 | `email` |
| `INVALID_EMAIL_CODE` | INVALID_PARAMS | 邮箱验证码不对 / 过期 / 未发；找回密码时邮箱未绑定也是它 | `code` |
| `EMAIL_CODE_ATTEMPTS_EXCEEDED` | INVALID_PARAMS | 邮箱验证码猜错到上限，需重新获取 | `code` |
| `PASSWORD_TOO_SHORT` | INVALID_PARAMS | 新密码不足 8 位：注册、找回密码（短信 / 邮箱）、后台重设密码 | 注册 `password`；找回 `newPassword`；后台 `password` |
| `PASSWORD_TOO_LONG` | INVALID_PARAMS | 找回密码的新密码超过 128 位 | `newPassword` |
| `OLD_PASSWORD_REQUIRED` | MISSING_REQUIRED_PARAM | 已设过密码的账号修改密码没填当前密码 | `oldPassword` |
| `INVITE_CODE_UNSUPPORTED` | INVALID_PARAMS | 注册带了邀请码但没有任何扩展接管邀请码（未装 member） | `inviteCode` |
| `UNSUPPORTED_REGISTER_MODE` | INVALID_PARAMS | `/auth/register` 的 `mode` 不是 `USERNAME_PASSWORD` | `mode` |
| `REGISTER_MODE_DISABLED` | INVALID_PARAMS | 部署没开用户名密码注册 | — |
| `SOCIAL_LOGIN_UNAVAILABLE` | SERVICE_UNAVAILABLE | 未装配社交登录 | — |
| `INVALID_NICKNAME_LENGTH` | INVALID_PARAMS | 昵称去空格后不在 2–32 字符 | `nickname` |
| `INVALID_AVATAR_FILE_ID` | INVALID_PARAMS | 头像 `fileId` 为空 | `fileId` |
| `AVATAR_FILE_NOT_FOUND` | INVALID_PARAMS | 文件不存在或不属于本人（不区分，防探测 fileId） | `fileId` |
| `AVATAR_FILE_INACTIVE` | INVALID_PARAMS | 文件状态不可用 | `fileId` |
| `INVALID_AVATAR_BUSINESS_TYPE` | INVALID_PARAMS | 文件不是以 `member_avatar` 业务类型上传的 | `fileId` |
| `AVATAR_FILE_NO_URL` | INVALID_PARAMS | 文件没有访问地址 | `fileId` |
| `INVALID_USERNAME_FORMAT` | INVALID_PARAMS | 用户名不符合格式（注册 / 改用户名） | `username` |
| `USERNAME_RESERVED` | INVALID_PARAMS | 用户名是保留名称 | `username` |
| `USERNAME_RATE_LIMITED` | RATE_LIMIT_EXCEEDED | 30 天内只能改一次用户名；剩余秒数在响应头 `Retry-After` | — |
| `USERNAME_TAKEN` | RESOURCE_ALREADY_EXISTS | 用户名已被占用（注册查重 / 改名撞唯一索引） | `username` |
| `INVALID_BIO_LENGTH` | INVALID_PARAMS | 简介超过 200 字符 | `bio` |
| `INVALID_GENDER` | INVALID_PARAMS | 性别取值不在允许集合 | `gender` |
| `INVALID_BIRTHDAY_FORMAT` | INVALID_PARAMS | 生日不是 `yyyy-MM-dd` 或年份不在 1900–今年 | `birthday` |
| `INVALID_REPORT_TARGET_TYPE` | INVALID_PARAMS | 举报对象类型不认识 | `targetType` |
| `REPORT_TARGET_ID_REQUIRED` | MISSING_REQUIRED_PARAM | 举报对象 id 为空 | `targetId` |
| `INVALID_REPORT_REASON` | INVALID_PARAMS | 举报原因不认识 | `reason` |
| `REPORT_DESCRIPTION_TOO_LONG` | INVALID_PARAMS | 举报说明超过 500 字符 | `description` |
| `NICKNAME_WORD_NOT_FOUND` | RESOURCE_NOT_FOUND | 后台改状态 / 删除昵称词条（形容词 / 名词），id 不存在 | — |
| `INVALID_NICKNAME_WORD_STATUS` | INVALID_PARAMS | 昵称词条状态不是 0 / 1 | `status` |
| `INVALID_PREFERENCE_NAMESPACE` | INVALID_PARAMS | 账号偏好命名空间不合法（spec account-preferences） | `namespace` |
| `PREFERENCE_VALUE_REQUIRED` | INVALID_PARAMS | 写偏好没带值 / 值为 null | `value` |
| `INVALID_PREFERENCE_VERSION` | INVALID_PARAMS | 期望版本号为负（写）或 ≤ 0（删） | `version` |
| `PREFERENCE_VALUE_TOO_LARGE` | PAYLOAD_TOO_LARGE | 偏好值超过大小上限 | — |
| `PREFERENCE_NAMESPACE_LIMIT_EXCEEDED` | PARAM_OUT_OF_RANGE | 单个账号的偏好命名空间数达到上限 | — |
| `PREFERENCE_VERSION_CONFLICT` | OPERATION_CONFLICT | 期望版本与当前不符（另一端已改），重新读取后合并再写 | — |
| `PREFERENCE_CORRUPT` | DATABASE_ERROR | 库里存的偏好值解析不了 | — |
| `LOGIN_RATE_LIMITED` | 429（见下） | 入口限流：手机号密码 / 用户名密码 / 短信登录 | — |
| `REGISTER_RATE_LIMITED` | 429（见下） | 入口限流：注册 | — |
| `REFRESH_RATE_LIMITED` | 429（见下） | 入口限流：刷新令牌 | — |
| `SMS_SEND_RATE_LIMITED` | 429（见下） | 入口限流：发短信验证码（匿名 / 登录态） | — |
| `EMAIL_SEND_RATE_LIMITED` | 429（见下） | 入口限流：发邮箱验证码（匿名 / 登录态） | — |
| `SOCIAL_LOGIN_RATE_LIMITED` | 429（见下） | 入口限流：社交登录 | — |
| `PREFERENCE_WRITE_RATE_LIMITED` | 429（见下） | 入口限流：写 / 删账号偏好 | — |
| `ATTEMPTS_RATE_LIMITED` | 429（见下） | 入口限流：换绑手机、绑定邮箱、找回密码（短信 / 邮箱）提交 | — |

`*_RATE_LIMITED` 是路由 `@RateLimit` 的 `message`：入口限流由框架 `RateLimitInterceptor` 直接写响应，信封 `code` 是 `429`
（HTTP 429，带 `Retry-After`），不是 `NetonErrorCode.RATE_LIMIT_EXCEEDED`；客户端按 HTTP 429 或 `code` 429 / 10300–10399 都视为限流。
