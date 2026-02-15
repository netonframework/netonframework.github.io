# Neton Core 规范

> **定位**：neton-core = 应用启动、运行时上下文、组件装配、HTTP 抽象、路由与安全接口的「事实规范」。描述 **Neton Core + Runtime + DI** 的真实实现：流程、规则与接口定义。
>
> **状态**：**v1 现状冻结**；**v1.1 冻结约束**已纳入，实现可分期落地，但不得与 v1.1 约束冲突。

---

## 一、概述与分层

### 1.1 职责边界

| 层级 | 职责 | 归属 |
|------|------|------|
| 应用入口 | `Neton.run(args) { }`、`LaunchBuilder`、启动顺序 | neton-core |
| 组件模型 | `NetonComponent<C>`、install、init/start | neton-core |
| 运行时容器 | `NetonContext`（bind/get）、`ServiceFactory`（全局 lookup） | neton-core |
| 配置 | `ConfigLoader`、`NetonConfigRegistry`、`NetonConfigurer` | neton-core |
| HTTP 抽象 | `HttpAdapter`、`HttpContext`、`HttpRequest`、`HttpResponse`、参数与类型 | neton-core |
| 路由与处理 | `RequestEngine`、`RouteDefinition`、`RouteHandler`、`ParameterBinding` | neton-core |
| 安全接口 | `SecurityBuilder`、`Identity`、`Authenticator`、`Guard`、`PermissionEvaluator`、`AuthenticationContext` | neton-core |
| 实现 | HTTP 适配器、路由引擎、安全实现、KSP 生成 | neton-http、neton-routing、neton-security、neton-ksp |

### 1.2 包结构（neton-core）

```
neton.core
├── Neton.kt                    # 入口、LaunchBuilder、Application、KotlinApplication
├── CoreLog.kt                  # 进程级/ctx 级 Logger 注入
├── InjectExtensions.kt         # inject()、get() 扩展
├── component/
│   ├── NetonComponent.kt       # 组件接口
│   ├── NetonContext.kt        # 唯一容器 bind/get
│   └── HttpConfig.kt          # HTTP install DSL 配置
├── config/
│   ├── ConfigLoader.kt        # 约定式配置加载
│   └── NetonConfig.kt         # NetonConfigurer、NetonConfigRegistry、@NetonConfig
├── factory/
│   └── ServiceFactory.kt      # 全局服务注册与 Mock 回退
├── http/
│   ├── adapter/HttpAdapter.kt
│   ├── HttpContext.kt         # Ctx、HttpStatus、HttpMethod、Headers、Parameters、Cookie
│   ├── HttpRequest.kt / HttpResponse.kt
│   ├── HttpSession.kt
│   ├── HandlerArgs.kt         # 参数视图 path/query 分离
│   ├── ParameterResolver.kt  # 参数解析器 SPI + 内置解析器
│   ├── ParamConverter.kt      # 字符串→类型转换 SPI
│   ├── DefaultParamConverterRegistry.kt
│   └── ErrorResponse.kt / HttpException.kt 等
├── interfaces/
│   ├── RequestEngine.kt       # 路由定义、RouteHandler、ParameterBinding
│   ├── SecurityBuilder.kt    # 认证/守卫配置、SecurityConfiguration
│   └── SecurityInterfaces.kt # Identity、Authenticator、Guard、PermissionEvaluator、RequestContext、SecurityAttributes
├── security/
│   ├── AuthenticationContext.kt
│   └── SecurityContext.kt    # 当前用户 ThreadLocal 风格
├── annotations/
│   ├── Controller.kt
│   ├── HttpAnnotations.kt    # Get/Post/PathVariable/Body/Query 等
│   ├── SecurityAnnotations.kt
│   └── AllowAnonymous.kt
└── neton/core/generated/
    └── GeneratedInitializer.kt  # KSP 生成，注册路由等
```

---

## 二、组件模型（NetonComponent）

### 2.1 接口定义

```kotlin
interface NetonComponent<C : Any> {
    fun defaultConfig(): C
    suspend fun init(ctx: NetonContext, config: C)
    suspend fun start(ctx: NetonContext) {}
    suspend fun stop(ctx: NetonContext) {}
}
```

- **C**：DSL block 的配置类型（如 `HttpConfig`、自定义空数据类）。
- **defaultConfig()**：提供默认配置对象，供 `block(config)` 修改。
- **init(ctx, config)**：将组件实现绑定到 `ctx`（如 `ctx.bind(HttpAdapter::class, httpAdapter)`、`ctx.bind(RequestEngine::class, engine)`）。
- **start(ctx)**：可选，用于 warmup、注册额外路由等。
- **stop(ctx)**：可选，当前启动流程未统一调用。

### 2.2 安装方式

```kotlin
fun <C : Any> LaunchBuilder.install(component: NetonComponent<C>, block: C.() -> Unit)
```

- 将 `(component, block)` 存入 `installs`，在 `startSyncWithInstalls` 中按顺序执行 defaultConfig → block → init，再统一 start。

### 2.3 标准组件模板

```kotlin
// ① Config 放在 Component 模块，不放 Core
data class RedisConfig(
    var host: String = "127.0.0.1",
    var port: Int = 6379,
    var database: Int = 0,
    var poolSize: Int = 16
)

// ② Component 实现
object RedisComponent : NetonComponent<RedisConfig> {
    override fun defaultConfig() = RedisConfig()

    override suspend fun init(ctx: NetonContext, config: RedisConfig) {
        ctx.bind(RedisClient::class, DefaultRedisClient(config))
    }

    override suspend fun start(ctx: NetonContext) {
        // 可选：warmup、健康检查
    }

    override suspend fun stop(ctx: NetonContext) {
        // 可选：关闭连接池
    }
}

// ③ 语法糖（可手写，未来 KSP 生成）
fun Neton.LaunchBuilder.redis(block: RedisConfig.() -> Unit = {}) {
    install(RedisComponent, block)
}
```

### 2.4 组件规则

- 组件**无内部可变状态**；所有运行时状态通过 `ctx.bind` 暴露，由 Core 或其它组件通过 `ctx.get` / `ServiceFactory` 使用。
- 先 install 的组件先 init；若某组件依赖另一组件，被依赖者需先 install。
- ❌ 在 Component 内使用 `ctx.config<T>()`（config 由 install 时 merge，init 只接收 final config）
- ❌ 定义 `component.key`（用 `component::class` 标识）
- ❌ 在 init 内做耗时 I/O（应放在 `start`）
- ❌ 在 Component 内持有 mutable 全局状态（状态必须存 ctx）

---

## 三、启动流程

### 3.1 推荐入口

```kotlin
fun main(args: Array<String>) {
    Neton.run(args) {
        install(HttpComponent()) { port = 8080 }
        install(SecurityComponent()) { }
        install(RoutingComponent()) { }
        onStart {
            // KotlinApplication 作用域，可 get<T>()、getPort()
        }
    }
}
```

