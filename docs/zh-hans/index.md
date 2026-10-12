---
layout: home
hero:
  name: Neton
  text: 从网络底座到应用框架
  tagline: 面向 Kotlin/Native 的应用框架与独立网络协议栈。自研 I/O、HTTP、WebSocket、QUIC、HTTP/3，结合 OpenSSL 的 TLS 与密码能力，以及 msgtrans 消息传输。
  actions:
    - theme: brand
      text: 开发应用
      link: /zh-hans/guide/quick-start
    - theme: alt
      text: 探索协议栈
      link: /zh-hans/ecosystem/
    - theme: alt
      text: RPC 与消息
      link: /zh-hans/ecosystem/msgtrans

features:
  - title: 应用框架
    details: 路由、鉴权、数据访问、缓存、任务与日志；KSP 编译期装配，面向原生服务开发。
    link: /zh-hans/guide/
  - title: 异步 I/O
    details: reactor、TCP/UDP、缓冲与协程调度。io 是独立库，不要求使用 Neton 框架。
    link: /zh-hans/ecosystem/io
  - title: HTTP 与实时连接
    details: HTTP/1.1、HTTP/2、连接池与 WebSocket；协议库和框架会话分层，按需选择。
    link: /zh-hans/ecosystem/http
  - title: QUIC 与 HTTP/3
    details: 基于 UDP 的多路流传输，独立的 HTTP/3 实现。支持范围与尚未实现的扩展明确列出。
    link: /zh-hans/ecosystem/http3
  - title: TLS 与 OpenSSL
    details: OpenSSL Kotlin 封装、TLS 字节流、HTTPS/WSS connector；不重新发明密码算法。
    link: /zh-hans/ecosystem/tls
  - title: 消息与 RPC 传输
    details: msgtrans 提供请求关联、单向消息、背压及 TCP/QUIC/WebSocket 传输，不绑定业务框架。
    link: /zh-hans/ecosystem/msgtrans
---

## 一套生态，两种入口

开发业务应用，从[框架指南](/zh-hans/guide/)开始。构建自己的网络服务，从[独立协议库](/zh-hans/ecosystem/)开始。HTTP/2 是 http 库的一部分；HTTP/3 独立演进，不需要为了使用底层库引入整套框架。

::: info 能力、平台与版本
当前源码工具链为 Kotlin 2.4.20，框架仍处于 1.0 Beta 演进阶段。各库独立发布，源码版本不等于可下载产物。参阅[支持矩阵](/zh-hans/ecosystem/support)与[接入和版本](/zh-hans/ecosystem/versions)，了解已实现、历史验证和未支持的边界。
:::
