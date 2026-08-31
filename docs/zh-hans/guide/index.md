# 用户指南

::: info 版本对应声明
本文档对应 **Neton 1.0.0-beta1**（Kotlin 2.4.0 / KSP 2.3.10）。
若文档与代码不一致，**一律以 `neton/examples/` 下的可编译示例和框架源码为准**。
:::

欢迎阅读 Neton Framework 用户指南。

Neton 是一个现代化的 Kotlin/Native Web 框架，基于 Kotlin Multiplatform 构建，编译为原生二进制文件，具备零反射、毫秒级启动、极低内存占用等特性。本指南将帮助你从零开始掌握 Neton 的核心功能，并构建高性能的 Web 应用。

## 目录导航

### 入门

- [快速开始](./quick-start.md) -- 从零搭建第一个 Neton 应用，5 分钟运行 Hello World
- [能力总览](./capabilities.md) -- 内建能力有哪些、什么交给平台、为什么这样更快更好维护
- [项目结构](./project-structure.md) -- 了解 Neton 的模块划分、目录约定与配置文件

### 核心功能

- [路由与控制器](./routing.md) -- Controller 注解、HTTP 方法、路由组、DSL 路由
- [参数绑定](./parameter-binding.md) -- 约定优于配置的参数推断，Path / Query / Body / Header / Cookie 绑定
- [配置管理](./configuration.md) -- TOML 配置文件、环境覆盖、@NetonConfig SPI 扩展
- [日志系统](./logging.md) -- 结构化日志、Sink 路由、异步写入、Trace 上下文

### 安全与认证

- [安全指南](./security.md) -- Authenticator + Guard 架构、JWT 认证、@RequireAuth / @AllowAnonymous 授权

### 数据与缓存

- [数据库操作](./database.md) -- Entity + Table 模式、类型安全 Query DSL、Repository 层
- [缓存](./cache.md) -- L1 + L2 两级缓存、@Cacheable / @CachePut / @CacheEvict 注解
- [Redis 与分布式锁](./redis.md) -- Redis 客户端、@Lock 分布式锁
- [领域事件](./events.md) -- 用事件总线解耦模块，SYNC / BEST_EFFORT / RETRYABLE 三种投递模式

### 进阶

- [中间件机制](./middleware.md) -- 请求管道、自定义中间件
- [部署与跨平台](./deployment.md) -- 构建发布、跨平台编译目标
- [工具链已知问题](./tooling-known-issues.md) -- Kotlin/Native、KSP 与 Gradle 的已知构建噪音
