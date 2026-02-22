# Neton 安全规范

> **定位**：定义 Neton 安全模块的架构、接口、注解、JWT 认证器、请求处理流程与契约测试。
>
> **原则**：Native-first、轻量、类型安全、单点 fail-fast。

---

## 一、概述与目标

### 1.1 设计目标

| 目标 | 描述 |
|------|------|
| **认证与授权分离** | Authenticator 负责「你是谁」，Guard + @Permission 负责「你能做什么」 |
| **代码优先** | 支持 100% 代码注册认证/守卫逻辑，灵活可控 |
| **注解驱动** | 控制器或方法可标记 `@AllowAnonymous`、`@RolesAllowed`、`@RequireAuth`、`@Permission`、`@CurrentUser` |
| **统一 Identity 模型** | 登录用户信息标准化（id、roles、permissions），支持后续授权、日志、审计 |
| **权限评估可扩展** | `PermissionEvaluator` fun interface，业务可替换实现 superadmin 等逻辑 |
| **多种认证实现** | 支持 Session、JWT、Basic、Mock 等认证方案 |
| **Native-first** | 安全抽象层无 JVM 专有依赖，适配 Kotlin/Native 与协程 |

---

## 二、类型体系

### 2.1 UserId（强类型 ID）

```kotlin
@JvmInline
value class UserId(val value: ULong) {
    companion object {
        fun parse(s: String): UserId = UserId(s.toULong())
    }
}
```

JWT / header / session 拿到的永远是 string，Authenticator 从 token 读出 `sub` 后调用 `UserId.parse(sub)` 得到 `UserId`。

**UserId.parse 错误语义**：

| 场景 | 异常 | HTTP 映射 |
|------|------|-----------|
| 解析失败（来自 token/session） | `AuthenticationException(code="InvalidUserId", message="Invalid user id", path="sub")` | 401 |
| 解析失败（来自配置或内部调用） | 同上或 `ConfigTypeException` | 500 |

**AuthenticationException 结构**：

| 字段 | InvalidUserId 时 | 说明 |
|------|-----------------|------|
| `code` | `"InvalidUserId"` | 必须一致，禁止 "INVALID_USER_ID" 等变体 |
| `message` | `"Invalid user id"` | 必须一致，供 ErrorResponse.body 和客户端国际化 |
| `path` | `"sub"` | JWT/sub 场景必须设置；配置错误场景可选 |

认证语义不应映射 400。parse 不得返回 nullable 或 silent fallback。

### 2.2 Identity（用户身份）

```kotlin
// neton-core 定义
interface Identity {
    val id: String
    val roles: Set<String>
    val permissions: Set<String>

    fun hasRole(role: String): Boolean = role in roles
    fun hasPermission(p: String): Boolean = p in permissions
    fun hasAnyRole(vararg rs: String): Boolean = rs.any { it in roles }
    fun hasAllRoles(vararg rs: String): Boolean = rs.all { it in roles }
    fun hasAnyPermission(vararg ps: String): Boolean = ps.any { it in permissions }
    fun hasAllPermissions(vararg ps: String): Boolean = ps.all { it in permissions }
}
```

| 属性 | 说明 |
|------|------|
| `id` | 用户唯一标识（String） |
| `roles` | 角色集合（Set，大小写敏感） |
| `permissions` | 权限集合（Set，大小写敏感，推荐 `module:action` 格式） |

**继承链**：
- neton-core: `Identity { id: String, roles: Set, permissions: Set }`
- neton-security: `Identity : core.Identity { userId: UserId; override val id = userId.value.toString() }`
- `IdentityUser(userId, roles, permissions)` — 默认实现数据类

**roles 与 permissions 定位**：

| 维度 | roles | permissions |
|------|-------|-------------|
| 粒度 | 粗（路由组/模块级） | 细（操作级） |
| Guard | @RolesAllowed | @Permission / PermissionEvaluator |
| 典型使用 | AdminGuard、RoleGuard | 业务内 hasPermission 检查 |

**权限字符串格式**：`resource:action`（如 `user:read`、`order:pay`）。不做 hierarchy/通配符。

