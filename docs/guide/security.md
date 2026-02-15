# 安全指南

Neton 提供了一套声明式的安全框架，采用 **Authenticator（认证器）+ Guard（守卫）** 双层架构，将"你是谁"和"你能做什么"两个关注点彻底分离。

## 架构概览

```
HTTP 请求
  |
  v
┌──────────────────────┐
│   Authenticator      │  ← 第一层：身份认证（你是谁？）
│   解析请求凭证，       │     返回 Identity 或 null
│   返回 Identity       │
└──────────┬───────────┘
           |
           v
┌──────────────────────┐
│   @Permission +      │  ← 第二层：权限检查（你有这个权限吗？）
│   PermissionEvaluator│     PermissionEvaluator 可自定义
└──────────┬───────────┘
           |
           v
┌──────────────────────┐
│   Guard              │  ← 第三层：守卫（最终放行？）
│   根据 Identity +     │     返回 true/false
│   请求上下文判断权限   │
└──────────┬───────────┘
           |
           v
       Controller
```

- **Authenticator**：负责从请求中提取凭证（Token、Session、Basic 等），验证通过后返回 `Identity`（用户身份），验证失败返回 `null`。
- **@Permission + PermissionEvaluator**：当路由标注了 `@Permission("system:user:edit")` 时，检查 Identity 是否具有该权限。默认使用 `identity.hasPermission()`，业务可替换 `PermissionEvaluator` 实现 superadmin 等逻辑。
- **Guard**：接收 `Identity` 和请求上下文，决定是否放行。内置的 `RequireIdentityGuard` 要求 Identity 非空（即已认证），`AllowAllGuard` 放行所有请求。
- **Identity**：代表已认证用户，包含 `id`、`roles`、`permissions` 三个核心属性。

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

        // admin 组：Mock 认证 + 默认守卫
        security.registerMockAuthenticator(
            name = "admin-mock",
            userId = "admin-user",
            roles = setOf("admin"),
            permissions = setOf("system:user:edit", "system:user:delete")
        )
        security.setGroupGuard("admin", RealDefaultGuard())

        // 可选：自定义 PermissionEvaluator（superadmin 绕过）
        security.setPermissionEvaluator { identity, permission, _ ->
            identity.hasRole("superadmin") || identity.hasPermission(permission)
        }
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
| `setPermissionEvaluator(evaluator)` | 设置自定义权限评估器 |
| `registerMockAuthenticator(...)` | 注册 Mock 认证器（开发测试用） |
| `registerJwtAuthenticator(...)` | 注册 JWT 认证器 |

## 安全注解

Neton 提供以下核心安全注解，标注在控制器类或方法上即可生效：

### @AllowAnonymous

允许匿名访问，跳过权限验证。优先级最高。

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

### @Permission

声明式权限检查。标注后，安全管道会自动检查当前 Identity 是否具备指定权限。

```kotlin
// 需要 system:user:edit 权限
@Post("/users/{id}")
@RequireAuth
@Permission("system:user:edit")
fun editUser(id: Long): String {
    return "编辑用户 $id"
}

// 类级 @Permission：该控制器所有方法默认需要此权限
@Controller("/admin/system")
@RequireAuth
@Permission("system:manage")
class SystemController {

    @Get("/info")
    fun info(): String = "系统信息"

    // 方法级覆盖类级
    @Delete("/reset")
    @Permission("system:reset")
    fun reset(): String = "系统重置"
}
```

**继承规则**：方法级 `@Permission` 覆盖类级；同一目标不允许多个 `@Permission`（编译期 fail-fast）。

### @CurrentUser

将当前认证用户的 `Identity` 注入到方法参数中。`Identity` 包含 `id`（用户标识）、`roles`（角色集合）和 `permissions`（权限集合）。

```kotlin
@Get("/profile")
@RequireAuth
fun getCurrentUser(@CurrentUser identity: Identity): String {
    return "当前用户: ${identity.id} (角色: ${identity.roles.joinToString(", ")})"
}
```

`@CurrentUser` 支持 `required` 参数：

- `required = true`（默认）：用户未认证时抛出异常
- `required = false`：用户未认证时参数值为 `null`

```kotlin
@Get("/visitor")
@AllowAnonymous
fun visitorInfo(@CurrentUser(required = false) identity: Identity?): String {
    return if (identity != null) {
        "欢迎回来, ${identity.id}!"
    } else {
        "欢迎访客!"
    }
}
```

**类型自动注入**：当参数类型为 `Identity` 时，即使不写 `@CurrentUser` 注解也会自动注入。注解主要用于控制 `required` 语义。

## PermissionEvaluator

`PermissionEvaluator` 是一个 `fun interface`，用于自定义权限判定逻辑。默认行为是 `identity.hasPermission(permission)`。

典型场景：superadmin 绕过所有权限检查。

