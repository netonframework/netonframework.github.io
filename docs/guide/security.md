# Security

Neton's security framework is declarative and built from two layers — **Authenticator** and
**Guard** — which keeps "who are you" and "what may you do" completely separate.

## Architecture

```
HTTP request
  |
  v
┌──────────────────────┐
│   Authenticator      │  ← layer 1: authentication (who are you?)
│   reads credentials, │     returns an Identity, or null
│   returns Identity   │
└──────────┬───────────┘
           |
           v
┌──────────────────────┐
│   @Permission +      │  ← layer 2: permission check (do you hold it?)
│   PermissionEvaluator│     the evaluator is replaceable
└──────────┬───────────┘
           |
           v
┌──────────────────────┐
│   Guard              │  ← layer 3: the final decision
│   decides from the   │     returns true / false
│   identity + context │
└──────────┬───────────┘
           |
           v
       Controller
```

- **Authenticator** — extracts a credential (token, session, basic auth) and returns an `Identity` on success or `null` on failure.
- **@Permission + PermissionEvaluator** — when a route carries `@Permission("system:user:edit")`, the identity is checked for that permission. The default is `identity.hasPermission()`; replace the `PermissionEvaluator` to implement rules such as a superadmin bypass.
- **Guard** — takes the identity and request context and decides whether to proceed. `RequireIdentityGuard` demands a non-null identity; `AllowAllGuard` permits everything.
- **Identity** — the authenticated user, carrying `id`, `roles` and `permissions`.

## Installing the component

```kotlin
import neton.security.security

fun main(args: Array<String>) {
    Neton.run(args) {
        http { port = 8080 }

        security {
            // application configuration arrives via @NetonConfig("security")
        }

        routing { }
    }
}
```

`security { }` installs the pipeline. Configure the authenticators and guards themselves through a
`@NetonConfig` class, which keeps infrastructure installation separate from policy.

## Configuring policy with @NetonConfig

Implement `SecurityConfigurer`; KSP finds the class and applies it at startup:

```kotlin
import neton.core.component.NetonContext
import neton.core.config.NetonConfig
import neton.core.config.SecurityConfigurer
import neton.core.interfaces.SecurityBuilder
import neton.security.AnonymousGuardImpl
import neton.security.DefaultGuardImpl

@NetonConfig(component = "security", order = 0)
class AppSecurityConfig : SecurityConfigurer {

    override fun configure(ctx: NetonContext, security: SecurityBuilder) {
        // default group: open (the anonymous guard permits everything)
        security.setDefaultGuard(AnonymousGuardImpl())

        // admin group: mock authentication with the default guard
        security.registerMockAuthenticator(
            name = "admin-mock",
            userId = "admin-user",
            roles = setOf("admin"),
            permissions = setOf("system:user:edit", "system:user:delete")
        )
        security.setGroupGuard("admin", DefaultGuardImpl())

        // optional: a custom evaluator giving superadmin a bypass
        security.setPermissionEvaluator { identity, permission, _ ->
            identity.hasRole("superadmin") || identity.hasPermission(permission)
        }
    }
}
```

### SecurityBuilder API

| Method | Effect |
|---|---|
| `setDefaultGuard(guard)` | Set the guard for the default route group |
| `setDefaultAuthenticator(auth)` | Set the authenticator for the default route group |
| `setGroupAuthenticator(group, auth)` | Set the authenticator for one group |
| `setGroupGuard(group, guard)` | Set the guard for one group |
| `setPermissionEvaluator(evaluator)` | Replace the permission evaluator |
| `registerMockAuthenticator(...)` | Register the mock authenticator, for development |
| `registerJwtAuthenticator(...)` | Register the JWT authenticator |

## Annotations

### @AllowAnonymous

Skips authentication entirely. Highest precedence.

```kotlin
@Controller("/api/security")
class SecurityController {

    @Get("/public")
    @AllowAnonymous
    fun publicAccess(): String {
        return "public — anyone may call this"
    }
}
```

### @RequireAuth

Requires an authenticated user.

```kotlin
@Get("/protected")
@RequireAuth
fun protectedAccess(): String {
    return "protected — sign in first"
}
```

### @RolesAllowed

Requires one of the listed roles.

```kotlin
// administrators only
@Get("/admin")
@RolesAllowed("admin")
fun adminOnly(): String {
    return "administrators only"
}

// administrators or editors
@Get("/editor")
@RolesAllowed("admin", "editor")
fun adminOrEditor(): String {
    return "administrators or editors"
}
```

### @Permission

Declarative permission checking; the pipeline verifies the identity holds it.

```kotlin
// requires system:user:edit
@Post("/users/{id}")
@RequireAuth
@Permission("system:user:edit")
fun editUser(id: Long): String {
    return "editing user $id"
}

// on a class: every method requires it by default
@Controller("/admin/system")
@RequireAuth
@Permission("system:manage")
class SystemController {

    @Get("/info")
    fun info(): String = "system information"

    // a method-level annotation overrides the class-level one
    @Delete("/reset")
    @Permission("system:reset")
    fun reset(): String = "system reset"
}
```

**Inheritance** — a method-level `@Permission` overrides the class-level one. Two `@Permission`
annotations on the same target is a compile error.