- `Neton.run(args, block)`：执行 `LaunchBuilder.block()`，再在协程内调用 `builder.startSync(args)`；入口异常用 `CoreLog.logOrBootstrap()` 打日志并重新抛出。
- 等价写法：`Neton.launch(args) { ... }`，同样最终走 `startSync`。

### 3.2 startSync 流程（install 路径）

1. **前置**：若 `installs.isEmpty()` 则 `error("No components installed...")`；否则 `runBlocking { startSyncWithInstalls(args) }`。
2. **创建上下文**：`val ctx = NetonContext(args)`；`ctx.bind(NetonConfigRegistry::class, ...)`；`ctx.bindIfAbsent(LoggerFactory::class, defaultLoggerFactory())`；设置 `CoreLog.log`。
3. **组件 init**：对每个 `(component, block)`：`config = component.defaultConfig()` → `block(config)` → `component.init(ctx, config)`。
4. **组件 start**：对每个 component 调用 `component.start(ctx)`。
5. **同步到 ServiceFactory**：`ctx.syncToServiceFactory()`，将 ctx 内所有绑定写入 `ServiceFactory`。
6. **设置当前上下文**：`NetonContext.setCurrent(ctx)`，随后在 `try/finally` 中执行后续步骤并在结束时 `setCurrent(null)`。
7. **基础设施**：`initializeInfrastructure(ctx, log)` → `GeneratedInitializer.initialize(ctx)`（KSP 注册路由等）。
8. **组件配置块**：若存在 `app.componentConfigBlock`，执行 `ComponentConfigurator` 的 security/routing/http 等（依赖 `ServiceFactory.getSecurityBuilder()` 等，即 install 已注册的实现）。
9. **安全与路由**：`buildSecurityConfigurationFromCtx(ctx)` → `configureRequestEngineFromCtx(ctx, securityConfig)`（为 `RequestEngine` 设置 `AuthenticationContext`）。
10. **用户 onStart**：`userBlock` 在 `startHttpServerSync` 内、`httpAdapter.start(ctx)` 之前执行，传入 `KotlinApplication(actualPort, ctx)`。
11. **HTTP 服务器**：`httpAdapter.start(ctx)`，阻塞直至服务器停止。

### 3.3 端口与配置

- 端口由各 HTTP 组件在 `defaultConfig()` / `block(config)` 中设置（如 `HttpConfig.port`），Adapter 内部持有；Core 不解析 `--port`（可由上层在创建 ctx 前解析并传入 config）。
- 应用主配置：`ConfigLoader.loadApplicationConfig(configPath, environment)`、`ConfigLoader.loadComponentConfig(componentName)` 等，按约定路径加载 TOML；端口优先级为：命令行 > application.conf > 默认 8080。

---

## 四、运行时上下文与 DI

### 4.1 NetonContext

```kotlin
class NetonContext(val args: Array<String>) {
    fun <T : Any> bind(impl: T)                    // 按实现类型绑定
    fun <T : Any> bind(type: KClass<T>, impl: T)   // 按接口类型绑定
    fun <T : Any> bindIfAbsent(type: KClass<T>, impl: T): Boolean
    fun <T : Any> get(type: KClass<T>): T          // 不存在则抛 IllegalStateException
    inline fun <reified T : Any> get(): T
    fun <T : Any> getOrNull(type: KClass<T>): T?
    inline fun <reified T : Any> getOrNull(): T?
    fun syncToServiceFactory()   // 将 registry 全量同步到 ServiceFactory

    companion object {
        fun current(): NetonContext
        internal fun setCurrent(ctx: NetonContext?)
    }
}
```

- **唯一容器**：启动期与运行期共用；Core 不持有 port 等业务语义，仅 bind/get。
- **syncToServiceFactory**：在 install 路径中 init+start 之后调用，使 Controller 等通过 `ServiceFactory.getService(...)` 能拿到与 ctx 一致的实例。

### 4.2 Context 实现建议（生产级）

```kotlin
class NetonContext(val args: Array<String>) {
    private val registry = ConcurrentHashMap<KClass<*>, Any>()  // 并发安全

    fun <T : Any> bind(type: KClass<T>, impl: T) {
        registry[type] = impl
    }

    fun <T : Any> bindIfAbsent(type: KClass<T>, impl: T): Boolean {
        return registry.putIfAbsent(type, impl) == null
    }

    inline fun <reified T : Any> get(): T = get(T::class)
    fun <T : Any> get(type: KClass<T>): T { /* ... */ }
}
```

### 4.3 Context 使用规范

- ✅ `ctx.get<T>()`、`ctx.getOrNull<T>()`：安全获取
- ✅ `ctx.bindIfAbsent(type, impl)`：推荐，避免覆盖导致隐蔽 bug
- ❌ 在 Core 定义 `ctx.port()`、`ctx.httpConfig()` 等业务语义
- ❌ 使用 `mutableMapOf`（应 `ConcurrentHashMap`）
- ❌ 在 ctx 外缓存 `ctx.get<T>()` 结果并跨请求复用（除单例服务外）

### 4.4 ServiceFactory

```kotlin
object ServiceFactory {
    fun <T : Any> registerService(serviceClass: KClass<T>, instance: T)
    fun <T : Any> getService(serviceClass: KClass<T>): T?
    fun getHttpAdapter(): HttpAdapter           // 无则 MockHttpAdapter
    fun getRequestEngine(): RequestEngine       // 无则 MockRequestEngine
    fun getSecurityBuilder(): SecurityBuilder  // 无则 MockSecurityBuilder
    fun getSecurityFactory(): SecurityFactory  // 无则 MockSecurityFactory
    fun getRegisteredServices(): Map<KClass<*>, Any>
    fun hasService(serviceClass: KClass<*>): Boolean
    fun clearServices()  // 测试用
}
```

- **Mock 回退**：未安装对应组件时，`getHttpAdapter` / `getRequestEngine` / `getSecurityBuilder` / `getSecurityFactory` 返回 Mock 实现并打 warn 日志。
- **过渡期**：Controller 等可通过 `ServiceFactory.getService(X::class)` 或 NetonContext.current().get(X::class) 获取服务；推荐在 `Neton.run { }` / `onStart` 作用域内使用 `get<T>()` 或 `inject<T>()`。

### 4.5 注入扩展（InjectExtensions）

```kotlin
inline fun <reified T : Any> inject(): Lazy<T> = lazy { NetonContext.current().get(T::class) }
inline fun <reified T : Any> get(): T = NetonContext.current().get(T::class)
```

- 仅在 `NetonContext.setCurrent(ctx)` 生效的作用域内可用（如 onStart 块、或由 HttpAdapter 在请求处理前设置的上下文）。

### 4.6 v1.1 冻结约束（Runtime/DI）

以下为 v1.1 必须遵守的语义冻结，避免在面向可扩展服务集群时形成结构性债务。

