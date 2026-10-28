# Neton WebSocket 规范

2026-10-29 冻结前命名迁移：模块仍为 `neton-websocket`，源码包统一为
`neton.websocket`（SPI 为 `neton.websocket.spi`）。不存在 `neton-ws` 模块。
旧 beta26 使用 `neton.ws`，不回写旧制品；新候选必须同步更新 import、KSP 生成
引用并重新编译，不能混用新包名与旧框架/KSP。下文示例以新候选包名为准。

> **定位**：在 Neton 框架内提供 WebSocket 服务端能力：路由注册、握手安全、会话收发、关闭与停机。
> 协议本身不在框架内实现，由 `com.netonstream:websocket` 提供；本文只规定**框架如何接入它**。
>
> **状态**：**v1 r12 业务 API 冻结候选**，最终放行遵循 release-freeze-contract。HandshakeInfo、CloseResult、awaitClosed 和单消费者接口已实施；不再将 r11 的缺口描述为当前实现。
> `neton.websocket.spi` 仍为 ERROR 级实验 API，不随业务 API 冻结。r10/r11 为历史记录。
> 功能一致性不等于性能认证：§11 的独立压力/性能验收未完成项仍保留，不宣称未经实测的容量或吞吐保证。
> r2 按评审修订了运行时契约：单一协议读取者（§7.3）、发送顺序与数据所有权（§7.4）、
> 三类配额（§7.6）、升级中连接的停机（§8.3）、心跳三项配置（§10.2）、性能验收（§11.1）。
> r3 补充：各层职责划分（§2.5）、消费停滞与写阻塞不冒充心跳失败（§7.3、§7.4）、
> 心跳计时起点与错峰（§10.2）、全局预算与空闲连接成本（§10.3、§10.4）。
> r4 补充：预算统计范围与"先预留再复制"（§7.4、§10.3）、Ping/Pong 登记时序（§10.2）、
> 预算耗尽时保证连接能退出（§10.3）、空闲缓冲先测量再决策（§10.4）。
> r5 修订：入站预算改为可拒绝的预留（§10.3.1）、全局耗尽时拒绝并关闭增长中的连接（§10.3.2）、
> 挂起发送者最坏保留量与精确 UTF-8 长度（§7.4、§10.3.3）。
> r6 修订：WebSocket 是 **HTTP 适配器可提供的标准能力**，不是某个引擎专属的功能。公共策略在 `neton-http` 只实现一次，
> 适配器只提供机制；新增引擎 SPI（§7.0）与一致性套件（§9.2）。
> r7 重构：新增独立模块 **`neton-websocket`**；`neton-core` 只提供与协议无关的**升级扩展点**；
> WebSocket 引擎通过 **`WebSocketEngineProvider`** 接入并可替换，参考 Spring 的 `RequestUpgradeStrategy` 分工与 Axum 的路由入口（§7.0）。
> r8 调整：默认 HTTP 适配器合入 `neton-http`，命名为 `DefaultHttpAdapter`，不再单独维护 `neton-http-netonstream` 模块。
> `http { }` 固定选择默认适配器；Hyper4k 必须通过 `http(::Hyper4kHttpAdapter)` 显式选择，不能靠依赖或导入顺序改变默认值。
> r9 调整：默认 WebSocket provider 内置于 `neton-websocket`，不建立独立默认桥接模块。
> r10 已实现：路由升级、业务 Session、KSP 参数预绑定、心跳、共享预算、停机交接与默认 provider 的 PREALLOCATION_BUDGET。
> 实现差异以如下清单为准；其他章节仍是目标契约，不得把待验证项当成已完成。
>
> **前置**：
> [HTTP 规范](./http.md)、[HTTP 引擎能力规范](./http-engine-capabilities.md)、
> [路由规范](./routing.md)、[参数绑定规范](./parameter-binding.md)、[安全规范](./security.md)、
> [Application Lifecycle Contract](./lifecycle.md)。
>
> **发布状态**：自 neton `1.0.0-beta24` 起，`neton-websocket` 与 netonstream 协议栈（`io:0.4.1`、`http/tls/websocket:0.3.0`、`openssl:4.0.2-3`）均以 beta 发布到 Maven Central，`neton-bom` 约束 `neton-websocket` 版本；本地源码目录只用于开发联调（§3）。

---

### r11 实施记录（历史；r12 目标契约优先）

- r8/r9 的模块合并是产品决定：默认 HTTP 引擎在 `neton-http`，默认 WebSocket provider 在 `neton-websocket`；不恢复 r7 的独立默认桥接模块。
- 本地主动正常关闭（包括 handler 返回）停止接受新消息，按 FIFO 排空已接受的出站消息，再写 Close。排空受写超时和关闭总期限约束；失败按异常关闭记录，不能声称正常送完。对端关闭、停机、故障可取消未发队列。
- 预算按有效载荷字节计费，入站分片累计其 payload 长度，出站按二进制长度或 UTF-8 长度。撤回 r10 的 8 倍计费；它不是进程内存上限，副本、String 表示、容量冗余、对象开销和固定编解码/TLS 缓冲均不计入 payload 预算。
- 启动要求 `maxMessageBytes <= maxQueuedBytesPerConnection <= maxBufferedBytes`；等预算不复用 writeTimeout。等待者由连接关闭唤醒并抛出普通 `WebSocketClosedException`，调用者主动取消仍保留协程取消语义。writeTimeout 只限制真正写出。
- 挂起发送者数量和保留量仅在快速预留失败后统计。消费停滞使用 1011，仅在入站队列不能立即接受时启动超时。
- 仍待测量/优化：全局预算等待者的广播唤醒、Default 与 reactor 业务调度的开销差异。此轮不把它们宣布为已解决。
- 验证：旧实现上新增的排空与 2 MiB 配置测试均失败（后者实际被启动校验拒绝，并非没有校验）；修复后 WebSocket 30、HTTP 196、Hyper4k 37、KSP 43 项通过，Linux x64/arm64 编译通过。覆盖预算等待超过写超时仍存活、独立调用者获得非取消关闭异常、精确分片计费、排空失败和中途强停。未做性能验收。

### r10 实施与验证记录（历史）

- `neton-http` 内置 `DefaultHttpAdapter`，`neton-websocket` 内置默认 provider，不再增加默认引擎桥接模块；HTTP 不依赖 WebSocket。
- 业务 handler 采用 Default 调度器；协议读取、写入、计时与关闭仍在连接执行器上。此选择尚无独立高并发性能优劣结论。
- 入站在分配前非阻塞预留；采用保守 charge：每分片 `8 * max(payloadBytes, 128)`，出站 `8 * payloadBytes`。它不是精确 RSS 统计，固定编解码/TLS 缓冲、业务保留消息与对象开销另计。极碎片消息可能提前触发 1013。
- 入站默认单方向 8 MiB、出站默认单方向 8 MiB，二者共同计入全局 512 MiB。发送等待者另有数量和保留字节上限；关闭不等待应用数据预算。
- 配置快照隔离启动后的外部修改；时间参数最大为 Int.MAX_VALUE 毫秒。压缩明确不支持，不会静默接受 compression=true。
- macOS 已运行协议与框架回归，包括真实 TCP 升级/echo、开启证书验证的 WSS 升级/echo、预读首帧、HTTP 配额释放、Origin、提前 Pong、超时与预算退出。注解示例的真实 KSP 输出已编译；Linux x64/arm64 编译通过。
- 本轮测试：WebSocket 框架 23、HTTP 196、Hyper4k 37、KSP 43、协议 WebSocket 250，均无失败。引擎清理抛异常时也验证了队列预算释放和 closed 完成。
- 待验收：Linux 实际运行、Windows、多核混合负载与普通 HTTP A/B 性能闸门；第三方适配器一致性测试仍需各自接入。没有发布、推送或修改 Arena PR。


## 一、范围

### 1.1 v1 交付

- HTTP/1.1 上的 `ws://` 与 `wss://`（RFC 6455）。
- **WebSocket 是独立的框架功能模块 `neton-websocket`**，可选引入。业务代码只依赖它的 API；换 HTTP 适配器或换 WebSocket 引擎，业务代码都不改。
- **升级前归 HTTP，升级后归 WebSocket**：路由、认证、Origin、握手拒绝走 HTTP 路径；升级之后由 WebSocket 会话管理，不再套用 HTTP 的请求超时、响应包装和请求配额，但仍受服务器统一停机管理。
- **WebSocket 引擎可替换**：通过 `WebSocketEngineProvider` 接入（§7.0）。v1 提供默认组合 `neton-http` + `neton-websocket`（内置自研 `com.netonstream:websocket`）；高级用户可以实现自己的 provider，通过一致性套件（§9.2）后即可替换。
- DSL `webSocket(...)` 与注解 `@WebSocket` 两种入口，**共用同一套注册流程**。
- 握手复用现有安全链：认证、Guard、`@Permission`、限流、路径参数绑定、`@CurrentUser`。
- Origin 校验（握手层拒绝，不依赖 CORS 响应头）。
- 有界收发、心跳、空闲超时、关闭握手、停机。
- 引擎能力声明与启动期校验：缺能力即启动失败。

### 1.2 v1 不做

| 项 | 原因 / 去向 |
|---|---|
| `WebSocketHub`（主题、广播、按用户推送） | 背压与交付语义需独立设计，见 §13.1，另立规范 |
| 类型化消息（JSON 转换、校验） | 作为可选扩展另行交付，见 §13.2 |
| HTTP/2 WebSocket（RFC 8441 extended CONNECT） | 握手模型不同于 101，作为独立能力另行验收 |
| HTTP/3 WebSocket（RFC 9220） | 依赖 h3 引擎接入，不在本期 |
| STOMP / 消息代理协议 | 不做 |
| hyper4k、Ktor 上的 WebSocket | v1 不提供：它们不声明 `PROTOCOL_UPGRADE`，也没有对应的 provider，注册了 WebSocket 路由时启动失败（§9）。日后实现时复用同一套运行时与一致性套件，hyper4k 的可行性见 §12 |
| `@OnOpen` / `@OnMessage` / `@OnClose` 生命周期注解 | 连接状态无处安放，见 §4.4 |

---

## 二、现状与依赖链

### 2.1 依赖链

```
业务：@WebSocket / routing { webSocket(...) }
                 │
neton-websocket ─────── API、SPI、会话运行时、心跳、预算、关闭（引擎无关）
                 │ 经由 neton-core 的升级扩展点接入路由与分发
neton-http ───────────── 路由、安全链、握手拒绝响应、把"接受升级"交给适配器（不认识 WebSocket）
                 │
HTTP 适配器 ──────────── 写 101、交接底层连接（声明 PROTOCOL_UPGRADE）
                 │
WebSocketEngineProvider ─ 把交接出的连接接到具体的 WebSocket 协议实现
                 │
协议库 ──────────────── 帧、分片、掩码、压缩、协议状态机
```

**依赖单向**（禁止反向）：

```
neton-websocket ─→ neton-http ─→ neton-core
       ├─→ neton-routing（路由集成阶段引入）
       └─→ com.netonstream:websocket（内置默认 provider）
```

- `neton-core`、`neton-http`、各 HTTP 适配器**都不依赖** `neton-websocket`，也不引用任何 WebSocket 类型。HTTP 分发器只通过 `neton-core` 中与协议无关的升级扩展点（§5.1）调用已注册的端点。
- 不使用 WebSocket 的应用不引入 `neton-websocket`，也不引入协议库 `com.netonstream:websocket`。
- `neton-http` 同时承载公共 HTTP 集成与内置引擎，但两者仍分包隔离：公共分发器不引用默认引擎的具体类型。`DefaultHttpAdapter` 位于 `neton.http.engine.default`，依赖自研 `io/http/tls`；`HttpEngineConformanceSuite` 仍约束所有适配器。
- 引入 `neton-http` 会带上内置引擎的构建依赖，即使选择 Hyper4k 也不自动移除它们；不承诺链接器完全消除相关体积。WebSocket 模块仍然可选，HTTP 模块不反向依赖它。

普通 ws/wss 不需要 `quic` 与 `http3`。

### 2.2 底层已具备的能力（已核对源码）

| 能力 | 位置 |
|---|---|
| RFC 6455 协议、permessage-deflate；Autobahn 双向各 517 例零失败 | `websocket/README.md` |
| h1 服务端升级：`OnUpgrade` 放入请求 `extensions`，101 写出后 `fulfill(Upgraded(stream, rest))` | `http/.../h1/Server.kt:279,438` |
| 开启升级的连接服务入口 `serveConnectionWithUpgrades` | `http/.../auto/Auto.kt:108` |
| 握手响应 `createResponse`、接管升级连接 `WebSocket.fromUpgraded`（携带预读字节） | `websocket/.../WebSocket.kt:425` |

### 2.3 必须遵守的底层契约（已核对源码）

| 契约 | 来源 | 对框架的约束 |
|---|---|---|
| 连接只能在创建它的 reactor 线程上使用，内部无锁 | `WebSocket.kt:60` | 协议读写固定在所属 reactor（§7） |
| 同一时刻最多一个 `receive`、一个写操作，并发第二个抛 `IllegalStateException` | `WebSocket.kt:38` | 单一协议读取者（§7.3）；单一出站 FIFO 与写串行器（§7.4） |
| 写驱动协程使用**独立 Job**，不随创建方取消 | `WebSocket.kt:435` | 框架必须显式关闭连接，不能只靠取消（§7.7） |
| `close()` 只发起关闭握手，须继续 `receive` 直到返回 null | `WebSocket.kt:250` | 关闭需要等待期限与强制释放（§8.2） |
| 握手不检查 `Host` 与 `Origin` | `handshake/ServerHandshake.kt:36` | 框架自行校验 Origin（§6.3） |
| `Upgraded` 只在 101 写出、该次 HTTP 交换结束后才可用 | `h1/Server.kt:435` | **不得在返回 101 之前等待 `upgradeOn()`**（§7.2） |
| 默认 `maxMessageSize` 64 MiB、`maxFrameSize` 16 MiB；`sendCloseOnProtocolError = false` | `WebSocketConfig.kt:32-51` | 框架必须覆盖这些默认值（§10.1） |

### 2.4 框架当前状态（复核基线：neton beta26 / `7290d85`）

