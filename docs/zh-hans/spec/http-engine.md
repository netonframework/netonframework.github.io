# Neton HTTP 引擎规范：单引擎交付与契约层零引擎

> **定位**：定义 HTTP **引擎**（同时承担入站 Server 与出站 Client）与 **契约层**
> （`neton-http`）之间的边界，使得删除任何一个引擎模块——包括 Ktor——之后，
> 框架的 HTTP Server 与 HTTP Client 仍然完整、可验证、行为不变。
>
> **状态**：**Draft，冻结候选**。本文是开发前置：§十 的发布顺序执行完毕前，
> 不得再向 `neton-http` 或任一引擎模块添加新的入口函数。
>
> **前置**：[HTTP 规范](./http.md)（抽象的形状）、
> [HTTP 引擎能力规范](./http-engine-capabilities.md)（Server 侧能力声明与一致性套件）。
> 本文把后者的方法论**对称地推到 Client 侧**，并把「默认引擎如何被选中」从惯例
> 变成契约。两份既有 spec 里与本文冲突的段落，以本文为准，修订清单见 §十三。
>
> **不在本文**：`HttpContext` / `HttpAdapter` / 路由 / 安全管线的形状（http.md）；
> hyper4k 的 C ABI 本身（`hyper4k/docs/ABI_V4_CLIENT_TLS.md`）。

---

## 一、问题陈述

以下每一条都是对当前代码的实测结论，不是推断：

| # | 事实 | 后果 |
|---|---|---|
| 1 | 无参 `http { }` 由 `neton-http-hyper4k` 在 `neton.http` 包下提供；`neton` 聚合只装 hyper4k | **Server 默认 hyper4k**，机制正确 |
| 2 | `HttpClient.Companion.create` 全仓只有一处声明：`neton-http-ktor` | **Client 默认 Ktor**——不是设计出来的，是「碰巧只有它有工厂」 |
| 3 | `neton` 聚合不含 `neton-http-ktor` | 只依赖聚合的工程写 `HttpClient.create { }` → `Unresolved reference 'create'`，看不出该加什么 |
| 4 | `neton-storage` 的 `S3StorageOperator` / `StorageComponent` 直接 `import io.ktor.client.*` | 删 Ktor 即断，且它绕过了 `HttpClient` 抽象 |
| 5 | `neton-ai` 测试依赖 `neton-http-ktor` + `ktor.client.mock` | 同上 |
| 6 | hyper4k Kotlin 侧只有 `Hyper4kServer.kt`；client 的 C ABI（v4）完整，但只被一个契约测试调用 | Client 走 hyper4k 缺的是 **Kotlin 封装 + neton 适配**，不是引擎 |
| 7 | hyper4k server 能力位是 `HTTP1 \| H2C \| STREAMING`，`lib.rs` 中无任何 TLS 符号 | Server 的 HTTP/2 **仅 h2c**，无 ALPN；「服务端支持 HTTP/2」这句话必须带限定 |

事实 2 是根因。Server 侧「引擎模块提供默认入口」做对了，Client 侧没有做，
于是一个本该可删的兼容模块成了隐性默认。**契约不对称，就一定会有一侧靠惯例活着。**

---

## 二、设计原则

四条规则。缺任何一条，「删掉 Ktor 也稳定」都不成立。

### 规则 1：一个引擎模块 = Server + Client 一起交付

引擎模块**必须同时**提供两个默认入口：

```kotlin
// 声明在 neton.http 包
fun Neton.LaunchBuilder.http(block: HttpConfig.() -> Unit = {})

// 声明在 neton.http.client 包
fun HttpClient.Companion.create(block: HttpClientConfig.() -> Unit = {}): HttpClient
```

**禁止**只提供一半的引擎模块。半个引擎让「谁是默认」取决于依赖图里碰巧有谁，
正是事实 2 的成因。

### 规则 2：契约层零引擎，可靠性由一致性套件证明

`neton-http` 不引用任何引擎类型。它提供的是接口、共享管线
（`BufferedHttpDispatcher`）、错误模型，以及**两套**引擎无关的一致性套件：
Server 侧（已有）与 Client 侧（本文新增）。

「两个引擎行为一致」不是承诺，是**每次构建都跑一遍的事实**。删掉一个引擎，
另一个的通过状态不变——这就是「稳定可靠」的操作性定义。

### 规则 3：聚合只装一个引擎，缺引擎时错误必须可读

`com.netonstream:neton` 恰好装**一个**引擎模块。缺引擎时的编译错误必须说清
「加哪一行依赖」，不允许停留在 `Unresolved reference`。

### 规则 4：框架内不允许第二条出站 HTTP 通道

