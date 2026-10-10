# http3 — 支持声明与证据索引

> 坐标 `com.netonstream:http3`，包 `neton.http.h3`；仓库 `netonframework/http3`（互通对端与脚本在 `http3-interop/`，不发布）。
> 本文基于发布版本 **0.2.0**（2026-10-08，Kotlin 2.4.0 构建，依赖 `http` 0.2.0、`quic` 0.2.0）及其后的主干（之后改为 Kotlin 2.4.20 并增加了
> 模糊测试，协议代码未改）。实现记录在仓库的 `SPEC.md`，下文以"SPEC §x"引用；SPEC §4 是按阶段（A–D、发布准备、0-RTT）排列的实施记录。
> 证据级别见 [工程标准 §3](../standards.md#_3-证据分级)：V 已验证、I 互通观察、S 套件判定、A 分析、G 缺口、N 不适用。

## 1. 支持声明

| 项 | 内容 |
|---|---|
| 规范 | RFC 9114（HTTP/3）；RFC 9204（QPACK），只实现静态表与字面量，通告动态表容量为 0；霍夫曼按 RFC 7541 §5.2 严格校验填充与 EOS |
| 角色 | 客户端与服务端；无代理 / 中间件语义 |
| 传输 | `com.netonstream:quic` 上 ALPN 为 "h3" 的连接（`neton.quic.Connection.asH3()`，h3-quinn 的角色）；协议核心在 commonMain，只依赖 `com.netonstream:http` 与一层薄 QUIC 接口（SPEC §1、§4 阶段 B / C） |
| 扩展 | GREASE（保留帧、保留设置、保留类型的单向流），默认开启（`sendGrease`）；0-RTT 上的请求与服务端 `RequestStream.isEarlyData()`（0.2.0 起，SPEC §4 0-RTT） |
| 明确不支持 | 服务端推送（PUSH_PROMISE 只解析；服务端收到推送流 → H3_STREAM_CREATION_ERROR，客户端 → H3_ID_ERROR）；动态 QPACK；WebTransport；HTTP Datagram（RFC 9297）；扩展 CONNECT（`:protocol` → H3_MESSAGE_ERROR）；1xx 响应。SPEC 只记为"首版范围（2026-09-29 评审确定）"，**未写各项不做的理由**（见 §6） |
| 与 RFC 的取舍 | 客户端 0-RTT 时按默认设置而非记住的服务端设置发送（RFC 9114 §7.2.4.2 允许；服务端设置不随会话变化）；被拒的 0-RTT 由应用在同一 QUIC 连接上新建客户端重发；425 Too Early 由应用依据 `isEarlyData()` 决定，库不自动回复（SPEC §4 0-RTT） |
| 与参考的偏离 | GOAWAY 按 RFC 9114 §5.2 拒绝 ID **大于或等于** GOAWAY ID 的请求（参考为 `>`）；请求流读到帧头即以 H3_FRAME_UNEXPECTED 拒绝控制流专用帧（参考先解码负载）；关键流被对端 STOP_SENDING 即 H3_CLOSED_CRITICAL_STREAM；QPACK 编码器 / 解码器流照常读取并校验；GREASE 帧紧跟首个消息头而非 FIN 之前（为与 aioquic 1.2.0 互通）；第一个连接错误立即关闭 QUIC 连接；头部的三种上限（下节）；完整列表见 SPEC 中的 ⚖️ |
| 安全默认 | 比参考多四项头部校验：重复伪头部、普通字段之后的伪头部、连接相关字段、content-length（并与 DATA 总长核对），均为 H3_MESSAGE_ERROR；Required Insert Count 非 0 或 Base 为负即 QPACK_DECOMPRESSION_FAILED；TLS 无隐式信任库，客户端须给出信任锚（README、`ALPN_H3` 的 KDoc） |
| 参考实现 | h3 0.0.8 + h3-quinn 0.0.9（quinn 0.11.12 / quinn-proto 0.11.18，SPEC §4 阶段 D）；SPEC 未记录 h3 的提交号 |
| 平台（运行过测试） | macOS arm64（kqueue）、Linux x64（epoll）、Windows x64（IOCP、WSAPoll）——GitHub Actions CI（`.github/workflows/ci.yml`）；Linux x64 io_uring 只在阶段 C / D 的手工运行中（SPEC §4），不在 CI |
| 平台（仅编译） | linuxArm64、macosX64、iOS（arm64 / 模拟器 / x64）、androidNative（arm64、x64）；无 32 位 Android（quic 不提供） |

## 2. 资源上限

| 资源 | 默认 / 规则 | 超限行为 | 证据 |
|---|---|---|---|
| HEADERS / PUSH_PROMISE 帧负载 | `maxHeadersFrameSize` 64 KiB | 读到帧头即拒绝，不读负载；服务端回 431，控制流上为 H3_FRAME_UNEXPECTED | V：`FrameTest.headersLongerThanTheLimitAreRejectedFromTheFrameHeader`、`hugeDeclaredHeadersLengthIsRejectedWithoutOverflow`、`ConnectionLayerTest.oversizedHeadersFrameGets431FromItsFrameHeader`、`oversizedHeadersOnControlStreamIsFrameUnexpected` |
| 解码后字段段大小 | `maxFieldSectionSize` 64 KiB（名 + 值 + 32），经 SETTINGS_MAX_FIELD_SECTION_SIZE 通告 | 逐行累加，超出即停止解码；服务端 431，客户端 `HeaderTooBig` | V：`CodecTest.sizeLimitStopsAtTheFirstLinePastIt`、`RequestTest.header_too_big_*`（8 个） |
| 字段个数 | `maxFieldCount` 100 | 解码该行之前检查；服务端 431，连接继续 | V：`CodecTest.countLimitIsCheckedBeforeDecodingTheLine`、`ConnectionLayerTest.tooManyFieldsGets431AndConnectionContinues`、`EndToEndTest.too_many_fields_gets_431_and_connection_continues` |
| 发送头部 | 对端 SETTINGS_MAX_FIELD_SECTION_SIZE | `HeaderTooBig`，不发送 | V：`RequestTest.header_too_big_client_error*` / `header_too_big_server_error*` |
| SETTINGS | 负载 16 KiB（`MAX_SETTINGS_PAYLOAD`），至多 8 项 | H3_EXCESSIVE_LOAD / H3_SETTINGS_ERROR | V：`FrameTest.settingsLongerThanTheCapAreRejected`、`settingsInsertLimits` |
| 未知帧与 DATA | 不缓存：未知帧按到达逐段丢弃，DATA 到达即交出 | — | V：`FrameTest.unknownFramesAreSkippedAsTheyArriveWithoutBuffering`、`FrameStreamTest.largeDataPayloadIsStreamedNotBuffered` |
| QPACK 动态表 | 容量 0 | 对端插入或设容量 > 0 → QPACK_ENCODER_STREAM_ERROR；增量为 0 或任何 Section Acknowledgment → QPACK_DECODER_STREAM_ERROR | V：`ConnectionLayerTest.encoderStreamInsertionIsEncoderStreamError`、`encoderStreamCapacityAboveMaximumIsEncoderStreamError`、`zeroInsertCountIncrementIsDecoderStreamError`；S：h3spec 对应两项 |
| 并发请求 | 由 QUIC 的并发双向流上限决定（默认 100）；服务端须 `close()` 请求流才释放额度 | 第 101 个请求等待 MAX_STREAMS | V：`EndToEndTest.many_concurrent_requests_on_one_connection`（300 个，峰值恰为 100）、`request_streams_hold_their_quic_streams_until_closed` |
| 消息体缓冲 | 由 QUIC 流接收窗口背压 | 写方挂起 | V：`EndToEndTest.large_bodies_with_backpressure`（8 MiB，窗口 64 KiB，停在 32 KiB） |
| 时间上限 | 本库没有请求 / 头部超时，只依赖 QUIC 空闲超时 | — | V：`RequestTest.get_timeout_*`、`post_timeout_server_recv_data`（QUIC 空闲超时传播）；**G：慢速发送头部或消息体的对端只受空闲超时约束，未定义上限** |

## 3. 运行时契约

| 契约 | 证据 |
|---|---|
| 服务端 `RequestStream.close()`（或 `use {}`）即 h3 的 `Drop`：释放 QUIC 流与流额度 | V：`EndToEndTest.request_streams_hold_their_quic_streams_until_closed`（真实 TLS 与替身各一份，SPEC §4 阶段 D 修复 2） |
| 客户端 `sendRequest` 在返回句柄前拥有已打开的流：失败或取消时复位发送半边、停止接收半边；`openBi` 挂起后再查 GOAWAY | V：`ClientOwnershipTest.cancelledHeadersReleaseBothStreamHalves`、`goawayDuringOpenDoesNotSendNewRequest`（REVIEW-2026-09-29） |
| 取消只影响该请求 | V：`ConnectionLayerTest.clientCancellationIsIsolated`、`serverCancellationIsIsolated`、`EndToEndTest.request_cancellation_is_isolated` |
| 一条被阻塞的请求流不阻塞其他请求与控制流 | V：`ConnectionLayerTest.blockedRequestStreamDoesNotBlockOthers`、`blockedRequestBodyDoesNotBlockOthers` |
| 关闭与错误传播：HTTP/3 层关闭、QUIC 端点关闭、第一个连接错误为准 | V：`EndToEndTest.connection_close_propagates`、`endpoint_close_propagates`；`ConnectionTest` 的 `server_drop_close`、`client_close_only_on_last_sender_drop` |
| 连接与流在所属反应器上、不加锁（SPEC §2 并发模型） | **G**：只有设计记录，没有跨线程调用的测试或审查记录 |
| 跨层组合：HTTP/3 → QUIC → TLS → UDP → 反应器 | V：`ConnectionTest` / `RequestTest` / `ConnectionLayerTest` 的 `…QuicTls` 子类与 `EndToEndTestTls`（真实 TLS 1.3、回环 UDP），同一套场景另有 `…Memory`、`…Quic`（TLS 替身）；**G：回环不丢包，丢包 / 乱序下的 HTTP/3 行为未测**（quic 的 `LossyRelay` 未用于本库） |
| 长时间运行、资源不增长 | **G**：未测 |

## 4. 证据索引

| 能力 | 级别 | 证据 |
|---|---|---|
| varint、帧、SETTINGS 编解码 | V | `FrameTest`、`FrameStreamTest`（含 `everyByteBoundaryGivesTheSameFrames`）、`VarIntTest`；模糊：`VarIntFuzzTest`（参考语料 116 个 + 固定种子 20,000 个）、`FuzzTest.frames` |
| 单向流类型与流头 | V | `StreamTest`、`FuzzTest.streamTypes`；`ConnectionLayerTest.unknownStreamTypeIsStopped`、`secondEncoderStreamIsStreamCreationError`、`ConnectionTest.two_control_streams` |
| QPACK 静态表、字面量、霍夫曼 | V | `PrefixIntTest`、`PrefixStringTest`、`StaticTableTest`、`BlockTest`、`CodecTest`（含 `rfc9204AppendixB1LiteralWithNameReference`、`seededRoundTrips`）；模糊：`FuzzTest.qpackSections` |
| QPACK 编码器 / 解码器流校验 | V、S | V：`QpackStreamsTest`、§2 中的三个连接层测试；模糊：`FuzzTest.qpackEncoderStream`、`qpackDecoderStream`；S：h3spec 两项 |
| Required Insert Count / Base 校验 | V | `CodecTest.nonZeroRequiredInsertCountIsRefusedEvenWithoutDynamicLines`、`dynamicReferencesAreDecompressionFailures`、`negativeBaseIsRejectedEvenWithoutDynamicReferences` |
| 控制流规则（首帧 SETTINGS、重复、不允许的帧） | V、S | V：`ConnectionTest.missing_settings`、`control_stream_frame_unexpected`、`ConnectionLayerTest.unknownFrameBeforeSettingsIsRejectedWithoutWaitingForPayload`、`secondSettingsIsFrameUnexpected` 等；S：h3spec HTTP/3 服务端项 |
| 关键流关闭（H3_CLOSED_CRITICAL_STREAM） | V | `ConnectionLayerTest` 的 `encoderStreamFinishedIsCriticalClosure`、`decoderStreamResetIsCriticalClosure`、`controlStreamResetIsCriticalClosure`、`stopSendingOnLocalControlStreamIsCriticalClosure`、`serverControlStreamClosedOnClient` |
| 请求流帧序（含请求流上的控制帧） | V、S | V：`RequestTest.request_valid_*` / `request_invalid_*`（移植自 h3）、`request_malformed_control_frame_is_unexpected`、`request_malformed_cancel_push_first_is_unexpected`、`FrameStreamTest.requestStreamRejectsControlFramesFromTheHeader`；S：h3spec（首次 48 / 49 即此项，修复后通过，SPEC §4 阶段 D） |
| 头部校验与 content-length | V、S | V：`HeadersTest.duplicatePseudoHeadersAreMalformed`、`pseudoHeaderAfterARegularFieldIsMalformed`、`connectionSpecificFieldsAreMalformed`、`contentLengthMustBeANumberAndConsistent`；`ConnectionLayerTest.contentLengthMismatchIsMessageError`、`contentLengthExceededIsMessageError`、`pseudoHeaderInTrailersIsMessageError`、`discardingBodyRejectsExcessBeforePeerFinishes`；S：h3spec 重复伪头部 |
| 请求 / 响应、流式消息体、trailer | V、I | V：`RequestTest.get` / `post` / `get_with_trailers_*`、`EndToEndTest.post_streaming_body_both_ways`、`trailers_both_ways`；I：h3-peer 双向（POST 回显、16 MiB、双向 trailer）、aioquic（不含 trailer） |
| GOAWAY 与优雅关闭 | V、I | V：`ConnectionLayerTest.goawayIdIsFirstRejectedStreamAndBoundaryIsRejected`、`shutdownBeforeAnyRequestRejectsStreamZero`、`increasingGoawayIsIdError*`、`EndToEndTest.goaway_graceful_shutdown`、移植的 `graceful_shutdown_*`；I：h3-peer 双向的服务端 GOAWAY 与客户端 GOAWAY |
| GREASE | V、I | V：`serverGreaseFrameFollowsTheResponseHeadNotTheEnd`、`clientGreaseFrameFollowsTheRequestHeadNotTheEnd`（三种传输）；I：h3 与 aioquic 在 GREASE 开启时双向通过（调整位置之后） |
| 推送（拒绝） | V（拒绝）、N | V：`pushStreamFromClientIsStreamCreationError`、`pushStreamWithoutMaxPushIdIsIdErrorOnClient`、`maxPushIdAndCancelPushIgnoredByServer`；推送本身不支持 |
| ALPN "h3" 与证书验证 | V、I | V：`EndToEndTest.alpn_mismatch_fails_the_handshake`、`EndToEndTestTls.untrusted_server_certificate_fails_the_handshake`（CRYPTO_ERROR 0x130）；I：h3 示例客户端只信任另一 CA 时报 UnknownIssuer，本库客户端对 h3-peer 同样失败 |
| 0-RTT 请求与 `isEarlyData()` | V、**G** | V：`ZeroRttTest.requestInZeroRtt`、`rejectedZeroRttIsRetriedOnTheSameConnection`（真实 TLS）；**G：没有与外部实现的 0-RTT 互通；h3spec `CRYPTO in 0-RTT` 未真正检验（见 §5）** |
| 与 HTTP/3 组合时的 QUIC 层行为 | S、**G** | S：h3spec QUIC 服务端 34 项中的 33 项；**G：`CRYPTO in 0-RTT` 当时 quic 不做 0-RTT，h3spec 提示跳过却判通过；quic 0.2.0 已支持 0-RTT，需重跑** |
| 丢包、乱序下的 HTTP/3 | **G** | 未测（SPEC §4 阶段 D 的限制） |
| 性能（对照 h3） | **G** | 未做；`http-bench` 没有 HTTP/3 程序 |
| RFC 条款清单（RFC 9114 / 9204 逐条） | **G** | 尚未建立；上表按能力组织 |

## 5. 外部套件与互通记录

**h3spec v0.1.13**（Linux 二进制，SHA-256 3664209a…e255；`./h3spec-linux-x86_64 127.0.0.1 24940 -n -t 3000`，本库服务端默认配置、GREASE 开、
不跳过用例；`-n` 为不校验证书）：**49 / 49，连续 3 次**（SPEC §4 阶段 D，2026-09-29，153 Rocky 9.8，quic 0.1.0-SNAPSHOT 提交 138fcc9；GREASE
位置调整后复验仍为 49 / 49）。其中 QUIC 服务端 34 项、HTTP/3 服务端 15 项；参考跳过的五项（请求流上的 CANCEL_PUSH、重复伪头部、动态表容量
超限、Insert Count Increment 为 0、missing_extension 告警）均通过（SPEC §3 表）。

- 按 [工程标准 §3](../standards.md#_3-证据分级)，**`CRYPTO in 0-RTT` 记为 G 而非 S**：h3spec 同时提示 "0-RTT is not possible. Skipping this
  test"。可记为 S 的是 48 项。
- 首次运行为 48 / 49（请求流上的 CANCEL_PUSH 回了 H3_FRAME_ERROR），已修复并以回归测试锁定（§4 表"请求流帧序"）。
- 该结果基于 2026-09-29 的代码与 quic 快照；**0.1.0 / 0.2.0 发布后未在发布版本上重跑**，套件与命令也未进入 CI。

**互通**（`http3-interop/`：`h3interop`、`h3-peer`、`run-interop.sh`、`run-interop-aioquic.sh`；SPEC §4 阶段 D，2026-09-29，同一台 Linux x64
宿主的本机回环，真实 TLS 1.3）：

| 方向 | 对端 | 结果 |
|---|---|---|
| 本库客户端 → h3 `examples/server.rs` | h3 0.0.8 + h3-quinn 0.0.9 | 通过：GET、404、16 MiB 逐字节核对、100 并发 + 50 顺序、POST、关闭 |
| h3 `examples/client.rs` → 本库服务端 | 同上 | 通过：`GET /`、16 MiB（cmp 一致）、404；只信任另一 CA 时按预期失败 |
| 本库客户端 ↔ h3-peer（双向） | 同上 | 各 9 / 9 |
| 本库客户端 → aioquic `http3_server.py` | aioquic 1.2.0 | 7 / 7（basic 场景，无 trailer、GOAWAY） |
| aioquic `http3_client.py` → 本库服务端 | aioquic 1.2.0 | 首轮 GREASE 开启时**不通过**（每条连接第一个响应等不到结束）；归因于 aioquic 丢失紧贴 FIN 的保留帧之后的流结束，交叉验证：它对 h3-peer 同样挂起。GREASE 位置调整（⚖️）后复验三项通过；关闭 GREASE 亦通过 |

- 互通只在单一组合上运行（Linux x64、回环、无丢包），**驱动未记录**；按 [工程标准 §5](../standards.md#_5-外部一致性套件与互通) 不外推到
  其他平台与驱动。
- 互通基于发布前的代码；0-RTT 与 `isEarlyData()`（0.2.0）没有互通记录。
- 未做（G）：quiche、curl `--http3`（当时宿主无 cmake 与 C++ 编译器）、QUIC Interop Runner 的 `http3` 用例（quic 的 runner 镜像中该用例以
  127 退出）。

**CI**：`ci.yml` 在 macOS kqueue、Linux epoll、Windows IOCP / WSAPoll 上运行 `:http3` 全量测试。主干提交 f131946（2026-10-09）的四个作业
全部通过；**发布提交 407fbe8（标签 v0.2.0）的 CI 失败**：依赖解析报 `Could not find com.netonstream:http:0.2.0`（推送时依赖尚未在
Maven Central 可见），测试未运行。发布产物以 Kotlin 2.4.0 构建，其后首个通过的 CI（a7bb065）已是 Kotlin 2.4.20。

**测试规模**：SPEC 最后记录为 macOS 506 个全部通过（SPEC §4 0-RTT，以 `--include-build ../quic` 验证）；其后加入的 `FuzzTest`（5 个目标）
尚未记入 SPEC。CI 中各平台的数目以作业摘要为准。

## 6. 缺口（进入路线图）

1. 在 quic 0.2.0 上重跑 h3spec，使 `CRYPTO in 0-RTT` 得到真正检验；h3spec 与互通脚本进入 GitHub Actions，按发布版本重跑并记录驱动。
2. 与 quiche、curl `--http3` 互通；QUIC Interop Runner 的 `http3` 用例；0-RTT 的外部互通。
3. 丢包 / 乱序 / 复制下的 HTTP/3（复用 quic 的 `LossyRelay`），以及长时间运行的资源不增长测试。
4. 头部与消息体的时间上限（慢速对端），定义默认值、配置项与超限行为。
5. 补写"明确不支持"各项（推送、动态 QPACK、WebTransport、HTTP Datagram、扩展 CONNECT、1xx）不做的理由；README 的 "Not in v1: 0-RTT"
   与 0.2.0 已支持 0-RTT 矛盾，需更正。
6. 发布可追溯：v0.2.0 标签没有通过的 CI 运行（[工程标准 §12](../standards.md#_12-可追溯发布)）；记录 h3 参考源码的提交号。
7. 建立 RFC 9114 / 9204 的条款清单，先做高风险条款（[工程标准 §4](../standards.md#_4-条款清单)）。
8. 与 h3 的性能对照；覆盖率引导的模糊测试（目前为确定性种子）；`FuzzTest` 记入 SPEC。
