# HTTP/1.1 & HTTP/2

HTTP 协议库，不是 Neton 的路由或鉴权框架。HTTP/2 属于同一个库，不是独立 http2 产物。

## 已有能力

HTTP/1.1 与 HTTP/2 客户端和服务端、流式 Body、升级与 CONNECT、同端口协议识别，以及 `neton.http.client.Client` 连接池。

## 如何接入

坐标：`com.netonstream:http`。低层服务端从 io 接收 `IoStream`，交给 `Http1ServerConfig`、`Http2ServerConfig` 或 `AutoServerConfig`。应用开发优先使用 Neton 框架；独立客户端用 `Client.builder()`，HTTPS 配合 `tls-http`。消费或正确关闭响应体，才能安全复用连接。

版本与安装规则见[接入与版本](./versions.md)，不要把下面的源码版本直接当作已发布版本。

## 支持范围与限制

当前构建声明 Native 与 JVM；TLS 由独立库提供。HTTP/3 不在本产物内。HTTP 协议库存在某种能力，不代表框架适配器已经暴露该能力。

## 验证记录

SPEC/README 记录 h2spec 145/145、curl 互通、走私向量及流式上传测试。它们有特定版本和场景范围，不等于所有 HTTP/2 行为和部署环境均已验证。

以上是仓库记录的结果，本次文档整理没有重新执行协议测试或性能测试。平台声明与运行验证的区别见[支持矩阵](./support.md)。

## 源码依据

核对日期：2026-10-12；源码提交：`a402ccd50157a8b313ded97e6a3fce12bc43b6da`；构建声明版本：`0.3.0`（非 Central 发布确认）。

- [源码与用法](https://github.com/netonframework/http)
- [目标与依赖](https://github.com/netonframework/http/blob/main/http/build.gradle.kts)
- [设计与验证记录](https://github.com/netonframework/http/blob/main/SPEC.md)

链接指向仓库 main，可能随开发更新；本页的结论以记录的核对提交为准。

