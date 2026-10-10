# tls — 支持声明与证据索引

> 坐标 `com.netonstream:tls`、`com.netonstream:tls-http`、`com.netonstream:tls-websocket`，包 `neton.tls`、`neton.tls.http`、`neton.tls.websocket`；
> 仓库 `netonframework/tls`。本文基于发布版本 **0.2.0**（标签 `v0.2.0` = 提交 dc1e86a，2026-10-09；Kotlin 2.4.20，依赖 `io:0.3.2`、
> `openssl:4.0.2`、`http:0.2.0`、`websocket:0.2.0`）。实现记录在仓库的 `SPEC.md`，下文以"SPEC §x"引用。
> 证据级别见 [工程标准 §3](../standards.md#_3-证据分级)：V 已验证、I 互通观察、S 套件判定、A 分析、G 缺口、N 不适用。
>
> **本库不实现任何密码学或 TLS 协议逻辑**（SPEC §1）：握手、记录层、证书与主机名验证、ALPN 全部由 openssl-kotlin 的 `TlsEngine`
> （OpenSSL 4.0.2）完成；本库在协程里搬运密文、按 OpenSSL 的重试契约调度读写、把状态映射到 neton-io 的 `IoStream` 契约。
> 因此本声明针对的是**集成层**：调度、取消、截断、关闭、原生资源、配置默认值与上层连接器。TLS 协议本身的一致性归 OpenSSL。

## 1. 支持声明

| 项 | 内容 |
|---|---|
| 规范 | TLS 1.2、TLS 1.3（由 OpenSSL 实现）；本库承担的是 neton-io `IoStream` 契约（neton-io SPEC §28.6，本库 SPEC §3）与 OpenSSL 的重试契约（`SSL_get_error(3)`，SPEC §2） |
| 角色 | 客户端与服务端（`tlsConnect` / `tlsAccept`）；客户端认证（mTLS）由 `TlsContext` 配置 |
| 上层连接器 | `tls-http`：`HttpsConnector`，http 连接池客户端的 `Connector`，ALPN 选中 `h2` 时报告 `negotiatedH2`（hyper-rustls 的角色）；`tls-websocket`：`WssConnector`，websocket 的 `TlsConnector`（`wss://`） |
| 配置 | 就是 openssl-kotlin `TlsContext` 的构造参数（信任根、证书、版本、套件、ALPN、客户端认证），本库不重复包装（SPEC §1） |
| 明确不支持 | 会话恢复、0-RTT 早期数据、OCSP / CRL、密钥日志：openssl-kotlin 的 `TlsContext` / `TlsEngine` 当前没有对应接口，按 SPEC §1 本库不绕过它另行实现；QUIC 不走本库（用 openssl-kotlin 的 QUIC TLS 接口，见 [quic](./quic.md)） |
| `IoStream` 能力 | 声明 `HalfClose`；`ReadTimeout` / `WriteTimeout` / `IdleTimeout` 随 `inner` 透传；**不声明** `ResumableAfterCancel`（取消即关闭）与 `AnyThread`（SPEC §3） |
| 安全默认 | 客户端总是验证对端（openssl-kotlin 中 `server = false` 即 `SSL_VERIFY_PEER`，无关闭验证的开关）；客户端必须显式给出信任根，OpenSSL 的编译期默认路径只能以 `useOpenSslDefaultTrustPaths` 显式选用；版本默认 TLS 1.2–1.3。系统信任库不隐式使用，需调用 `systemTrustRootsPem()`；`HttpsConnector()` / `WssConnector()` 的默认上下文是显式取系统根 |
| 主机名 / IP 验证 | `peerIdentityOf(host)`：IP 字面量（含 `[::1]`）按证书 IP SAN 校验，其余按 DNS 名校验并作 SNI（SPEC §7） |
| 截断 | 无 close_notify 的 EOF 抛 `TlsTruncatedException`（`IoException`），不当作正常结束（SPEC §3） |
| 与参考的偏离 | `HttpsConnector`：与 hyper-util 相同，ALPN 握手后才知道，尚无连接时的并发请求可能各开一个连接（SPEC §7） |
| 参考实现 | 角色参照：hyper-rustls（`tls-http`）、tokio-tungstenite 的 TLS 特性（`tls-websocket`）、rustls-native-certs `load_native_certs`（系统信任库）；性能对照目标 tokio-rustls / tokio-openssl（SPEC §5）。**版本与提交未记录（G）** |
| 平台（运行过测试） | macOS arm64（kqueue）；Linux x64（epoll、io_uring）；Windows x64（IOCP、WSAPoll）——GitHub Actions CI，三个模块的测试 |
| 平台（仅编译） | linuxArm64、macosX64、iOS（arm64 / 模拟器 / x64）、androidNative（arm64、x64）；CI 的 `compile (all targets)` 作业。另：SPEC §6 记录了 0.1 时期在 colima Linux arm64 上的运行（三种驱动配置），不外推到 0.2.0 |

## 2. 资源上限

| 资源 | 默认 / 规则 | 超限行为 | 证据 |
|---|---|---|---|
| 待发送密文（暂存 + 溢出） | `pendingLimit` 64 KiB（`PENDING_LIMIT`，内部可调）；高水位 ≤ `pendingLimit` + 引擎缓冲 + 一条记录（SPEC §2） | 读者暂停读取，直到全部写出 | V：`ScriptedEngineTest.readerOutputWhileSendingIsBlockedStaysWithinTheBudget`（断言高水位确实越过预算且不超过上界，恢复后输出顺序与引擎产出一致；SPEC §6 记录改回旧检查时高水位 200 KB、测试失败）；`KeyUpdateTest.keyUpdateRepliesWhileSendingIsBlockedStayBounded`（真实 OpenSSL 对端 5 000 次 KeyUpdate，高水位在上界内） |
| 每连接缓冲 | 密文输入、暂存各为引擎缓冲容量 + 一条记录余量，溢出缓冲按需；连接存续期间复用（SPEC §2） | — | A：代码（`TlsStream` 字段）；引擎缓冲容量 `DEFAULT_BUFFER` = 16 KiB，1 KiB / 4 KiB 由 V：`largeTransfersBothWaysWith1KiBEngineBuffers` / `With4KiBEngineBuffers` 覆盖 |
| 证书链与验证深度 | openssl-kotlin `TlsContext`：`verifyDepth` 16、`maxCertificateListBytes` 256 KiB、PEM ≤ 4 MiB | 由 OpenSSL / 构造检查拒绝 | A：openssl-kotlin 源码（不属本库，见其维护者） |
| 握手超时 | **本库无自己的握手超时**；只能经 `inner` 的 `ReadTimeout` / `WriteTimeout` 或调用方 `withTimeout` | 超时即取消，流关闭 | **G：无测试覆盖握手阶段的超时 / 慢对端** |
| 并发调用 | 同时至多一个读、一个写 | 第二个并发调用抛 `IllegalStateException` | V：`IoStreamConformance` 的 "a second concurrent read / write is refused" |

## 3. 运行时契约

| 契约 | 证据 |
|---|---|
| WANT_WRITE：就地取出引擎输出并立即重试，不跨越网络等待；双向同时满速收发不死锁 | V：`largeTransfersBothWaysAtOnce`、`largeTransfersBothWaysWith1KiBEngineBuffers` / `With4KiBEngineBuffers`（双向同时 1 MiB）、`slowLinkBothWaysWithSmallEngineBuffers`（每次至多 700 字节、写间停顿，双向 96 KiB）；SPEC §6：初版行为放回后 1 KiB 测试挂起 |
| 写返回 WANT_READ：写者自己取输入；等待期间读者不调用引擎 | V：`ScriptedEngineTest.writeWaitingForInputFeedsItselfAndTheReaderWaits`（有 / 无读者两种，断言 `readsWhileWritePending == 0`）；脚本引擎模拟，真实 OpenSSL 下 TLS 1.3 正常情况不产生该路径（SPEC §6） |
| 分片输入（`inner` 每次只给 1 字节） | V：`oneByteFragmentsBothWays`；`IoStreamConformance` "any split of the bytes arrives intact" |
| close_notify → `read` 返回 -1；无 close_notify 的 EOF → `TlsTruncatedException` | V：`closeNotifyIsEofAndBareEofIsTruncation`；`IoStreamConformance` "peer close (FIN): data, then -1"（以 `shutdownOutput` + `close` 作为有序关闭） |
| `shutdownOutput` 发送 close_notify，之后仍可读（半关闭） | V：`closeNotifyIsEofAndBareEofIsTruncation`；`IoStreamConformance` "HalfClose: declared works" |
| `close` 立即、幂等，不发 close_notify；挂起与之后的读写得到 `ClosedException` | V：`closeWakesParkedOperationsAndCancelCloses`；`IoStreamConformance` "close is idempotent; parked and later calls get ClosedException" |
| 取消：不声明 `ResumableAfterCancel`，读写被取消后流关闭 | V：`closeWakesParkedOperationsAndCancelCloses`（取消读）；`IoStreamConformance` "ResumableAfterCancel: ... undeclared closes it"（同样只取消读）。**取消写之后流关闭没有单独断言（G）** |
| 被取消的写：对端收到的明文不多于 `src` 的前移量；整条记录已交给 `inner` 时计入 | V：`TlsStreamTest.conformanceOverTcp` / `conformanceOverMemory`（`IoStreamConformance` "a cancelled write advances src by what was sent, no more, no less"）。对不声明 `ResumableAfterCancel` 的流，该检查只断言**上界**（对端收到 ≤ 前移量）及内容前缀，不断言"不少于"。见下方 IOCP 缺陷 |
| 握手失败统一释放：TLS 错误、对端关闭、`inner` 报告已关闭、取消，都关闭引擎与 `inner` | V：`ScriptedEngineTest.failedHandshakesReleaseEverything`（对端关闭、`inner` 抛 `ClosedException` 两例，断言 `inner` 已关闭；SPEC §6 记录去掉修正时测试失败）。取消与 TLS 错误两例：A（`start` 中 `catch (t: Throwable) { tls.close() }`） |
| 失败分类：`TlsFailureException`（`TlsFailureKind`、验证码、告警码、`duringHandshake`），失败前尽力写出告警 | V：`handshakeFailuresAreClassified`（HOSTNAME、CERTIFICATE、EXPIRED、PROTOCOL，均断言 `duringHandshake`）。"告警确实写到对端"：**G**（未断言对端收到告警） |
| 原生资源：`close` 关闭 `inner` 与引擎（`TlsEngine` 持有 SSL）；连接器只释放自己创建的默认 `TlsContext` | A：代码（`TlsStream.close`、`HttpsConnector.close` / `WssConnector.close` 的 `ownsContext`）。**G：没有 quic 那样的"多轮建连 / 失败后原生对象回到基线"测试，也没有 ASan / 泄漏检测** |
| 线程：只在创建它的线程上使用（不声明 `AnyThread`） | V：`IoStreamConformance` 的 `AnyThread` 检查在未声明时跳过——即只验证了"未声明"，约束本身是文档约定（A） |
| 跨层组合：HTTPS → tls → TCP → 反应器；wss → tls → TCP → 反应器 | V：`HttpsConnectorTest`、`WssConnectorTest`，在 CI 的 5 个平台 / 驱动上运行（含 Windows IOCP）。只有正常路径与拒绝不受信任服务端；上层取消、背压、关闭传播的组合用例：**G** |

**IOCP 上的取消写入计数缺陷（首次失败记录，[工程标准 §6](../standards.md#_6-失败的处理)）**：提交 6b24f09 的 CI（运行 37925871731）中，
`test (Windows IOCP)` 失败，其余四个平台通过：`TlsStreamTest.conformanceOverTcp[mingwX64]` 报
"tls(tcp): a cancelled write advances src by what was sent, no more, no less: the peer received 196608 bytes but src says only 180224 were sent"。
原因：完成式的 `inner`（IOCP）可能在取消生效前已把整条记录发完，对端能解密，但 `src` 未前移。修正在 dc1e86a（`TlsStream.kt`：
`flushInline()` 抛 `CancellationException` 时，若暂存与溢出缓冲均已清空，则 `src.consume(len)` 后再抛出；写出一半的记录仍不前移）。
修正后的两次 CI（37926783790、37927504344，均在 dc1e86a 上）5 个平台全部通过。
- 该回归只由一致性套件的时序性检查覆盖（取消发生在何时取决于运行），**没有确定性的专门回归测试（G）**；该检查也不断言"不少于"，
  所以"整条记录已发出却未计入"本身并未被断言。
- 修正与 CI 结果**尚未写入 SPEC**（SPEC §7 只记录到 macOS 测试与 CI 的建立）。

## 4. 证据索引

| 能力 | 级别 | 证据 |
|---|---|---|
| TLS 1.2 / 1.3 握手、收发、连接信息（`alpn`、`protocolVersion`、`serverName`、`peerCertificates()`） | V | `tls12And13HandshakeAlpnAndData`（两个版本逐一，断言 ALPN `h2`、版本字符串、SNI `localhost`、证书数 1）。`cipherSuite`、`exportKeyingMaterial` 未断言（G，低优先） |
| `IoStream` 一致性（TCP 之上、内存流之上） | V | `conformanceOverTcp`、`conformanceOverMemory`（neton-io `io-testkit` 0.3.2 的 `IoStreamConformance`，15 项检查；"peer reset (RST)" 一项需工厂提供 `openResetting`，本库未提供，未运行） |
| WANT_READ / WANT_WRITE 调度 | V | 见 §3；脚本引擎覆盖真实 OpenSSL 无法按需产生的情形 |
| 对端发起的 KeyUpdate（发送被阻塞时） | V | `KeyUpdateTest.keyUpdateRepliesWhileSendingIsBlockedStayBounded`（测试内以原始绑定驱动的 OpenSSL TLS 1.3 服务端，5 000 次，数据完整）。注：SPEC §6 "未覆盖：TLS 1.3 KeyUpdate" 一句早于该测试，已过时 |
| 待发密文预算 | V | §2 |
| 截断与关闭语义 | V | §3 |
| 取消 | V、**G** | V：§3；G：取消写后流关闭无单独断言；IOCP 修正无确定性回归 |
| 证书验证：未知 CA、主机名不符、过期 | V | `handshakeFailuresAreClassified`；`HttpsConnectorTest.anUntrustedServerIsRefused`、`WssConnectorTest.anUntrustedServerIsRefused`（`TlsFailureException`） |
| ALPN 不一致 | V | `handshakeFailuresAreClassified`（客户端只给 `h3` → `PROTOCOL`） |
| 客户端认证（mTLS） | V | `mutualTls`（`ClientAuthentication.REQUIRE`，服务端看到 1 张对端证书）。客户端不给证书时被拒绝：**G** |
| 证书验证配置默认值（客户端必验、必须显式信任根） | A | openssl-kotlin `TlsContext` 构造检查与 `SSL_VERIFY_PEER`（不属本库）；本库的测试都显式给出信任根，未测"缺少信任根即拒绝构造" |
| `peerIdentityOf`：IPv4 字面量按 IP SAN 校验 | V | `HttpsConnectorTest.anIpAddressIsVerifiedAgainstTheCertificatesIpSan`（`https://127.0.0.1:port/`） |
| `peerIdentityOf`：IPv6 字面量（`[::1]`）、DNS 名作 SNI | A、**G** | 代码；无直接测试（SNI 的 DNS 路径经 `tlsConnect(..., PeerIdentity.Dns("localhost"))` 有 V，但不是经 `peerIdentityOf`） |
| 系统信任库 `systemTrustRootsPem()` | V | `SystemTrustRootsTest.theSystemHasRootsThatLoadIntoAClientContext`（> 20 个、无重复、能装入客户端上下文）；CI 打印：macOS 153、Linux 121、Windows 571（运行 37927504344）；SPEC §7 记录本机 macOS 157。`pemCertificates` 的 PEM 读取：`pemReadingSkipsWhatIsNotACertificate` |
| 系统信任库：`SSL_CERT_FILE` / `SSL_CERT_DIR` 覆盖、Android、iOS 抛 `UnsupportedOperationException` | **G** | 代码路径存在；CI 不设置这两个变量；Android、iOS 只编译 |
| 系统根确实能验证公网服务器 | **G** | `theDefaultContextUsesTheSystemRoots`（两个连接器）只构造默认上下文，不建立连接（测试注释说明不连公网） |
| `tls-http`：ALPN 选中 `h2` 时用 HTTP/2，并发请求共用一个连接 | V | `HttpsConnectorTest.http2ByAlpnSharesOneConnection`（首个请求后 5 个并发请求均为 HTTP/2，服务端只接受 1 个连接） |
| `tls-http`：服务端只给 `http/1.1` 时回落并复用连接 | V | `http1WhenTheServerOffersOnlyHttp1`（3 次请求，1 个连接） |
| `tls-http`：`httpsOnly` 拒绝 `http` | V | `plainHttpUnlessHttpsOnly`（`ConnectError`）；`httpsOnly = false` 时明文 `http` 的路径：无测试（G，低优先） |
| `tls-http`：与独立 HTTPS 服务端互通 | **G** | 测试对端都是本栈的服务端（`tlsAccept` + http 的 `AutoServerConfig`）；无 curl / nginx / hyper 等独立实现 |
| `tls-websocket`：wss 回显 | V | `WssConnectorTest.wssEchoes`（101 握手，含非 ASCII 文本与 70 000 字节消息） |
| `tls-websocket`：与独立 wss 服务端互通、Autobahn over TLS | **G** | 对端为本栈的 websocket `accept` |
| 性能 | 记录（非门槛） | SPEC §6：callgrind，TLS 1.3 AES-128-GCM、128 字节回显、12 连接，每请求约 23.5k / 25.0k 指令（epoll / io_uring）、2 次 Kotlin 分配；基于 2026-09-28 的版本，在宿主 153 上测得（该宿主现已不可用）。**G：与 tokio-rustls / tokio-openssl 的同机对照未做；0.2.0 未重测；没有预算** |
| 外部 TLS 套件（BoGo、tlsfuzzer） | **G**（低优先） | 见 §5 |

## 5. 外部套件与互通记录

**CI**（`.github/workflows/ci.yml`，任何分支的 push、PR 与手动触发）：矩阵 `macOS kqueue`（macos-14）、`Linux epoll`、`Linux io_uring`（ubuntu-latest，
`NETON_IO_DRIVER`）、`Windows IOCP`、`Windows WSAPoll`（windows-latest），每个运行 `:tls`、`:tls-http`、`:tls-websocket` 三个模块的测试；另有
`compile (all targets)` 作业编译 10 个目标及共享源集的元数据。作业摘要打印测试数、失败与系统根数量。

| 提交 | 运行 | 结果 |
|---|---|---|
| 6b24f09 | 37925871731 | Windows IOCP 失败（`conformanceOverTcp`，见 §3），其余 4 个平台与全目标编译通过 |
| dc1e86a（`v0.2.0`） | 37926783790 | 5 个平台各 27 个测试、0 失败；全目标编译通过 |
| dc1e86a（`v0.2.0`） | 37927504344 | 同上 |

27 = tls 18 + tls-http 6 + tls-websocket 3（与测试源码中的 `@Test` 数一致）。

**外部 TLS 套件**：BoGo（BoringSSL 的 TLS 测试运行器）、tlsfuzzer 尚未运行。它们检验的主要是 TLS 协议实现，即 OpenSSL；对本库的价值在于
借真实的异常对端（告警、截断、分片、记录边界）间接检验集成层。优先级低于 §6 的前几项。

**互通**：无。所有 TLS 对端都是同一份 OpenSSL（经本库或测试内的原始绑定），HTTPS / wss 的对端是本栈自己的服务端。

## 6. 缺口（进入路线图）

1. 取消的确定性回归：用脚本化的 `inner`（写完整条记录后抛 `CancellationException`、写一半后抛出）分别断言 `src` 前移量，锁定 dc1e86a 的修正；
   补"取消写之后流关闭"的断言。把 IOCP 缺陷与修正、0.2.0 的 CI 结果写入 SPEC。
2. 原生资源生命周期：多轮建连 / 关闭、握手失败（含取消、TLS 错误）后引擎与 SSL 对象回到基线的测试（参照 quic 的
   `manyHandshakesSucceedingAndFailingReturnToBaseline`）；cinterop 路径的 ASan。
3. 握手超时与慢对端：明确由谁负责（`inner` 的超时或调用方），并测试握手阶段的超时与取消。
4. 组合测试：HTTPS / wss 在上层取消、背压、关闭传播下的行为（[工程标准 §7.3](../standards.md#_7-3-组合正确性)），含 Windows IOCP。
5. 配置与验证：`peerIdentityOf` 的 IPv6 字面量与 DNS / SNI 路径；mTLS 缺证书被拒；告警确实送达对端；`SSL_CERT_FILE` / `SSL_CERT_DIR` 覆盖；
   系统根对真实公网证书链的验证（可在 CI 中选做）。
6. 与独立实现互通：`HttpsConnector` 对 curl / nginx 等服务端（h2 与 http/1.1）；`WssConnector` 对独立 wss 服务端；服务端方向（本栈 HTTPS 服务端被
   curl 访问）。
7. 记录参考实现（hyper-rustls、rustls-native-certs、tokio-tungstenite）的版本与提交；与 tokio-rustls / tokio-openssl 的同机性能对照与预算
   （SPEC §5）。
8. 外部 TLS 套件（BoGo、tlsfuzzer）：主要检验 OpenSSL，作为低优先项。