| 状态 | 位置/后续 |
|---|---|
| 有升级路由时使用支持升级的服务入口，保留 extensions 与预读数据 | `DefaultHttpAdapter.kt`，已有真实 TCP/WSS 测试 |
| Session 暴露独立 HandshakeInfo 和 awaitClosed，不暴露 HttpContext/共享 Deferred | HandshakeSnapshotTest、RuntimeTest 的多观察者取消与关闭测试 |
| handler 固定在 Default，协议操作回连接执行器 | `ManagedWebSocketSession.kt`，功能已运行，性能选择未验收 |
| 正常关闭排空、payload 预算、非取消关闭异常及 CloseResult 已实现 | RuntimeTest 覆盖空 Close、强停、排空失败、业务 finally 等待关闭 |
| Origin 在握手前拒绝，握手参数/身份与 HTTP 请求脱离 | ServerIntegrationTest、HandshakeSnapshotTest |
| Handler 对象接口和路由级 InboundPolicy 已实现 | WebSocketHandler、BACKPRESSURE/REJECT_DATA/DISCARD_DATA；EngineConformanceTest |
| 已对齐 `io:0.3.2 / http:0.2.0 / tls:0.2.0`，默认使用相邻源码 composite build；普通 HTTP 性能出口仍需实测 | `neton-http/build.gradle.kts`、`settings.gradle.kts` |

### 2.5 职责划分：哪些靠配置，哪些要框架实现

底层库提供**协议能力**，框架负责**连接管理**；业务用户只写 `webSocket { session -> … }` 和配置项，**不写心跳循环、不处理控制帧**。

| 能力 | 底层库已提供（已核对源码） | 框架必须实现的部分 | 业务用户 |
|---|---|---|---|
| Ping / Pong | 发送 Ping；解析 Pong；**读取时自动回复对端的 Ping**（`WebSocket.kt:27`） | 定时发 Ping、匹配 Pong、超时判定（§10.2）。`WebSocketConfig` **没有任何心跳或超时配置** | 只配参数 |
| 关闭握手 | Close 帧编解码与协议状态机 | 关闭期限、超时强制回收、取消业务协程（§7.7、§8） | 调用 `close()` 或直接返回 |
| 消息与帧大小、压缩 | `maxMessageSize`、`maxFrameSize`、permessage-deflate | 映射配置并设置服务端默认值（§10.1） | 只配参数 |
| 定时器 | io 的 reactor 本身是 `CoroutineDispatcher` + `Delay`，用最小堆加时间轮实现（`neton-io/.../net/Reactor.kt:82,247`） | 心跳、超时都用 reactor 上的定时器，**不为每条连接创建线程** | — |
| 空闲连接内存 | io 的池化 `Buffer` 首次写入时才取数组，reactor 的空闲扫描通过 `releaseIfIdle` 归还挂起读的数组（`neton-io/.../bytes/Buffer.kt:9-12`） | **需实测**：websocket 编解码器自己的读写缓冲是否被空闲扫描覆盖；按空闲成本与恢复成本两组数字决定保留、缩容还是归还（§10.4） | — |
| 高并发连接管理 | 异步网络与协议收发 | 准入、单连接与全局预算、慢消费者与写阻塞处理、停机（§7.3、§7.4、§7.6、§8.3、§10.3） | 只配参数 |
| 入站数据预算 | 本地协议库已增加分配前可拒绝 hook 和终止丢弃模式 | 保持 payload 租约记账；r12 活跃连接增量拒绝/丢弃仍需单独扩展，不能复用终止模式冒充完整支持 | — |

结论：**不是"配置底层库就够了"**。协议层无需重写，但保活、超时、预算、回收这一层由框架实现；做完之后，业务侧只需要配置。

---

## 三、开发依赖方式：本地源码目录

> **2026-10-20 更新**：集成阶段已结束，§3.4 闸门已在 `1.0.0-beta24` 走完。`neton-websocket` 作为可选模块以 beta 发布
>（`core`/`http`/`neton` 聚合模块仍不得依赖它，由 `verifyWebSocketBoundaries` 守住），默认 provider 即内置 netonstream
> websocket。下文 §3.1–§3.3 保留为**开发期源码替换**的说明：`netonstream.local=true` 只影响本地构建，发布任务在它开启时拒绝执行，
> 发布时传 `-Pnetonstream.local=false`（neton `RELEASING.md`）。文中的旧版本号为当时记录，以 neton 构建脚本为准。

### 3.1 规则

1. ~~本阶段**不发布** `io`、`http`、`tls`、`openssl`、`websocket`、`neton` 的任何版本。~~（集成阶段规则，已随 beta24 发布失效。）
2. neton 通过 Gradle **composite build** 直接使用兄弟目录的源码：
   `../io`、`../http`、`../tls`、`../websocket`。
   `openssl` 例外：默认使用 `tls` 已钉住的已发布版本 `com.netonstream:openssl:4.0.2`，**不是新发布**。原因见 §3.3。需要时用 `-Pnetonstream.local.openssl=true` 改为本地源码。
3. **禁止** `mavenLocal()`。沿用现有约定：适配器构建脚本注释已写明 "never an implicit mavenLocal fallback"。
4. 本地源码替换与 `netonstream.repository`（发布验证用的 staging 仓库）**互斥**，同时开启时构建报错。这与 `hyper4k.local` / `hyper4k.repository` 的互斥规则一致。

### 3.2 开关与默认值

```properties
# neton/gradle.properties —— 本阶段默认开启，显式写在仓库里，不靠隐式探测
netonstream.local=true
```

```kotlin
// neton/settings.gradle.kts
val useLocalNetonstream = providers.gradleProperty("netonstream.local").orNull == "true"
require(!useLocalNetonstream || !providers.gradleProperty("netonstream.repository").isPresent) {
    "Choose netonstream source substitution OR artifact verification, not both."
}
if (useLocalNetonstream) {
    for (dir in listOf("../io", "../http", "../tls", "../websocket")) {
        require(file(dir).isDirectory) { "netonstream.local=true requires $dir" }
        includeBuild(dir)
    }
    if (providers.gradleProperty("netonstream.local.openssl").orNull == "true") {
        includeBuild("../openssl-kotlin")
    }
}
```

所有库都通过 `allprojects { group = "com.netonstream" }` 设置坐标，composite build 会把整个构建图中的 `com.netonstream:*` 依赖替换为源码，**包括库与库之间的依赖**。例如 `websocket` 依赖的 `http:0.2.0` 也会被替换。

### 3.3 已知代价与风险

- **`openssl` 默认不走本地源码**（2026-10-09 实测）：openssl-kotlin 不加 `-PnativeTargets=all` 时只构建宿主目标，而 `tls` 声明了全部 10 个目标。替换后 tls 的其余 9 个目标无从解析，构建失败。若构建全部 10 个目标，需要用 NDK、iOS SDK、MinGW 工具链从源码编译 OpenSSL。openssl-kotlin 只是上游 OpenSSL 的绑定，本轮不改动它，因此默认使用已发布的 4.0.2。
- 已用 `dependencies` 核实替换生效：`io`、`http`、`tls`（含 tls 自身对 io 的依赖）均解析为 `project :io:io` / `:http:http` / `:tls:tls`。
- ~~`tls` 按 `io:0.1.0` 编写~~：`tls` 仓库已升到 0.2.0，依赖 `io:0.3.2`，此项风险已消除（2026-10-09 核对）。
- 适配器的 `checkNetonHttpPackageClash` 原本读取 `http` 已发布的 sources jar；源码替换下没有该 jar，改为在 `netonstream.local=true` 时读取 `../http/http/src/*Main`，规则不变。
- 坐标中的版本号在源码替换下不起作用，但仍须改写为与本地源码一致的版本，避免误读：`io:0.3.2`、`http:0.2.0`、`tls:0.2.0`、`websocket:0.2.0`。

### 3.4 恢复发布前的闸门

本阶段结束、准备发布时，必须依次完成：

1. 按依赖顺序发布各库：`io` → `openssl`（如有变化）→ `tls` → `http` → `websocket`。
2. neton 关闭 `netonstream.local`，坐标改为刚发布的版本。
3. 用 `netonstream.repository` 指向 staging 仓库，完整验证一遍。
4. 走既有的 [Release Gate](./release-gate.md)。

`netonstream.local=true` 的提交不得进入发布分支。

---

## 四、API

### 4.0 安装与引擎选择

HTTP 与 WebSocket 都采用**固定默认工厂、显式替换**，不依赖 `ServiceLoader`。`neton-http` 提供 `DefaultHttpAdapter`，`neton-websocket` 提供 `DefaultWebSocketEngineProvider`。旧的 HTTP 兜底重载与 Hyper4k 默认重载已移除；第三方不得通过提供同名默认重载来改变选择。以下握手快照、Handler 重载和策略参数已实现，实际验收范围以测试与本规范实施记录为准：

```kotlin
Neton.run(args) {
    http { }                            // neton-http 内置 DefaultHttpAdapter

    websocket { }                       // neton-websocket 内置默认 provider
    // websocket(::MyWebSocketEngineProvider) { }   // 显式替换引擎

    routing {
        webSocket("/echo") { session -> session.incoming.collect { session.send(it) } }
    }
}
```

- `neton-websocket` 提供一个带默认工厂参数的 `websocket(providerFactory = ...) { }`，不设报错兜底重载、不设独立默认桥接模块。
- 引入本模块就带上默认协议库的构建依赖；显式替换 provider 不会自动移除该依赖。不使用 WebSocket 时无需引入本模块。
- 配置来自 `application.conf` 的 `[websocket]` 段（§10）；保持当前实现的文件配置覆盖安装块默认值，启动时验证并冻结为内部快照。
- 注册了 WebSocket 路由却没有安装 `websocket { }`：启动失败，列出相关路由。

### 4.1 DSL

```kotlin
routing {
    get("/health") { ctx -> "ok" }

    webSocket("/echo") { session ->
        session.incoming.collect { message ->
            session.send(message)
        }
    }

    webSocket("/chat/{room}") { session ->
        val room = session.handshake.pathParam("room")!!
        var count = 0                         // 连接级状态 = 局部变量
        try {
            session.incoming.collect {
                count++
                session.send("[$room] #$count")
            }
        } finally {
            // 释放这一条连接的业务资源
        }
    }
}
```

签名：

```kotlin
fun webSocket(
    path: String,
    subprotocols: List<String> = emptyList(),   // 与 @WebSocket(subprotocols = …) 等价
    inboundPolicy: InboundPolicy = InboundPolicy.BACKPRESSURE,
    handler: suspend (WebSocketSession) -> Unit,
)

fun interface WebSocketHandler {
    suspend fun handle(session: WebSocketSession)
}

// 对象必须是第二个参数；不新增同位置末尾 SAM/lambda 重载。
fun webSocket(
    path: String,
    handler: WebSocketHandler,
    subprotocols: List<String> = emptyList(),
    inboundPolicy: InboundPolicy = InboundPolicy.BACKPRESSURE,
)

enum class InboundPolicy { BACKPRESSURE, REJECT_DATA, DISCARD_DATA }

// chatHandler 由应用的 DI 创建；注册不隐式构造类、不按反射寻找类型。
// webSocket("/chat", chatHandler)
```

显式写出 `session ->`，与现有 `get { ctx -> }` 的风格一致。DSL 与注解的能力必须一一对应，任何一方新增参数时另一方同步提供。

所有入口最终归一到 `suspend (WebSocketSession) -> Unit`，不建立另一套 Listener 生命周期。
上面的两个重载必须通过 §9.2 的编译测试才可接纳；不得以破坏已有尾随 lambda 或函数引用写法为代价追求少写 `::handle`。

### 4.2 注解

```kotlin
@Controller("/chat")
@RequireAuth
class ChatController(private val chat: ChatService) {

    @WebSocket("/{room}")
    suspend fun connect(
        session: WebSocketSession,
        room: String,                 // 按参数名绑定路径参数，与 HTTP 方法一致，不需要 @PathVariable
        @CurrentUser user: Identity,
    ) {
        chat.serve(room, user, session)
    }
}
```

KSP 编译期校验，违反任一条时**编译失败**：

- 方法必须是 `suspend`，返回 `Unit`。
- 恰好有一个 `WebSocketSession` 参数。
- 不得有 `@Body`、`@FormParam`、上传文件参数，握手请求没有请求体。
- 同一路径不得同时注册 `@WebSocket` 和 `@Get`。

Controller 由现有依赖注入创建，不要求继承基类。连接状态放在方法的局部变量里，不放在 Controller 字段中（Controller 是单例）。

### 4.3 会话接口

```kotlin
package neton.websocket   // neton-websocket 模块

import neton.core.interfaces.Identity

interface WebSocketSession {
    val handshake: HandshakeInfo
    val subprotocol: String? get() = handshake.subprotocol
    val incoming: Flow<WebSocketMessage>
    suspend fun send(message: WebSocketMessage)
    suspend fun send(text: String) = send(WebSocketMessage.Text(text))
    /** 发起关闭并停止接受新消息，不等待完整关闭；正常关闭先排空已接受消息。 */
    suspend fun close(code: Int = 1000, reason: String = "")
    /** 只观察最终结果；取消某个等待者不影响连接或其他等待者。 */
    suspend fun awaitClosed(): CloseResult
}

interface HandshakeInfo {
    val path: String
    val peerAddress: String            // transport 对端，不由转发头推导
    val isSecure: Boolean             // 实际 transport TLS 状态
    val subprotocol: String?
    val identity: Identity?          // 框架创建的独立只读快照，不是原身份对象
    fun pathParam(name: String): String?
    fun queryParams(name: String): List<String>
    fun headerValues(name: String): List<String> // 仅显式保留的头，名称不区分大小写
}

sealed interface WebSocketMessage {
    class Text(val value: String) : WebSocketMessage
    /** 不在构造时复制。send 结束前不得修改；框架在预留后复制。 */
    class Binary(val bytes: ByteArray) : WebSocketMessage
}
```

约束：

- **包名为 `neton.websocket`**。协议库 `com.netonstream:websocket` 已占用 `neton.websocket` 包，两个产物共用一个包会重现 `neton.http` 现在需要专门冲突检查（`checkNetonHttpPackageClash`）才能防住的问题，因此框架模块从一开始就使用独立的包。
- **不暴露**协议库（`neton.websocket.*`）的任何类型，也不暴露 Ping、Pong、Close 帧。控制帧由框架与引擎处理。
- `incoming` 使用标准 `Flow`，不再引入自定义迭代器；它是可续读的单消费者消息源，不是可重放流或广播流，具体取消边界见 §7.3。
- `trySend`、`sendAndFlush` 和投递回执不进入本轮最小 API；未来扩展不能改变 `send` 的接受语义。
- 数据所有权：见 §7.4。`send` 正常返回或抛出后，调用方都可复用原数组；实现必须保证仍在写出的数据不再引用它。
- `close` 的 `reason` 超过 123 字节时抛 `IllegalArgumentException`（RFC 6455 §5.5 限制）。

