# Kotlin/Native 全栈，从 I/O 到应用

Neton 不只是应用框架，也提供可独立使用的网络与协议库。你可以使用完整框架开发服务，也可以只取一个协议库构建自己的系统。密码与 TLS 引擎基于 OpenSSL，并非重新实现密码算法。

## 从哪里开始

| 你的目标 | 入口 |
|---|---|
| 开发业务 API、认证与数据服务 | [Neton 框架快速开始](/zh-hans/guide/quick-start) |
| 实现自定义 TCP/UDP 协议 | [io](./io.md) |
| 独立 HTTP 客户端或服务端 | [HTTP/1.1 与 HTTP/2](./http.md) |
| 安全字节流、HTTPS 或 WSS | [TLS](./tls.md)、[OpenSSL](./openssl.md) |
| 双向实时消息 | [WebSocket](./websocket.md) |
| 多路复用传输或 HTTP/3 | [QUIC](./quic.md)、[HTTP/3](./http3.md) |
| 请求/响应、推送与 RPC 传输 | [msgtrans](./msgtrans.md) |

## 分层，而非绑定

```text
应用层        Neton Framework                 自定义应用 / msgtrans
框架集成      HTTP adapter / WebSocket 会话   TCP / QUIC / WebSocket transport
协议层        HTTP/1.1 + HTTP/2   WebSocket   HTTP/3
传输与安全    io                 TLS         QUIC
密码底座                         OpenSSL Kotlin -> OpenSSL C
```

这是一张职责图，不是完整依赖图：HTTP/3 同时依赖 HTTP 通用类型和 QUIC；QUIC 直接使用 OpenSSL 的 QUIC TLS 能力，不经 TLS 字节流适配器。WebSocket 握手使用 HTTP 类型，WSS 由 TLS connector 接入。

框架 API 与协议 API 是两个层级：`com.netonstream:neton-http` 面向框架集成，`com.netonstream:http` 面向协议；`neton-websocket` 与 `websocket` 同理。切换框架适配器需要检查其能力，不是换依赖后所有协议都会自动启用。

## 能力不等于成熟度

这套技术栈包含自研 I/O、HTTP、WebSocket、QUIC 与 HTTP/3 实现，但不是所有库都拥有相同的平台覆盖和发布进度。[支持矩阵](./support.md)区分源码目标、历史运行记录与待验证项；[接入与版本](./versions.md)说明如何选择兼容产物。

本入口基于 2026-10-12 的源码核对。生产部署应按目标平台验证；性能结论必须附负载、硬件、构建版本和错误指标。

