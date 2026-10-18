# 错误码规范（ERROR_CODE_SPEC）：消息即机器码

> 状态：**冻结**（neton e7e0402 起）。适用于框架（neton-core / neton-http / neton-routing / neton-security /
> neton-validation / neton-ksp）与全部业务模块。代码里引用的「spec ERROR_CODE_SPEC」即本文。

## 1. 规则

1. 错误响应只有一种形状（标准信封，见 [HTTP 规范](./http.md)）：

   ```json
   {
     "code": 10100,
     "message": "VALIDATION_FAILED",
     "data": null,
     "errors": [
       { "field": "title",  "message": "TOO_SHORT",      "code": "TOO_SHORT", "params": { "min": 2, "max": 32 } },
       { "field": "mobile", "message": "INVALID_MOBILE", "code": "INVALID_MOBILE" }
     ]
   }
   ```

2. **数字 `code`**（`NetonErrorCode`，段位见 §5）决定错误类别与 HTTP status；客户端判断类别只看它。
3. **`message` 永远是机器码**：`UPPER_SNAKE_CASE`，字母开头（`^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$`），不是句子、
   不带 `"CODE: detail"` 前缀、不拼接变量。客户端拿它查语言包。
4. **字段错误**（`errors[]`，可选）：`field` 为字段路径，`code` 为机器码，`message` **与 `code` 相同**；
   客户端渲染要用的约束值放 `params`（数值，目前为 `min`/`max`），没有时不输出。新代码一律用
   `ValidationError.of(path, CODE, params?)`。
5. 排障细节（异常文本、配置错误、越权的具体权限名、解析器说明）**只进日志**，不进信封。
6. 客户端翻译顺序：模块语言包 `error.<CODE>` → 运行时通用语言包 `errors.code.<CODE>`（框架内建码在这里翻译，
   zh-CN + en-US）→ 错误类别说明。字段错误**只按 `code`** 翻译，`params` 代入模板（`{min}` / `{max}`）。
   信封是总括码 `VALIDATION_FAILED` / `INVALID_PARAMS` 且带字段错误时，优先说字段。

## 2. 框架信封码（`neton.core.http.NetonErrorMessage`）

| message | 数字 code | HTTP | 来源 |
|---|---|---|---|
| `VALIDATION_FAILED` | 10100 INVALID_PARAMS | 400 | 声明式校验 / 参数绑定失败（`ValidationException` 缺省） |
| `INVALID_PARAMS` | 10100 | 400 | `BadRequestException` 缺省 |
| `INVALID_JSON` | 10105 | 400 | 请求体不是合法 JSON / 与 DTO 对不上（字段 `$` 同码） |
| `UNSUPPORTED_MEDIA_TYPE` | 10102 | 400 | body 需要 `application/json` |
| `PAYLOAD_TOO_LARGE` | 10106 | 413 | 请求体超过引擎上限 |
| `REQUEST_TIMEOUT` | 5 TIMEOUT | 408 | 客户端没在时限内发完请求体 |
| `ROUTE_NOT_FOUND` | 10201 RESOURCE_NOT_FOUND | 404 | 无匹配路由 |
| `METHOD_NOT_ALLOWED` | 10200 OPERATION_NOT_ALLOWED | 405 | 不支持的 HTTP 方法 |
| `RESOURCE_NOT_FOUND` | 10201 | 404 | `NotFoundException` 缺省 |
| `AUTH_REQUIRED` | 10000 | 401 | 需要登录 / `UnauthorizedException` 缺省 |
| `PERMISSION_DENIED` | 10004 | 403 | `@Permission` 不满足 / Guard 拒绝 |
| `CORS_NOT_ENABLED` / `ORIGIN_REQUIRED` / `ORIGIN_NOT_ALLOWED` | 10004 / 10100 / 10004 | 403/400/403 | CORS 预检 |
| `RATE_LIMITED` | 10300 RATE_LIMIT_EXCEEDED | 429 | `@RateLimit` 未给 message 时 |
| `LOCK_NOT_ACQUIRED` | 10205 | 409 | `@Lock` 未拿到锁 |
| `INTERNAL_ERROR` | 4 | 500 | 未处理异常（含安全组件未配置等部署错误） |
| `SERVICE_UNAVAILABLE` | 3 | 503 | 停机中 / 并发已满 |
| `TIMEOUT` | 5 | 504 | 处理超时 |

## 3. 框架内建字段码（`neton.core.http.ValidationCode`）