#### 4.3.1 快照与保留边界

- 101 之前，从已完成鉴权/参数绑定的 HTTP 请求生成独立快照。不得保留 `HttpContext`、`HttpResponse`、可写 attributes、请求体、原始 Identity 对象或捕获它们的查询闭包。
- 路径、路径参数、查询参数与身份的 id/roles/permissions 按值复制。集合必须深拷贝并防止修改内部状态；Kotlin `List`/`Set` 类型本身不等于不可变，getter 返回防御性副本或真正不可变实现。
- 身份快照由框架内部的不可变实现实现 `neton.core.interfaces.Identity`，不新增公开的 HandshakeIdentity 平行类型。业务可继续调用 hasRole、hasPermission、hasAnyRole、hasAllRoles、hasAnyPermission、hasAllPermissions；这些方法只基于快照集合，沿用 Identity 的默认语义。
- 禁止通过 `Identity by original` 或闭包转发实现快照。原对象重写的权限方法、自定义 PermissionEvaluator、额外业务字段不复制、不调用；本接口复用的是数据与集合判断契约，不是动态授权机制。需要动态权限的业务必须显式调用自己的授权服务。
- `handshakeHeaderNames` 是全局显式白名单，默认空集；不自动保留 Cookie、Authorization 或所有请求头。必要字段可显式配置，但不得因此自动记录到日志。鉴权和 Origin 检查使用完整 HTTP 请求，不受保留白名单影响。
- 增加 `maxHandshakeSnapshotBytes`（默认 65536），按保留字符串 UTF-8 字节累计，复制前检查；超限在 101 前返回 503，原因记 resource pressure，预留配额回滚。该值限制保留数据量，不是堆大小；快照数量受连接数上限约束。
- `@CurrentUser` 仍允许应用在握手前绑定自身的业务对象；应用保留该对象的生命周期和内存由应用负责，不等于 Session 暴露原 HTTP context。
- 身份只描述握手时认证结果。连接建立后的令牌过期、撤权与房间权限仍由业务判断，必要时以 1008 关闭；不承诺快照权限永久有效。

#### 4.3.2 关闭结果类型

```kotlin
data class CloseFrameInfo(val code: Int?, val reason: String)

enum class CloseTrigger {
    LOCAL_NORMAL, APPLICATION, PEER, SERVER_SHUTDOWN, HANDLER_FAILURE,
    PONG_TIMEOUT, IDLE_TIMEOUT, CONSUMER_STALL, RESOURCE_PRESSURE,
    PROTOCOL_ERROR, TRANSPORT_FAILURE
}
enum class CloseTermination {
    HANDSHAKE_COMPLETE, PEER_EOF, TRANSPORT_FAILURE,
    WRITE_TIMEOUT, CLOSE_TIMEOUT, FORCED_ABORT
}
data class CloseResult(
    val trigger: CloseTrigger,
    val localRequest: CloseFrameInfo?, // 本地请求，不代表已写出
    val sent: CloseFrameInfo?,         // 完整写出才记录
    val received: CloseFrameInfo?,     // 未收到 Close 为 null
    val termination: CloseTermination,
) {
    val handshakeComplete: Boolean get() = sent != null && received != null
}
```

- `received == null` 与 `received.code == null` 不同：前者没有收到 Close，后者收到无状态码 Close。后者在诊断需要数字时可以显示 1005，但绝不伪装成 1000。
- 空 Close 的 reason 必须为空；不允许构造“没有 code 却带 reason”的线上表示。sent/received 记录的是已验证、不可变的帧信息。
- `1005/1006/1015` 只用于本地诊断，既不能作为 `close()` 的参数，也不能通过 SPI 写到线上。无状态码 Close 的回复由引擎负责，可以同样不带码；SPI 必须保留这个表达能力。
- `handshakeComplete` 只表示交换了 Close，不代表 1000、不代表业务成功、不代表对端确认所有应用消息。写失败/超时必须保留独立 termination，不可因已请求 1000 被覆盖。
- 第一个触发原因建立结果；正常排空被停机/故障打断时记录升级后的触发原因和实际写出的帧，不再冒充正常完成。结果发布后不可修改，多观察者得到相同值。

### 4.4 不采用的写法

- **不增加第二套 `@OnOpen` / `@OnMessage` / `@OnClose` 生命周期**：并非回调模型不能正确管理状态，而是本框架统一使用一个挂起函数，减少两套生命周期之间的歧义。局部状态和 `finally` 配合有界清理；不承诺取消能强制终止任意业务代码。
- **把底层 `WebSocket` 直接交给业务**：会把 reactor 线程约束和单读单写约束暴露给用户。

---

## 五、注册与路由模型

### 5.1 升级扩展点（`neton-core`，与协议无关）

`neton-core` 只增加一个**与具体协议无关**的升级扩展点。HTTP 层通过它处理所有升级路由，不认识 WebSocket：

```kotlin
package neton.core.http.upgrade

/** 一条路由声明的协议升级。HTTP 分发器只认识这个接口。 */
interface UpgradeEndpoint {
    /** 协议标识，对应 Upgrade 请求头，如 "websocket"。 */
    val protocol: String

    /**
     * 在安全链、限流、参数绑定**之后**调用（§6.1）。只做决策：不得等待连接交接，
     * 不得写响应。返回拒绝（普通 HTTP 响应）或接受（101 的响应头 + 交接回调）。
     */
    suspend fun decide(context: HttpContext, args: HandlerArgs): UpgradeDecision
}

sealed interface UpgradeDecision {
    /** 以普通 HTTP 响应结束，连接不升级。 */
    class Reject(
        val status: Int,
        val headers: Map<String, List<String>> = emptyMap(),
        val body: ByteArray = ByteArray(0),
    ) : UpgradeDecision

    /**
     * 接受。适配器写出 101（带 [headers]），完成交接后在连接的执行上下文上调用 [onUpgraded]；
     * 交接失败时调用 [onFailed]，由端点回滚它预留的资源（§7.6）。两者恰好调用其一。
     */
    class Accept(
        val headers: Map<String, List<String>>,
        val onUpgraded: suspend (UpgradedConnection) -> Unit,
        val onFailed: (Throwable) -> Unit,
    ) : UpgradeDecision
}

/** HTTP 适配器交接出的底层连接。具体形态由适配器定义。 */
interface UpgradedConnection {
    /** 连接的执行上下文，必须实现 kotlinx.coroutines.Delay。 */
    val executor: CoroutineDispatcher
    /** 按类型取出适配器交接的具体形态；provider 只取它认识的类型，取不到返回 null。 */
    fun <T : Any> unwrap(type: KClass<T>): T?
    /** 关闭底层连接，归还 TCP 配额（§7.6）。幂等。 */
    fun close()
}
```

`RouteDefinition`（`neton-core/.../interfaces/RequestEngine.kt`）只增加一个与协议无关的字段：

```kotlin
data class RouteDefinition(
    ...
    val upgrade: UpgradeEndpoint? = null,   // 非 null 即为升级路由
)
```

- `allowAnonymous`、`requireAuth`、`routeGroup`、`permission`、`rateLimit`、`parameterBindings` 沿用 HTTP 路由的含义，不另起一套。
- 升级路由的 `method` 固定为 GET；`handler` 字段由框架填入固定实现：收到**不带升级头**的普通 GET 时返回 `426 Upgrade Required`，并带 `Upgrade: <protocol>`。
- `neton-http` 的分发器对 `upgrade != null` 的路由执行 §6.1 的公共步骤（方法、升级头、安全链、限流、参数绑定），再调用 `decide`，把 `Accept` 作为一种**独立的分发结果**交给适配器，不走普通响应的包装、压缩与请求超时流程（§7.2）。

### 5.2 WebSocket 路由（`neton-websocket`）

`neton-websocket` 提供 `UpgradeEndpoint` 的 WebSocket 实现，DSL 与注解都生成它，**只有这一种注册形态**：

```kotlin
package neton.websocket

internal class WebSocketEndpoint(
    // HTTP 参数绑定只在升级前执行，结果是一个连接处理函数。
    val prepare: suspend (HttpContext, HandlerArgs) -> suspend (WebSocketSession) -> Unit,
    val subprotocols: List<String>,
    val inboundPolicy: InboundPolicy,
    private val runtime: WebSocketRuntime,
) : UpgradeEndpoint {
    override val protocol = "websocket"
    override suspend fun decide(context: HttpContext, args: HandlerArgs): UpgradeDecision =
        runtime.decide(this, context, args)   // §6.1 第 3、4、8、9 步，§7.0
}

// 业务 WebSocketHandler 见 §4.1，不暴露 HandlerArgs，也不是引擎 provider。
```

- DSL：`neton-websocket` 为路由 DSL 提供扩展函数 `webSocket(path, subprotocols) { session -> }`（§4.1）。
- 注解：`@WebSocket` 定义在 `neton-websocket`。`neton-ksp` 按注解的全限定名识别，生成带 `upgrade = WebSocketEndpoint(...)` 的 `RouteDefinition`；未引入 `neton-websocket` 的工程不会生成这类代码。

```kotlin
annotation class WebSocket(
    val value: String = "",
    val subprotocols: Array<String> = [],
    val inboundPolicy: InboundPolicy = InboundPolicy.BACKPRESSURE,
)
```

### 5.3 能力登记

注册任意一条 WebSocket 路由，都会登记两项要求，来源记为该路由，例如 `WebSocket /chat/{room} (ChatController.connect)`：

1. HTTP 适配器须声明 `HttpCapability.PROTOCOL_UPGRADE`（§9.1）；
2. 已安装 `websocket { }`，且其 provider 与当前 HTTP 适配器兼容（`supports(adapter)`，§7.0）。

---

## 六、握手

### 6.1 处理顺序

命中 WebSocket 路由的请求按以下顺序处理。任一步失败都以**普通 HTTP 响应**结束，连接**不**升级：

| 步骤 | 失败时的响应 |
|---|---|
| 1. 方法必须是 GET | 405 |
| 2. 请求头必须带 `Upgrade: websocket`，`Connection` 含 `Upgrade` | 426，带 `Upgrade: websocket` |
| 3. `Sec-WebSocket-Version: 13` | 426，带 `Sec-WebSocket-Version: 13` |
| 4. Origin 校验（§6.3） | 403 |
| 5. 安全链：认证、Guard、`@Permission` | 401 / 403（与 HTTP 路由相同） |
| 6. 限流 | 429（与 HTTP 路由相同） |
| 7. 参数绑定（路径参数、`@CurrentUser`、`@Header`、`@Query`） | 400（与 HTTP 路由相同） |
| 8. 准入：WebSocket 配额、全局缓冲预算（§7.6、§10.3）；预留配额并登记为 pending（§8.3）；draining 状态下拒绝 | 503 |
| 9. 子协议、压缩协商，生成 101（`createResponse`） | 400（握手头非法） |

第 5 至 7 步复用 HTTP 路由的现有实现，不复制代码。

### 6.2 子协议

客户端 `Sec-WebSocket-Protocol` 列表与路由声明的 `subprotocols` 取交集，按**服务端声明顺序**选第一个。交集为空时不返回该响应头，握手照常进行（RFC 6455 §4.2.2）。路由未声明子协议时，忽略客户端的请求。

### 6.3 Origin 校验

不依赖 CORS。WebSocket 不受同源策略保护，CORS 响应头挡不住跨站 WebSocket 劫持（RFC 6455 §10.2）。

| 请求的 Origin | 默认行为 |
|---|---|
| 与 Host 同源（scheme、主机、端口一致） | 允许 |
| 在 `allowedOrigins` 列表中 | 允许 |
| 其他任何值 | **403** |
| `null` | **403**；仅当 `allowedOrigins` 显式包含 `"null"` 时允许 |
| 缺失 | 允许。非浏览器客户端不发送 Origin，跨站劫持只可能来自浏览器 |

- `allowedOrigins = ["*"]` 表示允许任意 Origin，必须显式配置。如果同时使用 Cookie 认证，启动时打 WARN。
- 同源比较中的 Host 只取请求的 `Host` 头，不信任 `X-Forwarded-Host`。部署在反向代理之后时，用 `allowedOrigins` 显式列出对外域名。

### 6.4 握手鉴权的边界

握手鉴权只决定"能不能建立连接"。连接建立之后的授权由应用负责，比如能否加入某个房间、能否发布、令牌过期后如何处理。框架提供 `close(1008, reason)` 作为统一的踢出方式，不自动重验令牌。Session 只保留 §4.3.1 的握手快照。

---

## 七、线程与所有权模型

### 7.0 分层与引擎替换

**策略只实现一次，机制由引擎提供。** "多久没收到 Pong 就关闭"由框架决定；实际写出 Ping、报告收到的 Pong、确认写出完成，由引擎负责。引擎**不得**自行定义超时、预算、关闭码等语义；框架也**不得**重复执行引擎已经负责的协议行为。

**参考**：引擎替换的结构借鉴 Spring Framework 的 `HandshakeWebSocketService` → `RequestUpgradeStrategy`（公共握手服务与服务器专属的升级机制分离）；业务入口借鉴 Axum 的路由内升级（`WebSocketUpgrade`），保持一个挂起函数对应一条连接。借鉴的是职责划分，不照搬 Spring 的继承体系。

#### 7.0.1 模块职责

| 模块 | 负责 |
|---|---|
| `neton-core` | 与协议无关的升级扩展点（§5.1）、`HttpCapability.PROTOCOL_UPGRADE`。不含任何 WebSocket 类型 |
| `neton-http` | 路由、安全链、握手拒绝响应、把 `Accept` 交给适配器。不认识 WebSocket |
| HTTP 适配器 | 写 101、交接底层连接、提供执行上下文、关闭底层连接（§7.2） |
| **`neton-websocket`** | 业务 API（§4）、`@WebSocket` 与 DSL、引擎 SPI（下文）、会话运行时：握手策略、单一读循环、出站 FIFO、心跳、预算、配额、关闭、停机；一致性套件（§9.2） |
| `neton-websocket` 内部的 `engine/default` 包 | 默认 provider：把默认 HTTP 适配器交接出的连接接到 `com.netonstream:websocket` |
| 协议库 | 帧、分片、掩码、压缩、协议状态机 |

