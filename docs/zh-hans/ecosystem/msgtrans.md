# msgtrans

消息传输与请求/响应通信底座，可承载 RPC；不是已经完成的类型化 RPC 框架。

## 已有能力

`Transport`、`Connection`、`ConnectionConfig`、请求关联、单向消息、超时、背压、压缩；TCP 为基础，QUIC/WebSocket 为可选模块。

## 如何接入

坐标：`com.netonstream:msgtrans`。`Transport.connect` 建立会话，`Connection.request` 等待关联响应，`send` 发单向消息。业务定义 payload 与 bizType，服务端处理器实现业务分发。需要 QUIC/WS 时另加 `msgtrans-quic` / `msgtrans-websocket`，不要把它们的版本号假定为与核心一致。

版本与安装规则见[接入与版本](./versions.md)，不要把下面的源码版本直接当作已发布版本。

## 支持范围与限制

核心声明 macOS/Linux/iOS 与 JVM；Android Native 需显式开启，默认不发布；未声明 Windows Native。JVM QUIC/安全 WebSocket 还受 JNI 部署限制。类型化 RPC、服务发现和跨语言业务代码生成不是此处的既有承诺。

## 验证记录

仓库保留 Rust peer 与 TCP/QUIC/WebSocket 互通脚本、取消与资源上限测试。TypeScript 等其他客户端不能仅因线协议相同就认定已经互通验证。

以上是仓库记录的结果，本次文档整理没有重新执行协议测试或性能测试。平台声明与运行验证的区别见[支持矩阵](./support.md)。

## 源码依据

核对日期：2026-10-12；源码提交：`2b55bb48c62313f766d99a1067df4fd2aa490ec5`；构建声明版本：`0.5.0`（非 Central 发布确认）。

- [源码与用法](https://github.com/zoujiaqing/msgtrans-kotlin)
- [目标与依赖](https://github.com/zoujiaqing/msgtrans-kotlin/blob/main/msgtrans/build.gradle.kts)
- [设计与验证记录](https://github.com/zoujiaqing/msgtrans-kotlin/blob/main/SPEC.md)

链接指向仓库 main，可能随开发更新；本页的结论以记录的核对提交为准。
