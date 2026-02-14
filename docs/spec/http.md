# Neton HTTP 规范 v1

> **定位**：描述 Neton HTTP 抽象层的架构、生命周期与实现边界。与 [Neton-Core-Spec v1](./core.md) 第六、七节一致，并落地 neton-core（抽象）与 neton-http（实现）的职责划分。
>
> **参考**：历史 HTTP 抽象层与适配器设计文档（设计目标与优化方向）；本文以**当前实现**为准，差异在文中注明。

---

## 一、概述与分层

### 1.1 设计目标

- **服务器无关性**：Core 只定义 HttpAdapter / HttpContext / Request·Response，实现可替换。
- **类型安全**：参数与返回值在 Core 层有明确接口（HandlerArgs、ParamConverter、RouteHandler 返回 Any?）。
- **请求生命周期**：每个请求对应一个 HttpContext，带 traceId，与 LogContext 一致，便于 APM/日志串联。
- **Native-first**：抽象层无 JVM 专有依赖；neton-http 运行于 Native 目标。

### 1.2 四层关系

```
┌─────────────────────────────────────────────────────────┐
│  Neton 应用层（Neton.run、install、onStart）             │  ← neton-core
├─────────────────────────────────────────────────────────┤
│  HttpContext 抽象（request/response/session/attributes）  │  ← neton-core
├─────────────────────────────────────────────────────────┤
│  HttpAdapter（start/stop/port）+ RequestEngine 驱动路由   │  ← neton-core 接口，neton-http 实现
├─────────────────────────────────────────────────────────┤
│  服务器实现（HTTP 引擎 / 未来 Mock 等）                    │  ← neton-http
└─────────────────────────────────────────────────────────┘
```

- **Core**：定义 HttpAdapter、HttpContext、HttpRequest、HttpResponse、HttpSession、HandlerArgs、RequestEngine、RouteDefinition、RouteHandler、ParamConverter 等。
- **neton-http**：提供 HttpComponent（install 入口）、实现 HttpAdapter、将底层 HTTP 请求转为 HttpContext，并注册 RequestEngine 的路由。

---

## 二、HttpAdapter 与生命周期

### 2.1 接口（neton-core）

```kotlin
interface HttpAdapter {
    suspend fun start(ctx: NetonContext)
    suspend fun stop()
    fun port(): Int
}
```

- **start(ctx)**：从 `ctx` 获取 RequestEngine（及 LoggerFactory 等），在适配器内部启动 HTTP 服务器；port、timeout、maxConnections 等由适配器构造或配置注入，**不**由 Core 接口规定。
- **stop()**：优雅关闭（gracePeriodMillis, timeoutMillis）。
- **port()**：供启动日志、onStart 回调等使用；由实现方在构造或配置中设定。
- **废弃**：`runCompat(port, args)` 仅兼容旧路径，应使用 `start(ctx)`。

### 2.2 实现边界（neton-http）

- **HTTP 适配器实现**：构造参数为 `HttpServerConfig`（port、timeout、maxConnections、enableCompression）与可选的 `ParamConverterRegistry`。
- **生命周期**：
  1. `Neton.run(args) { http { port = 8080 }; routing { }; ... }` → 各组件 `init(ctx, config)` → HttpComponent.init 绑定 HttpServerConfig、HttpAdapter 到 ctx。
  2. 应用 `start` 阶段：Core 调用 `httpAdapter.start(ctx)`；适配器从 ctx 取 RequestEngine，注册路由（get/post/put/delete 等），然后启动 HTTP 服务器。
  3. 关闭：`stop()` 或进程退出时 `gracefulShutdown()`，再置空 embeddedServer。

### 2.3 MockHttpAdapter（neton-core）

- 无 neton-http 时的测试用适配器：start 时仅打 warn、空转；port() 返回构造时的 mockPort（默认 8080）。用于不启动真实 HTTP 的测试场景。

---

## 三、HttpContext / HttpRequest / HttpResponse

### 3.1 HttpContext（neton-core）

```kotlin
interface HttpContext {
    val traceId: String
    val request: HttpRequest
    val response: HttpResponse
    val session: HttpSession
    val attributes: MutableMap<String, Any>
    fun getAttribute(name: String): Any?
    fun setAttribute(name: String, value: Any)
    fun removeAttribute(name: String): Any?
    fun getApplicationContext(): NetonContext?
}
```

