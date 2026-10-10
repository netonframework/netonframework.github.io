# quic — 支持声明与证据索引

> 坐标 `com.netonstream:quic`（测试替身 `quic-testkit`），包 `neton.quic`；仓库 `netonframework/quic`。
> 本文基于发布版本 **0.2.0**（2026-10-08）及其后的主干（之后只增加了测试）。实现记录在仓库的 `SPEC.md`，下文以"SPEC §x"引用。
> 证据级别见 [工程标准 §3](../standards.md#_3-证据分级)：V 已验证、I 互通观察、S 套件判定、A 分析、G 缺口、N 不适用。

## 1. 支持声明

| 项 | 内容 |
|---|---|
| 规范 | RFC 9000（传输）、RFC 9001（TLS）、RFC 9002（丢包检测与拥塞控制）；RFC 8999 不变式（版本协商）；RFC 9221 不可靠数据报；RFC 8899 DPLPMTUD；RFC 9287 QUIC 位 GREASE；ACK Frequency（draft-ietf-quic-ack-frequency-04） |
| 版本 | QUIC v1，及 draft 29–34（`DEFAULT_SUPPORTED_VERSIONS`） |
| 角色 | 客户端与服务端 |
| TLS | TLS 1.3，经 OpenSSL 4.0.2 的第三方 QUIC TLS 接口（openssl-kotlin 的原始绑定），会话层由本库实现（SPEC §4、§11.9）；套件 AES-128-GCM、AES-256-GCM、ChaCha20-Poly1305 |
| 拥塞控制 | Cubic（默认）、NewReno；BBR（实验性，与参考一致） |
| 明确不支持 | QUIC v2（RFC 9369）；多路径；服务端 0.5-RTT 数据（OpenSSL 在客户端 Finished 之后才给出服务端的 1-RTT 读秘密）；客户端迁移到服务端首选地址（只保存其连接 ID）；qlog（延后）；流量控制窗口自动调节（参考实现也没有） |
| 与参考的偏离 | 保留握手期间先于密钥到达的包（参考丢弃，SPEC §11.15）；每个 PATH_CHALLENGE 都回应（参考只回最新一个，RFC 9000 §8.2.2 要求逐个回显，SPEC §11.18）；0-RTT 的 ALPN 不一致时只恢复会话、不发早期数据（SPEC §11.14）；完整列表见 SPEC 中的 ⚖️ |
| 安全默认 | 没有隐式信任库，客户端必须给出信任锚（`Certificates.system()` 显式取系统根）；无信任锚的模式只有 `dangerousNoServerVerificationForTestsOnly`；只开放 TLS 1.3 与上述三个套件 |
| 参考实现 | quinn 0.11.12 / quinn-proto 0.11.18 / quinn-udp（SPEC §0） |
| 平台（运行过测试） | macOS arm64（kqueue）；Linux x64（epoll、io_uring）；Windows x64（IOCP、WSAPoll）——均在 GitHub Actions CI |
| 平台（仅编译） | linuxArm64、macosX64、iOS（arm64 / 模拟器 / x64）、androidNative（arm64、x64） |

## 2. 资源上限

| 资源 | 默认 / 规则 | 超限行为 | 证据 |
|---|---|---|---|
| 未处理的连接尝试 | `maxIncoming`；缓存的 Initial / 0-RTT 受 `incomingBufferSize` 与 `incomingBufferSizeTotal` 限制 | 静默丢弃 | V：移植的 quinn 测试（`zeroRttIncomingBufferSize*`） |
| 收到而未被 TLS 取走的 CRYPTO 数据 | 每级别 64 KiB | CRYPTO_BUFFER_EXCEEDED | V：`TlsSessionTest.tooMuchUntakenCryptoDataIsCryptoBufferExceeded` |
| 待发送的握手字节 | 1 MiB | INTERNAL_ERROR | V：`recordStaysPinnedUntilReleasedAndQueuesAreBounded` |
| 并发流 | `maxConcurrentBidiStreams` / `Uni`（默认 100） | 对端超限为 STREAM_LIMIT_ERROR | V：移植的流数限制测试；模糊：`FuzzTest.streams` |
| 接收窗口 | 连接级 `receiveWindow`、流级 `streamReceiveWindow`（固定，无自动调节） | 对端超限为 FLOW_CONTROL_ERROR | V：移植的流量控制测试 |
| 数据报缓冲 | 接收溢出丢弃最旧；发送按 `drop` 选择挤掉或阻塞 | 见左 | V：移植的数据报测试 |
| 未验证路径的发送量 | 接收量的 3 倍（防放大） | 暂停发送 | V：移植测试；I：Interop Runner `amplificationlimit` |
| 空闲与关闭 | 空闲超时取双方较小值，实际计时 max(空闲, 3×PTO)；关闭计时 3×PTO | 进入 Drained | V：移植的空闲超时与关闭测试 |

## 3. 运行时契约

| 契约 | 证据 |
|---|---|
| 原生对象（SSL、StableRef、密钥上下文）恰好释放一次，失败路径同样释放 | V：`closeReleasesExactlyOnceAndIsIdempotent`、`manyHandshakesSucceedingAndFailingReturnToBaseline`（30 轮，三分之二失败）、`RealTlsDriverTest.manyConnectCloseCyclesReturnToBaseline`（40 次 UDP 建连 / 关闭）、`failedHandshakesReleaseSessionsAndKeys`（SPEC §11.6、§11.9） |
| 回调中的异常不穿过 C 边界 | V：`aFailingCallbackNeitherCrashesNorLeaks`（8 个回调逐一注入） |
| OpenSSL 错误队列在调用之间隔离 | V：`staleOpenSslErrorsDoNotLeakIntoAHandshake` |
| 流作为 `IoStream`：取消的读不丢数据、取消的写恰好推进被接受的字节、关闭的语义 | V：`QuicStreamTest`（neton-io 的 `IoStream` 一致性套件，SPEC §3） |
| 丢包、乱序、复制、黑洞下的恢复与有界完成 | V：`LossyPairTest`（协议层，虚拟时间）、`LossyDriverTest` / `LossyDriverChaosTest`（真实 UDP 经 `LossyRelay`），1% / 5% / 20% 丢包、握手包定向丢失、50 个随机种子等（SPEC §11.10） |
| 同一反应器上的公平性 | V：`FairnessTest`（延迟界限在高负载宿主上可能超出，SPEC §11.11 记录了测量） |
| 驱动层预算（每轮接收 / 发送上限） | V：`DriverBudgetTest` |
| 跨层组合：HTTP/3 → QUIC | 见 http3 的支持声明（待建）；msgtrans 会话 → QUIC：`msgtrans-quic` 的 `QuicTransportTest` 与对 msgtrans-rust 的互通 |

## 4. 证据索引

| 能力 | 级别 | 证据 |
|---|---|---|
| varint、帧、包、传输参数的编解码 | V | 移植的 quinn-proto 模块内测试（SPEC §5）；`FuzzTest` 的 packet / params / streamid / frames / streams 目标（确定性种子，含往返检查） |
| 包保护、头部保护、密钥派生与 Retry 完整性 | V | `CryptoTest`：RFC 9001 附录 A 全部五节的公开样例、draft-29 附录 A、版本到盐的映射 |
| 握手（真实 TLS）与密钥逐级产出 | V、I | V：`TlsSessionTest`（35）、`RealTlsConnectionTest`（22）、`RealTlsDriverTest`；I：quinn-peer 双向（SPEC §11.9）、Interop Runner `handshake` |
| 证书与主机名 / IP 验证、客户端认证 | V、I | V：`untrustedCaIsUnknownCa`、`hostnameMismatchFailsVerification`、`expiredServerCertificate`、`ipAddressServerNamesUseIpSans`、`clientAuth*`（SPEC §11.9 表）；I：quinn-peer 3a、4 |
| ALPN 与 no_application_protocol（120） | V、I | V：`alpn*` 测试；I：quinn-peer 3b |
| 密钥更新 | V、I | V：`key_update_simple`、`key_update_reordered`、双方交替 12 次；I：quinn-peer 每次流后双方各发起一次（16 次切换）、Interop Runner `keyupdate`（客户端） |
| 会话恢复与 0-RTT（含拒绝、重放） | V、I | V：`zeroRttIsAcceptedOnReconnect`、`aReplayedTicketGetsItsZeroRttRejected`、`zeroRttCanBeTurnedOffOnEitherSide`、`DriverTest.zeroRtt`（SPEC §11.14）；I：quinn-peer 双向接受 0-RTT、Interop Runner `resumption` / `zerortt` |
| 服务端识别早期数据 | V | `RealTlsDriverTest.earlyDataIsVisibleToAServerThatAwaitsTheHandshake`（SPEC §11.18） |
| Retry 与地址验证令牌 | V、I | V：移植的 `tests/token.rs`（7）与 Retry 测试；I：Interop Runner `retry` |
| 版本协商、无状态重置 | V | `ConnectionTest.versionNegotiateServer` / `versionNegotiateClient`、`serverStatelessReset` / `clientStatelessReset` / `statelessResetLimit`；`PacketTest.versionNegotiationRoundTrip` |
| 丢包检测、PTO、持续拥塞、拥塞控制 | V、I | V：移植测试与 §3 的损伤测试；I：Interop Runner `transferloss`、`blackhole` |
| 握手阶段的丢包与报文损坏 | V、**G** | V：SPEC §11.17 修正的三个缺陷及其回归测试；**G：Interop Runner `handshakeloss` / `handshakecorruption` 在不同轮次时过时不过，原因未明（SPEC §11.18）** |
| 路径验证、服务端接受迁移、NAT 重绑定 | V、I | V：`ConnectionTest.migration`、`ConnectionRecoveryTest.migrateDetectsNewMtuAndRespectsOriginalPeerMaxUdpPayloadSize`、`PathsTest.pathResponses`（两个挑战都得到回应）；I：Interop Runner `rebind-port`、`rebind-addr`（含 ngtcp2 服务端） |
| 客户端换套接字（重绑定） | V | `DriverTest.rebindRecv`（真实套接字，移植自 quinn） |
| 客户端迁移到服务端首选地址 | N | 支持声明：不支持；Interop Runner `connectionmigration` 以 127 退出 |
| 防放大 | V、I | V：移植测试；I：Interop Runner `amplificationlimit` |
| ECN | V、I | V：移植测试与 neton-io `UdpTest` 中的 ECN 用例；I：Interop Runner `ecn` |
| DPLPMTUD（含黑洞检测） | V | 移植的 `mtud` 测试（28）与 MTUD 场景 |
| 流、流量控制、优先级与公平 | V | 移植的 `streams/state` 测试（24）等；`FuzzTest.streams`（quinn 的 streams 模糊目标） |
| 数据报（RFC 9221） | V | 移植的数据报测试 |
| ACK 策略与 ACK Frequency | V | 移植的 `spaces` 测试与 ACK Frequency 场景 |
| GSO 批量 | V | `ConnectionRecoveryTest.streamGso`、`datagramGso`、`gsoTruncation`、`padToMtu`（移植自 quinn） |
| 系统信任库 | V | `SystemRootsTest`（macOS 157 个根；Linux、Windows 由 CI 打印） |
| 与 HTTP/3 组合时的 QUIC 层行为 | S | h3spec 的 QUIC 服务端 34 项通过（http3 SPEC），其中 `CRYPTO in 0-RTT` 因当时不支持 0-RTT 被跳过——**G：0.2.0 已支持 0-RTT，需重跑以真正检验** |
| 性能（对照 quinn） | **G** | 未做（SPEC §6） |
| RFC 条款清单（逐条 MUST / SHOULD） | **G** | 尚未建立；上表按能力而非按条款组织 |

## 5. 外部套件与互通记录

**QUIC Interop Runner**（GitHub Actions，`.github/workflows/interop-runner.yml`；runner 固定提交 740c05a；本库支持 19 个用例，`http3`、`v2`、
`connectionmigration` 以 127 退出）。最近一次记入 SPEC 的结果（SPEC §11.18，提交 261c780，服务端 / 客户端）：

| 组合 | 结果 | 未通过的用例 |
|---|---|---|
| neton / neton | 19 / 19 | — |
| neton / quinn | 18 / 19 | handshakeloss |
| quinn / neton | 19 / 19 | — |
| neton / quic-go | 18 / 18 | — |
| quic-go / neton | 17 / 18 | handshakecorruption |
| neton / ngtcp2 | 19 / 19 | — |
| ngtcp2 / neton | 19 / 20 | connectionmigration（客户端以 127 退出，runner 记为失败） |

- 该轮之后合入了 PATH_RESPONSE 的修正（SPEC §11.18），**此后的 runner 结果尚未记入 SPEC**：需要从最新的 CI 产物刷新本表（G）。
- 握手阶段的两个用例在三轮之间时过时不过，按 [工程标准 §6](../standards.md#_6-失败的处理) 视为缺陷，进入路线图。

**quinn-peer 互通**（`interop/quinn-peer`，CI 中 Linux epoll 与 io_uring 各一次）：握手与证书验证、ALPN、双向流回显、双方各自发起的密钥更新、
双方票据的 0-RTT、应用关闭、拒绝的情形（不受信任的 CA、ALPN 不符），11 项。

**测试规模**：macOS 上两种 TLS 模式（替身与真实 TLS）各 619 个通过（SPEC §11.18）；CI 中 Linux、Windows 的数目以作业摘要为准。

## 6. 缺口（进入路线图）

1. 查明 Interop Runner `handshakeloss` / `handshakecorruption` 时过时不过的原因；刷新 runner 结果表。
2. 重跑 h3spec，使 `CRYPTO in 0-RTT` 得到真正检验。
3. 建立 RFC 9000 / 9001 / 9002 的条款清单，先做高风险条款（[工程标准 §4](../standards.md#_4-条款清单)）。
4. 与 quinn 的性能对照（SPEC §6：批量吞吐、每字节 CPU、每包分配、p99、公平性）。
5. 覆盖率引导的模糊测试（目前为确定性种子）；cinterop shim 的 ASan / UBSan。
6. 客户端迁移到首选地址、QUIC v2、qlog：按需求单独立项，不作为 1.0 的前提。