#### 7.0.2 引擎 SPI（`neton-websocket`）

三个角色，用**接口组合**，不要求继承抽象基类；出现重复实现时再提供可选的辅助基类：

| 角色 | 使用者 | 职责 |
|---|---|---|
| `WebSocketSession` | 业务 | 收发、关闭、握手信息（§4.3） |
| `WebSocketEngineProvider` | 第三方实现、框架装配 | 与 HTTP 适配器的兼容性检查、握手的协议部分、在交接后创建引擎连接 |
| `WebSocketEngineConnection` | 框架运行时（内部） | 读取事件、写出确认、丢弃模式、强制断开、执行上下文 |

```kotlin
package neton.websocket.spi

typealias WebSocketEngineProviderFactory = () -> WebSocketEngineProvider

interface WebSocketEngineProvider {
    val name: String

    /** 启动期调用：能否与该 HTTP 适配器组合。不兼容时启动失败（§9.1），不等到第一次连接。 */
    fun supports(adapter: HttpAdapter): Boolean

    /**
     * 握手的**协议**部分：校验 Sec-WebSocket-Key / Version，计算 Sec-WebSocket-Accept，
     * 协商扩展（如 permessage-deflate）。不做策略（Origin、鉴权、子协议选择都由运行时完成）。
     */
    fun handshake(request: HttpRequest, offer: HandshakeOffer): HandshakeResult

    /** 交接完成后在连接的执行上下文上调用，创建引擎连接。 */
    suspend fun open(
        connection: UpgradedConnection,
        negotiated: Negotiated,
        limits: EngineLimits,          // 来自 §10.1：消息、帧、缓冲大小
    ): WebSocketEngineConnection
}

class HandshakeOffer(val subprotocol: String?) // v1 不协商压缩
sealed interface HandshakeResult {
    class Ok(val headers: Map<String, List<String>>, val negotiated: Negotiated) : HandshakeResult
    class Invalid(val status: Int, val reason: String) : HandshakeResult
}

/** 一条已完成升级的引擎连接。所有方法只能在 [executor] 上调用；运行时保证这一点。 */
interface WebSocketEngineConnection {
    val executor: CoroutineDispatcher   // 即 UpgradedConnection.executor

    /**
     * 读取下一个事件；同一时刻只有一个调用者（运行时的读循环）。
     * 数据消息的**每一次**内存分配之前调用 [budget].tryReserve；失败时不得继续分配，
     * 抛出 WebSocketCapacityException（§10.3.1）。返回 null 表示连接已结束。
     */
    suspend fun receive(budget: ByteBudget): WebSocketEngineEvent?

    /** 写出完成（flush）后才返回。 */
    suspend fun writeData(message: WebSocketMessage)
    suspend fun writePing(payload: ByteArray)
    suspend fun writeClose(code: Int?, reason: String) // null 表示空 Close，不是 1005

    /** 此后数据负载直接跳过，不物化、不申请预算（§7.3）。 */
    fun discardData()

    /** 强制断开，不发关闭帧。幂等；必须使挂起中的 receive 与 write 立即结束。 */
    fun abort()
}

sealed interface WebSocketEngineEvent {
    class Data(val message: WebSocketMessage, val lease: BudgetLease) : WebSocketEngineEvent
    class Pong(val payload: ByteArray) : WebSocketEngineEvent
    class CloseReceived(val code: Int?, val reason: String) : WebSocketEngineEvent
}
```

#### 7.0.3 唯一负责方

每项行为只有一个负责方，**不重复执行**：

| 行为 | 唯一负责方 | 另一方不做什么 |
|---|---|---|
| 回复对端的 Ping | 引擎（在 `receive` 内部） | 运行时不另发 Pong，Ping 也不作为事件上报 |
| 回应对端发起的关闭帧、协议状态校验 | 引擎 | 运行时不重复回应关闭帧，只接收 `CloseReceived` 事件 |
| 何时主动关闭、关闭码、关闭期限、超时强制断开 | 运行时 | 引擎不自行超时关闭 |
| 何时发 Ping、Pong 匹配、心跳超时 | 运行时 | 引擎不自行发心跳 |
| 写出 Ping 与关闭帧 | 引擎（`writePing` / `writeClose`） | 运行时不直接写字节 |
| 帧大小、消息大小、UTF-8 校验 | 引擎（按 `EngineLimits`） | 运行时不重复校验，只按异常类型映射关闭码（§8.1） |
| 预算上限与拒绝策略 | 运行时（实现 `ByteBudget`） | 引擎只在分配前询问，不做决策 |
| 握手的协议部分（Accept 计算、扩展协商） | provider | 运行时不计算 Accept |
| 握手策略（Origin、鉴权、子协议选择、配额） | 运行时与 HTTP 安全链 | provider 不做策略 |

#### 7.0.4 兼容性与替换的边界

- **HTTP 引擎与 WebSocket 引擎不保证任意组合**。有的 HTTP 引擎能交出字节流，有的只能交出它自己的 WebSocket 会话。`supports(adapter)` 与 `UpgradedConnection.unwrap(...)` 就是为此设计的：provider 声明自己支持哪些适配器、取用哪种交接形态。兼容性在**启动时**检查，不在第一次连接时才发现。
- **分配前可拒绝的预留是本规范额外提出的严格要求**，不是业界 WebSocket 实现普遍具备的能力。接入第三方引擎可能需要较大改造；做不到就不能通过一致性套件。因此**不承诺**"换一个 HTTP 引擎就天然支持 WebSocket"。
- 运行时运行在 `UpgradedConnection.executor` 上，**不强制切换到 `Dispatchers.Default`**，公共逻辑放在框架层不增加线程跳转。
- 普通用户使用默认组合，不接触 SPI；高级用户用 `websocket(::MyProvider) { }` 替换引擎，通过 `WebSocketEngineConformanceSuite` 后业务代码无需变化。

### 7.1 角色

```
一条 WebSocket 连接 =
  会话运行时的连接协程（neton-websocket，在 UpgradedConnection.executor 上，所有者）
    ├─ WebSocketEngineConnection（provider.open 创建；默认 provider 中包装 WebSocket.fromUpgraded 的结果）
    ├─ 读循环（唯一调用 receive 的地方）──→ 入站缓冲（有界）──→ incoming
    ├─ 出站队列（有界，线程安全，单一 FIFO）──→ 写串行器 ──→ writeData / writePing / writeClose
    ├─ 心跳与超时计时（executor 的定时器）
    └─ 业务处理协程（handler）
```

框架运行时的连接协程是**唯一所有者**，负责：读循环、写入串行化、心跳、关闭握手、超时强制释放、三类配额的归还（§7.6）。业务处理协程只通过 `incoming` 与出站队列和连接交互，**从不直接调用引擎连接**。provider 与 HTTP 适配器只提供各自的原语（交接、读写、断开），不持有任何策略状态。

### 7.2 升级时序

下图以默认组合（netonstream 适配器 + netonstream provider）为例。**其他适配器必须满足相同的约束**：先返回 101 再交接连接、不丢预读字节、升级响应不走普通响应流程、交接失败调用 `onFailed` 回滚。

```
netonstream 适配器（reactor）     neton-http 分发器          neton-websocket 运行时 / provider
──────────────────────────────────────────────────────────────────────────────────────────
serveConnectionWithUpgrades(...)
  service(request) ───────────→ §6.1 公共步骤（方法、升级头、
                                 安全链、限流、参数绑定）
                                 route.upgrade.decide() ──→ Origin、子协议、准入与配额预留
                                                            provider.handshake() → Accept 头
                                 ←─────────── UpgradeDecision.Accept(headers, onUpgraded, onFailed)
  ← 返回 101 响应（不等待任何东西）
h1 写出并 flush 101
本次交换结束 → fulfill(Upgraded(stream, rest))
serve(connection) 返回
upgraded = upgradeOn(request.extensions)        （此时已完成，不会阻塞）
构造 UpgradedConnection（unwrap 可取出 Upgraded）
  onUpgraded(connection) ───────────────────────────────→ provider.open(connection, ...)
                                                            = WebSocket.fromUpgraded(upgraded, …)
                                                            （预读的首帧随 rest 一起交给引擎）
                                                            进入连接循环（§7.3、§7.4），启动 handler
交接失败 → onFailed(e) ─────────────────────────────────→ 回滚配额并注销 pending（§7.6、§8.3）
```

要点：

- **不得**在 service 返回 101 之前等待 `upgradeOn()`。h1 要等 101 写出之后才 `fulfill`，提前等待会让双方互相等待。
- 分发结果必须显式区分"普通响应"和"接受升级"。升级响应**不走**普通响应的包装、压缩（`Compression.kt`）和请求超时流程。
- netonstream 中必须使用 `fromUpgraded`，不得使用 `fromRawStream(stream, …)`。后者会丢掉与握手同一个包到达的首帧。一般地，**任何适配器都不得丢弃与握手同包到达的数据**（§9.2 一致性套件检查此项）。
- 升级失败（`upgradeOn` 抛 `UserNoUpgrade` 或其他错误）时，由连接协程关闭底层流并归还配额。业务处理协程尚未启动，不涉及业务清理。

### 7.3 入站：单一协议读取者

底层的 Ping 自动回复、关闭帧处理都发生在 `receive()` 内部，写驱动不会代为读取（`WebSocket.kt:27`）。因此：

- **始终只有一个协议读取者**：连接协程里的读循环。它是唯一调用底层 `receive()` 的地方，业务代码与框架其他部分都不调用。
- 读到的**数据消息**放入入站缓冲，`incoming` 从缓冲中取。**控制帧**（Ping、Pong、Close）由读取者当场处理，不进缓冲。
- 入站缓冲按消息数与字节数双重限制（§10.1 `inboundQueueMessages` / `inboundQueueBytes`）。
- **BACKPRESSURE 策略缓冲满时，读取者暂停读取**，由 TCP 把背压传给对端。串行字节流中，控制帧可能位于未读数据之后，不能承诺暂停期间仍立即处理控制帧。
- **消费停滞是本地问题，不归咎对端**。暂停读取期间，对端回的 Pong 可能就在我们自己没读的数据之后，因此：
  - 暂停期间**冻结** Pong 等待计时与入站空闲计时，恢复读取后继续计时；
  - 缓冲**持续满且有待交接消息**超过 `inboundStallTimeoutMillis`（§10.1），按"消费停滞"以 1011 关闭（§8.1），最终结果 trigger 为 CONSUMER_STALL，**不记为心跳失败**；健康的即时入队不创建超时任务；
  - 消费停滞期限对应 `consumerTimeoutMillis`，本版必须为正数，不提供无限暂停读取的配置。
- **连接进入关闭状态后**（任一方发起关闭、停机、超时）：
  - 正在等待 `incoming` 的收集者被唤醒。连接关闭令消息流结束，不重放未消费消息；收集协程本身被取消时仍传播取消，不能吞掉；
  - 读取者**丢弃**入站缓冲中尚未消费的数据和后续数据消息，恢复读取并持续推进，直到关闭握手完成或 `closeTimeoutMillis` 到期。关闭握手不依赖业务是否读取。
- handler 正在等待其他 I/O 不会占用协议读取者；但 BACKPRESSURE 队列满时仍适用上述暂停。进入关闭后必须解除暂停以推进关闭握手。

#### 7.3.1 可续读单消费者

- 同时只允许一个 `incoming.collect`；第二个收集者立即失败，不覆盖第一个，不竞争分走消息。
- `take(1)`、正常退出或取消收集释放消费权；再次收集读取尚未取走的数据，而不是从头订阅。它不是 broadcast/replay Flow。
- 从队列取出、交给收集者、业务处理完成是三个不同时间点。消息出队后遇到取消可能未交付；已交付但业务未处理完也不自动重放。不得承诺任意取消下无损或 exactly-once。
- 出队后未交付的数据必须通过取消/undelivered 清理恰好释放预算；业务收到后的保留量不再算框架队列预算。
- 收集取消本身不等于关闭连接；但若取消来自 handler 所属生命周期结束，连接照常关闭。可靠处理需业务消息 ID、ACK 和去重。

#### 7.3.2 路由级入站策略

| 策略 | 数据消息 | 控制帧 |
|---|---|---|
| BACKPRESSURE（默认） | 按 §7.3 有界排队；业务不读也不自动丢弃 | 持续读取时处理；暂停期间暂停相关失联判断 |
| REJECT_DATA | 第一个合法数据帧（包括零长度）即触发 1008，不先收齐整条消息 | Ping/Pong/Close 正常处理 |
| DISCARD_DATA | 显式丢弃，不入业务队列、不物化完整消息；`incoming` 不产生数据 | Ping/Pong/Close 正常处理 |

- “只推送”推荐显式选择 REJECT_DATA；丢弃不是默认行为。1003 只用于不支持的数据类型，不用于泛指端点禁止业务入站。
- 策略必须在第一次 receive 前传给引擎；支持 REJECT_DATA/DISCARD_DATA 的 provider 需通过对应能力测试，不得降级为“完整分配后再拒绝/丢弃”。不支持则启动失败。
- 丢弃不等于绕过协议：仍验证掩码、操作码、分片顺序、控制帧和长度规则、累计消息长度；文本使用增量 UTF-8 校验，不为校验收集整条文本。
- DISCARD_DATA 不消耗应用入站队列预算，但使用有上限的解码工作缓冲和每次服务的帧/字节预算，不能用无限丢弃循环饿死其他连接；正常消息/帧大小上限继续生效。
- `incoming` 在 REJECT_DATA/DISCARD_DATA 下仍是单消费者流，可等待连接关闭，但不产生业务数据。策略在路由注册时确定，不在连接运行中切换。
- 当前的关闭阶段 `discardData()` 是终止模式，不能直接当作活跃连接的 DISCARD_DATA；后者必须保留上述完整校验与公平性，需扩展 SPI 并单独验收。

### 7.4 出站：单一 FIFO 与数据所有权

- **单一出站队列，单一顺序**。所有发送（任意线程的业务发送、Hub 等后续扩展）都按**被接受的先后**进入同一个 FIFO，写串行器按此顺序写出。**不设**"在连接的执行上下文上直接写、绕过队列"的旁路：旁路会让后发的消息越过队列中先被接受的消息。
  （性能优化只允许在**不改变顺序**的前提下进行，例如在连接的执行上下文上且队列为空时就地写出；是否值得做，由 §11 第 3 步的数据决定。）
