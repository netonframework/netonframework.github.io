# Neton Core SPI 设计最佳实践指南（官方规范版）

> 本规范作为 Neton 框架贡献者与扩展开发者的官方约束文档，确保架构长期稳定、可维护。

---

## 一、适用范围

- **Core 模块**：neton-core 维护者
- **Component 作者**：neton-http、neton-redis、neton-database、neton-security 等
- **业务开发者**：使用 Neton 构建应用的团队

---

## 二、分层法则（铁律）

| Layer | 允许 | 禁止 |
|-------|------|------|
| **Core** | 仅定义 interface（HttpAdapter、RequestEngine、RedisClient 等） | port、defaultPort、HttpConfig、RedisConfig 等具体配置 |
| **Component** | Config data class、实现类、ctx.bind | 暴露 HTTP/Redis/DB 等语义给 Core |
| **Adapter** | HTTP 适配器、Redis 驱动、sqlx4k 等底层实现 | — |

**原则**：抽象可上移，配置不能上移。

---

## 三、Component 写法规范

### 3.1 接口形态

```kotlin
interface NetonComponent<C : Any> {
    fun defaultConfig(): C
    suspend fun init(ctx: NetonContext, config: C)
    suspend fun start(ctx: NetonContext) {}   // 可选，如 redis warmup
    suspend fun stop(ctx: NetonContext) {}    // 可选，如 graceful shutdown
}
```

### 3.2 标准模板

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

### 3.3 禁止事项

- ❌ 在 Component 内使用 `ctx.config&lt;T&gt;()`（config 由 install 时 merge，init 只接收 final config）
- ❌ 定义 `component.key`（用 `component::class` 标识）
- ❌ 在 init 内做耗时 I/O（应放在 `start`）
- ❌ 在 Component 内持有 mutable 全局状态（状态必须存 ctx）

---

## 四、Context（ctx）使用规范

### 4.1 API

```kotlin
// 绑定
ctx.bind(type, impl)
ctx.bind(impl)
ctx.bindIfAbsent(type, impl)   // 推荐：避免覆盖导致隐蔽 bug

// 获取
ctx.get<T>()                   // 必须存在，否则抛异常
ctx.getOrNull<T>()             // 安全获取
```

### 4.2 实现建议（生产级）

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

### 4.3 禁止事项

- ❌ 在 Core 定义 `ctx.port()`、`ctx.httpConfig()` 等业务语义
- ❌ 使用 `mutableMapOf`（应 `ConcurrentHashMap`）
- ❌ 在 ctx 外缓存 `ctx.get&lt;T&gt;()` 结果并跨请求复用（除单例服务外）

---

## 五、Adapter 规范

### 5.1 职责

- Adapter 实现 Core 定义的 interface
- Adapter 持有 Config（port、host 等），Core 不持有
- Adapter 通过构造函数或工厂接收 config

### 5.2 HttpAdapter 标准形态

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

### 5.3 禁止事项

- ❌ 在 Adapter 内依赖 `NetonContext.current()` 做核心逻辑（应通过参数传入 ctx）
- ❌ 在 Adapter 内硬编码配置默认值（应从 Config 读取）

---

## 六、生命周期规范

### 6.1 启动顺序

```
Neton.run { ... }
  → install 时：merge config（file + default + block）
  → 1. initComponents：forEach { component.init(ctx, config) }
  → 2. startComponents：forEach { component.start(ctx) }   // 可选
  → 3. http.start(ctx)
  → 4. onStart?.invoke(ctx)
```

### 6.2 关闭顺序（推荐）

```
收到 SIGTERM / Ctrl+C
  → http.stop()
  → stopComponents：forEach { component.stop(ctx) }   // 逆序
  → NetonContext.setCurrent(null)
```

### 6.3 阶段语义

| 阶段 | 职责 |
|------|------|
| init | 创建对象、ctx.bind，不做耗时 I/O |
| start | warmup、健康检查、migration、metrics 注册 |
| stop | 关闭连接、释放资源 |

---

## 七、Config 规范

### 7.1 Merge 优先级

1. `component.defaultConfig()`（代码默认）
2. `config/<module>.conf`（文件，TOML）
3. `config/<module>.<env>.conf`（环境覆盖）
4. `install(Component) { block }`（DSL 覆盖，最高优先级）

### 7.2 组件内

- 组件 **只接收** final config，不在 init 内调用 `ctx.config&lt;T&gt;()`
- Config 必须是 data class，支持 merge（可借助 kotlinx.serialization）

---

## 八、禁止事项汇总

| 类别 | 禁止 |
|------|------|
| Core | defaultPort、ctx.port()、HttpConfigProvider、任何 HTTP/Redis/DB 配置 |
| Component | key、ctx.config()、mutable 全局状态、init 内耗时 I/O |
| Context | mutableMapOf、无 bindIfAbsent 的覆盖式 bind |
| Adapter | 依赖 current() 做核心逻辑、硬编码默认配置 |
| 通用 | 反射、classpath 扫描、动态 BeanFactory、运行期依赖解析 |

---

## 九、生态扩展优先级（建议）

1. redis
2. database
3. security
4. routing
5. openapi
6. cli
7. test kit

---

## 十、版本与兼容

- 本规范随 Neton Core v3 冻结，后续仅做小幅补充，不做结构性变更
- 新增 Component 必须遵循本规范，否则不予合并
