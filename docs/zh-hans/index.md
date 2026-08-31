---
layout: home
hero:
  name: Neton
  text: 高性能 Kotlin/Native 服务端应用框架
  tagline: 一个生产级服务需要的都在里面——路由、数据访问、缓存、安全、定时任务、领域事件——编译为原生二进制。无 JVM、零反射、毫秒级启动。
  actions:
    - theme: brand
      text: 快速开始
      link: /zh-hans/guide/quick-start

features:
  - title: Kotlin/Native 原生性能
    details: 编译为原生二进制，启动 ~3ms，内存占用 ~20MB，无 JVM 开销。适合边缘计算和资源受限环境。
  - title: 约定优于配置
    details: 参数绑定自动推断（Path / Query / Body），90% 场景零注解。路由按目录约定分组。
  - title: 内建安全体系
    details: Authenticator + Guard 双层架构，内建 JWT / Mock 认证（Session 需自行实现），注解驱动授权。
  - title: 对标 Spring Boot，原生编译
    details: 完全对标 Spring Boot 给一个服务的能力——Web、校验、带事务的类型安全数据库 DSL、两级缓存、Redis 与分布式锁、安全、定时任务、带事务性 outbox 的领域事件——且由编译期装配，而不是启动时反射拼装。逐条对照见「从 Spring Boot 过来」。
  - title: 结构化日志
    details: 统一 Logger API，JSON 输出，内建 traceId / spanId 传播，自动脱敏，便于对接日志采集系统。
  - title: KSP 编译期生成
    details: Controller 路由、参数绑定、Config SPI 均由 KSP 在编译期完成，零反射、零运行时扫描。
---

::: tip Kotlin/Native 服务端时代，从这里开始
Spring Boot 级的工程效率，Kotlin/Native 原生二进制的启动速度与资源密度。阅读
[Neton 1.0.0-beta1 发布宣言](/zh-hans/releases/1.0.0-beta1)。
:::

::: info 版本对应声明
本文档对应 **Neton 1.0.0-beta1**（Kotlin 2.4.0 / KSP 2.3.10）。
若文档与代码不一致，**一律以 `neton/examples/` 下的可编译示例和框架源码为准**，并欢迎提 issue 修正文档。
:::