- **控制帧插队的边界**：心跳 Ping、Pong 回复可在数据消息之间推进。正常本地 Close 必须排在已接受数据之后；故障、停机或对端 Close 可中止排空。控制帧不能打断正在进行的网络写；对端不读时仍受写超时约束。
- **写超时**：每一次底层写出（flush）都有期限 `writeTimeoutMillis`。超时只能说明本次写未按期完成，不推断必然是对端不读；不继续在可能已部分写出的流上发 Close，强制终止，termination 为 WRITE_TIMEOUT，不记为心跳失败。
- **任何路径都不得绕过写串行器**直接调用底层写接口。
- **预算**：出站队列按消息数与字节数双重限制（§10.1），并同时计入全局队列预算（§10.3）。字节预算覆盖"已接受未写出"与"正在写出"两部分。
- **先检查、再预留、最后复制**。`send` 按以下顺序处理，框架产生的任何副本都发生在预留之后：
  1. **计算精确大小**：`Binary` 取数组长度；`Text` 用一次无分配的遍历算出精确的 UTF-8 字节数，规则与编码器一致（代理对 4 字节，孤立代理按替换字符 U+FFFD 计 3 字节）。计算用 `Long`，避免 `Int` 溢出。**不使用"UTF-16 长度 × 3"这类上界**，否则能放下的 ASCII 消息会被误拒或长期等待；
  2. **大小检查**：超过 `maxMessageBytes` 时立即抛 `IllegalArgumentException`，不挂起；
  3. **挂起准入**：需要等待时，先检查挂起发送者上限（§10.3.3），超出立即抛 `WebSocketCapacityException`。大小检查一定在登记等待**之前**完成；
  4. **预留**：同时预留本连接的出站预算与全局队列预算，大小即第 1 步的精确值。不足时 `send` 挂起，等待不使用网络写超时；连接关闭或调用者取消可退出。**挂起期间框架只持有对入参的引用，不复制**；
  5. **复制**：预留成功后，把 `Binary` 的数组复制一份，或把 `Text` 编码为 UTF-8，然后进入 FIFO。
- **数据所有权**：`send` 结束（包括抛异常）之后，调用方可以修改原数组，不影响已接受消息；结束之前不得修改。数组被多个协程共享时，应用必须自行保证此规则。
- **挂起发送者**：框架不复制挂起中的消息，但这些消息仍被引用、保持可达，**不复制不等于不占内存**。挂起发送者按数量和字节双重限制，最坏保留量见 §10.3.3。
- **接受的时点**：检查取消并成功转交 FIFO 的线性化点。取消先于接受生效则不入队；接受之后的调用者取消不撤销消息。取消和接受竞态必须通过可控时序测试，不能只靠一句 ensureActive 推断没有窗口。
- 调用者收到 CancellationException 不足以判断是否已经接受（跨执行器返回有 prompt cancellation）；不得据此自动重试。已接受、已写出、对端应用确认是三层保证，框架不代替业务 ACK。
- 同一发送者依次 await send 保序；多个并发发送者按接受顺序排列，不承诺墙钟调用顺序，也不承诺全局等待者公平性。
- **开始关闭后**拒绝新 send，抛普通 WebSocketClosedException；调用者自身取消仍按协程取消传播。正常本地关闭排空已有 FIFO；停机/对端关闭/故障可丢弃并释放预算，最终结果如实区分。

### 7.5 业务处理协程跑在哪里（待定，见 §12）

| 方案 | 做法 | 优点 | 代价 |
|---|---|---|---|
| A：在引擎 executor 上运行 | handler 在连接的 `executor`（netonstream 中即所属 reactor）上启动，挂起后回到同一上下文 | 入站缓冲与出站队列的交接都在同一线程上，无线程跳转 | 业务若在 handler 中阻塞，会拖慢同一 executor 上的其他连接；重活须 `withContext(Dispatchers.Default)` |
| B：Default 上运行 | handler 在 `Dispatchers.Default` 上运行 | 业务不直接占住引擎线程，但仍可能争抢 CPU 或造成 GC 压力 | 跨执行器交接，实际调度次数需要测量 |

两种方案都遵守 §7.3、§7.4 的**同一个所有权模型**：唯一协议读取者、单一出站 FIFO。区别只在 handler 运行的线程，API 完全相同（§4.3）。本节由 §11 第 3 步的基准测试数据决定；在得出结论之前不冻结。

#### 7.5.1 结构化并发与 Handler 共享

- 当前实现选择 Default，不将其描述为性能最优。线程选型不能改变以下契约。
- Handler/Controller 实例可以由 DI 共享，但其成员变量不会自动变成连接私有。连接状态放在本次 handle 的局部变量或显式创建的连接对象里。
- 用户通过 `coroutineScope { launch { ... } }` 创建受管子任务；handler 返回需等待其结构化子任务结束。`supervisorScope` 可用于隔离失败，但应用必须处理子任务错误，不能默默遗留工作。
- 框架必须将连接生命周期取消传递给 handler 及其结构化子任务；应用自己创建的 GlobalScope、独立 Job、外部线程不自动归框架所有，不得承诺全部收编。
- 对端关闭、协议/传输失败、停机触发业务取消；handler 自发取消应触发有界关闭，不可留下无人管理连接。正常返回触发排空；未处理业务异常触发 1011 并记录。
- 业务 finally 需要挂起清理时可使用有期限的 NonCancellable；框架不等待无限清理，也不保证不配合取消的代码及时结束。
- 推荐示例必须覆盖：接收 + 定时推送两个子任务、任一终止后的收尾，以及会话关闭期间取消所有结构化子任务，不鼓励向 Session 注入全局任务作用域。

### 7.6 三类配额

适配器里有两种性质不同的计数（已核对 `DefaultHttpAdapter.kt`）：`maxOpenConnections` 限制 **TCP 连接数**；`HttpServerConfig.maxConnections` 实际限制的是**在途 HTTP 请求数**。WebSocket 再加一类自己的配额。三者必须遵循以下所有权规则，仍须通过验收后才冻结 API：

| 配额 | 获取 | 释放 |
|---|---|---|
| TCP 连接（`maxOpenConnections`） | 接受 TCP 连接时（现有逻辑） | 底层流关闭时。**升级后继续持有**，直到 WebSocket 连接结束 |
| 在途 HTTP 请求（`maxConnections`） | 握手请求进入分发时（现有逻辑） | **升级交接完成时释放**。长连接不得长期占用请求名额，否则会挤掉普通 HTTP 请求 |
| WebSocket 连接（`websocket.maxConnections`） | **发送 101 之前预留**（§6.1 第 8 步） | 预留后握手失败或升级失败时**回滚**；否则在连接最终结束时释放 |

### 7.7 结束与清理

连接结束的唯一出口在连接协程的 `finally` 中。每一步都有时限，**任一步抛异常不影响后续步骤执行**：

1. 若连接尚未进入关闭状态，按 §8.1 发起关闭（发送关闭帧）；
2. 在 `closeTimeoutMillis` 内继续由协议读取者完成关闭握手（§8.2）；
3. 取消业务处理协程及其结构化子任务，不等待它们先完成才清理 transport；
4. 调用引擎连接的 `abort()`，结束其全部内部活动。netonstream 适配器须注意：底层写驱动使用独立 Job（`WebSocket.kt:435`），**`abort()` 必须显式关闭它**，不能指望取消传递；
5. 关闭底层流（强制，不再等待）；
6. 释放框架持有的队列租约、WebSocket 配额及 transport 所有权；TCP 配额按适配器关闭契约完成归还；
7. 发布不可变 CloseResult，唤醒全部 `awaitClosed()` 等待者。

**观察时点**：底层流终止、框架连接资源释放后发布结果，不代表应用任意外部任务已结束。`awaitClosed()` 不暴露内部 Deferred；一个等待者取消不改变共享结果。发布不得依赖业务 finally 中的 `awaitClosed()` 先返回：连接资源清理与结果发布先于等待该类业务清理完成，避免循环等待；业务清理仍受独立期限约束。

**不配合取消的业务代码**：结果发布后，等待已取消的业务任务，最多 `handlerShutdownMillis`；超时记录该路由的 WARN（含超时时长），不撤销已发布结果。框架不承诺任意业务代码都能执行完 finally。此后 send 拒绝，close 保持幂等，awaitClosed 仍能读取已发布结果。

升级后的连接**不属于** HTTP 的 `connectionHandlers` 作用域，后者在 `serve()` 返回时取消，不能波及 WebSocket。升级后的连接由 `neton-websocket` 会话运行时的注册表管理（§8.3）；适配器只负责在交接后不再取消它，并在 `UpgradedConnection.close()` 时关闭底层连接。

---

## 八、关闭

### 8.1 关闭码

| 情况 | 关闭码 | 说明 |
|---|---|---|
| handler 正常返回 | 1000 Normal | 先排空已接受消息；写失败或排空超时不能报告成功 |
| 服务端停机 | 1001 Going Away | |
| Pong 超时（§10.2） | 1001 Going Away | 尝试发送关闭帧，受 `closeTimeoutMillis` 与 `writeTimeoutMillis` 约束 |
| 入站空闲超时（§10.2） | 1001 Going Away | |
| 消费停滞：入站缓冲持续满超过 `inboundStallTimeoutMillis` | 1011 Internal Error | 本地问题，原因注明 consumer stalled |
| 写阻塞：一次写出超过 `writeTimeoutMillis` | 不发关闭帧 | termination = WRITE_TIMEOUT |
| 入站预留失败：全局队列预算耗尽（§10.3.2） | 1013 Try Again Later | 原因注明 resource pressure；不记为心跳失败或消费停滞 |
| 入站消息超过 `maxMessageBytes` | 1009 Message Too Big | |
| 入站文本不是合法 UTF-8 | 1007 Invalid Payload | |
| 协议错误（帧格式、未掩码等） | 1002 Protocol Error | 需要 `sendCloseOnProtocolError = true`（§10.1） |
| 应用主动拒绝、REJECT_DATA 收到业务数据 | 1008 Policy Violation | 应用调用 `close(1008)`；不混用 1003 |
| handler 抛出异常 | 1011 Internal Error | 记录 ERROR 日志，带路由与异常 |
| handler 因停机被取消 | 1001 Going Away | 取消**不**映射为 1011 |
| 未完成关闭握手即 EOF / I/O 错误 | 不发关闭帧 | PEER_EOF / TRANSPORT_FAILURE，不伪装成 1000 |
| 收到无状态码 Close | 引擎可回复空 Close | received 存在且 code=null；1005 仅作诊断，不上网 |

线上合法关闭码才允许传给 `close`，并支持应用使用 3000–4999。1005、1006、1015 必须拒绝；本轮继续用 Int 参数，不另冻结一套与已实现 API 不同的 CloseCode 类。

### 8.2 关闭握手的等待期限

`close(...)` 只发起幂等状态转换，不等待握手，完整结束用 `awaitClosed()` 观察。调用者在状态转换后取消不撤销关闭。

从第一次进入关闭状态起使用单一 `closeTimeoutMillis` 截止时间，覆盖正常排空、Close 写出和等待回应；重试/升级关闭原因不重置期限。正常本地关闭排空后写 Close；停机、故障或对端先关闭可放弃排空。未到写出完成不能记录 sent；超时强制释放并记录 CLOSE_TIMEOUT，不能覆盖成 1000。期间不再交付业务数据，读取者继续推进关闭握手。

### 8.3 停机

**注册表**：`neton-websocket` 的会话运行时维护一个注册表（`decide` 接受升级时登记，`onUpgraded` / `onFailed` 时转换或注销），同时管理两种状态的连接：

- **pending**：已在 §6.1 第 8 步预留配额、101 尚未完成交接的连接；
- **active**：已完成交接、连接协程正在运行的连接。

连接在预留配额时**同时**登记为 pending，交接完成后转为 active，结束时注销。登记、状态转换、注销与停机状态的读取在同一把锁（或同一原子状态）下完成，不存在"已接受但未登记"的窗口。

**停机状态是持续生效的标志，不是一次性快照**。应用停机、`websocket` 组件进入 stop 时：

1. 置 draining 标志。此后所有新握手在第 8 步前返回 503，不再预留配额。该标志不会复位；
2. 对 active 连接：按 §8.1 以 1001 发起关闭，并取消业务处理协程；
3. 对 pending 连接：不打断 101 的写出；交接一完成就检查 draining 标志，立即以 1001 关闭，不启动业务处理协程；
4. 等待注册表清空，最长到停机宽限期；
5. 宽限期到期后，对剩余连接强制执行 §7.7 的第 4 至 7 步。

停机流程纳入 [Lifecycle Contract](./lifecycle.md) 的资源所有权链：WebSocket 作用域在 HTTP 监听停止**之后**关闭，以保证已建立的连接能收到 1001。

---

## 九、引擎能力

### 9.1 能力与兼容性校验

`neton-core` 只增加一个与协议无关的能力：

```kotlin
enum class HttpCapability {
    HTTP_2, STREAMING_RESPONSE, MULTIPART, ASYNC_HANDOFF, TRAILERS,
    /** 能在 101 之后交接底层连接（§5.1 UpgradedConnection）。 */
    PROTOCOL_UPGRADE,
}
```

| HTTP 适配器 | 声明 `PROTOCOL_UPGRADE` | 可用的 WebSocket provider |
|---|---|---|
| `neton-http` | 已声明并接入，r12 新策略/关闭事件仍需验收 | `neton-websocket` 内置默认 provider |
| `neton-http-hyper4k` | 否 | 无 |
| `neton-http-ktor` | 否 | 无 |

存在 WebSocket 路由时，启动期在 `adapter.start()` **之前**依次校验，任一不满足即启动失败，并列出所有相关路由。**不降级、不返回 501**：

1. HTTP 适配器声明了 `PROTOCOL_UPGRADE`（沿用现有的 `validateHttpCapabilities`）；
2. 已安装 `websocket { }`；
3. provider 的 `supports(adapter)` 返回 true。

声明 `PROTOCOL_UPGRADE` 的前提：适配器满足 §7.2 的交接约束，并通过 `HttpEngineConformanceSuite` 新增的升级用例。provider 可用的前提：完整实现 §7.0.2 的 SPI（含分配前可拒绝的预留），并通过 `WebSocketEngineConformanceSuite`。"底层库支持 WebSocket"不等于"已接入"，与 `HttpAdapter.capabilities` 现有的"实现之前不许声明"规则一致。

