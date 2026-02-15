# Neton Routing 规范 v1

> **定位**：描述 Neton 路由系统的目录/包约定、routing.conf 结构、路由组识别与 Security 集成。与 [Neton-Core-Spec v1](./core.md)、[Neton-Security-Spec v1](./security.md) 及 Config v1.1、Logging、KSP 路由元数据一致。
>
> **原则**：目录即分组、routing.conf 仅声明、Security 按 group 配置、注解做例外控制。

---

## 一、RouteGroup（路由组）

### 1.1 概述

路由组实现「目录约定 + routing.conf 可选 + Security 按 group 配置」的一体化方案。核心能力：

- **Group 识别**：路由属于哪个组（admin / app / platform / default）
- **Mount / 前缀挂载**：该组路由是否自动加 `/admin` 等前缀（可选）

两件事可关联，但语义分离：`group=admin` 不一定 mount `/admin`（如模块化后常见）。

---

### 1.2 目录与包结构（约定即分组）

```
src/commonMain/kotlin/
  controller/
    IndexController.kt                 # default
    admin/
      IndexController.kt               # group = admin
    app/
      IndexController.kt               # group = app

  module/payment/controller/
    IndexController.kt                 # default
    admin/
      IndexController.kt               # group = admin

  module/system/controller/admin/
    IndexController.kt                 # group = admin
```

**规则（v1.1 冻结）**：

- `routeGroupCandidate` = Controller 类的**父包最后一段**
- 仅当该段在 `routing.conf` 的 `groups` 列表中存在时才生效，否则视为 `default`（`routeGroup = null`）

---

### 1.3 application.conf（仅 runtime 配置）

`application.conf` 不放 routing/security 的组配置，保持「runtime only」：

```toml
[application]
name = "Neton MVC"
debug = true

[server]
host = "0.0.0.0"
port = 8081

[http]
timeout = 30000
maxConnections = 1000
enableCompression = true

[logging]
level = "INFO"

[[logging.sinks]]
name = "access"
file = "logs/access.log"
levels = "INFO"
route = "http.access"
# ...
```

---

### 1.4 routing.conf（可选：声明 groups 与 mount）

采用「模块独立 conf，文件名即命名空间」。`routing.conf` 顶层直接使用 `[[groups]]`，不再套 `[routing]`：

```toml
debug = false

[[groups]]
name = "admin"
mount = "/admin"
requireAuth = true
allowAnonymous = ["/login", "/health"]

[[groups]]
name = "app"
mount = "/app"

[[groups]]
name = "platform"
mount = "/platform"
requireAuth = true
```

**语义（v1.2 冻结）**：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `name` | String | 必填 | 允许的 group 列表，用于过滤 `routeGroupCandidate` |
| `mount` | String | 必填 | 路径前缀挂载；adapter 按 group 包一层 `route(mount)`，pattern 保持原样 |
| `requireAuth` | Boolean | `false` | 该组是否默认要求认证 |
| `allowAnonymous` | List&lt;String&gt; | `[]` | 白名单路径列表，即使 requireAuth=true 也允许匿名访问 |
| group 未配置 | - | - | `routeGroup = default`（null） |

**安全优先级**：`@AllowAnonymous`（注解） > `allowAnonymous`（白名单） > `group.requireAuth`

**mount 实现**：不改写 pattern，adapter 在注册路由树时按 routeGroup 将路由分组，有 mount 的组包在 `route(mount) { ... }` 内。访问路径 = mount + pattern（如 `/admin` + `/index` → `/admin/index`）。

---

### 1.5 Neton.run 示例（推荐写法）

```kotlin
fun main(args: Array<String>) {
  Neton.run(args) {

    http { }       // 端口/超时从 application.conf 读取，DSL 仅 default
    routing { }    // 读取 routing.conf（可选），建立 group 表与 mount
    database { }   // 如需
    redis { }      // 如需
    cache { }      // 如需

    security {
      // default（无 group）：默认开放或最弱策略
      // v1 推荐：默认 PublicGuard（Mode A/B + requireAuth 已能工作）

      // admin group：JWT + requireAuth 默认策略
      group("admin") {
        authenticator(JwtAuthenticatorV1(secret = "xxx"))
        defaultGuard(RequireAuthGuard)  // or DefaultGuard
      }

      // app group：Session（v1 可 experimental）
      group("app") {
        authenticator(SessionAuthenticator(/*...*/))
        defaultGuard(DefaultGuard)
      }
    }
  }
}
```

`group("admin") { ... }` 为最终 DX：按组绑定认证器/守卫。SecurityRegistry 已有 routeGroup 支持，DSL 需做成该形式。

---

### 1.6 Controller 示例（目录决定组，注解控制例外）

**controller/admin/IndexController.kt**（group = admin）