- **traceId**：请求级唯一标识，由适配器在请求入口生成（如 `req-{ts}-{r}`）。**v1.1 冻结**：`HttpContext.traceId` 与 `LogContext.traceId` 必须为**同一值**（同源）；access log / error log 一律使用该 traceId，禁止再引入 requestId 等分裂字段。
- **getApplicationContext()**：返回当前 NetonContext，用于在 handler 内获取 ValidatorRegistry、LoggerFactory 等；neton-http 实现中在构造 HttpContext 时注入。

### 3.2 HttpRequest（neton-core）

- **只读**：method、path、url、version、headers、queryParams、pathParams、cookies、remoteAddress、contentType、contentLength、isSecure 等。
- **请求体**：`body()`、`text()`、`json()`、`form()`（suspend）；由适配器从底层 call 读取。
- **便捷**：isGet/isPost、header(name)、queryParam(name)、pathParam(name)、accepts(contentType) 等。

### 3.3 HttpResponse（neton-core）

- **可写**：status、headers（MutableHeaders）、contentType、contentLength、cookie/removeCookie。
- **写入与快捷方法**：`write(data: ByteArray)`；扩展 `text(data, status)`、`json(data, status)`、`redirect(url, status)`、`notFound()`、`unauthorized()`、`error(status, message)` 等。
- **v1.1 冻结（响应语义二选一，已选 B）**：**response.write 优先**。若 handler 在返回前调用了 `context.response` 的任意“提交”动作（如 `write`、`text`、`json`、`redirect`、`error`、`notFound` 等），则适配器**不再**对 handler 的返回值做 respond；仅当 response 未提交时，才用返回值驱动响应。实现须：① 在适配器内维护 isCommitted，且 **所有** 提交入口（含 redirect，因 core 中 redirect 不调用 write）均置 committed；② commit 后再次 write/text/json/redirect 时 **fail-fast** 抛 HttpException(500, "Response already committed")；③ handleRoute 先判断 isCommitted 再决定是否 handleResponse(result)。

### 3.4 HttpSession（neton-core）

- 接口：id、creationTime、lastAccessTime、maxInactiveInterval、isNew、isValid、get/set/removeAttribute、invalidate()、touch()。
- **v1 硬规则**：Session 默认仅 **in-memory**，**不承诺跨实例、不承诺持久化**。若需分布式 Session，必须在 v2 通过 neton-redis 或专用 session store 实现，不得在 v1 文档或默认实现中暗示“天然跨节点”。
- 实现：Core 提供 MemoryHttpSession；neton-http 当前为内存 Map 实现。

### 3.5 类型与枚举（neton-core）

- **HttpStatus**：OK、CREATED、NO_CONTENT、BAD_REQUEST、UNAUTHORIZED、NOT_FOUND、INTERNAL_SERVER_ERROR 等；带 code、message。
- **HttpMethod**：GET、POST、PUT、DELETE、PATCH、HEAD、OPTIONS、TRACE。
- **Headers / MutableHeaders**、**Parameters**、**Cookie / MutableCookie**：接口由适配器实现（含 Simple* 等简化实现）。

---

## 四、HandlerArgs 与参数视图

### 4.1 接口（neton-core）

```kotlin
interface HandlerArgs {
    fun first(name: String): Any?   // path 优先，否则 query 首个
    fun all(name: String): List<String>?  // 仅 query
    operator fun get(name: String): Any? = first(name)
}
```

- **只读**；path 与 query 分离，避免合并大 Map；查找时 path 优先、再 query，符合路由参数语义。
- **实现**：ArgsView(path: Map, query: Map)、MapBackedHandlerArgs；HTTP 适配器在 handleRoute 中根据 pattern 与请求构建 ArgsView 传入 RouteHandler。

### 4.2 参数解析与 ParamConverter

- **ParamConverterRegistry**：在 HttpConfig 中可配置（如 `http { converters { register(UUID::class, ...) } }`），默认 DefaultParamConverterRegistry（String/Int/Long/Boolean/Double/Float）。
- **ParameterResolver**：SPI，用于从 HttpContext 解析控制器方法参数（PathVariable、RequestBody、ContextObject 等）；与 KSP/路由层配合。
- **ParameterBinding**：PathVariable、RequestBody、AuthenticationPrincipal、ContextObject 等密封类，描述参数来源与类型。

---

## 五、请求处理流程（neton-http）

### 5.1 路由注册