框架任何模块（storage、ai、未来的 webhooks…）发出站请求**只能**经
`neton.http.client.HttpClient` 接口。`import io.ktor.client` 只允许出现在
`neton-http-ktor` 目录内。这是一条可 grep 的规则，应进 CI。

---

## 三、模块形态与依赖方向

```
                     ┌──────────────────────────────────────────┐
                     │ neton-http（契约层，零引擎）                │
                     │  HttpAdapter · HttpClient · Dispatcher    │
                     │  安全管线 · 错误模型                        │
                     │  HttpEngineConformanceSuite   (Server)    │
                     │  HttpClientConformanceSuite   (Client) ←新 │
                     │  testkit: ScriptedHttpClient          ←新 │
                     └────────────────────▲─────────────────────┘
                                          │ api
                  ┌───────────────────────┼───────────────────────┐
                  │                                               │
   ┌──────────────┴───────────────┐            ┌──────────────────┴──────────────┐
   │ neton-http-hyper4k           │            │ neton-http-ktor（可整体删除）      │
   │  Hyper4kHttpAdapter          │            │  KtorHttpAdapter · KtorHttpClient │
   │  Hyper4kHttpClient      ←新   │            │  同样两个入口                      │
   │  neton.http.http { }         │            │                                  │
   │  neton.http.client.          │            │  不进 neton 聚合                   │
   │    HttpClient.create { } ←新  │            │  不进 BOM（§九）                   │
   └──────────────▲───────────────┘            └──────────────────────────────────┘
                  │ api
   ┌──────────────┴───────────────┐
   │ neton（聚合）                  │   ← 只装一个引擎
   └──────────────────────────────┘
```

**依赖方向冻结**：

- 引擎模块 `api(neton-http)`；应用依赖引擎模块（或聚合），由 `api` 传递拿到契约层。
- 应用源码**永远不出现**引擎包名。换引擎 = 改一行 build 文件，源码零改动。
- 契约层**永远不出现**引擎包名。这一条由 CI 的 grep 守卫（§十一）。

> **为什么不是「应用显式 `import neton.http.hyper4k.*`」**
>
> 那把引擎名写进每一个应用的每一个源文件，换引擎要改全部源码——这正是 Ktor 时代
> 「业务代码 import io.ktor」的老路，也是 §一 事实 4 的成因。引擎选择属于构建期，
> 不属于源码。

> **为什么不是运行时发现（ServiceLoader / 全局注册）**
>
> Kotlin/Native 没有类路径扫描，也没有「链接进来就自动执行」的静态初始化。任何
> 运行时注册都需要有人**先调用**引擎模块里的某个函数，而那个调用点必须写在
> 应用源码里——又回到了上一条。编译期重载解析是 K/N 上唯一零源码成本的机制，
> http.md §1.3 已冻结此规则，本文不重开。

---

## 四、引擎入口契约

### 4.1 两个入口，同一机制

| 入口 | 声明包 | 形式 |
|---|---|---|
| Server | `neton.http` | `Neton.LaunchBuilder.http(block)` 的无参重载 |
| Client | `neton.http.client` | `HttpClient.Companion.create(block)` 伴生扩展 |

两者都是**编译期重载解析**：契约层只提供带引擎参数的形式
（`http(::XxxHttpAdapter) { }` / `HttpClient.createWith(factory) { }`），
无参形式由引擎模块声明在**契约层的包**下。应用 import 契约层的包即可，
引擎在时命中引擎，不在时编译失败。

### 4.2 唯一提供方

同一入口**只能由一个模块提供**。两个引擎模块都声明无参 `http { }` 时，同时依赖
两者的应用会得到重复声明错误。冻结：

- `neton-http-hyper4k` 提供两个入口；
- `neton-http-ktor` **也**提供两个入口（规则 1），但它**不进聚合、不进 BOM**，
  只能被显式依赖。显式依赖 Ktor 的应用**不得**同时依赖 hyper4k 引擎模块。
- 第三方引擎同理。选引擎是二选一，不是叠加。

### 4.3 缺引擎时的可读错误（已验证，冻结）

现状：`Unresolved reference 'create'`。目标：

```
e: No HTTP engine on the classpath.
   Add com.netonstream:neton-http-hyper4k, or depend on com.netonstream:neton.
```

候选机制：契约层声明一个**多一个带默认值哑参数**的同名 fallback，并标
`@Deprecated(level = DeprecationLevel.ERROR)`：

