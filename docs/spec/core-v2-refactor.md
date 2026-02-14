# Neton Core v3 极简重构设计（最终冻结版）

> **说明**：本文为设计草稿，非当前规范；含 TODO 伪代码。以 [core](./core.md)、[core-architecture](./core-architecture.md) 为准。  
> 三条铁律：① 唯一容器 ② 启动 ≤ 2 层 ③ Controller 极简  
> 分层法则：**抽象 → Core，配置 → Component，实现 → Adapter**

---

## v3 最终优化点

| 优化 | 说明 |
|------|------|
| 删除 defaultPort / ctx.port() / HttpConfigProvider | Core 不关心 HTTP 语义，port 属于 HttpComponent |
| Component.key | **删除**，用 `component::class` |
| install 时 merge config | file + defaultConfig + block → 组件只接收 final config |
| ctx.get\<T\>() inline reified | `ctx.get&lt;UserRepository&gt;()`，DX ↑ |
| args | `LaunchBuilder(args)` 正确传递 |

---

## 一、Context.kt —— 唯一容器（无 HTTP 污染）

```kotlin
package neton.core

import kotlin.reflect.KClass

/**
 * 唯一容器：启动期 + 运行期共用，无 ServiceFactory。
 * Core 不持有 port/httpConfig/redisConfig 等，仅 bind/get。
 */
class NetonContext(val args: Array<String>) {
    private val registry = mutableMapOf<KClass<*>, Any>()

    fun <T : Any> bind(type: KClass<T>, impl: T) {
        registry[type] = impl
    }

    fun <T : Any> bind(impl: T) {
        @Suppress("UNCHECKED_CAST")
        registry[impl::class as KClass<T>] = impl
    }

    fun <T : Any> get(type: KClass<T>): T {
        return registry[type] as? T
            ?: throw IllegalStateException("No binding for ${type.simpleName}. Did you install the component?")
    }

    /** inline 泛型，DX 优先：ctx.get<UserRepository>() */
    inline fun <reified T : Any> get(): T = get(T::class)

    fun <T : Any> getOrNull(type: KClass<T>): T? = registry[type] as? T

    inline fun <reified T : Any> getOrNull(): T? = getOrNull(T::class)

    companion object {
        @Volatile
        private var _current: NetonContext? = null

        fun current(): NetonContext = _current
            ?: throw IllegalStateException("NetonContext not initialized. Call from Neton.run { } scope.")

        internal fun setCurrent(ctx: NetonContext?) { _current = ctx }
    }
}
```

---

## 二、Component.kt —— 泛型 install，无 key

```kotlin
package neton.core

/**
 * 组件：只保留 init(ctx, config)，无 key。
 * 标识用 component::class。
 */
interface NetonComponent<C : Any> {

    fun defaultConfig(): C

    /** 唯一生命周期：DSL block 先修改 config，再传入 init */
    suspend fun init(ctx: NetonContext, config: C)
}

/** 语法糖：http { port = 8080 }，完整 IDE 类型提示 */
fun Neton.LaunchBuilder.http(block: HttpConfig.() -> Unit = {}) {
    install(HttpComponent, block)
}

fun Neton.LaunchBuilder.redis(block: RedisConfig.() -> Unit = {}) {
    install(RedisComponent, block)
}

fun Neton.LaunchBuilder.database(block: DatabaseConfig.() -> Unit = {}) {
    install(DatabaseComponent, block)
}
```

---

## 三、Neton.kt —— 2 层启动，HttpAdapter 负责 port

```kotlin
package neton.core

import kotlinx.coroutines.runBlocking

object Neton {

    fun run(args: Array<String> = emptyArray(), block: LaunchBuilder.() -> Unit) {
        val builder = LaunchBuilder(args)
        builder.block()

        if (builder.installs.isEmpty()) {
            error("No components installed. Add at least: http()")
        }

        runBlocking {
            NetonContext.setCurrent(builder.ctx)
            try {
                start(builder)
            } finally {
                NetonContext.setCurrent(null)
            }
        }
    }

    private suspend fun start(builder: LaunchBuilder) {
        initComponents(builder)
        startHttp(builder)
    }

    private suspend fun initComponents(builder: LaunchBuilder) {
        for (entry in builder.installs) {
            @Suppress("UNCHECKED_CAST")
            (entry.component as NetonComponent<Any>).init(builder.ctx, entry.config)
        }
    }

    /** Core 不关心 port：HttpAdapter 内部持有 config，start(ctx) 即可 */
    private suspend fun startHttp(builder: LaunchBuilder) {
        val http = builder.ctx.get<HttpAdapter>()
        builder.onStart?.invoke(builder.ctx)
        http.start(builder.ctx)
    }

    class LaunchBuilder(val args: Array<String>) {
        internal val ctx = NetonContext(args = args)
        internal val installs = mutableListOf<InstallEntry<*>>()
        internal var onStart: (suspend (NetonContext) -> Unit)? = null

        /** install 时 merge：file + defaultConfig + block → final config，组件只接收 final */
        inline fun <reified C : Any> install(component: NetonComponent<C>, block: C.() -> Unit = {}) {
            val defaultCfg = component.defaultConfig()
            val fileCfg = Config.loadForComponent(C::class)  // config/<module>.conf（TOML）
            val merged = Config.merge(defaultCfg, fileCfg)
            block(merged)
            installs.add(InstallEntry(component, merged))
        }

        fun onStart(block: suspend NetonContext.() -> Unit) {
            onStart = block
        }
    }

    private data class InstallEntry<C : Any>(
        val component: NetonComponent<C>,
        val config: C
    )
}
```

