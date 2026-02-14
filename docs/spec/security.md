# Neton 安全规范 v1

> **定位**：定义 Neton 安全模块的架构、接口、注解与请求处理流程。与 [Neton-Core-Spec v1](./core.md) 第八节一致，并整合 [AuthenticationPrincipal注解设计](./authentication-principal-design.md) 的设计目标与优化方向。
>
> **参考**：历史安全设计（已统一为 Neton 命名）；本文以**当前实现**为准，差异与待优化项在文中注明。

---

## 一、概述与目标

### 1.1 设计目标

| 目标 | 描述 |
|------|------|
| **认证与授权分离** | Authenticator 负责「你是谁」，Guard 负责「你能做什么」 |
| **代码优先** | 支持 100% 代码注册认证/守卫逻辑，灵活可控 |
| **注解驱动** | 控制器或方法可标记 `@AllowAnonymous`、`@RolesAllowed`、`@RequireAuth`、`@AuthenticationPrincipal` |
| **统一 Principal 模型** | 登录用户信息标准化，支持后续授权、日志、审计 |
| **多种认证实现** | 支持 Session、JWT、Basic、Mock 等认证方案 |
| **可选配置驱动** | 对简单场景提供 security.conf 支持（非必须） |
| **Native-first** | 安全抽象层无 JVM 专有依赖，适配 Kotlin/Native 与协程 |

### 1.2 与设计文档的命名统一

- 设计文档中历史 **Kerisy** 已统一为 **Neton**
- **Guard** 在旧设计中用于认证（authenticate），当前实现中 **Authenticator** 负责认证、**Guard** 负责授权，本规范采用后者

---

## 二、核心接口

### 2.1 Principal（用户主体）

```kotlin
interface Principal {
    val id: String
    val roles: List<String>
    val attributes: Map<String, Any> get() = emptyMap()
    
    fun hasRole(role: String): Boolean
    fun hasAnyRole(vararg roles: String): Boolean
    fun hasAllRoles(vararg roles: String): Boolean
}
```

| 方法 | 说明 |
|------|------|
| `id` | 用户唯一标识 |
| `roles` | 角色列表 |
| `attributes` | 扩展属性（如 permissions、tenantId 等） |
| `hasRole` / `hasAnyRole` / `hasAllRoles` | 角色检查便捷方法 |

**v1 优化建议**：
- 新增 `hasPermission(permission: String): Boolean` 作为可选扩展，从 `attributes["permissions"]` 读取
- 提供 `UserPrincipal(id, roles, attributes)` 数据类实现

### 2.2 Authenticator（认证器）

```kotlin
interface Authenticator {
    suspend fun authenticate(context: RequestContext): Principal?
    val name: String
}
```

- **职责**：从请求中提取并验证身份（如 JWT、Session、Basic），返回 Principal 或 null
- **位置**：neton-core 定义接口，neton-security 提供实现

**当前实现状态**：
- **JwtAuthenticator** 已实现（见 [jwt-authenticator](./jwt-authenticator.md)）
- MockAuthenticator、AnonymousAuthenticator 已实现
- **SessionAuthenticator、BasicAuthenticator**：v1.1 计划，当前为 stub

### 2.3 Guard（守卫 / 授权器）

```kotlin
interface Guard {
    suspend fun authorize(principal: Principal?, context: RequestContext): Boolean
    val name: String
}
```

- **职责**：在已认证（或未认证）的前提下，检查是否有权访问当前资源
- **命名统一**：Core Spec 使用 `checkPermission`，neton-security 使用 `authorize`。**本规范建议**：统一为 `authorize`，更符合「授权」语义；若需与 Core 接口对齐，可保留 `checkPermission` 作为别名

**内置守卫**：

| 名称 | 说明 |
|------|------|
| DefaultGuard | principal != null 即允许 |
| PublicGuard / AnonymousGuard | 始终允许 |
| AdminGuard | principal.hasRole("admin") |
| RoleGuard(roles, requireAll) | 需指定角色之一或全部 |
| CustomGuard(name, authorizer) | 自定义 lambda |

