# @AuthenticationPrincipal 注解设计文档

## 概述

`@AuthenticationPrincipal` 注解是 Neton 安全模块的一个重要特性，它允许在控制器方法中直接注入当前认证用户，提供了一种优雅、类型安全的方式来获取用户信息。

## 设计目标

1. **简化代码**：减少手动从 `SecurityContext` 或请求上下文获取用户的样板代码
2. **类型安全**：编译时确保用户类型正确，避免运行时类型错误
3. **可读性强**：方法签名直接表达了对认证用户的依赖关系
4. **灵活性高**：支持必需认证和可选认证两种模式
5. **安全保障**：自动处理认证检查和异常情况

## 注解定义

```kotlin
@Target(AnnotationTarget.VALUE_PARAMETER)
@Retention(AnnotationRetention.RUNTIME)
annotation class AuthenticationPrincipal(val required: Boolean = true)
```

### 参数说明

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `required` | Boolean | `true` | 是否必需认证用户 |

- `required = true`：如果用户未认证，框架会抛出认证异常
- `required = false`：如果用户未认证，参数值为 `null`，需要配合 `@AllowAnonymous` 使用

## 基本用法

### 必需认证模式

```kotlin
@Controller("/api")
class ApiController {
    
    /**
     * 直接注入当前认证用户
     * 如果用户未认证，自动抛出认证异常
     */
    @Get("/profile")
    fun getProfile(@AuthenticationPrincipal user: UserPrincipal): Response {
        return Response.ok("Hello ${user.id}, 你的角色: ${user.roles.joinToString(", ")}")
    }
}
```

### 可选认证模式

```kotlin
@Controller("/api")
class ApiController {
    
    /**
     * 可选认证 - 允许未认证用户访问
     * 需要配合 @AllowAnonymous 使用
     */
    @Get("/welcome")
    @AllowAnonymous
    fun welcome(@AuthenticationPrincipal(required = false) user: UserPrincipal?): Response {
        return if (user != null) {
            Response.ok("欢迎回来，${user.id}！")
        } else {
            Response.ok("欢迎游客用户！")
        }
    }
}
```

## 高级用法

### 与权限检查结合

```kotlin
@Controller("/admin")
class AdminController {
    
    /**
     * 管理员专用功能 - 角色检查 + 用户注入
     */
    @Get("/dashboard")
    @RolesAllowed("admin")
    fun dashboard(@AuthenticationPrincipal user: UserPrincipal): Response {
        return Response.ok(mapOf(
            "message" to "管理员仪表板",
            "adminId" to user.id,
            "permissions" to user.attributes["permissions"]
        ))
    }
}
```

### 业务逻辑中的权限检查

```kotlin
@Controller("/user")
class UserController {
    
    /**
     * 权限检查逻辑 - 只能查看自己的信息或管理员可以查看所有人
     */
    @Get("/{id}/profile")
    fun getUserDetail(
        @PathVariable("id") targetUserId: Int,
        @AuthenticationPrincipal currentUser: UserPrincipal
    ): Response {
        // 业务逻辑中的权限检查
        if (targetUserId.toString() != currentUser.id && !currentUser.hasRole("admin")) {
            return Response.forbidden("无权访问他人信息")
        }
        
        val user = userService.findById(targetUserId)
        return Response.ok(user)
    }
}
```

### 多种参数组合使用

```kotlin
@Controller("/user")
class UserController {
    
    /**
     * 多种参数绑定注解组合使用
     */
    @Get("/{id}/profile")
    fun getUserProfile(
        @PathVariable("id") id: Int,
        @QueryParam("format") format: String = "json",
        @Header("Accept") accept: String?,
        @AuthenticationPrincipal currentUser: UserPrincipal
    ): Response {
        // 权限检查
        if (id.toString() != currentUser.id && !currentUser.hasRole("admin")) {
            return Response.forbidden("无权访问他人资料")
        }
        
        val user = userService.findById(id)
        return when (format) {
            "xml" -> Response.ok(user.toXml())
            else -> Response.ok(user.toJson())
        }
    }
}
```

## 与传统方式对比

### 传统方式

```kotlin
@Get("/profile")
fun getProfile(ctx: HttpContext): Response {
    // 手动检查认证状态
    if (!ctx.isAuthenticated()) {
        return Response.unauthorized("需要认证")
    }
    
    // 手动获取用户信息
    val user = ctx.currentUser()  // Principal
    val userId = user?.id
    val roles = user?.roles ?: emptyList()
    
    return Response.ok("Hello $userId, 角色: ${roles.joinToString(", ")}")
}
```

### 使用 @AuthenticationPrincipal

```kotlin
@Get("/profile")
fun getProfile(@AuthenticationPrincipal user: UserPrincipal): Response {
    return Response.ok("Hello ${user.id}, 角色: ${user.roles.joinToString(", ")}")
}
```

### 优势对比

| 方面 | 传统方式 | @AuthenticationPrincipal |
|------|----------|------------------------|
| **代码量** | 多行样板代码 | 单行注解 |
| **类型安全** | 需要手动转换 | 编译时类型检查 |
| **可读性** | 隐含的用户依赖 | 方法签名明确表达依赖 |
| **错误处理** | 手动检查和处理 | 框架自动处理 |
| **测试友好** | 需要模拟 call 对象 | 直接传入 Principal 对象 |

## 实现原理

### 1. 注解扫描

