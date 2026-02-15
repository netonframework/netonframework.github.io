# 路由与控制器

本章介绍 Neton 的路由系统，包括 Controller 注解路由、HTTP 方法注解、路由组与挂载、以及 DSL 路由。

## 基本概念

Neton 提供两种方式定义路由：

1. **注解路由**（推荐） -- 使用 `@Controller` + HTTP 方法注解，配合 KSP 在编译期自动生成路由代码
2. **DSL 路由** -- 在 `routing { }` 块中使用 DSL 语法手动注册路由，适合简单场景

## 注解路由

### 基础控制器

使用 `@Controller` 注解定义控制器类，指定基础路径。使用 `@Get`、`@Post` 等注解标记处理方法：

```kotlin
@Controller("/simple")
class SimpleController {
    @Get("/hello")
    fun hello(): String {
        return "Hello from SimpleController!"
    }
    
    @Get("/user/{id}")
    fun getUser(@PathVariable("id") userId: Int): String {
        return "User ID: $userId"
    }
    
    @Post("/user")
    fun createUser(@Body user: CreateUserRequest): String {
        return "Created: ${user.name}, ${user.email}"
    }
}
```

在上面的示例中：

- `@Controller("/simple")` 定义了控制器的基础路径为 `/simple`
- `@Get("/hello")` 注册 `GET /simple/hello` 路由
- `@Get("/user/{id}")` 注册带路径参数的路由，`{id}` 是路径占位符
- `@Post("/user")` 注册 `POST /simple/user` 路由，`@Body` 表示从请求体反序列化参数

请求体数据类需要添加 `@Serializable` 注解：

```kotlin
@Serializable
data class CreateUserRequest(
    val name: String,
    val email: String,
    val age: Int? = null
)
```

### 多路径参数

控制器方法可以接收多个路径参数：

```kotlin
@Controller("/simple")
class SimpleController {
    @Get("/user/{userId}/post/{postId}")
    fun getUserPost(
        @PathVariable("userId") userId: Int,
        @PathVariable("postId") postId: Int
    ): String {
        return "用户 $userId 的帖子 $postId"
    }
}
```

### 上下文对象注入

控制器方法可以直接注入框架提供的上下文对象，无需注解：

```kotlin
@Controller("/simple")
class SimpleController {
    @Get("/request-info")
    fun getRequestInfo(request: HttpRequest): String {
        return "请求方法: ${request.method}, 路径: ${request.path}"
    }
}
```

支持自动注入的类型包括 `HttpContext`、`HttpRequest`、`HttpResponse`。

### 认证用户注入

使用 `@CurrentUser` 注解或直接声明 `Identity` 类型参数注入当前认证用户信息：

```kotlin
@Controller("/simple")
class SimpleController {
    @Get("/profile")
    @RequireAuth
    fun getProfile(@CurrentUser identity: Identity): String {
        return "当前用户: ${identity.id}, 角色: ${identity.roles}"
    }

    @Get("/visitor")
    @AllowAnonymous
    fun visitor(identity: Identity?): String {
        // Identity 类型自动注入，无需 @CurrentUser
        return identity?.id ?: "未认证用户"
    }
}
```

## HTTP 方法注解

Neton 支持所有标准 HTTP 方法，每种方法对应一个注解：

| 注解 | HTTP 方法 | 典型用途 |
|------|----------|---------|
| `@Get` | GET | 查询资源 |
| `@Post` | POST | 创建资源 |
| `@Put` | PUT | 完整更新资源 |
| `@Patch` | PATCH | 部分更新资源 |
| `@Delete` | DELETE | 删除资源 |
| `@Head` | HEAD | 获取资源元信息（不返回实体） |
| `@Options` | OPTIONS | 获取资源支持的方法 |

以下是一个完整的 RESTful API 控制器示例：

```kotlin
@Controller("/api/products")
class HttpMethodController {

    @Get("/")
    fun getProducts(): String {
        return "GET /api/products - 获取所有产品列表"
    }

    @Get("/{id}")
    fun getProduct(): String {
        return "GET /api/products/{id} - 获取指定产品详情"
    }

    @Post("/")
    fun createProduct(): String {
        return "POST /api/products - 创建新产品"
    }

    @Put("/{id}")
    fun updateProduct(): String {
        return "PUT /api/products/{id} - 完整更新产品信息"
    }

    @Patch("/{id}")
    fun patchProduct(): String {
        return "PATCH /api/products/{id} - 部分更新产品信息"
    }

    @Delete("/{id}")
    fun deleteProduct(): String {
        return "DELETE /api/products/{id} - 删除指定产品"
    }

    @Head("/{id}")
    fun headProduct(): String {
        return "HEAD /api/products/{id} - 获取产品元信息"
    }

    @Options("/")
    fun optionsProducts(): String {
        return "OPTIONS /api/products - 支持的方法: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS"
    }
}
```

