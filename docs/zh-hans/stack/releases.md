# 发布记录

> 按 [工程标准 §12](./standards.md#_12-可追溯发布) 记录每次发布：坐标、标签与提交、依赖、工具链、发版前的验证证据。
> 本记录从 2026-10-08 起补录；更早的版本只列坐标与标签。

## 当前的发布方式与已知不足

- 由维护者本机构建、签名（GPG）、打包，上传 Maven Central Portal（`central-release.py`，用户托管的部署，校验后手动发布）。
- 依赖尚未上线时，下游以 `--include-build` 或 staging 仓库构建，POM 中写已发布的坐标。
- **不足**：
  1. 发布不由 CI 执行，产物与 CI 运行之间没有机器可验证的对应关系。
  2. 依赖与下游同批发布时，**发版提交上的 CI 因依赖尚未上线而无法解析依赖、没有运行测试**（见下表"发版提交的 CI"列）。这些版本的验证
     来自本机与 staging 仓库，以及之后主干提交上的 CI，而不是发版提交本身。改进方向：依赖上线后再打下游的标签，或让 CI 能从 staging 仓库
     解析依赖。
  3. 没有 SBOM，构建不可重复。

## 2026-10-10

| 坐标 | 版本 | 标签 / 提交 | 依赖 | 工具链 | 发版提交的 CI |
|---|---|---|---|---|---|
| `msgtrans` | 0.4.0 | v0.4.0 / 68921a3 | io 0.3.3 | Kotlin 2.4.20 | 37961081909、37961080830、37961069337 通过；**37961081168 失败**：`interop with msgtrans-rust (iouring)` 中 "1. Kotlin client -> Rust server, ws" 的 Rust 服务端未在等待时间内退出（其余用例通过）。同代码的 ba0a4be（37955205087）全部通过。**未解释，进入路线图** |
| `msgtrans-websocket` | 0.1.0 | msgtrans-websocket-v0.1.0 / 68921a3 | msgtrans 0.4.0、websocket 0.2.0 | Kotlin 2.4.20 | 同上 |
| `msgtrans-quic` | 0.1.1 | msgtrans-quic-v0.1.1 / 68921a3 | msgtrans 0.4.0、quic 0.2.0、io 0.3.3 | Kotlin 2.4.20、OpenSSL 4.0.2 | 同上 |

内容：msgtrans-websocket 首发（与 msgtrans-rust 的 WebSocket 线协议对等，ws / wss 互通）；`msgtrans` 移除未实现的 `WebSocketClientTransport` 存根；
msgtrans-quic 0.1.1 与 0.1.0 代码相同，改为依赖 msgtrans 0.4.0。

## 2026-10-09

| 坐标 | 版本 | 标签 / 提交 | 依赖 | 工具链 | 发版提交的 CI |
|---|---|---|---|---|---|
| `io`、`io-testkit` | 0.3.3 | io-v0.3.3 / ce18ed0 | — | Kotlin 2.4.20 | 37953259387、37953248417 通过；功能提交 39ed866（37948855187）全平台通过 |
| `msgtrans` | 0.3.0 | v0.3.0 / 830f9d8 | io 0.3.3 | Kotlin 2.4.20 | 37953657325、37953656913、37953648489 通过（含与 msgtrans-rust 的 QUIC 互通） |
| `msgtrans-quic` | 0.1.0 | msgtrans-quic-v0.1.0 / 830f9d8 | msgtrans 0.3.0、quic 0.2.0、io 0.3.3 | Kotlin 2.4.20、OpenSSL 4.0.2 | 同上 |
| `pulsekit`、`pulsekit-android` | 0.2.1 | v0.2.1 / 5a1281d（netonframework/pulsekit） | msgtrans 0.3.0 | Kotlin 2.4.20 | 修复提交 be33a54 的 CI 通过（macOS、Linux epoll / io_uring、Android 单元） |
| `tls`、`tls-http`、`tls-websocket` | 0.2.0 | v0.2.0 / dc1e86a | io 0.3.2、openssl 4.0.2、http 0.2.0、websocket 0.2.0 | Kotlin 2.4.20、OpenSSL 4.0.2 | 37927504344、37926783790 通过（macOS、Linux epoll / io_uring、Windows IOCP / WSAPoll、全目标编译） |

内容：io 新增 `lookupHost`；msgtrans 的 zstd 修复（不可压缩、超过约 1 KB 的负载压缩失败）、可插拔分帧；msgtrans-quic 首发；pulsekit 修复 Linux
设备 ID 不持久的问题；tls 新增系统信任库、`peerIdentityOf`、tls-http（`HttpsConnector`）与 tls-websocket（`WssConnector`），并修复 IOCP 上取消写入时
TLS 记录的计数。

## 2026-10-08

| 坐标 | 版本 | 标签 / 提交 | 依赖 | 工具链 | 发版提交的 CI |
|---|---|---|---|---|---|
| `io`、`io-testkit` | 0.3.2 | io-v0.3.2 / 97ea074 | — | Kotlin 2.4.0 | 37746268506、37746268094 通过 |
| `http` | 0.2.0 | v0.2.0 / eb3a62e | io 0.3.2 | Kotlin 2.4.0 | 当时仓库无 CI（仅 macOS 本机）；CI 自 f624b44 起 |
| `websocket` | 0.2.0 | v0.2.0 / d239cb1 | io 0.3.2、http 0.2.0 | Kotlin 2.4.0 | **37746288390 失败：依赖尚未上线，未运行测试** |
| `quic`、`quic-testkit` | 0.2.0 | v0.2.0 / 6d50860 | io 0.3.2、openssl 4.0.2 | Kotlin 2.4.0、OpenSSL 4.0.2 | **37747023909、37747023938 失败：`Could not find com.netonstream:io:0.3.2`，未运行测试** |
| `http3` | 0.2.0 | v0.2.0 / 407fbe8 | quic 0.2.0、http 0.2.0 | Kotlin 2.4.0、OpenSSL 4.0.2 | **37747035142 失败：依赖尚未上线，未运行测试** |

同日较早：io 0.3.0、0.3.1；http 0.1.2；websocket、quic、quic-testkit、http3 的 0.1.0。

## 更早

- 2026-10-04：io、io-testkit 0.2.0；msgtrans 0.2.0；pulsekit、pulsekit-android 0.2.0（各库首次提供 JVM 目标）。
- 2026-10-01：io、io-testkit 0.1.1；http 0.1.1。
- 2026-09-29：io、io-testkit、http、tls 0.1.0（`com.netonstream:io` 新坐标的首个版本线）；openssl 4.0.2（另有误发布的 0.1.0，与 4.0.2 为同一构建）。
- 2026-09-25：`com.netonstream:neton-io` 0.1.0（旧坐标，已由 `io` 取代）、msgtrans 0.1.0、pulsekit 0.1.0。
