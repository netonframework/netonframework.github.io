# Neton 参数绑定规范 v1（官方 API 规则）

> 约定优于配置、能推断则不写注解。目标：90% 场景零注解，仅歧义时保留 `@Header` / `@Cookie` / `@Path`。
>
> **v1 冻结**：Binding/Validation 对外行为已冻结（见 5.4、5.5），规范 + KSP 生成 + 契约测试三者一致；Missing/Type/InvalidJson、path 规则、List fail-fast 等均以契约测试回归保护。

---

## 一、总则

| 原则 | 说明 |
|------|------|
| **Convention > Annotation** | 能根据路径 / 方法 / 类型推断来源的，不要求写注解 |
| **最少注解** | 仅当「参数名与路径/Query 不一致」或「来源语义不明确」时使用注解 |
| **类型即契约** | 简单类型 + GET → Query；复杂类型 + 有 Body 的动词 → Body；路径占位符名 = 参数名 → Path |
| **兼容现有** | 现有 `@PathVariable` / `@QueryParam` / `@Body` 等保留，与约定推断并存，显式注解优先 |

---

## 二、参数来源自动推断规则

### 2.1 推断顺序（优先级从高到低）

1. **显式注解**：若参数带 `@PathVariable` / `@Query` / `@QueryParam` / `@Body` / `@FormParam` / `@Header` / `@Cookie`，按注解语义解析，**不**做约定推断。
2. **上下文类型注入**：若参数类型为 `HttpContext` / `HttpRequest` / `HttpResponse` / `HttpSession` / `Identity`，直接注入，不占「参数名 → 来源」规则。
3. **Path 匹配**：若路由 pattern 含 `{paramName}` 且方法参数名为 `paramName`，则从路径解析，等价于 `@PathVariable("paramName")`。
4. **Body 推断**：若 HTTP 方法为 POST / PUT / PATCH 且参数类型为**复杂类型**（data class / 非简单类型），则从请求体 JSON 反序列化，等价于 `@Body`。
5. **Query 推断**：若为 GET / HEAD / DELETE（或无 body 的请求）且参数为**简单类型**，则从 Query 解析，参数名即 query key，等价于 `@QueryParam(name)`。
6. **未匹配**：若以上均不命中，可报「无法推断参数来源」或回退到按参数名尝试 Query（由实现决定，建议明确报错便于排查）。

### 2.2 简单类型 vs 复杂类型

- **简单类型**：`String`, `Int`, `Long`, `Boolean`, `Double`, `Float` 及其可空形式；用于 Path / Query / Header / Cookie / Form。
- **复杂类型**：带 `@Serializable` 的 data class 或框架约定可反序列化的类型；用于 Body。
- **集合**：`List&lt;T&gt;`, `Array&lt;T&gt;` 等见第七节。

### 2.3 路径参数（Path）

- **约定**：路由中存在 `{userId}` 且方法参数名为 `userId` → 自动从 path 解析，无需注解。
- **显式**：当路径占位符与参数名不一致时使用 `@PathVariable("id") userId: Long`。
- **建议**：保留 `@PathVariable`，可选别名 `@Path`（与 `@PathVariable(value)` 等价），便于「名不一致」场景。

```kotlin
// 推荐：约定
@Get("/users/{userId}")
fun get(userId: Long): User

// 显式：名不一致
@Get("/users/{id}")
fun get(@PathVariable("id") userId: Long): User
```

### 2.4 查询参数（Query）

- **约定**：GET（及无 body 的请求）+ 简单类型参数 → 从 Query 解析，参数名即 query key。
- **显式**：需与 query key 名不一致时使用 `@QueryParam("q") keyword: String` 或建议的短名 `@Query("q") keyword: String`。
- **命名建议**：注解名优先采用 `@Query`（现代风格），保留 `@QueryParam` 兼容。

```kotlin
// 推荐：约定
@Get("/search")
fun search(keyword: String, page: Int = 1, size: Int = 10): SearchResult

// 显式：key 与参数名不同
@Get("/search")
fun search(@Query("q") keyword: String): Result
```