| 约束 | 说明 |
|------|------|
| **唯一权威容器** | **NetonContext** 是实例的唯一权威来源。ServiceFactory 仅作为「桥接层」：在 install 路径中由 `ctx.syncToServiceFactory()` 单向同步后，供 KSP 生成代码等无法直接持有 ctx 的调用方只读使用。禁止在业务代码或组件中向 ServiceFactory 直接 register，导致与 ctx 分叉。 |
| **ServiceFactory 定位** | 要么**只读桥接**（仅从 ctx 同步后的 view，不再接受独立 register），要么在**非测试环境**对 HttpAdapter / RequestEngine / SecurityBuilder / SecurityFactory 做 **fail-fast**：未安装则抛异常，不再 silent Mock 回退。Mock 仅允许在显式 test 或 dev mode 下使用。 |
| **current() 语义** | **NetonContext.current()** 仅表示 **application-scope**（进程级、单例 ctx）。禁止在并发请求中通过 setCurrent 切换请求级上下文；否则多请求/协程下会出现 A 的 lazy inject 读到 B 的绑定。请求级数据**必须**通过 **HttpContext**（attributes、request/response）或 **CurrentLogContext**（logging）传递，不得用「切 current ctx」传递请求上下文。 |
| **inject() / get() 使用范围** | 仅在「应用启动期」且 setCurrent(ctx) 已生效的**单线程/顺序**作用域内使用（如 onStart 块、LaunchBuilder 内部）。请求 handler 内若需访问应用级服务，应通过 **HttpContext.getApplicationContext()?.get<T>()** 或由适配器注入的 ctx 引用，不得依赖 NetonContext.current()。 |
| **生命周期收口** | 组件的 **stop(ctx)** 必须在框架层收口：startSyncWithInstalls 的 **try** 块（含 startHttpServerSync）后的 **finally** 中，先 `setCurrent(null)`，再按 install **逆序**对所有 component 调用 `stop(ctx)`；单组件 stop 抛异常时打 warn 并继续其余组件，不中断收口。实现见下「stop 收口实现方案」。 |
| **DI 路线** | 当前为 **Service Locator**（手动 install + ctx.get / ServiceFactory.getService），不是构造注入。若后续做「构造注入 Controller/Service」，**Native-first 路线**必须采用 **KSP 生成 Provider/Factory**，禁止依赖 kotlin-reflect 运行时构造 resolve。 |

**stop 收口实现方案（最小侵入）**

- **位置**：`startSyncWithInstalls` 内，现有 `try { ... startHttpServerSync(...) } finally { setCurrent(null) }` 的 **finally** 中。
- **顺序**：先执行 `NetonContext.setCurrent(null)`（保持当前语义），再按 **installs 逆序** 对每个 component 调用 `(component as NetonComponent<Any>).stop(ctx)`。
- **异常**：单个 component.stop(ctx) 若抛异常，用 log?.warn("neton.component.stop.failed", mapOf("component" to component::class.simpleName, "message" to (e.message ?: ""))) 记录后 **continue**，不中断后续组件的 stop，避免一个组件清理失败导致其他资源无法释放。
- **HttpAdapter**：不在 Core 中单独调用 httpAdapter.stop()；由 **HttpComponent**（或各 HTTP 实现）在自身的 `stop(ctx)` 中从 ctx 取 HttpAdapter 并调用 stop()，保持「资源释放归组件」的边界。
- **协程**：stop(ctx) 为 suspend，startSyncWithInstalls 已为 suspend，在 runBlocking 内执行，故无需额外 launch。

---

## 五、NetonContext 运行时上下文

### 5.1 上下文架构

```
┌─────────────────────────────────────────────────────────────────┐
│  应用层（main）                                                    │
│  Neton.run(args) { http { }; routing { }; redis { }; onStart { } } │
└──────────────────────────────┬──────────────────────────────────┘
                               │ LaunchBuilder.install(component, block)
┌──────────────────────────────▼──────────────────────────────────┐
│  组件层（NetonComponent）                                          │
│  HttpComponent / RoutingComponent / SecurityComponent / RedisComponent │
│  defaultConfig() → block(config) → init(ctx, config) → start()  │
└──────────────────────────────┬──────────────────────────────────┘
                               │ ctx.bind(Type, impl) / ctx.syncToServiceFactory()
┌──────────────────────────────▼──────────────────────────────────┐
│  上下文与服务（NetonContext + ServiceFactory）                        │
│  NetonContext: 启动期容器，按 KClass 注册/获取                          │
│  ServiceFactory: 运行时全局 lookup，供 Controller 等使用               │
└──────────────────────────────┬──────────────────────────────────┘
                               │ 接口定义在 core，实现在各模块
┌──────────────────────────────▼──────────────────────────────────┐
│  接口层（RequestEngine / HttpAdapter / SecurityBuilder 等）          │
│  Core 定义接口，neton-http / neton-routing / neton-security 实现      │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 生命周期

#### 启动顺序

```
Neton.run { ... }
  → install 时：merge config（file + default + block）
  → 1. initComponents：forEach { component.init(ctx, config) }
  → 2. startComponents：forEach { component.start(ctx) }
  → 3. http.start(ctx)
  → 4. onStart?.invoke(ctx)
```

#### 关闭顺序（推荐）

```
收到 SIGTERM / Ctrl+C
  → http.stop()
  → stopComponents：forEach { component.stop(ctx) }   // 逆序
  → NetonContext.setCurrent(null)