### 2.4 RequestContext（请求上下文）

安全层使用的请求抽象，应由 HttpContext 适配：

```kotlin
interface RequestContext {
    val path: String
    val method: String
    val headers: Map<String, String>
    val routeGroup: String?
    fun getQueryParameter(name: String): String?
    fun getQueryParameters(): Map<String, List<String>>
    suspend fun getBodyAsString(): String?
    fun getSessionId(): String?
    fun getRemoteAddress(): String?
}
```

**v1 最小实现**：RequestContext 放在 neton-http，仅需 method/path/headers/query/cookies/sessionId/remoteAddr；body 暂不读。

### 2.5 AuthenticationContext

```kotlin
interface AuthenticationContext {
    fun currentUser(): Any?
}
```

- 供 ParameterBinder、业务代码等获取当前请求的 Principal
- 实现应基于**请求级存储**（如 HttpContext.attributes），而非全局 ThreadLocal

---

## 三、注解

### 3.1 安全注解一览

| 注解 | 作用目标 | 说明 |
|------|----------|------|
| `@AllowAnonymous` | CLASS, FUNCTION | 允许匿名访问，跳过认证要求 |
| `@RolesAllowed(roles)` | CLASS, FUNCTION | 需具备指定角色之一 |
| `@RequireAuth` | CLASS, FUNCTION | 需认证，不限定角色 |
| `@AuthenticationPrincipal(required)` | VALUE_PARAMETER | 注入当前 Principal |

### 3.2 @AuthenticationPrincipal

```kotlin
@Target(AnnotationTarget.VALUE_PARAMETER)
@Retention(AnnotationRetention.RUNTIME)
annotation class AuthenticationPrincipal(val required: Boolean = true)
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `required` | true | 未认证时抛异常 |
| `required = false` | - | 未认证时注入 null，须配合 `@AllowAnonymous` |

**用法示例**：

```kotlin
@Get("/profile")
fun getProfile(@AuthenticationPrincipal user: UserPrincipal): Response {
    return Response.ok("Hello ${user.id}")
}

@Get("/welcome")
@AllowAnonymous
fun welcome(@AuthenticationPrincipal(required = false) user: UserPrincipal?): Response {
    return if (user != null) Response.ok("欢迎回来，${user.id}！")
           else Response.ok("欢迎游客！")
}
```

### 3.3 注解与路由的绑定

- KSP/ControllerScanner 在生成路由时，将 `@AllowAnonymous`、`@RolesAllowed`、`@RequireAuth` 等信息写入 `RouteDefinition` 的元数据（或 `parameterBindings` 中的 `AuthenticationPrincipal`）
- 安全管道在执行前根据路由元数据决定：是否调用 Authenticator、是否调用 Guard、以及使用哪类 Guard

---

## 四、安全管道与请求流程

### 4.1 两种模式（v1.1 冻结语义）

**默认无认证 ≠ 安全管道不存在**。v1 需要：安全管道存在，但默认是 no-op（或默认允许）。

| 模式 | 条件 | 行为 |
|------|------|------|
| **模式 A** | Security 未安装（SecurityBuilder 不在 ctx） | currentUser() 返回 null；所有请求默认允许（等价 AllowAnonymous）；**但**若路由标注 @RequireAuth / @RolesAllowed → **fail-fast 500**（开发者错误：启用注解但未安装 SecurityComponent） |
| **模式 B** | Security 已安装 | 解析路由安全元数据；执行认证/授权；principal 写入 httpContext.attributes；401/403 返回 ErrorResponse |
| **fail-fast** | 已安装 Security 但 requireAuth 且无 Authenticator | **500**（配置错误），避免「永远 401」难排查 |

### 4.2 Guard 选择策略（v1.1 冻结）

| 条件 | 使用的 Guard | 说明 |
|------|-------------|------|
| `allowAnonymous == true` | PublicGuard | 永远 true，principal = null |
| `requireAuth == false` | PublicGuard | 默认开放 |
| `requireAuth == true` | DefaultGuard | principal != null 才允许 |

**注意**：DefaultGuard 仅用于 requireAuth 的路由；对默认开放路由，不应因 principal==null 就 403。

### 4.3 理想流程（v1.1 目标）

```
handleRoute(...)
  ├─ build HttpContext
  ├─ build HandlerArgs
  ├─ security pre-handle（新增）
  │     ├─ 从 RouteDefinition 读取 allowAnonymous、requireAuth
  │     ├─ if allowAnonymous → principal=null，attributes["principal"]=null，直接通过
  │     ├─ else if 未安装 Security:
  │     │     if requireAuth → 500（配置错误）
  │     │     else → 通过（默认开放）
  │     ├─ else（已安装 Security）:
  │     │     principal = authenticator.authenticate(requestContext)
  │     │     if principal==null && requireAuth → 401
  │     │     attributes["principal"] = principal
  │     │     guard = requireAuth ? DefaultGuard : PublicGuard
  │     │     if !guard.authorize(principal, requestContext) → 403
  ├─ handler.invoke(...)
  └─ respond