```kotlin
// neton-http, package neton.http.client
@Deprecated(
    "No HTTP engine on the classpath. Add com.netonstream:neton-http-hyper4k " +
        "or depend on com.netonstream:neton.",
    level = DeprecationLevel.ERROR,
)
fun HttpClient.Companion.create(
    block: HttpClientConfig.() -> Unit = {},
    missingEngine: MissingHttpEngine = MissingHttpEngine,
): HttpClient = error("unreachable")
```

依据 Kotlin 重载决议的「更具体候选」规则：调用 `create { }` 时，不需要使用
默认参数的候选（引擎模块的）优先于需要使用默认参数的候选（fallback）。引擎在时
命中引擎，不在时命中 fallback 并给出上面的错误。

**验证结果（§十 第 4 步）**：引擎在时 ktor / hyper4k / ai 三个模块编译不变、无二义；
引擎不在时两个入口各自恰好一条诊断，内容即上面的消息。两处实施细节：

- **哑参数放在第一位**，不是最后。尾随 lambda 绑定到最后一个参数，放最后会让 lambda
  落到 `MissingHttpEngine` 上，多出一条「类型不匹配」把真正的消息淹掉。
- 调用方需要 `import neton.http.client.create`——引擎入口与 fallback 都是该包下的
  扩展函数，没有 import 时看到的仍是 `Unresolved reference`。README 已写明。

Server 侧 `http { }` 的 fallback 同构，声明在 `neton.http` 包。

---

## 五、Client 契约层

### 5.1 接口不变

```kotlin
interface HttpClient {
    suspend fun request(request: HttpClientRequest): HttpClientResponse
    fun stream(request: HttpClientRequest): Flow<HttpClientStreamChunk>
    suspend fun close()
    val capabilities: Set<HttpClientCapability>          // ← 新增，无默认实现

    companion object {
        fun createWith(factory: HttpClientFactory, block: HttpClientConfig.() -> Unit = {}): HttpClient
    }
}
```

`request / stream / close` 与请求、响应、错误模型（`HttpClientRequest`、
`HttpClientResponse`、`HttpClientStreamChunk`、`HttpClientError`）**保持现有形状**。
本文不改公共面，只补能力声明与实现来源。

### 5.2 Client 能力

与 Server 侧同一判据：**缺失时应用是「错」而不是「慢」的能力才进枚举。**

```kotlin
package neton.http.client

enum class HttpClientCapability {
    /** 能协商并使用 HTTP/2。对只说 h2 的上游（gRPC 网关等）缺它即失败。 */
    HTTP_2,

    /** 响应体真流式：chunk 到达即 emit，不等响应结束。消费 SSE 的前提。 */
    STREAMING_BODY,

    /** Flow 取消能关闭底层连接/stream。缺它时取消只是停止 collect，服务端继续生成。 */
    CANCELLATION,

    /** 支持自定义 CA（私有 PKI）。 */
    CUSTOM_CA,

    /** 支持 HTTP 代理。 */
    PROXY,
}
```

**`capabilities` 无默认实现**，理由同 Server 侧（http-engine-capabilities.md §2.2）。

**配置与能力的关系（强制）**：`HttpClientConfig` 里设置了引擎不具备的能力所对应的
选项（如在无 `PROXY` 的引擎上设 `proxyUrl`），`createWith` **必须在返回前失败**，
错误信息包含「哪个选项」与「哪个引擎缺哪项能力」。不允许静默忽略——静默忽略的
`proxyUrl` 意味着请求从错误的网络出口发出去，这是安全问题，不是便利问题。

### 5.3 能力现状矩阵

| 能力 | Ktor（CIO / WinHttp） | hyper4k client |
|---|---|---|
| `HTTP_2` | ❌ CIO 在 Native 上不支持 | 引擎 ✅（ALPN，`HTTP2_REQUIRED` 可拒绝降级）；**neton 层暂不声明**，见下 |
| `STREAMING_BODY` | ✅ | ✅ `OnChunk` + `PAUSE/resume` 背压 |
| `CANCELLATION` | ✅ | ✅ `hyper4k_client_cancel`，回调线程安全 |
| `CUSTOM_CA` | ❌ `HttpClientConfig` 无 CA 选项 | 引擎 ✅；**neton 层暂不声明**，见下 |
| `PROXY` | ✅ HTTP 代理 | ❌ ABI v4 无代理；`proxyUrl` → create 失败 |

> ✅ 的依据必须是 Client 一致性套件里对应的测试通过，不是 ABI 文档说有。

**`Hyper4kHttpClient` 当前只声明 `STREAMING_BODY` 与 `CANCELLATION`。** 引擎在
Rust 层对 h2/ALPN 与自定义 CA 都有测试，但本套件还没有 h2 / TLS 对端，neton 层
拿不出对应的 `check*` 通过记录。按 §6.3 的纪律，没有测试守着的能力不许声明——
哪怕它"其实能用"。补上对端后两项一起解锁；在那之前，需要 h2 上游的应用
`require` 这两项会在 create 时失败，而不是在生产上以奇怪的方式失败。

