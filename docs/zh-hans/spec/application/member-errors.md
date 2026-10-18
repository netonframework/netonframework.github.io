# module-member 错误码

member（会员成长：标签 / 分组 / 等级 / 积分 / 签到 / 收货地址 / 邀请码）抛出的业务错误，响应信封里的 `message`
一律是本模块的机器码（`^[A-Z][A-Z0-9_]{2,}$`），不放中英文句子、不带 `CODE: detail` 前缀、不做插值或拼接；
数字 `code` 仍取 `NetonErrorCode` 的类别（参数错 / 不存在 / 已存在 / 冲突 / 服务不可用 …），HTTP 状态由框架按类别推导。
跟请求字段有关的细节放字段级错误 `errors = [{ path, message: CODE, code: CODE }]`（message 与 code 同为机器码）；
只对排障有用的细节（被拒的 key、下游失败原因、当时的周期天数等）写服务端日志，不进响应。
码集中定义在 `logic.MemberErrorCodes`，后台前端 `neton-application-front-member` 在 `src/locales/{zh-CN,en-US}.ts`
里以 `error.<CODE>` 翻译，页面经 `useDescribeError("member")` / `useDescribeFieldErrors("member")` 显示。
新增码顺序：`MemberErrorCodes` → 本表 → 前端两种语言。模块 `macosArm64Test` 里的 `ErrorMessageGuardTest`
（共享夹具 `contract.testing.ErrorMessageGuard`）扫描 `src/commonMain`，出现非机器码 message 即失败。

账号相关错误（注册、登录、资料等）由 account 模块抛出、走 `AccountErrorCodes`，member 不改写、原样透传。

| 机器码 | NetonErrorCode | 场景 | 字段 |
|---|---|---|---|
| `MEMBER_TAG_NOT_FOUND` | RESOURCE_NOT_FOUND | 后台按 id 改 / 查会员标签，不存在 | — |
| `MEMBER_GROUP_NOT_FOUND` | RESOURCE_NOT_FOUND | 后台按 id 改 / 查会员分组，不存在 | — |
| `ADDRESS_NOT_FOUND` | RESOURCE_NOT_FOUND | 改 / 删收货地址：不存在或不属于当前用户（不区分，防探测） | — |
| `INVITE_CODE_INVALID` | INVALID_PARAMS | 注册带码或补填：码为空 / 不存在 / 停用 / 过期 / 用尽 / 邀请人停用 / 并发下次数已满（统一一个码防枚举） | — |
| `INVITE_ALREADY_BOUND` | INVALID_PARAMS | 补填邀请码时已绑定过邀请人 | — |
| `INVITE_CODE_GENERATION_CONFLICT` | OPERATION_CONFLICT | 随机生成邀请码连续撞码（个人专属码 / 后台创建不填码），可重试 | — |
| `INVITE_CODE_FORMAT_INVALID` | INVALID_FORMAT | 后台自定义邀请码不是 1-32 位非空白字符 | `code` |
| `INVITE_CODE_ALREADY_EXISTS` | RESOURCE_ALREADY_EXISTS | 后台自定义邀请码已被占用 | `code` |
| `INVITE_CODE_NOT_FOUND` | RESOURCE_NOT_FOUND | 后台更新邀请码，id 不存在 | — |
| `INVITE_RECORD_NOT_FOUND` | RESOURCE_NOT_FOUND | 后台补偿（重放邀请奖励 / 重试自动加好友），邀请记录不存在 | — |
| `INVITE_AUTO_FRIEND_RETRY_FAILED` | SERVICE_UNAVAILABLE | 后台重试自动加好友仍失败；原因记在邀请记录 `autoFriendError` 与日志 | — |
| `SIGN_IN_SETTING_KEY_FORBIDDEN` | INVALID_PARAMS | 签到设置入口改非 `member.signin.*` 的 key（权限边界） | `key` |
| `SIGN_IN_SETTINGS_READ_ONLY` | SERVICE_UNAVAILABLE | 宿主未装配全局设置，签到设置只读 | — |
| `SIGN_IN_DAY_OUT_OF_RANGE` | PARAM_OUT_OF_RANGE | 签到配置的天数不在 `1..当前周期` 内 | `day` |
| `SIGN_IN_CONFIG_DAY_EXISTS` | RESOURCE_ALREADY_EXISTS | 该天已有签到配置 | `day` |
| `SIGN_IN_CONFIG_NOT_FOUND` | RESOURCE_NOT_FOUND | 后台更新签到配置，id 不存在 | — |
| `ALREADY_SIGNED_IN_TODAY` | DUPLICATE_OPERATION | 用户今天已签到 | — |
| `SIGN_IN_CASH_REWARD_UNAVAILABLE` | SERVICE_UNAVAILABLE | 当天配了现金奖励但宿主未装配 `MemberRewardPort`：拒绝签到，不允许现金静默不发 | — |
