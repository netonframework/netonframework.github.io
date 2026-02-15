# 中间件与请求处理管道指南

> 本指南介绍 Neton 的请求处理管道、内建的安全中间件机制、访问日志、TraceId 传播，以及如何在管道中传递自定义数据。Neton v1 采用隐式中间件架构，安全、日志、追踪等能力内建于请求处理流程中。

---

## 一、请求处理流程

每个 HTTP 请求在 Neton 中经过以下处理阶段：

```
HTTP 请求
  -> HttpAdapter（接收连接）
    -> RequestEngine（路由匹配）
      -> Security Pipeline（Authenticator 认证 + Guard 授权）
        -> Route Handler（Controller 方法执行）
          -> Response 序列化（JSON / text / redirect）
            -> Access Log（结构化访问日志）
              -> HTTP 响应
```

每个阶段的职责：

| 阶段 | 职责 | 模块 |
|------|------|------|
| **HttpAdapter** | 接收 TCP 连接，解析 HTTP 协议，构建 HttpContext | neton-http |
| **RequestEngine** | 根据 method + path 匹配路由，构建 HandlerArgs | neton-core |
| **Security Pipeline** | 身份认证 + 权限校验 | neton-security |
| **Route Handler** | 执行 Controller 方法，返回业务结果 | 业务代码 |
| **Response 序列化** | 将返回值转为 HTTP 响应体 | neton-http |
| **Access Log** | 记录请求的结构化日志 | neton-logging |

---

## 二、安全管道：内建中间件

Neton 的安全体系作为内建中间件，在每个请求的 handler 执行**之前**自动运行，由两层组成：

### 2.1 Authenticator（认证：你是谁）

Authenticator 从请求中提取并验证身份，返回 `Identity`：

```kotlin
interface Authenticator {
    val name: String
    suspend fun authenticate(context: RequestContext): Identity?
}
```

内置认证器：

| 认证器 | 说明 |
|--------|------|
| MockAuthenticator | 返回固定用户，用于开发测试 |
| AnonymousAuthenticator | 返回 null，允许匿名 |
| JwtAuthenticator | 解析 JWT token（v1.1 完善中） |
| SessionAuthenticator | 从 Session 读取用户（v1.1 完善中） |

### 2.2 Guard（授权：你能做什么）

Guard 在认证之后检查当前用户是否有权访问目标资源：

```kotlin
interface Guard {
    suspend fun checkPermission(identity: Identity?, context: RequestContext): Boolean
}
```

内置守卫：

| 守卫 | 说明 |
|------|------|
| PublicGuard | 始终允许，用于公开接口 |
| DefaultGuard | principal 非 null 即允许 |
| AdminGuard | 需要 admin 角色 |
| RoleGuard | 需要指定角色之一或全部 |

### 2.3 安全管道的执行逻辑

```
handleRoute(route, call)
  |
  +-- 构建 HttpContext（含 traceId）
  +-- 构建 HandlerArgs
  +-- Security 预处理：
  |     |
  |     +-- 路由标注 @AllowAnonymous？
  |     |     -> 跳过认证，principal = null，直接通过
  |     |
  |     +-- 未安装 Security 组件？
  |     |     +-- 路由标注 @RequireAuth -> 500（配置错误：fail-fast）
  |     |     +-- 否则 -> 通过（默认开放）
  |     |
  |     +-- 已安装 Security：
  |           +-- principal = authenticator.authenticate(ctx)
  |           +-- principal == null 且 @RequireAuth -> 401 Unauthorized
  |           +-- attributes["principal"] = principal
  |           +-- guard.authorize(principal, ctx) == false -> 403 Forbidden
  |
  +-- handler.invoke(httpContext, args) -> 执行业务
  +-- 响应序列化
  +-- Access Log
```

### 2.4 安全注解

通过注解控制每个路由的安全策略：

```kotlin
@Controller("/api")
class UserController {

    // 公开接口，跳过认证
    @Get("/public/info")
    @AllowAnonymous
    suspend fun publicInfo(): String = "public"

    // 需要登录（任意认证用户）
    @Get("/profile")
    @RequireAuth
    suspend fun profile(@CurrentUser user: Identity): String {
        return "Hello ${user.id}"
    }

    // 需要 admin 角色
    @Get("/admin/dashboard")
    @RolesAllowed("admin")
    suspend fun dashboard(): String = "admin only"
}
```

### 2.5 按路由组配置不同的认证/授权

可以为不同路由组绑定不同的 Authenticator 和 Guard：

```kotlin
security {
    // 默认组使用 JWT
    registerAuthenticator(JwtAuthenticator(secretKey = "xxx"))
    bindDefaultGuard()

    // admin 组使用自定义守卫
    bindGuard("admin", CustomGuard("admin") { principal, ctx ->
        principal?.hasRole("admin") == true
    })
}
```

---

## 三、访问日志

Neton 对每个 HTTP 请求自动生成结构化访问日志，无需手动编写。日志使用统一的 `Logger.info` 输出，msg 固定为 `"http.access"`。

### 3.1 访问日志字段

| 字段 | 说明 |
|------|------|
| `method` | HTTP 方法（GET/POST/PUT/DELETE 等） |
| `path` | 请求路径 |
| `status` | HTTP 状态码 |
| `latencyMs` | 请求耗时（毫秒） |
| `bytesIn` | 请求体大小（字节） |
| `bytesOut` | 响应体大小（字节） |
| `traceId` | 请求追踪 ID |