**§十 第 2 步落地时的两处实测发现（都是套件抓出来的，都不在任何人预料内）：**

1. hyper4k client 在直连 HTTP/1.1 上发的是 **absolute-form** 请求行
   （`GET http://host:port/path`），而不是 origin-form（`GET /path`）。hyper 的
   低层 `conn` API 原样发送 URI，hyper 自己的 server 两种形式都接受，所以 hyper4k
   自己的 101 个 Rust 测试全绿。真实 origin 会拒绝或误路由。已修（H1 改写为
   origin-form，H2 保留完整 URI 以派生伪头），并在 Rust 侧加了原始 socket 抓请求行
   的回归测试。
2. hyper4k 的链接选项只写在自己 `build.gradle.kts` 的 `binaries.all` 里，
   **不随 klib 传给使用方**。第一个引用 `hyper4k_client_new` 的使用方在 macOS 上
   链接失败（`rustls-native-certs` 需要 `Security.framework`）。已改为写在
   `.def` 的 `linkerOpts.*`——这是唯一会跟着 klib 走的位置。

**Ktor 在 macOS 上不再使用 Darwin 引擎（实测结论，§十 第 1 步落地时发现）。**
套件第一次跑就把 NSURLSession 的三处行为钉出来了：把重复的 `Set-Cookie` 合并成
一个值、chunked 响应体攒到结束才交付（SSE 在上面不是慢，是不动）、Flow 取消后
连接不关闭。三条都在「所有引擎必须通过」的清单里，Darwin 因此被移出。Ktor 现在
在全部 POSIX 目标上用 CIO，macOS 与 Linux 行为一致；Windows 仍是 WinHttp，
其一致性在 `ScriptedOrigin` 有 winsock 实现之前**未经验证**。

这正是套件存在的意义：这三条此前没有任何测试覆盖，只有一条"macOS 上 SSE
有时候不太对"的模糊印象。

### 5.4 错误映射（hyper4k → `HttpClientError`）

| `Hyper4kErrorKind` | `HttpClientError` | 备注 |
|---|---|---|
| `DNS` / `CONNECT` | `Network` | |
| `TLS_CA` / `TLS_HOSTNAME` / `TLS_EXPIRED` / `TLS_OTHER` | `Network` | message 保留 kind 名，运维要看得出「证书哪里不对」 |
| `ALPN_NO_H2` | `Network` | 仅 `HTTP2_REQUIRED` 时出现 |
| `PROTOCOL` | `Network` | |
| `TIMEOUT` / `IDLE_TIMEOUT` | `Timeout` | 两者 message 区分：整体超时 vs 块间空闲 |
| `CANCELLED` | 不映射为错误 | Flow 取消 / `close()` 的正常终态，向上抛 `CancellationException` |
| `TRUNCATED` | `Network` | 响应已开始但未完整；**已 emit 的 chunk 不撤回** |
| `OUTCOME_UNKNOWN` | `Network`，`message` 以 `outcome unknown:` 起始 | 非幂等请求在连接中断时的唯一诚实答案；调用方**不得**据此自动重试 |
| HTTP 4xx/5xx | `request()`：**不映射**，原样返回 `HttpClientResponse`；`stream()`：第一个 chunk 之前抛 `Http(statusCode, body)` | 既有契约。状态码是响应的一部分（S3 的 404 是「不存在」不是错误）；而流式路径若不拦，一个 429 的错误 JSON 会流进 SSE 解析器变成零个事件和一次静默的正常结束 |

`OUTCOME_UNKNOWN` 单列一行是刻意的：它是 ABI v4 §四 的核心语义（RFC 9113
GOAWAY 边界），映射时**不得**并入普通 `Network` 而丢失「不可自动重试」的信息。
现有 `HttpClientError` 没有专门的变体；v1 用 message 前缀承载，**是否新增
`OutcomeUnknown` 变体**在 §十 第 2 步实施时决定，若新增须同步 Ktor 实现（Ktor
无法区分，永远不产生该变体）。

---

## 六、Client 一致性套件

### 6.1 形态

镜像 Server 套件（http-engine-capabilities.md §5）的结构：

