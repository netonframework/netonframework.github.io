# Neton Core 规范 v1（当前实现）

> **定位**：neton-core = 应用启动、运行时上下文、组件装配、HTTP 抽象、路由与安全接口的「事实规范」。描述 **Neton Core + Runtime + DI** 的真实实现：流程、规则与接口定义。
>
> **状态**：**v1 现状冻结**；**v1.1 冻结约束**已纳入第四、五节（Runtime/DI 与 Config 的语义与优先级）。实现可分期落地，但不得与 v1.1 约束冲突。

---

## 一、概述与分层

### 1.1 职责边界

| 层级 | 职责 | 归属 |
|------|------|------|
| 应用入口 | `Neton.run(args) { }`、`LaunchBuilder`、启动顺序 | neton-core |
| 组件模型 | `NetonComponent&lt;C&gt;`、install、init/start | neton-core |
| 运行时容器 | `NetonContext`（bind/get）、`ServiceFactory`（全局 lookup） | neton-core |
| 配置 | `ConfigLoader`、`NetonConfigRegistry`、`NetonConfigurer` | neton-core |
| HTTP 抽象 | `HttpAdapter`、`HttpContext`、`HttpRequest`、`HttpResponse`、参数与类型 | neton-core |
| 路由与处理 | `RequestEngine`、`RouteDefinition`、`RouteHandler`、`ParameterBinding` | neton-core |
| 安全接口 | `SecurityBuilder`、`Principal`、`Authenticator`、`Guard`、`AuthenticationContext` | neton-core |
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
│   └── SecurityInterfaces.kt # Principal、Authenticator、Guard、RequestContext、SecurityFactory
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

## 二、启动流程

### 2.1 推荐入口

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

### 2.2 startSync 流程（install 路径）

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

### 2.3 端口与配置

- 端口由各 HTTP 组件在 `defaultConfig()` / `block(config)` 中设置（如 `HttpConfig.port`），Adapter 内部持有；Core 不解析 `--port`（可由上层在创建 ctx 前解析并传入 config）。
- 应用主配置：`ConfigLoader.loadApplicationConfig(configPath, environment)`、`ConfigLoader.loadComponentConfig(componentName)` 等，按约定路径加载 TOML；端口优先级为：命令行 > application.conf > 默认 8080。详见 [config-spi](./config-spi.md)。

---

## 三、组件模型（NetonComponent）

### 3.1 接口定义

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

### 3.2 安装方式

```kotlin
fun <C : Any> LaunchBuilder.install(component: NetonComponent<C>, block: C.() -> Unit)
```

- 将 `(component, block)` 存入 `installs`，在 `startSyncWithInstalls` 中按顺序执行 defaultConfig → block → init，再统一 start。

### 3.3 规则

- 组件**无内部可变状态**；所有运行时状态通过 `ctx.bind` 暴露，由 Core 或其它组件通过 `ctx.get` / `ServiceFactory` 使用。
- 先 install 的组件先 init；若某组件依赖另一组件，被依赖者需先 install。

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

### 4.2 ServiceFactory

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
- **过渡期**：Controller 等可通过 `ServiceFactory.getService(X::class)` 或 NetonContext.current().get(X::class) 获取服务；推荐在 `Neton.run { }` / `onStart` 作用域内使用 `get&lt;T&gt;()` 或 `inject&lt;T&gt;()`。

### 4.3 注入扩展（InjectExtensions）

```kotlin
inline fun <reified T : Any> inject(): Lazy<T> = lazy { NetonContext.current().get(T::class) }
inline fun <reified T : Any> get(): T = NetonContext.current().get(T::class)
```

- 仅在 `NetonContext.setCurrent(ctx)` 生效的作用域内可用（如 onStart 块、或由 HttpAdapter 在请求处理前设置的上下文）。

### 4.4 v1.1 冻结约束（Runtime/DI）

以下为 v1.1 必须遵守的语义冻结，避免在面向可扩展服务集群时形成结构性债务。

