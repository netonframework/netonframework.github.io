# module-infra 错误码

infra（文件上传与读取、媒体服务、后台文件配置 / 定时任务 / API 日志 / 领域事件运维）抛出的业务错误，响应信封里的
`message` 一律是本模块的机器码（`^[A-Z][A-Z0-9_]{2,}$`），不放中英文句子、不带 `CODE: detail` 前缀、不做插值或拼接；
数字 `code` 仍取 `NetonErrorCode` 的类别，HTTP 状态由框架按类别推导。跟请求字段有关的细节放字段级错误
`errors = [{ path, message: CODE, code: CODE }]`（message 与 code 同为机器码）；只对排障有用的细节（实际 MIME、
实际大小、事件当前状态等）写服务端日志，不进响应。码集中定义在 `port.InfraErrorCodes`，后台前端
`neton-application-front-infra` 在 `src/locales/{zh-CN,en-US}.ts` 里以 `error.<CODE>` 翻译，页面经
`useDescribeError("infra")`（`ResourcePage` 传 `errorNamespace: "infra"`）显示。新增码顺序：`InfraErrorCodes` → 本表 →
前端两种语言。模块 `macosArm64Test` 里的 `ErrorMessageGuardTest`（共享夹具 `contract.testing.ErrorMessageGuard`）扫描
`src/commonMain`，出现非机器码 message 即失败。

上传接口的错误约定另见 [infra-media §4.1](infra-media.md#41-单文件上传)。

## HTTP 错误

| 机器码 | NetonErrorCode | 场景 | 字段 |
|---|---|---|---|
| `INVALID_CONTENT_TYPE` | INVALID_PARAM_TYPE | App / 后台上传请求不是 multipart/form-data | — |
| `MISSING_FILE_FIELD` | INVALID_PARAMS | 上传缺表单字段 `file` | `file` |
| `MISSING_BUSINESS_TYPE` | INVALID_PARAMS | 上传缺表单字段 `businessType` | `businessType` |
| `INVALID_BUSINESS_TYPE` | INVALID_PARAMS | businessType 未注册（上传 / 服务端存字节 / `policyOrThrow`） | `businessType` |
| `INVALID_MIME_TYPE` | INVALID_FORMAT | MIME 不在该业务类型白名单 | `file` |
| `FILE_TOO_LARGE` | PAYLOAD_TOO_LARGE | 超过该业务类型大小上限 | `file` |
| `EMPTY_FILE` | INVALID_PARAMS | 文件为空 | `file` |
| `UPLOAD_RATE_LIMITED` | RATE_LIMIT_EXCEEDED | App / 后台上传超过 60 次/分钟（`@RateLimit` message） | — |
| `INVALID_ADMIN_IDENTITY` | PERMISSION_DENIED | 后台上传时身份 id 不是数字 | — |
| `FILE_NOT_FOUND` | RESOURCE_NOT_FOUND | App / 后台按 fileId 读取，文件不存在 | — |
| `FILE_DELETED` | RESOURCE_NOT_FOUND | 后台按 fileId 读取，文件已删除或正在清理 | — |
| `FILE_FORBIDDEN` | PERMISSION_DENIED | App 读取：已删除，或 OWNER / DELEGATED 文件无权读取 | — |
| `MEDIA_URL_RATE_LIMITED` | RATE_LIMIT_EXCEEDED | `GET /app/infra/media/url/{fileId}` 超过每 IP 120 次/分钟（`@RateLimit` message） | — |
| `MEDIA_VARIANT_UNKNOWN` | INVALID_PARAMS | `GET /app/infra/media/url/{fileId}` 的 `variant` 不是 w180 / w360 / w720 / w1080 / w1440 / og | `variant` |
| `FILE_CONFIG_NOT_FOUND` | RESOURCE_NOT_FOUND | 后台更新文件配置，id 不存在 | — |
| `JOB_NOT_FOUND` | RESOURCE_NOT_FOUND | 后台更新 / 手动触发任务，任务不存在 | — |
| `API_ERROR_LOG_NOT_FOUND` | RESOURCE_NOT_FOUND | 后台更新错误日志处理状态，日志不存在 | — |
| `DOMAIN_EVENT_NOT_FOUND` | RESOURCE_NOT_FOUND | 后台查 / 重投 / 丢弃领域事件，id 不存在 | — |
| `DOMAIN_EVENT_NOT_REQUEUEABLE` | OPERATION_NOT_ALLOWED | 重投非终态失败（status ≠ 3）的事件 | — |
| `DOMAIN_EVENT_NOT_DISCARDABLE` | OPERATION_NOT_ALLOWED | 丢弃非待投递 / 失败（status ∉ {0, 3}）的事件，如投递中 | — |

## MediaService 结果码

`MediaService.attach` / `importFromUrl` 不抛 HTTP 异常，而是返回 `AttachResult.Rejected` / `ImportResult.Rejected`，
其中 `code: MediaErrorCode` 的枚举名就是机器码（含义见 [infra-media §4.3 / §6.2](infra-media.md#62-关联契约)），
`message` 只是排障说明、不给客户端。调用方模块把结果码透传给客户端时 `message` 用 `code.name`；
这些名字全部收进 `InfraErrorCodes`（`InfraErrorCodesTest` 保证与枚举一致），前端 infra 语言包同样有翻译。
与上表同名的码（`FILE_NOT_FOUND`、`FILE_DELETED`、`INVALID_BUSINESS_TYPE`、`INVALID_MIME_TYPE`、`FILE_TOO_LARGE`、`EMPTY_FILE`）指同一种失败。

| 机器码 | 来源 | 场景 |
|---|---|---|
| `UNKNOWN_BUSINESS_TYPE` | attach | 文件的业务类型已不在注册表里 |
| `USAGE_NOT_ALLOWED` | attach | 业务类型不允许用于该用途 |
| `NOT_FILE_OWNER` | attach | 临时 / OWNER 文件只能由上传者关联 |
| `NOT_REUSABLE` | attach | 已被引用的文件，其业务类型不允许复用 |
| `ACCESS_DENIED` | attach | 复用 DELEGATED 文件时看不到任何引用对象 |
| `INVALID_ARGUMENT` | attach | 参数为空或超长 |
| `INVALID_URL` | importFromUrl | 地址为空 / 超长 / 无主机 / 含 userinfo 或空白 |
| `URL_SCHEME_FORBIDDEN` | importFromUrl / 采集抓取 | 不是 http/https |
| `URL_TARGET_FORBIDDEN` | importFromUrl / 采集抓取 | 主机是或解析到非公网地址（本机、内网、链路本地、CGNAT、基准测试、组播、保留段等；任一解析结果命中即拒），或是非规范 IP 写法（`2130706433`、`0x7f.1`、`127.1`） |
| `URL_PORT_FORBIDDEN` | importFromUrl / 采集抓取 | 端口不在 `application.conf [egress] allowed_ports`（默认 80、443） |
| `URL_RESOLVE_FAILED` | importFromUrl / 采集抓取 | 域名解析失败或无地址 |
| `TOO_MANY_REDIRECTS` | importFromUrl | 跟随重定向超过 5 跳 |
| `FETCH_FAILED` | importFromUrl | 拉取远端失败 |
| `NOT_AVAILABLE` | importFromUrl | 部署没有出站 HTTP 客户端 |
