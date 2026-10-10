# websocket — 支持声明与证据索引

> 坐标 `com.netonstream:websocket`，包 `neton.websocket`；仓库 `netonframework/websocket`。
> 本文基于发布版本 **0.2.0**（2026-10-08，标签 `v0.2.0` / d239cb1，Kotlin 2.4.0）及推送到主干的 4bbce02（2026-10-09：只把构建升到 Kotlin 2.4.20，
> 源码与 0.2.0 相同）。本地另有未推送的 1735bc5（入站准入与数据丢弃，见 §3），未经 CI，不计入下文的证据。
> 实现记录在仓库的 `SPEC.md`，下文以"SPEC §x"引用。证据级别见 [工程标准 §3](../standards.md#_3-证据分级)：V 已验证、I 互通观察、S 套件判定、
> A 分析、G 缺口、N 不适用。

## 1. 支持声明

| 项 | 内容 |
|---|---|
| 规范 | RFC 6455（WebSocket 协议，`Sec-WebSocket-Version: 13`）；RFC 7692 permessage-deflate（四个参数，SPEC §11.7） |
| 角色 | 客户端与服务端；另有"由 HTTP 服务端 / 客户端 Upgrade 后接管"的入口 `WebSocket.fromUpgraded`、`fromRawStream`（SPEC §1、§11.3） |
| 握手 | 基于 `com.netonstream:http` 0.2.0 的类型（`neton.http` 的 Request / Response / HeaderMap）与 HTTP/1.1 头部解析（SPEC §1、§11.2） |
| 扩展 | permessage-deflate：**默认关闭**，`WebSocketConfig(compression = PerMessageDeflateConfig())` 时客户端提议、服务端接受；8 位窗口只能用于解压（zlib 不能以 8 位窗口压缩原始 DEFLATE，SPEC §11.7）。不支持其他扩展 |
| TLS | 不在本库：`wss` 由调用方传入 `TlsConnector`（`Client.kt`），未提供时为 `UrlError.TlsNotAvailable`；`com.netonstream:tls-websocket` 提供 `WssConnector` |
| 明确不支持 | HTTP / SOCKS 代理（参考同样没有，SPEC §0；当前不做的理由未写明）；同步 `connect` 跟随重定向（`maxRedirects` 默认 0，与参考的异步版一致）；JVM 目标（只有原生目标） |
| 与 RFC 的偏离 | 无已知偏离。比参考更贴近 RFC 的：64 位长度最高位为 1 时拒绝（RFC 6455 §5.2）、未请求的扩展被拒绝（§4.1）、发送侧的控制帧与关闭原因长度校验（SPEC §4.1、§4.3、§11.2） |
| 与参考的偏离 | `Connection` 头按 token 列表判断；超长控制帧在读负载前拒绝；`maxWriteBufferSize` 默认有界；`feed` 满时挂起、`trySend` 返回 false；协议错误时由库结束连接；掩码用平台 CSPRNG；增量解析握手等，完整列表见 SPEC 中的 ⚖️（§2–§6、§11.1–§11.3、§11.7） |
| 安全默认 | 握手防攻击上限（`HandshakeLimits`：头部 ≤ 65536 字节、读取 ≤ 512 次、64 次后平均 ≥ 128 字节）、头部 ≤ 124 个；服务端默认拒绝未掩码帧；出站写缓冲有界；协议错误默认不发关闭帧（`sendCloseOnProtocolError = false`，与参考一致） |
| 参考实现 | tungstenite 0.30.0（提交 7f4aeaf）、tokio-tungstenite 0.30.0（提交 4994a07）；permessage-deflate 参考没有实现，依据 RFC 7692 |
| 平台（运行过测试） | macOS arm64（kqueue）；Linux x64（epoll、io_uring）；Windows x64（IOCP、WSAPoll）——GitHub Actions CI，`.github/workflows/ci.yml` |
| 平台（仅编译） | linuxArm64、macosX64、iOS（arm64 / 模拟器 / x64）、androidNative（arm64、arm32、x64、x86）：0.2.0 的本地暂存仓库含这 12 个目标的产物（个人机器构建），CI 不编译它们 |

## 2. 资源上限

| 资源 | 默认 / 规则 | 超限行为 | 证据 |
|---|---|---|---|
| 握手头部 | `HandshakeLimits`（同参考，可配置）；头部个数 124 | `AttackAttempt`；`TooManyHeaders` | V：`MachineTest`（`attackCheckMaxBytes`、`attackCheckMaxPackets`、`attackCheckAverageAfterThreshold`、`slowlorisIsAnAttack`、`oversizedHeadIsAnAttack`）、`HeadersTest.headerLimit`、`HandshakeDeviationTest.handshakeLimitsAreConfigurable` |
| 入站帧 | `maxFrameSize` 16 MiB（`null` 为不限），读负载之前比较 | `MessageTooLong` | V：`WebSocketCoreTest.frameSizeCheckedBeforePayload`、`FrameSocketTest.sizeLimitHit`、`parseOverflow`、`lengthAboveUsizeMaxRejected` |
| 入站消息 | `maxMessageSize` 64 MiB（`null` 为不限），分片累计 | `MessageTooLong` | V：`ProtocolTest.sizeLimitingTextFragmented` / `sizeLimitingBinary`、`WebSocketCoreTest.fragmentedSizeLimitCountsAllFragments` |
| 控制帧 | 负载 ≤ 125，头部解析后即检查 | `ControlFrameTooBig` | V：`DeviationTest.oversizedControlFrameRejectedBeforePayload` |
| 解压输出 | 每块解压输出计入 `maxMessageSize` | `MessageTooLong` | V：`PerMessageDeflateTest.aDecompressionBombStopsAtTheMessageLimit`（64 MiB 零压成约 64 KiB，在 1 MiB 上限处失败） |
| 读缓冲 | `readBufferSize` 128 KiB，也是单次读取上限 | — | V：`ReadBufferTest`（移植）；≤ 32 KiB 的负载复制出读缓冲、更大的为切片（`PAYLOAD_COPY_LIMIT`，SPEC §11.5）：A，无专门测试 |
| 出站缓冲 | `writeBufferSize` 128 KiB；`maxWriteBufferSize` 默认其 4 倍（512 KiB）；单帧超过上限时只在缓冲为空时接受 | `feed` / `send` 挂起（背压）；`trySend` 返回 false | V：`DeviationTest.maxWriteBufferSizeDefault`、`writeBufferFullAndLargeMessages`、`DriverTest.trySendReportsAFullBuffer`、`WebSocketCoreTest.setConfigReappliesLimits` |
| 待发回复 | 回复槽位至多一个（新 Pong 覆盖旧 Pong，Close 优先） | 覆盖 | V：`WebSocketCoreTest.pingFloodKeepsOnlyLatestPong`、`closeReplyIsNotReplacedByPong`、`DriverTest.pingFloodWhilePeerDoesNotRead` |
| 压缩状态 | 压缩器约 256 KiB、解压器约 44 KiB，首次使用时分配，连接终止时释放（GC cleaner 兜底） | — | A：SPEC §11.7；释放无测试 |
| 失败时的最终 flush | 至多 1 s（`FINAL_FLUSH_MILLIS`） | 放弃写出 | A：`WebSocket.kt`；S：Autobahn 7.1.2–7.1.5（SPEC §11.4） |
| 握手、空闲、关闭握手的时间上限 | **库内没有**；客户端等待 TCP EOF 无超时，由调用方以 `withTimeout` 等限定 | — | **G**：[工程标准 §7.2](../standards.md#_7-2-资源有界) 要求的时间上限未提供，也无测试 |
| 连接数 | 不在本库（监听由 io 的 `serveTcp` 等负责） | — | N |

## 3. 运行时契约

| 契约 | 证据 |
|---|---|
| 写驱动独占写方向；读侧从不等待写出，对端不读时读侧仍推进 | V：`DriverTest.pingFloodWhilePeerDoesNotRead`、`closeTakesPriorityWhilePeerDoesNotRead`；移植的 `AutoPongFlushTest`（SPEC §5、§11.3） |
| 取消 `receive`：已读字节不丢 | V：`DriverTest.cancelledReceiveKeepsTheBytesRead`（帧的每个切分位置） |
| 取消 `feed` / `send`：接受前取消则不入队；接受后取消不影响写出、不出现半帧后接新帧 | V：`cancelledFeedQueuesNothing`、`cancelledSendAtEveryBytePosition`（单字节管道 `memoryStreamPair(capacity = 1)`） |
| 流在任意字节位置出错：连接终止、此后读写抛 `AlreadyClosed`，对端只收到前缀 | V：`DriverTest.streamErrorAtEveryBytePosition` |
| 同一时刻至多一个 `receive` 与一个写；`split` 的两半可由两个协程使用 | V：`oneReceiveAtATime`、`splitHalvesInTwoCoroutines`、`CommunicationTest.splitCommunication*` |
| 关闭状态机：TIME_WAIT 不对称、重置视为正常关闭、关闭后写为 `SendAfterClosing`、`close` 幂等 | V：`WebSocketCoreTest.serverTerminatesOnceReplyIsWrittenOut`、`clientWaitsForEof`、`resetAfterPeerCloseIsNormal`、`sendAfterClosingAndCloseIsIdempotent`、`DriverTest.writeErrorAfterPeerCloseIsNormalEnd`；移植的 `ConnectionResetTest`、`DriverIntegrationTest`（内存流与 TCP，含 `SO_LINGER 0` 的"恶意"服务端） |
| 流的所有权：握手失败时流归调用方，成功后归 `WebSocket` 并在结束时关闭；`abort` 结束等待中的操作 | V：`HandshakeFlowTest.eofDuringHandshake`、`junkAfterRequestOverAStream`、`DriverTest.abortEndsWaitingOperations`；所有权划分本身为 A（SPEC §11.2、§11.3） |
| 线程：连接对象只在所属反应器上使用 | A：SPEC §6 约定，无跨线程误用的检测或测试 |
| 跨层组合：wss → tls → TCP | tls 仓库的 `WssConnectorTest`（`wssEchoes`、`anUntrustedServerIsRefused`、`theDefaultContextUsesTheSystemRoots`）；取消与背压经 TLS 的组合测试：**G** |
| 跨层组合：msgtrans 会话 → WebSocket | `msgtrans-websocket` 的 `WebSocketTransportTest`、`InteropTest` 与对 msgtrans-rust 2.0.0-beta.2 的 ws / wss 互通（见 [releases](../releases.md)：发版提交 68921a3 的一次互通失败未解释） |

本地未推送的 1735bc5 新增 `setInboundAdmission` / `discardData` 及 `InboundAdmissionTest`（3 个）。推送并经 CI 之前，不计为证据。

## 4. 证据索引

Autobahn|Testsuite 的定级：它向本库发送真实字节、观察本库在线上的反应，检验的是实际行为；但按 [工程标准 §3](../standards.md#_3-证据分级)，它的
判定（OK / NON-STRICT）记为 **S**，因为判定标准由套件定义、本库的测试没有逐条断言同样的行为。某项能力若另有本库测试断言了具体字节、状态或
错误，则记 V，Autobahn 作为补充列出。INFORMATIONAL（无判定）与 UNIMPLEMENTED（未执行）不记为 S。

| 能力 | 级别 | 证据 |
|---|---|---|
| 帧头编解码（FIN / RSV / opcode / 7、16、64 位长度、不全时不消费、保留 opcode） | V、S | V：`FrameTest`（9，含 `lengthWithTopBitSetRejected`、`nonMinimalLengthAccepted`、`reservedOpcodeRejectedInHeader`）、`FrameSocketTest`（8）、`CodingTest`（6）；S：Autobahn 1.x–4.x |
| 掩码（客户端每帧随机掩码、服务端去掩码、方向错误的掩码被拒） | V | `MaskTest`（`wordMaskMatchesFallbackAtEveryOffsetAndLength`：偏移 0–7）、`WebSocketCoreTest.clientMasksEveryFrameServerDoesNot`、`FrameSocketTest.unmasksMaskedFramesAndAcceptsUnmasked`、`WebSocketCoreTest.validationOrderAndErrors` |
| 帧校验顺序（RSV、控制帧分片、意外续帧、关闭后收帧） | V、S | V：`WebSocketCoreTest.validationOrderAndErrors`、`receivedAfterClosing`、`controlFramesBetweenFragments`；S：Autobahn 5.x、7.x |
| 分片与重组 | V、S | V：`WebSocketCoreTest.rawFramesForFragmentation`、`fragmentedTextWithCodePointSplitAcrossFrames`；S：Autobahn 5.x |
| 文本消息的 UTF-8 校验（增量、跨帧） | V、S | V：`Utf8Test`（`validatorAcrossEverySplit`、`validatorFindsBadByteAtEveryPosition`）、`fragmentedTextInvalidIsUtf8ErrorNotProtocol`；S：Autobahn 6.x，其中 6.4.3 / 6.4.4 为 NON-STRICT（整帧到达后才判定，粒度同参考，SPEC §4.2） |
| 控制帧：Ping / Pong 自动回复、负载 ≤ 125 | V、S | V：`autoPongSharesPingPayload`、`userPongReplacesAutoPong`、`DeviationTest.sendSideLimits`；S：Autobahn 2.x |
| 关闭握手、关闭码与原因 | V、S | V：`closePayloadRules`、`disallowedCloseCodeEchoedAsProtocolViolation`、`readsContinueAfterOurCloseUntilPeerCloses`、`CodingTest.closecodeRangesAndIsAllowed`；S：Autobahn 7.x（7.1.6、7.13.1、7.13.2 为 INFORMATIONAL，不记 S） |
| 握手：客户端请求生成与响应校验、子协议 | V | `ClientHandshakeTest`（8）、`HandshakeChecksTest`（19）、`HandshakeFlowTest`（24，内存流与 TCP）、`HandshakeTest`（RFC 6455 的 Accept 向量、SHA-1 与 base64 向量） |
| 握手：服务端校验顺序、非法 key、回调 | V | `ServerHandshakeTest`（7）、`HandshakeChecksTest.createResponseChecksInOrder` / `callback*`、`junkAfterRequest` |
| 与参考的有意偏离 | V | `DeviationTest`（7）、`HandshakeDeviationTest`（12）：每个 ⚖️ 一个以上 |
| HTTP Upgrade 接管 | V | `UpgradeTest`（9，http 服务端 / 客户端，内存流与 TCP） |
| `wss` 未提供 TLS 时的错误；经 `TlsConnector` 建连 | V | `HandshakeFlowTest.wssUrlFailsWhenNoTlsSupport`、`HandshakeDeviationTest.wssUsesTheTlsConnector` |
| permessage-deflate：RFC 7692 §7.2.3 字节样例、上下文接管、BFINAL、空消息 | V、S | V：`PerMessageDeflateTest`（29：`aCompressedHelloIsTheRfcBytes`、`theSecondHelloUsesTheFirstAsContext`、`aBlockWithBfinalIsRead`、`anEmptyMessageIsOneZeroByte` 等）；S：Autobahn 12.x、13.x 开压缩时 216 项 OK |
| permessage-deflate：协商与参数校验、RSV1 规则、非法数据 | V | `theServerDeclinesWhatItCannotDo`、`theServerTakesTheFirstAcceptableOffer`、`theClientRejectsAnAnswerOutsideItsOffer`、`rsv1OnAControlFrameIsAnError`、`rsv1OnAContinuationIsAnError`、`rsv1WithoutTheExtensionIsAnError`、`invalidCompressedDataIsAnError` |
| 解析器的模糊测试 | V（部分） | `FuzzTest`：tungstenite 的三个目标 `parse_frame_header`、`read_message_client`、`read_message_server`，确定性种子（SPEC §11.6）。带参考语料（15 / 564 / 244 个种子）的运行只在 macOS arm64 本机做过；**CI 中没有语料，只跑 2000 个随机输入**（4bbce02 的 CI 输出 "no corpus"）。握手解析与 permessage-deflate 协商没有模糊目标：**G** |
| 性能（对照 tokio-tungstenite） | 测量（单一场景）、**G** | SPEC §11.5：64 字节二进制回显、50 连接闭环、服务端绑 1 核；吞吐持平（130.5k / 131.7k 对 129.8k / 131.1k 条/s），GC 线程 nice 19 时 149.3k / 146.7k；p99.9 高于参考（1.4 ms 对约 0.8 ms）。测于 2026-09-28 的 0.1.0 之前代码、共享宿主、未附负载记录；**其他消息大小、文本 / 分片、扇出、大量连接、压缩均未对照** |
| RFC 条款清单（逐条 MUST / SHOULD） | **G** | 尚未建立；上表按能力而非按条款组织 |

## 5. 外部套件与互通记录

**Autobahn|Testsuite**（GitHub Actions `ubuntu-latest`，Docker 运行 `crossbario/autobahn-testsuite`，镜像未固定版本（`:latest`），
4bbce02 的运行中报告为 Testsuite 25.10.1；驱动为 `websocket-bench` 的 `autobahnServer` / `autobahnClient`，`bench/autobahn/run.sh`
遇到任何意外结果即非零退出；只在 Linux x64 epoll 上运行）。最近一次：run 37874049255（4bbce02，2026-10-09，与 0.2.0 源码相同）：

| 方向 | 压缩 | 行为 | 关闭行为 |
|---|---|---|---|
| 服务端、客户端 | 关闭 | OK 296、NON-STRICT 2、INFORMATIONAL 3、UNIMPLEMENTED 216 | OK 514、INFORMATIONAL 3 |
| 服务端、客户端 | permessage-deflate | OK 512、NON-STRICT 2、INFORMATIONAL 3 | OK 514、INFORMATIONAL 3 |

- 两个方向各 517 个用例，无失败。NON-STRICT 为 6.4.3、6.4.4，INFORMATIONAL 为 7.1.6、7.13.1、7.13.2（取自 CI 产物的 `index.json`）。
  不开压缩时的结果与参考的 `autobahn/expected-results.json`（OK 296、UNIMPLEMENTED 216、NON-STRICT 2、INFORMATIONAL 3）在计数上一致；
  `run.sh` 只检查"无失败"，不逐项与参考比较。
- **首次失败**：开压缩的第一轮（run 37706619816，ci/permessage-deflate 分支）服务端方向在 12.2.9 中断、未生成报告，服务端日志无错误；
  此后重跑全部及单独 12.2.* 均通过，**原因未能确定**（SPEC §11.7）。按 [工程标准 §6](../standards.md#_6-失败的处理) 保留为未解释失败（G）。
- 早期在 153 上以 podman 运行过同样的结果（SPEC §11.4，2026-09-28）；153 已不再使用。

**CI 测试**（`ci.yml`，5 个组合）。run 37874049255：macOS kqueue、Linux epoll、Linux io_uring、Windows IOCP、Windows WSAPoll 各 247 个测试，
无失败、无跳过（计数取自 CI 产物的测试结果 XML）。README 写的 "218 tests" 是加入 permessage-deflate 之前的数字（SPEC §11.6），已过时。

**发版提交的 CI**：0.2.0 的 d239cb1 上，run 37746288390（main）与 37746288236（`v0.2.0`）失败，原因是依赖（io 0.3.2、http 0.2.0）当时尚未
在 Maven Central 上线，测试与 Autobahn 都没有运行（[releases](../releases.md)）。之后：
- 前一提交 f4283f5（io 0.3.1、http 0.1.2，源码与 0.2.0 相同）的 run 37732589029 全部通过；
- 后一提交 4bbce02（io 0.3.2、http 0.2.0，与 0.2.0 的依赖相同，只升到 Kotlin 2.4.20）的 run 37874049255 全部通过（上文）。
- 因此**以 Kotlin 2.4.0 构建、与 0.2.0 完全相同的配置从未在 CI 上运行过**；最接近的是 4bbce02。

**Windows IOCP 的已修复失败**：run 37706619816、37708751460、37710927315、37713152219 中 `DriverIntegrationTest.testNoSendAfterCloseTcp`
失败（IOCP 以 WSAECONNABORTED 结束读，io 0.3.0 只把 WSAECONNRESET 视为重置）。io 的修正 b9a425e 包含在 io-v0.3.1 起的版本中，此后该测试在
IOCP 上通过，该测试即回归锁定（SPEC §11.7）。

**互通**：本库自身没有对其他 WebSocket 实现的互通脚本（Autobahn 之外）。msgtrans-websocket 对 msgtrans-rust 的 ws / wss 互通经过本库，
记录在 msgtrans 的支持声明中。

## 6. 缺口（进入路线图）

1. 时间上限：握手、空闲、关闭握手（客户端等待 EOF）在库内都没有超时，需决定由库提供还是在支持声明中明确交给调用方，并补测试（§7.2）。
2. 查明开压缩时 Autobahn 服务端方向在 12.2.9 中断的原因（run 37706619816）。
3. 固定 Autobahn 镜像版本（目前为 `:latest`），并把 Autobahn 扩展到 io_uring、macOS、Windows 等驱动（目前只在 Linux epoll）。
4. CI 中的模糊测试带上参考语料；为握手解析与 permessage-deflate 协商增加模糊目标；覆盖率引导的模糊测试；zlib 路径的 ASan / UBSan。
5. 建立 RFC 6455 / RFC 7692 的条款清单，先做高风险条款（[工程标准 §4](../standards.md#_4-条款清单)）。
6. 性能：在受控环境重测（附负载记录），补上其他消息大小、文本 / 分片、扇出、大量连接、压缩的对照；查明 p99.9 高于参考的原因。
7. 组合：wss 经 TLS 的取消与背压测试；压缩状态释放的测试。
8. 文档同步：README 的测试数（218 → 247）；SPEC 头部的状态行与 §0、§7 仍写着"permessage-deflate 未实现""首个发布版本 0.1.0""运行环境 153"。
9. 1735bc5（入站准入、数据丢弃）推送并经 CI 后，补入 §2、§3，并记入下一版本的行为变更。
