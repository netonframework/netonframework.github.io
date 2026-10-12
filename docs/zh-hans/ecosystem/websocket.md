# WebSocket

独立的 RFC 6455 协议实现；业务框架会话是另一层。

## 已有能力

客户端/服务端握手、掩码、分片、UTF-8 校验、控制帧、关闭握手和可选 permessage-deflate（默认关闭）。当前构建包含 JVM。

## 如何接入

坐标：`com.netonstream:websocket`。独立使用时通过 `accept` / `client` / `connect` 建连，再 `receive` / `send`；WSS 配合 `tls-websocket`。Neton 应用使用 `neton-websocket` 的会话和路由入口，不直接暴露协议对象给业务。

版本与安装规则见[接入与版本](./versions.md)，不要把下面的源码版本直接当作已发布版本。

## 支持范围与限制

协议控制帧处理不等于应用保活策略。主动心跳、慢消费者处理、全局预算、身份与订阅需要会话运行时或业务层管理。启用压缩要评估内存和 CPU 成本。

## 验证记录

README 记录 Autobahn 双向各 517 项：压缩开启时 512 OK、2 NON-STRICT、3 INFORMATIONAL。不是所有用例严格通过，也不是当前源码的高并发性能保证。

以上是仓库记录的结果，本次文档整理没有重新执行协议测试或性能测试。平台声明与运行验证的区别见[支持矩阵](./support.md)。

## 源码依据

核对日期：2026-10-12；源码提交：`c34cbecba7fba2be6084e8f97cc19dea463047d0`；构建声明版本：`0.3.0`（非 Central 发布确认）。

- [源码与用法](https://github.com/netonframework/websocket)
- [目标与依赖](https://github.com/netonframework/websocket/blob/main/websocket/build.gradle.kts)
- [设计与验证记录](https://github.com/netonframework/websocket/blob/main/SPEC.md)

链接指向仓库 main，可能随开发更新；本页的结论以记录的核对提交为准。
