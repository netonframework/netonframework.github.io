# 参数绑定

本章介绍 Neton 的参数绑定机制。Neton 遵循"约定优于配置"原则，在 90% 的场景下无需任何注解即可完成参数绑定。

## 设计原则

Neton 的参数绑定基于以下设计理念：

- **约定优于配置** -- Path、Query、Body 参数在大多数场景下可以自动推断，无需显式注解
- **显式优于隐式** -- Header、Cookie、Form 等非常规来源需要使用注解显式标注
- **类型安全** -- 所有参数绑定在编译期由 KSP 生成代码，运行时零反射
- **可选友好** -- 通过 Kotlin 的可空类型和默认值自然表达参数的可选性

## 自动推断规则

KSP 根据以下优先级自动推断参数的绑定来源：

| 优先级 | 条件 | 绑定来源 |
|--------|------|---------|
| 1 | 参数名与路由路径中的 `{placeholder}` 匹配 | **路径参数 (Path)** |
| 2 | HTTP 方法为 GET + 参数为简单类型（`String`、`Int`、`Long`、`Boolean` 等） | **查询参数 (Query)** |
| 3 | HTTP 方法为 POST / PUT / PATCH + 参数为复杂类型（`@Serializable` data class） | **请求体 (Body)** |
| 4 | 参数类型为 `HttpContext`、`HttpRequest`、`HttpResponse`、`Ctx` | **上下文注入** |

不满足以上条件的参数，需要使用显式注解（如 `@Header`、`@Cookie`、`@FormParam`）。

## 路径参数 (Path)

当参数名称与路由路径中的占位符 `{...}` 匹配时，自动绑定为路径参数。无需注解。

```kotlin
@Controller("/api/binding")
class ParameterBindingController {

    @Get("/users/{userId}")
    fun pathParam(userId: Int) =
        "路径参数 userId: $userId"
}
```

请求示例：

```bash
curl http://localhost:8080/api/binding/users/42
# 输出: 路径参数 userId: 42
```

路径参数会自动进行类型转换：`String` -> `Int`、`Long`、`Boolean` 等。

如果参数名与占位符名不同，可以使用 `@PathVariable` 显式指定：

```kotlin
@Get("/user/{id}")
fun getUser(@PathVariable("id") userId: Int): String {
    return "User ID: $userId"
}
```

## 查询参数 (Query)

对于 GET 请求，简单类型的参数自动绑定为查询参数。无需注解。

```kotlin
@Controller("/api/binding")
class ParameterBindingController {

    @Get("/search")
    fun search(keyword: String, page: Int = 1, size: Int = 10) =
        "查询参数 - keyword: '$keyword', page: $page, size: $size"
}
```

请求示例：

```bash
curl "http://localhost:8080/api/binding/search?keyword=neton&page=2&size=20"
# 输出: 查询参数 - keyword: 'neton', page: 2, size: 20

# 使用默认值
curl "http://localhost:8080/api/binding/search?keyword=neton"
# 输出: 查询参数 - keyword: 'neton', page: 1, size: 10
```

### List 多值参数

查询参数支持多值绑定，适用于 `?tags=a&tags=b` 这样的场景：

```kotlin
@Controller("/api/binding")
class ParameterBindingController {

    @Get("/filters")
    fun filters(tags: List<String>, ids: List<Int>?) =
        "tags: ${tags.joinToString(", ")}, ids: ${ids?.joinToString(", ") ?: "null"}"
}
```

请求示例：

```bash
curl "http://localhost:8080/api/binding/filters?tags=kotlin&tags=native&ids=1&ids=2"
# 输出: tags: kotlin, native, ids: 1, 2

curl "http://localhost:8080/api/binding/filters?tags=kotlin"
# 输出: tags: kotlin, ids: null
```

## 请求体 (Body)

对于 POST / PUT / PATCH 请求，复杂类型（`@Serializable` data class）自动绑定为请求体。无需注解。

```kotlin
@Serializable
data class BindingUserRequest(
    val name: String,
    val email: String,
    val age: Int? = null
)

@Controller("/api/binding")
class ParameterBindingController {

    @Post("/json")
    fun create(req: BindingUserRequest) =
        "请求体 - name: '${req.name}', email: '${req.email}', age: ${req.age}"
}
```

请求示例：

```bash
curl -X POST http://localhost:8080/api/binding/json \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@example.com","age":28}'
# 输出: 请求体 - name: 'Alice', email: 'alice@example.com', age: 28
```