**roles/permissions 大小写**：统一按原样（case-sensitive）比较，必须由 issuer（token/session/DB）自行规范化，Neton 不做自动 lowercase。

**不引入 attributes**：Identity 不包含 `attributes: Map&lt;String, Any?&gt;`，避免类型不安全、序列化困难。

### 2.3 IdentityUser（默认实现）

```kotlin
data class IdentityUser(
    override val userId: UserId,
    override val roles: Set<String> = emptySet(),
    override val permissions: Set<String> = emptySet()
) : Identity
```

从 JWT array / List 构造时，必须对 roles/permissions 做 `toSet()`，保证去重。`toSet()` 仅去重完全相同字符串，不做 normalize。

**用途**：MockAuthenticator、JwtAuthenticator、SessionAuthenticator 在无需查库时直接返回。业务应实现自己的 `User : Identity`，由 Authenticator 通过 UserService 加载。

---

## 三、核心接口

### 3.1 Authenticator（认证器）

```kotlin
interface Authenticator {
    val name: String
    suspend fun authenticate(context: RequestContext): Identity?
}
```

- **职责**：从请求中提取并验证身份（如 JWT、Session、Basic），返回 Identity 或 null
- **位置**：neton-core 定义接口，neton-security 提供实现

**当前实现状态**：

| 认证器 | 状态 | 说明 |
|--------|------|------|
| MockAuthenticator | ✅ 已实现 | 返回固定 Identity |
| JwtAuthenticatorV1 | ✅ 已实现 | HS256，解析 sub/roles/perms |
| SessionAuthenticator | ⚠️ 占位 | 需与 HttpSession 集成 |
| BasicAuthenticator | ⚠️ 占位 | 需 Base64 解码 + userProvider |

### 3.2 Guard（守卫 / 授权器）

```kotlin
interface Guard {
    suspend fun checkPermission(identity: Identity?, context: RequestContext): Boolean
}
```

- **职责**：在已认证（或未认证）的前提下，检查是否有权访问当前资源

**内置守卫**：

| 名称 | 说明 |
|------|------|
| RequireIdentityGuard | identity != null 即允许 |
| AllowAllGuard | 始终允许 |
| DefaultGuard | identity != null 即允许 |
| PublicGuard | 始终允许 |
| AdminGuard | identity.hasRole("admin") |
| RoleGuard(roles, requireAll) | 需指定角色之一或全部 |
| CustomGuard(name, authorizer) | 自定义 lambda |

### 3.3 PermissionEvaluator（权限评估器）

```kotlin
fun interface PermissionEvaluator {
    fun allowed(identity: Identity, permission: String, context: RequestContext): Boolean
}
```

- **职责**：当路由标注 `@Permission("x:y")` 时，判定是否放行
- **默认行为**（未设置自定义 evaluator 时）：`identity.hasPermission(permission)`
- **典型扩展**：superadmin 绕过所有权限检查

```kotlin
security {
    setPermissionEvaluator { identity, permission, context ->
        identity.hasRole("superadmin") || identity.hasPermission(permission)
    }
}
```

### 3.4 SecurityAttributes（属性常量）

```kotlin
object SecurityAttributes {
    const val IDENTITY = "identity"
}
```

全链路统一使用 `SecurityAttributes.IDENTITY` 作为 HttpContext 属性键，禁止硬编码字符串。

| 位置 | 引用方式 |
|------|----------|
| SecurityPreHandle（setAttribute / removeAttribute） | `SecurityAttributes.IDENTITY` |
| ParameterResolver（CurrentUserResolver） | `SecurityAttributes.IDENTITY` |
| KSP 生成代码（getAttribute） | `SecurityAttributes.IDENTITY` |
| 契约测试（getAttribute 断言） | `SecurityAttributes.IDENTITY` |

### 3.5 RequestContext（请求上下文）

```kotlin
interface RequestContext {
    val path: String
    val method: String
    val headers: Map<String, String>
    val routeGroup: String?
}
```

---

## 四、注解

### 4.1 安全注解一览