### @CurrentUser

Injects the current `Identity`, which carries `id`, `roles` and `permissions`.

```kotlin
@Get("/profile")
@RequireAuth
fun getCurrentUser(@CurrentUser identity: Identity): String {
    return "user: ${identity.id} (roles: ${identity.roles.joinToString(", ")})"
}
```

`required` controls what happens without authentication:

- `required = true` (default) — throws
- `required = false` — the parameter is `null`

```kotlin
@Get("/visitor")
@AllowAnonymous
fun visitorInfo(@CurrentUser(required = false) identity: Identity?): String {
    return if (identity != null) {
        "Welcome back, ${identity.id}!"
    } else {
        "Welcome, visitor!"
    }
}
```

An `Identity`-typed parameter is injected even without the annotation; `@CurrentUser` exists mainly
to express `required`. A non-nullable `Identity` on an unauthenticated request raises
`UnauthorizedException`, which maps to HTTP 401.

## PermissionEvaluator

`PermissionEvaluator` is a `fun interface` for custom permission logic. The default is
`identity.hasPermission(permission)`.

```kotlin
security {
    setPermissionEvaluator { identity, permission, context ->
        // superadmin holds everything
        identity.hasRole("superadmin") || identity.hasPermission(permission)
    }
}
```

Default behaviour without a custom evaluator:

- the permission is in `identity.permissions` → allowed
- it is not → 403 Forbidden
- the identity is null → 401 Unauthorized

## Per-group policy

Each route group can carry its own authenticator and guard.

### routing.conf

```toml
[[groups]]
group = "admin"
mount = "/admin"
requireAuth = true
allowAnonymous = ["/login", "/register"]

[[groups]]
group = "app"
mount = "/app"
requireAuth = false
```

| Field | Type | Meaning |
|---|---|---|
| `group` | String | Group identifier |
| `mount` | String | URL prefix |
| `requireAuth` | Boolean | Whether the group requires authentication by default (default `false`) |
| `allowAnonymous` | List&lt;String&gt; | Paths that stay anonymous even when `requireAuth` is true |

### Precedence

```
@AllowAnonymous (annotation) > allowAnonymous (whitelist) > group.requireAuth
```

- `@AllowAnonymous` wins regardless of group configuration
- whitelisted paths stay anonymous inside a `requireAuth = true` group
- the group's `requireAuth` is the fallback

| Group | requireAuth | Effect |
|---|---|---|
| default | false | Open unless a method declares `@RequireAuth` |
| `admin` | true | Authenticated by default; `@AllowAnonymous` or the whitelist exempt a route |
| `app` | false | Open by default; `@RequireAuth` tightens individual routes |

## JWT authentication

```kotlin
security {
    registerJwtAuthenticator(
        secretKey = "your-secret-key",
        headerName = "Authorization",    // default
        tokenPrefix = "Bearer "          // default
    )
}
```

The authenticator reads the bearer token from `Authorization`, verifies the signature and returns
an `Identity`.

| Claim | Maps to | Meaning |
|---|---|---|
| `sub` | `identity.id` | User identifier |
| `roles` | `identity.roles` | Roles, as a JSON array |
| `perms` | `identity.permissions` | Permissions, as a JSON array |

::: tip Brute-force protection
Pair your login route with `@RateLimit` — see [Middleware](./middleware.md#_3-rate-limiting).
Before 1.0.0-beta1 that annotation was parsed but never enforced, so verify your limits after
upgrading.
:::

## The Identity interface

```kotlin
interface Identity {
    val id: String                              // user identifier
    val roles: Set<String>                      // roles
    val permissions: Set<String>                // permissions

    fun hasRole(role: String): Boolean
    fun hasAnyRole(vararg roles: String): Boolean
    fun hasAllRoles(vararg roles: String): Boolean
    fun hasPermission(p: String): Boolean
    fun hasAnyPermission(vararg ps: String): Boolean
    fun hasAllPermissions(vararg ps: String): Boolean
}
```

```kotlin
@Get("/dashboard")
@RequireAuth
fun dashboard(@CurrentUser identity: Identity): String {
    return when {
        identity.hasRole("admin") -> "admin dashboard — full control"
        identity.hasRole("editor") -> "editor dashboard — content management"
        identity.hasPermission("dashboard:view") -> "user dashboard — your account"
        else -> "basic dashboard — limited features"
    }
}
```

### The inheritance chain

```
neton-core:     Identity { id: String, roles: Set, permissions: Set }
                    ↑
neton-security: Identity { userId: UserId }   (bridges with override val id = userId.value.toString())
                    ↑
                IdentityUser(userId, roles, permissions)  — the default implementation
```

Applications can define their own `User : Identity` to carry additional fields.

## Cryptographic helpers

`neton-security` exposes `Sha256`, `HmacSha256`, `SecretBox` (AES-GCM), `SecureRandom` and
`PasswordHasher` from `neton.security.crypto`. These are public API; you should not need to import
anything from an internal package to sign a request.

## Related

- [Security specification](/zh-hans/spec/security) (Chinese) — the full design, including the JWT authenticator and `@CurrentUser`
- [Routing and controllers](./routing.md) — route groups and mounting
- [Middleware](./middleware.md) — where security sits in the request pipeline