```

### 4.4 当前实现状态（v1.1 已落地）

| 环节 | 状态 | 说明 |
|------|------|------|
| 安全管道 | ✅ 已集成 | HTTP 适配器 handleRoute 在 handler.invoke 前调用 runSecurityPreHandle |
| 认证执行 | ✅ 已集成 | Authenticator.authenticate(requestContext) |
| principal 存储 | ✅ 已实现 | HttpContext.attributes["principal"] |
| Guard 执行 | ✅ 已集成 | requireAuth→DefaultGuard，else→PublicGuard |
| fail-fast | ✅ 已实现 | 未安装 Security + @RequireAuth → 500；已安装但无 Authenticator + @RequireAuth → 500 |
| @AuthenticationPrincipal | ✅ 已实现 | KSP 生成代码从 context.getAttribute("principal") 读取 |
| SecurityContext | ⚠️ 辅助 | 主路径用 attributes；非 HTTP 场景可用 SecurityContext |

### 4.5 异常与 HTTP 状态

| 场景 | HTTP 状态 | 说明 |
|------|-----------|------|
| 需认证但 principal 为 null | 401 Unauthorized | 认证失败或未提供凭证 |
| principal 存在但 Guard 拒绝 | 403 Forbidden | 无权限 |
| @AuthenticationPrincipal(required=true) 且 principal 为 null | 401 | 在参数绑定时即可抛出 |
| @RequireAuth 但未安装 Security | 500 | fail-fast，message 含 "SecurityComponent" |
| @RequireAuth 但未注册 Authenticator | 500 | fail-fast，message 含 "Authenticator" |

**异常类型建议**：
- `AuthenticationException`：认证失败
- `AuthorizationException`：授权失败（Guard 拒绝）
- 适配器将二者映射为 401/403 及 ErrorResponse

---

## 五、SecurityBuilder 与配置

### 5.1 SecurityBuilder 接口（neton-core）

```kotlin
interface SecurityBuilder {
    fun getSecurityFactory(): SecurityFactory
    fun registerMockAuthenticator(...)
    fun registerJwtAuthenticator(...)
    fun registerSessionAuthenticator(...)
    fun registerBasicAuthenticator(...)
    fun bindDefaultGuard() / bindAdminGuard() / bindRoleGuard(...) / bindAnonymousGuard()
    fun registerAuthenticator(...) / bindGuard(...)
    fun build(): SecurityConfiguration
    fun getAuthenticationContext(): AuthenticationContext
}
```

- `build()` 在启动时被调用，产出 `SecurityConfiguration` 和 `AuthenticationContext`
- `AuthenticationContext` 注入 RequestEngine / ParameterBinder，供参数解析使用
- **v1.1 约束**：AuthenticationContext 的实现必须从**当前请求的 HttpContext** 读取 principal，而非全局单例

### 5.2 代码优先配置示例

```kotlin
install(SecurityComponent()) {
    registerAuthenticator(JwtAuthenticator(secretKey = "xxx"))
    bindDefaultGuard()
    bindGuard("admin", AdminGuard())
    bindGuard("admin", "admin", CustomGuard("admin") { principal, ctx ->
        principal?.hasRole("admin") == true
    })
}
```

### 5.3 配置文件（security.conf）

```toml
[security]
enabled = true
defaultGuard = "default"