::: warning 注意
请求体绑定要求 data class 添加 `@Serializable` 注解（来自 `kotlinx.serialization`），Neton 使用 JSON 格式进行反序列化。
:::

如果需要显式标注请求体参数，可以使用 `@Body` 注解：

```kotlin
@Post("/user")
fun createUser(@Body user: CreateUserRequest): String {
    return "Created: ${user.name}, ${user.email}"
}
```

## 表单参数 (Form)

表单参数需要使用 `@FormParam` 注解显式标注：

```kotlin
@Controller("/api/binding")
class ParameterBindingController {

    @Post("/form")
    fun formParam(
        @FormParam("username") username: String,
        @FormParam("email") email: String,
        @FormParam("age") age: Int?
    ): String {
        return "表单参数 - username: '$username', email: '$email', age: $age"
    }
}
```

请求示例：

```bash
curl -X POST http://localhost:8080/api/binding/form \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=alice&email=alice@example.com&age=28"
# 输出: 表单参数 - username: 'alice', email: 'alice@example.com', age: 28
```

## 文件上传 (Multipart)

控制器参数类型为 `UploadFile`、`List<UploadFile>` 或 `UploadFiles` 时自动绑定 multipart 文件。绑定基于 **fieldName 匹配参数名**。

### 单文件上传

参数名对应表单中的 field name：

```kotlin
@Controller("/api/files")
class FileController {

    @Post("/avatar")
    suspend fun uploadAvatar(avatar: UploadFile): Map<String, Any> {
        val bytes = avatar.bytes()
        return mapOf(
            "filename" to avatar.filename,
            "contentType" to (avatar.contentType ?: "unknown"),
            "size" to avatar.size
        )
    }
}
```

```bash
curl -X POST http://localhost:8080/api/files/avatar \
  -F "avatar=@photo.jpg"
# 输出: {"filename":"photo.jpg","contentType":"image/jpeg","size":12345}
```

### 多文件上传

同一 fieldName 的多个文件绑定为 `List<UploadFile>`：

```kotlin
@Post("/photos")
suspend fun uploadPhotos(photos: List<UploadFile>): Map<String, Any> {
    return mapOf("count" to photos.size, "names" to photos.map { it.filename })
}
```

```bash
curl -X POST http://localhost:8080/api/files/photos \
  -F "photos=@a.jpg" -F "photos=@b.jpg"
```

### UploadFiles 结构化视图

当需要处理多个不同 fieldName 的文件时，使用 `UploadFiles`：

```kotlin
@Post("/mixed")
suspend fun mixedUpload(files: UploadFiles): Map<String, Any> {
    val avatar = files.require("avatar")       // 必需，缺失抛 400
    val gallery = files.get("gallery")         // 按 fieldName 过滤
    val all = files.all()                      // 所有文件
    return mapOf(
        "avatar" to avatar.filename,
        "galleryCount" to gallery.size,
        "totalCount" to all.size
    )
}
```

### 绑定规则

| 参数类型 | 绑定行为 |
|----------|----------|
| `avatar: UploadFile` | 匹配 fieldName == "avatar"，缺失时抛 400 |
| `avatar: UploadFile?` | 匹配 fieldName == "avatar"，缺失时为 null |
| `photos: List<UploadFile>` | 匹配 fieldName == "photos" 的所有文件，无匹配时空列表 |
| `files: UploadFiles` | 注入完整的结构化视图，包含所有文件 |

## 请求头 (Header)

请求头参数需要使用 `@Header` 注解显式标注：

```kotlin
@Controller("/api/binding")
class ParameterBindingController {

    @Get("/headers")
    fun headerParam(
        @Header("User-Agent") userAgent: String,
        @Header("Accept-Language") language: String = "en",
        @Header("X-Custom-Header") customHeader: String?
    ): String {
        return "请求头 - User-Agent: '$userAgent', Language: '$language', Custom: '$customHeader'"
    }
}
```

请求示例：

```bash
curl http://localhost:8080/api/binding/headers \
  -H "Accept-Language: zh-CN" \
  -H "X-Custom-Header: my-value"
# 输出: 请求头 - User-Agent: 'curl/8.x', Language: 'zh-CN', Custom: 'my-value'
```

## Cookie 参数

Cookie 参数需要使用 `@Cookie` 注解显式标注：