```

#### 阶段语义

| 阶段 | 职责 |
|------|------|
| init | 创建对象、ctx.bind，不做耗时 I/O |
| start | warmup、健康检查、migration、metrics 注册 |
| stop | 关闭连接、释放资源 |

---

## 六、配置

### 6.1 格式与文件体系（v1.1 冻结）

**职责声明**：Neton 只负责读取 TOML 配置。任何 YAML/JSON/INI/ENV-ONLY 的风格，属于外部转换或部署模板范畴，不进入 Neton v1/v2 范围。

| 约束 | 说明 |
|------|------|
| **唯一格式** | v1.1 只支持 **TOML**。ConfigLoader 只提供 TOML 解析器；不提供 YAML/JSON/HOCON。其它格式通过部署/CI 工具转成 TOML 后由框架读取。 |
| **配置目录** | `--config-path` 指定（默认 `./config`）。框架只在该目录下查找约定文件名，不扫描其它文件。 |
| **主配置** | **application.conf**（内容 TOML）：仅放 core/runtime/http/logging/trace/metrics 等全局配置。 |
| **模块独立文件** | 每个模块一个文件：**<module>.conf**（TOML）。约定：`application.conf`、`database.conf`、`redis.conf`、`cache.conf`、`security.conf`、`routing.conf` 等。模块自治、边界清晰。 |
| **环境覆盖** | 每个模块均支持环境覆盖：**<module>.<env>.conf**（如 `database.prod.conf`、`redis.dev.conf`）。 |
| **模块名来源** | 由各 Component/模块提供常量 **moduleName**（如 `HttpComponent.moduleName = "application"`、`DatabaseComponent.moduleName = "database"`）。ConfigLoader **只认 moduleName**，不做 className→fileName 的魔法推断，避免重构破坏配置文件名。 |
| **v1 禁止** | 不支持 **include / import / ${var}** 等跨文件引用与变量插值。需复用则由外部工具（helm/kustomize/ansible/consul-template）生成最终 conf。 |

**点分路径与 TOML 对应**（冻结映射）：

- `server.port` → `[server]` 下 `port = 8080`
- `logging.level` → `[logging]` 下 `level = "INFO"`
- `redis.host` → `[redis]` 下 `host = "127.0.0.1"`
- 数组/表数组：按 TOML `[[section]]` 语义；路径访问仅走 table 层级，**不支持表达式与 selector**。

**ConfigLoader 职责**：按 configPath + 文件名加载、环境选择、与 CLI/ENV 叠加、深度合并、点分路径取值；不负责模块语义（如 database 的 pool 解析由 neton-database 自行解析 ConfigLoader 返回的 Map）。

### 6.2 ConfigLoader 接口与发现规则

- **loadModuleConfig(moduleName, configPath, env)**：加载 `<module>.conf` 与可选 `<module>.<env>.conf`，合并后返回 `Map<String, Any?>`。组件在 `init(ctx, config)` 时用模块名调用，再解析成自身强类型 Config。
- **readCliOverrides(args)** / **readEnvOverrides()**：建议提供，用于与文件合并时的优先级顶层（CLI/ENV 覆盖文件内值）。具体 key 命名约定（如 `--server.port`、`NETON_SERVER_PORT`）可单独冻结。
- **getConfigValue(config, path, default)**：点分路径取值，path 仅走 table 层级；类型仅认 TOML 原生（string/int/float/bool/datetime/array/table）。
- 实现必须做真实 I/O + TOML 解析，禁止 when 分支占位；文件不存在时可返回空 Map 或按约定 fallback，解析失败必须报错并包含文件路径与行号等字段。

### 6.3 NetonConfigRegistry 与 NetonConfigurer

```kotlin
interface NetonConfigurer<T : Any> {
    val order: Int get() = 0
    fun configure(ctx: NetonContext, target: T)
}

@Target(AnnotationTarget.CLASS)
annotation class NetonConfig(val component: String, val order: Int = 0)

interface NetonConfigRegistry {
    val securityConfigurers: List<NetonConfigurer<SecurityBuilder>>
}

object EmptyNetonConfigRegistry : NetonConfigRegistry { ... }
```

- **LaunchBuilder.configRegistry(registry)**：传入 KSP 生成的 Registry；不传则使用 `EmptyNetonConfigRegistry`。
- 业务层通过 `@NetonConfig("security")` + 实现 `NetonConfigurer<SecurityBuilder>` 参与安全配置；在组件 start 之后、应用 Configurer 时从 registry 取列表并按 order 执行。

### 6.4 v1.1 配置优先级与合并规则冻结

以下为 v1.1 必须落地的配置语义；实现可分期，但规则一旦写入代码即不可与下列约定冲突。

**总优先级（高→低）**：**命令参数（CLI）** > **环境变量（.env + ENV）** > **env 配置（*.<env>.conf）** > **默认配置（*.conf）** > **代码默认值**。

| 规则 | 说明 |
|------|------|
| **1. 命令参数** | `--server.port=8081`、`--env=prod` 等，最高优先级。 |
| **2. 环境变量** | `.env` 文件及进程 ENV（如 `NETON_SERVER__PORT=8081`，规则见 6.6）。 |
| **3. env 配置** | `<module>.<env>.conf`（如 `application.prod.conf`），覆盖同模块 base。 |
| **4. 默认配置** | `<module>.conf`（如 `application.conf`），基础层。 |
| **5. 代码默认值** | 最低。 |
| **合并规则** | **table**：深度合并（同 key 环境覆盖基础，未出现 key 保留）。**数组/列表**：整体覆盖，不逐项 merge。 |
| **路径命名空间** | 点分路径**第一段固定为模块名**：`server.port` 属 application.conf、`database.url` 属 database.conf、`redis.endpoint` 属 redis.conf。禁止跨模块用裸 `"url"` 等弱路径；读配置 API 需体现模块作用域。 |
| **读配置 API** | 建议：`ctx.config("database").getString("url")` 或 `registry.module("database").getString("url")`；类型化 getInt/getString/getBoolean 仅支持标量 + 嵌套 table，v1 不要求完整 Bean 绑定。 |
| **真实加载** | 必须做真实 I/O + **TOML** 解析，禁止 when 占位。解析失败与 unknown/type 策略见 6.6。 |
| **文件名** | 主配置：`application.conf` / `application.<env>.conf`。模块：`<module>.conf` / `<module>.<env>.conf`。仅在此两类文件名下查找，不扫其它文件。 |

**application.conf 推荐骨架**（仅作示例，非强制结构）：

```toml
[server]
port = 8080

[logging]
level = "INFO"

# 多 sink 后续扩展 multi-sink 时自然
[[logging.sinks]]
type = "file"
levels = ["ERROR", "WARN"]
path = "/var/log/neton/error.log"

[[logging.sinks]]
type = "file"
levels = ["INFO", "DEBUG"]
path = "/var/log/neton/app.log"

[redis]
endpoint = "127.0.0.1:6379"
prefix = "neton"