---

## 四、inject.kt —— 人体工学 + 推荐 ctx 注入

```kotlin
package neton.core

/** 委托：private val repo by inject<UserRepository>()，语法糖保留 */
inline fun <reified T : Any> inject(): Lazy<T> =
    lazy { NetonContext.current().get(T::class) }

/** 函数式：val repo = get<UserRepository>() */
inline fun <reified T : Any> get(): T = NetonContext.current().get(T::class)

/** 扩展：ctx.getRedis() */
fun NetonContext.getRedis(): RedisClient = get(RedisClient::class)
```

**Controller 推荐写法**（更安全，无 lazy/current 隐式依赖）：
```kotlin
// 方式 A：KSP 生成时注入 ctx
@Controller("/api/users")
class UserController(ctx: NetonContext) {
    private val repo = ctx.get<UserRepository>()

    @Get
    suspend fun list() = repo.findAll()
}

// 方式 B：inject 语法糖（依赖 NetonContext.current()，单线程/主线程安全）
@Controller("/api/users")
class UserController {
    private val repo by inject<UserRepository>()

    @Get
    suspend fun list() = repo.findAll()
}
```

---

## 五、Config.kt —— install 时 merge，组件只收 final config

```kotlin
package neton.core.config

/**
 * 约定：config/<module>.conf、config/<module>.<env>.conf（TOML）。
 * 优先级：file 覆盖 default，block 覆盖 file。
 * 在 install 时 merge，组件 init 只接收 final config，不再 ctx.config。
 * 实际加载实现见 [config-spi](./config-spi.md)。
 */
object Config {

    private const val CONFIG_DIR = "config"

    /** install 时调用：从文件加载 TOML，返回可 merge 的 data class 或 null */
    fun <C : Any> loadForComponent(type: KClass<C>): C? {
        val name = componentNameFromType(type)
        val env = System.getenv("NETON_ENV") ?: "dev"
        val defaultMap = loadTomlFile("$CONFIG_DIR/$name.conf") ?: return null
        val envMap = loadTomlFile("$CONFIG_DIR/$name.$env.conf")
        val merged = if (envMap != null) mergeMaps(defaultMap, envMap) else defaultMap
        return deserialize(merged, type)
    }

    /** merge default + file：file 覆盖 default，返回 merged data class */
    fun <C : Any> merge(defaultCfg: C, fileCfg: C?): C {
        if (fileCfg == null) return defaultCfg
        // 实现：递归覆盖，或借助 kotlinx.serialization 的 encode/decode
        TODO("merge two data class instances - file overrides default")
    }

    private fun componentNameFromType(type: KClass<*>): String =
        type.simpleName!!.replace("Config", "").lowercase()

    private fun loadTomlFile(path: String): Map<String, Any>? {
        return try {
            javaClass.getResourceAsStream("/$path")?.use { stream ->
                parseToml(stream.readBytes().decodeToString())
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun parseToml(content: String): Map<String, Any> {
        TODO("Implement TOML parsing - 见 config-spi")
    }

    private fun mergeMaps(base: Map<String, Any>, override: Map<String, Any>): Map<String, Any> {
        val result = base.toMutableMap()
        for ((k, v) in override) {
            result[k] = when {
                v is Map<*, *> && base[k] is Map<*, *> ->
                    mergeMaps(base[k] as Map<String, Any>, v as Map<String, Any>)
                else -> v
            }
        }
        return result
    }

    private fun <T : Any> deserialize(map: Map<String, Any>, type: KClass<T>): T {
        TODO("Map -> data class via kotlinx.serialization")
    }
}
```

**组件只接收 final config，不调用 ctx.config**：
```kotlin
object RedisComponent : NetonComponent<RedisConfig> {
    override fun defaultConfig() = RedisConfig()

    override suspend fun init(ctx: NetonContext, config: RedisConfig) {
        ctx.bind(RedisClient::class, DefaultRedisClient(config))
    }
}
```