### 3.2 日志输出示例

```json
{
  "ts": "2026-02-14T10:21:33.123Z",
  "level": "INFO",
  "msg": "http.access",
  "method": "GET",
  "path": "/api/users/1",
  "status": 200,
  "latencyMs": 12,
  "bytesIn": 0,
  "bytesOut": 256,
  "traceId": "req-1707900093-a1b2c3"
}
```

### 3.3 访问日志配置

在 `application.conf` 中可以将访问日志路由到独立文件：

```toml
[[logging.sinks]]
name = "access"
file = "logs/access.log"
levels = "INFO"
route = "http.access"
```

---

## 四、TraceId 传播

Neton 为每个请求自动生成唯一的 `traceId`，贯穿整个请求生命周期。

### 4.1 自动注入

- **入口**：HttpAdapter 在接收请求时生成 traceId，写入 `HttpContext.traceId` 和 `LogContext`。
- **传播**：Logger 实现自动从 `LogContext` 读取 traceId，每条日志自动携带，业务代码无需手动传递。
- **一致性**：`HttpContext.traceId` 与 `LogContext.traceId` 保证为同一值（同源）。

### 4.2 使用场景

在排查问题时，通过 traceId 可串联一个请求经过的所有模块（HTTP、缓存、Redis、数据库）的日志：

```kotlin
@Get("/users/{id}")
suspend fun getUser(ctx: HttpContext, @PathVariable id: Long): User? {
    // 此处 log 自动携带当前请求的 traceId，无需手动传递
    log.info("fetching user", mapOf("userId" to id))
    return userService.findById(id)
}
```

对应日志输出：

```json
{"ts":"...","level":"INFO","msg":"fetching user","userId":1,"traceId":"req-1707900093-a1b2c3"}
{"ts":"...","level":"INFO","msg":"http.access","path":"/users/1","status":200,"traceId":"req-1707900093-a1b2c3"}
```

同一个 `traceId` 串联了业务日志和访问日志，3 分钟即可定位问题。

---

## 五、HttpContext.attributes：请求级自定义数据

`HttpContext.attributes` 是一个请求级别的 `MutableMap&lt;String, Any&gt;`，可以在处理管道的不同阶段之间传递自定义数据。

### 5.1 读写 attributes

```kotlin
// 在 Authenticator 或管道早期设置数据
ctx.setAttribute("requestTime", System.currentTimeMillis())
ctx.setAttribute("tenantId", "org-001")

// 在 Controller 中读取数据
val requestTime = ctx.getAttribute("requestTime") as Long
val tenantId = ctx.getAttribute("tenantId") as String

// 移除属性
ctx.removeAttribute("tempData")
```

### 5.2 内建 attributes

框架在管道中自动设置以下属性：

| Key | 类型 | 说明 |
|-----|------|------|
| `"principal"` | Identity? | 认证后的用户身份，由安全管道写入 |

### 5.3 典型用法

```kotlin
@Controller
class OrderController {

    @Post("/orders")
    @RequireAuth
    suspend fun createOrder(ctx: HttpContext, @RequestBody order: CreateOrderReq): Order {
        // 记录请求接收时间
        val startTime = ctx.getAttribute("requestTime") as? Long

        // 从安全管道获取当前用户
        val principal = ctx.getAttribute("principal") as? Identity

        // 创建订单
        return orderService.create(order, principal?.id)
    }
}
```

---

## 六、Config SPI：配置级中间件

Neton 通过 `@NetonConfig` 注解提供声明式的全局配置能力，可以看作「配置层面的中间件」。它在组件启动阶段（`onStart`）执行，用于注册认证器、守卫、数据源等业务配置。

```kotlin
@NetonConfig("security", order = 0)
class AppSecurityConfig : SecurityConfigurer {
    override fun configure(ctx: NetonContext, target: SecurityBuilder) {
        // 注册 Mock 认证器（开发环境）
        target.registerMockAuthenticator(
            userId = "test-user",
            roles = listOf("user", "admin")
        )
        // 绑定默认守卫
        target.bindDefaultGuard()
    }
}
```

**核心原则**：

- DSL（`security { }`）只负责安装组件和基础设施参数。
- 业务逻辑（认证规则、权限策略）通过 `@NetonConfig` 配置器注入。
- KSP 在编译期发现所有 `@NetonConfig` 注解的类，生成注册表，零反射。

---

## 七、v2 展望：正式中间件管道

Neton v1 的中间件能力（安全、日志、追踪）内建于请求处理流程中，满足大多数场景。v2 计划引入正式的中间件管道 API，支持：

- 自定义中间件的注册与排序
- 请求/响应的拦截与修改
- CORS、Rate Limiting 等通用中间件
- 中间件的条件执行（按路由、按方法等）

当前版本下，如需类似中间件的自定义逻辑，可通过以下方式实现：

1. **HttpContext.attributes**：在管道各阶段传递数据。
2. **@NetonConfig**：在启动阶段注入全局配置。
3. **Guard**：实现自定义授权逻辑。

---

## 八、相关文档

- [安全规范](../spec/security.md) -- Authenticator / Guard / 注解的完整技术规范
- [日志规范](../spec/logging.md) -- 结构化日志、TraceId、访问日志字段的冻结规范
- [HTTP 规范](../spec/http.md) -- HttpContext / 请求处理流程 / 响应语义
- [Config SPI 规范](../spec/config-spi.md) -- @NetonConfig 的分层架构与使用规则