| code | 触发 | params |
|---|---|---|
| `REQUIRED` | `@NotBlank` / `@NotNull`；必填 query/path/cookie/上传文件缺失 | — |
| `TOO_SHORT` / `TOO_LONG` | `@Size` 作用于字符串，长度越下限 / 上限 | `min`，`max`（`max` 缺省时不下发、不检查） |
| `TOO_FEW_ITEMS` / `TOO_MANY_ITEMS` | `@Size` 作用于集合/数组 | 同上 |
| `TOO_SMALL` | `@Min` | `min` |
| `TOO_LARGE` | `@Max` | `max` |
| `INVALID_FORMAT` | `@Pattern` | — |
| `INVALID_EMAIL` | `@Email` | — |
| `INVALID_JSON` | 请求体解析失败（`field = "$"`） | — |
| `INVALID_INTEGER` / `INVALID_NUMBER` / `INVALID_BOOLEAN` / `INVALID_VALUE` | query/path 参数存在但解析失败（Int/Long、Double/Float、Boolean、其他） | — |

## 4. 声明式校验与 `@RateLimit` 的 message

- 校验注解的 `message` 缺省为空 → 用 §3 的内建码。要给字段专属码时写**模块机器码**，例如
  `@Pattern(regex = "...", message = "INVALID_MOBILE")`；此时 `code` 与 `message` 都是 `INVALID_MOBILE`，
  约束值仍在 `params`（如 `@Size(min = 8, max = 64, message = "PASSWORD_LENGTH")`）。
- `@RateLimit(message = ...)` 原样成为 429 信封的 `message`（数字 code 固定 `10300`，不是 HTTP 码 429），
  缺省 `RATE_LIMITED`；`Retry-After` / `X-RateLimit-*` 头照常下发。
- 两者写了句子都会**编译失败**（KSP：`... is not a machine code`）。
- 约束注解**必须执行**：请求体 DTO 违反约束一律 400 `VALIDATION_FAILED`、handler 不执行；写在不会执行的位置编译失败（[参数绑定](./parameter-binding.md) §5.3 规则 6）。

## 5. 数字 code 段位

`0` 成功；`1-999` 系统；`100-199` 协议；`10000-10099` 认证；`10100-10199` 参数；`10200-10299` 资源；
`10300-10399` 限流；`20000+` 业务。HTTP status 由 `httpStatusForErrorCode` 推导，业务侧不设。

## 6. 模块规则

1. 每个模块维护自己的机器码目录 `<Module>ErrorCodes`（或在模块规范里列出），规范写在
   `spec/application/<module>-errors.md`（或模块规范的「错误码」一节）。
2. 抛错：`throw HttpException(NetonErrorCode.X, <Module>ErrorCodes.Y)`；字段：`ValidationError.of(path, <Module>ErrorCodes.Z)`。
   框架异常省略 message 时得到 §2 的标准码，允许但不推荐（客户端只能显示通用说明）。
3. 每个模块的 `macosArm64Test` 跑共享守卫 `contract.testing.ErrorMessageGuard`
   （neton-application-contract `src/testFixtures`）：扫描 `src/commonMain` 的异常/字段错误构造（含全限定与对象限定写法）
   和注解 message（`@RateLimit`、`@NotBlank`/`@Size`/`@Pattern`…），实参必须是机器码字面量或常量引用
   （`AccountErrorCodes.X`、`logic.AccountErrorCodes.X` 均可）。
4. 透传 helper（`fun bad(code: String) = throw BadRequestException(code)`）进 allowlist，并把 helper 名加进
   `constructors` 让守卫检查它的调用点。allowlist 键：`<相对 src/commonMain 的路径>#<构造器或 @注解>#<实参文本>`，
   例如 `kotlin/logic/FilterSupport.kt#HttpException#code`；每条写明理由。

## 7. 破坏性变更（客户端须适配）

相对旧行为（句子 message、约束名做 code）：

- 校验失败信封 `message`：`"Validation failed"` → `VALIDATION_FAILED`。
- 字段错误：`code` 由约束名（`NotBlank`/`Size`/`Pattern`/`Min`/`Email`）与绑定码（`Missing`/`Type`/`InvalidJson`）
  改为 §3 的机器码；`message` 由英文句子改为与 `code` 相同；新增可选 `params`。
- 请求体 JSON 解析失败：信封由 `10100 "Validation failed"` 改为 `10105 INVALID_JSON`（字段 `$` / `INVALID_JSON`）。
- `@RateLimit` 命中：信封 `code` 由 `429`（且曾被写成字符串 `"429"`）改为数字 `10300`，`message` 为模块码或 `RATE_LIMITED`，
  并补上 `"data": null`。
- 路由 404 / 405 / 401 / 403 / 500 / 413 / 408 / 503 / 504 的 `message` 全部改为 §2 的机器码；413/408 由纯文本改为 JSON 信封。
- 权限不足不再回显权限名（`"Permission denied: x:y"` → `PERMISSION_DENIED`）。
