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

各库独立演进，不要求与 Framework 使用相同版本号。2026-11-07 核对的发布基线为：Framework 1.1.0、io 0.4.1、HTTP / TLS / WebSocket / QUIC / HTTP3 0.3.0、OpenSSL 4.0.2-3、msgtrans 0.5.0（QUIC / WebSocket 适配各 0.2.0）、PulseKit 0.3.0。

精确坐标、发布源码提交及 Central 根元数据摘要以 [release-baseline.json](https://github.com/netonframework/neton/blob/main/tools/ci/release-baseline.json) 为准；[发布门禁](https://github.com/netonframework/netonframework.github.io/blob/main/docs/zh-hans/spec/release-gate.md#published-stack-baseline-110-onward) 区分元数据存在、实际依赖解析、平台运行测试和长期稳定性证据。QUIC / HTTP3 / msgtrans / PulseKit 是独立扩展链，并非都被 Framework 的 HTTP/WebSocket 门禁覆盖。`0.x` 的正式制品不自动等于已承诺 1.x API 稳定性。

源码版本声明和 Maven 的 `latest` 字段都不能替代固定版本验收。尤其独立 `neton-ai:0.1.0` 与历史 Framework beta 版本共用过坐标，须明确指定版本，不按元数据的最大版本自动升级；AI 不属于 Framework BOM 或上述通信栈基线。

Kotlin/Native 项目当前使用 Kotlin 2.4.20。优先使用产物发布时的编译器版本；升级编译器或替换依赖后重新验证。JVM 字节码/元数据兼容策略与 Native KLIB 兼容性不是一回事。

## 本地开发与发布隔离

本地联调可以使用显式 composite build，但不能把本机缓存或未提交的兄弟仓库改动当作发布依赖。发布验收应在干净环境用正式坐标构建，并记录版本、平台、互通与失败项。

测试替身、测试证书、`io-testkit` 和 `quic-testkit` 不进入生产依赖。OpenSSL 原生/JNI 产物另需确认目标架构和运行时部署。

## 文档维护约定

用户指南统一在 neton-docs；KDoc、实现规范和原始验证记录留在源码仓库。更新公开能力时同时更新中英文页面，注明日期、源码提交、限制和证据；不复制整套 SPEC，不让内部待评审方案混入用户承诺。
