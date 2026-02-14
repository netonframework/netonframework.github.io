# 安全指南

Neton 提供了一套声明式的安全框架，采用 **Authenticator（认证器）+ Guard（守卫）** 双层架构，将"你是谁"和"你能做什么"两个关注点彻底分离。

## 架构概览

```
HTTP 请求
  |
  v
┌──────────────────────┐
│   Authenticator      │  ← 第一层：身份认证（你是谁？）
│   解析请求凭证，       │     返回 Principal 或 null
│   返回 Principal      │
└──────────┬───────────┘
           |
           v
┌──────────────────────┐
│   Guard              │  ← 第二层：权限守卫（你能做什么？）
│   根据 Principal +    │     返回 true/false
│   请求上下文判断权限   │
└──────────┬───────────┘
           |
           v
       Controller
```

- **Authenticator**：负责从请求中提取凭证（Token、Session、Basic 等），验证通过后返回 `Principal`（用户主体），验证失败返回 `null`。
- **Guard**：接收 `Principal` 和请求上下文，决定是否放行。内置的 `DefaultGuard` 要求 Principal 非空（即已认证），`AnonymousGuard` 放行所有请求，`RoleGuard` 检查角色。
- **Principal**：代表已认证用户，包含 `id`、`roles`、`attributes` 三个核心属性。

## 安装安全组件

在应用入口 DSL 中安装 `security` 组件：

```kotlin
import neton.security.security

fun main(args: Array<String>) {
    Neton.run(args) {
        http { port = 8080 }

        security {
            // 业务配置由 @NetonConfig("security") 自动应用
        }

        routing { }
    }
}
```

`security { }` 块负责安装安全管道。具体的认证器和守卫配置推荐通过 `@NetonConfig` 配置类完成，实现基础设施安装与业务配置的分离。

## 通过 @NetonConfig 配置安全策略

创建一个实现 `SecurityConfigurer` 的配置类，KSP 会自动发现并在启动时应用：

```kotlin
import neton.core.component.NetonContext
import neton.core.config.NetonConfig
import neton.core.config.SecurityConfigurer
import neton.core.interfaces.SecurityBuilder
import neton.security.RealAnonymousGuard
import neton.security.RealDefaultGuard

@NetonConfig(component = "security", order = 0)
class AppSecurityConfig : SecurityConfigurer {

    override fun configure(ctx: NetonContext, security: SecurityBuilder) {
        // 默认组：开放（匿名守卫 = 允许所有请求）
        security.setDefaultGuard(RealAnonymousGuard())

        // admin 组：Mock 认证 + 默认守卫（requireAuth 时生效）
        val factory = security.getSecurityFactory()
        security.setGroupAuthenticator("admin", factory.createAuthenticator("mock", mapOf(
            "userId" to "admin-user",
            "roles" to listOf("admin"),
            "attributes" to emptyMap<String, Any>()
        )))
        security.setGroupGuard("admin", RealDefaultGuard())

        // app 组：Mock 认证 + 默认守卫
        security.setGroupAuthenticator("app", factory.createAuthenticator("mock", mapOf(
            "userId" to "app-user",
            "roles" to listOf("user"),
            "attributes" to emptyMap<String, Any>()
        )))
        security.setGroupGuard("app", RealDefaultGuard())
    }
}
```

### 关键 API 说明

| 方法 | 作用 |
|------|------|
| `setDefaultGuard(guard)` | 设置默认路由组的守卫 |
| `setDefaultAuthenticator(auth)` | 设置默认路由组的认证器 |
| `setGroupAuthenticator(group, auth)` | 设置指定路由组的认证器 |
| `setGroupGuard(group, guard)` | 设置指定路由组的守卫 |
| `getSecurityFactory()` | 获取安全工厂，用于创建内置认证器/守卫实例 |

### SecurityFactory 支持的认证器类型

通过 `factory.createAuthenticator(type, config)` 创建：

- `"mock"` -- 模拟认证器，开发测试用，始终返回固定用户
- `"jwt"` -- JWT 认证器，从 Authorization 头解析 Bearer Token
- `"session"` -- 会话认证器，从 Session 读取用户信息
- `"basic"` -- HTTP Basic 认证器

## 安全注解

Neton 提供四个核心安全注解，标注在控制器方法上即可生效：

### @AllowAnonymous

允许匿名访问，跳过权限验证。适用于公开接口。

```kotlin
@Controller("/api/security")
class SecurityController {

    @Get("/public")
    @AllowAnonymous
    fun publicAccess(): String {
        return "公开接口 - 任何人都可以访问"
    }
}
```

### @RequireAuth

要求用户必须已认证（登录）才能访问。