框架在启动时扫描控制器方法，识别带有 `@AuthenticationPrincipal` 注解的参数：

```kotlin
// 伪代码
fun scanControllerMethod(method: KFunction<*>): MethodInfo {
    val parameters = method.parameters.map { param ->
        ParamInfo(
            name = param.name,
            type = param.type,
            isAuthenticationPrincipal = param.hasAnnotation<AuthenticationPrincipal>(),
            authenticationRequired = param.findAnnotation<AuthenticationPrincipal>()?.required ?: true
        )
    }
    return MethodInfo(method.name, parameters)
}
```

### 2. 参数解析

在路由匹配时，框架检查方法参数中是否有认证用户注入需求：

```kotlin
// 伪代码
fun resolveParameters(methodInfo: MethodInfo, context: RequestContext): Array<Any?> {
    return methodInfo.parameters.map { param ->
        when {
            param.isAuthenticationPrincipal -> {
                val user = SecurityContext.currentUser()
                if (param.authenticationRequired && user == null) {
                    throw AuthenticationException("Authentication required")
                }
                user
            }
            param.isPathVariable -> context.pathParams[param.name]
            param.isQueryParam -> context.queryParams[param.name]
            // ... 其他参数类型
            else -> null
        }
    }.toTypedArray()
}
```

### 3. 方法调用

框架使用解析后的参数调用控制器方法：

```kotlin
// 伪代码
fun invokeControllerMethod(controller: Any, method: KFunction<*>, args: Array<Any?>): Any? {
    return method.call(controller, *args)
}
```

## 错误处理

### 认证异常

当 `required = true` 但用户未认证时，框架会抛出认证异常：

```kotlin
class AuthenticationException(message: String) : RuntimeException(message)
```

### 类型不匹配

如果参数类型与实际的 Principal 类型不匹配，编译器会报错：

```kotlin
// 编译错误：类型不匹配
@Get("/profile")
fun getProfile(@AuthenticationPrincipal user: String): Response {
    // 这里会编译失败，因为 String 不是 Principal 类型
}
```

## 最佳实践

### 1. 使用具体的 Principal 类型

```kotlin
// 推荐：使用具体类型
@Get("/profile")
fun getProfile(@AuthenticationPrincipal user: UserPrincipal): Response {
    return Response.ok("User: ${user.id}")
}

// 不推荐：使用接口类型
@Get("/profile")  
fun getProfile(@AuthenticationPrincipal user: Principal): Response {
    // 需要类型转换，失去了类型安全的优势
    val userPrincipal = user as UserPrincipal
    return Response.ok("User: ${userPrincipal.id}")
}
```

### 2. 合理使用可选认证

```kotlin
// 正确：配合 @AllowAnonymous 使用
@Get("/welcome")
@AllowAnonymous
fun welcome(@AuthenticationPrincipal(required = false) user: UserPrincipal?): Response {
    return if (user != null) {
        Response.ok("欢迎回来，${user.id}！")
    } else {
        Response.ok("欢迎游客用户！")
    }
}

// 错误：没有 @AllowAnonymous，会导致路由无法访问
@Get("/welcome")
fun welcome(@AuthenticationPrincipal(required = false) user: UserPrincipal?): Response {
    // 这个路由仍然需要认证，因为没有 @AllowAnonymous
    return Response.ok("Welcome")
}
```

### 3. 在业务逻辑中进行细粒度权限检查

```kotlin
@Get("/orders/{id}")
fun getOrder(
    @PathVariable("id") orderId: Int,
    @AuthenticationPrincipal user: UserPrincipal
): Response {
    val order = orderService.findById(orderId)
    
    // 细粒度权限检查
    when {
        order.userId == user.id -> {
            // 用户查看自己的订单
            return Response.ok(order)
        }
        user.hasRole("admin") -> {
            // 管理员可以查看所有订单
            return Response.ok(order.withAdminInfo())
        }
        user.hasRole("customer_service") -> {
            // 客服可以查看订单，但不包含敏感信息
            return Response.ok(order.withoutSensitiveInfo())
        }
        else -> {
            return Response.forbidden("无权访问此订单")
        }
    }
}
```

### 4. 测试友好的设计

```kotlin
class UserControllerTest {
    
    @Test
    fun testGetProfile() {
        val user = UserPrincipal("123", listOf("user"))
        val controller = UserController()
        
        // 直接传入 Principal 对象，无需模拟复杂的认证流程
        val response = controller.getProfile(user)
        
        assertEquals("Hello 123", response.body)
    }
}
```

## 总结

`@AuthenticationPrincipal` 注解为 Neton 框架提供了一种优雅、类型安全的用户认证方案。它不仅简化了代码编写，还提高了代码的可读性和可维护性。通过合理使用这个注解，开发者可以更专注于业务逻辑的实现，而不需要关心底层的认证细节。

### 核心优势

1. **🎯 直接注入**：无需手动从 `HttpContext` 或 `SecurityContext` 获取用户
2. **🔒 类型安全**：编译时确保用户类型正确
3. **🚀 简化代码**：减少样板代码，提高开发效率
4. **🛡️ 安全保障**：自动处理认证检查和异常情况
5. **🔄 可选支持**：支持可选认证场景，灵活应对不同需求
6. **📖 可读性强**：方法签名直接表达了对认证用户的依赖

这个设计体现了 Neton 框架"开发体验优先"的核心价值观，为开发者提供了现代化、类型安全的 Web 开发体验。 