## 路由组与挂载

路由组用于将控制器按照业务模块进行分组，并为每组分配 URL 前缀。

### 配置路由组

在 `config/routing.conf` 中定义路由组：

```toml
[[groups]]
name = "admin"
mount = "/admin"
requireAuth = true
allowAnonymous = ["/login", "/register"]

[[groups]]
name = "app"
mount = "/app"
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | String | 路由组名称 |
| `mount` | String | URL 前缀 |
| `requireAuth` | Boolean | 该组是否默认要求认证（默认 false） |
| `allowAnonymous` | List&lt;String&gt; | 白名单路径，即使 requireAuth=true 也允许匿名（默认空） |

### 目录约定

路由组与控制器的包路径存在对应关系。KSP 根据控制器所在的包名自动识别其所属路由组：

```
controller/
├── HomeController.kt           # 默认组，路由: /
├── SimpleController.kt         # 默认组，路由: /simple/...
├── admin/
│   ├── IndexController.kt      # admin 组，路由: /admin/index/...
│   └── AdminHomeController.kt  # admin 组，路由: /admin/...
└── app/
    └── IndexController.kt      # app 组，路由: /app/index/...
```

例如，以下控制器位于 `controller.admin` 包下：

```kotlin
package controller.admin

@Controller("/index")
@RequireAuth
class AdminIndexController {

    @Get("")
    suspend fun index(): String = "admin ok"

    @Get("/public")
    @AllowAnonymous
    suspend fun public(): String = "admin public (allow anonymous)"

    @Get("/dashboard")
    suspend fun dashboard(): String = "admin dashboard"
}
```

由于 `admin` 组的 `mount` 配置为 `/admin`，该控制器的最终路由为：

- `GET /admin/index` -- 需要认证
- `GET /admin/index/public` -- 允许匿名访问
- `GET /admin/index/dashboard` -- 需要认证

### 安全注解

路由组中的控制器可以使用安全注解控制访问权限：

- `@RequireAuth` -- 标记在类或方法上，要求认证
- `@AllowAnonymous` -- 标记在类或方法上，覆盖认证要求，允许匿名访问（优先级最高）
- `@Permission("system:user:edit")` -- 标记在类或方法上，要求指定权限
- `@CurrentUser` -- 标记在方法参数上，注入当前 Identity（Identity 类型参数可省略此注解）

### 模块化路由组

对于更复杂的项目，可以按业务模块组织控制器：

```
module/
└── payment/
    └── controller/
        ├── IndexController.kt          # 默认组: /payment/index
        └── admin/
            └── IndexController.kt      # admin 组: /admin/payment/index
```

## DSL 路由

对于不使用 KSP 的简单项目，可以在 `routing { }` 块中使用 DSL 语法直接定义路由：

```kotlin
fun main(args: Array<String>) {
    Neton.run(args) {
        http {
            port = 8080
        }
        routing {
            get("/") {
                "Hello Neton!"
            }

            get("/users") {
                "用户列表"
            }

            post("/api/data") { ctx ->
                // 通过 ctx 访问请求上下文
                "数据已创建"
            }

            group("admin") {
                get("/dashboard") { ctx ->
                    "管理后台"
                }
            }
        }
    }
}
```

DSL 路由支持以下方法：

| 方法 | 说明 |
|------|------|
| `get(path) { ... }` | 注册 GET 路由 |
| `post(path) { ... }` | 注册 POST 路由 |
| `put(path) { ... }` | 注册 PUT 路由 |
| `delete(path) { ... }` | 注册 DELETE 路由 |
| `patch(path) { ... }` | 注册 PATCH 路由 |
| `group(name) { ... }` | 定义路由组 |

::: tip DSL 与注解的选择
- **DSL 路由**：适合快速原型、简单微服务、无需 KSP 的场景
- **注解路由**：适合大型项目，控制器结构更清晰，支持参数自动绑定、安全注解等高级功能

两种方式可以在同一项目中混合使用。
:::

## 协程支持

控制器方法支持 `suspend` 修饰符，可以在方法内调用挂起函数：

```kotlin
@Controller("/api")
class AsyncController {

    @Get("/data")
    suspend fun fetchData(): String {
        // 可以调用挂起函数
        val result = someAsyncOperation()
        return result
    }
}
```

## 进一步阅读

- [参数绑定](./parameter-binding.md) -- 深入了解路径参数、查询参数、请求体等绑定规则
- [安全指南](./security.md) -- Authenticator + Guard 认证授权体系
- [路由规范 v1](/spec/routing) -- 路由系统的设计规范与冻结定义