```kotlin
package controller.admin

@Controller("/index")
@RequireAuth
class IndexController {

  @Get("")
  suspend fun index(): String = "admin ok"

  @Get("/public")
  @AllowAnonymous
  suspend fun public(): String = "admin public"
}
```

**controller/app/IndexController.kt**（group = app）

```kotlin
package controller.app

@Controller("/index")
class IndexController {

  @Get("")
  suspend fun index(): String = "app ok"
}
```

**controller/IndexController.kt**（default group）

```kotlin
package controller

@Controller("/")
class IndexController {
  @Get("")
  suspend fun home(): String = "home"
}
```

---

### 1.7 运行时行为

| 请求 | 行为 |
|------|------|
| `GET /` | default group → 默认开放 |
| `GET /admin/index` | group=admin → JWT + DefaultGuard → 需要认证 |
| `GET /admin/index/public` | group=admin，但 `@AllowAnonymous` → 放行 |
| `GET /app/index` | group=app → session 或默认策略 |

**路由组识别来源**：

1. KSP 生成 `controllerClass` / `routeGroupCandidate`
2. RoutingComponent 读取 `routing.conf` groups 列表过滤
3. `RouteDefinition.routeGroup` 最终为：`admin` / `app` / `platform` / `null`

**Security pre-handle**：

- 只看 `route.routeGroup` + `allowAnonymous` / `requireAuth`
- 不做字符串 split 猜测（最终目标）

---

### 1.8 冻结规则（v1.2）

| # | 规则 | 说明 |
|---|------|------|
| 1 | group 候选 = 父包最后一段 | `controller.admin.IndexController` → 候选 `admin` |
| 2 | 只有 routing.conf 声明的 group 才生效 | 未在 groups 中的 candidate 视为 default（null） |
| 3 | mount 只负责路径前缀 | 不改 pattern 字符串；adapter 在注册时按 group 包一层 route(mount) |
| 4 | Controller base path 不含 mount 前缀 | 由 mount 提供；否则会导致 /admin/admin/... 重复 |
| 5 | **极简 DSL 必须提供** | neton-routing 必须提供 get/post/put/delete/group 最小 DSL，无需 KSP 即可定义路由 |
| 6 | **group 优先级** | DSL group > KSP routeGroup > runtime 包名推断 |
| 7 | **requireAuth / allowAnonymous** | 组级安全配置；优先级：`@AllowAnonymous` > 白名单 > `group.requireAuth` |
| 8 | **RouteGroupSecurityConfigs** | 启动时从 routing.conf 解析并绑定到 ctx，安全管道通过 ctx 获取 |

---

### 1.9 极简 DSL（无 KSP Hello World）

**最小示例：**

```kotlin
routing {
    get("/") { "Hello Neton!" }
    post("/echo") { "ok" }
}
```

**group DSL（prefix 叠加 + routeGroup 注入 Security）：**

```kotlin
routing {
    get("/") { "public" }
    
    group("admin") {
        get("/") { ctx -> "admin index" }
        get("/users") { ctx -> "admin users" }
        
        group("v1") {
            get("/reports") { ctx -> "admin v1 reports" }  // → /admin/v1/reports
        }
    }
}
```

- prefix 合并进 pattern：`group("admin") { get("/") }` → pattern = `/admin/`
- routeGroup 取最外层，供 Security 管道选择 authenticator/guard
- 支持嵌套：prefix 叠加，routeGroup 保持

**完整 Main.kt（推荐 logger 命名遵守 Logging Spec）：**

```kotlin
fun main(args: Array<String>) {
    Neton.run(args) {
        http { port = 8080 }
        
        routing {
            get("/") { "Hello Neton!" }
            get("/api/hello") { ctx ->
                val name = ctx.request.queryParam("name") ?: "World"
                "Hello, $name!"
            }
            group("admin") {
                get("/") { ctx -> "admin" }
            }
        }
        
        onStart {
            val log = get<LoggerFactory>().get("examples.multigroup.Main")
            log.info("application.ready", mapOf("port" to getPort()))
        }
    }
}
```

**Handler 形态（不暴露 HandlerArgs，那是 KSP/参数绑定器内部 SPI）：**

| 形态 | 签名 | 用途 |
|------|------|------|
| 1 | `suspend (HttpContext) -> Any?` | 唯一形态：Hello World 可写 `get("/") { "Hello!" }`；需 ctx 时用 `get("/") { ctx -> ... }`；HttpContext 已含 request/response/pathParams/queryParams/session/attributes/applicationContext |

层级分离：
- `RequestEngine.registerRoute` → 框架 SPI
- `routing { get/post/put/delete/group }` → 框架 DX
- `@Controller` + KSP → 编译期高阶模式

---

### 1.10 最干净形态小结

- **目录即分组**：维护者一眼看懂
- **routing.conf**：只声明 group 与 mount，结构极轻
- **security**：按 group 配置认证/守卫，最符合业务
- **@AllowAnonymous / @RequireAuth / @RolesAllowed**：做例外控制