```kotlin
package neton.http.conformance

abstract class HttpClientConformanceSuite {
    /** 被测客户端；实现方通常 `HttpClient.createWith(::createXxxClient)`。 */
    abstract fun createClient(block: HttpClientConfig.() -> Unit = {}): HttpClient

    /** 记录一次因能力缺失而跳过。必须显式，不得静默通过。 */
    abstract fun recordSkipped(capability: HttpClientCapability, testName: String)

    // 所有引擎都必须通过
    @Test fun get_returns_status_headers_and_body()
    @Test fun request_body_bytes_are_verbatim()            // 含 NUL / 非 UTF-8
    @Test fun headers_preserve_multi_value_and_case_insensitive_lookup()
    @Test fun request_returns_non_success_status_as_a_response()
    @Test fun stream_throws_HttpClientError_Http_for_non_success_status()
    @Test fun connection_refused_maps_to_Network()
    @Test fun request_timeout_maps_to_Timeout()
    @Test fun close_is_idempotent_and_rejects_further_requests()

    // 按 capabilities 条件执行
    @Test fun streaming_chunks_emit_before_body_completes()   // STREAMING_BODY
    @Test fun flow_cancellation_closes_the_connection()       // CANCELLATION
    @Test fun http2_is_negotiated_when_origin_offers_it()     // HTTP_2
    @Test fun custom_ca_is_trusted_and_system_ca_is_not()     // CUSTOM_CA
    @Test fun proxy_url_routes_through_the_proxy()            // PROXY
}
```

### 6.2 origin 从哪里来

套件需要一个对端。**契约层自带一个引擎无关的最小 origin**（`ScriptedOrigin`）：
在测试进程内监听 loopback，按脚本回放 HTTP/1.1 响应（含分块、延迟、半途断开）。
它**不复用任何被测引擎的 Server 侧**——否则 hyper4k client 的测试通过与否会和
hyper4k server 的正确性纠缠，一处回归两处红。

`HTTP_2` 与 `CUSTOM_CA` 的测试需要 h2 / TLS origin，最小 origin 不提供。这两项
在**引擎模块自己的仓库**用该引擎的 Server 侧（或 rustls 测试夹具）跑；契约层只
定义测试名与断言，用 `requiring(capability)` 守卫。

### 6.3 纪律（与 Server 侧相同）

- 条件跳过必须显式记录为 skipped；
- 声明了某能力却跳过对应测试 = 构建失败；
- `streaming_chunks_emit_before_body_completes` 必须用**时间**区分（chunk 到达
  时刻早于 origin 写完时刻），不能只比最终字节——缓冲实现的最终字节与流式实现
  完全相同，只有时序不同。Server 套件的 `ChunkMeter` 方法论在这里对称适用。

### 6.4 testkit：`ScriptedHttpClient`

`neton-ai` 等消费方的测试今天靠 Ktor 的 `MockEngine`。规则 4 之下它们不能再
碰 Ktor，契约层提供替代：

```kotlin
package neton.http.testkit

class ScriptedHttpClient : HttpClient {
    fun on(method: HttpClientMethod, urlPrefix: String, respond: suspend (HttpClientRequest) -> HttpClientResponse)
    fun onStream(method: HttpClientMethod, urlPrefix: String, chunks: List<HttpClientStreamChunk>)
    val recorded: List<HttpClientRequest>
    override val capabilities = HttpClientCapability.entries.toSet()   // 测试替身声明全集
}
```

它是 `HttpClient` 的**直接实现**，不经任何引擎，所以在零引擎的测试类路径上也能用。

---

## 七、hyper4k Kotlin 客户端封装

### 7.1 分层

```
neton-http-hyper4k ── Hyper4kHttpClient : neton.http.client.HttpClient
        │                 （neton 契约 ↔ hyper4k 模型的翻译）
        ▼
hyper4k (Kotlin) ──── Hyper4kClient
        │                 （C ABI v4 的安全封装：所有权、线程、回调桥接）
        ▼
hyper4k (Rust) ─────── hyper4k_client_*  （ABI v4，已完成）
```

`Hyper4kClient` 放在 hyper4k 仓（与 `Hyper4kServer` 对称），**不认识 neton**；
`Hyper4kHttpClient` 放在 neton 适配模块。两层分开是因为 hyper4k 是独立发布的库
（`com.netonstream:hyper4k`），它的 Kotlin 面不能依赖 neton 的类型。

### 7.2 `Hyper4kClient`（hyper4k 仓）

对 ABI v4 的逐条落实。ABI 文档是权威，这里只写 Kotlin 侧必须承担的义务：