| 约束 | 说明 |
|------|------|
| **唯一权威容器** | **NetonContext** 是实例的唯一权威来源。ServiceFactory 仅作为「桥接层」：在 install 路径中由 `ctx.syncToServiceFactory()` 单向同步后，供 KSP 生成代码等无法直接持有 ctx 的调用方只读使用。禁止在业务代码或组件中向 ServiceFactory 直接 register，导致与 ctx 分叉。 |
| **ServiceFactory 定位** | 要么**只读桥接**（仅从 ctx 同步后的 view，不再接受独立 register），要么在**非测试环境**对 HttpAdapter / RequestEngine / SecurityBuilder / SecurityFactory 做 **fail-fast**：未安装则抛异常，不再 silent Mock 回退。Mock 仅允许在显式 test 或 dev mode 下使用。 |
| **current() 语义** | **NetonContext.current()** 仅表示 **application-scope**（进程级、单例 ctx）。禁止在并发请求中通过 setCurrent 切换请求级上下文；否则多请求/协程下会出现 A 的 lazy inject 读到 B 的绑定。请求级数据**必须**通过 **HttpContext**（attributes、request/response）或 **CurrentLogContext**（logging）传递，不得用「切 current ctx」传递请求上下文。 |
| **inject() / get() 使用范围** | 仅在「应用启动期」且 setCurrent(ctx) 已生效的**单线程/顺序**作用域内使用（如 onStart 块、LaunchBuilder 内部）。请求 handler 内若需访问应用级服务，应通过 **HttpContext.getApplicationContext()?.get\<T\>()** 或由适配器注入的 ctx 引用，不得依赖 NetonContext.current()。 |
| **生命周期收口** | 组件的 **stop(ctx)** 必须在框架层收口：startSyncWithInstalls 的 **try** 块（含 startHttpServerSync）后的 **finally** 中，先 `setCurrent(null)`，再按 install **逆序**对所有 component 调用 `stop(ctx)`；单组件 stop 抛异常时打 warn 并继续其余组件，不中断收口。实现见下「stop 收口实现方案」。 |
| **DI 路线** | 当前为 **Service Locator**（手动 install + ctx.get / ServiceFactory.getService），不是构造注入。若后续做「构造注入 Controller/Service」，**Native-first 路线**必须采用 **KSP 生成 Provider/Factory**，禁止依赖 kotlin-reflect 运行时构造 resolve。 |

**stop 收口实现方案（最小侵入）**

- **位置**：`startSyncWithInstalls` 内，现有 `try { ... startHttpServerSync(...) } finally { setCurrent(null) }` 的 **finally** 中。
- **顺序**：先执行 `NetonContext.setCurrent(null)`（保持当前语义），再按 **installs 逆序** 对每个 component 调用 `(component as NetonComponent&lt;Any&gt;).stop(ctx)`。
- **异常**：单个 component.stop(ctx) 若抛异常，用 log?.warn("neton.component.stop.failed", mapOf("component" to component::class.simpleName, "message" to (e.message ?: ""))) 记录后 **continue**，不中断后续组件的 stop，避免一个组件清理失败导致其他资源无法释放。
- **HttpAdapter**：不在 Core 中单独调用 httpAdapter.stop()；由 **HttpComponent**（或各 HTTP 实现）在自身的 `stop(ctx)` 中从 ctx 取 HttpAdapter 并调用 stop()，保持「资源释放归组件」的边界。
- **协程**：stop(ctx) 为 suspend，startSyncWithInstalls 已为 suspend，在 runBlocking 内执行，故无需额外 launch。

---

## 五、配置

### 5.1 格式与文件体系（v1.1 冻结）

**职责声明**：Neton 只负责读取 TOML 配置。任何 YAML/JSON/INI/ENV-ONLY 的风格，属于外部转换或部署模板范畴，不进入 Neton v1/v2 范围。

| 约束 | 说明 |
|------|------|
| **唯一格式** | v1.1 只支持 **TOML**。ConfigLoader 只提供 TOML 解析器；不提供 YAML/JSON/HOCON。其它格式通过部署/CI 工具转成 TOML 后由框架读取。 |
| **配置目录** | `--config-path` 指定（默认 `./config`）。框架只在该目录下查找约定文件名，不扫描其它文件。 |
| **主配置** | **application.conf**（内容 TOML）：仅放 core/runtime/http/logging/trace/metrics 等全局配置。 |
| **模块独立文件** | 每个模块一个文件：**&lt;module&gt;.conf**（TOML）。约定：`application.conf`、`database.conf`、`redis.conf`、`cache.conf`、`security.conf`、`routing.conf` 等。模块自治、边界清晰。 |
| **环境覆盖** | 每个模块均支持环境覆盖：**&lt;module&gt;.&lt;env&gt;.conf**（如 `database.prod.conf`、`redis.dev.conf`）。 |
| **模块名来源** | 由各 Component/模块提供常量 **moduleName**（如 `HttpComponent.moduleName = "application"`、`DatabaseComponent.moduleName = "database"`）。ConfigLoader **只认 moduleName**，不做 className→fileName 的魔法推断，避免重构破坏配置文件名。 |
| **v1 禁止** | 不支持 **include / import / ${var}** 等跨文件引用与变量插值。需复用则由外部工具（helm/kustomize/ansible/consul-template）生成最终 conf。 |