[security.jwt]
secretKey = "your-secret"
headerName = "Authorization"
tokenPrefix = "Bearer "
```

- v1 可选；若使用，由 SecurityComponent 在 init 时通过 ConfigLoader 读取
- 优先级：CLI/ENV > security.&lt;env&gt;.conf > security.conf > 代码默认值

---

## 六、SecurityContext 与请求级 Principal 存储

### 6.1 问题

- `SecurityContext` 当前为 ThreadLocal 风格，在 Kotlin/Native、协程环境下无法可靠传递请求级 principal
- 多请求并发时，若依赖全局 `currentPrincipal`，可能串请求

### 6.2 方案（v1.1 冻结）

| 存储位置 | 说明 |
|----------|------|
| **HttpContext.attributes["principal"]** | 请求级存储，适配器在安全预处理后写入 |
| **AuthenticationContext** | 实现从 `HttpContext`（通过某种方式获取当前请求的 context）读取 attributes["principal"] |
| **SecurityContext** | 仅作为「在已设置 HttpContext 的前提下」的便捷封装，内部委托给当前 HttpContext；或标记为 deprecated，推荐直接用 `@AuthenticationPrincipal` 或 `context.getAttribute("principal")` |

**传递方式**：handleRoute 内持有 `httpContext`，在调用 ParameterBinder 或 handler 前，将 `httpContext` 与当前协程/请求绑定（如通过 CoroutineContext 或显式传参），使 AuthenticationContext 能解析到「当前请求的 HttpContext」。

### 6.3 SecurityContext 保留场景

- 在**非请求上下文**（如定时任务、消息处理）中，若需要「当前用户」语义，可由调用方显式 `SecurityContext.setPrincipal`，用完 `clear()`。此场景为辅助用途，不作为主路径。

---

## 七、内置认证器实现状态

| 认证器 | 状态 | 说明 |
|--------|------|------|
| MockAuthenticator | ✅ 已实现 | 返回固定用户 |
| AnonymousAuthenticator | ✅ 已实现 | 返回 null |
| SessionAuthenticator | ⚠️ 占位 | 需与 HttpSession 集成，从 session 取 user_id 并加载 Principal |
| JwtAuthenticator | ⚠️ 占位 | 需引入 JWT 库（如 kotlin-jwt），解析并校验 token |
| BasicAuthenticator | ⚠️ 占位 | 需 Base64 解码 + 调用 userProvider |

---

## 八、与 HTTP / 路由的关系

### 8.1 与 Neton-Http-Spec 的关系

- 安全管道在 **handleRoute** 内、**handler.invoke 之前**执行
- HttpContext 作为请求级数据总线，principal 存于 attributes
- 认证/授权异常由适配器转换为 HttpException(UNAUTHORIZED/FORBIDDEN) 及 ErrorResponse

### 8.2 与 ParameterBinding 的关系

- `ParameterBinding.AuthenticationPrincipal` 由 KSP 根据 `@AuthenticationPrincipal` 生成
- ParameterBinder 从 AuthenticationContext.currentUser() 解析，并检查 required
- **依赖**：AuthenticationContext 必须先由安全管道填充，否则恒为 null

### 8.3 路由组与多认证

- SecurityRegistry 支持按 `routeGroup` 绑定不同 Authenticator/Guard
- 控制器 `@Controller("/admin")` 可对应 routeGroup = "admin"，使用 AdminGuard 或 JWT
- 当前路由组解析需在 ControllerScanner/KSP 或 RouteDefinition 中体现，与安全模块对接

---

## 九、优化与改进清单

### 9.0 契约测试（P0.5 已落地）

`neton-http/src/commonTest/SecurityPipelineContractTest.kt` 锁住：

- **Test 1**：Mode A 默认开放（无 Security，普通路由 → 通过）
- **Test 2**：Mode A + @RequireAuth fail-fast（无 Security → 500，message 含 "SecurityComponent"）
- **Test 3**：Mode B + MockAuthenticator（principal 写入 attributes）
- **Test 4**：AllowAnonymous 永远放行（principal 为 null）
- **Test 5**：已安装但无 Authenticator + @RequireAuth → 500（message 含 "Authenticator"）

### 9.1 P0（必须）

| 项 | 说明 |
|----|------|
| 集成认证管道 | 在 handleRoute 中，路由匹配后、handler 前调用 Authenticator，并将 principal 写入 HttpContext.attributes |
| 集成授权管道 | 在认证之后、handler 前根据路由元数据调用 Guard，失败返回 403 |
| 请求级 principal 存储 | AuthenticationContext 从当前 HttpContext 读取 principal，而非返回 null |
| Guard 命名统一 | Core 与 neton-security 统一为 `authorize` 或 `checkPermission`，二选一并在文档中冻结 |

### 9.2 P1（高优）

| 项 | 说明 |
|----|------|
| HttpContext → RequestContext 适配 | 提供 RequestContext 或 HttpContextAdapter，供 Authenticator/Guard 使用 |
| SessionAuthenticator 实现 | 与 HttpSession 集成，支持 session 存储 user_id |
| JwtAuthenticator 实现 | 引入 JWT 库，完成 token 解析与校验 |
| 异常类型 | 定义 AuthenticationException、AuthorizationException，并在适配器中映射 401/403 |
| @AllowAnonymous / @RolesAllowed 生效 | 确保 KSP 生成的路由元数据被安全管道读取并正确选择 Guard |

### 9.3 P2（中优）

| 项 | 说明 |
|----|------|
| BasicAuthenticator 实现 | Base64 解码 + userProvider 回调 |
| security.conf 支持 | 通过 ConfigLoader 加载 security 模块配置 |
| Principal.hasPermission | 可选扩展，便于基于权限的细粒度控制 |
| SecurityContext 明确用途 | 文档化：仅辅助场景使用，主路径用 @AuthenticationPrincipal 或 HttpContext.attributes |

### 9.4 P3（后续）

| 项 | 说明 |
|----|------|
| @PreAuthorize / @PostAuthorize | 表达式式授权注解 |
| 多 Authenticator 链 | 按顺序尝试多个 Authenticator |
| CSRF / CORS | 若需 Web 表单安全，可扩展 |
| Rate Limiting | 与安全模块解耦，可由独立中间件实现 |

---

## 十、文档与规范引用

- **Neton-Core-Spec v1**：第八节（安全接口）、第九节（注解）
- **Neton-Http-Spec v1**：第五节（请求处理流程）、第七节（与安全的关系）
- **AuthenticationPrincipal注解设计**：用法与最佳实践
- **Security模块设计**：设计目标与 Guard 注册方式

---

## 十一、v1.1 API 冻结（命名与注入优化）

> 详见 **[Neton-Security-Spec-v1.1-API-Freeze](./security-v1.1-freeze.md)**

| 变更 | v1.1 |
|------|------|
| ID 类型 | `UserId`（value class 包 ULong） |
| 注解 | `@CurrentUser` |
| 抽象 | `Identity`（id: UserId, roles: Set, permissions: Set） |
| 默认实现 | `IdentityUser` 可选，供框架 Authenticator 使用 |
| 注入 | 类型自动注入，注解可选 |

旧命名（`Principal`、`UserPrincipal`、`@AuthenticationPrincipal`）已删除，无兼容层。

---

*文档版本：v1*
*与实现差异：第四节、第六节、第七节、第九节描述了当前缺口与改进方向，实现需按 P0→P1→P2 顺序落地。*