| ABI 义务 | Kotlin 落实 |
|---|---|
| `free` 只能调一次、不得与其他 API 并发、不得在回调线程 | `Hyper4kClient.close()` 是 `suspend`：先 `hyper4k_client_close`（非阻塞），再在**专用阻塞线程**上 `free`；`AtomicInt` 保证单次 |
| 回调不得阻塞、不得抛异常穿越 ABI | 回调体只做「把事件塞进该请求的 `Channel`」；任何异常在边界捕获 → 返回 `CANCEL` |
| 同一 `request_id` 回调严格串行，不同请求并发 | 每请求一个 `Channel<Event>`；`StableRef` 作 `user_data`，`OnDone` 返回后 dispose |
| `PAUSE` / `resume` 背压 | `Channel` 有界（默认 8 chunk）；`OnChunk` 在队列满时返回 `PAUSE`，消费方 `receive` 腾出空位后调 `resume` |
| `close()` 会强制解除 PAUSED 并发 `OnDone(CANCELLED)` | 消费方收到 CANCELLED 终态即结束 Flow；不依赖 Kotlin 主动 `resume` |
| `send` 与 `close` 二选一 | `send` 返回 `CLIENT_CLOSED` → 立即抛 `HttpClientException(Network)`，无回调 |
| 回调可能与 `send()` 返回边界并发 | `Channel` 在 `send` **之前**创建并注册到 `user_data`；`out_request_id` 只用于 cancel/resume |
| 输入切片在 `send` 返回后即可释放 | `memScoped` 内构造 `Hyper4kClientRequest`，返回即释放 |
| `read_idle_timeout_ms = UINT64_MAX` 表示继承 | `hyper4k_client_request_init` 后再覆盖，**禁止**零初始化结构体 |

### 7.3 `Hyper4kHttpClient`（neton 适配模块）

| neton 契约 | hyper4k 映射 |
|---|---|
| `HttpClientConfig.connectMillis` | `Hyper4kClientOptions.connect_timeout_ms` |
| `HttpClientConfig.requestMillis` | `request_timeout_ms`（整个请求含重试，不重置） |
| `HttpClientConfig.socketMillis` | `read_idle_timeout_ms`（块间空闲，每块重置） |
| `HttpClientConfig.proxyUrl` | **无对应**：非 null → `createWith` 失败（§5.2） |
| `HttpClientRequest.timeout` | 覆盖该请求的 `read_idle_timeout_ms`；`0` = 显式禁用（SSE 场景） |
| `request()` | `on_chunk` 累积到 `ByteArray`；`OnDone(NONE)` 后组装 `HttpClientResponse` |
| `stream()` | `callbackFlow`：`OnHeaders` 校验状态，`OnChunk` → `Bytes`，`OnDone` → `End`；Flow 取消 → `hyper4k_client_cancel` |
| `capabilities` | `HTTP_2, STREAMING_BODY, CANCELLATION, CUSTOM_CA`（无 `PROXY`） |
| 错误 | §5.4 表 |

**`stream()` 的 4xx/5xx**：与现有 Ktor 实现保持一致——`stream()` 不把状态码映射为
异常，`OnHeaders` 的状态原样进 Flow 的首个元素（现有 `HttpClientStreamChunk` 没有
headers 变体；实施时若需新增 `Start(status, headers)` 变体，须同步 Ktor 实现与
`neton-ai` 的 SSE parser）。这是 §十 第 2 步的实施决策点，本文登记不预判。

### 7.4 平台

hyper4k 五个 K/N 目标全覆盖，`Hyper4kHttpClient` 因此不需要 `expect/actual`。
Ktor 实现的 Darwin / CIO / WinHttp 三选一在 hyper4k 路径上**消失**——这是
「服务端客户端同引擎」带来的直接收益：一份 TLS 栈、一份连接池、一份错误语义。

---

## 八、Server 侧 TLS 决策（冻结）

hyper4k server 无 TLS，HTTP/2 仅 h2c。两个选择必须明写一个，本文冻结为：

> **Neton 1.0 进程内不终止 TLS。HTTP/2 在 Server 侧的含义是 h2c（prior knowledge）。
> TLS 与 ALPN 由前置反向代理承担。**

理由与 http-engine-capabilities.md §4.2 一致：TLS 终止是部署拓扑问题，与引擎
是否会说 h2 无关。把证书塞进引擎会把「谁持有私钥」这个运维问题变成应用配置问题。

**文档义务**：所有提到「hyper4k 支持 HTTP/2」的地方必须写成「HTTP/2（h2c）」。
`http-engine-capabilities.md` §三 矩阵的 `HTTP_2` 行按此修订（§十三）。

**若未来做进程内 TLS**：单独立 spec，新增 `HttpCapability.TLS_TERMINATION`，
不得借 `HTTP_2` 的名义混入。

---

## 九、Ktor 归零路径

「Ktor 可选」今天是名义上的：三处实引用让它删不掉。归零的定义是
**删除 `neton-http-ktor` 目录后，仓库少的测试数为 0**（该模块自己的测试除外）。