**点分路径与 TOML 对应**（冻结映射）：

- `server.port` → `[server]` 下 `port = 8080`
- `logging.level` → `[logging]` 下 `level = "INFO"`
- `redis.host` → `[redis]` 下 `host = "127.0.0.1"`
- 数组/表数组：按 TOML `[[section]]` 语义；路径访问仅走 table 层级，**不支持表达式与 selector**。

**ConfigLoader 职责**：按 configPath + 文件名加载、环境选择、与 CLI/ENV 叠加、深度合并、点分路径取值；不负责模块语义（如 database 的 pool 解析由 neton-database 自行解析 ConfigLoader 返回的 Map）。

### 5.1.2 ConfigLoader 接口与发现规则

- **loadModuleConfig(moduleName, configPath, env)**：加载 `&lt;module&gt;.conf` 与可选 `&lt;module&gt;.&lt;env&gt;.conf`，合并后返回 `Map&lt;String, Any?&gt;`。组件在 `init(ctx, config)` 时用模块名调用，再解析成自身强类型 Config。
- **readCliOverrides(args)** / **readEnvOverrides()**：建议提供，用于与文件合并时的优先级顶层（CLI/ENV 覆盖文件内值）。具体 key 命名约定（如 `--server.port`、`NETON_SERVER_PORT`）可单独冻结。
- **getConfigValue(config, path, default)**：点分路径取值，path 仅走 table 层级；类型仅认 TOML 原生（string/int/float/bool/datetime/array/table）。
- 实现必须做真实 I/O + TOML 解析，禁止 when 分支占位；文件不存在时可返回空 Map 或按约定 fallback，解析失败必须报错并包含文件路径与行号等字段。

### 5.2 NetonConfigRegistry 与 NetonConfigurer

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
- 业务层通过 `@NetonConfig("security")` + 实现 `NetonConfigurer&lt;SecurityBuilder&gt;` 参与安全配置；在组件 start 之后、应用 Configurer 时从 registry 取列表并按 order 执行（详见 Neton-Config-SPI-Spec）。

### 5.3 v1.1 配置优先级与合并规则冻结

以下为 v1.1 必须落地的配置语义；实现可分期，但规则一旦写入代码即不可与下列约定冲突。

**总优先级（高→低）**：**命令参数（CLI）** > **环境变量（.env + ENV）** > **env 配置（\*.&lt;env&gt;.conf）** > **默认配置（\*.conf）** > **代码默认值**。

| 规则 | 说明 |
|------|------|
| **1. 命令参数** | `--server.port=8081`、`--env=prod` 等，最高优先级。 |
| **2. 环境变量** | `.env` 文件及进程 ENV（如 `NETON_SERVER__PORT=8081`，规则见 5.4）。 |
| **3. env 配置** | `&lt;module&gt;.&lt;env&gt;.conf`（如 `application.prod.conf`），覆盖同模块 base。 |
| **4. 默认配置** | `&lt;module&gt;.conf`（如 `application.conf`），基础层。 |
| **5. 代码默认值** | 最低。 |
| **合并规则** | **table**：深度合并（同 key 环境覆盖基础，未出现 key 保留）。**数组/列表**：整体覆盖，不逐项 merge。 |
| **路径命名空间** | 点分路径**第一段固定为模块名**：`server.port` 属 application.conf、`database.url` 属 database.conf、`redis.endpoint` 属 redis.conf。禁止跨模块用裸 `"url"` 等弱路径；读配置 API 需体现模块作用域。 |
| **读配置 API** | 建议：`ctx.config("database").getString("url")` 或 `registry.module("database").getString("url")`；类型化 getInt/getString/getBoolean 仅支持标量 + 嵌套 table，v1 不要求完整 Bean 绑定。 |
| **真实加载** | 必须做真实 I/O + **TOML** 解析，禁止 when 占位。解析失败与 unknown/type 策略见 5.4。 |
| **文件名** | 主配置：`application.conf` / `application.&lt;env&gt;.conf`。模块：`&lt;module&gt;.conf` / `&lt;module&gt;.&lt;env&gt;.conf`。仅在此两类文件名下查找，不扫其它文件。 |

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

