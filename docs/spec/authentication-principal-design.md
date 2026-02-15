# @CurrentUser 注解设计文档

> 本文档原名 `@AuthenticationPrincipal 注解设计文档`，v1.2 随 Principal → Identity 迁移同步更新。

## 概述

`@CurrentUser` 注解是 Neton 安全模块的核心特性，它允许在控制器方法中直接注入当前认证用户的 `Identity`，提供了一种优雅、类型安全的方式来获取用户信息。

## 设计目标

1. **简化代码**：减少手动从 HttpContext 获取用户的样板代码
2. **类型安全**：编译时确保用户类型正确，避免运行时类型错误
3. **可读性强**：方法签名直接表达了对认证用户的依赖关系
4. **灵活性高**：支持必需认证和可选认证两种模式
5. **自动注入**：参数类型为 `Identity` 时，即使不写注解也会自动注入

## 注解定义

```kotlin
@Target(AnnotationTarget.VALUE_PARAMETER)
@Retention(AnnotationRetention.RUNTIME)
annotation class CurrentUser(val required: Boolean = true)
```

### 参数说明

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `required` | Boolean | `true` | 是否必需认证用户 |

- `required = true`：如果用户未认证，框架会抛出认证异常（401）
- `required = false`：如果用户未认证，参数值为 `null`，需要配合 `@AllowAnonymous` 使用

## 基本用法

### 必需认证模式

```kotlin
@Controller("/api")
class ApiController {

    @Get("/profile")
    @RequireAuth
    fun getProfile(@CurrentUser identity: Identity): String {
        return "Hello ${identity.id}, 角色: ${identity.roles.joinToString(", ")}"
    }
}
```

### 可选认证模式

```kotlin
@Controller("/api")
class ApiController {

    @Get("/welcome")
    @AllowAnonymous
    fun welcome(@CurrentUser(required = false) identity: Identity?): String {
        return if (identity != null) {
            "欢迎回来，${identity.id}！"
        } else {
            "欢迎游客用户！"
        }
    }
}
```

### 类型自动注入（无需注解）

当参数类型为 `Identity` 时，KSP 会自动识别并注入，无需 `@CurrentUser` 注解：

```kotlin
@Get("/dashboard")
@RequireAuth
fun dashboard(identity: Identity): String {
    // identity 自动从 HttpContext 注入
    return "用户 ${identity.id} 的仪表板"
}
```

可空的 `Identity?` 参数也会自动注入：

```kotlin
@Get("/info")
@AllowAnonymous
fun info(identity: Identity?): String {
    return identity?.id ?: "anonymous"
}
```

## 高级用法

### 与 @Permission 结合

```kotlin
@Controller("/admin")
class AdminController {

    @Get("/dashboard")
    @RequireAuth
    @Permission("admin:dashboard:view")
    fun dashboard(@CurrentUser identity: Identity): String {
        return "管理员 ${identity.id} 的仪表板"
    }
}
```

### 业务逻辑中的权限检查

```kotlin
@Controller("/user")
class UserController {

    @Get("/{id}/profile")
    @RequireAuth
    fun getUserDetail(
        @PathVariable("id") targetUserId: Int,
        @CurrentUser currentUser: Identity
    ): String {
        if (targetUserId.toString() != currentUser.id && !currentUser.hasRole("admin")) {
            throw HttpException(HttpStatus.FORBIDDEN, "无权访问他人信息")
        }
        return "用户 $targetUserId 的资料"
    }
}
```

### 多种参数组合使用

```kotlin
@Controller("/user")
class UserController {

    @Get("/{id}/profile")
    @RequireAuth
    fun getUserProfile(
        @PathVariable("id") id: Int,
        @QueryParam("format") format: String = "json",
        @Header("Accept") accept: String?,
        @CurrentUser currentUser: Identity
    ): String {
        if (id.toString() != currentUser.id && !currentUser.hasRole("admin")) {
            throw HttpException(HttpStatus.FORBIDDEN, "无权访问他人资料")
        }
        return "用户 $id 的资料 (format=$format)"
    }
}
```

## 与传统方式对比

### 传统方式

```kotlin
@Get("/profile")
fun getProfile(ctx: HttpContext): String {
    val identity = ctx.getAttribute(SecurityAttributes.IDENTITY) as? Identity
        ?: throw HttpException(HttpStatus.UNAUTHORIZED, "需要认证")
    return "Hello ${identity.id}, 角色: ${identity.roles.joinToString(", ")}"
}
```