[cache]
codec = "json"
```

各模块独立文件（如 database.conf、redis.conf、cache.conf）仅包含本模块 table，结构由各 neton-* 模块自行约定。

### 6.5 Environment 解析规则（冻结）

**env** 用于选择加载 `<module>.<env>.conf`（如 `application.dev.conf`、`database.prod.conf`）。由 `ConfigLoader.resolveEnvironment(args)` 统一解析。

**优先级**：**命令参数 > 环境变量**。

| 优先级 | 来源 | 示例 |
|--------|------|------|
| 1 | CLI | `--env=prod` |
| 2 | ENV | `NETON_ENV=prod`、`ENV=prod`、`NODE_ENV=production` |
| 3 | 默认 | `"dev"` |

- 启动时解析一次，传入 `loadApplicationConfig(configPath, env, args)` 与 `loadModuleConfig(..., environment = env, ...)`。
- Banner 中的 `Environment` 字段显示该解析结果。

### 6.6 v1.1 ENV/CLI 命名与解析策略冻结

以下条款保证「覆盖来源」与「错误行为」在实现时不分裂；所有模块共用同一套规则。

**ENV 规则（冻结）**

| 规则 | 说明 |
|------|------|
| 前缀 | 环境变量统一前缀：**NETON_**。无此前缀的 ENV 不参与配置覆盖。 |
| 路径分隔 | 点分路径中的 `.` 在 ENV 中用 **双下划线 `__`** 表示。 |
| **路径大小写** | 去掉前缀、将 `__` 替换为 `.` 后，**路径整体转小写**，与 TOML table 命名一致（如 `NETON_SERVER__PORT` → `server.port`）。 |
| 示例 | `NETON_SERVER__PORT=8081` → `server.port = 8081`；`NETON_DATABASE__URL=...` → `database.url = ...`。 |
| v1 范围 | 仅支持**标量**（string/int/bool/float）。**数组/table 不支持通过 ENV 注入**（v1 不提供 list 的 ENV 语法，避免与「禁止插值」一致）。 |

**CLI 规则（冻结）**

| 规则 | 说明 |
|------|------|
| 形式 | `--key=value`，`key` 为点分路径。 |
| 示例 | `--server.port=8081`、`--database.url=...`。 |
| v1 范围 | 只支持**标量**（string/int/bool）；list/table 不支持（v1 简化，避免歧义）。 |

**Unknown key 与类型错误（冻结）**

| 策略 | 说明 |
|------|------|
| **unknown key** | **默认忽略**（兼容未来新增字段、向前兼容）。可选：debug 模式下对 unknown key 打 **warn** 日志，便于发现拼写错误。 |
| **类型错误** | **fail-fast**：启动时直接报错退出。错误信息必须包含：**文件名、行号、key 路径、期望类型、实际类型**。禁止「类型错时降级为 string」或静默忽略，保证配置错即立即死、不带病上线。 |

### 6.7 配置 Merge 优先级

1. `component.defaultConfig()`（代码默认）
2. `config/<module>.conf`（文件，TOML）
3. `config/<module>.<env>.conf`（环境覆盖）
4. `install(Component) { block }`（DSL 覆盖，最高优先级）

组件 **只接收** final config，不在 init 内调用 `ctx.config<T>()`。Config 必须是 data class，支持 merge（可借助 kotlinx.serialization）。

---

## 七、HTTP 抽象层

### 7.1 HttpAdapter

```kotlin
interface HttpAdapter {
    suspend fun start(ctx: NetonContext)
    suspend fun stop()
    fun port(): Int
}
```

- Core 只定义接口；port 与具体配置由实现（HTTP 适配器）在组件 config 中设置。
- 废弃：`runCompat(port, args)` 仅兼容旧路径，会临时构造 ctx 并从 ServiceFactory 填充后调用 `start(ctx)`。

### 7.2 Adapter 规范

#### 职责

- Adapter 实现 Core 定义的 interface
- Adapter 持有 Config（port、host 等），Core 不持有
- Adapter 通过构造函数或工厂接收 config

#### HttpAdapter 标准形态

```kotlin
// Core 定义
interface HttpAdapter {
    suspend fun start(ctx: NetonContext)
    suspend fun stop()
}

// neton-http 实现
class HttpAdapterImpl(private val config: HttpConfig) : HttpAdapter {
    override suspend fun start(ctx: NetonContext) {
        val requestEngine = ctx.get<RequestEngine>()
        configureRouting(requestEngine)
        // port 已在 config 中，无需 Core 传递
        httpAdapter.start(ctx)
    }
}
```

#### 禁止事项

- ❌ 在 Adapter 内依赖 `NetonContext.current()` 做核心逻辑（应通过参数传入 ctx）
- ❌ 在 Adapter 内硬编码配置默认值（应从 Config 读取）

### 7.3 HttpContext / HttpRequest / HttpResponse

- **HttpContext**：`traceId`、`request`、`response`、`session`、`attributes`、`getApplicationContext(): NetonContext?`。
- **HttpRequest**：`method`、`path`、`url`、`version`、`headers`、`queryParams`、`pathParams`、`cookies`、`remoteAddress`、`body()`、`text()`、`json()`、`form()` 等。
- **HttpResponse**：`status`、`headers`、`write(data)`、`text()`、`json()`、`redirect()`、`notFound()`、`unauthorized()` 等。
- **HttpStatus** / **HttpMethod**：枚举；**Headers** / **MutableHeaders**、**Parameters**、**Cookie** / **MutableCookie** 为接口，由适配器实现。

### 7.4 HandlerArgs（参数视图）

```kotlin
interface HandlerArgs {
    fun first(name: String): Any?   // path 优先，否则 query 首个
    fun all(name: String): List<String>?  // 仅 query
    operator fun get(name: String): Any? = first(name)
}
```

- 只读；path 与 query 分离，避免合并大 Map；路由层用 `ArgsView(path, query)` 或 `MapBackedHandlerArgs` 实现。

### 7.5 ParamConverter 与 ParamConverterRegistry

```kotlin
interface ParamConverter<T> {
    fun convert(value: String): T?
}

interface ParamConverterRegistry {
    fun <T : Any> register(type: KClass<T>, converter: ParamConverter<T>)
    fun <T : Any> getConverter(type: KClass<T>): ParamConverter<T>?
    fun <T : Any> convert(value: String, type: KClass<T>): T?
}
```

- **HttpConfig.converterRegistry**：可在 `http { converters { register(UUID::class, ...) } }` 中注册；默认使用 `DefaultParamConverterRegistry`（内置 String/Int/Long/Boolean/Double/Float）。
- **ParamConverters**：`parseBoolean`、`parseInt`、`parseLong`、`parseDouble` 等工具，空字符串可返回 null。

---

## 八、路由与请求处理

### 8.1 RequestEngine

```kotlin
interface RequestEngine {
    suspend fun processRequest(context: HttpContext): Any?
    fun registerRoute(route: RouteDefinition)
    fun getRoutes(): List<RouteDefinition>
    fun setAuthenticationContext(authContext: AuthenticationContext)
}
```

- **processRequest**：由 HttpAdapter 在收到请求时调用；内部匹配路由、解析参数、执行 RouteHandler、写响应。
- **registerRoute**：由 neton-routing 或 KSP 生成代码调用。
- **setAuthenticationContext**：由 Core 在 configureRequestEngine 阶段调用，来自 SecurityBuilder.build()。

### 8.2 RouteDefinition / RouteMatch / RouteHandler

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

- 路由匹配结果由实现方提供（如 path 参数 Map）；Core 仅定义 `RouteDefinition` 与 `RouteHandler` 契约。

### 8.3 ParameterBinding（密封类）

```kotlin
sealed class ParameterBinding {
    abstract val parameterName: String
    abstract val parameterType: KClass<*>
    data class PathVariable(...) : ParameterBinding()
    data class RequestBody(...) : ParameterBinding()
    data class CurrentUser(...) : ParameterBinding()
    data class ContextObject(...) : ParameterBinding()
}
```

- 与 KSP/路由层配合，描述控制器方法参数如何从 HttpContext/HandlerArgs 解析。

### 8.4 ParameterResolver（SPI）

```kotlin
interface ParameterResolver {
    fun canResolve(parameterType: String, annotations: List<String>): Boolean
    suspend fun resolve(parameterName: String?, context: HttpContext): Any?
    val priority: Int get() = 100
}
```

- 内置：CurrentUserResolver、HttpRequestResolver、HttpResponseResolver、HttpSessionResolver、PathVariableResolver、QueryParamResolver、FormParamResolver、HeaderResolver、CookieResolver、BodyResolver；通过 **ParameterResolverRegistry** 注册与排序，按 priority 选用。

### 8.5 RequestProcessingException

- **RouteNotFoundException**、**ParameterBindingException**、**MethodInvocationException**、**ResponseSerializationException**：供实现层抛出，Core 仅定义类型。

---

## 九、安全接口（v1.2 Identity-based）

### 9.1 SecurityBuilder

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

data class SecurityConfiguration(
    val isEnabled: Boolean,
    val authenticatorCount: Int,
    val guardCount: Int,
    val authenticationContext: AuthenticationContext
)
```

