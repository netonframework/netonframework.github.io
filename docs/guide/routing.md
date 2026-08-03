# Routing and controllers

This chapter covers Neton's routing system: annotated controllers, HTTP method annotations, route
groups and mounting, and the routing DSL.

## Two ways to define routes

1. **Annotated routes** (recommended) — `@Controller` plus HTTP method annotations, with KSP
   generating the routing code at compile time
2. **DSL routes** — registered by hand inside a `routing { }` block, which suits small services

## Annotated routes

### A basic controller

Annotate a class with `@Controller` to give it a base path, then mark handlers with `@Get`,
`@Post` and friends:

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

In that example:

- `@Controller("/simple")` sets the controller's base path
- `@Get("/hello")` registers `GET /simple/hello`
- `@Get("/user/{id}")` registers a route with a path parameter, where `{id}` is the placeholder
- `@Post("/user")` registers `POST /simple/user`, and `@Body` deserializes the request body

Request body classes must be `@Serializable`:

```kotlin
@Serializable
data class CreateUserRequest(
    val name: String,
    val email: String,
    val age: Int? = null
)
```

### Multiple path parameters

```kotlin
@Controller("/simple")
class SimpleController {
    @Get("/user/{userId}/post/{postId}")
    fun getUserPost(
        @PathVariable("userId") userId: Int,
        @PathVariable("postId") postId: Int
    ): String {
        return "Post $postId of user $userId"
    }
}
```

### Injecting context objects

Framework context objects are injected by type, without an annotation:

```kotlin
@Controller("/simple")
class SimpleController {
    @Get("/request-info")
    fun getRequestInfo(request: HttpRequest): String {
        return "method: ${request.method}, path: ${request.path}"
    }
}
```

`HttpContext`, `HttpRequest` and `HttpResponse` are all injectable this way.

### Injecting the authenticated user

Use `@CurrentUser`, or simply declare an `Identity` parameter:

```kotlin
@Controller("/simple")
class SimpleController {
    @Get("/profile")
    @RequireAuth
    fun getProfile(@CurrentUser identity: Identity): String {
        return "user: ${identity.id}, roles: ${identity.roles}"
    }

    @Get("/visitor")
    @AllowAnonymous
    fun visitor(identity: Identity?): String {
        // an Identity parameter is injected automatically; @CurrentUser is optional
        return identity?.id ?: "anonymous"
    }
}
```

A non-nullable `Identity` parameter throws `UnauthorizedException` (HTTP 401) when the request is
unauthenticated, rather than failing with a null pointer.

## HTTP method annotations

| Annotation | Method | Typical use |
|---|---|---|
| `@Get` | GET | Read a resource |
| `@Post` | POST | Create a resource |
| `@Put` | PUT | Replace a resource |
| `@Patch` | PATCH | Partially update a resource |
| `@Delete` | DELETE | Delete a resource |
| `@Head` | HEAD | Fetch metadata without a body |
| `@Options` | OPTIONS | Report the methods a resource supports |

A full REST controller:

```kotlin
@Controller("/api/products")
class HttpMethodController {

    @Get("/")
    fun getProducts(): String {
        return "GET /api/products - list all products"
    }

    @Get("/{id}")
    fun getProduct(): String {
        return "GET /api/products/{id} - product detail"
    }

    @Post("/")
    fun createProduct(): String {
        return "POST /api/products - create a product"
    }

    @Put("/{id}")
    fun updateProduct(): String {
        return "PUT /api/products/{id} - replace a product"
    }

    @Patch("/{id}")
    fun patchProduct(): String {
        return "PATCH /api/products/{id} - partially update a product"
    }

    @Delete("/{id}")
    fun deleteProduct(): String {
        return "DELETE /api/products/{id} - delete a product"
    }

    @Head("/{id}")
    fun headProduct(): String {
        return "HEAD /api/products/{id} - product metadata"
    }

    @Options("/")
    fun optionsProducts(): String {
        return "OPTIONS /api/products - GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS"
    }
}
```

## File uploads

Declare a parameter of type `UploadFile`, `List<UploadFile>` or `UploadFiles`. KSP binds it by
**matching the parameter name against the form field name**:

