# OpenSSL Kotlin

OpenSSL 的 Kotlin 封装，不是自研密码算法或自研 TLS 实现。

## 已有能力

静态 OpenSSL、Native C 绑定、无 socket 的 `TlsContext` / `TlsEngine`、AEAD、头部保护、HKDF/HMAC、随机数，以及 QUIC TLS 外观。

## 如何接入

坐标：`com.netonstream:openssl`。需要网络 TLS 时优先用 tls；实现协议或密码封装时才直接使用此库。显式管理上下文生命周期与信任策略，遵守重试和缓冲所有权规则。

版本与安装规则见[接入与版本](./versions.md)，不要把下面的源码版本直接当作已发布版本。

## 支持范围与限制

版本跟随 OpenSSL，后缀表示封装修订。最低支持 4.0.x。JVM 通过 JNI；README 将其标为进行中，不能把 Native 的支持范围自动推广到 JVM/Android。默认源码构建只选宿主目标。

## 验证记录

`VALIDATION.md` 记录构建与运行结果；成功链接不等于信任库、协议互通或性能已验证。

以上是仓库记录的结果，本次文档整理没有重新执行协议测试或性能测试。平台声明与运行验证的区别见[支持矩阵](./support.md)。

## 源码依据

核对日期：2026-10-12；源码提交：`4d30e9005c3c2b31a25e91b66c298651824474db`；构建声明版本：`4.0.2-3`（非 Central 发布确认）。

- [源码与用法](https://github.com/netonframework/openssl-kotlin)
- [目标与依赖](https://github.com/netonframework/openssl-kotlin/blob/main/gradle.properties)
- [设计与验证记录](https://github.com/netonframework/openssl-kotlin/blob/main/VALIDATION.md)

链接指向仓库 main，可能随开发更新；本页的结论以记录的核对提交为准。