---

## 六、迁移对照

| 现状 | v3 终态 |
|------|---------|
| `ctx.syncToServiceFactory()` | 删除 |
| `ServiceFactory.getService()` | `ctx.get&lt;T&gt;()` |
| `defaultPort` / `ctx.port()` / `HttpConfigProvider` | **删除**，port 归 HttpAdapter |
| 启动链 | 2 层：`initComponents` + `http.start(ctx)` |
| Component | `init(ctx, config)` 泛型，无 key |
| install block | **`C.() -> Unit`** 类型安全，install 时 merge config |
| Config | **install 时 merge**，组件不调用 ctx.config |
| args | `LaunchBuilder(args)` |

---

## 七、删除清单

- `ServiceFactory`、`ComponentRegistry`
- `ServerTask`、`ServerRunner`、`HttpServerWrapper`
- `NetonComponent.key`
- `defaultPort`、`ctx.port()`、`HttpConfigProvider`
- `NetonComponent.createConfig()`、`onStart()`
- `ctx.syncToServiceFactory()`
- Mock 自动 fallback

---

## 八、落地顺序（P0）

1. **Context**：删除 defaultPort/port/HttpConfigProvider，增加 `ctx.get&lt;T&gt;()` inline
2. **Component**：泛型 `NetonComponent&lt;C&gt;`，删除 key，`defaultConfig()` + `init(ctx, config)`
3. **Neton.kt**：`startHttp` 改为 `ctx.get&lt;HttpAdapter&gt;().start(ctx)`，install 时 merge config
4. **Config**：`Config.loadForComponent` + `Config.merge`，组件不调用 ctx.config
5. **删除**：ServiceFactory 及所有调用点

---

## 九、Neton Core SPI 最终结构模板

### 9.1 分层法则

| Layer | 职责 | 允许 | 禁止 |
|-------|------|------|------|
| **Core** | 抽象接口（SPI） | HttpAdapter、RequestEngine、SecurityManager、RedisClient 等 interface | port、HttpConfig、RedisConfig、defaultPort |
| **Component** | 基础设施实现 + config | HttpConfig、RedisConfig、实现类 | — |
| **Adapter** | 底层实现 | HTTP 适配器、Redis 驱动、sqlx4k | — |

**规则**：抽象可上移，配置不能上移。

### 9.2 Core 应定义的 SPI 接口（interface only）

```kotlin
// neton-core/src/.../interfaces/HttpAdapter.kt
package neton.core.interfaces

/**
 * HTTP 服务器抽象，Core 只定义接口，不持有 port/config。
 * HttpComponent 负责 config，Adapter 负责实现。
 */
interface HttpAdapter {
    suspend fun start(ctx: NetonContext)
    suspend fun stop()
}

// neton-core/src/.../interfaces/RequestEngine.kt
interface RequestEngine {
    suspend fun processRequest(context: HttpContext): Any?
    fun registerRoute(route: RouteDefinition)
    fun getRoutes(): List<RouteDefinition>
}

// neton-core/src/.../interfaces/SecurityManager.kt（可选，视现有 SecurityBuilder 演进）
interface SecurityManager {
    fun build(): SecurityConfiguration
}

// neton-redis 的 RedisClient 已是接口，放 neton-redis 模块，core 不依赖
// 若需跨模块解耦，可考虑 core 定义 RedisClient interface，redis 实现
```

### 9.3 Component 协调方式（用 ctx 桥接）

```
HttpComponent.init(ctx, config)
  → ctx.bind(HttpAdapter::class, httpAdapterInstance)  // config 含 port

RoutingComponent.init(ctx, config)
  → val http = ctx.get<HttpAdapter>()
  → http.configureRouting(requestEngine)  // 或 RequestEngine 独立 bind，HttpAdapter.start 时从 ctx 取

SecurityComponent.init(ctx, config)
  → val http = ctx.get<HttpAdapter>()
  → http.installSecurity(...)

Neton.kt startHttp:
  → val http = ctx.get<HttpAdapter>()
  → http.start(ctx)   // Adapter 内部已有 config（port 等）
```

### 9.4 HttpAdapter 接口演进建议

当前：
```kotlin
interface HttpAdapter {
    suspend fun run(port: Int, args: Array<String>)
    suspend fun stop()
    fun configureRouting(requestEngine: RequestEngine)
}
```

v3 推荐（port 归 Adapter 内部）：
```kotlin
interface HttpAdapter {
    suspend fun start(ctx: NetonContext)
    suspend fun stop()
}
```

`configureRouting` 可改为：HttpAdapter 实现内部在 start 时从 ctx 取 RequestEngine，或由 RoutingComponent 在 init 时调用 adapter 的扩展方法。保持「Core 不关心 port」即可。