```kotlin
@Controller("/api/binding")
class ParameterBindingController {

    @Get("/cookies")
    fun cookieParam(
        @Cookie("sessionId") sessionId: String?,
        @Cookie("theme") theme: String = "light"
    ): String {
        return "Cookie - sessionId: '$sessionId', theme: '$theme'"
    }
}
```

请求示例：

```bash
curl http://localhost:8080/api/binding/cookies \
  -b "sessionId=abc123;theme=dark"
# 输出: Cookie - sessionId: 'abc123', theme: 'dark'
```

## 上下文注入

控制器方法可以直接声明以下类型的参数，框架会自动注入对应的上下文对象：

| 参数类型 | 说明 |
|---------|------|
| `HttpContext` | 完整的 HTTP 上下文，包含请求、响应、Session 等 |
| `HttpRequest` | HTTP 请求对象，包含方法、路径、头部等 |
| `HttpResponse` | HTTP 响应对象，用于设置状态码、头部等 |
| `HttpSession` | HTTP 会话对象 |
| `Ctx` | `HttpContext` 的类型别名，简写形式 |
| `Identity` | 当前认证用户（自动注入，等价于 `@CurrentUser`） |

```kotlin
@Put("/complex/{resourceId}")
fun complex(
    resourceId: String,
    version: Int = 1,
    @Header("Authorization") auth: String?,
    @FormParam("action") action: String,
    ctx: Ctx
) = "resourceId: $resourceId, version: $version, ctx: ${ctx::class.simpleName}"
```

上面的示例展示了多种绑定来源的混合使用：

- `resourceId` -- 路径参数（自动推断）
- `version` -- 查询参数（自动推断，有默认值）
- `auth` -- 请求头（显式注解）
- `action` -- 表单参数（显式注解）
- `ctx` -- 上下文注入（自动）

## 可选参数与默认值

Neton 通过 Kotlin 的语言特性自然地支持可选参数：

### 可空类型

使用 `?` 标记参数为可选，未提供时值为 `null`：

```kotlin
@Get("/optional")
fun optional(
    required: String,
    optional: String?,
    @Header("X-Optional") header: String? = null
) = "required: '$required', optional: '$optional', header: '${header ?: "default"}'"
```

### 默认值

使用 Kotlin 默认参数值，未提供时使用默认值：

```kotlin
@Get("/search")
fun search(keyword: String, page: Int = 1, size: Int = 10) =
    "keyword: '$keyword', page: $page, size: $size"
```

### 规则总结

| 声明方式 | 行为 |
|---------|------|
| `param: String` | 必需参数，缺失时返回 400 错误 |
| `param: String?` | 可选参数，缺失时为 `null` |
| `param: String = "default"` | 带默认值的参数，缺失时使用默认值 |
| `param: String? = null` | 可选参数（带显式默认值） |

## 绑定注解速查表

| 注解 | 参数来源 | 是否必需 | 示例 |
|------|---------|---------|------|
| _(无注解)_ | 自动推断 (Path/Query/Body) | -- | `fun get(id: Int)` |
| `@PathVariable("name")` | URL 路径段 | 当参数名与占位符不同时 | `@PathVariable("id") userId: Int` |
| `@Body` | 请求体 (JSON) | 当需要显式标注时 | `@Body user: UserRequest` |
| `@FormParam("name")` | 表单字段 | 是 | `@FormParam("username") name: String` |
| `@Header("name")` | HTTP 请求头 | 是 | `@Header("User-Agent") ua: String` |
| `@Cookie("name")` | Cookie 值 | 是 | `@Cookie("sessionId") sid: String?` |
| `UploadFile` | Multipart 文件（按 fieldName 匹配） | 否（类型自动识别） | `avatar: UploadFile` |
| `List<UploadFile>` | 同名 Multipart 文件列表 | 否（类型自动识别） | `photos: List<UploadFile>` |
| `UploadFiles` | 全部 Multipart 文件结构化视图 | 否（类型自动识别） | `files: UploadFiles` |
| `@CurrentUser` | 认证用户 | 可选（Identity 类型自动注入） | `@CurrentUser identity: Identity?` |

## 进一步阅读

- [路由与控制器](./routing.md) -- 控制器定义与路由组配置
- [安全指南](./security.md) -- @CurrentUser 与 Identity 认证体系
- [参数绑定规范 v1](/spec/parameter-binding) -- 参数绑定的设计规范与冻结定义