| 注解 | 作用目标 | 说明 |
|------|----------|------|
| `@AllowAnonymous` | CLASS, FUNCTION | 允许匿名访问，优先级最高 |
| `@RequireAuth` | CLASS, FUNCTION | 需认证，不限定角色 |
| `@RolesAllowed(roles)` | CLASS, FUNCTION | 需具备指定角色之一 |
| `@Permission(value)` | CLASS, FUNCTION | 需具备指定权限，方法级覆盖类级 |
| `@CurrentUser(required)` | VALUE_PARAMETER | 注入当前 Identity |

### 4.2 @CurrentUser

```kotlin
@Target(AnnotationTarget.VALUE_PARAMETER)
@Retention(AnnotationRetention.RUNTIME)
annotation class CurrentUser(val required: Boolean = true)
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `required` | true | 未认证时抛异常 |
| `required = false` | - | 未认证时注入 null，须配合 `@AllowAnonymous` |

**注入规则**（优先级从高到低）：

| 优先级 | 规则 | 示例 |
|--------|------|------|
| 1 | 显式 `@CurrentUser` | `@CurrentUser user: User` |
| 2 | 参数类型为 `Identity` 或其子类 → 自动注入 | `user: User` |
| 3 | 可空类型 → `required = false` | `user: User?` |

**KSP 生成代码**：

```kotlin
// 非空 Identity
context.getAttribute(SecurityAttributes.IDENTITY) as Identity

// 可空 Identity
context.getAttribute(SecurityAttributes.IDENTITY) as? Identity
```

### 4.3 @Permission

```kotlin
@Target(AnnotationTarget.FUNCTION, AnnotationTarget.CLASS)
@Retention(AnnotationRetention.RUNTIME)
annotation class Permission(val value: String)
```

**继承与覆盖规则**：

| 场景 | 生效的 permission |
|------|-------------------|
| 仅类级 `@Permission("a")` | `"a"` |
| 仅方法级 `@Permission("b")` | `"b"` |
| 类级 `@Permission("a")` + 方法级 `@Permission("b")` | `"b"`（方法覆盖类） |
| 无 `@Permission` | `null`（不触发权限检查） |

**多注解 fail-fast**：同一方法或同一类上出现多个 `@Permission` 注解，KSP 编译期报错，拒绝生成代码。如需同时要求多个权限，使用组合 key（如 `@Permission("system:user:edit+delete")`），在 PermissionEvaluator 中解析。

### 4.4 @CurrentUser 使用示例

**必需认证模式**：

```kotlin
@Get("/profile")
@RequireAuth
fun getProfile(@CurrentUser identity: Identity): String {
    return "Hello ${identity.id}, 角色: ${identity.roles.joinToString(", ")}"
}
```

**可选认证模式**：

```kotlin
@Get("/welcome")
@AllowAnonymous
fun welcome(@CurrentUser(required = false) identity: Identity?): String {
    return if (identity != null) "欢迎回来，${identity.id}！" else "欢迎游客用户！"
}
```

**类型自动注入（无需注解）**：

```kotlin
@Get("/dashboard")
@RequireAuth
fun dashboard(identity: Identity): String {
    // identity 自动从 HttpContext 注入
    return "用户 ${identity.id} 的仪表板"
}
```

**与 @Permission 结合**：

```kotlin
@Get("/dashboard")
@RequireAuth
@Permission("admin:dashboard:view")
fun dashboard(@CurrentUser identity: Identity): String {
    return "管理员 ${identity.id} 的仪表板"
}
```

**与传统方式对比**：

| 方面 | 传统方式 | @CurrentUser |
|------|----------|-------------|
| **代码量** | 多行样板代码 | 单行注解（或零注解） |
| **类型安全** | 需要手动 cast | 编译时类型检查 |
| **可读性** | 隐含的用户依赖 | 方法签名明确表达依赖 |
| **测试友好** | 需要模拟 HttpContext | 直接传入 Identity 对象 |

### 4.5 @CurrentUser 实现原理

**1. KSP 编译期处理**

KSP ControllerProcessor 在扫描方法参数时：
- 参数类型为 `Identity`（或其子类型） → 自动识别为用户注入
- 参数带 `@CurrentUser` 或 `@AuthenticationPrincipal`（兼容） → 标记为用户注入

**2. 生成代码**

KSP 生成的路由处理代码统一使用 `SecurityAttributes.IDENTITY` 常量，不使用硬编码字符串：

```kotlin
// 非空 Identity
context.getAttribute(SecurityAttributes.IDENTITY) as Identity