### 2.5 请求体（Body）

- **约定**：POST / PUT / PATCH + 复杂类型（如 `BindingUserRequest`）→ 自动从 body JSON 反序列化，无需 `@Body`。
- **显式**：多个 body 或与约定冲突时使用 `@Body request: BindingUserRequest`。
- **类型要求**：Body 类型须为 `@Serializable` 或框架支持的反序列化类型。

```kotlin
// 推荐：约定
@Post("/json")
fun create(req: BindingUserRequest): String

// 显式：保留
@Post("/json")
fun create(@Body request: BindingUserRequest): String
```

### 2.6 请求头（Header）与 Cookie

- **不自动推断**：Header / Cookie 名称与参数名无稳定约定，**必须**显式注解。
- **保留**：`@Header("User-Agent") ua: String`、`@Cookie("sessionId") sid: String?`。
- **可选默认值**：`@Header("Accept-Language") lang: String = "en"`。

### 2.7 上下文与主体注入

- **按类型注入**，不占「参数名 → 来源」：
  - `HttpContext` / `context: HttpContext` → 当前请求上下文
  - 可选别名：支持 `ctx: Ctx` 或 `c: Ctx`（类型别名指向 `HttpContext`）以提升人体工程学
  - `HttpRequest` / `HttpResponse` / `HttpSession` → 请求 / 响应 / 会话
  - `Identity`（或 `@CurrentUser`）→ 当前认证用户
- 这些参数**不需要**任何注解。

### 2.8 歧义硬规则（避免用户猜框架）

以下规则写死，实现不得偏离：

| 歧义场景 | 规则 | 实现建议 |
|----------|------|----------|
| **A. Path 与 Query 同名** | 如路由 `/users/{id}`，请求 `/users/1?id=2`，方法 `fun get(id: Long)` → **Path 优先**，Query 中的 `id` 被忽略 | Debug 模式可打印 `"query ignored due to path match"` |
| **B. 多个复杂类型参数** | **默认禁止**多个 Body 参数。若出现 2 个及以上复杂类型且均无显式注解 → **400**，错误信息：`"需要 @Body / @Query / @FormParam 显式标注参数来源"` | 不允许多 Body 的隐式推断，避免「解析到 A 还是 B」的困惑 |
| **C. POST/PUT/PATCH 的简单类型** | 默认从 **Query** 解析（典型：`POST /login?redirect=...`、`POST /users?dryRun=true`）；仅显式 `@FormParam` 才走表单；`@Header` / `@Cookie` 才走头/Cookie | 按 Content-Type 区分：`application/x-www-form-urlencoded` 时，无注解简单类型可约定走 Form（见第三节矩阵） |

---

## 三、Content-Type 与 Body 解析矩阵（标准）

规范必须明确 Body 解析与 Content-Type 的对应关系，避免实现分叉：

| Content-Type | 解析行为 | 失败时 |
|--------------|----------|--------|
| `application/json` | JSON 反序列化（kotlinx.serialization） | 400 |
| `application/x-www-form-urlencoded` | Form map，支持 `@FormParam`；可选支持「复杂类型 form bind」 | 400 |
| `multipart/form-data` | `HttpRequest.uploadFiles()` 解析文件部分，返回 `UploadFiles`；控制器参数类型为 `UploadFile`、`List&lt;UploadFile&gt;` 或 `UploadFiles` 时按 fieldName 自动绑定 | 400 |
| 其他 | 不解析 Body，复杂类型参数缺失 → 400 | 415 Unsupported Media Type |

- **415**：标准 HTTP「不支持的媒体类型」，便于客户端与网关正确识别。
- 实现应在此矩阵内统一行为，不得引入未定义分支。

---

## 四、注解保留列表（精简）