```kotlin
@Get("/protected")
@RequireAuth
fun protectedAccess(): String {
    return "受保护接口 - 需要登录才能访问"
}
```

### @RolesAllowed

要求用户具有指定角色之一才能访问。支持传入多个角色，满足任意一个即可。

```kotlin
// 仅管理员
@Get("/admin")
@RolesAllowed("admin")
fun adminOnly(): String {
    return "管理员接口 - 只有管理员才能访问"
}

// 管理员或编辑者
@Get("/editor")
@RolesAllowed("admin", "editor")
fun adminOrEditor(): String {
    return "编辑权限接口 - 管理员或编辑者可以访问"
}
```

### @AuthenticationPrincipal

将当前认证用户的 `Principal` 注入到方法参数中。`Principal` 包含 `id`（用户标识）、`roles`（角色列表）和 `attributes`（扩展属性）。

```kotlin
@Get("/profile")
@RequireAuth
fun getCurrentUser(@AuthenticationPrincipal principal: Principal): String {
    return "当前用户: ${principal.id} (角色: ${principal.roles.joinToString(", ")})"
}
```

`@AuthenticationPrincipal` 支持 `required` 参数：

- `required = true`（默认）：用户未认证时抛出异常
- `required = false`：用户未认证时参数值为 `null`

```kotlin
@Get("/visitor")
@AllowAnonymous
fun visitorInfo(@AuthenticationPrincipal(required = false) principal: Principal?): String {
    return if (principal != null) {
        "欢迎回来, ${principal.id}!"
    } else {
        "欢迎访客!"
    }
}
```

## 路由组安全策略

Neton 支持多路由组（Route Group），每个组可以拥有独立的认证器和守卫配置。路由组通过 `routing.conf` 定义：

```toml
# config/routing.conf
[[groups]]
name = "admin"
mount = "/admin"

[[groups]]
name = "app"
mount = "/app"
```

不同路由组的安全策略彼此独立：

| 路由组 | 认证器 | 守卫 | 说明 |
|--------|--------|------|------|
| 默认组 | 无 | `AnonymousGuard` | 公开访问，除非方法标注 `@RequireAuth` |
| `admin` | Mock/JWT 认证器 | `DefaultGuard` | 默认要求认证，`@AllowAnonymous` 可豁免 |
| `app` | Mock/JWT 认证器 | `DefaultGuard` | 默认要求认证，`@AllowAnonymous` 可豁免 |

安全管道的处理逻辑：

1. 根据请求路径确定所属路由组
2. 使用该组的 Authenticator 进行身份认证
3. 检查方法上的安全注解（`@AllowAnonymous` / `@RequireAuth` / `@RolesAllowed`）
4. 使用该组的 Guard 进行权限检查
5. 注解优先级高于组默认策略

## JWT 认证

Neton 内置 JWT 认证器支持，可通过 `SecurityFactory` 创建或直接注册：

```kotlin
// 通过 SecurityBuilder 注册 JWT 认证器
security.registerJwtAuthenticator(
    secretKey = "your-secret-key",
    headerName = "Authorization",    // 默认值
    tokenPrefix = "Bearer "          // 默认值
)
```

JWT 认证器会从请求的 `Authorization` 头中提取 Bearer Token，验证签名后返回包含用户信息的 `Principal`。

## Principal 接口

`Principal` 是已认证用户的抽象，提供以下能力：

```kotlin
interface Principal {
    val id: String                          // 用户唯一标识
    val roles: List<String>                 // 角色列表
    val attributes: Map<String, Any>        // 扩展属性

    fun hasRole(role: String): Boolean              // 是否具有指定角色
    fun hasAnyRole(vararg roles: String): Boolean   // 是否具有任一角色
    fun hasAllRoles(vararg roles: String): Boolean   // 是否具有所有角色
}
```

在控制器中可以根据 Principal 的角色动态返回不同内容：

```kotlin
@Get("/dashboard")
@RequireAuth
fun dashboard(@AuthenticationPrincipal principal: Principal): String {
    return when {
        "admin" in principal.roles -> "管理员仪表板 - 完整系统控制权限"
        "editor" in principal.roles -> "编辑器仪表板 - 内容管理权限"
        "user" in principal.roles -> "用户仪表板 - 个人账户管理"
        else -> "基础仪表板 - 有限功能"
    }
}
```

## 相关文档

- [安全规格说明](/spec/security) -- 安全模块完整设计规格
- [安全 v1.1 冻结说明](/spec/security-v1.1-freeze) -- v1.1 版本冻结细节
- [JWT 认证器规格](/spec/jwt-authenticator) -- JWT 认证器设计与实现
- [路由指南](/guide/index) -- 路由组与 mount 配置
