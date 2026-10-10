# io — 支持声明与证据索引

> 坐标 `com.netonstream:io`（一致性套件 `com.netonstream:io-testkit`），包 `neton.io.*`；仓库 `netonframework/io`（模块目录 `neton-io/`）。
> 本文基于发布版本 **0.3.3**（2026-10-09，标签 `io-v0.3.3` / ce18ed0，Kotlin 2.4.20）。实现记录在仓库的 `SPEC.md`，下文以"SPEC §x"引用；
> SPEC 按时间追加，规范性内容只看 SPEC §28.0 的契约索引（开头的导读说明了哪些章节已被取代）。
> 证据级别见 [工程标准 §3](../standards.md#_3-证据分级)：V 已验证、I 互通观察、S 套件判定、A 分析、G 缺口、N 不适用。

io 是 I/O 底座（反应器、TCP、UDP 数据报层、计时器、缓冲、编解码、`IoStream` 契约），**不实现任何 RFC 协议**。因此本文的"规范"指它对上层的
运行时契约与它使用的操作系统接口；[工程标准 §7](../standards.md#_7-运行时契约) 的运行时契约是本库的核心。

## 1. 支持声明

| 项 | 内容 |
|---|---|
| 契约（规范） | `IoStream` 契约与能力声明（SPEC §28.6）；反应器生命周期与 `ReactorResumer`（§28.3）；服务端组与停机（§23.4、§27.5、§27.8–§27.10）；读取前准入 `Admission`（§28.12）；数据报层 `bindUdp` / `UdpSocket`（§29）；`lookupHost`（§35）；`Buffer` / `Bytes` / `BufferPool` 的所有权语义（§23.7）。**SPEC §28 仍标注"待评审（修订 3）"**，§28.13 写明命名的确认"不代表生命周期与准入设计已通过技术终审" |
| 公开 API 分级 | 稳定契约 / 可选性能扩展（`ReactorResumer`）/ 运维诊断（`GcTuning`、`GcStats`、`NETON_IO_*`，格式不承诺稳定）/ 基准程序（不属于 API）（SPEC §28.2） |
| 驱动（操作系统接口） | Apple：kqueue（默认）、poll(2)；Linux：io_uring（默认，创建失败时静默回退 epoll；显式 `NETON_IO_DRIVER=iouring` 不回退）、epoll、poll(2)；Android：epoll（默认）、poll(2)，不提供 io_uring（沙箱的 seccomp 可能拦截）；Windows：IOCP（默认）、WSAPoll；JVM：`java.nio.channels.Selector`（`NioReactor`）。io_uring 读默认单次 RECV，multishot 需 `NETON_IO_URING_MULTISHOT=1`（SPEC §15.2、§24.7） |
| 角色 | TCP 客户端与服务端（`connect` / `listen` / `listenGroup` / `listenAlso` / `serveTcp`）；Unix 域套接字（POSIX 与 Windows）；UDP（`bindUdp`）；内存流 `memoryStreamPair`（测试用） |
| QUIC 所需的 UDP 能力 | 批量接收（Linux `recvmmsg` 32；Apple、Windows 在 shim 内循环 `recvmsg` / `WSARecvMsg`，默认 32）；每数据报 ECN 读写；`IP_PKTINFO` / `IPV6_PKTINFO`（目的 IP 与源 IP 选择；Apple 为 `IP_RECVDSTADDR`，无源 IP 选择）；禁止分片（PMTU 探测）；Linux GSO（`UDP_SEGMENT`，至多 64 段）与 GRO；Windows USO（`UDP_SEND_MSG_SIZE`，探测成功为 512 段）；双栈与 v4 映射；EINVAL / EMSGSIZE / ECONNRESET 的处理（SPEC §29.2、§29.3、§29.7、§29.9） |
| 明确不支持 | TLS、HTTP 等协议（各自独立的库，SPEC §28.1）；UDP 套接字原地换地址（重绑定由上层新建套接字，§29.1）；Apple 的 GSO / GRO（平台无此设施）；Windows URO（与参考一样默认不开，quinn issue 2041，§29.7）；cgroup CPU 配额推算（只按亲和性掩码数 CPU，§31）。**JVM 目标上不提供**：UDP、Unix 套接字、信号处理、绑核、GC 调优、keepalive 时间参数、SO_REUSEPORT 负载均衡（README 的 JVM 段：VM 拥有信号，JDK 无可移植接口） |
| 与参考的偏离 | ⚖️ Windows 只有绑定在 `::` 或 v4 映射地址上的双栈套接字才设 IPv4 选项（§29.7）；⚖️ Windows 第一次 WSAEINVAL 后不再附带 ECN（§29.7）；⚖️ Windows 与 Apple 每次接收调用最多取 32 个数据报（quinn-udp 在 Windows 为 1、Apple 只在 `fast-apple-datapath` 下批量，§29.9）；Windows 的 TCP 写每次至多交出 256 KiB，阻塞时把下一块暂存后发送（§33.3） |
| 安全默认 | 向已断开的对端写入表现为 `EPIPE` / `ECONNRESET`，在套接字层抑制 SIGPIPE，不改进程信号处理（§15.3）；`serveTcp` 默认不接管信号；`secureRandom` 取操作系统 CSPRNG（§28.15）；库不设置进程级 GC 参数（§26.8） |
| 参考实现 | 架构与性能参考：geario（ntex 网络层的单 crate 提取，本地 `~/projects/Neton/geario`，**未记录固定提交**）；API 对照：tokio（`net::lookup_host`、`peer_addr`）；数据报层：quinn-udp（随 quinn 0.11.12 标签，提交 eaec0db，`src/unix.rs`、`windows.rs`、`tests/tests.rs`） |
| 工具链 | Kotlin 2.4.20，构建脚本拒绝更低版本（SPEC §34）；native 产物为 klib，使用者须以 2.4.20 或更高版本编译；JVM 产物字节码 1.8、只用 Android API 21 已有的接口 |
| 平台（运行过测试） | GitHub Actions：macOS arm64（kqueue、poll）、Linux x64（epoll、poll、io_uring）、Windows x64（IOCP、WSAPoll）、JVM（Linux、macOS、Windows）。见 §5 |
| 平台（CI 仅编译） | linuxArm64、macosX64、iOS（arm64 / 模拟器 arm64 / x64）、androidNative（arm64、arm32、x64、x86）；另链接 mingwX64 与 androidNativeArm64 的测试二进制。本地运行过但不针对 0.3.3 的记录：linuxArm64（Colima，SPEC §32，157/157）、iOS 模拟器（README，2026-10-03）、Android Pixel_9 模拟器（TODO.md §20，33 用例时期） |

## 2. 资源上限

| 资源 | 默认 / 规则 | 超限行为 | 证据 |
|---|---|---|---|
| 监听队列 | `SocketOptions.backlog` = 4096（§26.6） | 由内核处理 | V：`SocketOptionsTest.listenerOptionsApplyToAcceptedConnections`（读回选项） |
| 连接数 | `maxConnections`（默认 0 = 不限） | accept 等到有空位 | V：`ServerControlTest.connectionCapWaitsForAFreeSlot` |
| 处理中的请求 | `Admission(permits, acquireTimeoutMillis)`，可选；必须同时配置帧读取速率 | 许可不足时停止读取与解码（背压到客户端）；等待超时以 `AdmissionTimeoutException` 关闭连接 | V：`AdmissionTest` 7 项（空闲连接不占许可、并发 ≤ 许可、超时关闭、取消不漏许可、未配置速率被拒绝）；SPEC §28.11 第 4 步记录了逐项反向验证 |
| 执行中的调用 | `limitInFlight`（§27.3） | 挂起等待 | V：`InFlightServiceTest.atMostMaxCallsRunAtOnce`、`cancelledWaiterLeaksNoPermit` |
| 每连接待发送字节 | `Framed` 写缓冲高水位 64 KiB，超过即 flush 并挂起到内核接收；即 ≤ 64 KiB + 一个帧（§28.11 第 4 步）。§28.12 设计中的"每连接输出上限 256 KiB"未实现为独立参数 | 写方挂起 | V：`AdmissionTest.pendingOutputStaysBoundedWhenTheClientDoesNotRead` |
| Windows 单次交给内核的写 | 256 KiB（`MAX_SEND_CHUNK`）；IOCP 暂存发送每套接字至多一块 | 缓冲满时写者挂起 | V：`WriteCancelTest.cancelledWriteAccountsExactlyWhatWasSent`（Windows 两种驱动，§33.3） |
| 读缓冲 | 自适应读大小，2 KiB–64 KiB（§19.4） | — | A：SPEC §19.4 的内存测量（历史记录），无对应断言 |
| 缓冲池 | 每线程、2 KiB–64 KiB 的 2 的幂分级；每级至多 128 个、每线程至多 4 MiB；更大的数组不缓存（`BufferPoolConfig`） | 超出部分不缓存 | V：`BufferPoolTest.oversizedArraysAreNotCached`、`pooledBufferTakesAnArrayOnlyWhileItHoldsData`、`parkedReadHoldsNoPooledArray`（IOCP 与 io_uring 豁免：重叠读挂起期间拥有数组） |
| 每轮任务预算 | 256 个（按个数，不按时间）；普通任务与恢复环轮转（§28.11 第 3 步） | 余下的下一轮执行 | V：`FairnessTest.busyYieldLoopDoesNotStarveIoOrTimers`、`resumeRingHandoffsDoNotStarveOrdinaryTasks`（以严格优先运行时失败） |
| io_uring 提交队列 | `NETON_IO_URING_DEPTH`（默认 4096）；满时提交腾位、CQ 满先收割 | 不丢操作 | A：SPEC §15.3 记录 depth 4 / 8 下 400 连接通过（2026-09-13）；**CI 不以小深度运行** |
| 超时 | 读、写、空闲超时与连接超时默认关闭（0）；流超时走 10 ms 计时轮；帧读取速率 `FrameReadRate` | 读写超时抛 `TimeoutException`，空闲超时关闭流 | V：`TimeoutTest`（9 项）、`SocketOptionsTest.connectTimeoutEndsAnUnansweredAttempt`、`TimerWheelTest` |
| UDP 接收批量 | 32；`NETON_IO_UDP_BATCH` 覆盖（Apple 1–32、Windows 1–64） | — | 见 §4 |

## 3. 运行时契约

| 契约 | 证据 |
|---|---|
| `IoStream`：读追加且不返回 0；写完全部或抛出；FIN 先数据后 -1；RST 是 `IoException` 而非 EOF；关闭幂等、挂起与之后的调用得 `ClosedException`；同方向第二个并发操作被拒；`writev` 保序；任意切分重组一致；被取消的写使 `src` 恰好前进已发出的字节；能力已声明则可用、未声明则被拒（SPEC §28.6） | V：`io-testkit` 的 `IoStreamConformance`（16 项检查，另有 RST 一项需提供 RST 工厂），`ConformanceTest` 在 TCP（含 linger 0 的 RST 工厂）、Unix 套接字、`memoryStreamPair`、`BaseFilter`(TCP)、`BaseFilter`(内存) 上运行；`suiteCatchesAViolation` 确认套件能发现读返回 0 的违约；SPEC §28.11 第 2 步记录了反向验证（去掉内存流的并发读检查，两项失败）。CI 七个 native 测试作业都运行 `:io-testkit:` |
| 取消的写的精确计数（含 Windows 不能精确取消挂起的发送） | V：`WriteCancelTest.cancelledWriteAccountsExactlyWhatWasSent`（CI 各驱动与 JVM）；SPEC §33.3 记录了 IOCP 上它首次失败（多发整一块 256 KiB）与修正 |
| 挂起中的操作被取消或反应器退出时，完成式驱动在内核结果到达前不释放缓冲 | V：`InFlightLifetimeTest.cancelParkedReadThenPeerWrites`、`reactorExitsWithCancelledReadStillInFlight`、`ReactorLifecycleTest.closingWaitsForKernelOps`；`UringMappingLeakTest.reactorShutdownReleasesItsMappings`（Linux）。关闭时"收割结果后才唤醒"（§28.6）：A（实现见 §28.11 第 2 步，无直接断言数组未被内核写入的测试） |
| 反应器生命周期：`DRAINING` 期间投递与恢复照常；进入 `CLOSING` 前无在途内核操作；外部投递与关闭竞争时要么恰好执行一次、要么被拒；所属线程上的 `resume` 排队；槽位约定下取消与恢复只恢复一次 | V：`ReactorLifecycleTest` 的 `drainingDeliversWhatChildrenWaitFor`、`closingWaitsForKernelOps`、`externalPostsRacingCloseAreRunOrRefused`（去掉入口哨兵时挂起，§28.11 第 1 步）、`resumeOnOwnThreadIsQueued`、`slotConventionResumesExactlyOnce`、`failingRootCancelsParkedChildrenAndRethrows`；SPEC §33.4 记录了 IOCP 上的活性缺陷（外部投递使反应器停不下来）与对照实验 |
| 线程归属：流与 I/O 只能在所属反应器线程上调用；跨线程恢复唤醒反应器 | V：`ThreadingTest.ioFromAnotherThreadIsRejected`、`resumeFromAnotherThreadWakesTheReactor`、`TcpFailureTest.closeFromAnotherThreadIsRejected`；内存流 `AnyThread`：`MemoryStreamTest.usableAcrossThreads` |
| 挂起的读被取消（本线程 / 其他线程） | V：`ParkCancellationTest`（4 项）、`IdleReadTest.idleReadCanBeCancelled` |
| 关闭后不复用已关闭的 fd 号 | V：`FairRoundTest.closeFailsADeferredReader`（§33.2）、`PeerAddressTest.closedStreamHasNoAddress` |
| 连接协程的回收与强制停机 | V：`ConnectionReclaimTest`（`parentScopeAlreadyCancelled`、`cancelledFromAnotherThreadBeforeItStarts`、`cancelRacingStart`、`forcedShutdownCatchesAConnectionStillQueued`）、`ServerControlTest.shutdownLetsConnectionsFinishThenCancelsTheRest` |
| 处理器异常与对端重置不使服务端停止 | V：`ConnectionFaultTest.throwingHandlerAndPeerResetDoNotStopTheServer` |
| 公平：每连接每轮一次读；自我调度的协程不饿死 I/O 与计时器 | V：`FairRoundTest.secondReadInTheSameRoundIsServedNextRound`、`FairnessTest`；负载下的 L1 / L2 / F2 / F3 / L3 见 §5（只证明 2 反应器、4 vCPU 的规模） |
| io_uring 下 accept 一次取空队列 | V：`AcceptBacklogTest.aQueuedBacklogIsAcceptedInAFewLoopTurns`（修复前 io_uring 失败，§32） |
| 信号与平滑停机 | V（POSIX）：`SignalsTest`（7 项）、`SignalChildProcessTest`（Linux）；**G：Windows 的 Ctrl-C / Ctrl-Break 用例未写（§28.5 的验收项）** |
| 跨层组合 | `IoStream` 之上：quic 的 `QuicStreamTest` 运行本套件（见 [quic](./quic.md)）；msgtrans、http、websocket、tls 的组合见各自的支持声明（待建）。本库自身只有 `BaseFilter` 一层的组合测试 |

## 4. 证据索引

| 能力 | 级别 | 证据 |
|---|---|---|
| TCP 回显、并发连接、多帧 | V | `TcpEchoTest`（`manyConcurrentConnections` 400 连接）、`EchoTest`、`FramedReceiveTest` |
| 连接失败路径：拒绝、写已关闭的对端、关闭唤醒挂起的读、关闭监听器唤醒 accept | V | `TcpFailureTest`（5 项） |
| 半关闭与向量写 | V | `WritevTest`（4 项）、`TimeoutTest.closeGracefullyLetsThePeerFinish` |
| 边缘触发不丢事件 | V | `EdgeTriggeredTest`（3 项） |
| 多反应器、多端口共享反应器、SO_REUSEPORT | V | `MultiReactorTest`、`SharedReactorsTest`、`ServerControlTest.reusePortModeSpreadsConnections`（macOS 与 Windows 上跳过，见 §5） |
| 套接字选项 | V | `SocketOptionsTest`（5 项，`getsockopt` 读回；`reusePortAllowsTwoListenersOnOnePort` 在 Windows 跳过） |
| Unix 域套接字 | V | `UnixSocketTest`（6 项；抽象命名空间只在 Linux） |
| 对端 / 本端地址、`ipString` | V | `PeerAddressTest`（6 项，`ipString` 对照 Rust `Ipv6Addr` 的显示测试） |
| IPv6、双栈、按名连接逐个尝试地址 | V | `AddressTest`（4 项） |
| `lookupHost`：字面量（含方括号 IPv6）、`localhost`、不可解析、端口越界 | V | `LookupHostTest`（5 项；CI 全部 native 作业与 JVM 运行）。`unknownHost` 在 fake-IP 代理下打印 SKIP 并通过 |
| `lookupHost`：名字在反应器线程外解析、按 RFC 6724 顺序 | A | 复用 `connect` 的 `resolve`（SPEC §35）；`SharedReactorsTest.namesResolveInParallel` 只断言 32 个并发解析都有结果，不断言线程；顺序取解析器结果，无测试 |
| `Buffer`：游标、压缩、增长、零拷贝切片（SHARED）、借用视图（BORROWED）、池化数组 | V | `BufferFuzzTest.unpooled` / `pooled`（模型对照：每步可读字节与字节列表一致、已交出的切片不被覆盖、借用的源不被写入；固定种子 12 个 × 2000 步，可复现）；`BufferBorrowTest`、`BufferPoolTest.slicesStayIntactWhateverTheBufferDoesNext`、`readSliceIsZeroCopy`、`BufferPrimitivesTest` |
| UDP 收发、源 / 目的地址、ECN（v4、v6、双栈、v4 映射）、套接字缓冲 | V | `UdpTest` 中逐个移植 quinn-udp 的 8 个测试：`basic`、`basicSrcIp`、`ecnV6`、`ecnV4`、`ecnV6Dualstack`、`ecnV4MappedV6`、`gso`、`socketBuffers`（断言同参考：分段内容、来源端口、地址、ECN）；CI 的 macOS、Linux、Windows 共 7 个驱动配置都运行 |
| GSO / USO 分段发送 | V | `UdpTest.gso`：按 `maxGsoSegments` 分段并逐段核对内容。CI 输出 Linux 64、Windows 512、macOS 1——**段数本身只打印、不断言**；在段数为 1 的平台上该测试不检验分段 |
| 批量接收 | V、**G** | V：`UdpTest.batchReceive` 收全 32 个；CI 输出各驱动"first call returned 32 of 32"。**G：一次调用返回的个数未被断言** |
| `EMSGSIZE` 视为已发送；关闭唤醒挂起的接收 | V | `UdpTest.oversizedDatagramIsNotAnError`、`closeWakesParkedRecv`（§29.7 记录了 IOCP 上 WSAENOTSOCK 被误报为 IoException 的修正） |
| GSO 遇 EIO / EINVAL 降级、GRO 步长拆分、禁止分片（`mayFragment`） | **G** | §29.5 列出的故障注入与步长测试未写；`mayFragment` 无测试 |
| UDP 每次收发零分配 | **G** | §29 首版记录为"后续项"（callgrind 验证未做） |
| 计时精度 | V | `TimerPrecisionTest.oneMillisecondDelayWakesWithinAFewMilliseconds`（断言 `delay(1)` 迟到中位数 < 4 ms，打印 p99 / 最大，§29.8）；`ClockTest`（`monotonicNanos` / `systemTimeMillis`） |
| CPU 数按亲和性掩码 | V | `CpuCountTest`（Linux）；`bench/test-cpu-count.py` 的 C 测试（§31，本地记录） |
| 绑核 | V（POSIX） | `AffinityTest.pinnedReactorsRunOnOneCpuEach`（macOS 打印 SKIP：不支持）；Windows `SetThreadAffinityMask` 无用例 |
| GC 调优接口 | V | `GcTuningTest`（`minHeapKeepsCollectionsRare`、`lowerGcThreadPriorityRenicesTheGcThreadOnLinux`） |
| 安全随机数 | V | `SecureRandomTest.fillsTheRangeOnlyAndDiffersEachTime` |
| JVM 后端（`NioReactor`） | V、**G** | V：commonTest 在 JVM 上运行（CI 三个系统各 123 个）。**G：`io-testkit` 只有 native 目标，`IoStream` 一致性套件未在 JVM 流上运行** |
| io_uring `io_uring_enter` 的 EINTR / EBUSY / 部分提交 | **G** | SPEC §15.3 的"已知待验证项①"：统一走重试，未按 errno 细分、无专项测试 |
| 覆盖率引导的模糊测试；cinterop C 代码（`posixshim`、`winshim`、`uring.def`）的 ASan / UBSan | **G** | 只有确定性种子的 `BufferFuzzTest` 与一致性套件中的切分检查 |

## 5. CI 矩阵与基准

**CI**（`.github/workflows/ci.yml`，任意分支推送、PR 与手动触发）。发版标签 `io-v0.3.3` 的运行 37953259387 全部通过；
用例数取自该运行上传的 `neton-io` 测试结果（失败 0、错误 0）：

| 作业 | 运行器 | 驱动（`NETON_IO_DRIVER`） | `:io` 用例 | 测试中打印的 SKIP |
|---|---|---|---|---|
| macOS kqueue / poll | macos-14 | 默认 / `polling` | 163 / 163 | 绑核不支持；ReusePort 回退为 Handoff |
| Linux epoll / poll / io_uring | ubuntu-latest | `epoll` / `polling` / `iouring` | 166 / 166 / 166 | io_uring：空闲释放检查（完成式驱动的挂起读拥有数组） |
| Windows IOCP / WSAPoll | windows-latest | 默认 / `wsapoll` | 155 / 155 | ReusePort 不支持；IOCP 另有空闲释放检查 |
| JVM | ubuntu-latest、macos-14、windows-latest | `Selector` | 123 × 3 | — |
| compile + link | macos-14 | — | — | 编译全部 native 目标，链接 mingwX64 与 androidNativeArm64 测试二进制 |

- 七个 native 测试作业同时运行 `:io-testkit:<目标>Test`（`ConformanceTest`），作业通过即表示一致性套件通过；但**它的结果文件未上传、不进入作业摘要**，
  逐项结果（例如 Unix 套接字一项在探测失败时会打印 SKIP 并通过）无法从 CI 产物复核（G）。
- CI 的 io_uring 作业只覆盖默认的单次 RECV 路径；multishot（`NETON_IO_URING_MULTISHOT=1`）与小提交队列深度只有 SPEC 中的本地记录。
- SPEC §33 记录：0.3.0 之前 CI 从未全部通过（0.1.1、0.2.0 在 CI 失败状态下发布），第一次全部通过是运行 37653522928（815f593）。

**UDP 探针**（作业 `udp probe`，`UdpReceiveProbeTest`，`NETON_IO_UDP_PROBE=1`；工作流注明"是测量，不是检查"）。运行 37953259387，每轮 2000 个
数据报（单段）、3 轮，每个数据报的接收开销：

| 配置 | 批量 / GSO | 接收（ns / 数据报） | 唤醒延迟 p50 / 最大 |
|---|---|---|---|
| Linux io_uring | 32 / 64 | 1218–1261 | 17 µs / 848 µs |
| Linux epoll | 32 / 64 | 2126–2382 | 39 µs / 1042 µs |
| macOS kqueue | 32 / 1 | 1401–1518 | 31 µs / 791 µs |
| Windows IOCP | 32 / 512 | 1749–2350 | 59 µs / 4447 µs |
| Windows IOCP 批 1 | 1 / 512 | 19121–24246 | 57 µs / 163907 µs |
| Windows WSAPoll | 32 / 512 | 2008–2174 | 73 µs / 4178 µs |
| Windows WSAPoll 批 1 | 1 / 512 | 10124–11962 | 23 µs / 102440 µs |

SPEC §29.9 记录的另一轮 IOCP 为 0.86–0.89 µs（批 32）对 13.7 µs（批 1）；两轮相差约一倍，共享运行器上的单轮数字只用于对照批量的数量级。

**计时精度**（同一运行的 `TimerPrecisionTest` 输出，`delay(1)` 200 次的迟到）：Linux io_uring p50 35 µs / p99 84 µs；epoll 80 / 101 µs；poll 76 / 92 µs；
macOS kqueue 306 / 995 µs；Windows IOCP 1995 / 2030 µs；WSAPoll 557 / 2034 µs；均无提前触发。Windows 的约 2 ms 来自截止时间取整到毫秒加 1 ms 的系统
计时精度（§29.8）。

**基准**（均为历史记录，未在 0.3.3 上重跑）：
- README 的原始回显表（`echoServer` / `echoClient`，2026-09-13 的早期代码）：条件为**客户端与服务端同机、localhost、release 构建、64 B 载荷、单反应器**；
  macOS kqueue（Apple Silicon）1 / 50 / 200 连接 46,305 / 110,606 / 105,799 req/s；Linux（2 核）epoll 25,192 / 90,181 / 79,451、poll(2) — / 93,736 / 75,572、
  io_uring — / 77,973 / 71,352 req/s。README 称"CI 的 `bench` 作业每次推送都跑一个短版本"，但该作业已于 4bf2ea5 从工作流中移除——**README 此处过时**。
- SPEC §28.4 / §28.11 第 3、4 步（2026-09-28，153 主机：4 vCPU 虚拟机，服务端 `taskset 0,1` 两个反应器，负载发生器 `taskset 2,3`，每格 5 轮、预热 3 s 后测 30 s）：
  F2 轮转后计时器迟到 p99 21–33 µs、跨线程等待 p99 ≤ 29 µs，达标；L2 每类 Jain ≥ 0.974，达标；L1 原始回显冷连接 p99 为单独运行时的 1.07 倍（达标），
  按行回显 4.4–4.7 倍（不达标，归因于按行编解码的分配触发 GC，`setMinHeap` 64 MiB 后 1.15 倍）；F3 全部达标；L3 许可等待 p99 ≤ 33 ms、过载后第 1 秒
  恢复到 C 的 93%–100%。原始回显的饱和对照（与 geario）因发生器 CPU ≥ 0.8 按规程作废，**本机无法给出与 geario 的有效吞吐对照**。规模只证明 2 反应器、4 vCPU。
- HttpArena（SPEC §31.1，PR 1517，运行 36611334152）：NetonStream 最好 372,848 RPS、p99 138.30–142.40 ms，Hyper4k 1,034,982 RPS、p99 6.04–8.66 ms。
  SPEC 原话：**"这些是性能症状，不能证明根因是 GC、竞争或驱动。"** §31.2、§32 的本地测试修正了 CPU 计数与 io_uring accept，但对 Arena 的收益仍须在多核 Linux 上测。
- 性能目标："Go 最强的网络库（gnet、netpoll）一档、ntex / geario 为参考天花板"（README、SPEC 开头）是**方向，不是证据**；SPEC §28.13 写明"性能无敌是方向，
  不是验收标准"，导读写明 gnet / netpoll / Ktor 基线未做。

## 6. 缺口（进入路线图）

1. 多核（≥ 16 核）复现与定因：HttpArena 的退化先在可控的多核 Linux 上复现，再以 perf、调度统计、GC 日志与分配归因定位（SPEC §28.4 规模说明、§31.1）。
2. 按 [工程标准 §9](../standards.md#_9-性能) 定义 io 的基准场景与预算（吞吐、p99、每请求指令数、每请求分配），在可复现的环境上重跑；README 的回显表与"CI bench"说法更新。
3. 一致性套件：上传 `io-testkit` 的结果并纳入作业摘要；为 JVM 目标提供 `io-testkit` 并在 `NioReactor` 流上运行。
4. 数据报层：断言批量接收的个数与 GSO 段数；补 §29.5 的 GSO 降级（故障注入）、GRO 步长拆分、`mayFragment` 测试；每次收发零分配的 callgrind 验证；剖析 IOCP 相对 WSAPoll 的差距（§29.9）。
5. io_uring：`io_uring_enter` 的 EINTR / EBUSY / 部分提交专项测试（§15.3）；multishot 与小队列深度纳入 CI；完成式驱动"关闭后内核不再写入数组"的直接测试。
6. Windows：信号（Ctrl-C / Ctrl-Break）与 `SetThreadAffinityMask` 用例（§28.5）；亚毫秒计时（若上层需要，§29.8）。
7. 平台：linuxArm64、iOS、Android 的测试在 CI 中运行（目前 CI 只编译，运行记录为本地、且早于 0.3.3）。
8. 覆盖率引导的模糊测试；`posixshim`、`winshim` 与 io_uring 绑定的 ASan / UBSan（[工程标准 §7.5、§10](../standards.md#_7-5-模糊测试)）。
9. SPEC §28（契约修订 3）完成评审；参考实现 geario 记录固定提交。