- RequestEngine 由 neton-routing（或 KSP 生成）在 init 阶段注册 RouteDefinition 列表。
- HTTP 适配器 start 后，从 ctx 取 RequestEngine，遍历 getRoutes()，按 method 注册路由（get/post/put/delete/patch/head/options），每个路由执行 `handleRoute`。
- **P1 冻结**：**固定端点（/health、/api/routes、/api/info 等）不得写死在适配器内**。这些端点应由 Routing/RequestEngine 或独立 health、metrics 组件在 init/start 时以普通路由注册；适配器只负责 transport，仅保留**最低限度 404 fallback**（未匹配请求 `route("{...}")` 返回 404）。v1 若暂保留适配器内固定端点，须在文档中标明为过渡，v1.1 迁移至由路由/组件注册。

### 5.2 单请求流程

1. **入口**：handleRoute(route, call)。
2. **traceId**：generateRequestTraceId()；设置 LogContext(traceId, requestId, …)；finally 中 clear。
3. **HttpContext**：request/response/session 为适配层实现。
4. **参数**：buildHandlerArgs(call, pattern) → ArgsView（path 从 pattern 占位符与 URI 解析，query 从 queryParameters，path 优先）。
5. **执行**：`route.handler.invoke(httpContext, args)`，得到返回值 result。
6. **响应（v1.1 冻结·方案 B）**：若 `context.response.isCommitted == true`，**不再**对 result 做 respond；否则 handleResponse(call, result, …)：
   - null/Unit → 204 No Content
   - String → 200 text/plain
   - Map → 200 JSON
   - Number/Boolean → 200 text/plain
   - 其他 → call.respond(result)（序列化后响应）
   - 实现落点：HttpResponse 实现须在 write/text/json/redirect/error 等“提交”动作时置 isCommitted=true，handleRoute 中先判断 response.isCommitted 再决定是否调用 handleResponse(result)。
   - **加固（v1.1）**：① 所有响应入口（text/json/redirect/error/notFound/…）最终都经 write 或显式 commit，保证 commit 点唯一；② commit 后禁止二次写，再次调用 write/text/json/redirect 等须 **fail-fast** 抛 HttpException(500, "Response already committed")；③ 未 commit 时 status 由 handleResponse 语义决定，commit 时 status 必须在 commit 前写入 response.status，access log 统一用 response.status.code。
7. **异常**：ValidationException → 400 + ErrorResponse；HttpException → status + ErrorResponse；其他 → 500 + ErrorResponse。
8. **access log**：finally 中打 **msg 固定 "http.access"**（规范冻结，实现须一致），字段：method、path、status、latencyMs、bytesIn、bytesOut、traceId（与 LogContext 同源）；**可选** routePattern（命中的路由模板，如 `/users/{id}`，便于按路由聚合 metrics/日志）。**bytesOut 语义**：① 通过 write(data) 提交时 = data.size；② **redirect 已 commit 但无 body，v1 bytesOut = 0**；③ 非 committed（返回值驱动）路径 = 不保证，v1 记为 0。这样“committed ≠ bytesOut > 0”的边界明确。

### 5.3 错误响应体（neton-core）

```kotlin
@Serializable
data class ErrorResponse(
    val success: Boolean = false,
    val message: String,
    val errors: List<ValidationError> = emptyList()
)
```

- 4xx/5xx 时由适配器 respond 该结构（或等价 JSON），便于前端统一解析。

---

## 六、HttpComponent 与配置

### 6.1 组件职责（neton-http）

- **HttpComponent**：NetonComponent&lt;HttpConfig&gt;；defaultConfig() = HttpConfig()；init(ctx, config) 时：
  - 从 ctx 或 config 取 ParamConverterRegistry，bind 到 ctx；
  - **HTTP 配置仅来自 application 配置**（见 6.2），不再读取 http.conf；
  - 构造 HttpServerConfig（port、timeout、maxConnections、enableCompression 由 application 配置 + DSL 合并得到）、HTTP 适配器实例，并 bind HttpServerConfig、HttpAdapter 到 ctx。

### 6.2 配置来源（v1.1 冻结）

- **禁止**：不得使用 `loadComponentConfig("HttpComponent")` 或单独 http.conf；HTTP 属于“运行时基础设施”，配置归属与 Core Config v1.1 一致。
- **唯一文件来源**：**仅允许在 application.conf（及 application.&lt;env&gt;.conf）中配置 HTTP**，例如：
  - `[server]`：port 等（与 Core 5.1 推荐骨架一致）；
  - `[http]`：timeout、maxConnections、enableCompression 等。
