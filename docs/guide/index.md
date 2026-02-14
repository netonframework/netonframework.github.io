# 用户指南

欢迎阅读 Neton Framework 用户指南。

Neton 是一个现代化的 Kotlin/Native Web 框架，基于 Kotlin Multiplatform 构建，编译为原生二进制文件，具备零反射、毫秒级启动、极低内存占用等特性。本指南将帮助你从零开始掌握 Neton 的核心功能，并构建高性能的 Web 应用。

## 文档体系

Neton 文档分为两个部分：

| 文档类型 | 目标读者 | 内容特点 |
|---------|---------|---------|
| **用户指南**（本部分） | 应用开发者 | 面向实践，包含教程、代码示例、最佳实践，引导你快速上手并高效开发 |
| **[规范文档](/spec/)** | 框架贡献者 / 深度用户 | 面向设计，包含 API 冻结定义、架构设计、SPI 规范，定义框架的内部契约与演进方向 |

如果你是第一次接触 Neton，建议从用户指南开始阅读；如果你需要了解某个功能的底层设计细节或 API 冻结定义，可以参阅对应的规范文档。

## 目录导航

### 入门

- [快速开始](./quick-start.md) -- 从零搭建第一个 Neton 应用，5 分钟运行 Hello World
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

### 进阶

- [中间件机制](./middleware.md) -- 请求管道、自定义中间件
- [部署与跨平台](./deployment.md) -- 构建发布、跨平台编译目标