### 9.2 一致性套件

仿照现有的 `HttpEngineConformanceSuite`，在 `neton-websocket` 的 `neton.websocket.conformance` 包中提供两套测试：

| 套件 | 测试对象 | 内容 |
|---|---|---|
| `WebSocketRuntimeSuite` | 框架运行时，配合一个**可控时序的假引擎**（实现 SPI，测试代码可以精确控制事件到达与写出完成的先后） | 心跳登记与 Pong 竞态、预算拒绝与 1013、消费停滞与写阻塞的分类、关闭期限、停机、配额。这些是公共策略，只在这里测一遍 |
| `WebSocketEngineConformanceSuite` | 每个 provider 与其所支持的 HTTP 适配器的真实组合 | SPI 契约：分配前预留与拒绝、写出完成后才返回、`abort` 能结束挂起的读写、丢弃模式不物化、执行上下文约束、自动回复 Ping、握手与首帧同包不丢帧 |

任何 provider 都必须在其自身测试中，对它 `supports` 的每个 HTTP 适配器运行 `WebSocketEngineConformanceSuite` 并全部通过。HTTP 适配器的交接行为（101 后交接、不丢预读字节、交接失败回滚）由 `HttpEngineConformanceSuite` 新增的升级用例约束。

#### 9.2.1 r12 的准入与反例

- RuntimeSuite 必须可控地暂停在出队/交付、预留/接受、Close 写出/收到回应处，配虚拟时钟或显式屏障；不能靠 sleep 碰取消窗口。
- 引擎套件逐项声明支持的入站策略并逐项运行；同时验证空 Close 的读写、非法保留码不能上线、增量丢弃不增长整消息内存、UTF-8 和碎片规则不被绕过。
- KSP/DSL 编译矩阵覆盖：尾随 lambda、显式 handler lambda、挂起函数引用、Handler 对象位置/命名参数、带 subprotocols/inboundPolicy、组路由、注解生成。编译真实 Native 示例，不以不完整 JVM stub 的生成文本代替编译成功。
- 同一套业务行为用三种入口重复验证；不能让注解路径跳过握手前绑定或只推送策略。Handler 无需继承类，也不依赖 SPI。
- Autobahn 验证协议，不替代 RuntimeSuite 的配额、取消和停机测试；全部通过也不等于性能/平台验收完成。记录套件版本、provider 版本、平台、可选能力以及实际运行/仅编译/未测状态。
- 当前 RuntimeTest/DefaultProviderTest 的通过记录不等于两套可复用 TCK 已交付。完成 testkit 的公开运行入口、失败诊断和独立测试 provider 运行后，才能将“引擎可接入”作为稳定契约。

---

## 十、配置

### 10.1 配置项

以下保留当前实现的配置名称，不因本轮 API 修订再引入一套别名。正文中 inboundQueueMessages/outboundQueueMessages 均指 queueCapacity，inboundQueueBytes/outboundQueueBytes 均指单方向 maxQueuedBytesPerConnection，inboundStallTimeoutMillis 指 consumerTimeoutMillis；这些是机制描述，不是额外可解析键。单条消息仍由 maxMessageBytes 限制。

```toml
[websocket]
maxConnections        = 16384      # WebSocket 连接上限（§7.6）；与 HTTP 在途请求配额独立
maxMessageBytes       = 1048576    # 1 MiB，双向完整消息上限；入站映射底层 maxMessageSize
maxFrameBytes         = 1048576    # 1 MiB，入站单帧上限 → 底层 maxFrameSize
readBufferBytes       = 16384      # 16 KiB → 底层 readBufferSize（底层默认 128 KiB，见 §10.4）
writeBufferBytes      = 16384      # 16 KiB → 底层 writeBufferSize（底层默认 128 KiB）
queueCapacity         = 16         # 每连接每个方向的消息槽位上限
maxQueuedBytesPerConnection = 8388608 # 每连接单方向有效载荷预算；入/出共同计入全局
consumerTimeoutMillis = 30000     # 等待入站消费的期限，必须 > 0
maxSuspendedSends     = 16         # 每连接同时挂起的 send 上限；超出立即抛 WebSocketCapacityException
maxSuspendedSendsTotal = 4096      # 全部连接同时挂起的 send 上限；超出同样立即抛异常
maxSuspendedSendBytes = 67108864   # 64 MiB，全部挂起 send 的消息字节总和上限（§10.3.3）
writeTimeoutMillis    = 10000      # 单次底层写出的期限（§7.4）
maxBufferedBytes      = 536870912  # 512 MiB，全局队列预算（§10.3）。不是进程内存上限
pingIntervalMillis    = 30000      # 0 = 不主动发 Ping
pongTimeoutMillis     = 10000      # 0 = 不等待 Pong
idleTimeoutMillis     = 0          # 0 = 关闭入站空闲超时
closeTimeoutMillis    = 5000
handlerShutdownMillis = 1000      # 连接资源回收后等待业务清理的独立期限
compression           = false      # permessage-deflate，默认关闭
allowedOrigins        = []         # 见 §6.3；空 = 仅同源
handshakeHeaderNames  = []         # r12：会话快照显式保留的请求头，默认不保留
maxHandshakeSnapshotBytes = 65536 # r12：复制前限制保留字符串总量，非 RSS 上限
```

- 框架**始终**设置 `sendCloseOnProtocolError = true`，不对外暴露此项。
- `consumerTimeoutMillis`、`writeTimeoutMillis`、`closeTimeoutMillis`、`handlerShutdownMillis` 均必须 > 0；仅 Ping/Pong/idle 三项允许 0 关闭对应机制。时间参数不超过 Int.MAX_VALUE 毫秒。
- v1 不支持 compression=true，启动报错。未来压缩必须另行设计解压预算和丢弃校验，不能直接打开透传。
- `inboundQueueBytes` 必须不小于 `maxMessageBytes`，否则一条合法的最大消息永远放不进缓冲；不满足时启动失败。
- `writeTimeoutMillis` 必须大于 0，用于限制持续写阻塞，不允许关闭；它不是对端不读的诊断证明。
- `inboundQueueBytes` 与 `outboundQueueBytes` 都必须不大于 `maxBufferedBytes`。否则会出现单连接合法、全局却永远放不下的消息；不满足时启动失败。
- `maxMessageBytes <= maxQueuedBytesPerConnection <= maxBufferedBytes` 是统一校验。API 的超大单消息错误沿用 IllegalArgumentException，队列/等待者资源拒绝沿用 WebSocketCapacityException，关闭用 WebSocketClosedException，不另引入重复异常类型。
- r12 只允许路由级 `subprotocols` 与 `inboundPolicy`；其他资源和超时配置仍是全局值。不增加任意配置覆盖层。

### 10.2 心跳与超时：三项相互独立

**默认语义：区分"安静"和"失联"。**

- 没有业务消息、但能正常回复 Pong 的连接：**一直保持，不踢掉**。这是聊天、推送类连接的常态。
- 主动探测后在期限内没有回复 Pong 的连接：判定失联，关闭并回收。
- 业务层的入站空闲超时：单独配置，**默认关闭**。只因为没有聊天消息，不能判定客户端失效。

| 机制 | 配置 | 行为 | 关闭方式 |
|---|---|---|---|
| 定时 Ping | `pingIntervalMillis` | 每隔该时长发一个 Ping。同一时刻最多一个未回应的 Ping | — |
| Pong 等待 | `pongTimeoutMillis` | Ping **完成底层写出之后**才开始计时，在该时长内必须收到**载荷相同**的 Pong。载荷为 8 字节递增序号；载荷不匹配的 Pong 视为普通入站活动，不清除等待 | 超时以 1001 关闭 |
| 入站空闲 | `idleTimeoutMillis` | 在该时长内没有收到任何入站帧（数据或控制帧） | 超时以 1001 关闭 |

计时规则：

- **起点是"写出"，不是"入队"**。出站拥塞时 Ping 可能迟迟写不出去；这段时间由写超时（§7.4）负责，不计入 Pong 等待，避免高负载时误踢正常连接。
- **先登记，后写出**。对端可能回得非常快：Ping 已经到达网络、对端已回复、读取者已收到 Pong，而等待写出完成的协程还没恢复。因此一次探测的状态按以下顺序推进：
  1. 生成序号 n，**在写出之前**把"正在探测 n"登记到连接状态中；
  2. 写出 Ping(n)。这期间读取者收到载荷为 n 的 Pong，**立即匹配**，把探测标记为已应答；
  3. 写出完成后，只有在探测**尚未应答**时才启动 `pongTimeoutMillis` 期限；已应答则本次探测直接结束；
  4. 写出失败或写超时：清除本次探测状态，由写超时规则处理（§7.4），不记为心跳失败。
- 登记、匹配、启动期限都在连接的 `executor` 上进行，不需要锁。
- 读取暂停期间（§7.3）冻结 Pong 等待与入站空闲计时。
- **错峰**：每条连接的第一次 Ping 在 `[0, pingIntervalMillis)` 内随机偏移，此后按固定间隔。避免大量连接同时建立后在同一时刻发 Ping。
- 所有计时都用连接 `executor` 提供的定时器（SPI 要求它实现 `Delay`，§7.0；netonstream 中即 reactor 的定时器，§2.5），不为每条连接创建线程。

启动期校验只针对**同时开启**的组合：

- `pingIntervalMillis = 0` 时不创建主动探测，即使 pongTimeoutMillis 非零也不凭空启动等待；pongTimeoutMillis 为 0 时发送 Ping 不保留等待应答的探测状态；
- 两者都开启时，要求 `pongTimeoutMillis <= pingIntervalMillis`，否则启动失败；
- `idleTimeoutMillis` 与另外两项**不做**大小约束。任一项为 0 就是关闭该项，关闭不会导致启动失败。

### 10.3 全局预算与高并发

单连接有界，不等于全局内存可控。按 §10.1 的默认值，仅出站字节预算一项，10,000 条连接 × 8 MiB 的理论上限就约为 78 GiB。这不是预分配，但说明必须有全局约束。

**`maxBufferedBytes` 是队列预算，不是进程内存上限。** 统计范围如下：

| 内存 | 是否计入 `maxBufferedBytes` | 如何约束 |
|---|---|---|
| 出站队列：已接受未写出、正在写出 | 计入 | §7.4 预留规则 |
| 入站缓冲：已交接、未被 `incoming` 消费的消息 | 计入 | §7.3 |
| 入站重组：分片消息尚未收齐时，底层已读入的部分 | 计入，见下文 | 单连接另受 `maxMessageBytes` 约束 |
| 挂起发送者持有的消息 | 不计入（属于调用方的对象，框架不复制） | 数量上限 `maxSuspendedSends` / `maxSuspendedSendsTotal` |
| 编解码器读写缓冲、压缩上下文、TLS 缓冲 | 不计入 | 单连接由 §10.1 配置限定，总量由连接数上限约束，按 §10.4 实测 |
| 业务代码自己的内存 | 不计入 | 不受框架控制 |

#### 10.3.1 入站：分配前预留，允许拒绝

`receive()` 一次调用内会持续读网络、重组分片（`WebSocket.kt:137` `nextMessage()`），框架无法中途介入。因此"增长之后再记账"无法保证不超限：分配已经发生，多条连接同时增长时总量必然越界。规则：

- websocket 库增加一个**非阻塞、可拒绝**的预留接口，由框架实现：

  ```kotlin
  interface ByteBudget {
      /** 非阻塞。成功返回 true 并计入预算；不足返回 false，调用方不得继续分配。 */
      fun tryReserve(bytes: Long): Boolean
      fun release(bytes: Long)
  }
  ```

- 库在**每一次**为数据消息分配内存**之前**调用 `tryReserve`：分片重组缓冲的增长、单帧消息负载的物化、permessage-deflate 的解压输出。控制帧（载荷最多 125 字节）不经过它。
- `tryReserve` 返回 false 时，库**不得继续分配**，立即放弃当前未完成的消息并以确定的异常（`WebSocketException.Capacity`）退出 `receive()`。不提供"在库内部等待预算"的路径，等待正是 §10.3.2 所述死锁的来源。
- **预算所有权**：
  - 消息未完成时，预算由该连接的重组状态持有；
  - 消息完成、交给入站缓冲时，**整体转移**给入站缓冲中的这条消息，不重复计费；
  - 消息经 `incoming` 交给业务时释放，此后它属于业务内存；
  - 取消、异常、关闭时丢弃未完成消息与缓冲中的消息，各自对应的预算**恰好释放一次**（由同一个租约对象负责，释放是幂等的）。

#### 10.3.2 全局耗尽：拒绝并关闭增长中的连接，保证能退出

如果全局耗尽时让读取暂停等待，会出现这样的局面：多条连接各收了一部分分片，共同耗尽预算，全部暂停读取；没有完整消息交给业务，也就没有预算被释放；拒绝新握手不起作用，连接不写数据时写超时也不存在。**所有连接永久停住。**

因此规定：

- **入站全局耗尽时，不暂停，不等待**。`tryReserve` 失败的那条连接，按 §10.3.1 以 `Capacity` 退出 `receive()`；框架以 **1013 Try Again Later**（IANA WebSocket 关闭码注册表）关闭该连接，释放它持有的全部预算。结果 trigger 为 RESOURCE_PRESSURE，不记为心跳失败或消费停滞。
- 被关闭的是"正在增长、申请失败"的那条连接，规则确定，不依赖调度时序。其他连接继续工作，预算因关闭而回收，系统一定能前进。
- **出站全局耗尽**：`send` 可以挂起等待（§7.4）；写不出的连接由写超时回收。预算可回收不代表每个等待者必然获得预算，本版不承诺无饥饿；调用者可自行设置等待期限，连接关闭必须唤醒其等待者。
- **单连接入站缓冲满（不是全局耗尽）**：仍按 §7.3 暂停读取，计入该连接自己的消费停滞计时。暂停期间不再读网络，也不再申请预算，不会参与全局耗尽。
- **控制帧与关闭有独立的小额预留**。每条连接在升级时固定预留一小块（足以容纳一个 Close 帧和一个 Ping/Pong 帧），不从 `maxBufferedBytes` 中竞争。Ping、Pong、Close 的发送永远不会因全局预算耗尽而等待。
- **进入关闭状态会唤醒并终止该连接的所有预算等待者**：挂起的 `send` 抛 `WebSocketClosedException`；读取者转入"丢弃数据、推进关闭握手"模式（§7.3）。丢弃模式下数据负载直接跳过，不物化、不申请预算。
- **大小超限立即拒绝**：单条消息超过 `maxMessageBytes` 时立即拒绝（§7.4）。启动校验保证合法消息能独立放进预算，不保证高负载下所有发送者都能及时获得预算。
- 消费停滞期限必须为正数，入站队列不能无限期暂停等待业务消费。

