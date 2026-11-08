# 接入与版本

## 两条使用路径

**开发业务应用**：从[框架快速开始](/zh-hans/guide/quick-start)选择框架版本，让框架适配层管理协议接线。不要仅因为底层库升级就强行覆盖框架依赖。

**独立使用协议库**：按各库说明选择坐标，不依赖 Neton 框架。所有以下短坐标的 group 都是 `com.netonstream`：

| 用途 | artifact |
|---|---|
| I/O 与流一致性测试 | `io` / `io-testkit`（测试依赖） |
| HTTP/1.1、HTTP/2 | `http` |
| TLS、HTTPS、WSS 适配 | `tls` / `tls-http` / `tls-websocket` |
| OpenSSL 绑定 | `openssl` |
| WebSocket | `websocket` |
| QUIC 与测试替身 | `quic` / `quic-testkit`（测试依赖） |
| HTTP/3 | `http3` |
| 消息与 RPC 传输 | `msgtrans` / `msgtrans-quic` / `msgtrans-websocket` |

```kotlin
// 构建配置示意：ioVersion 由应用固定为已验证且能解析的发布版本。
commonMain.dependencies {
    implementation("com.netonstream:io:$ioVersion")
}
```

这不是可直接复制的完整工程；先定义版本变量，并按所选库的 Gradle 配置核对目标与依赖。

## 版本不统一，不猜测发布状态

各库独立演进，不要求与 Framework 使用相同版本号。2026-11-09 核对的发布基线为：Framework 1.1.2、io 0.4.1、HTTP / TLS / WebSocket / QUIC / HTTP3 0.3.1、OpenSSL 绑定 4.1.0-1（底层 OpenSSL 4.1.0）、msgtrans 0.5.1（QUIC / WebSocket 适配各 0.2.1）、PulseKit / pulsekit-android 0.3.1。

Framework 1.1.2 升级共享加密依赖链，保持公开 API 和 Kotlin/KSP 工具链兼容；框架模块、KSP 制品及 BOM 统一为 1.1.2。绑定版本 4.1.0-1 修复了底层 OpenSSL 4.1.0 在 Windows Kotlin/Native 上的链接问题，应使用这一修订版而非原始 4.1.0 制品。本次也消除了数据库源码 JAR 的重复条目，并增加发布回归门禁。

精确发布提交的[完整 CI](https://github.com/netonframework/neton/actions/runs/42532494358) 已通过，345 个制品文件及其 345 个签名均已从 Central 回读核对。使用全新缓存、仅依赖 Central 的公开应用完成两次 Release 构建及两轮健康运行、优雅关闭，每轮关闭后监听端口均已释放。独立的 24 小时低负载 HTTP 长稳运行于上一条依赖基线，不能认证本次升级；本次发布不宣称已完成长稳或性能认证。

精确坐标、发布源码提交及 Central 根元数据摘要以 [release-baseline.json](https://github.com/netonframework/neton/blob/main/tools/ci/release-baseline.json) 为准；[发布门禁](https://github.com/netonframework/netonframework.github.io/blob/main/docs/zh-hans/spec/release-gate.md#published-stack-baseline-110-onward) 区分元数据存在、实际依赖解析、平台运行测试和长期稳定性证据。QUIC / HTTP3 / msgtrans / PulseKit 是独立扩展链，并非都被 Framework 的 HTTP/WebSocket 门禁覆盖。`0.x` 的正式制品不自动等于已承诺 1.x API 稳定性。

源码版本声明和 Maven 的 `latest` 字段都不能替代固定版本验收。尤其独立 `neton-ai:0.1.0` 与历史 Framework beta 版本共用过坐标，须明确指定版本，不按元数据的最大版本自动升级；AI 不属于 Framework BOM 或上述通信栈基线。

Kotlin/Native 项目当前使用 Kotlin 2.4.20。优先使用产物发布时的编译器版本；升级编译器或替换依赖后重新验证。JVM 字节码/元数据兼容策略与 Native KLIB 兼容性不是一回事。

## 本地开发与发布隔离

本地联调可以使用显式 composite build，但不能把本机缓存或未提交的兄弟仓库改动当作发布依赖。发布验收应在干净环境用正式坐标构建，并记录版本、平台、互通与失败项。

测试替身、测试证书、`io-testkit` 和 `quic-testkit` 不进入生产依赖。OpenSSL 原生/JNI 产物另需确认目标架构和运行时部署。

## 文档维护约定

用户指南统一在 neton-docs；KDoc、实现规范和原始验证记录留在源码仓库。更新公开能力时同时更新中英文页面，注明日期、源码提交、限制和证据；不复制整套 SPEC，不让内部待评审方案混入用户承诺。
