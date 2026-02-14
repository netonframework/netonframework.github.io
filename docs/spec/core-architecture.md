# Neton Core 架构文档

> 极简设计原则：易用、性能、灵活。基于 Kotlin 2.3.x + KMP。

---

## 一、当前架构概览

### 1.1 整体分层

```
┌─────────────────────────────────────────────────────────────────┐
│  应用层（main）                                                    │
│  Neton.run(args) { http { }; routing { }; redis { }; onStart { } } │
└──────────────────────────────┬──────────────────────────────────┘
                               │ LaunchBuilder.install(component, block)
┌──────────────────────────────▼──────────────────────────────────┐
│  组件层（NetonComponent）                                          │
│  HttpComponent / RoutingComponent / SecurityComponent / RedisComponent │
│  createConfig() → block(config) → onInit(ctx, config) → onStart()  │
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

### 1.2 核心模块结构

| 包 | 职责 |
|----|------|
| `Neton.kt` | 入口：`run(args) { }` / `LaunchBuilder`，启动流程、协程包装（runBlocking）、ServerTask 等 |
| `component/` | `NetonComponent&lt;C&gt;` 接口、`NetonContext`（KClass→Any 容器）、`HttpConfig` |
| `config/` | `ConfigLoader`（约定式 TOML 加载）、`NetonConfig` / `NetonConfigurer`（KSP 配置器 SPI） |
| `factory/` | `ServiceFactory`（全局服务 lookup，含 Mock 回退）、`ComponentRegistry` |
| `http/` | `HttpContext` / `HttpRequest` / `HttpResponse` / `ParameterResolver`，`HttpAdapter` 接口 |
| `interfaces/` | `RequestEngine`、`SecurityBuilder`、`RouteDefinition`、`ParameterBinding` |
| `security/` | `AuthenticationContext`、`SecurityContext` |
| `annotations/` | `@Controller`、`@Get`、`@Post`、`@PathVariable`、`@AllowAnonymous` 等 |
| `neton/core/generated/` | KSP 生成 `GeneratedInitializer`，注册路由等 |

### 1.3 启动流程（install DSL）

1. `LaunchBuilder.block()` 执行用户 DSL
2. `startSync(args)`：创建 `NetonContext`，遍历 install 列表
3. 对每个组件：`createConfig()` → `block(config)` → `onInit(ctx, config)` → `onStart(ctx, config)`
4. `ctx.syncToServiceFactory()`：将 ctx 中的绑定同步到 ServiceFactory
5. `initializeInfrastructure(ctx)`：调用 `GeneratedInitializer.initialize(ctx)`
6. 构建 Security、配置 RequestEngine、执行 onStart
7. `startHttpServerSync`：`HttpAdapter.configureRouting(requestEngine)`，`runBlocking { httpAdapter.run(port, args) }`

---

## 二、极简设计评估

### 2.1 易用 ✅

| 方面 | 现状 | 说明 |
|------|------|------|
| 启动 DSL | `Neton.run(args) { http { }; routing { }; onStart { } }` | 上手成本低 |
| 组件安装 | `install(Component) { config }`，各模块提供 `http { }`、`redis { }` 等语法糖 | 按需组合，无强制依赖 |
| 服务获取 | `ServiceFactory.getService(RedisClient::class)` | 简单 lookup，无复杂 DI |
| 配置 | `ConfigLoader.loadComponentConfig("RedisComponent")` + `config/redis.conf` | 约定优于配置，DSL 可覆盖 |

**不足**：`Neton.kt` 内 ServerTask / HttpServerWrapper 等启动路径较绕，协程封装层级多，新人阅读成本高。

### 2.2 性能 ⚠️

| 方面 | 现状 | 说明 |
|------|------|------|
| 服务注册 | `NetonContext` + `ServiceFactory` 均为 `MutableMap<KClass<*>, Any>` | O(1)  lookup，无反射 |
| 路由注册 | KSP 生成 `GeneratedInitializer`，编译期注册 | 无运行时扫描，启动快 |
| 协程 | `runBlocking` 启动 HTTP 服务器 | 主线程阻塞，主线程阻塞 |
| ConfigLoader | 按约定路径加载 TOML | 见 [config-spi](./config-spi.md) |

**不足**：NetonContext 与 ServiceFactory 双重存储，存在冗余。

### 2.3 灵活 ✅

| 方面 | 现状 | 说明 |
|------|------|------|
| 接口与实现分离 | `HttpAdapter`、`RequestEngine`、`SecurityBuilder` 等均在 core 定义 | 可替换实现，Mock 回退 |
| 组件化 | `NetonComponent&lt;C&gt;` 统一生命周期 | 新组件仅需实现接口 + install DSL |
| 配置器 SPI | `NetonConfigurer&lt;T&gt;` + `@NetonConfig(component)`，KSP 生成 registry | 业务层可参与配置，无侵入 core |
| Mock 支持 | `MockHttpAdapter`、`MockRequestEngine` 等 | 无 HTTP 模块时仍可运行，便于测试 |

**不足**：Mock 与真实实现切换依赖 ServiceFactory 注册顺序，无显式「测试模式」开关。

---

## 三、Kotlin 2.3.x 与版本策略

### 3.1 当前版本（libs.versions.toml）

- Kotlin: 2.3.10
- KSP: 2.3.5
- kotlinx-coroutines: 1.10.2
- kotlinx-serialization: 1.10.0

### 3.2 基于 Kotlin 2.3.0 的可优化点

| 特性 | 说明 | 对 neton-core 的建议 |
|------|------|----------------------|
| Data-flow exhaustiveness | `when` 穷尽性检查增强 | 已稳定，无需额外配置 |
| Nested type aliases | 嵌套类型别名 | 可用于简化 `ParameterBinding` 等类型定义 |
| `kotlin.time.Clock` / `Instant` | 标准库时间 API 稳定 | 可替代部分自定义时间工具 |
| `Uuid.parseOrNull()` 等 | UUID 解析增强 | 若涉及 ID 生成，可考虑使用 |
| Kotlin/Native 构建加速 | release 构建提速约 40% | 保持 2.3.x，享受构建优化 |
| Apple 目标最低版本 | iOS 14.0、watchOS 7.0 | 若需兼容更低版本，需 `-Xoverride-konan-properties` |
| x86_64 Apple 弃用 | macosX64 等降为 tier 3 | 建议以 macosArm64 为主，x64 仅兼容 |

### 3.3 低版本兼容策略

若需支持 Kotlin 2.0–2.2：

- 避免使用 Kotlin 2.3 新增的实验特性（如 explicit backing fields、unused return value checker）
- `NetonConfigurer`、`ParameterBinding` 等密封类/接口保持 2.0 兼容写法
- KSP 生成代码保持通用，不依赖 2.3 专属 API
- 依赖版本：kotlinx-coroutines、kotlinx-serialization 选兼容 2.0 的版本

若仅面向 Kotlin 2.3+：

- 可启用 `-Xreturn-value-checker=check` 提高代码质量
- 利用 `kotlin.time` 稳定 API 统一时间处理
- 利用 Gradle 9.0 兼容性简化构建脚本

---

## 四、未来优化点

### 4.1 易用性

| 项目 | 描述 |
|------|------|
| 简化启动链路 | 收敛 `Neton.kt` 内 ServerTask / ServerRunner / HttpServerWrapper 等嵌套类，抽成单一 `startHttpServer(adapter, port)` |
| 统一服务获取 | 提供 `ctx.get&lt;T&gt;()` 扩展，Controller 内可直接注入，减少 `ServiceFactory.getService()` 样板 |
| onStart 传递 ctx | 当前 `onStart` 的 `KotlinApplication` 持有 ctx，可暴露 `getRedis()` 等快捷方法，与 redis 扩展一致 |
| 错误信息优化 | `ctx.get()` 抛异常时，提示「Did you install X?」可列出已安装组件，便于排查 |

### 4.2 性能

| 项目 | 描述 |
|------|------|
| ConfigLoader 真实 I/O | 从 `config/` 目录读取 TOML（.conf），支持环境覆盖（dev/prod），见 [config-spi](./config-spi.md) |
| 合并 NetonContext 与 ServiceFactory | 考虑以 ctx 为唯一容器，ServiceFactory 仅做转发，避免双重存储 |
| 懒加载组件 | 对非必须组件（如 Security）支持懒加载，减少冷启动开销 |
| 路由匹配优化 | 若路由数量大，可引入 trie 或 radix tree，替代线性匹配 |

### 4.3 灵活性

| 项目 | 描述 |
|------|------|
| 测试模式 | 提供 `Neton.testMode { }` 或环境变量，自动注册 Mock 实现，便于单元测试 |
| 生命周期扩展 | 增加 `onBeforeInit`、`onAfterStart` 等钩子，满足插件、指标等需求 |
| 多环境配置 | `ConfigLoader` 支持 `application.dev.conf`、`application.prod.conf` 覆盖 |
| 可观测性 | 预留 `MetricsCollector`、`TracingContext` 等接口，便于对接指标与追踪系统 |

### 4.4 代码质量与维护

| 项目 | 描述 |
|------|------|
| 移除废弃 API | `ComponentRegistrar.registerComponents` 等已 `@Deprecated(ERROR)`，可彻底删除 |
| 收敛 println | 引入轻量 `Logger` 接口，支持 log level，避免直接 println |
| 文档同步 | README、Core模块设计.md 与当前 install DSL 对齐，移除 Kerisy 历史表述 |
| KSP 生成源注册 | 利用 Kotlin 2.3 Gradle API 注册 generated sources，改善 IDE 体验 |

---

## 五、总结

neton-core 当前架构在**易用**和**灵活**上表现良好：install DSL 直观，组件化清晰，接口与实现分离便于扩展和测试。**性能**方面，服务 lookup、路由注册已较优，主要短板在 NetonContext/ServiceFactory 冗余。

基于 Kotlin 2.3.x，建议保持当前版本线，利用 Native 构建加速和标准库时间 API；若需兼容更低 Kotlin 版本，则避免 2.3 专属特性。未来优化可优先：简化启动链路、ConfigLoader 真实 I/O、合并服务容器、测试模式支持，并在适当时机引入轻量日志与可观测性接口。