| 引用点 | 处置 |
|---|---|
| `neton-storage/s3/S3StorageOperator.kt`、`StorageComponent.kt` | **已完成。** 经 `HttpClient` 接口；对象体走 `stream()` 组装（`HttpClientResponse.body` 是 String，缓冲路径会毁掉非 UTF-8 字节）；client 从 `ctx` 借用，s3 源没有绑定 client 时 init 报错并给出要加的那一行 |
| `neton-ai` 测试 | **已完成。** 7 个文件改用 `ScriptedHttpClient`（含可抛错的流式脚本）；测试类路径上不再有任何引擎 |
| `neton-ai` 主代码 | 已只依赖接口，无改动 |
| `neton-http-ktor` | **已移出 BOM**；标 maintenance：不再接收新功能，只跟随契约层接口变更。删除或归档作为独立决策 |
| `HttpClient.kt` KDoc 中「per-platform Ktor engine selection」 | 已删除，改为指向本文 |
| `neton-core/build.gradle.kts` | **已删除**五个 `ktor-server-*` 依赖——neton-core 里没有任何代码引用它们，但聚合上的每个二进制都把 Ktor 链了进去。import 级的 grep 抓不到这种泄漏，CI 守卫因此同时检查 build 文件里的 `libs.ktor` 别名 |
| `examples/neton-ai-sample` | 同时依赖两个引擎模块 → 改为只依赖 hyper4k（§4.2 二选一） |

**应用模块的迁移状态（2026-09-03）**：

| 模块 | 状态 |
|---|---|
| `neton-application-module-privchat`、`privchat-service-client` | ✅ 借用应用绑定的 `HttpClient`，端到端已验证 |
| `neton-application-module-system`（短信）、`-payment`（支付平台） | ✅ 同上；测试改用 `ScriptedHttpClient` |
| `neton-application-module-gateway`（AI 中继） | ⏸ **待决策**：`RelayEngine.clientFor(channel)` 按渠道建客户端并设置 `proxyUrl`，而 hyper4k client 无代理能力（§5.3）。改成默认引擎会让配置了代理的渠道在 create 时失败——这是能力模型要的行为，但也是真实的功能缺口。两条路：给 hyper4k client 加 HTTP 代理（ABI v4.1：`http://` 走 absolute-form、`https://` 走 CONNECT），或 gateway 显式保留 Ktor。在此之前 gateway 仍依赖 `neton-http-ktor`；因为是 `implementation` 依赖，不会把两个引擎同时暴露到应用的编译类路径，只是二进制里多一份引擎 |
| 三个应用（privchat / neton / kedao） | ✅ 在 `Main` 里创建、绑定、随生命周期关闭同一个出站客户端 |

**已知残留（不在本文范围，登记为后续项）**：`neton-routing → neton-redis → rethis →
ktor-network / ktor-io / ktor-utils / ktor-http / ktor-network-tls`。这是 Redis 客户端库
的传输层，不是 HTTP 引擎；但它让最小聚合（core + logging + http + routing）的二进制
里仍有 Ktor 的网络层符号，且与 `neton/build.gradle.kts` 自己写的「不把 redis 收进
聚合」相矛盾。根因是 `neton-routing` 为了 `RedisRateLimitStore` 硬依赖 `neton-redis`；
出路是把限流 store 做成 SPI、Redis 实现挪到独立模块。由路由/限流的 spec 处理。

**S3 的 `HEAD` 与 `LIST` 分页**依赖响应头与状态码，现有 `HttpClientResponse` 已
包含两者；`LIST` 的 XML 解析不依赖 Ktor。迁移是机械的，不涉及语义变化。

---

## 十、发布顺序

每一步可独立发布、独立回滚，**顺序不可颠倒**。**五步均已落地**（2026-09-03）；
下面保留原始顺序作为记录。发布前剩下的一件事：**hyper4k 0.2.0 必须先发布到
Maven Central**——`neton-http-hyper4k` 已依赖它（Kotlin 客户端在其中），本地用
`-Phyper4k.local=true` 走源码替换，CI 在发布前不会绿。

1. **契约层：`HttpClientCapability` + `HttpClient.capabilities` + `ScriptedOrigin` +
   `HttpClientConformanceSuite` + `ScriptedHttpClient`。** Ktor 实现如实声明能力并
   通过套件。此步之后才有验收后面每一步的尺子。
2. **hyper4k 仓：`Hyper4kClient` Kotlin 封装**（§7.2），以 ABI 契约测试 +
   `ClientAbiContractTest` 现有用例为基线。**neton 适配模块：`Hyper4kHttpClient` +
   `HttpClient.create { }`**（§7.3），通过一致性套件。此步之后聚合包的
   `HttpClient.create { }` 可用，且走 hyper4k。