### 5.3.5 Environment 解析规则（冻结）

**env** 用于选择加载 `&lt;module&gt;.&lt;env&gt;.conf`（如 `application.dev.conf`、`database.prod.conf`）。由 `ConfigLoader.resolveEnvironment(args)` 统一解析。

**优先级**：**命令参数 > 环境变量**。

| 优先级 | 来源 | 示例 |
|--------|------|------|
| 1 | CLI | `--env=prod` |
| 2 | ENV | `NETON_ENV=prod`、`ENV=prod`、`NODE_ENV=production` |
| 3 | 默认 | `"dev"` |

- 启动时解析一次，传入 `loadApplicationConfig(configPath, env, args)` 与 `loadModuleConfig(..., environment = env, ...)`。
- Banner 中的 `Environment` 字段显示该解析结果。

### 5.4 v1.1 ENV/CLI 命名与解析策略冻结

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

---

## 六、HTTP 抽象层

### 6.1 HttpAdapter

```kotlin
interface HttpAdapter {
    suspend fun start(ctx: NetonContext)
    suspend fun stop()
    fun port(): Int
}
```

- Core 只定义接口；port 与具体配置由实现（HTTP 适配器）在组件 config 中设置。
- 废弃：`runCompat(port, args)` 仅兼容旧路径，会临时构造 ctx 并从 ServiceFactory 填充后调用 `start(ctx)`。

### 6.2 HttpContext / HttpRequest / HttpResponse

- **HttpContext**：`traceId`、`request`、`response`、`session`、`attributes`、`getApplicationContext(): NetonContext?`。
- **HttpRequest**：`method`、`path`、`url`、`version`、`headers`、`queryParams`、`pathParams`、`cookies`、`remoteAddress`、`body()`、`text()`、`json()`、`form()` 等。
- **HttpResponse**：`status`、`headers`、`write(data)`、`text()`、`json()`、`redirect()`、`notFound()`、`unauthorized()` 等。
- **HttpStatus** / **HttpMethod**：枚举；**Headers** / **MutableHeaders**、**Parameters**、**Cookie** / **MutableCookie** 为接口，由适配器实现。

### 6.3 HandlerArgs（参数视图）

```kotlin
interface HandlerArgs {
    fun first(name: String): Any?   // path 优先，否则 query 首个
    fun all(name: String): List<String>?  // 仅 query
    operator fun get(name: String): Any? = first(name)
}
```

- 只读；path 与 query 分离，避免合并大 Map；路由层用 `ArgsView(path, query)` 或 `MapBackedHandlerArgs` 实现。

### 6.4 ParamConverter 与 ParamConverterRegistry

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

## 七、路由与请求处理

### 7.1 RequestEngine

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

### 7.2 RouteDefinition / RouteMatch / RouteHandler

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

### 7.3 ParameterBinding（密封类）

```kotlin
sealed class ParameterBinding {
    abstract val parameterName: String
    abstract val parameterType: KClass<*>
    data class PathVariable(...) : ParameterBinding()
    data class RequestBody(...) : ParameterBinding()
    data class AuthenticationPrincipal(...) : ParameterBinding()
    data class ContextObject(...) : ParameterBinding()
}
```

- 与 KSP/路由层配合，描述控制器方法参数如何从 HttpContext/HandlerArgs 解析。

### 7.4 ParameterResolver（SPI）

```kotlin
interface ParameterResolver {
    fun canResolve(parameterType: String, annotations: List<String>): Boolean
    suspend fun resolve(parameterName: String?, context: HttpContext): Any?
    val priority: Int get() = 100
}
```

- 内置：AuthenticationPrincipalResolver、HttpRequestResolver、HttpResponseResolver、HttpSessionResolver、PathVariableResolver、QueryParamResolver、FormParamResolver、HeaderResolver、CookieResolver、BodyResolver；通过 **ParameterResolverRegistry** 注册与排序，按 priority 选用。

### 7.5 RequestProcessingException

- **RouteNotFoundException**、**ParameterBindingException**、**MethodInvocationException**、**ResponseSerializationException**：供实现层抛出，Core 仅定义类型。

---

## 八、安全接口

### 8.1 SecurityBuilder

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

### 8.2 Principal / Authenticator / Guard / RequestContext

