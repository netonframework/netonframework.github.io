# Neton 安全规范 v1.1 API 冻结版

> **状态**：v1.1 API Freeze（Done）  
> **定位**：在 [Neton-Security-Spec v1](./security.md) 基础上，一次性冻结命名、类型、跨边界解析与 Guard 策略。  
> **原则**：Native-first、轻量、类型安全、单点 fail-fast。  
> **生效**：直接替换旧命名，无兼容层。

---

## 一、类型总览

| 类型 | 说明 |
|------|------|
| `UserId` | value class 包 ULong，强类型 ID |
| `Identity` | 身份抽象：id + roles + permissions |
| `IdentityUser` | 可选默认实现，供框架 Authenticator 使用 |
| `Authenticator` | 认证器 |
| `Guard` | 守卫 |

---

## 二、UserId（强类型 ID）

```kotlin
@JvmInline
value class UserId(val value: ULong) {
    companion object {
        fun parse(s: String): UserId = UserId(s.toULong())
    }
}
```

JWT / header / session 拿到的永远是 string，Authenticator 从 token 读出 `sub` 后调用 `UserId.parse(sub)` 得到 `UserId`。

**细则 1：UserId.parse 错误语义**（v1 冻结）

| 场景 | 异常 | HTTP 映射 |
|------|------|-----------|
| 解析失败（来自 token/session） | `AuthenticationException(code="InvalidUserId", message="Invalid user id", path="sub")` | 401 |
| 解析失败（来自配置或内部调用） | 同上或 `ConfigTypeException` | 500 |

**AuthenticationException 结构**（v1 冻结）：

| 字段 | InvalidUserId 时 | 说明 |
|------|-----------------|------|
| `code` | `"InvalidUserId"` | 必须一致，禁止 "INVALID_USER_ID" 等变体 |
| `message` | `"Invalid user id"` | 必须一致，供 ErrorResponse.body 和客户端国际化 |
| `path` | `"sub"` | JWT/sub 场景必须设置；配置错误场景可选 |

**后续认证方式 path 约定**（实现时参考）：Session → `"sessionId"` 或 `"session.userId"`；Basic → `"Authorization"`。

认证语义不应映射 400。parse 不得返回 nullable 或 silent fallback。

---

## 三、Identity 接口（v1 冻结）

```kotlin
interface Identity {
    val id: UserId
    val roles: Set<String>
    val permissions: Set<String>
    
    fun hasRole(role: String) = role in roles
    fun hasPermission(p: String) = p in permissions
    
    fun hasAnyRole(vararg rs: String) = rs.any { it in roles }
    fun hasAllRoles(vararg rs: String) = rs.all { it in roles }
    fun hasAnyPermission(vararg ps: String) = ps.any { it in permissions }
    fun hasAllPermissions(vararg ps: String) = ps.all { it in permissions }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UserId | 用户唯一标识 |
| `roles` | Set&lt;String&gt; | 粗粒度分组（admin, user, ops），O(1) 成员检查 |
| `permissions` | Set&lt;String&gt; | 细粒度动作（user:read, user:write） |

**roles 与 permissions 定位**：

| 维度 | roles | permissions |
|------|-------|-------------|
| 粒度 | 粗（路由组/模块级） | 细（操作级） |
| Guard | @RolesAllowed | CustomGuard（v1 无 @PermissionsAllowed） |
| 典型使用 | AdminGuard、RoleGuard | 业务内 hasPermission 检查 |

**权限字符串格式**（v1 冻结）：

```
resource:action
```

例：`user:read`、`user:write`、`order:pay`。v1 不做 hierarchy/通配符。

**细则 2：roles/permissions 大小写**（v1 冻结）

- `roles`、`permissions` 统一按**原样（case-sensitive）**比较
- 必须由 issuer（token/session/DB）自行规范化，Neton 不做自动 lowercase

**细则 3：v1 不引入 attributes**

- v1 Identity 不包含 `attributes: Map&lt;String, Any?&gt;`，避免类型不安全、序列化困难、诱导滥塞

---

## 四、IdentityUser（可选默认实现）

```kotlin
data class IdentityUser(
    override val id: UserId,
    override val roles: Set<String> = emptySet(),
    override val permissions: Set<String> = emptySet()
) : Identity
```

**细则 5：IdentityUser 构造保证 Set 语义**

从 JWT array / List 构造时，必须对 roles/permissions 做 `toSet()`，保证去重，避免 issuer 传入重复值导致日志/审计异常。

`toSet()` 仅去重完全相同字符串，不做 normalize（大小写/trim）处理，与「issuer 负责规范化」一致。

**用途**：MockAuthenticator、JwtAuthenticator、SessionAuthenticator 在无需查库时直接返回。业务应实现自己的 `User : Identity`，由 Authenticator 通过 UserService 加载。

---

## 五、Authenticator 与 Guard

```kotlin
interface Authenticator {
    suspend fun authenticate(context: RequestContext): Identity?
    val name: String
}

