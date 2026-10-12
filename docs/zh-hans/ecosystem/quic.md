# QUIC

基于 io UDP 与 OpenSSL TLS 的 QUIC 传输库，可供 HTTP/3 或自定义协议使用。

## 已有能力

端点、连接、多路流、流控、丢包恢复、拥塞控制、数据报、真实 TLS 1.3、会话恢复、0-RTT 与密钥更新。当前构建增加 JVM 目标。

## 如何接入

坐标：`com.netonstream:quic`。配置证书、信任根与 ALPN，创建 UDP endpoint，再接受或发起连接。对连接、流、缓冲设置上限并显式关闭。0-RTT 业务必须考虑重放，不能直接用于不可重复执行的操作。

版本与安装规则见[接入与版本](./versions.md)，不要把下面的源码版本直接当作已发布版本。

## 支持范围与限制

Native 不含 32 位 Android；JVM 依赖 io UDP 与 OpenSSL JNI。没有服务端 0.5-RTT 发送保证。Interop Runner 的 v2 / connectionmigration 等不支持或失败项不能描述成已完成。

## 验证记录

SPEC §11.18 记录 quinn、quic-go、ngtcp2 多方向互通，也保留 handshakeloss / handshakecorruption 的间歇失败。真实 TLS、损伤网络和长期运行需要持续回归，不宣称全部互通通过。

以上是仓库记录的结果，本次文档整理没有重新执行协议测试或性能测试。平台声明与运行验证的区别见[支持矩阵](./support.md)。

## 源码依据

核对日期：2026-10-12；源码提交：`ae552743044cb374a8ecaed78cf4a836e3ee279f`；构建声明版本：`0.3.0`（非 Central 发布确认）。

- [源码与用法](https://github.com/netonframework/quic)
- [目标与依赖](https://github.com/netonframework/quic/blob/main/quic/build.gradle.kts)
- [设计与验证记录](https://github.com/netonframework/quic/blob/main/SPEC.md)

链接指向仓库 main，可能随开发更新；本页的结论以记录的核对提交为准。

