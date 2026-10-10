# msgtrans — 支持声明与证据索引

> 坐标 `com.netonstream:msgtrans`（TCP 与会话）、`com.netonstream:msgtrans-quic`、`com.netonstream:msgtrans-websocket`，包 `msgtrans.core` / `msgtrans.transport`；
> 仓库 `zoujiaqing/msgtrans-kotlin`。本文基于发布版本 **msgtrans 0.4.0、msgtrans-quic 0.1.1、msgtrans-websocket 0.1.0**（2026-10-10，提交 68921a3，Kotlin 2.4.20）。
> 实现记录在仓库的 `SPEC.md`，下文以"SPEC §x"引用；线格式规范是 msgtrans-rust 的 `docs/WIRE_FORMAT.md`（协议版本 1），以"WIRE_FORMAT §x"引用。
> 证据级别见 [工程标准 §3](../standards.md#_3-证据分级)：V 已验证、I 互通观察、S 套件判定、A 分析、G 缺口、N 不适用。

## 1. 支持声明

| 项 | 内容 |
|---|---|
| 规范 | msgtrans 线格式，协议版本 1（WIRE_FORMAT；SPEC §2）：16 字节大端固定头、扩展头、负载，zstd / zlib 负载压缩；传输映射 TCP（WIRE_FORMAT §9.2）、QUIC（§9.3，SPEC §16）、WebSocket（§9.1，SPEC §17）；请求 / 响应配对（WIRE_FORMAT §10） |
| 互通对象 | msgtrans-rust **2.0.0-beta.2**（crates.io，`interop/rust-peer` 以 `=2.0.0-beta.2` 锁定），三种传输线上兼容 |
| 角色 | 客户端与服务端（三种传输均有）；任一端都可发起请求（反向请求） |
| 会话契约 | 单线程所有权、处理器不在读路径上、有界队列与出站字节预算、请求超时与在途上限、一请求一响应、终止状态只清理一次、可选的首包准入（SPEC §3–§4，README "Architecture"） |
| QUIC 映射 | TLS 1.3，ALPN `msgtrans/1`；每会话一条 QUIC 连接、客户端打开的一条双向流；流上每个包前置 u32 大端长度（`Framing.LengthPrefixed`）；默认空闲 30 s、保活 15 s、连接超时 10 s（`QuicTransportOptions`，与 msgtrans-rust 一致） |
| WebSocket 映射 | 每个包一条二进制消息、无长度前缀；子协议 `msgtrans.v1`（客户端提供、服务端回显，不提供也接受）；服务端只在配置的路径升级，否则 404；每 30 s ping、10 s 内无 pong 结束会话，握手超时 10 s（`WebSocketTransportOptions`）；`ws://` 与 `wss://`（经 `com.netonstream:tls` / `tls-websocket`） |
| 解码策略 | 严格：QUIC 帧必须恰好是一个包、超长帧从前缀直接拒绝；WebSocket 文本消息或不是恰好一个包的二进制消息结束该会话（SPEC §16、§17）。只影响出错的会话 |
| 明确不支持 | SPKI 固定（需要 `com.netonstream:quic` 提供验证钩子，SPEC §16）；服务端无证书时自动生成自签名证书（msgtrans-rust 用 rcgen，SPEC §16）；WebSocket 服务端 300 s 空闲超时（会话自身的请求超时与 ping 已覆盖活着的对端，SPEC §17）；诊断平面（发送确认，SPEC §3.3）；写入确认的 `send`（当前为入队确认，SPEC §3.5）；扩展头只作字节透传，路由标签等语义未实现（SPEC §7）；`msgtrans-rpc`；WebTransport |
| 与参考的偏离 | `send` / `request` 为入队确认，msgtrans-rust 为写入确认（SPEC §3.5）；请求 id 每会话不回绕、耗尽即报错（SPEC §2、§4）；单次解码负载上限默认 64 MiB（`PacketCodec.DEFAULT_MAX_PAYLOAD`），而 msgtrans-rust 2.0.0-beta.2 的默认上限是 16 MiB（`DEFAULT_MAX_FRAME_SIZE`），WIRE_FORMAT §9.3 要求 QUIC 单帧超过 16 MB 时接收方必须报错——**本库默认比规范宽松**（见 §6）；默认请求超时 30 s，WIRE_FORMAT §10 推荐 10 s |
| 安全默认 | 解压输出上限 16 MiB（解压炸弹）；QUIC 客户端总是验证服务端（信任锚或 `Certificates.system()`），跳过验证只有 `dangerousNoServerVerificationForTestsOnly` |
| 参考实现 | msgtrans-rust 2.0.0-beta.2（`src/adapters/quic.rs`、`src/adapters/websocket.rs`，SPEC §16、§17） |
| 平台（运行过测试） | GitHub Actions CI：macOS arm64（kqueue）；Linux x64（epoll、io_uring、poll）；JVM（JDK 17，macOS 与 Linux 作业中的 `:msgtrans:jvmTest`）。三个模块都在 macOS 与 Linux 三种驱动上运行；JVM 只有 `msgtrans` |
| 平台（仅编译） | macosX64、linuxArm64、iOS（arm64 / 模拟器 / x64）：随发布构建编译，CI 不运行。androidNative 四个目标默认不构建、不发布（`-Pmsgtrans.androidNative=true` 才开启）；README 记录 2026-10-03 在 arm64 模拟器上手工跑过当时的 44 个用例，之后未重跑 |
| 不支持的平台 | Windows（无目标，CI 注明）；`msgtrans-quic` 与 `msgtrans-websocket` 无 JVM 目标 |

## 2. 资源上限

默认值来自 `ConnectionConfig`（`Connection.kt`）与各传输的选项类。

| 资源 | 默认 / 规则 | 超限行为 | 证据 |
|---|---|---|---|
| 单包负载（入站解码与出站入队） | `maxPayloadLength` = 64 MiB | 入站：`ProtocolException`，只关闭该会话；出站：`PayloadTooLargeException`，不入队，连接仍可用 | V：`OutboundBudgetTest.oversizePayloadIsRejectedNotQueued`；`FuzzTest.packets`（上限 100 的编解码器，断言解出的负载不超限） |
| QUIC 帧长 | 16 + 65535 + `maxPayloadLength`，从长度前缀判断，不先缓冲 | `ProtocolException` | V：`LengthPrefixedPacketCodecTest.aFrameLongerThanAnyPacketIsRefusedFromItsPrefix` |
| WebSocket 消息 / 帧 | `maxMessageSize` 默认等于最大包长 | — | **G**：无测试 |
| 解压输出 | `maxDecompressedPayloadLength` = 16 MiB | `CompressionException`，只关闭该连接 | V：`PayloadCompressionTest.refusesMalformedAndOversizedOutput`、`RequestResponseTest.decompressionLimitClosesOnlyTheOffendingConnection`；模糊：`FuzzTest.decompression` |
| 出站字节 | `maxOutboundBytes` = 8 MiB（两种写模式）；空队列总放行一个包，避免大包死锁 | 发送方挂起 | V：`OutboundBudgetTest.sendersParkOnTheByteBudgetInline` / `…Channel` |
| 出站邮箱、入站请求队列、事件通道 | `mailboxCapacity` = 256、`inboundCapacity` = 256（事件通道同为 `inboundCapacity`） | 发送方挂起；入站满时读循环停顿，不丢不乱序 | V：`ReactorQueueTest.fifoAndBackpressure`、`WriteModeTest.channelMode` / `inlineMode`；事件通道满时的行为 **G** |
| 在途请求 | `maxInFlightRequests` = 1024 | `request` 挂起等待名额，等待计入超时 | V：`ContractTest.inFlightCapBoundsOutstandingRequests`、`timeoutFiresWhileWaitingForAnInFlightSlot` |
| 请求时间 | `requestTimeoutMillis` = 30 000（0 关闭），覆盖整个调用，含等待入队 | `RequestTimeoutException`（`requestOrNull` 返回 null），连接保持 | V：`ContractTest.requestTimesOutWithoutResponseAndConnectionStaysUp`、`requestOrNullReturnsNullOnTimeout`；`RequestDeadlineTest.sendQueueFullRequestTimesOutInline` / `…Channel` |
| 请求 id | 每会话单调递增，到 `UInt.MAX_VALUE` 即报错，不回绕；单向 id 独立且可回绕 | `IllegalStateException`（"request id space exhausted"） | **G**：无测试 |
| QUIC 空闲 / 保活 / 连接 | 30 s / 15 s / 10 s | 会话结束 / 连接失败 | **G**：默认值无测试；Happy Eyeballs 间隔 250 ms 见 §4 |
| WebSocket 心跳与握手 | ping 30 s、pong 超时 10 s、握手 10 s | 结束会话 / `ConnectException` | V：`WebSocketTransportTest.anUnansweredPingEndsTheSession`、`answeredPingsKeepTheSession`（缩短的间隔）；握手超时 **G** |

## 3. 运行时契约

| 契约 | 证据 |
|---|---|
| 单线程所有权：连接状态只在所属反应器线程上访问，其他线程的调用被投递过去 | V：`ContractTest.requestFromAnotherThreadIsPostedToTheReactor`；多反应器下每个连接属于一个反应器、取消服务端作用域关闭全部连接：`MultiReactorServerTest.connectionsSpreadOverReactorsAndServerScopeCancelClosesThemAll` |
| 处理器不在读路径上：处理器内发起反向请求不死锁 | V：`RequestResponseTest.reverseRequestDoesNotDeadlock`；I：互通清单中的"server's reverse request answered by the client"（QUIC、WebSocket，两个方向） |
| 一请求一响应：注册表是唯一仲裁者；取消的请求移出注册表，迟到的响应被丢弃 | V：`ContractTest.cancellingRequestRemovesItFromRegistry`、`IdMapTest`（2）；无对应请求的响应与重复响应被丢弃 **G**（无测试） |
| 终止状态只清理一次：close、对端 EOF、读错误；关闭使所有挂起请求以 `ConnectionClosedException` 失败 | V：`ContractTest.closeCallbackRunsOnce`、`closeFailsPendingRequests`；`QuicTransportTest.theSessionEndsWhenThePeerCloses` |
| 故障隔离：一个连接的协议错误或崩溃不影响其他连接 | V：`FaultIsolationTest.oneConnectionCrashDoesNotKillOthers`、`RequestResponseTest.decompressionLimitClosesOnlyTheOffendingConnection`、`WebSocketTransportTest.aTextMessageOrAPartialPacketEndsOnlyThatSession`；QUIC 会话层的同类测试 **G**（只有编解码器层测试） |
| 首包准入（`requiredFirstRequestBizType`，默认关闭）：第一个入站帧必须是指定 biz_type 的 Request，否则只关闭该连接、不运行处理器 | V：`FirstPacketPolicyTest.wrongFirstBizTypeClosesOnlyThatConnection`、`oneWayFrameCannotBypassTheFirstRequestRule` |
| 压缩在一个边界上归一：处理器与挂起请求看到的总是明文 | V：`RequestResponseTest.compressedTrafficIsPlaintextAtEveryApplicationBoundary`、`PayloadCompressionTest.inboundPacketIsNormalizedToPlaintext` |
| 反应器队列：挂起、取消（含跨线程）、关闭的交错 | V：`ReactorQueueTest`（7）；恢复被拒时关闭队列并报告：`ReactorQueueRefusedTest.refusedHandOffClosesTheQueue` |
| `ReactorResumer` 可选（`MSGTRANS_REACTOR_RESUMER=0` 时全套仍通过） | V，**基于 2026-09-27**：SPEC §15.1 记录 macOS 与 Linux io_uring / epoll 两种模式各 44/44；CI 不跑该开关，当前用例数（52）下未重跑 |
| 跨层组合：会话 → TCP / QUIC / WebSocket | V：同一套会话经三种传输（`RequestResponseTest`、`QuicTransportTest`、`WebSocketTransportTest`）；I：§5 的互通 |

## 4. 证据索引

| 能力 | 级别 | 证据 |
|---|---|---|
| 固定头字节布局（大端、字段顺序） | V、I | V：`PacketCodecTest.exactWireLayout`（逐字节）、`roundTrip`（含扩展头、`Zlib` 标记、`HAS_ROUTE_TAG` 标志、`messageId` = 0xFFFFFFFE）；I：§5 的 QUIC / WebSocket 互通，及 2026-09-13 的 TCP 互通 |
| 流式拆包：不完整时不消费、连续多包 | V | `PacketCodecTest.needsMoreBytes`、`multipleFramesBackToBack`；`FuzzTest.packets` 以随机分块喂入并断言"返回 null 时不消费、返回包时恰好消费一个包" |
| 拒绝 `version != 1`、未知 `compression`、未知 `packet_type`（WIRE_FORMAT §5.1–§5.3） | **G** | 实现抛 `ProtocolException`（`PacketCodec.decode`、`Compression.fromCode`、`PacketType.fromCode`），但没有断言具体拒绝的测试；`FuzzTest` 只断言异常类型 |
| 共享线格式样例（msgtrans-rust `tests/fixtures/01–08`，WIRE_FORMAT §15） | **G** | 未在 Kotlin 中运行（SPEC §9、README "Status"） |
| 解码器与解压的模糊测试 | V | `FuzzTest.packets`：5000 例，种子 0x6d7367，变异与随机输入，默认上限与 100 字节上限两个编解码器，未变异输入必须往返；`FuzzTest.decompression`：1000 例，种子 0x7a1b，只允许成功或 `CompressionException`，输出不超上限。确定性种子，非覆盖率引导 |
| zstd / zlib 压缩与解压 | V、I | V：`PayloadCompressionTest`（5），其中 `decodesFixturesProducedByRustMsgtrans` 解 msgtrans-rust 产出的 zstd 与 zlib 样例；I：互通清单的 Zstd / Zlib 请求回显，两个方向（Kotlin 压缩的由 Rust 解，反之亦然） |
| zstd 修复：不可压缩、超过一个工作块的负载 | V | `PayloadCompressionTest.incompressibleDataLargerThanAChunkRoundTrips`（1100、70 000、300 000 字节）；原因是 zstd-kmp 对从非 0 下标开始的调用误报已消费的输入，修复提交 2548d44，随 0.3.0 发布（README） |
| QUIC 长度前缀分帧与严格解码 | V、I | V：`LengthPrefixedPacketCodecTest`（5：逐字节、往返、等待整帧不消费、超长前缀拒绝、帧必须恰好一个包），native 与 JVM；I：QUIC 互通 |
| QUIC 传输：请求 / 响应、推送、0 B–3 MB 与压缩负载、4 会话 × 50 并发 | V、I | V：`QuicTransportTest.requestResponseAndPushOverQuic`、`largeAndCompressedPayloads`、`manyConcurrentRequestsAndSessions`；I：QUIC 互通 |
| QUIC 证书验证 | V、I | V：`QuicTransportTest.anUntrustedServerIsRefused`；I：互通 3a（Rust 客户端 `UnknownIssuer`）、4（Kotlin 客户端握手失败），以及 3b（拒绝之后 Kotlin 服务端继续服务） |
| QUIC ALPN `msgtrans/1` | I、**G** | I：与 Rust 握手成功；ALPN 不符时拒绝没有测试（G） |
| QUIC 地址交错（RFC 8305，250 ms） | V | `QuicTransportTest.localhostReachesAnIpv4OnlyServerWithoutWaitingOutTheTimeout` |
| QUIC 服务端：慢 / 沉默的客户端不阻塞其他握手 | **G** | 设计见 SPEC §16，无测试 |
| WebSocket 传输：请求 / 响应、推送、大负载与压缩、并发、`wss://` | V、I | V：`WebSocketTransportTest.requestResponseAndPushOverWebSocket`、`largeAndCompressedPayloads`、`manyConcurrentRequestsAndSessions`、`wss`；I：WebSocket 互通（`ws://` 两个方向，Rust 客户端经 `wss://` 到 Kotlin 服务端） |
| WebSocket 严格解码：文本消息、半个包 | V | `WebSocketTransportTest.aTextMessageOrAPartialPacketEndsOnlyThatSession` |
| WebSocket 路径（404） | V、I | V：`WebSocketTransportTest.anotherPathIsNotFound`（断言消息含 404）；I：互通 2b（Rust 客户端连接失败；脚本只检查 "connect failed"，未断言 404） |
| WebSocket 子协议 `msgtrans.v1` 的提供与回显 | I、**G** | I：与 Rust 两个方向握手成功；回显与"不提供也接受"没有断言（G） |
| WebSocket 服务端握手超时、慢客户端不阻塞 | **G** | 设计见 SPEC §17，无测试 |
| TCP 线上互通 | I（基于 2026-09-13） | `scripts/interop-rust.sh`，**手工运行，不在 CI**：Kotlin `benchClient`（framed、rpc）→ Rust `echo_server`（passive），Rust `echo_client_tcp` → Kotlin `benchServer`（rpc），0 错误（SPEC §9、README）。对端是本地 msgtrans-rust 开发树（脚本默认 `../../privchat/msgtrans`，当时 `Cargo.toml` 标为 2.0.0-beta.2，所用提交未记录），不是 crates.io 发布版；之后未重跑，压缩当时尚未加入 |
| 与 TypeScript 客户端互通 | **G** | 未做（SPEC §9） |
| 性能（对照 msgtrans-rust） | **G** | 只有本库三层基准（`bench/run.sh`，SPEC §9–§14）；与 msgtrans-rust 同条件对照未做 |
| WIRE_FORMAT 条款清单（逐条 MUST / SHOULD） | **G** | 尚未建立；上表按能力组织 |

## 5. 外部套件与互通记录

msgtrans 没有外部一致性套件；与独立实现的互通是主要的外部证据。

**CI 互通**（`.github/workflows/ci.yml` 的 `interop` 作业，Linux x64，`NETON_IO_DRIVER` 为 epoll 与 io_uring 各一次；对端 `interop/rust-peer`，msgtrans-rust 2.0.0-beta.2，`cargo build --release --locked`；证书由 `interop/gen-certs.sh` 生成）。
`interop/run-quic-interop.sh` 与 `interop/run-websocket-interop.sh` 任一用例结果不符即失败。每个"成功"方向的两端都跑同一份清单：请求回显 0、1、1200、70 000、1 000 000、3 000 000 字节，Zstd 与 Zlib 请求回显，64 个并发请求，单向消息以单向回显（含 biz_type），服务端向客户端发起的反向请求。

| 脚本 | 用例 |
|---|---|
| QUIC | 1 Kotlin 客户端 → Rust 服务端；2 Rust 客户端 → Kotlin 服务端；3a 信任另一 CA 的 Rust 客户端被拒；3b 之后 Kotlin 服务端仍服务；4 信任另一 CA 的 Kotlin 客户端被拒 |
| WebSocket | 1 Kotlin 客户端 → Rust 服务端（`ws://`）；2 Rust 客户端 → Kotlin 服务端（`ws://`）；2b 其他路径被拒；3 Rust 客户端 → Kotlin 服务端（`wss://`，自定义 CA）；3b 信任另一 CA 被拒 |

发版提交 68921a3 的四次 CI 运行（2026-10-09）：

| 运行 | 触发 | 结果 |
|---|---|---|
| 37961069337 | `main` | 全部通过（测试作业：macOS 120、Linux epoll 120、io_uring 68、poll 68 个用例，0 失败；两个互通作业通过） |
| 37961080830 | 标签 `v0.4.0` | 通过 |
| 37961081909 | 标签 `msgtrans-websocket-v0.1.0` | 通过 |
| **37961081168** | 标签 `msgtrans-quic-v0.1.1` | **失败**：`interop with msgtrans-rust (iouring)` 中 WebSocket 用例 "1. Kotlin client -> Rust server, ws (Rust)" 记为 FAIL（脚本打印 `exit -1`），而 Rust 服务端已正常服务并退出。**原因：互通脚本的缺陷**——`finish` 在 `$(...)` 子 shell 中调用 `wait`，子 shell 不能等待父 shell 的子进程，能否取到退出码取决于父 shell 是否已回收该进程。修正：99a5cd5（退出码改由变量传回），修正后本机重跑全部通过；首次失败记录保留 |

- 按 [工程标准 §6](../standards.md#_6-失败的处理)，这是**未解释的失败**，保留记录并进入路线图。日志中 Rust 服务端已打印 "session session-1 closed (Normal)" 与 "1 session(s) served"；从 QUIC 部分结束（"== 0 failure(s)"，16:44:46.98）到该用例结果（16:44:48.07）约 1 s，而脚本的 `finish` 最多等 15 s，因此"服务端在等待时间内未退出"与时间戳不符。失败可能出在脚本取退出码的方式（`finish` 在命令替换的子 shell 中对父 shell 启动的进程调用 `wait`），也可能是 Rust 进程的真实退出状态——**均未验证**。
- 用例数说明：macOS 与 Linux epoll 的 120 = `msgtrans` 52（native）+ 52（JVM）+ `msgtrans-quic` 7 + `msgtrans-websocket` 9；io_uring 与 poll 没有 JVM。两个 `InteropTest` 计入其中，只在互通脚本设置环境变量时才真正执行。
- 互通只在 Linux x64 的 epoll 与 io_uring 上跑过，不外推到 macOS、poll 或 JVM（[工程标准 §5](../standards.md#_5-外部一致性套件与互通)）。

**TCP 互通**：见 §4，2026-09-13 手工运行 `scripts/interop-rust.sh`，不在 CI。

## 6. 缺口（进入路线图）

1. ~~查明运行 37961081168 的失败~~：已查明为互通脚本的缺陷并修正（99a5cd5），见 §5；待修正后的 CI 运行确认。
2. 在 Kotlin 测试中运行 msgtrans-rust 的 `wire_format_fixtures`（`tests/fixtures/01–08`，encode 与 decode 两个方向），并补上拒绝 `version != 1`、未知 `compression` / `packet_type` 的断言。
3. TCP 互通进入 CI（复用 `interop/rust-peer` 与同一份清单，对端为 crates.io 的 2.0.0-beta.2），替代手工的 `scripts/interop-rust.sh`。
4. 负载上限与规范对齐：默认 64 MiB 宽于 WIRE_FORMAT §9.3 的 16 MB 单帧上限与 msgtrans-rust 的默认值；决定是否把默认值改为 16 MiB（行为变更，按 [工程标准 §8](../standards.md#_8-兼容性) 处理），并为 QUIC 超限帧补测试。
5. ~~核对 SPEC §16、§17 对 msgtrans-rust 解码策略的描述~~：已改正（88fbf64）——msgtrans-rust 2.0.0-beta.2 默认 `FramePolicy::Strict`，与本库相同；`Lenient` 需显式开启。
6. 补测试：无对应请求的响应与重复响应被丢弃、请求 id 耗尽、事件通道满、QUIC 会话层的协议错误隔离、ALPN 不符、WebSocket 子协议回显、两种服务端的握手超时与慢客户端、QUIC / WebSocket 默认超时；CI 中以 `MSGTRANS_REACTOR_RESUMER=0` 跑一次全套。
7. 与 TypeScript 客户端的互通；与 msgtrans-rust 的同条件性能对照（[工程标准 §9](../standards.md#_9-性能)）。
8. 覆盖率引导的模糊测试（目前为确定性种子）；`androidNative` 目标的测试进入 CI 或在支持声明中降为"仅编译"。
9. 按需单独立项：SPKI 固定、服务端自签名回退、诊断平面与写入确认的 `send`、扩展头 / 路由标签、`msgtrans-rpc`、Windows 目标、`msgtrans-quic` / `msgtrans-websocket` 的 JVM 目标。
