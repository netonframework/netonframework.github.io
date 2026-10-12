# TLS

把 OpenSSL 的无 I/O TLS 引擎接到 io 字节流上。

## 已有能力

`tlsConnect`、`tlsAccept`、`TlsStream`；独立的 `tls-http` 和 `tls-websocket` 提供 HTTPS/WSS connector。

## 如何接入

坐标：`com.netonstream:tls`。显式提供信任根与对端名称/IP，配置 ALPN，然后包装 TCP 流。服务端提供证书链和私钥。系统信任根辅助函数不是关闭证书验证的替代品。

版本与安装规则见[接入与版本](./versions.md)，不要把下面的源码版本直接当作已发布版本。

## 支持范围与限制

Native 目标不含 32 位 Android；JVM 依赖 OpenSSL JNI，不是纯 JVM TLS。系统根读取依平台而异，iOS 辅助函数不提供系统根枚举。不要承诺所有平台的信任策略相同。

## 验证记录

仓库的 TLS、HTTPS、WSS 测试及 SPEC 记录是验证入口。运行目标、JNI 本地库部署和证书存储行为必须分别验证。

以上是仓库记录的结果，本次文档整理没有重新执行协议测试或性能测试。平台声明与运行验证的区别见[支持矩阵](./support.md)。

## 源码依据

核对日期：2026-10-12；源码提交：`6e32d23efa3421955358336086ebe517b8e3a06f`；构建声明版本：`0.3.0`（非 Central 发布确认）。

- [源码与用法](https://github.com/netonframework/tls)
- [目标与依赖](https://github.com/netonframework/tls/blob/main/tls/build.gradle.kts)
- [设计与验证记录](https://github.com/netonframework/tls/blob/main/SPEC.md)

链接指向仓库 main，可能随开发更新；本页的结论以记录的核对提交为准。