3. **规则 4 落地：** storage / ai 改为消费接口（§九）；CI 加 grep 守卫（§十一）。
4. **缺引擎可读错误**（§4.3）：先验证重载决议，再冻结。
5. **`neton-http-ktor` 移出 BOM**，标 maintenance。

> 第 1 步单独发布就有价值：它让「Ktor client 与 hyper4k client 行为一致」从此
> 是可测的，哪怕第 2 步延期。

---

## 十一、验收标准

1. 只依赖 `com.netonstream:neton` 的最小工程，`http { }` 与 `HttpClient.create { }`
   **都**能编译并运行，二进制中**不含 Ktor HTTP 引擎**（`ktor-server-*` /
   `ktor-client-*`）的符号（`nm` / `strings` 可验）。`ktor-network` 等经 Redis 客户端
   进来的传输层符号属于 §九 登记的残留项，不在本条判定内。
2. Client 一致性套件在 Ktor 与 hyper4k 上各跑一遍；跳过项显式可见；声明了能力
   却跳过 = 构建失败。
3. `grep -rn "io\.ktor" --include=*.kt --include=*.kts` 在 `neton-http-ktor/` 与
   `examples/` 之外**零命中**，且此检查在 CI 中。
4. 在无 `PROXY` 能力的引擎上 `HttpClient.create { proxyUrl = "..." }` **在 create
   时失败**，错误信息含选项名与引擎名。
5. 删除 `neton-http-ktor` 目录后 `./gradlew allTests` 的用例总数只减少该模块
   自身的用例数。
6. 缺引擎时的编译错误包含依赖坐标（§4.3 已验证）。

**实战验证（2026-09-03）**：`privchat-service-client`——privchat 服务端唯一的业务
HTTP 客户端（近 60 个 service API 端点）——从自带 Ktor 引擎改为借用应用绑定的
`HttpClient`；`module-privchat` 同时去掉了对 `neton-http-ktor` 的依赖（它此前靠
Ktor 模块拿 `HttpClient.create`，与应用的 hyper4k 模块并存会二义）。
`privchat-application` 重新链接后，jwks / introspect / createRoom / issueRoomTicket /
broadcastRoom 全部经 hyper4k 出站，端到端通过。这是比一致性套件更硬的一层证据：
真实 envelope、真实错误映射、真实并发。

---

## 十二、非目标

- **不**改 `HttpClient` 的 `request / stream / close` 签名；
- **不**做 Server 侧 TLS（§八）；
- **不**做 hyper4k client 的代理支持（能力矩阵如实标 ❌；需要代理的应用显式用 Ktor）；
- **不**做出站连接池参数的公共配置面——ABI v4 有 `max_connections_per_host` 等，
  v1 用引擎缺省，暴露与否等有真实需求；
- **不**在本文决定 `neton-http-ktor` 的删除时间——§九 只把它变成**可删的**。

---

## 十三、对既有 spec 的修订清单

本文冻结时，以下段落同步修订，避免两份文档各说各话：

| 文档 | 段落 | 修订 |
|---|---|---|
| `http.md` | §1.3「v1 模块规则」第 3、4 条 | 删除 `httpClient { }` 与 `HttpClientComponent`（代码中已不存在）；`HttpClient.create { }` 改为「由引擎模块提供」 |
| `http.md` | §1.3「平台 Engine 固定由 neton-http 选择：Darwin / CIO / WinHttp」 | 删除。契约层不选引擎；Ktor 实现内部的平台选择是 Ktor 模块的实现细节 |
| `http.md` | §1.3 第 5 条「替换 Server Adapter 不改变出站 Client Engine」 | 改为「Server 与 Client 由**同一个**引擎模块交付；替换引擎模块同时替换两者」 |
| `http-engine-capabilities.md` | §三 矩阵 `HTTP_2` 行 | hyper4k 注明「h2c，无 TLS/ALPN（http-engine.md §八）」 |
| `http-engine-capabilities.md` | §七 非目标「不统一 HTTP 客户端」 | 改为「Client 侧见 http-engine.md」 |
| `index.md` | HTTP 与路由 | 增加本文条目 |

---

## 十四、与 hyper4k ABI 文档的关系

`hyper4k/docs/ABI_V4_CLIENT_TLS.md` 是 C ABI 的权威，本文 §七 只规定 Kotlin
侧如何**履行**那些义务，不复述也不修改 ABI。两者冲突时以 ABI 文档为准，并在
本文登记差异。
