# netonstream 技术栈

Neton 生态的网络基础库：Kotlin/Native 上的 I/O、协议与传输，Maven 坐标统一在 `com.netonstream` 下。每个库以一个成熟实现为参考
复刻首版，再按 neton-io 与 Kotlin 协程落地。本目录是这些库的工程标准、支持声明、证据索引与路线图；各库的实现记录仍在各自仓库的
`SPEC.md`。

> 本目录为内部工程文档，暂不发布到站点（与 `spec/` 相同）。

## 文档

- [工程标准](./standards.md)：支持声明、证据分级、条款清单、外部套件、失败处理、运行时契约、兼容性、性能、安全、可追溯发布。
- [路线图](./roadmap.md)：按退出条件推进的阶段与当前缺口。
- [安全策略](./security.md)（草案）
- [发布记录](./releases.md)
- 支持声明与证据索引：
  - [quic](./libraries/quic.md)
  - io、http、websocket、http3、tls、msgtrans：待建（按 quic 的格式）

## 库

| 库 | 坐标 | 最新版本 | 参考实现 | 仓库 |
|---|---|---|---|---|
| io | `io`、`io-testkit` | 0.3.3 | tokio 的定位与 geario 的反应器思路（自研） | netonframework/io |
| http | `http` | 0.2.0 | http 1.5.0、httparse 1.10.1、hyper 1.11.1、h2 0.4.19、hyper-util 0.1.20 | netonframework/http |
| websocket | `websocket` | 0.2.0 | tungstenite / tokio-tungstenite 0.30.0 | netonframework/websocket |
| quic | `quic`、`quic-testkit` | 0.2.0 | quinn 0.11.12（quinn-proto 0.11.18） | netonframework/quic |
| http3 | `http3` | 0.2.0 | h3 0.0.8、h3-quinn | netonframework/http3 |
| tls | `tls`、`tls-http`、`tls-websocket` | 0.2.0 | 以 OpenSSL 4.0.2 完成 TLS；`tls-http` 对应 hyper-rustls | netonframework/tls |
| openssl | `openssl` | 4.0.2 | OpenSSL 4.0.2 的 Kotlin 绑定（openssl-kotlin，另有维护者） | — |
| msgtrans | `msgtrans`、`msgtrans-quic`、`msgtrans-websocket` | 0.4.0 / 0.1.1 / 0.1.0 | msgtrans-rust 2.0.0-beta.2（线协议对等、互通） | zoujiaqing/msgtrans-kotlin |

依赖关系：

```
io ─┬─ http ─┬─ websocket
    │        └─ tls-http（+ tls）
    ├─ tls（+ openssl）─┬─ tls-http
    │                   └─ tls-websocket（+ websocket）
    ├─ quic（+ openssl）── http3
    └─ msgtrans ─┬─ msgtrans-quic（+ quic）
                 └─ msgtrans-websocket（+ websocket）
```

## 现状一览

| 库 | 外部一致性 / 互通 | CI 中运行测试的平台 |
|---|---|---|
| io | `IoStream` 一致性套件（io-testkit，供各库复用）；Buffer 的模型模糊测试 | macOS（kqueue、poll）、Linux（epoll、io_uring、poll）、Windows（IOCP、WSAPoll）、JVM |
| http | h2spec 145/145（RFC 7540/7541）；curl 互通；请求走私向量 | macOS、Linux（epoll、io_uring，含 TCP 传输）、Windows（IOCP、WSAPoll） |
| websocket | Autobahn 双向各 517 用例无失败（含 permessage-deflate） | 见仓库 CI |
| quic | QUIC Interop Runner（对 quinn、quic-go、ngtcp2）；quinn-peer 互通 | macOS、Linux（epoll、io_uring）、Windows（IOCP、WSAPoll） |
| http3 | h3spec 49/49；h3 / h3-quinn、aioquic 互通 | 见仓库 CI |
| tls | 经 http / websocket 的 HTTPS、wss 测试 | macOS、Linux（epoll、io_uring）、Windows（IOCP、WSAPoll） |
| msgtrans | 与 msgtrans-rust 的 TCP、QUIC、WebSocket（ws / wss）互通 | macOS、Linux（epoll、io_uring、poll）、JVM |

这些结果的适用范围与局限见各库的支持声明；"套件判定通过"与"行为已验证"的区别见 [工程标准 §3](./standards.md#_3-证据分级)。