// 可空 Identity
context.getAttribute(SecurityAttributes.IDENTITY) as? Identity
```

**3. 安全管道写入**

安全管道（`runSecurityPreHandle`）在认证成功后：

```kotlin
httpContext.setAttribute(SecurityAttributes.IDENTITY, identity)
```

### 4.6 @CurrentUser 最佳实践

**优先使用类型自动注入**：

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

**测试友好的设计**：

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

---

## 五、安全管道与请求流程

### 5.1 两种模式

| 模式 | 条件 | 行为 |
|------|------|------|
| **模式 A** | Security 未安装 | identity 为 null；所有请求默认允许；**但** @RequireAuth → **fail-fast 500** |
| **模式 B** | Security 已安装 | 解析路由安全元数据；执行认证/授权；identity 写入 httpContext |

### 5.2 安全管道流程

```
runSecurityPreHandle(route, httpContext, requestContext, securityConfig, routeGroupConfigs)
  │
  ├─ 1. 计算 isAnonymousAllowed：
  │     @AllowAnonymous → true
  │     OR route.pattern in groupConfig.allowAnonymous → true
  │     OR (!groupConfig.requireAuth && !route.requireAuth && route.permission == null) → true
  │     → 如果 true：removeAttribute(IDENTITY)，return
  │
  │     **冻结规则：permission implies auth**
  │     route.permission != null 时，即使路由组 requireAuth=false，
  │     也不视为匿名允许，强制走认证流程。
  │
  ├─ 2. fail-fast（安全未配置 + requireAuth → 500）
  │
  ├─ 3. 认证：
  │     authenticator.authenticate(requestContext) → identity
  │     identity == null && requireAuth → 401
  │
  ├─ 4. 存储 identity：
  │     httpContext.setAttribute(SecurityAttributes.IDENTITY, identity)
  │
  ├─ 5. 权限检查（仅当 route.permission != null）：
  │     evaluator.allowed(identity, permission, ctx) → false → 403
  │     identity == null → 401
  │
  └─ 6. Guard 检查：
        guard.checkPermission(identity, requestContext) → false → 403
```

**优先级**：`@AllowAnonymous` > 路由组白名单 > `@Permission`（隐含认证） > `group.requireAuth`

### 5.3 Guard 选择策略

| 条件 | 使用的 Guard | 说明 |
|------|-------------|------|
| `allowAnonymous == true` | 跳过（直接返回） | identity 为 null |
| `requireAuth == true` | RequireIdentityGuard（或自定义） | identity != null 才允许 |
| `requireAuth == false` | AllowAllGuard | 默认开放 |

### 5.4 异常与 HTTP 状态

| 场景 | HTTP 状态 | 说明 |
|------|-----------|------|
| 需认证但 identity 为 null | 401 Unauthorized | 认证失败或未提供凭证 |
| identity 存在但 Guard 拒绝 | 403 Forbidden | 无权限 |
| @Permission 权限不足 | 403 Forbidden | message 含具体权限名 |
| @Permission 但 identity 为 null | 401 Unauthorized | 未认证 |
| @RequireAuth 但未安装 Security | 500 | fail-fast，message 含 "SecurityComponent" |
| @RequireAuth 但未注册 Authenticator | 500 | fail-fast，message 含 "Authenticator" |
| @Permission 但未认证（开放组） | 401 | permission implies auth，即使组级 requireAuth=false |
| @Permission 但未安装 Security | 500 | fail-fast，与 @RequireAuth 同理 |

---

## 六、SecurityBuilder 与配置

### 6.1 SecurityBuilder 接口（neton-core）

```kotlin
interface SecurityBuilder {
    fun registerMockAuthenticator(name: String, userId: String, roles: Set<String>, permissions: Set<String>)
    fun registerJwtAuthenticator(secretKey: String, headerName: String, tokenPrefix: String)
    fun setDefaultGuard(guard: Guard)
    fun setDefaultAuthenticator(auth: Authenticator)
    fun setGroupAuthenticator(group: String, auth: Authenticator)
    fun setGroupGuard(group: String, guard: Guard)
    fun setPermissionEvaluator(evaluator: PermissionEvaluator)
    fun build(): SecurityConfiguration
    fun getAuthenticationContext(): AuthenticationContext
}
```

### 6.2 SecurityConfiguration

```kotlin
data class SecurityConfiguration(
    val isEnabled: Boolean,
    val authenticatorCount: Int,
    val guardCount: Int,
    val authenticationContext: AuthenticationContext,
    val defaultAuthenticator: Authenticator?,
    val defaultGuard: Guard?,
    val getAuthenticatorByGroup: ((String?) -> Authenticator?)?,
    val getGuardByGroup: ((String?) -> Guard?)?,
    val permissionEvaluator: PermissionEvaluator?
)
```

---

## 七、路由组安全配置

### 7.1 routing.conf 新字段

```toml
[[groups]]
group = "admin"
mount = "/admin"
requireAuth = true
allowAnonymous = ["/login", "/health"]

