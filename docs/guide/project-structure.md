# 项目结构

本章介绍 Neton 框架的模块划分、标准目录布局、配置文件约定以及 KSP 代码生成机制。理解这些内容有助于你更好地组织和管理 Neton 项目。

## 模块概览

Neton 采用模块化架构设计，每个模块职责清晰、按需引入。下表列出了所有核心模块：

| 模块名 | 功能描述 | 必需 |
|--------|---------|------|
| `neton-core` | 框架核心：启动流程、组件模型（`NetonComponent`）、运行时容器、配置加载、HTTP 抽象（`HttpContext`、`HttpRequest`、`HttpResponse`）、安全上下文 | 是 |
| `neton-logging` | 结构化日志系统：统一 Logger API、JSON 输出、异步写入、Sink 路由、traceId / spanId 传播、自动脱敏 | 是 |
| `neton-http` | HTTP 服务器适配层：将底层 HTTP 引擎适配到 Neton 的 `HttpAdapter` 接口 | 是 |
| `neton-routing` | 路由引擎：路由解析、路由组、目录约定分组、DSL 路由注册、Controller 扫描与绑定 | 是 |
| `neton-security` | 安全模块：Authenticator（认证器）+ Guard（授权守卫）双层架构，支持 JWT / Session / Mock，注解驱动授权 | 否 |
| `neton-redis` | Redis 客户端抽象：连接管理、基础命令、分布式锁（`@Lock` / `LockManager`） | 否 |
| `neton-cache` | 两级缓存：L1 本地内存 + L2 Redis，支持 `@Cacheable` / `@CachePut` / `@CacheEvict` 注解 | 否 |
| `neton-database` | 数据库操作：Entity + Table 模式、类型安全 Query DSL、Repository 层、sqlx4k 驱动集成 | 否 |
| `neton-ksp` | KSP 编译期代码生成器：处理 `@Controller`、`@NetonConfig`、`@Repository` 等注解，生成路由注册、参数绑定、配置 SPI 代码 | 否（推荐） |
| `neton-validation` | 参数验证：验证注解与编译期验证器生成 | 否 |

::: tip 最小依赖集
一个最简 Neton 应用只需 `neton-core` + `neton-logging` + `neton-http` + `neton-routing` 四个模块即可运行。其余模块按业务需求选择性引入。
:::

## 标准目录布局

Neton 项目遵循 Kotlin Multiplatform 的目录结构，同时增加了框架特有的约定：

```
my-neton-app/
├── build.gradle.kts                  # 构建脚本
├── settings.gradle.kts               # 项目设置
├── config/                           # 配置文件目录
│   ├── application.conf              # 主配置文件（TOML 格式）
│   ├── application.dev.conf          # 开发环境覆盖配置（可选）
│   ├── application.prod.conf         # 生产环境覆盖配置（可选）
│   └── routing.conf                  # 路由组配置（可选）
├── src/
│   ├── commonMain/
│   │   └── kotlin/
│   │       ├── Main.kt               # 应用入口
│   │       ├── controller/           # 控制器目录
│   │       │   ├── HomeController.kt
│   │       │   ├── admin/            # admin 路由组控制器
│   │       │   │   └── AdminController.kt
│   │       │   └── app/              # app 路由组控制器
│   │       │       └── AppController.kt
│   │       ├── config/               # 业务配置类
│   │       │   └── AppSecurityConfig.kt
│   │       ├── model/                # 数据模型
│   │       └── module/               # 业务模块（可选）
│   │           └── payment/
│   │               └── controller/
│   └── macosArm64Main/
│       └── kotlin/                   # 平台特定代码
└── build/
    └── generated/
        └── ksp/                      # KSP 生成的代码（自动）
```

### 控制器目录约定

Neton 的路由组与目录结构存在对应关系：

- `controller/` 下的控制器属于默认路由组
- `controller/admin/` 下的控制器属于 `admin` 路由组（配合 `routing.conf` 中的 mount 配置）
- `controller/app/` 下的控制器属于 `app` 路由组
- `module/<模块名>/controller/` 支持模块化组织

KSP 在编译期会扫描控制器的包路径，自动识别其所属的路由组并生成对应的路由注册代码。

## 配置文件

### application.conf

主配置文件，采用 TOML 格式，放置在 `config/` 目录下。Neton 在启动时自动加载。

```toml
[application]
name = "my-app"
debug = true

[server]
port = 8080
host = "0.0.0.0"

[logging]
level = "INFO"

[logging.async]
enabled = true
queueSize = 8192
flushEveryMs = 200
flushBatchSize = 64
shutdownFlushTimeoutMs = 2000

[[logging.sinks]]
name = "access"
file = "logs/access.log"
levels = "INFO"
route = "http.access"

[[logging.sinks]]
name = "error"
file = "logs/error.log"
levels = "ERROR,WARN"
```

配置优先级（从高到低）：

1. 命令行参数 / 环境变量
2. 环境特定配置 `application.&lt;env&gt;.conf`
3. 主配置文件 `application.conf`
4. 框架默认值

### routing.conf

路由组配置文件，定义路由组名称与挂载前缀：

```toml
[[groups]]
name = "admin"
mount = "/admin"

[[groups]]
name = "app"
mount = "/app"
```

每个路由组通过 `mount` 字段指定 URL 前缀。例如 `admin` 组下的 `/index` 控制器，最终路由路径为 `/admin/index`。

## KSP 代码生成

Neton 通过 KSP（Kotlin Symbol Processing）在编译期完成代码生成，实现零反射、零运行时扫描。

### 工作原理

1. 开发者编写带有注解（如 `@Controller`、`@Get`、`@NetonConfig`）的源代码
2. 编译时 KSP 处理器扫描这些注解
3. 自动生成路由注册、参数绑定、配置 SPI 等代码到 `build/generated/ksp/` 目录
4. 生成的代码与手写代码一起编译为原生二进制

### 生成内容

| 注解 | 生成内容 |
|------|---------|
| `@Controller` + `@Get` / `@Post` 等 | 路由注册代码、参数解析代码、Controller 实例化代码 |
| `@NetonConfig` | 配置 SPI 注册代码（`ConfigRegistryProvider`） |
| `@Repository` | 数据访问层代码 |
| 验证注解 | 编译期验证器代码 |

### 构建配置

要启用 KSP，需要在 `build.gradle.kts` 中添加：

```kotlin
plugins {
    alias(libs.plugins.ksp)
}

dependencies {
    add("kspMacosArm64", project(":neton-ksp"))
}

// 确保 KSP 在编译之前执行
tasks.named("compileKotlinMacosArm64").configure {
    dependsOn(tasks.named("kspKotlinMacosArm64"))
}

// 将生成的代码加入源码集
kotlin.sourceSets.named("macosArm64Main") {
    kotlin.srcDir("build/generated/ksp/macosArm64/macosArm64Main/kotlin")
}
```

::: info 不使用 KSP
如果不使用 KSP，你仍然可以使用 DSL 方式手动注册路由。参见 [路由与控制器 - DSL 路由](./routing.md#dsl-路由)。
:::

## 进一步阅读

- [快速开始](./quick-start.md) -- 创建第一个 Neton 项目
- [路由与控制器](./routing.md) -- 控制器注解与路由组详解
- [Core 规范 v1](/spec/core) -- 框架核心架构的设计规范
- [Config SPI 规范](/spec/config-spi) -- @NetonConfig 与配置扩展点的规范定义