```kotlin
security {
    setPermissionEvaluator { identity, permission, context ->
        // superadmin 拥有所有权限
        identity.hasRole("superadmin") || identity.hasPermission(permission)
    }
}
```

**默认行为（无自定义 evaluator 时）**：
- `identity.permissions` 包含目标权限 → 放行
- 不包含 → 403 Forbidden
- identity 为 null → 401 Unauthorized

## 路由组安全策略

Neton 支持多路由组（Route Group），每个组可以拥有独立的认证器和守卫配置。

### routing.conf 配置

```toml
[[groups]]
name = "admin"
mount = "/admin"
requireAuth = true
allowAnonymous = ["/login", "/register"]

[[groups]]
name = "app"
mount = "/app"
requireAuth = false
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | String | 路由组名称 |
| `mount` | String | URL 前缀 |
| `requireAuth` | Boolean | 该组是否默认要求认证（默认 false） |
| `allowAnonymous` | List&lt;String&gt; | 白名单路径，即使 requireAuth=true 也允许匿名访问 |

### 优先级规则

```
@AllowAnonymous（注解） > allowAnonymous（白名单） > group.requireAuth
```

- `@AllowAnonymous` 标注的方法/类，无论路由组配置如何，都允许匿名访问
- 白名单中的路径模式，在 `requireAuth = true` 的组内仍允许匿名
- 组级 `requireAuth` 是兜底策略

### 不同路由组的安全策略示例

| 路由组 | requireAuth | 说明 |
|--------|-------------|------|
| 默认组 | false | 公开访问，除非方法标注 `@RequireAuth` |
| `admin` | true | 默认要求认证，`@AllowAnonymous` 或白名单可豁免 |
| `app` | false | 默认开放，`@RequireAuth` 可强制要求认证 |

## JWT 认证

Neton 内置 JWT 认证器支持：

```kotlin
security {
    registerJwtAuthenticator(
        secretKey = "your-secret-key",
        headerName = "Authorization",    // 默认值
        tokenPrefix = "Bearer "          // 默认值
    )
}
```

JWT 认证器会从请求的 `Authorization` 头中提取 Bearer Token，验证签名后返回包含用户信息的 `Identity`。

JWT Claims 约定：

| Claim | 对应字段 | 说明 |
|-------|---------|------|
| `sub` | `identity.id` | 用户唯一标识 |
| `roles` | `identity.roles` | 角色集合（JSON 数组） |
| `perms` | `identity.permissions` | 权限集合（JSON 数组） |

## Identity 接口

`Identity` 是已认证用户的抽象，提供以下能力：

```kotlin
interface Identity {
    val id: String                              // 用户唯一标识
    val roles: Set<String>                      // 角色集合
    val permissions: Set<String>                // 权限集合

    fun hasRole(role: String): Boolean                  // 是否具有指定角色
    fun hasAnyRole(vararg roles: String): Boolean       // 是否具有任一角色
    fun hasAllRoles(vararg roles: String): Boolean      // 是否具有所有角色
    fun hasPermission(p: String): Boolean               // 是否具有指定权限
    fun hasAnyPermission(vararg ps: String): Boolean    // 是否具有任一权限
    fun hasAllPermissions(vararg ps: String): Boolean   // 是否具有所有权限
}
```

在控制器中可以根据 Identity 的角色和权限动态返回不同内容：

```kotlin
@Get("/dashboard")
@RequireAuth
fun dashboard(@CurrentUser identity: Identity): String {
    return when {
        identity.hasRole("admin") -> "管理员仪表板 - 完整系统控制权限"
        identity.hasRole("editor") -> "编辑器仪表板 - 内容管理权限"
        identity.hasPermission("dashboard:view") -> "用户仪表板 - 个人账户管理"
        else -> "基础仪表板 - 有限功能"
    }
}
```

### Identity 继承链

```
neton-core:     Identity { id: String, roles: Set, permissions: Set }
                    ↑
neton-security: Identity { userId: UserId }  （桥接 override val id = userId.value.toString()）
                    ↑
                IdentityUser(userId, roles, permissions)  — 默认实现
```

业务可以创建自定义 `User : Identity` 扩展更多字段。

## 相关文档

- [安全规格说明](/spec/security) -- 安全模块完整设计规格
- [安全 v1.1 冻结说明](/spec/security-v1.1-freeze) -- v1.1 版本冻结细节
- [安全 v1.2 冻结说明](/spec/security-v1.2-freeze) -- v1.2 @Permission + PermissionEvaluator
- [JWT 认证器规格](/spec/jwt-authenticator) -- JWT 认证器设计与实现
- [@CurrentUser 设计文档](/spec/current-user-design) -- @CurrentUser 注入机制设计
- [路由指南](/guide/routing) -- 路由组与 mount 配置