```kotlin
@Controller("/api/files")
class FileController {

    // parameter "avatar" matches form field "avatar"
    @Post("/avatar")
    suspend fun upload(avatar: UploadFile): Map<String, Any> {
        return mapOf("filename" to avatar.filename, "size" to avatar.size)
    }

    // parameter "photos" matches form field "photos"
    @Post("/batch")
    suspend fun batchUpload(photos: List<UploadFile>): Map<String, Any> {
        return mapOf("count" to photos.size)
    }

    // UploadFiles gives the whole structured view, queryable by field name
    @Post("/mixed")
    suspend fun mixedUpload(files: UploadFiles): Map<String, Any> {
        val avatar = files.require("avatar")
        val gallery = files.get("gallery")
        return mapOf("avatar" to avatar.filename, "galleryCount" to gallery.size)
    }
}
```

KSP recognises these types and parses the files out of the `multipart/form-data` request.

---

## Route groups and mounting

Route groups organise controllers by area and give each area a URL prefix.

### Declaring groups

In `config/routing.conf`:

```toml
[[groups]]
group = "admin"
mount = "/admin"
requireAuth = true
allowAnonymous = ["/login", "/register"]

[[groups]]
group = "app"
mount = "/app"
```

| Field | Type | Meaning |
|---|---|---|
| `group` | String | The group identifier |
| `mount` | String | The URL prefix |
| `requireAuth` | Boolean | Whether the group requires authentication by default (default `false`) |
| `allowAnonymous` | List&lt;String&gt; | Paths that stay anonymous even when `requireAuth` is true (default empty) |

### Directory convention

A controller's package determines its group; KSP resolves this at compile time:

```
controller/
├── HomeController.kt           # default group, routes at /
├── SimpleController.kt         # default group, routes at /simple/...
├── admin/
│   ├── IndexController.kt      # admin group, routes at /admin/index/...
│   └── AdminHomeController.kt  # admin group, routes at /admin/...
└── app/
    └── IndexController.kt      # app group, routes at /app/index/...
```

For a controller in `controller.admin`:

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

Since the `admin` group mounts at `/admin`, the resulting routes are:

- `GET /admin/index` — authenticated
- `GET /admin/index/public` — anonymous
- `GET /admin/index/dashboard` — authenticated

### Security annotations

- `@RequireAuth` — on a class or method; requires authentication
- `@AllowAnonymous` — on a class or method; overrides the requirement (highest precedence)
- `@Permission("system:user:edit")` — on a class or method; requires a permission
- `@CurrentUser` — on a parameter; injects the current `Identity` (optional for `Identity`-typed parameters)

### Modular groups

Larger projects can organise controllers by business module:

```
module/
└── payment/
    └── controller/
        ├── IndexController.kt          # default group: /payment/index
        └── admin/
            └── IndexController.kt      # admin group: /admin/payment/index
```

## DSL routes

For projects that do not use KSP, register routes directly:

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
                "user list"
            }

            post("/api/data") { ctx ->
                // ctx gives access to the request context
                "created"
            }

            group("admin") {
                get("/dashboard") { ctx ->
                    "admin dashboard"
                }
            }
        }
    }
}
```

| Method | Registers |
|---|---|
| `get(path) { ... }` | a GET route |
| `post(path) { ... }` | a POST route |
| `put(path) { ... }` | a PUT route |
| `delete(path) { ... }` | a DELETE route |
| `group(name) { ... }` | a route group |

The 1.0 DSL provides only these. There is **no `patch(path)`** — use the `@Patch` annotation when
you need PATCH.

::: tip Choosing between them
- **DSL** — quick prototypes, small services, anywhere you would rather not run KSP
- **Annotations** — larger projects; clearer controller structure, automatic parameter binding, security annotations and other higher-level features

The two can be mixed in one project.
:::

## Coroutines

Handlers may be `suspend` functions:

```kotlin
@Controller("/api")
class AsyncController {

    @Get("/data")
    suspend fun fetchData(): String {
        val result = someAsyncOperation()
        return result
    }
}
```

## Further reading

- [Parameter binding](./parameter-binding.md) — path, query and body binding rules in depth
- [Security guide](./security.md) — the Authenticator + Guard architecture
- [Routing specification](/zh-hans/spec/routing) (Chinese) — the frozen design contract