- 认证器/守卫由 Security 组件实现并注册；**build()** 在启动时被调用，得到 **AuthenticationContext** 并注入 **RequestEngine**。

### 9.2 Identity / Authenticator / Guard / PermissionEvaluator / RequestContext

```kotlin
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

interface Authenticator {
    val name: String
    suspend fun authenticate(context: RequestContext): Identity?
}

interface Guard {
    suspend fun checkPermission(identity: Identity?, context: RequestContext): Boolean
}

fun interface PermissionEvaluator {
    fun allowed(identity: Identity, permission: String, context: RequestContext): Boolean
}

object SecurityAttributes {
    const val IDENTITY = "identity"
}

interface RequestContext {
    val path: String
    val method: String
    val headers: Map<String, String>
    val routeGroup: String?
}
```

- **RequestContext** 为安全层抽象，可由 HttpContext 适配。
- **v1.2 变更**：使用 `Identity`（替代 Principal）、`Guard.checkPermission`（替代 Guard.authorize）、`PermissionEvaluator`、`SecurityAttributes.IDENTITY`。

### 9.3 AuthenticationContext / SecurityContext

```kotlin
interface AuthenticationContext {
    fun currentUser(): Any?
}

object SecurityContext {
    fun setIdentity(identity: Identity?)
    fun currentIdentity(): Identity?
    fun isAuthenticated(): Boolean
    fun hasRole(role: String): Boolean
    fun hasPermission(permission: String): Boolean
    // ...
}
```

- **AuthenticationContext** 由 SecurityBuilder 提供，供 RequestEngine 等获取当前用户。
- **SecurityContext** 为全局 ThreadLocal 风格入口，由安全实现层在请求入口设置 identity。

---

## 十、架构概览

### 10.1 整体分层

```
┌─────────────────────────────────────────────────────────────────┐
│  应用层（main）                                                    │
│  Neton.run(args) { http { }; routing { }; redis { }; onStart { } } │
└──────────────────────────────┬──────────────────────────────────┘
                               │ LaunchBuilder.install(component, block)
┌──────────────────────────────▼──────────────────────────────────┐
│  组件层（NetonComponent）                                          │
│  HttpComponent / RoutingComponent / SecurityComponent / RedisComponent │
│  defaultConfig() → block(config) → init(ctx, config) → start()  │
└──────────────────────────────┬──────────────────────────────────┘
                               │ ctx.bind(Type, impl) / ctx.syncToServiceFactory()
┌──────────────────────────────▼──────────────────────────────────┐
│  上下文与服务（NetonContext + ServiceFactory）                        │
│  NetonContext: 启动期容器，按 KClass 注册/获取                          │
│  ServiceFactory: 运行时全局 lookup，供 Controller 等使用               │
└──────────────────────────────┬──────────────────────────────────┘
                               │ 接口定义在 core，实现在各模块
┌──────────────────────────────▼──────────────────────────────────┐
│  接口层（RequestEngine / HttpAdapter / SecurityBuilder 等）          │
│  Core 定义接口，neton-http / neton-routing / neton-security 实现      │
└─────────────────────────────────────────────────────────────────┘
```

### 10.2 核心模块结构

| 包 | 职责 |
|----|------|
| `Neton.kt` | 入口：`run(args) { }` / `LaunchBuilder`，启动流程、协程包装（runBlocking）、ServerTask 等 |
| `component/` | `NetonComponent<C>` 接口、`NetonContext`（KClass→Any 容器）、`HttpConfig` |
| `config/` | `ConfigLoader`（约定式 TOML 加载）、`NetonConfig` / `NetonConfigurer`（KSP 配置器 SPI） |
| `factory/` | `ServiceFactory`（全局服务 lookup，含 Mock 回退）、`ComponentRegistry` |
| `http/` | `HttpContext` / `HttpRequest` / `HttpResponse` / `ParameterResolver`，`HttpAdapter` 接口 |
| `interfaces/` | `RequestEngine`、`SecurityBuilder`、`RouteDefinition`、`ParameterBinding` |
| `security/` | `AuthenticationContext`、`SecurityContext` |
| `annotations/` | `@Controller`、`@Get`、`@Post`、`@PathVariable`、`@AllowAnonymous` 等 |
| `neton/core/generated/` | KSP 生成 `GeneratedInitializer`，注册路由等 |

### 10.3 极简设计评估

#### 易用性 ✅

| 方面 | 现状 | 说明 |
|------|------|------|
| 启动 DSL | `Neton.run(args) { http { }; routing { }; onStart { } }` | 上手成本低 |
| 组件安装 | `install(Component) { config }`，各模块提供 `http { }`、`redis { }` 等语法糖 | 按需组合，无强制依赖 |
| 服务获取 | `ServiceFactory.getService(RedisClient::class)` | 简单 lookup，无复杂 DI |
| 配置 | `ConfigLoader.loadComponentConfig("RedisComponent")` + `config/redis.conf` | 约定优于配置，DSL 可覆盖 |

**不足**：`Neton.kt` 内 ServerTask / HttpServerWrapper 等启动路径较绕，协程封装层级多，新人阅读成本高。

#### 性能 ⚠️

| 方面 | 现状 | 说明 |
|------|------|------|
| 服务注册 | `NetonContext` + `ServiceFactory` 均为 `MutableMap<KClass<*>, Any>` | O(1) lookup，无反射 |
| 路由注册 | KSP 生成 `GeneratedInitializer`，编译期注册 | 无运行时扫描，启动快 |
| 协程 | `runBlocking` 启动 HTTP 服务器 | 主线程阻塞 |
| ConfigLoader | 按约定路径加载 TOML | 真实 I/O + 解析 |

**不足**：NetonContext 与 ServiceFactory 双重存储，存在冗余。

#### 灵活性 ✅

| 方面 | 现状 | 说明 |
|------|------|------|
| 接口与实现分离 | `HttpAdapter`、`RequestEngine`、`SecurityBuilder` 等均在 core 定义 | 可替换实现，Mock 回退 |
| 组件化 | `NetonComponent<C>` 统一生命周期 | 新组件仅需实现接口 + install DSL |
| 配置器 SPI | `NetonConfigurer<T>` + `@NetonConfig(component)`，KSP 生成 registry | 业务层可参与配置，无侵入 core |
| Mock 支持 | `MockHttpAdapter`、`MockRequestEngine` 等 | 无 HTTP 模块时仍可运行，便于测试 |

