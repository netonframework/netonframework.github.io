# module-platform 错误码

## 规则

platform 模块所有业务错误的 `message` 都是模块自己的机器码（`^[A-Z][A-Z0-9_]{2,}$`），统一定义在
`neton-application-module-platform/src/commonMain/kotlin/logic/PlatformErrorCodes.kt`；不写中英文句子、不拼
`CODE: detail`、不做字符串插值。数字 `code` 取 `NetonErrorCode` 的类别。跟某个请求字段有关的错误另带字段级错误
`errors = [{ path: <字段>, message: <CODE>, code: <CODE> }]`。校验注解（`@Pattern`）与限流注解（`@RateLimit`）的
`message` 同样只放机器码。前端（neton-application-front-platform）在 `src/locales/<lang>.ts` 里按 `error.<CODE>`
翻译，页面通过 `errorNamespace: "platform"`（即 `useDescribeError("platform")`）取词条。守卫测试
`src/macosArm64Test/kotlin/error/ErrorMessageGuardTest.kt` 扫描 `src/commonMain`，句子会让构建失败。

新增码：先加到 `PlatformErrorCodes`，再补本表与前端 zh-CN / en-US 两份 `error.<CODE>`。

## 错误码

| 机器码 | NetonErrorCode | 场景 | 字段 |
| --- | --- | --- | --- |
| `CLIENT_NOT_FOUND` | RESOURCE_NOT_FOUND | 管理端更新接入方（`PUT /admin/platform/client/update`）时 id 不存在 | — |
| `CONTACT_MOBILE_INVALID` | INVALID_PARAMS（校验） | 管理端新建 / 更新接入方，联系人手机号不是 11 位大陆号 | `contactMobile` |
| `CLIENT_NOT_BOUND` | RESOURCE_NOT_FOUND | 会员端 `/member/account/credentials`、`/apis`、`/logs/{id}`：当前账号没有绑定接入方 | — |
| `LOG_NOT_FOUND` | RESOURCE_NOT_FOUND | 会员端 `/member/account/logs/{id}`：日志不存在，或不属于当前账号的接入方（两者同码，不泄露存在性） | — |
| `TIMESTAMP_INVALID` | INVALID_FORMAT | 开放接口 `/order/query`、`/order/create`：timestamp 不是整数秒 | `timestamp` |
| `TIMESTAMP_EXPIRED` | INVALID_PARAMS | 开放接口：timestamp 与服务器时间相差超过 300 秒（防重放） | `timestamp` |
| `APP_ID_INVALID` | INVALID_CREDENTIALS | 开放接口：appId 不存在或已停用 | `appId` |
| `SIGNATURE_INVALID` | INVALID_CREDENTIALS | 开放接口：签名校验失败 | `signature` |
| `ORDER_ID_REQUIRED` | MISSING_REQUIRED_PARAM | `/order/query` 未带 orderId | `orderId` |
| `ORDER_NOT_FOUND` | RESOURCE_NOT_FOUND | `/order/query`：订单不存在 | — |
| `CHARGE_SERVICE_UNAVAILABLE` | SERVICE_UNAVAILABLE | 开放接口：计费服务（ChargeLogic）未装配 | — |
| `ORDER_QUERY_RATE_LIMITED` | RATE_LIMIT_EXCEEDED | `/order/query` 限流（按 IP，60 次 / 60 秒） | — |
| `ORDER_CREATE_RATE_LIMITED` | RATE_LIMIT_EXCEEDED | `/order/create` 限流（按 IP，30 次 / 60 秒） | — |

## 开放接口的响应形态

`/order/query`、`/order/create` 的失败走框架标准错误响应（HTTP 状态 + `NetonErrorCode` + 机器码），不再在 200
响应体里返回自定义 `code` / `message`；成功响应体只含业务字段（`orderId`、`status`、`amount`）。