### 使用 @CurrentUser

```kotlin
@Get("/profile")
@RequireAuth
fun getProfile(@CurrentUser identity: Identity): String {
    return "Hello ${identity.id}, 角色: ${identity.roles.joinToString(", ")}"
}
```

### 优势对比

| 方面 | 传统方式 | @CurrentUser |
|------|----------|-------------|
| **代码量** | 多行样板代码 | 单行注解（或零注解） |
| **类型安全** | 需要手动 cast | 编译时类型检查 |
| **可读性** | 隐含的用户依赖 | 方法签名明确表达依赖 |
| **错误处理** | 手动检查和处理 | 框架自动处理 |
| **测试友好** | 需要模拟 HttpContext | 直接传入 Identity 对象 |

## 实现原理

### 1. KSP 编译期处理

KSP ControllerProcessor 在扫描方法参数时：
- 参数类型为 `Identity`（或其子类型） → 自动识别为用户注入
- 参数带 `@CurrentUser` 或 `@AuthenticationPrincipal`（兼容） → 标记为用户注入

### 2. 生成代码

KSP 生成的路由处理代码：

```kotlin
// 非空 Identity
context.getAttribute(SecurityAttributes.IDENTITY) as Identity

// 可空 Identity
context.getAttribute(SecurityAttributes.IDENTITY) as? Identity
```

所有生成代码统一使用 `SecurityAttributes.IDENTITY` 常量，不使用硬编码字符串。

### 3. 安全管道写入

安全管道（`runSecurityPreHandle`）在认证成功后：

```kotlin
httpContext.setAttribute(SecurityAttributes.IDENTITY, identity)
```

## 最佳实践

### 1. 优先使用类型自动注入

```kotlin
// 推荐：类型自动注入，零注解
@Get("/profile")
@RequireAuth
fun getProfile(identity: Identity): String {
    return "User: ${identity.id}"
}

// 仅在需要控制 required 语义时使用注解
@Get("/welcome")
@AllowAnonymous
fun welcome(@CurrentUser(required = false) identity: Identity?): String {
    return identity?.id ?: "guest"
}
```

### 2. 配合安全注解使用

```kotlin
// 正确：配合 @AllowAnonymous 使用可选注入
@Get("/welcome")
@AllowAnonymous
fun welcome(@CurrentUser(required = false) identity: Identity?): String {
    return if (identity != null) "欢迎回来" else "欢迎访客"
}

// 正确：@RequireAuth 确保 identity 非空
@Get("/profile")
@RequireAuth
fun profile(@CurrentUser identity: Identity): String {
    return "用户: ${identity.id}"
}
```

### 3. 在业务逻辑中进行细粒度权限检查

```kotlin
@Get("/orders/{id}")
@RequireAuth
fun getOrder(
    @PathVariable("id") orderId: Int,
    @CurrentUser identity: Identity
): String {
    return when {
        identity.hasRole("admin") -> "管理员查看订单 $orderId（含完整信息）"
        identity.hasPermission("order:view") -> "查看订单 $orderId"
        else -> throw HttpException(HttpStatus.FORBIDDEN, "无权访问此订单")
    }
}
```

### 4. 测试友好的设计

```kotlin
class UserControllerTest {

    @Test
    fun testGetProfile() {
        val identity = MockIdentity("123", setOf("user"), setOf("profile:view"))
        val controller = UserController()

        // 直接传入 Identity 对象，无需模拟复杂的认证流程
        val response = controller.getProfile(identity)
        assertEquals("User: 123", response)
    }
}
```

## 总结

`@CurrentUser` 注解（及 Identity 类型自动注入）为 Neton 框架提供了一种优雅、类型安全的用户认证方案。它不仅简化了代码编写，还提高了代码的可读性和可维护性。

核心优势：

1. **直接注入**：无需手动从 HttpContext 获取用户
2. **类型安全**：编译时确保用户类型正确
3. **零注解可用**：Identity 类型参数自动注入
4. **安全保障**：自动处理认证检查和异常情况
5. **可选支持**：支持可选认证场景，灵活应对不同需求
6. **常量冻结**：`SecurityAttributes.IDENTITY` 全链路统一引用