**不足**：Mock 与真实实现切换依赖 ServiceFactory 注册顺序，无显式「测试模式」开关。

---

## 十一、SPI 最佳实践

### 11.1 分层法则（铁律）

| Layer | 允许 | 禁止 |
|-------|------|------|
| **Core** | 仅定义 interface（HttpAdapter、RequestEngine、RedisClient 等） | port、defaultPort、HttpConfig、RedisConfig 等具体配置 |
| **Component** | Config data class、实现类、ctx.bind | 暴露 HTTP/Redis/DB 等语义给 Core |
| **Adapter** | HTTP 适配器、Redis 驱动、sqlx4k 等底层实现 | — |

**原则**：抽象可上移，配置不能上移。

### 11.2 Component 禁止事项

- ❌ 在 Component 内使用 `ctx.config<T>()`（config 由 install 时 merge，init 只接收 final config）
- ❌ 定义 `component.key`（用 `component::class` 标识）
- ❌ 在 init 内做耗时 I/O（应放在 `start`）
- ❌ 在 Component 内持有 mutable 全局状态（状态必须存 ctx）

### 11.3 禁止事项汇总

| 类别 | 禁止 |
|------|------|
| Core | defaultPort、ctx.port()、HttpConfigProvider、任何 HTTP/Redis/DB 配置 |
| Component | key、ctx.config()、mutable 全局状态、init 内耗时 I/O |
| Context | mutableMapOf、无 bindIfAbsent 的覆盖式 bind |
| Adapter | 依赖 current() 做核心逻辑、硬编码默认配置 |
| 通用 | 反射、classpath 扫描、动态 BeanFactory、运行期依赖解析 |

### 11.4 生态扩展优先级（建议）

1. redis
2. database
3. security
4. routing
5. openapi
6. cli
7. test kit

---

## 十二、Config SPI 设计规范

### 12.1 设计原则

- **SSOT**: 注解为唯一元数据来源
- **零反射**: 编译期 KSP 生成，Native 友好
- **分层解耦**: DSL / Component / Config SPI 职责清晰，禁止跨层

### 12.2 分层架构

| 层级 | 标准术语 | 职责 | 示例 |
|------|----------|------|------|
| **Install Layer** | DSL 层 | 声明安装哪些组件、传递基础参数 | `security { }`、`http { port = 8080 }` |
| **Runtime Service Layer** | Component 层 | 提供能力、绑定到 ctx | `SecurityComponent`、`HttpComponent` |
| **Extension Layer** | Config SPI 层 | 业务逻辑的声明式配置 | `@NetonConfig("security") class AppSecurityConfig` |
| **Compile-time Discovery** | KSP 层 | 扫描注解、生成 Registry | `GeneratedNetonConfigRegistry` |
| **Lifecycle Hook** | Runtime Apply | 应用 Configurer 到目标 | `configurers.sortedBy { it.order }.forEach { it.configure(ctx, target) }` |

### 12.3 分层原则（必须遵守）

| 原则 | 说明 |
|------|------|
| **DSL 只负责安装** | 端口、开关、中间件等基础设施参数；**禁止**写业务逻辑 |
| **Component 只提供服务** | 暴露 Builder / Manager 到 ctx；**禁止**承载业务状态 |
| **Config SPI 只做业务扩展** | 认证规则、权限逻辑、拦截器；**禁止**在 DSL 里写 |
| **禁止跨层** | 不得在 DSL block 中调用 `ctx.get()` 写业务；不得在 Configurer 中 install 组件 |

### 12.4 生命周期模型

```
Neton.run {
    configRegistry(GeneratedNetonConfigRegistry())  // 可选，不传则用 EmptyNetonConfigRegistry
    security { }                                    // DSL block
}
```

**执行顺序**：

```
1. ctx.bind(NetonConfigRegistry)
2. for each component in installs:
   a. config = component.defaultConfig()
   b. block(config)           ← DSL 对 config 的配置
   c. component.init(ctx, config)
   d. component.start(ctx)    ← 在此应用 Configurers
```

**onStart 中的 Configurer 应用**：

```kotlin
ctx.getOrNull(NetonConfigRegistry::class)?.securityConfigurers
    ?.sortedBy { it.order }
    ?.forEach { it.configure(ctx, config) }
```

### 12.5 何时使用 Configurer

| 场景 | 使用方式 | 示例 |
|------|----------|------|
| **业务逻辑** | Configurer | 注册 mock 认证、JWT、角色守卫 |
| **基础设施** | DSL | 端口、host、开关 |
| **需要 ctx** | Configurer | 依赖 Redis、其他 Service |
| **需要顺序** | Configurer + order | DataSourceConfig → SecurityConfig |

**判断标准**：若逻辑与具体业务相关（认证、权限、数据源、消息队列配置），一律用 Configurer；若为框架级开关或连接参数，用 DSL。

### 12.6 核心 API

#### NetonConfigurer

```kotlin
interface NetonConfigurer<T : Any> {
    val order: Int get() = 0
    fun configure(ctx: NetonContext, target: T)
}
```

- `order`: 执行顺序，小值先执行；由 `@NetonConfig(order = X)` 注入，**用户不得手写 override**
- `configure`: 接收 `ctx`（可访问其他 Service）和 `target`（组件 Builder）

#### @NetonConfig

```kotlin
@Target(AnnotationTarget.CLASS)
annotation class NetonConfig(
    val component: String,   // "security" | "routing" | ...
    val order: Int = 0
)
```

- `component`: 目标组件 key，与 `NetonComponent.key` 对应
- `order`: 唯一 order 来源，KSP 通过 `NetonConfigurers.ordered(order, configurer)` 注入

#### NetonConfigRegistry

```kotlin
interface NetonConfigRegistry {
    val securityConfigurers: List<NetonConfigurer<SecurityBuilder>>
}
```

由 KSP 生成 `GeneratedNetonConfigRegistry` 实现；应用入口调用 `configRegistry(GeneratedNetonConfigRegistry())` 传入。

#### 类型别名

```kotlin
typealias SecurityConfigurer = NetonConfigurer<SecurityBuilder>
```

业务层推荐使用 `SecurityConfigurer` 等语义化别名。

### 12.7 组件开发模板

新增 Neton 组件并支持 Config SPI 的 5 步：

**Step 1: 定义 Builder 接口（neton-core 或组件模块）**

```kotlin
interface XxxBuilder {
    fun registerSomething(...)
    fun build(): XxxConfiguration
}
```

**Step 2: 定义 Component**