interface Guard {
    suspend fun authorize(identity: Identity?, context: RequestContext): Boolean
    val name: String
}
```

**Guard 语义**（v1 冻结）：

- `@RolesAllowed` → 用 `roles`
- `@PermissionsAllowed` → v1 不提供，permissions 先给 CustomGuard 使用
- 两者不混着解释

---

## 六、JWT Claim 约定（v1 冻结）

```json
{
  "sub": "123",
  "roles": ["admin"],
  "perms": ["user:read", "user:write"]
}
```

| Claim | 说明 |
|-------|------|
| `sub` | 用户 id（string → UserId.parse） |
| `roles` | string array |
| `perms` | string array（缩写，payload 更小） |

**roles/perms 缺失时**：默认 `emptySet()`，不报错、不抛异常。实现不得因 roles/perms 缺失而 throw 或 NPE。

**细则 4：roles/permissions 信任边界**（v1 冻结）

| 模式 | 说明 | v1 |
|------|------|-----|
| 模式 1（token 权威） | JWT 里的 roles/perms 直接信任，无状态 | 默认允许 |
| 模式 2（DB 权威） | JWT 只携带 userId，roles/perms 服务端查库加载，更实时 | 业务需实现 User : Identity，由 Authenticator 通过 UserService 加载 |

若业务要求实时权限变更，需实现服务端加载 Identity，不要依赖 token perms。

---

## 七、注解与注入

### 7.1 @CurrentUser

```kotlin
@Target(AnnotationTarget.VALUE_PARAMETER)
@Retention(AnnotationRetention.RUNTIME)
annotation class CurrentUser(val required: Boolean = true)
```

### 7.2 注入规则

| 优先级 | 规则 | 示例 |
|--------|------|------|
| 1 | 显式 `@CurrentUser` | `@CurrentUser user: User` |
| 2 | 参数类型为 `Identity` 或其子类 → 自动注入 | `user: User` |
| 3 | 可空类型 → `required = false` | `user: User?` |

---

## 八、用法示例

### 8.1 业务层 User 实现 Identity

```kotlin
data class User(
    override val id: UserId,
    override val roles: Set<String>,
    override val permissions: Set<String>,
    val email: String,
    val nickname: String
) : Identity

@Get("/profile")
fun profile(user: User): Profile = Profile(user.id, user.nickname)
```

### 8.2 操作级权限检查（CustomGuard / 业务内）

```kotlin
@Get("/users/{id}")
fun getUser(id: UserId, user: User): UserDetail {
    if (!user.hasPermission("user:read")) throw ForbiddenException()
    return userService.findById(id)
}
```

---

## 九、实现清单

| 项 | 说明 |
|----|------|
| 1 | 新增 `UserId` value class、`UserId.parse(s)` |
| 2 | 新增 `Identity` 接口（id: UserId, roles: Set, permissions: Set） |
| 3 | 新增 `IdentityUser` 可选默认实现 |
| 4 | 新增 `@CurrentUser` 注解 |
| 5 | 删除 `Principal`、`UserPrincipal`、`@AuthenticationPrincipal` |
| 6 | Authenticator 从 token/session 取 sub → UserId.parse，构造 Identity |
| 7 | JWT 解析遵守 sub/roles/perms 约定 |
| 8 | Guard：@RolesAllowed 用 roles；permissions 供 CustomGuard |
| 9 | 契约测试：`UserId.parse("abc")` → `AuthenticationException`，断言 code/message/path |
| 10 | 契约测试：`UserId.parse("18446744073709551616")` → InvalidUserId（ULong 上界 fail-fast） |
| 11 | 契约测试：`IdentityUser` 的 `hasRole`/`hasPermission` 行为（case-sensitive）稳定 |

---

## 十、契约测试结构（commonTest）

不依赖 HTTP，仅测 parse 与 hasRole/hasPermission，按项目现有 test 风格（如 SecurityPipelineContractTest）。

```kotlin
// 建议位置：neton-security/src/commonTest/kotlin/SecurityIdentityContractTest.kt

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
    fun userIdParse_overflowULong_throwsAuthenticationException() {
        val ex = kotlin.runCatching { UserId.parse("18446744073709551616") }.exceptionOrNull()
            as? AuthenticationException ?: error("Expected AuthenticationException")
        assertEquals("InvalidUserId", ex.code)
    }

    @Test
    fun userIdParse_validString_returnsUserId() {
        val id = UserId.parse("123")
        assertEquals(123UL, id.value)
    }

    @Test
    fun identityUser_hasRole_isCaseSensitive() {
        val user = IdentityUser(UserId(1UL), setOf("Admin"), setOf("user:read"))
        assertTrue(user.hasRole("Admin"))
        assertFalse(user.hasRole("admin"))
    }

    @Test
    fun identityUser_hasPermission_isCaseSensitive() {
        val user = IdentityUser(UserId(1UL), emptySet(), setOf("user:read"))
        assertTrue(user.hasPermission("user:read"))
        assertFalse(user.hasPermission("User:Read"))
    }
}
```

---

*文档版本：v1.1 API Freeze*