#### 10.3.3 挂起发送者的最坏保留量

挂起中的 `send` 不复制消息，但消息仍被引用、保持可达。最坏保留量的计算口径：

```
挂起消息有效载荷上限 = min(maxSuspendedSendBytes,
                           maxSuspendedSendsTotal × maxMessageBytes)
```

- 大小检查在登记等待之前完成（§7.4 第 2、3 步），所以每个挂起的消息都不超过 `maxMessageBytes`；
- 只有数量上限时，默认值下有效载荷可达 4096 × 1 MiB = 4 GiB。因此增加**字节上限** `maxSuspendedSendBytes`（默认 64 MiB），按第 1 步算出的精确大小累加，超出时新的等待立即抛 `WebSocketCapacityException`；
- 这是被引用消息的有效载荷上限，不是存活堆或 RSS 上限。String 表示、对象开销和挂起协程捕获的其他对象另计；这部分不计入 maxBufferedBytes，需要在 §11.1 混合负载下实测。

**其他约束：**

- **准入**：WebSocket 配额（§7.6）、TCP 配额、全局队列预算三者都满足，才允许升级。
- 心跳与超时定时器全部在连接的 `executor` 上（§10.2），**定时器数量与连接数线性相关，线程数与连接数无关**。

### 10.4 空闲连接成本

高并发下连接大多数时间是空闲的。空闲连接的内存成本决定单机能承载多少连接，因此列为验收项（§14）。

- 底层默认读写缓冲各 128 KiB。框架默认改为各 16 KiB（§10.1），大消息通过缓冲增长处理，不需要大的初始容量。
- io 的池化 `Buffer` 首次写入时才取数组，reactor 的空闲扫描会通过 `releaseIfIdle` 归还挂起读的缓冲数组。**websocket 编解码器自己的读写缓冲（`FrameCodec.input` / `output`、`WebSocket.writeBuffer`）是否被这一机制覆盖，目前未验证**。
- 实施第 2 步须实测两组数字，再做决策：
  1. **空闲成本**：建立 N 条空闲连接（完成握手后不收发），每条连接增加的 RSS；
  2. **恢复成本**：空闲连接重新开始收发时，因缓冲重新分配带来的延迟与分配开销。
- 根据两组数字在三种策略中选择，**不预设结论**：保留缓冲（空闲成本高、恢复零开销）、空闲时缩容到小容量、空闲时归还到池。选择的依据与数字写回本节。不能为了压低空闲 RSS，造成活跃连接持续分配与释放的抖动。

---

## 十一、实施步骤

下表是原始功能路线，保留阶段编号供引用；已有实现记录见开头。r12 的下一轮开发按 §11.2 进行，性能未测不能算通过原始阶段的性能闸门。

| 步 | 内容 | 出口条件 |
|---|---|---|
| 0 | **本地依赖与版本对齐**：按 §3 接入 composite build；适配器坐标改为 `io 0.3.2 / http 0.2.0 / tls 0.2.0`；包名冲突检查改读本地源码 | neton 全量测试通过；**普通 HTTP 性能不回退**（按 §11.1 测量，这一步升级了底层依赖，必须实测） |
| 1 | **升级扩展点与模块骨架**：`neton-core` 的 `UpgradeEndpoint` / `UpgradeDecision` / `UpgradedConnection`、`RouteDefinition.upgrade`、`PROTOCOL_UPGRADE`；`neton-http` 分发器的升级路由处理与 426 兜底；新建 `neton-websocket` 模块：业务 API、`websocket { }` 安装与默认工厂、`webSocket(...)` DSL、`@WebSocket` 与 KSP 校验；启动期兼容性校验 | 在 hyper4k 下启动失败并列出路由；未安装 `websocket { }` 编译或启动失败且信息明确；KSP 非法签名编译失败；`neton-core` / `neton-http` 不依赖 `neton-websocket`（依赖检查） |
| 1b | **引擎 SPI 与会话运行时**（`neton-websocket`）：`WebSocketEngineProvider` / `WebSocketEngineConnection`（§7.0.2）；运行时（读循环、出站 FIFO、心跳、预算、关闭、停机）；可控时序假引擎与 `WebSocketRuntimeSuite` | `WebSocketRuntimeSuite` 全部通过，**不依赖任何真实引擎** |
| 2 | **默认组合**：`neton-http` 声明 `PROTOCOL_UPGRADE`，仅在存在升级路由时使用 `serveConnectionWithUpgrades`，按 §7.2 交接并通过 `unwrap` 暴露 `neton.http.Upgraded`；在 `neton-websocket` 内置默认 provider：provider 用 `createResponse` 完成握手的协议部分，用 `WebSocket.fromUpgraded` 构造引擎连接；websocket 库增加 `ByteBudget` 预留（§10.3.1） | `WebSocketEngineConformanceSuite` 全部通过；echo 可用；无 WebSocket 路由的应用走原路径；§11.1 的普通 HTTP 指标不回退 |
| 3 | **线程模型定案**：方案 A、B 各实现一版，做 echo 与跨线程发送的基准测试 | §7.5 结论写回本文并冻结该节 |
| 4 | **握手安全**：Origin 策略、安全链复用、子协议协商 | §14 握手类用例全部通过 |
| 5 | **心跳、超时、关闭、停机、全局预算**（§10.2、§10.3） | §14 关闭类与高并发类用例全部通过；§10.4 空闲连接成本有实测数字 |
| 6 | **wss** | TLS 上的 echo 与 Autobahn 子集通过 |

步骤 2 有一条结构约束：**没有注册 WebSocket 路由的应用，HTTP 处理路径不得有任何变化。** 结构约束降低回退的可能，但**不代替测量**：第 0 步本身就升级了底层依赖，§11.1 的测量在第 0 步和第 2 步都要执行。

### 11.1 性能验收

| 负载 | 指标 |
|---|---|
| 普通 HTTP（无 WebSocket 路由的应用；有 WebSocket 路由但只走 HTTP 的应用） | 吞吐、p99 延迟、错误率、RSS 峰值 |
| WebSocket echo（不同消息大小、连接数） | 消息吞吐、p99 延迟、错误率、RSS 峰值 |
| 混合：普通 HTTP 压测 + 一批不读取的慢 WebSocket 客户端 | HTTP 的吞吐与 p99 不应明显下降；RSS 受 §10.1 各项预算约束、有上界；无错误 |

测量方法：

- 改动前后的二进制在同一台机器上交替运行（A/B/B/A），每组多次重复，报告中位数与离散程度；
- 压测端与被测端不得争抢 CPU（分核绑定或分机），并记录双方的 CPU 占用以确认被测端是瓶颈；
- `rps/CPU%` 可以作为辅助指标，但它**不能免疫**环境干扰（CPU 分配、邻居负载都会影响它），不得单独作为结论；
- 任何一项回退都需要给出原因或修复，不接受"在噪声范围内"之外的无解释回退。

---

### 11.2 r12 实施、迁移与冻结闸门

本修订是文档规划，不表示以下项目已实现。本地源码开发，不发版、不改 Arena PR。

| 步骤 | 改动 | 出口条件 |
|---|---|---|
| A | 先补假引擎/时钟屏障与失败用例，再替换 Session API | 证明旧版公开 Deferred 可破坏其他观察者；快照不再引用 HTTP context；多观察者与取消测试通过 |
| B | 引入 CloseResult，扩展 SPI 的空 Close 表达 | 缺失帧/空帧/1000/异常终止可区分；保留码永不上线；排空、写出和超时竞态可复现 |
| C | 接收消费语义与结构化生命周期 | 出队后取消不泄漏、不偷偷重放；重复收集和并发收集符合规范；finally 等待关闭不形成循环等待 |
| D | 路由 inboundPolicy + 协议增量拒绝/丢弃 | DSL/注解对等；不支持策略启动报错；无整消息分配，仍校验 UTF-8/掩码/碎片；热流量公平性有测试 |
| E | Handler 对象重载和 Native 编译矩阵 | 三种入口归一；尾随 lambda/函数引用/命名参数无歧义；共享 Handler 的两连接局部状态互不污染 |
| F | 提取可复用 RuntimeSuite/EngineConformanceSuite | 默认和独立测试 provider 都可用相同 runner 验证，附版本化报告，不靠私有测试类数量宣称 TCK 完成 |
| G | 互通、平台、压力与性能闸门 | Autobahn、长期资源回收、§11.1 A/B 与所声明平台通过；无结果则保持实验性，不冻结 |

迁移规则：

- `session.context.request.pathParam(...)` 改为 `session.handshake.pathParam(...)`；HTTP response/attributes 不提供兼容别名，否则仍会保留错误生命周期。
- `session.closed.await()` 改为 `session.awaitClosed()`；不保留可 cancel 的共享观察句柄。`close()` 保持“发起关闭”语义，等待完成需显式调用 awaitClosed。
- `session.subprotocol` 保留为 handshake 的便捷只读别名；现有 `incoming.collect`、`send(String)` 和 Binary 入参形式保留。
- 废弃 SPEC 中从未交付的自定义 WebSocketIncoming、sendText、trySend，不为了兼容文档草稿创造新实现。
- 公共 API 改动不覆盖已发布 Maven 产物。若发布范围已包含旧接口，必须使用新的版本并附迁移说明；本轮不指定、不执行发版。
- 业务 API/行为规范先通过上述门槛再冻结；SPI 继续 Experimental，独立于业务 API 的稳定性承诺。测试通过只证明覆盖场景，不宣称“所有引擎/语言全面兼容”。

## 十二、待定决策

| 项 | 何时决定 |
|---|---|
| §7.5 业务处理协程运行在引擎 executor 上还是 Default 上 | 第 3 步基准测试之后 |
| 反向代理场景是否提供"信任代理"配置，以便使用 `X-Forwarded-Host` 做同源比较 | v1 不提供；有明确需求时另议 |
| hyper4k 实现 SPI 的可行性：需要 Rust 侧的 WebSocket 实现（如 tokio-tungstenite）加 FFI；tungstenite 不提供"分配前可拒绝预留"，要满足 §7.0 的前提，可能需要修改或替换其重组逻辑 | 有明确需求时评估；做不到预算约束，其 provider 就无法通过一致性套件 |

---

## 十三、后续规范（不在 v1）

### 13.1 WebSocketHub

需单独定稿以下语义后再实现：

- 每连接队列上限（消息数与字节数）、全局待发内存上限；
- 慢客户端的处理策略（丢弃、断开），以及它不得阻塞同一主题的其他订阅者；
- 发布结果的含义：已入队还是已发送；
- 同一主题内的消息顺序；
- 断连后自动退订；
- `subscribe(topic)` 的授权，**默认无权限**；
- 多节点扩展的排序、丢失、重放语义需要独立定义，**不承诺**"接口不变即可无缝切换到分布式实现"。

### 13.2 类型化消息

`session.receiveMessages<T>()`、`session.sendMessage(value)` 作为独立扩展模块提供（JSON 序列化与校验），核心会话不依赖序列化库。不使用这个扩展的应用（如 echo）不付出任何初始化与分配成本。

### 13.3 HTTP/2 与 HTTP/3

- RFC 8441（h2 extended CONNECT）：`http` 已有 `H2Upgraded`，但握手、能力、流控与 101 路径不同，需单独设计与验收。
- RFC 9220（h3）：依赖 h3 引擎接入 Neton。
- 普通消息业务尽量保持不变是演进目标，不承诺全部业务零修改；握手、代理、鉴权与流级/连接级故障范围需各协议单独验收。

---

## 十四、验收用例

**握手**
- 合法握手得到 101，`Sec-WebSocket-Accept` 正确
- 不带升级头的 GET 访问 WebSocket 路由，返回 426
- 非 GET、版本不是 13、缺 Key 等非法握手，按 §6.1 返回对应状态码
- Origin：同源、白名单、`null`、缺失、跨站，五种情况的行为符合 §6.3
- 未认证返回 401、无权限返回 403、限流返回 429，且连接均未升级
- 子协议：有交集、无交集、路由未声明三种情况
- 引擎不支持时启动失败，错误信息列出 WebSocket 路由

**收发**
- 握手请求与首帧在同一个 TCP 包中到达，首帧不丢
- 文本、二进制、分片消息正确重组
- 超过 `maxMessageBytes` 的消息被拒，关闭码 1009；非法 UTF-8 被拒，关闭码 1007
- handler 挂起（如 `delay` 或切到 `Dispatchers.Default`）后再发送，消息正确送达
- 从其他线程（如另一连接的协程）发送，消息正确送达且同一发送方保序
- 并发多发送方的消息不交错、不触发底层并发异常
- 慢客户端：出站队列满时 `send` 挂起，等待者与队列预算有界
- 第二个并发消费 `incoming` 抛 `IllegalStateException`

**单一读取者与背压**
- handler 只发不收且无入站业务数据：Ping/Pong 与关闭可推进；有业务数据时遵循对应 inboundPolicy
- handler 阻塞在其他 I/O 上时调用 `session.close()`：关闭握手照常完成
- 入站缓冲满：读取暂停、内存有界；持续不消费超过 `inboundStallTimeoutMillis` 时以 1011（consumer stalled）关闭
- 进入关闭状态后，后续数据消息被丢弃，关闭握手在 `closeTimeoutMillis` 内完成

**发送顺序与所有权**
- 先在其他线程 await `send(A)` 成功，再回到连接执行器 `send(B)`：对端先收到 A
- `send(Binary(arr))` 结束后立刻修改 arr：已接受消息保持原内容；取消路径也不得残留引用正在复用的原数组
- 在接受之前/之后两个确定时点取消：分别不入队/保持已接受消息；调用者收到取消不据此自动重试
- 单条消息超过 `maxMessageBytes`：立即抛 `IllegalArgumentException`，不挂起