[[groups]]
group = "app"
mount = "/app"
```

### 7.2 RouteGroupSecurityConfig

```kotlin
data class RouteGroupSecurityConfig(
    val requireAuth: Boolean,
    val allowAnonymous: Set<String>
)

data class RouteGroupSecurityConfigs(
    val configs: Map<String, RouteGroupSecurityConfig>
)
```

RoutingComponent 启动时解析 routing.conf，构建 `RouteGroupSecurityConfigs` 并绑定到 ctx。安全管道通过 ctx 获取。

### 7.3 优先级规则

```
@AllowAnonymous（注解） > allowAnonymous（白名单） > group.requireAuth > route.requireAuth
```

---

## 八、JWT Authenticator 规范

### 8.1 范围

| 项 | 说明 |
|----|------|
| Header | `Authorization: Bearer <token>` |
| 算法 | HS256（唯一支持） |
| Claim | sub / roles / perms |
| 时间 | 仅校验 exp |
| 错误 | AuthenticationException(code, path) → 401 |

### 8.2 Header 解析

| 规则 | 说明 |
|------|------|
| 无 Authorization | 返回 null，不抛异常（交给 Guard） |
| 非 Bearer 前缀 | 返回 null |
| Bearer 后无 token | `AuthenticationException(code="MissingToken", path="Authorization")` → 401 |
| 多余空格 | Bearer 与 token 之间单空格，trim 后解析 |

### 8.3 Claim 规则

| Claim | 类型 | 缺失时 | 错误时 |
|-------|------|--------|--------|
| sub | string | InvalidUserId | UserId.parse 抛 InvalidUserId |
| roles | string[] | emptySet() | 非 list → emptySet，list 中非 string → 忽略 |
| perms | string[] | emptySet() | 非 list → emptySet，list 中非 string → 忽略 |

JWT Claim 格式：

```json
{
  "sub": "123",
  "roles": ["admin"],
  "perms": ["user:read", "user:write"]
}
```

roles/perms 缺失时默认 `emptySet()`，不报错、不抛异常。

**权限信任边界**：

| 模式 | 说明 |
|------|------|
| 模式 1（token 权威） | JWT 里的 roles/perms 直接信任，无状态（默认允许） |
| 模式 2（DB 权威） | JWT 只携带 userId，roles/perms 服务端查库加载（业务需实现 User : Identity） |

### 8.4 时间校验

| Claim | 行为 |
|-------|------|
| exp | 必须校验，过期 → `AuthenticationException(code="TokenExpired", path="exp")` → 401 |
| nbf | 不校验 |
| iat | 不校验 |

exp 使用秒级 epoch（NumericDate）。exp 缺失、类型错 → 按过期处理（TokenExpired）。使用系统时钟，无 clock skew 配置。

### 8.5 签名与算法

| 项 | 说明 |
|----|------|
| 算法 | HS256 |
| 密钥 | 配置传入（String 或 ByteArray） |
| 算法不匹配 | `AuthenticationException(code="InvalidAlgorithm", path="alg")` → 401 |
| 签名无效 | `AuthenticationException(code="InvalidSignature", path="")` → 401 |

header.alg 必须严格等于 `"HS256"`（大小写敏感）。签名比较必须 constant-time：

```kotlin
fun constantTimeEquals(a: ByteArray, b: ByteArray): Boolean {
    if (a.size != b.size) return false
    var r = 0
    for (i in a.indices) r = r or (a[i].toInt() xor b[i].toInt())
    return r == 0
}
```

### 8.6 解析失败映射规则

按失败发生顺序：

| 失败场景 | code | path |
|----------|------|------|
| 无 Authorization | 返回 null，不抛 | |
| 非 Bearer 前缀 | 返回 null | |
| Bearer 后无 token | MissingToken | Authorization |
| token 三段不合法 | MissingToken | Authorization |
| base64url decode 失败 | MissingToken | Authorization |
| header/payload JSON 解析失败 | MissingToken | Authorization |
| header.alg != "HS256" | InvalidAlgorithm | alg |
| sub 缺失或空字符串 | InvalidUserId | sub |
| sub 非法（UserId.parse 失败） | InvalidUserId | sub |
| exp 缺失/类型错/过期 | TokenExpired | exp |
| signature 校验失败 | InvalidSignature | (空) |

### 8.7 AuthenticationException 完整映射

| code | path | message |
|------|------|---------|
| MissingToken | Authorization | Missing or invalid Bearer token |
| InvalidUserId | sub | Invalid user id |
| TokenExpired | exp | Token has expired |
| InvalidAlgorithm | alg | Unsupported algorithm |
| InvalidSignature | (空) | Invalid signature |

### 8.8 Adapter 桥接层

JWT 认证采用双层架构：

| 层 | 类名 | 接口 | 职责 |
|----|------|------|------|
| 底层实现 | `JwtAuthenticatorV1` | `neton.security.Authenticator` | 核心 JWT 解析、验签、Claim 提取 |
| 桥接适配 | `JwtAuthenticatorAdapter` | `neton.core.interfaces.Authenticator` | 将 neton-core 的 `RequestContext` 适配为 neton-security 的 `RequestContext`，委托 V1 执行 |

```kotlin
class JwtAuthenticatorAdapter(
    secretKey: String,
    headerName: String = "Authorization",
    tokenPrefix: String = "Bearer "
) : neton.core.interfaces.Authenticator {
    override val name = "jwt"
    private val delegate = JwtAuthenticatorV1(secretKey, headerName, tokenPrefix)

    override suspend fun authenticate(context: neton.core.interfaces.RequestContext): Identity? {
        val securityContext = // 适配 RequestContext 接口
        return try {
            delegate.authenticate(securityContext)
        } catch (e: AuthenticationException) {
            null  // Adapter 层吞掉异常，返回 null
        }
    }
}
```

**关键语义**：
- `JwtAuthenticatorV1` 在 token 异常时抛 `AuthenticationException`（code/path/message）
- `JwtAuthenticatorAdapter` 捕获所有 `AuthenticationException` 并返回 `null`，符合 neton-core `Authenticator` 的契约（认证失败返回 null，由安全管道决定 401/403）
- `SecurityPreHandle` 收到 null identity 时根据 requireAuth 决定是否 401

### 8.9 命名规范（beta1 冻结）

| 旧名 | 新名 | 模式 |
|------|------|------|
| ~~RealJwtAuthenticator~~ | `JwtAuthenticatorAdapter` | Adapter（桥接两个不同 RequestContext 接口） |
| ~~RealMockAuthenticator~~ | `MockAuthenticatorAdapter` | Adapter |
| ~~RealSessionAuthenticator~~ | `SessionAuthenticatorAdapter` | Adapter |
| ~~RealBasicAuthenticator~~ | `BasicAuthenticatorAdapter` | Adapter |
| ~~RealSecurityBuilder~~ | `SecurityBuilderImpl` | Impl（同一接口的实现） |
| ~~RealAuthenticationContext~~ | `AuthenticationContextImpl` | Impl |
| ~~RealDefaultGuard~~ | `DefaultGuardImpl` | Impl |
| ~~RealAdminGuard~~ | `AdminGuardImpl` | Impl |
| ~~RealRoleGuard~~ | `RoleGuardImpl` | Impl |
| ~~RealAnonymousGuard~~ | `AnonymousGuardImpl` | Impl |

**选择标准**：桥接两个不同接口 → `*Adapter`；同一接口的标准实现 → `*Impl`。

### 8.10 实现清单

| 项 | 说明 |
|----|------|
| 1 | 解析 Authorization header，提取 Bearer token |
| 2 | Base64Url 解码 payload，析出 sub/roles/perms |
| 3 | sub 缺失/空 → InvalidUserId；sub 非法 → UserId.parse 抛 InvalidUserId |
| 4 | roles/perms 缺失或非 list → emptySet；list 中非 string 忽略 |
| 5 | exp 缺失/类型错/过期 → TokenExpired；exp 单位秒 |
| 6 | alg != "HS256" → InvalidAlgorithm |
| 7 | HS256 验签 |
| 8 | 构造 IdentityUser(id, roles.toSet(), perms.toSet()) |
| 9 | 契约测试：各 code 对应 path/message 稳定 |

**实现建议**：不要手写 HMAC-SHA256，使用 Native 可用 crypto 库（如 cryptography-kotlin：CommonCrypto/OpenSSL）封装极薄的 HS256 verifier。

---

## 九、请求级 Identity 存储

| 存储位置 | 说明 |
|----------|------|
| **HttpContext.attributes[SecurityAttributes.IDENTITY]** | 请求级存储，安全管道认证后写入 |
| **@CurrentUser 注入** | KSP 生成代码从 `context.getAttribute(SecurityAttributes.IDENTITY)` 读取 |
| **SecurityContext** | 辅助封装，内部委托给 HttpContext；主路径推荐直接用 `@CurrentUser` |

---

## 十、业务用法示例

### 10.1 业务层 User 实现 Identity

```kotlin
data class User(
    override val userId: UserId,
    override val roles: Set<String>,
    override val permissions: Set<String>,
    val email: String,
    val nickname: String
) : Identity