- **DSL**：`http { port = 8080 }`、`http { converters { ... } }` 仅负责**代码默认值或开发期 override**，不构成独立配置体系。
- **优先级（与 Config v1.1 一致）**：CLI/ENV > application.&lt;env&gt;.conf > application.conf > **DSL defaultConfig**（最低）。HttpComponent 应使用 ConfigLoader.loadApplicationConfig(configPath, env, ctx.args) 得到合并后的 map，再从中读取 server.port、http.timeout 等；若某 key 缺失，再用 DSL config 或默认值。
- 这样可避免 ops 在 application.conf 修改 timeout 后仍被旧 http.conf 或代码默认值覆盖，避免 HTTP 配置分裂成两套。

### 6.3 HttpConfig（neton-core）

```kotlin
class HttpConfig {
    var port: Int = 8080
    var converterRegistry: ParamConverterRegistry? = null
}
fun HttpConfig.converters(block: ParamConverterRegistry.() -> Unit)
```
- 上述 port 等为 **DSL 默认值**；最终生效值 = Config 优先级合并后的结果（见 6.2）。

---

## 七、与 Core / 路由 / 安全的关系

### 7.1 RequestEngine（neton-core）

- **接口**：processRequest(context)、registerRoute(route)、getRoutes()、setAuthenticationContext(authContext)。
- **v1.1 职责收口（P1）**：RequestEngine 的定位为 **“路由注册仓库 + security pipeline”**，**不是**唯一入口模式。当前模型为 **“engine 提供 routes → adapter 按路由注册并驱动”**：
  - **HTTP 适配器**：只消费 getRoutes()，将每个 RouteDefinition 注册到 HTTP 引擎，请求时直接 handleRoute，**不**调用 processRequest。
  - **processRequest**：保留给 **Mock/测试** 或**单 catch-all 适配器**（若未来有仅支持“单 catch-all + engine 内匹配”的实现）使用。
- 认证上下文由 Core 在 configureRequestEngine 阶段 setAuthenticationContext，供路由/守卫使用。

### 7.2 RouteDefinition / RouteHandler（neton-core）

```kotlin
data class RouteDefinition(
    val pattern: String,
    val method: HttpMethod,
    val handler: RouteHandler,
    val parameterBindings: List<ParameterBinding> = emptyList(),
    val controllerClass: String? = null,
    val methodName: String? = null
)
interface RouteHandler {
    suspend fun invoke(context: HttpContext, args: HandlerArgs): Any?
}
```

- 路由由 neton-routing 或 KSP 注册到 RequestEngine；neton-http 仅消费 getRoutes() 并驱动 HTTP 引擎与 handler 调用。

### 7.3 安全

- HttpContext 不直接暴露 principal；认证结果通过 AuthenticationContext / SecurityContext 与 RequestEngine 配合，在参数解析或守卫中使用。详见 Neton-Core-Spec 安全相关章节。

---

## 八、v1 实现限制与后续方向

### 8.1 当前实现限制（v1）

- **Session**：仅 in-memory，不承诺跨实例（见 3.4）。
- **Request/Response 适配**：Simple* 为适配器简化实现；响应语义已按 v1.1 冻结为“response.write 优先”（见 3.3、5.2）。
- **中间件**：无独立 Middleware 管道；日志、异常、access 在 handleRoute 内线性完成。
- **多后端**：当前 HTTP 引擎 + Mock（Core 内 MockHttpAdapter）。
- **固定端点**：/health、/api/routes、/api/info 若仍在适配器内，视为过渡，v1.1 迁移至由路由/组件注册（见 5.1）。

### 8.2 与设计文档的对应关系

- **HTTP 抽象层架构设计**：四层分离、HttpContext 为数据总线、HandlerArgs path/query 分离、ParamConverter/ParameterResolver、错误响应体已落地；协程上下文集成、懒加载、对象池、完整中间件管道为后续。
- **HTTP适配器优化总结**：TraceID（且与 LogContext 同源）、便捷 response 方法、类型安全上下文已具备；simulateRequest 增强、Mock 完整请求模拟可在测试/Mock 模块中补充。

### 8.3 建议的后续步骤

- 固定端点迁移至 Routing/health 组件注册；适配器仅保留 404 fallback。
- Session 分布式：v2 通过 neton-redis 或专用 session store。
- 多后端：新增 neton-http-mock 或 test 专用适配器时，可复用 processRequest 作为入口。

---

## 九、文档与规范引用

- **Neton-Core-Spec v1**：第六节（HTTP 抽象层）、第七节（路由与请求处理）。
- **本规范**：以 neton-core 与 neton-http 当前代码为准；若与 Core Spec 有措辞差异，以 Core Spec 为权威，本文为 HTTP 专项展开与实现说明。
