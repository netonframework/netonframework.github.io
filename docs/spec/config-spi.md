# Neton Config SPI 设计规范 v1.0

> **状态**: Kernel Stable (v2.1)  
> **目标读者**: 框架维护者、组件开发者、生态贡献者

---

## 1. 概述

Neton Config SPI 是业务层参与框架配置的**唯一标准扩展点**。通过 `@NetonConfig` 注解 + KSP 编译期发现，实现**零反射、零运行时扫描**的声明式配置。

### 1.1 设计原则

- **SSOT**: 注解为唯一元数据来源
- **零反射**: 编译期 KSP 生成，Native 友好
- **分层解耦**: DSL / Component / Config SPI 职责清晰，禁止跨层

---

## 2. 分层架构

| 层级 | 标准术语 | 职责 | 示例 |
|------|----------|------|------|
| **Install Layer** | DSL 层 | 声明安装哪些组件、传递基础参数 | `security { }`、`http { port = 8080 }` |
| **Runtime Service Layer** | Component 层 | 提供能力、绑定到 ctx | `SecurityComponent`、`HttpComponent` |
| **Extension Layer** | Config SPI 层 | 业务逻辑的声明式配置 | `@NetonConfig("security") class AppSecurityConfig` |
| **Compile-time Discovery** | KSP 层 | 扫描注解、生成 Registry | `GeneratedNetonConfigRegistry` |
| **Lifecycle Hook** | Runtime Apply | 应用 Configurer 到目标 | `configurers.sortedBy { it.order }.forEach { it.configure(ctx, target) }` |

### 2.1 分层原则（必须遵守）

| 原则 | 说明 |
|------|------|
| **DSL 只负责安装** | 端口、开关、中间件等基础设施参数；**禁止**写业务逻辑 |
| **Component 只提供服务** | 暴露 Builder / Manager 到 ctx；**禁止**承载业务状态 |
| **Config SPI 只做业务扩展** | 认证规则、权限逻辑、拦截器；**禁止**在 DSL 里写 |
| **禁止跨层** | 不得在 DSL block 中调用 `ctx.get()` 写业务；不得在 Configurer 中 install 组件 |

---

## 3. 生命周期模型

```
Neton.run {
    configRegistry(GeneratedNetonConfigRegistry())  // 可选，不传则用 EmptyNetonConfigRegistry
    security { }                                    // DSL block
}
```

### 3.1 执行顺序

```
1. ctx.bind(NetonConfigRegistry)
2. for each component in installs:
   a. config = component.createConfig()
   b. block(config)           ← DSL 对 config 的配置
   c. component.onInit(ctx, config)
   d. component.onStart(ctx, config)   ← 在此应用 Configurers
```

### 3.2 onStart 中的 Configurer 应用

```kotlin
ctx.getOrNull(NetonConfigRegistry::class)?.securityConfigurers
    ?.sortedBy { it.order }
    ?.forEach { it.configure(ctx, config) }
```

---

## 4. 何时使用 Configurer

| 场景 | 使用方式 | 示例 |
|------|----------|------|
| **业务逻辑** | Configurer | 注册 mock 认证、JWT、角色守卫 |
| **基础设施** | DSL | 端口、host、开关 |
| **需要 ctx** | Configurer | 依赖 Redis、其他 Service |
| **需要顺序** | Configurer + order | DataSourceConfig → SecurityConfig |

**判断标准**：若逻辑与具体业务相关（认证、权限、数据源、消息队列配置），一律用 Configurer；若为框架级开关或连接参数，用 DSL。

---

## 5. 核心 API

### 5.1 NetonConfigurer

```kotlin
interface NetonConfigurer<T : Any> {
    val order: Int get() = 0
    fun configure(ctx: NetonContext, target: T)
}
```

- `order`: 执行顺序，小值先执行；由 `@NetonConfig(order = X)` 注入，**用户不得手写 override**
- `configure`: 接收 `ctx`（可访问其他 Service）和 `target`（组件 Builder）

### 5.2 @NetonConfig

```kotlin
@Target(AnnotationTarget.CLASS)
annotation class NetonConfig(
    val component: String,   // "security" | "routing" | ...
    val order: Int = 0
)
```

- `component`: 目标组件 key，与 `NetonComponent.key` 对应
- `order`: 唯一 order 来源，KSP 通过 `NetonConfigurers.ordered(order, configurer)` 注入

### 5.3 NetonConfigRegistry

```kotlin
interface NetonConfigRegistry {
    val securityConfigurers: List<NetonConfigurer<SecurityBuilder>>
}
```

由 KSP 生成 `GeneratedNetonConfigRegistry` 实现；应用入口调用 `configRegistry(GeneratedNetonConfigRegistry())` 传入。

### 5.4 类型别名

```kotlin
typealias SecurityConfigurer = NetonConfigurer<SecurityBuilder>
```

业务层推荐使用 `SecurityConfigurer` 等语义化别名。

---

## 6. 组件开发模板

新增 Neton 组件并支持 Config SPI 的 5 步：

### Step 1: 定义 Builder 接口（neton-core 或组件模块）

```kotlin
interface XxxBuilder {
    fun registerSomething(...)
    fun build(): XxxConfiguration
}
```

### Step 2: 定义 Component

```kotlin
object XxxComponent : NetonComponent<XxxBuilder> {
    override val key = "xxx"
    override fun createConfig() = RealXxxBuilder()
    override fun onInit(ctx, config) {
        ctx.bind(XxxBuilder::class, config)
    }
    override fun onStart(ctx, config) {
        ctx.getOrNull(NetonConfigRegistry::class)?.xxxConfigurers
            ?.sortedBy { it.order }
            ?.forEach { it.configure(ctx, config) }
    }
}
```

### Step 3: 扩展 NetonConfigRegistry

```kotlin
interface NetonConfigRegistry {
    val securityConfigurers: List<NetonConfigurer<SecurityBuilder>>
    val xxxConfigurers: List<NetonConfigurer<XxxBuilder>>  // 新增
}
```

### Step 4: 扩展 NetonConfigProcessor

在 KSP Processor 中为 `"xxx"` component 生成 `xxxConfigurers` 列表。

### Step 5: 提供 DSL 与 typealias

```kotlin
fun Neton.LaunchBuilder.xxx(block: XxxBuilder.() -> Unit) = install(XxxComponent, block)
typealias XxxConfigurer = NetonConfigurer<XxxBuilder>
```

---

## 7. 明确「不做什么」

| 禁止项 | 原因 |
|--------|------|
| **运行期 classpath 扫描** | 破坏 Native、启动慢、不可预测 |
| **反射注册** | Native 不友好、类型不安全 |
| **业务逻辑写在 DSL** | 导致 DSL 膨胀、不可测试、不可模块化 |
| **Configurer 中手写 override val order** | order 仅来自注解，避免双来源 |
| **在 DSL 中 install 业务模块** | install 只做基础设施，业务用 Configurer |

---

## 8. 对标关系

| 框架 | 等价机制 |
|------|----------|
| 传统框架 | `@Configuration` + `BeanPostProcessor` |
| 其他框架 | `ApplicationPlugin` install block |
| Micronaut | `BeanDefinitionVisitor` |
| Quarkus | Build Step + Recorder |

---

## 9. 版本与演进

- **v2.1** (Kernel Stable): 当前形态，可长期冻结
- **未来 v3**: Typed Key `@NetonConfig(SecurityComponent::class)`（类型安全增强）
- **未来**: AutoInstall 作为 opt-in 语法糖，不默认开启