@Get("/profile")
fun profile(user: User): Profile = Profile(user.userId, user.nickname)
```

### 10.2 细粒度权限检查

```kotlin
@Get("/users/{id}")
@RequireAuth
fun getUser(id: UserId, user: User): UserDetail {
    if (!user.hasPermission("user:read")) throw ForbiddenException()
    return userService.findById(id)
}
```

### 10.3 多种参数组合

```kotlin
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
```

---

## 十一、契约测试

### 11.1 安全管道契约测试（15 条）

`neton-http/src/commonTest/SecurityPipelineContractTest.kt`：

| # | 名称 | 验证 |
|---|------|------|
| 1 | modeA_plainRoute_noSecurity_returns200 | Mode A 默认开放 |
| 2 | modeA_requireAuth_noSecurity_throws500 | Mode A + @RequireAuth → 500 |
| 3 | modeB_requireAuth_withMockAuthenticator_setsIdentity | Mode B 认证 → identity 设置 |
| 4 | allowAnonymous_alwaysPasses_identityNull | @AllowAnonymous → 放行 |
| 5 | modeB_requireAuth_noAuthenticator_throws500 | 无 Authenticator → 500 |
| 6 | permission_allowed_passes | @Permission 有权限 → 放行 |
| 7 | permission_denied_throws403 | @Permission 无权限 → 403 |
| 8 | permissionEvaluator_superadmin_bypasses | 自定义 evaluator 生效 |
| 9 | routeGroupWhitelist_allowsAnonymous | 白名单放行 |
| 10 | routeGroup_requireAuth_enforcesAuth | 组级强制认证 |
| 11 | permission_noEvaluator_emptyPermissions_throws403 | 默认行为冻结 |
| 12 | permission_noIdentity_throws401 | 未认证 → 401 |
| 13 | permissionImpliesAuth_openGroup_noToken_throws401 | **permission implies auth**：开放组 + @Permission + 无 token → 401 |
| 14 | permissionImpliesAuth_openGroup_withToken_passes | **permission implies auth**：开放组 + @Permission + 有效 token → 200 |
| 15 | permissionImpliesAuth_noSecurity_throws500 | **permission implies auth**：@Permission + 无 Security → 500 |

### 11.2 Identity 契约测试

`neton-security/src/commonTest/SecurityIdentityContractTest.kt`：

```kotlin
class SecurityIdentityContractTest {