**配额**
- 升级完成后，在途 HTTP 请求计数归还，普通 HTTP 请求不受长连接数量影响
- 握手在预留 WebSocket 配额之后失败：配额回滚
- WebSocket 结束后，TCP 连接配额与 WebSocket 配额都归还

**保活与高并发**
- 长时间没有业务消息、但持续回复 Pong 的连接不被关闭（持续时长远大于 `pingIntervalMillis` 与 `pongTimeoutMillis` 之和）
- 对端失联（静默丢包，不回 Pong）：在 Ping 写出后 `pongTimeoutMillis` 内关闭，流、协程、配额全部释放
- 入站缓冲满：报告为消费停滞（1011，consumer stalled），不记为心跳失败；读取暂停期间不触发 Pong 超时
- 出站写超时：termination = WRITE_TIMEOUT，不记为心跳失败，不凭此单独认定对端或调度是根因
- 关闭全部心跳配置（三项均为 0）：慢消费者与写阻塞仍能按 `inboundStallTimeoutMillis` 与 `writeTimeoutMillis` 回收
- 大量连接同时建立：Ping 时间分散，没有集中在同一时刻
- 大量空闲连接 + 少量活跃连接：活跃连接的 p99、executor 定时器延迟、CPU、RSS 都在可接受范围，并记录数字
- 全局队列预算耗尽：send 挂起或被等待者上限拒绝，新握手 503；有效载荷计数不超过预算，不宣称 RSS 等于预算
- 全局预算耗尽时：Ping、Pong、Close 照常发出，处于关闭状态的连接能完成关闭握手并释放
- 全局预算耗尽时进入关闭：该连接挂起的 `send` 立即抛 `WebSocketClosedException`
- 因全局入站预算拒绝：1013 resource pressure，不进入永久等待，不触发消费停滞分类
- 分片大消息重组期间，每次增长前都经 `tryReserve` 预留；预留失败时不再分配，`receive()` 以 `Capacity` 退出
- **确定性测试**：多条连接各自收到未完成的分片，共同耗尽全局预算。申请失败的连接以 1013 关闭（resource pressure），预算回收后其余连接继续完成消息，没有任何连接永久停住
- 预算租约：完成的消息转入入站缓冲不重复计费；消费、取消、异常、关闭各路径下预算恰好释放一次（计数归零）
- 丢弃模式下的数据负载不物化、不申请预算
- 挂起发送者超过 `maxSuspendedSendsTotal` 或 `maxSuspendedSendBytes`：立即抛 `WebSocketCapacityException`
- 超过 `maxMessageBytes` 的消息在登记等待之前就被拒绝，从不进入等待
- 纯 ASCII 文本按精确 UTF-8 长度预留，恰好等于上限的消息能被接受；超长字符串的长度计算不溢出
- `send` 挂起期间，框架不复制入参（分配计数验证）；预留成功后才复制
- Ping/Pong 竞态（可控时序，不靠网络碰运气）：让 Pong 在"Ping 写出完成"的回调**之前**到达，探测被判为已应答，不启动超时、不误报
- 单连接挂起的 `send` 超过 `maxSuspendedSends`：立即抛 `WebSocketCapacityException`
- 空闲连接的每连接 RSS 有实测数字（§10.4）

**关闭与生命周期**
- handler 正常返回发 1000；抛异常发 1011 并记录日志
- 对端发起关闭，`incoming` 正常结束，`finally` 执行
- 对端不回应关闭帧，`closeTimeoutMillis` 后强制释放
- 升级途中客户端断开：配额归还，无泄漏
- 心跳超时与空闲超时关闭连接
- 停机：所有 active 连接收到 1001，在宽限期内完成或被强制释放
- 停机时有处于 pending 的连接（101 正在写出）：交接完成后立即以 1001 关闭，不启动 handler，不遗漏
- 停机开始后的新握手一律 503，且 draining 状态不会复位
- handler 不响应取消：宽限期到期后连接资源照常释放，记录 WARN，之后对 `session` 的调用抛 `WebSocketClosedException`
- 心跳配置：各项为 0 的语义遵循 §10.2；不主动发 Ping 时没有待匹配探测，不能凭非零 pongTimeout 误踢；载荷不匹配的 Pong 不清除等待
- 长时间运行后连接数归零时，配额、协程、底层流全部释放

**性能**
- 无 WebSocket 路由的应用：baseline 与第 0 步之后的基线相比不回退
- echo 吞吐与延迟纳入基准测试，与独立运行的 `websocket` 库（`websocket-bench`）比较，量化框架层的开销

**多引擎**
- `WebSocketRuntimeSuite` 在假引擎上全部通过，覆盖全部公共策略
- 默认组合（netonstream 适配器 + netonstream provider）通过 `WebSocketEngineConformanceSuite`；netonstream 适配器通过 `HttpEngineConformanceSuite` 的升级用例
- 同一份业务代码（DSL 与注解各一个）在兼容组合上行为一致；在不兼容的组合上启动失败并列出路由
- 用一个测试用的自定义 provider 通过 `websocket(::TestProvider) { }` 替换默认引擎，业务代码不变即可运行
- 依赖方向：`neton-core`、`neton-http`、各 HTTP 适配器的依赖图中都不出现 `neton-websocket` 与 `com.netonstream:websocket`

**协议一致性**
- 通过框架 echo 路由跑 Autobahn 服务端测试，结果与独立库一致

**r12 验收清单（逐项以测试证据为准；已有功能测试不代表全部压力场景完成）**
- 两个 awaitClosed 等待者中取消一个，另一个仍获得最终结果；关闭后重复等待结果相同；公开接口没有可 cancel 的共享 Deferred
- 修改原请求集合和身份 roles/permissions 不改变快照；尝试修改返回集合不改变内部快照；未列白名单的凭据头不可读取；超限在 101 前失败且配额回滚
- 身份快照可传给接收 Identity 的函数；六个权限辅助方法均按快照集合返回结果。用重写方法会计数或抛异常的原 Identity 验证：生成快照和调用辅助方法不转发原方法，修改原集合也不改变结果；未认证时 identity 为 null
- 通过对象保留/弱引用诊断确认 Session 不持有 HttpContext/HttpResponse，而不只检查 public getter 的类型
- take(1) 后再次 collect 读取后续数据；第二个并发 collect 立即失败，第一个继续正常工作
- 在出队后交付前取消收集者：预算归零、已取走消息不重放、未取走消息可续读；在业务处理期间取消也不自动重放
- CloseResult 区分空 Close、未收到 Close、正常 1000、1011 完成握手、半途 EOF、写超时、关闭超时；1005/1006/1015 均无法发送
- finally 内 awaitClosed 不阻碍 transport 关闭/结果发布；一个结构化子任务失败、对端断开、停机三条路径下其他子任务按契约收尾；独立外部 Job 不伪称由框架管理
- REJECT_DATA 对零长度和分片数据也拒绝为 1008；DISCARD_DATA 不分配完整消息；两者仍处理控制帧并验证恶意掩码、非法 UTF-8、超长/不完整碎片
- 大量 DISCARD_DATA 热连接不能无限占用 executor，冷连接/定时器延迟与内存有测量；不能把取消业务队列当作活跃丢弃模式实现
- Handler 重载的编译矩阵见 §9.2.1；源码和文档示例使用同一套签名，不出现仅展示但无法编译的入口

## 十五、规范依据

### 2026-10-11 历史实施记录（当时状态，不替代 §2.4 当前基线）

- `neton-main-integration` 已实现握手快照、`awaitClosed`、分离的关闭结果、Handler 对象入口及连接级 `connectionId`（原字段 `sessionId` 已更名，不保留混淆语义的别名）。`sessionId` 专指现有认证体系的登录会话；同一登录会话可有多个连接，各自有不同订阅。断线重连产生新的 `connectionId`，不因此新建登录会话；订阅恢复须由业务重新授权，连接 ID 不是认证凭据。
- `BACKPRESSURE`、`REJECT_DATA`、`DISCARD_DATA` 已接入 DSL、注解生成代码及默认 provider。后两项按路由校验引擎能力，不支持则启动失败。
- 协议库在分配数据帧负载前执行拒绝；活跃丢弃增量校验掩码、分片、消息上限及 UTF-8，不进行完整消息重组，不复用关闭丢弃语义。当前不支持压缩与非交付策略组合。
- 丢弃每次最多处理 32 个步骤，每步最多消费 16 KiB；达到预算后驱动 yield 并继续处理缓冲数据，不错误等待下一次网络读取。此机制已测试，但不代表大规模混合负载 p99 已验收。
- 新增可复用 `WebSocketEngineConformanceSuite`：独立对端验证消息、空 Close、自动 Pong、预分配拒绝、帧上限、拒绝策略、有效/非法 UTF-8 丢弃、abort 唤醒。声明的能力不能跳过；它不替代 Autobahn 和完整一致性矩阵。
- 本轮 macOS：框架 50/50、协议库 255/255、KSP 43/43 通过；Linux x64/arm64 编译通过。未新增 Linux/Windows 实跑、高并发压测或框架级 Autobahn 结果；API/SPI 仍未冻结。
- 应用 `SecurityConfig.kt`、`CoreAuthenticatorBridge.kt` 存在其他任务的未提交鉴权改动，尚未整合；§16 的跨域凭据、撤权、用户会话索引及生产端点验收仍未完成。不得据此宣称管理员/会员已接入。

- [RFC 6455 §7.1.5、§7.4.1](https://www.rfc-editor.org/rfc/rfc6455.html#section-7.4.1)：未携带状态码的 Close、本地保留码、1003 与 1008 的语义。
- [kotlinx.coroutines Channel 契约](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.channels/-channel/)：prompt cancellation 与 undelivered elements；不能从“可续读”推出“任意取消不丢消息”。
- 第三方框架是设计参考，不是本实现的兼容性证明；本规范的行为由版本化一致性套件验证。

## 十六、应用装配与管理员/会员身份域

### 16.1 职责与当前接入状态

- neton-websocket 是通用通信能力，不属于 module-system。application 安装组件与全局资源配置；system 与 member 各自声明端点、握手授权与消息业务。会员授权不得借用管理员角色放行逻辑。
- 端点可分别位于 /admin/ws 与 /app/ws，沿用当前 application 的 admin/app 路由组；路径和路由组只选择策略，不证明 Token 属于该身份域。
- 2026-10-11 核对：application 的 includeBuild("../neton") 所指框架未包含 neton-websocket，WebSocket 实现在其他工作区。未完成框架整合、能力校验与以下验收之前，不注册生产 WebSocket 路由，不把规范写成已接入。
- 当前 member 模块已有 system/infra 依赖；本规范不借 WebSocket 扩大这项依赖，也不在本轮重构其既有短信、配置等协作。

### 16.2 认证域不能从用户 ID 或路由推断

- 管理员和内置会员当前共用 JWT 签验基础设施。只有 Identity(id, roles, permissions) 不足以证明身份域；禁止根据 id 存在于哪张表、是否有某个角色、请求路径或未经验证的 claim 自动提升身份。
- WebSocket 接入前，认证结果必须带有来自可信验证器的身份域及会话标识。可采用独立签验配置，或严格校验签名内的 issuer/audience/realm 与 access-token 类型；只有通过验证后的值可以参与授权。refresh token 不能用于握手。
- 旧 Token 缺少域字段时必须有显式迁移策略；不能静默视为管理员，也不能为了兼容让同一 Token 通行两域。当前验证器丢失域/会话元数据的路径需先补齐，不从 Session 的请求头白名单反向解析 Token。
- 连接索引至少是 (identityDomain, userId, sessionId, connectionId)，有租户时再加 tenantId。相同数字 ID 的管理员和会员互不关联；同一会话允许多个连接，同一用户允许多个设备。
- 这些元数据属于应用认证及连接管理契约，不向通用 Identity 强塞 system/member 枚举，不保留原 HttpContext 或原始凭据。具体认证结果承载 API 随框架整合另行实现和测试。

### 16.3 认证、权限与业务资源检查

- 握手复用 HTTP 安全链，在 101 前完成身份域、账户状态、Origin 与路由准入检查。浏览器 Cookie 认证不能以 CORS 代替 WebSocket Origin 检查。
- Identity.hasPermission 是精确集合查询，不是应用授权服务。system 的通配权限仍由 WildcardPermissionEvaluator 解释；快照包含 *:*:* 不代表直接 hasPermission("system:user:query") 会返回 true。
- system 权限评估器只能在应用配置器注册一次，不得被 DSL 或硬编码 super_admin 角色判断覆盖。角色声明与权限从同一份启用角色结果生成；禁用角色不参加菜单查询，也不产生超级管理员通配。
- member 每次订阅/发送/资源操作使用自己的账户状态、资源归属和会话成员资格检查；不得把“握手已登录”视为任意频道或用户的访问权。
- HTTP 和 WebSocket 的业务操作调用同一业务授权逻辑，不复制一份 WebSocket 专用 RBAC 算法。涉及当前权限的操作不得只信握手时快照。

### 16.4 撤权与关闭

- 新签令牌过滤禁用角色不等于撤销旧 JWT；已签令牌和已建立连接的权限不会自动更新。必须明确权限版本/会话撤销查询的策略、缓存期限及生效上限。
- 登出单设备按域+sessionId 处理；登出全端、封禁按域+userId（及租户）处理，不能只按裸 userId 广播关闭。退出/撤权通知丢失时还需期限或再验证兜底。
- 敏感操作在执行前校验当前授权。关闭连接不回滚已经提交的业务操作；并发撤权与数据库提交的保证由业务事务定义。
- 撤权关闭用 1008，原因不包含 Token 或敏感权限明细；心跳健康不代表认证仍然有效。

### 16.5 接入验收门槛

- 管理员/会员相同 id，分别建立多设备、多连接：发送、订阅、登出与封禁均不串域。
- 两域凭据交叉握手、refresh token 握手、缺域旧凭据均按显式策略拒绝；不通过手工构造 Identity 替代真实认证链验收。
- 自定义超级管理员代码和禁用超级管理员策略正确；模块/资源通配与精确权限一致；禁用角色不出现在新签 Token、菜单和权限结果中。
- 会员拥有自己的资源可以操作，其他用户资源被拒绝；同名管理员角色不改变会员授权结果。
- 登录后撤权、过期、登出、设备切换，在规定期限内拒绝敏感操作并回收目标连接；其他身份域及非目标设备不受影响。
- 真实 WS/WSS、Origin、升级失败回滚、长连接资源回收、普通 HTTP 不回退均通过后，才声明应用已接入。