```kotlin
interface Principal {
    val id: String
    val roles: List<String>
    val attributes: Map<String, Any>
    fun hasRole(role: String): Boolean
    fun hasAnyRole(vararg roles: String): Boolean
    fun hasAllRoles(vararg roles: String): Boolean
}

interface Authenticator {
    suspend fun authenticate(context: RequestContext): Principal?
    val name: String
}

interface Guard {
    suspend fun checkPermission(principal: Principal?, context: RequestContext): Boolean
    val name: String
}

interface RequestContext {
    val path: String
    val method: String
    val headers: Map<String, String>
    val routeGroup: String?
}
```

- **RequestContext** 为安全层抽象，可由 HttpContext 适配。

### 8.3 AuthenticationContext / SecurityContext

```kotlin
interface AuthenticationContext {
    fun currentUser(): Any?
}

object SecurityContext {
    fun setPrincipal(principal: Principal?)
    fun currentUser(): Principal?
    fun isAuthenticated(): Boolean
    fun hasRole(role: String): Boolean
    fun hasAnyRole(vararg roles: String): Boolean
    // ...
}
```

- **AuthenticationContext** 由 SecurityBuilder 提供，供 RequestEngine 等获取当前用户。
- **SecurityContext** 为全局 ThreadLocal 风格入口，由安全实现层在请求入口设置 principal。

---

## 九、注解（Core 定义）

### 9.1 控制器与路由

| 注解 | 作用目标 | 说明 |
|------|----------|------|
| @Controller(path) | CLASS | 控制器类，path 为基础路径，默认 "" |
| @Get(value) / @Post / @Put / @Delete / @Patch / @Head / @Options | FUNCTION | HTTP 方法 + 路径片段 |

### 9.2 参数绑定

| 注解 | 说明 |
|------|------|
| @PathVariable(value) | 路径参数，value 为空则用参数名 |
| @Body | 请求体（JSON 等） |
| @QueryParam(value) / @Query(value) | 查询参数 |
| @FormParam(value) | 表单参数 |
| @Header(value) | 请求头 |
| @Cookie(value) | Cookie |
| @AuthenticationPrincipal(required) | 注入当前 Principal，required 默认 true |

### 9.3 安全

| 注解 | 说明 |
|------|------|
| @AllowAnonymous | 允许匿名访问 |
| @RolesAllowed(roles) | 需指定角色 |
| @RequireAuth | 需认证 |
| @AuthenticationPrincipal | 见上 |

---

## 十、KotlinApplication 与编译期

### 10.1 KotlinApplication

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

### 10.2 GeneratedInitializer（KSP）

```kotlin
object GeneratedInitializer {
    fun initialize(ctx: NetonContext?)
}
```

- 无控制器时仅打提示；KSP 在有 @Controller 时生成注册路由等逻辑，在 **initializeInfrastructure** 中被调用。

---

## 十一、日志（Core 内）

- **CoreLog**：`log: Logger?` 在 startSync 中从 `ctx.getOrNull(LoggerFactory::class)` 设置；早于 ctx 的路径用 **logOrBootstrap()** / **ensureBootstrap()** 使用进程级 Logger（defaultLoggerFactory().get("neton.core")）。
- **defaultLoggerFactory()**：expect/actual，common 为 expect，各平台提供实际 LoggerFactory。

---

## 十二、规则小结

| 规则 | 说明 |
|------|------|
| 唯一入口 | 应用通过 `Neton.run(args) { install(...); onStart { } }` 启动，禁止绕过 LaunchBuilder 的 install 路径 |
| 组件无状态 | Component 不持有可变状态，全部通过 ctx 暴露 |
| 接口在 Core | HttpAdapter、RequestEngine、SecurityBuilder、SecurityFactory 等均在 core 定义，实现由各模块提供 |
| **v1.1 容器** | ctx 为唯一权威；ServiceFactory 仅作桥接或 fail-fast，禁止 silent Mock 生产环境（见 4.4） |
| **v1.1 上下文** | NetonContext.current() 仅表示 app-scope；请求级只用 HttpContext / CurrentLogContext（见 4.4） |
| **v1.1 配置** | TOML only；application.conf + 模块独立 &lt;module&gt;.conf；优先级与合并见 5.3；路径命名空间 + 模块 API（见 5.1/5.3） |
| 配置扩展 | 业务配置通过 NetonConfigurer + @NetonConfig 扩展；ConfigLoader 仅负责加载与合并 |

---

*文档版本：v1（现状）+ v1.1（冻结约束已纳入）*
