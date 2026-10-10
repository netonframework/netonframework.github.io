# http — 支持声明与证据索引

> 坐标 `com.netonstream:http`，包 `neton.http`、`neton.http.h1`、`neton.http.h2`、`neton.http.auto`、`neton.http.client`；仓库 `netonframework/http`。
> 本文基于发布版本 **0.2.0**（2026-10-08，标签 `v0.2.0` / eb3a62e，Kotlin 2.4.0，依赖 `com.netonstream:io:0.3.2`）及其后的主干。主干此后
> 只改了构建与 CI（8a6f77d 改为 Kotlin 2.4.20，f624b44 加入 CI），`http/src` 没有变化；所以下文的 CI 结果是**同一份源码在 Kotlin 2.4.20 下**的结果，
> 不是对 2.4.0 发布产物的重跑。实现记录在仓库的 `SPEC.md`，下文以"SPEC §x"引用。
> 证据级别见 [工程标准 §3](../standards.md#_3-证据分级)：V 已验证、I 互通观察、S 套件判定、A 分析、G 缺口、N 不适用。

## 1. 支持声明

| 项 | 内容 |
|---|---|
| 规范依据 | 本库以复刻参考实现为方法（SPEC §0），没有逐条对照 RFC。HTTP/1.1 的消息边界另以 neton-io SPEC §28.7 的安全基线为准（SPEC §3.9）；代码注释引用 RFC 9110（语义）、RFC 9113（HTTP/2）、RFC 7541（HPACK）、RFC 8441（扩展 CONNECT）。**没有任何一份 RFC 的条款清单**（G） |
| 角色 | HTTP/1.1 服务端与客户端（hyper `conn::http1`）；HTTP/2 服务端与客户端（h2 + hyper 的 h2 接线）；同端口 HTTP/1 / HTTP/2 服务端（hyper-util `server::conn::auto`，按 24 字节前言或调用方给的 ALPN 结果选择，SPEC §4.5）；连接池客户端（hyper-util `client::legacy`，SPEC §11 "连接池客户端"） |
| 扩展与特性 | HTTP/1：流水线、`Expect: 100-continue`、Upgrade 与 CONNECT 隧道、trailer、可选 `Admission`（SPEC §3.5–§3.7）。HTTP/2：服务端推送（默认启用，同 h2）、扩展 CONNECT（`enableConnectProtocol`，默认关闭）、1xx、BDP 自适应窗口、keep-alive ping、可选 `settingsAckTimeout`（SPEC §4.3、§4.4） |
| 明确不支持 | TLS（由 `tls` / `tls-http` 提供，本库只接受 ALPN 字符串）；content-encoding 压缩（SPEC §0）；发送 PRIORITY（抛 `NotImplementedError`，同 h2 的 `unimplemented!`；RFC 9113 已弃用优先级方案，SPEC §4.1）；HTTP/1.1 `Upgrade: h2c` 升级到 HTTP/2（代码中没有 `HTTP2-Settings` 处理；RFC 9113 已弃用该机制），h2c 只支持 prior knowledge；hyper-util 的其余部分（`server::graceful`、运行时适配、`service` 工具，SPEC §7）；HTTP/3（独立仓库 `http3`） |
| 与参考的偏离 | 更严格的安全默认（下行与 SPEC §3.9）；HTTP/2 拆分头部块中的畸形头部等到 END_HEADERS 再重置，保持 HPACK 同步（SPEC §11 "HTTP/2：帧与编解码器"）；auto 不用包装流回放、接受 ALPN 输入、检测阶段有时限（SPEC §4.5）；连接池在有借出的 HTTP/1 连接时先让出至多 4 次再新建（SPEC §11 "连接池客户端"）；未被领取的 `Upgraded` 不会被自动关闭（Kotlin 无析构，SPEC §11 HTTP/1.1 连接层）；完整列表见 SPEC 中的 ⚖️ |
| 安全默认（比 hyper 严格，均可配置） | 同时带 Transfer-Encoding 与 Content-Length 的请求 → 400 并关闭（`lenientTeWithCl` 切回 hyper），响应一侧同样报错；单独的 LF 行结束被拒（`allowBareLf`）；请求行 8 KiB（414）；头部段 64 KiB（`maxHeaderSectionSize`，431）；请求体 10 MiB（`maxRequestBodySize`，413）；chunk 大小行 1 KiB、至多 16 位十六进制；trailer 8 KiB；头部读取 10 s、keep-alive 空闲 60 s（hyper 为合一的 30 s）。HTTP/2 服务端的 `handshakeTimeout` / `idleTimeout` / `bodyReadTimeout`（hyper 没有）**默认关闭**。全表见 SPEC §3.9 |
| 参考实现 | `http` 1.5.0、`httparse` 1.10.1、hyper 1.11.1、`h2` 0.4.19、hyper-util 0.1.20（只取 `server::conn::auto` 与 `client::legacy`）（SPEC §0）。提交号记在维护者本机的 `~/projects/reference/rust/README.md`，不在仓库内 |
| 平台（运行过测试） | GitHub Actions CI（`.github/workflows/ci.yml`，运行 37926037373，提交 f624b44，全部通过）：macOS arm64（kqueue）1,259 个；Linux x64 epoll 1,260 个、epoll + 回环 TCP 传输 1,260 个、io_uring 1,260 个；Windows x64 IOCP 1,259 个、WSAPoll 1,259 个。每个作业跳过 14 个，均为参考实现自身忽略的用例（`@Ignore` 处均有注释）。Linux 多出的 1 个是只在 `linuxTest` 中的 `UploadTest` |
| 平台（仅编译） | linuxArm64、macosX64、iOS（arm64 / 模拟器 / x64）、androidNative（arm64、arm32、x64、x86）；CI 作业 `compile (all targets)`。Linux arm64 的测试只在本机 Colima 中跑过（SPEC §11 2026-10-01 记录），不计入 |

**关于仓库中的 `http3` 目录**：`http3/` 与 `http3-interop/` 只含被 `.gitignore`（`build/`）忽略的旧构建输出，没有受版本控制的文件，也不在
`settings.gradle.kts` 中（只包含 `:http` 与 `:http-bench`）。它们是 HTTP/3 于 2026-09-29 迁到独立仓库（提交 25457c3）之前留下的，与本库无关。

## 2. 资源上限

| 资源 | 默认 / 规则 | 超限行为 | 证据 |
|---|---|---|---|
| HTTP/1 请求行 | 8 KiB | 414 并关闭 | V：`AcceptanceTest.overlongRequestLineIsRejected`；`HyperServerTest.http11UriTooLong`（放宽与默认两种断言） |
| HTTP/1 头部段 / 头部个数 / 读缓冲 | 64 KiB / 100 / `maxBufSize` 417,792 | 431 并关闭 | V：`overlongHeaderSectionIsRejected`、`tooManyHeadersAreRejected`、`HyperServerTest.maxBufSize*`、`headerNameTooLong` |
| HTTP/1 请求体 | `maxRequestBodySize` 10 MiB | 声明长度超限直接 413 并关闭；chunked 超限时读取方出错，服务失败后回 413 | V：`declaredBodyOverDefaultLimitIs413AndCloses`、`chunkedBodyOverTheLimitIs413WhenTheServicePropagates`、`ServerTest.declaredBodyOverLimitIs413` |
| chunk 大小行 / trailer | 1 KiB、≤ 16 位十六进制、扩展合计 16 KiB / 8 KiB | 请求体读取出错 | V：`chunkSizeOverSixteenDigitsFails`、`chunkSizeLineOverOneKibFails`、`bareLfInChunkedBodyFails`、`trailersOverEightKibFail`；`BodyBaselineTest`（20） |
| 上传期间的内存 | 一个读缓冲 + 一块数据 | — | V：`UploadTest.hundredMegabyteUploadIsStreamedInBoundedMemory`（100 MB，真实 TCP，RSS 增长 ≤ 16 MiB；只在 Linux 运行；SPEC 记录该断言只在单独运行时有判别力，全量运行中读数接近 0） |
| HTTP/1 时间 | 头部读取 10 s；keep-alive 空闲 60 s；请求体读取 `bodyReadTimeoutMillis` 默认关闭 | `HeaderTimeout` / 安静关闭 / 请求体读取以超时失败、服务可回 408 | V：`HyperServerTest.headerReadTimeout*`；`BodyReadTimeoutTest`（6）；空闲关闭只有间接证据：`ClientPoolTest.aConnectionTheServerClosedIsReplacedTransparently`（100 ms 空闲时限） |
| HTTP/2 并发流 | `maxConcurrentStreams` 200（hyper 层） | REFUSED_STREAM | V：h2 移植的 `serverBuilderSetMaxConcurrentStreams`、`explicitResetWithMaxConcurrentStream` 等 |
| HTTP/2 头部列表 | 16 KiB（hyper 层）；CONTINUATION 帧数 max(5, 上限 / 帧大小 × 1.25) | 431 后 REFUSED_STREAM；超过 4 倍或 CONTINUATION 洪泛 → GOAWAY ENHANCE_YOUR_CALM | V：`tooBigHeadersSends431`、`tooBigHeadersSendsResetAfter431IfNotEos`、`abusiveHeadersSendGoaway`、`tooManyContinuationFramesSendsGoaway`、`HeaderBlockRulesTest.overFourTimesTheLimitIsGoAwayEnhanceYourCalm`、`CodecRulesTest.continuationFloodIsEnhanceYourCalm` |
| HTTP/2 快速重置与本地重置 | 未接受即被重置的流 20（CVE-2023-44487）；本地重置流保留 1 s、至多 50；库发起的重置 1024 | GOAWAY ENHANCE_YOUR_CALM | V：`StreamStatesTest.resetStreamsDontGrowMemoryContinuously`、`pendingAcceptResetStreamsDecrementToo`、`rstStreamExpires`、`rstStreamMax`、`FlowControlTest.tooManyWindowUpdateResetsCausesGoAway` |
| HTTP/2 小 / 空 DATA 帧 | 小帧预算 max(连接窗口 / 2, 25600)；非结束的空 DATA 帧 100 个 | GOAWAY | V：`tooManySmallDataFramesSendsGoaway`、`tooManyEmptyDataFramesSendsGoaway`、`tooManyPaddedEmptyDataFramesSendsGoaway`；`ProtoModuleTest` 的预算单元测试 |
| HTTP/2 窗口与发送缓冲 | 连接 / 流接收窗口各 1 MiB；发送缓冲 400 KiB（服务端） | 对端超窗 → FLOW_CONTROL_ERROR | V：`recvDataOverflowsConnectionWindow`、`recvDataOverflowsStreamWindow`、`maxSendBufferSizeOverflow` |
| HTTP/2 请求体总量 | **无上限**（同 hyper；`maxRequestBodySize` 只用于 HTTP/1） | 只受流量控制约束 | 由代码确认（h2 / auto 中无此配置）；与 HTTP/1 的 10 MiB 默认不对称，未在支持范围内说明理由（G） |
| HTTP/2 时间 | `handshakeTimeout`、`idleTimeout`、`bodyReadTimeout`、`settingsAckTimeout` 均默认关闭 | 超时关闭 / 平滑关闭 / 请求体读取失败 / SETTINGS_TIMEOUT | V：`ServerTimeoutsTest`（8，真实 TCP）、`SettingsTimeoutTest`（3） |
| auto 协议检测 | 以 HTTP/1 的 `headerReadTimeoutMillis` 为时限 | `HeaderTimeout` 并关闭 | V：`AutoTest.detectionIsBoundedByTheHeaderReadTimeout`、`detectionTimeoutIsLiftedForHttp2` |
| 连接池 | `poolIdleTimeout` 90 s；`poolMaxIdlePerHost` 默认不限；**每主机或全局的连接总数无上限** | 过期连接被回收 | V：`ClientPoolTest.idleConnectionsExpire`、`maxIdlePerHostBoundsWhatIsKept`；连接总数无上限是设计如此（同 hyper-util），无测试 |

## 3. 运行时契约

| 契约 | 证据 |
|---|---|
| 客户端在交换进行中关闭：服务被取消、连接以 `IncompleteMessage` 结束；背压中的大响应写入随客户端关闭结束 | V：`ServerTest.clientCloseCancelsSlowService`；`DeferredWatchTest`（6，含 `responseWriteBlockedByAPeerThatStopsReadingEndsWhenItCloses`，SPEC 记录去掉接线时两例 5 s 超时作为反向对照） |
| 平滑关闭：空闲连接立即结束，进行中的交换完成后结束，检测阶段取消检测 | V：`HyperServerTest.gracefulShutdownBeforeFirstRequestNoBlock` 等、`IdleWatchShutdownTest`（2，修复前一例超时）、h2 `ServerTest.gracefulShutdown`、`AutoTest.gracefulShutdown*`（6） |
| 升级交接：读缓冲中未消费的字节先回放再接原流 | V：`ServerTest.upgradeAfterSuspendingServiceHandsOverEveryByte`、`AutoTest.http1UpgradeThroughAuto`、`HyperServerTest.upgrades*`；**未被领取的 `Upgraded` 不关闭（SPEC 记为 ⚖️），无契约测试（G）** |
| 准入许可：等待下一个请求时不持有，出错 / 关闭路径恰好释放一次 | V：`AdmissionTest`（2） |
| 拆分到达不改变结果 | V：`AcceptanceTest.everySplitPointGivesTheSameExchange`、`byteByByteArrivalGivesTheSameExchange`；`AutoTest.prefaceSplitByteByByteIsHttp2` |
| 两种传输：内存流与回环 TCP 都跑全量 | V：CI 的 `Linux epoll TCP` 作业（`NETON_HTTP_TEST_TRANSPORT=tcp`）。例外：h2 `mock.rs` 移植的约 190 个用例只用内存传输（SPEC §11 "双传输运行"给出理由）；TCP 模式只在 Linux epoll 上进 CI |
| 线程归属：HTTP/2 句柄跨线程使用时经反应器投递 | **G**：SPEC §4.4 写了投递规则，但 SPEC §11 记录"句柄须在连接的线程上使用，跨线程投递尚未实现"；连接池客户端同样只能在构建时给定的作用域上使用 |
| 高并发连接 | V：`HammerTest.hammerClientConcurrency`（5000 条 TCP 连接，移植自 h2） |
| 跨层组合：HTTPS → tls → TCP；auto 经真实 TLS 的 ALPN | V（在 tls 仓库）：`tls-http` 的 `HttpsConnectorTest` 以本库的 `AutoServerConfig().serveConnection(tls, tls.alpn, …)` 为服务端、连接池客户端加 `HttpsConnector` 为客户端，在真实 TLS 上断言每个响应的协议版本——`http2ByAlpnSharesOneConnection`（ALPN 选 h2，之后的请求共用一条连接）、`http1WhenTheServerOffersOnlyHttp1`；本库自己的测试以字符串代替 `TlsStream.alpn`（SPEC §11 的"未做"已由此覆盖，SPEC 尚未更新）。取消、背压与关闭经 TLS 的组合仍是 **G** |
| 长时间运行：内存、句柄、定时器不增长 | **G**：除 SPEC §11 中一次 60 s 单核满载的 RSS 观察外，没有浸泡测试 |

## 4. 证据索引

| 能力 | 级别 | 证据 |
|---|---|---|
| 通用类型（`HeaderName` / `HeaderValue` / `Method` / `StatusCode` / `Uri` / `Request` / `Response` / `Extensions`） | V | `http` crate 的测试与文档示例逐条移植（`HeaderNameTest`、`HeaderValueTest`、`MethodTest`、`StatusCodeTest`、`UriTest`、`AuthorityTest`、`PathAndQueryTest`、`UriDocExamplesTest` 等） |
| `HeaderMap` 与防哈希碰撞（Green → Yellow → Red，SipHash-1-3） | V | `HeaderMapTest`（105）、`HeaderMapFuzzTest.headerMapFuzz` / `headerMapFuzzRed`（模型对照）、`SipHashTest`（Rust 的 SipHash-1-3 向量） |
| HTTP/1 头部解析（httparse） | V | `HttpParseTest`、`HttpParseTableTest`、`HttpParseUriTest`（263 个 URI 用例）、`BareLfTest`、`ScanTest` / `ScanWordTest`（SWAR 与逐字节差分） |
| HTTP/1 消息边界、chunked 编解码 | V | `RoleTest`（36）、`BodyDecoderTest`、`BodyEncoderTest`、`BodyBaselineTest` |
| HTTP/1 服务端与客户端行为（keep-alive、流水线、100-continue、HEAD / 204 / 304、EOF、半关闭、trailer、升级与 CONNECT） | V、I | V：hyper `tests/server.rs` / `client.rs` / `integration.rs` 的移植（`HyperServerTest` 78、`HyperClientTest` 50、`HyperIntegrationTest` 13、`HyperH1StreamTest` 4），`ServerTest`、`ClientTest`；I：curl HTTP/1.x 14 项（§5） |
| 请求走私向量（SPEC §3.9 每行） | V | `AcceptanceTest`（21）：每个向量后紧跟一个走私请求，断言它既未到达服务也未出现在线上（`teWithClIsRejectedAndNothingIsSmuggled`、`conflictingContentLengthsAreRejected`、`contentLengthListIsRejected`、`bareLfIsRejected`、`bareCrIsRejected`、`obsFoldInRequestIsRejected`、`whitespaceBeforeColonIsRejected` 等）；响应一侧的 TE + CL：`RoleTest.testDecoderResponse` |
| HTTP/1.1 对 RFC 9112 的一致性 | **G** | 没有外部一致性套件；与其他解析器的差分测试也没有。现有证据只说明与 hyper / httparse 及安全基线一致 |
| HTTP/2 帧、编解码、头部块校验 | V | h2 的 `codec_read` / `codec_write` / `frame` 测试移植（`CodecReadTest`、`CodecWriteTest`、`FrameModuleTest`），另加规则测试（`FrameRulesTest` 53、`HeaderBlockRulesTest` 19、`CodecRulesTest` 22） |
| HPACK | V | `DecoderTest`、`EncoderTest`、`HuffmanTest`；`FixtureTest`：hpack-test-case 12 个实现目录 382 个故事、40,374 个用例往返，另加 `raw-data` 32 个故事（SPEC §11） |
| HTTP/2 流状态、流量控制、设置、GOAWAY、推送、1xx、trailer、ping | V、S | V：h2 `tests/h2-tests` 移植（`ClientRequestTest` 45、`FlowControlTest` 52、`ServerTest` 43、`StreamStatesTest` 34、`PushPromiseTest` 10、`PrioritizationTest` 7、`InformationalResponsesTest` 7、`PingPongTest` 5、`TrailersTest` 5）与 hyper 的 HTTP/2 用例（`HyperH2ServerTest` 19、`HyperH2ClientTest` 12、`HyperH2IntegrationTest` 14）、`TcpEndToEndTest`；S：h2spec（§5） |
| HTTP/2 对 RFC 9113 相对 RFC 7540 的变化 | **G** | h2spec 2.1.1 针对 RFC 7540 / 7541，不覆盖 RFC 9113 的变化；未逐条核对 |
| 扩展 CONNECT（RFC 8441）与 CONNECT 隧道 | V | `extendedConnectProtocolDisabledByDefault`、`extendedConnectProtocolEnabledDuringHandshake`、`rejectExtendedConnectRequestWithout*`、`ServerTest.serveConnect` |
| 同端口 HTTP/1 / HTTP/2（auto） | V | `AutoTest`（31：hyper-util 的 10 个移植，另加前言拆分、迟分歧、EOF、h2c 并发、升级、停机、ALPN、检测超时） |
| 连接池客户端 | V | `ClientPoolTest`（9：复用与 Host / origin 形式、并发后回池、每主机空闲上限、空闲过期、服务端关闭后透明替换、HTTP/2 共享一个连接、按 authority 分组、拒绝相对 URI 与无 TLS 连接器的 https）；只对本库自己的服务端测试，与其他服务端的互通为 **G** |
| 模糊测试 | V | 确定性种子：`ParseFuzzTest`（httparse 6 个目标 + `fuzz_http`，每目标 20,000 例，完整解析例数设下限）、`H2FuzzTest.fuzz_client` / `fuzz_e2e`（设覆盖下限）、`hpack.FuzzTest`。**不是覆盖率引导的模糊测试（G）** |
| 安全默认值本身（§1 表） | V | 上表与 §2 的测试；hyper 移植用例中的五个（`http11UriTooLong`、`headerNameTooLong`、`maxBufSize`、`clientErrorParseTooLarge`、`headerReadTimeoutAsIdleTimeout`）以放宽选项按参考断言、再以默认值按安全基线断言（SPEC §11） |
| 性能预算 | **G** | 没有按 [工程标准 §9](../standards.md#_9-性能) 定义的预算与发版门槛，CI 不跑性能；现有数据见 §5 |
| RFC 条款清单（逐条 MUST / SHOULD） | **G** | 尚未建立 |

## 5. 外部套件与互通记录

**h2spec 2.1.1**（RFC 7540 / 7541）：**145 / 145 通过、无跳过**（SPEC §11）。对象为 `http-bench` 的 `echoServer`（`NETON_HTTP_H2=1`，h2c），
2026-09-28 在 153（Rocky 9.8）上 epoll 与 io_uring 各一次。
- 仓库中没有 h2spec 的脚本，确切命令未记录；h2spec 不在 CI 中（G）。
- 此后 HTTP/2 代码有改动（客户端修正、服务端时限、auto 与连接池接入），**之后没有重跑的记录**（G）。
- SPEC 记录：对不读请求就响应的 hello 服务，h2spec 有 4 个用例随时序失败（io_uring 上每轮 1–3 个），hyper 的 hello 服务同样失败；归因为测试方式。
  这一归因来自与 hyper 的对照，没有单独的回归测试。
- 该结果是 S：不能单独支撑"符合 RFC 9113"。

**curl 互通**（`http-bench/curl-interop.sh`，对 `echoServer`，核对服务看到的方法 / 目标 / 版本 / 请求体长度与 FNV-1a 校验和，以及 curl 收到的内容）：
- HTTP/1.x 14 项：GET、HTTP/1.0、小 POST、5 MB POST（含 `Expect: 100-continue`，确认收到 100）、chunked 上传、`-T -` 流式 PUT、未知长度响应、
  1 MiB 响应、HEAD、连接复用、Date 头、未知版本得 400。curl 7.76.1，153 上 epoll 与 io_uring 全过（2026-09-28）。
- h2c（prior knowledge）12 项：另含一个连接上 10 路并行、响应版本为 2。153 上两种驱动全过（2026-09-28）；SPEC 未单独写出这次所用的 curl 版本。
- 脚本使用 `stat -c`（GNU），只能在 Linux 上运行；不在 CI 中。此后 HTTP/1 有多处改动（断连监视、请求体时限、背压写入），**之后没有重跑的记录**（G）。

**未做**：HTTP/1.1 的外部一致性套件（目前没有选定的套件）；与 curl 以外实现的互通（nghttp2、Go、浏览器等）；连接池客户端对其他服务端的互通（SPEC §11
的客户端性能对照以 hyper 服务端为对端，但那是性能测量，没有断言）。

**性能**（README "Performance"，原样转述其条件）：4 vCPU 的 Linux 虚拟机、服务端绑定一核，与用 hyper 写的同一程序对照，cachegrind 每请求指令数；
README 声明只适用于这些 hello world 形态，不代表生产成熟度或其他负载。

| 场景 | neton | hyper |
|---|---|---|
| HTTP/1 服务端，hello | 约 11,500 | 6,549 |
| HTTP/1 服务端，类浏览器请求（9 个头） | 约 25,600 | 13,173 |
| HTTP/2 服务端，hello（h2c，10 连接 × 10 流） | 约 37,200 | 27,070 |
| HTTP/1 客户端 | 约 35,050 | 17,260 |
| HTTP/2 客户端 | 约 39,540 | 28,115 |

- 测量历史与每项优化在 SPEC §11；吞吐与 p99 的对照也记在那里，均为单机单核条件，不外推到多核。
- **HttpArena 多核差距（未解决）**：io SPEC §31.1 记录了 HttpArena PR 1517 的运行（runner 128 个 CPU，服务端 cpuset 64 个逻辑 CPU）：
  NetonStream 最好一轮 372,848 RPS、p99 138.30–142.40 ms，Hyper4k 1,034,982 RPS、p99 6.04–8.66 ms。这是完整 Neton 框架与业务路径的测量，
  不是本库单独的测量；io SPEC 明确这些数字是症状，**不能证明根因**。根因尚未确定，见 [roadmap](../roadmap.md) 阶段 3。

## 6. 缺口（进入路线图）

1. HTTP/1.1 的外部一致性证据：选定套件或做与其他解析器的差分测试（尤其是请求走私）；建立 RFC 9112 条款清单。
2. RFC 9113 相对 RFC 7540 的变化逐条核对并补测试（h2spec 不覆盖）。
3. h2spec 与 curl 互通进 CI（固定命令与版本，覆盖 macOS / Windows 能运行的部分），并在当前代码上重跑。
4. HTTP/2 句柄的跨线程投递（SPEC §4.4 写了、未实现），或在支持声明中改为"必须在连接线程上使用"。
5. HTTPS 组合中取消、背压与关闭的测试（auto ALPN 的端到端已由 tls-http 的 `HttpsConnectorTest` 覆盖）；连接池客户端与其他服务端的互通。
6. 覆盖率引导的模糊测试（目前为确定性种子）；长时间运行与资源耗尽测试；未被领取的 `Upgraded` 的生命周期。
7. HTTP/2 请求体总量上限：决定是否与 HTTP/1 的 10 MiB 默认对齐，或写明理由。
8. 性能：按 [工程标准 §9](../standards.md#_9-性能) 定义基准与预算；HttpArena 多核差距先在可控的多核 Linux 上复现，再定位根因。
