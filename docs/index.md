---
layout: home
hero:
  name: Neton Framework
  text: 现代化 Kotlin/Native Web 框架
  tagline: 易用、高性能、可扩展。基于 Kotlin Multiplatform + KSP，编译为原生二进制，零反射、毫秒级启动。
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/quick-start
    - theme: alt
      text: 规范文档
      link: /spec/
    - theme: alt
      text: 项目路线图
      link: /spec/roadmap

features:
  - title: Kotlin/Native 原生性能
    details: 编译为原生二进制，启动 ~3ms，内存占用 ~20MB，无 JVM 开销。适合边缘计算和资源受限环境。
  - title: 约定优于配置
    details: 参数绑定自动推断（Path / Query / Body），90% 场景零注解。路由按目录约定分组。
  - title: 内建安全体系
    details: Authenticator + Guard 双层架构，支持 JWT / Session / Mock 认证，注解驱动授权。
  - title: 模块化组件系统
    details: http / routing / security / redis / cache / database / logging，install 即用，按需组合。
  - title: 结构化日志
    details: 统一 Logger API，JSON 输出，内建 traceId / spanId 传播，自动脱敏，便于对接日志采集系统。
  - title: KSP 编译期生成
    details: Controller 路由、参数绑定、Config SPI 均由 KSP 在编译期完成，零反射、零运行时扫描。
---
