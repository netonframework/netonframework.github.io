---
layout: home
hero:
  name: Neton
  text: 专注业务开发，原生部署运行。
  tagline: 基于 Kotlin/Native 的服务端应用框架，统一提供路由、依赖注入、数据库访问、安全与模块化开发能力，帮助开发者构建后端服务和业务系统。编译为原生可执行程序，无需 JVM。
  actions:
    - theme: brand
      text: 开发应用
      link: /zh-hans/guide/quick-start
    - theme: alt
      text: 了解 Neton Application
      link: /zh-hans/guide/application
    - theme: alt
      text: 框架能力
      link: /zh-hans/guide/capabilities

features:
  - title: 构建后端服务
    details: 控制器、路由、参数绑定与校验，为业务 API 提供一致的开发基础。
    link: /zh-hans/guide/
  - title: 处理业务数据
    details: 类型化数据访问、事务、缓存与 Redis，为应用状态管理和业务流程提供支持。
    link: /zh-hans/guide/database
  - title: 定义访问策略
    details: 通过认证与授权扩展点明确访问规则，让安全策略与业务处理职责分离。
    link: /zh-hans/guide/security
  - title: 模块化组织应用
    details: 依赖注入、配置管理与编译期注册，帮助组织服务，无需运行时反射。
    link: /zh-hans/guide/project-structure
  - title: 复用业务能力
    details: Neton Application 基于框架提供可复用业务模块与模块化管理前端，用于组装业务系统。
    link: /zh-hans/guide/application
  - title: 原生部署运行
    details: 将 Kotlin 服务编译为原生可执行程序，无需 JVM；按支持范围选择目标平台并验证部署依赖。
    link: /zh-hans/guide/deployment
---

## 框架提供基础，应用模块承载业务

**Neton Framework** 提供服务端开发的编程模型与通用能力；**Neton Application** 在其上通过可复用模块组装业务系统。开发定制服务可以直接使用框架，需要复用应用级能力时可以从 Application 开始。[了解两个层次的区别](/zh-hans/guide/application)。

网络协议栈是技术底座，而不是业务开发者的主要编程接口。独立库、协议细节与接入边界，请参阅[技术架构与网络生态](/zh-hans/ecosystem/)。

::: info 能力、平台与版本
当前源码工具链为 Kotlin 2.4.20，框架仍处于 1.0 Beta 演进阶段。各库独立发布，源码版本不等于可下载产物。参阅[支持矩阵](/zh-hans/ecosystem/support)与[接入和版本](/zh-hans/ecosystem/versions)，了解已实现、历史验证和未支持的边界。
:::