```kotlin
object XxxComponent : NetonComponent<XxxBuilder> {
    override val key = "xxx"
    override fun defaultConfig() = RealXxxBuilder()
    override fun init(ctx, config) {
        ctx.bind(XxxBuilder::class, config)
    }
    override fun start(ctx) {
        ctx.getOrNull(NetonConfigRegistry::class)?.xxxConfigurers
            ?.sortedBy { it.order }
            ?.forEach { it.configure(ctx, config) }
    }
}
```

**Step 3: 扩展 NetonConfigRegistry**

```kotlin
interface NetonConfigRegistry {
    val securityConfigurers: List<NetonConfigurer<SecurityBuilder>>
    val xxxConfigurers: List<NetonConfigurer<XxxBuilder>>  // 新增
}
```

**Step 4: 扩展 NetonConfigProcessor**

在 KSP Processor 中为 `"xxx"` component 生成 `xxxConfigurers` 列表。

**Step 5: 提供 DSL 与 typealias**

```kotlin
fun Neton.LaunchBuilder.xxx(block: XxxBuilder.() -> Unit) = install(XxxComponent, block)
typealias XxxConfigurer = NetonConfigurer<XxxBuilder>
```

### 12.8 明确「不做什么」

| 禁止项 | 原因 |
|--------|------|
| **运行期 classpath 扫描** | 破坏 Native、启动慢、不可预测 |
| **反射注册** | Native 不友好、类型不安全 |
| **业务逻辑写在 DSL** | 导致 DSL 膨胀、不可测试、不可模块化 |
| **Configurer 中手写 override val order** | order 仅来自注解，避免双来源 |
| **在 DSL 中 install 业务模块** | install 只做基础设施，业务用 Configurer |

---

## 十三、注解（Core 定义）

### 13.1 控制器与路由

| 注解 | 作用目标 | 说明 |
|------|----------|------|
| @Controller(path) | CLASS | 控制器类，path 为基础路径，默认 "" |
| @Get(value) / @Post / @Put / @Delete / @Patch / @Head / @Options | FUNCTION | HTTP 方法 + 路径片段 |

### 13.2 参数绑定

| 注解 | 说明 |
|------|------|
| @PathVariable(value) | 路径参数，value 为空则用参数名 |
| @Body | 请求体（JSON 等） |
| @QueryParam(value) / @Query(value) | 查询参数 |
| @FormParam(value) | 表单参数 |
| @Header(value) | 请求头 |
| @Cookie(value) | Cookie |
| @CurrentUser(required) | 注入当前 Identity，required 默认 true；Identity 类型参数可省略此注解 |

### 13.3 安全

| 注解 | 说明 |
|------|------|
| @AllowAnonymous | 允许匿名访问，优先级最高 |
| @RequireAuth | 需认证 |
| @RolesAllowed(roles) | 需指定角色 |
| @Permission(value) | 需指定权限，方法级覆盖类级 |
| @CurrentUser(required) | 注入当前 Identity（v1.2 推荐，替代 @AuthenticationPrincipal） |

---

## 十四、KotlinApplication 与编译期

### 14.1 KotlinApplication

```kotlin
class KotlinApplication(private val port: Int, private val ctx: NetonContext?) {
    fun getPort(): Int
    fun <T : Any> get(type: KClass<T>): T
    fun printInfo(message: String)
    fun getRegisteredRoutes(): List<RouteDefinition>
    fun getSecurityStatus(): SecurityConfiguration
}
```

- 在 **onStart** 块中传入；用于在应用就绪后获取端口、服务、路由列表、安全状态等。

### 14.2 GeneratedInitializer（KSP）

```kotlin
object GeneratedInitializer {
    fun initialize(ctx: NetonContext?)
}
```

- 无控制器时仅打提示；KSP 在有 @Controller 时生成注册路由等逻辑，在 **initializeInfrastructure** 中被调用。

---

## 十五、日志（Core 内）

- **CoreLog**：`log: Logger?` 在 startSync 中从 `ctx.getOrNull(LoggerFactory::class)` 设置；早于 ctx 的路径用 **logOrBootstrap()** / **ensureBootstrap()** 使用进程级 Logger（defaultLoggerFactory().get("neton.core")）。
- **defaultLoggerFactory()**：expect/actual，common 为 expect，各平台提供实际 LoggerFactory。

---

## 十六、冻结约束总结

### 16.1 v1.1 Runtime/DI 冻结约束

| 约束 | 说明 |
|------|------|
| **唯一权威容器** | NetonContext 是实例的唯一权威来源；ServiceFactory 仅作桥接层 |
| **ServiceFactory 定位** | 只读桥接或 fail-fast；禁止 silent Mock 生产环境 |
| **current() 语义** | 仅表示 application-scope；请求级用 HttpContext |
| **inject() / get() 使用范围** | 仅在应用启动期单线程作用域内使用 |
| **生命周期收口** | stop(ctx) 必须在框架层收口，按 install 逆序执行 |
| **DI 路线** | Service Locator；Native-first 路线用 KSP 生成 Provider |

### 16.2 v1.1 配置冻结约束

| 约束 | 说明 |
|------|------|
| **唯一格式** | TOML only |
| **配置目录** | `--config-path` 指定（默认 `./config`） |
| **主配置** | application.conf |
| **模块独立文件** | <module>.conf |
| **环境覆盖** | <module>.<env>.conf |
| **优先级** | CLI > ENV > env 配置 > 默认配置 > 代码默认值 |
| **路径命名空间** | 点分路径第一段固定为模块名 |
| **真实加载** | 真实 I/O + TOML 解析，禁止 when 占位 |

### 16.3 SPI 禁止事项

| 类别 | 禁止 |
|------|------|
| Core | defaultPort、ctx.port()、HttpConfigProvider、任何 HTTP/Redis/DB 配置 |
| Component | key、ctx.config()、mutable 全局状态、init 内耗时 I/O |
| Context | mutableMapOf、无 bindIfAbsent 的覆盖式 bind |
| Adapter | 依赖 current() 做核心逻辑、硬编码默认配置 |
| 通用 | 反射、classpath 扫描、动态 BeanFactory、运行期依赖解析 |

### 16.4 规则小结

| 规则 | 说明 |
|------|------|
| 唯一入口 | 应用通过 `Neton.run(args) { install(...); onStart { } }` 启动 |
| 组件无状态 | Component 不持有可变状态，全部通过 ctx 暴露 |
| 接口在 Core | HttpAdapter、RequestEngine、SecurityBuilder、SecurityFactory 等均在 core 定义，实现由各模块提供 |
| **v1.1 容器** | ctx 为唯一权威；ServiceFactory 仅作桥接或 fail-fast |
| **v1.1 上下文** | NetonContext.current() 仅表示 app-scope；请求级只用 HttpContext |
| **v1.1 配置** | TOML only；application.conf + 模块独立 <module>.conf；优先级与合并见配置章节 |
| 配置扩展 | 业务配置通过 NetonConfigurer + @NetonConfig 扩展 |

---

*文档版本：v1 + v1.1 冻结约束*