| 场景 | 推荐注解 | 说明 |
|------|----------|------|
| 路径名与参数名一致 | 无 | 约定推断 |
| 路径名与参数名不一致 | `@PathVariable("id")` 或 `@Path("id")` | 二选一，建议保留 PathVariable 兼容 |
| Query key 与参数名一致 | 无 | 约定推断 |
| Query key 与参数名不一致 | `@Query("q")` 或 `@QueryParam("q")` | 建议新增 `@Query` 短名 |
| Body（单参数复杂类型） | 无 | 约定推断 |
| Body（多 body / 歧义） | `@Body` | 显式 |
| 表单字段 | `@FormParam("name")` | 显式 |
| 请求头 | `@Header("X-Name")` | 必须显式 |
| Cookie | `@Cookie("name")` | 必须显式 |
| 当前用户 | 无（类型 `Identity`）或 `@CurrentUser` | 按类型注入 |

**结论**：日常仅需记 3 类——`@Path`/`@PathVariable`、`@Query`/`@QueryParam`、`@Header` / `@Cookie`；其余靠约定。

---

## 五、类型转换规则

- **Path / Query / Header / Cookie / Form**：字符串 → 目标简单类型（Int、Long、Boolean、Double 等）。
  - 失败时：返回 **400 Bad Request**，body 可包含字段级错误（见 5.1）。
- **Body**：JSON 字符串 → `@Serializable` 或框架支持的类型；失败 → 400。
- **可空**：`String?` / `Int?` 等，缺失或空字符串可解析为 `null`；非可空类型缺失时建议 400。

### 5.1 错误响应约定（必做）

- **400**：参数缺失（非可空）、类型转换失败、反序列化失败。
- **404**：路径不匹配（路由层）。
- **401/403**：认证/授权（Security 层）。
- **415**：Content-Type 不支持（见第三节矩阵）。