    @Test
    fun userIdParse_invalidString_throwsAuthenticationException() {
        val ex = kotlin.runCatching { UserId.parse("abc") }.exceptionOrNull()
            as? AuthenticationException ?: error("Expected AuthenticationException")
        assertEquals("InvalidUserId", ex.code)
        assertEquals("Invalid user id", ex.message)
        assertEquals("sub", ex.path)
    }

    @Test
    fun userIdParse_overflowULong_throwsAuthenticationException() { ... }

    @Test
    fun userIdParse_validString_returnsUserId() { ... }

    @Test
    fun identityUser_hasRole_isCaseSensitive() { ... }

    @Test
    fun identityUser_hasPermission_isCaseSensitive() { ... }
}
```

### 11.3 JWT Authenticator 契约测试

`neton-security/src/commonTest/JwtAuthenticatorContractTest.kt`（8 条，JwtAuthenticatorV1 底层实现）：

```kotlin
// 无 Authorization → null
// 非 Bearer → null
// Bearer 后空 → MissingToken, path=Authorization
// token 格式坏 / decode 失败 / JSON 失败 → MissingToken
// alg != HS256 → InvalidAlgorithm, path=alg
// sub 缺失/空/非法 → InvalidUserId, path=sub
// exp 缺失/类型错/过期 → TokenExpired, path=exp
// 签名错误 → InvalidSignature
// 正常 → IdentityUser
```

### 11.4 JWT Adapter 契约测试（6 条）

`neton-security/src/commonTest/JwtAuthenticatorAdapterContractTest.kt`：

验证 `JwtAuthenticatorAdapter`（neton-core Authenticator 接口实现）通过委托 `JwtAuthenticatorV1` 正确工作。

| # | 名称 | 验证 |
|---|------|------|
| 1 | roundTrip_createAndAuthenticate_returnsIdentity | 生成 token → authenticate → 返回正确 Identity |
| 2 | noAuthHeader_returnsNull | 无 Authorization → null（不抛异常） |
| 3 | invalidToken_returnsNull_doesNotThrow | 无效 token → null（异常被 adapter 吞掉） |
| 4 | expiredToken_returnsNull | 过期 token → null |
| 5 | identity_hasPermission_hasRole_work | 返回的 Identity 的 hasRole/hasPermission 正常 |
| 6 | authenticatorName_isJwt | adapter.name == "jwt" |

### 11.5 泛型序列化契约测试（5 条）

`neton-http/src/commonTest/GenericSerializerContractTest.kt`：

验证 KSP 生成的编译期泛型序列化（`JsonContent` 包装）正确工作。

| # | 名称 | 验证 |
|---|------|------|
| 1 | pageResponse_serializes_correctly | `PageResponse&lt;UserVO&gt;` 正确序列化 |
| 2 | pageResponse_emptyItems_serializes_correctly | 空列表序列化 |
| 3 | nestedGeneric_apiResponse_pageResponse_serializes_correctly | 嵌套泛型 `ApiResponse&lt;PageResponse&lt;UserVO&gt;&gt;` |
| 4 | nonGeneric_serializable_serializes_correctly | 非泛型 `@Serializable` 序列化 |
| 5 | jsonContent_is_raw_json_string | `JsonContent` 是原始 JSON 字符串包装 |

---

## 十二、已删除项

| 已删除 | 替代 |
|--------|------|
| `Principal` 接口 | `Identity` |
| `UserPrincipal` 类 | `IdentityUser` |
| `AnonymousPrincipal` | 无（identity = null 即匿名） |
| `@AuthenticationPrincipal` | `@CurrentUser`（或类型自动注入） |
| `SecurityFactory` 接口 | 直接通过 SecurityBuilder API 注册 |
| `Guard.authorize()` 方法名 | `Guard.checkPermission()` |
| `attributes["principal"]` | `attributes[SecurityAttributes.IDENTITY]` |

---

*文档版本：v1.4 — 合并 JWT Authenticator 规范（含 Adapter 桥接层）与 @CurrentUser 设计文档*