**400 统一格式**（支持多字段错误，v1.0.2 起统一用 path）：
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    { "path": "userId", "message": "required or invalid format", "code": null },
    { "path": "email", "message": "invalid email", "code": "Email" }
  ]
}
```
- 单字段错误时 `errors` 可只含一个元素；`path`、`message`、`code`（可选）由实现定义，但结构保持一致。

### 5.2 必做项清单（实现不得省略）

| 项 | 规则 | 说明 |
|----|------|------|
| **Boolean 宽松解析** | `true`/`false`/`1`/`0`/`on`/`off`（大小写不敏感）→ `Boolean` | 常见表单/Query 习惯 |
| **Enum 支持** | `Enum.valueOf`，可选忽略大小写 | 路由/状态等常用 |
| **空字符串策略** | `?age=` 对 `Int?` → `null`；对 `Int`（非可空）→ **400** | 明确缺失 vs 空值 |
| **多字段错误** | 400 时使用 `errors: [{ path, message }]` 数组（v1.0.2 起统一为 path） | 见 5.1 |

### 5.3 校验注解行为（v1 冻结）

以下两条为官方冻结规则，实现与生成器不得偏离。

**规则 4：@NotBlank 与可空 String**

- `@NotBlank` 只对 `String` / `String?` 生效。
- 语义：**NotBlank = 视为无效的既有 null 也有空白**。
  - 若字段类型为 `String?`：`null` 视为 invalid，`""` / `"   "`（isBlank）也视为 invalid。
  - 若字段类型为 `String`：仅 `isBlank()` 为 invalid。
- 生成逻辑：`String?` 时生成 `if (x == null || x.isBlank()) errors += ...`；`String` 时生成 `if (x.isBlank()) errors += ...`。
- 若需「允许 null 但不允许空串」：不加 `@NotBlank`，在业务逻辑中判断；v1 不提供 `@BlankOrNull`。

**规则 5：@Min/@Max 与类型转换/溢出**

- **Body DTO（JSON）**：字段类型已由编译期确定，JSON 反序列化失败（类型不符、格式错误）→ 统一 **400 Bad Request**，errors 含 `path = "$"`、`code = "InvalidJson"`、`message = "Invalid JSON body"`；由生成代码 try/catch 收口。
- **Query / Path / Header（字符串→类型）**：转换失败（含溢出、非数字等）→ **ValidationException**，统一 400 + errors。**缺失必填参数** → `code = "Missing"`、`message = "is required"`；**存在但解析失败** → `code = "Type"`，Int/Long 用 `message = "must be a valid integer"`，Double/Float 用 `message = "must be a valid number"`。

### 5.4 必填/可缺省判定规则（v1 冻结）

- **nullable**（如 `String?`、`Int?`）→ 可缺省，缺失不报错，解析为 null。
- **hasDefault**（如 `page: Int = 1`）→ 可缺省，缺失使用默认值。**default 仅在参数缺失时生效，不会吞掉类型错误。**
- **其它**（非可空且无默认值）→ **必填**：缺失 → 400，`code = "Missing"`；存在但类型转换失败 → 400，`code = "Type"`。**存在但为空字符串视为 Type 错误（非 Missing）。**
- 生成器按上述规则生成「先判缺失再解析」的逻辑，后续扩展（List、多值参数）同此约定。
- **path 使用“实际来源名”**：`@Query("q")` / `@PathVariable("id")` 等显式注解时，errors 的 `path` 使用注解 value（如 `"q"`、`"id"`），与客户端可见的 key 一致；无注解时使用参数名。
- **List 多值（v1）**：`List&lt;Int&gt;` / `List&lt;Long&gt;` 等，任一元素解析失败 → 整参报错：`path = 参数名`、`code = "Type"`、message 同单值（如 "must be a valid integer"）。深层 path（如 `ids[1]`）留待 v2。
- **List 输入格式（v1 冻结）**：多值仅支持**重复 key**（如 `?ids=1&ids=2&ids=3`），不支持逗号分隔（如 `ids=1,2,3`），避免歧义。
- **集合类型（v1）**：v1 支持 `List&lt;T&gt;`（推荐）；Array / PrimitiveArray 留待 v2 再考虑（或等价于 List 的绑定语义）。

### 5.5 Binding/Validation v1 冻结契约声明

以下为 **v1 冻结** 的对外行为，breaking change 须升版并显式说明。

- **code 语义**：`Missing`（必填缺失）、`Type`（存在但解析失败/类型不符）、`InvalidJson`（Body JSON 解码失败）。
- **path 规则**：取实际来源名（注解 value 或参数名）；JSON 解码失败固定 `path = "$"`。
- **message 稳定**：`"is required"` / `"must be a valid integer"` / `"must be a valid number"` / `"Invalid JSON body"` / `"must not be blank"` 等见 5.3、5.4。
- **必填/可缺省**：nullable 或 hasDefault → 可缺省；否则必填。
- **NotBlank nullable**：可空字段 `null` 或 blank 时按 @NotBlank 规则报错，code=`NotBlank`。
- **List/Array fail-fast**：List/Array 参数的元素解析失败必须 **fail-fast** 抛 ValidationException，**禁止丢弃无效元素**（禁止 mapNotNull 等静默过滤）。

契约测试位于 **neton-http commonTest**（`ValidationBindingContractTest`），不依赖平台实现；CI 至少跑一个 target（如 `macosArm64Test`）即可回归。

---

## 六、ParamConverter SPI（扩展点，必做）

真实业务会需要：UUID、LocalDate/Instant、Enum、自定义 value object（如 `UserId`）。规范必须提供可插拔转换器。

### 6.1 接口定义

```kotlin
interface ParamConverter<T> {
    fun convert(value: String): T?
}
```

- 返回 `null` 表示无法转换，框架继续尝试其他转换器或返回 400。

### 6.2 注册入口

- `NetonContext.bind(ParamConverterRegistry, ...)` 或
- 独立 `ConvertersComponent`，在 `init` 内 `ctx.bind(ConverterRegistry(...))`。

### 6.3 解析优先级

1. **内置转换器**（String、Int、Long、Boolean、Double、Float、Enum 等）
2. **用户注册转换器**（按注册顺序或类型匹配）
3. **无法解析** → 400

- 用户转换器可覆盖内置（如为 `UUID` 注册专用转换器），具体覆盖策略由实现定义。

---

## 七、List / Array 支持（必做）

- **Query 多值**：`?tags=kotlin&tags=web&tags=framework` → `tags: List&lt;String&gt;`。
- **实现要点**：底层解析为 `Map&lt;String, List&lt;String&gt;&gt;`（或等价），对 `List&lt;T&gt;` / `Array&lt;T&gt;` 做元素级类型转换。
- **约定**：无注解时，若参数类型为 `List<简单类型>` 或 `Array<简单类型>` 且为 GET（或无 body），则从 Query 解析，参数名即 key；同一 key 多次出现聚合成 List。
- **显式**：与 key 名不一致时可用 `@Query("tags") tags: List&lt;String&gt;`。

```kotlin
@Get("/filters")
fun filters(tags: List<String>, ids: List<Int>?): String
```

---

## 八、返回类型与响应体

- **建议**：支持直接返回对象/列表，由框架自动 JSON 序列化（如 `content-type: application/json`）。
  - `fun getUser(): User`、`fun list(): List&lt;User&gt;` → 自动序列化为 JSON。
- **现有**：返回 `String` 仍按纯文本响应；返回类型为 `Unit` 时可由实现决定 204 或 200 空 body。
- **一致性**：与「Body 自动推断」一起，形成「入参少注解 + 出参少样板」的 Laravel/FastAPI 风格。

---

## 九、命名与别名建议（实现可选）

| 当前 | 建议 | 说明 |
|------|------|------|
| `@QueryParam` | 保留，新增 `@Query` | 短名，现代风格 |
| `@PathVariable` | 保留，可选 `@Path` | 仅当名不一致时用 |
| `HttpContext` 参数 | 支持类型别名 `Ctx` | 如 `ctx: Ctx`，更短 |

---

## 十、与现有实现的对应关系

- **KSP 生成**：当前按「显式注解」生成 `args["key"]` 或 `Json.decodeFromString(Type.serializer(), ...)`。规范落地时需增加「约定推断」分支：无注解时根据「路径占位符集合 + 方法 + 参数类型」决定 path/query/body，再生成对应取值代码。
- **ParameterResolver**：运行时若已用 `ParameterResolverRegistry`，可增加 ConventionResolver（优先级低于显式注解），按参数名 + 类型 + 路由元数据解析 path/query/body；List 支持在 Query 解析层扩展。
- **neton-core 注解**：`@PathVariable`、`@QueryParam`、`@Body`、`@Header`、`@Cookie`、`@FormParam` 保留；新增 `@Query`、可选 `@Path` 与 `Ctx` 类型别名即可，不破坏现有代码。

### 10.1 性能约束（实现准则）

**约定推断应优先在编译期（KSP）完成；运行期 Resolver 仅作为 fallback。**

| 原则 | 说明 |
|------|------|
| **编译期优先** | Kotlin/Native 反射代价高；运行期参数名/类型判断增加每次请求开销。KSP 可直接生成 `val id = ctx.pathLong("id")` 等零分支代码。 |
| **热路径优化** | 生成代码在 hot path 上**避免 Map 查两次**（query map、path map 只取一次并复用）。 |
| **List 解析前置** | 多值 Query 在 request parse 阶段即结构化为 `Map&lt;String, List&lt;String&gt;&gt;`，避免重复解析。 |

---

## 十一、总结表（理想形态对照）

| 维度 | 当前 | 规范目标 |
|------|------|----------|
| 易用性 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 注解数量 | 6 类常写 | 多数场景 0，歧义时 1～3 |
| 学习成本 | 记 6 个注解 | 记约定 + 3 个注解 |
| 风格 | 重注解 | 约定 + 少注解 |
| List/Array | 未开放 | Query 多值必做 |
| 歧义规则 | 未定义 | Path 优先、多 Body 禁止、POST 简单类型走 Query |
| Content-Type | 隐式 | 矩阵标准化，415 明确 |
| 性能 | 运行期解析 | 编译期 KSP 优先，热路径零分支 |
| 扩展 | 内置类型 | ParamConverter SPI（UUID、LocalDate 等） |

**一句话**：设计已到 90 分，剩下 10 分做「减法优化」——能推断则不写注解，仅保留 `@Path`/`@Query`/`@Header`/`@Cookie` 等少量显式能力，并固化上述规则为官方 API 规范，便于实现与文档统一。
