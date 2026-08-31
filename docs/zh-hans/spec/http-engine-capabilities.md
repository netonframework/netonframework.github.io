# Neton HTTP 引擎能力规范

> **定位**：把「HTTP 引擎能提供什么」从隐式假设变成**显式声明 + 启动期校验**，
> 让 Ktor CIO 与 hyper4k 在同一套抽象下可插拔，并为 HTTP/2 落地划清边界。
>
> **状态**：**Draft**，面向下一个 beta。
>
> **前置**：[Neton HTTP 规范](./http.md)（HttpAdapter / HttpContext / 请求生命周期）。
> 本文只补「能力」这一层，不重复既有分层描述。

---

## 一、为什么需要这一层

### 1.1 一条实测结论

`neton-http` 用的是 `embeddedServer(CIO, ...)`（`adapterName() = "Ktor CIO"`）。
**Ktor CIO 在 Kotlin/Native 上不支持 HTTP/2，且不是升版本能解决的**：
Ktor 的 h2 只在 Netty / Jetty 引擎上，那两个是 JVM-only；Native 目标只有 CIO。

实测佐证（ktor 3.5.1）：

```
ktor-server-cio-*Main-3.5.1.klib 中 http2 / h2c 相关符号：0
```

结论：**HTTP/2 只能由 hyper4k 提供**。这不是缺陷，是引擎能力边界。

### 1.2 沉默降级才是真问题

今天的抽象**只描述形状，不描述能力**。`HttpAdapter` 仅有
`start / stop / port / adapterName` 四个方法，没有任何地方表达「这个引擎能不能做流式」。

后果已经写在既有契约测试的注释里：

> 契约：默认 `stream()` 把多次 `writeChunk` 缓冲为单次 `write`，块序保持
> （**不支持真流式的适配器兼容路径**）。

也就是说，在一个不支持真流式的引擎上跑 SSE：

- **不报错**
- 事件全部堆到响应结束才一次吐出
- 客户端看到的是「服务端半天没反应，然后一次性收到全部」

这类故障排查成本极高——它长得像网络问题、像上游慢，唯独不像「引擎不支持」。
AI gateway 正依赖 SSE，这不是假想风险。

**本规范的核心主张：能力必须被声明，不匹配必须在启动期 fail-fast，
而不是在某个深夜的流式请求里静默降级。**

---

## 二、能力模型

### 2.1 能力枚举

```kotlin
package neton.core.http.adapter

/** 引擎能力。新增能力必须同时更新所有内置 Adapter 的声明——见 §5 一致性套件。 */
enum class HttpCapability {
    /** HTTP/2（h2c 或 h2）。声明它意味着引擎能协商并服务 HTTP/2 连接。 */
    HTTP_2,

    /**
     * **真**流式响应：`writeChunk` 立即下发，不等响应结束。
     * SSE / chunked relay 的前提；不声明它的引擎只有缓冲兼容路径。
     */
    STREAMING_RESPONSE,

    /** multipart/form-data 解析（文件上传）。 */
    MULTIPART,

    /**
     * 异步 handoff：handler 可以交还 I/O 线程后再完成响应。
     * 不具备时，长耗时 handler 会占住引擎 worker。
     */
    ASYNC_HANDOFF,

    /** 请求/响应 trailers。gRPC-over-HTTP/2 之类的前提。 */
    TRAILERS,
}
```

> **只登记「会让应用行为出错」的能力**。「支持 gzip」这类可协商、缺失也只是慢一点的
> 特性不进枚举——枚举一旦泛化成 feature flag 列表，启动期校验就会变成噪音，
> 没人再认真看。判据：**缺失该能力时，应用是错，还是只是慢？错才进枚举。**

### 2.2 Adapter 声明

`HttpAdapter` 增加一个只读属性，**无默认实现**：

```kotlin
interface HttpAdapter {
    suspend fun start(ctx: NetonContext, onStarted: (suspend (Long) -> Unit)? = null)
    suspend fun stop()
    fun port(): Int
    fun adapterName(): String = "Unknown"

    /**
     * 本引擎实际具备的能力。
     *
     * **不给默认值**是刻意的：默认空集会让新 Adapter 悄悄「什么都不支持」，
     * 默认全集会让它悄悄「什么都支持」，两种都会把问题推迟到运行时。
     * 强制作者逐项回答。
     */
    val capabilities: Set<HttpCapability>
}
```

### 2.3 应用声明所需能力

```kotlin
Neton.LaunchBuilder()
    .http(::KtorHttpAdapter)
    .requireHttpCapabilities(HttpCapability.STREAMING_RESPONSE)   // 我要跑 SSE
```

组件也可以声明（如 `neton-ai` 的 SSE relay 组件在自己的 manifest 里 require
`STREAMING_RESPONSE`），框架在启动期做并集。

### 2.4 启动期校验（强制）

`Neton.run` 在调用 `adapter.start()` **之前**求
`required - adapter.capabilities`，非空即**终止启动**并打印：

```
Neton 启动失败：HTTP 引擎能力不足

  引擎：Ktor CIO
  缺失：STREAMING_RESPONSE

  STREAMING_RESPONSE 由以下组件要求：neton-ai (SSE relay)

  可选处置：
    · 换用具备该能力的引擎：Neton.LaunchBuilder().http(::Hyper4kHttpAdapter)
    · 或移除依赖该能力的组件
```

三条硬要求：

1. **fail-fast**，不得降级运行——降级正是本规范要消灭的东西
2. 错误信息必须说清**谁要求的**。只说"缺 STREAMING_RESPONSE"，使用者无从下手
3. 校验发生在 `start()` 之前，端口不应被占用后才失败

---

## 三、能力现状矩阵

| 能力 | Ktor CIO | hyper4k |
|---|---|---|
| `HTTP_2` | ❌ 引擎不支持（§1.1，永久） | ⏳ 依赖已带 `features = ["http2"]`，accept 循环未接 |
| `STREAMING_RESPONSE` | ✅ | ⏳ 路线图未完成 |
| `MULTIPART` | ✅ | ⏳ 路线图未完成 |
| `ASYNC_HANDOFF` | ✅（协程原生） | ⏳ 路线图未完成 |
| `TRAILERS` | ❌ | ⏳ 随 HTTP/2 一并 |

> ⏳ = 尚未实现。**实现前 `capabilities` 里就不许出现它**——
> 声明一个没做完的能力，比不声明更危险。

这张表也解释了为什么 hyper4k **暂时不能当默认引擎**：它缺的三项里，
`STREAMING_RESPONSE` 正被 AI gateway 使用。

---

## 四、HTTP/2 落地（hyper4k）

### 4.1 改动点

当前 accept 循环固定用 HTTP/1.1：

```rust
hyper::server::conn::http1::Builder::new()   // lib/src/lib.rs
```

改为 `hyper-util` 的 `auto::Builder`，按连接首部 preface 自动识别 h1 / h2c，
单端口同时服务两种协议，**不需要客户端预先知道服务端说什么**。

### 4.2 h2c 而非 ALPN

Neton 的典型部署里，HTTP 引擎在内网、TLS 由前置网关终止。所以先做
**h2c（明文 HTTP/2，prior knowledge）**，不做 ALPN——ALPN 需要引擎自己持有证书，
那是另一件事（TLS 终止归属），不应与 h2 支持绑定。

> 对照：`privchat-server → privchat-application` 这条内部链路正是明文内网调用，
> 发起方 `reqwest` 侧用的就是 `http2_prior_knowledge()`。

### 4.3 与二进制封帧无关

一个必须写明的边界：**HTTP/2 与请求体编码是两件独立的事**。
[PrivChat 的 ServerEvent 二进制封帧](https://github.com/privchat)
明确规定 h2 `MUST NOT` 成为其前置条件——去掉 JSON/base64 的收益与 HTTP 版本无关。

同理，本规范也**不**允许任何组件把「必须 h2」写进自己的 required capabilities，
除非它真的用到了 h2 独有语义（多路复用下的并发流、trailers）。
「为了性能」不构成理由。

---

## 五、引擎一致性套件（强制）

抽象层的价值等于「两个引擎行为一致」的可验证程度。没有这套东西，
可插拔就只是声称。

### 5.1 形态

`neton-core` 提供一组**引擎无关**的契约测试基类，每个 Adapter 实现方
必须以自己的引擎跑通全部：

```kotlin
abstract class HttpEngineConformanceSuite {
    abstract fun adapterFactory(): HttpAdapterFactory

    // 所有引擎都必须通过
    @Test fun routes_dispatch_by_method_and_path()
    @Test fun query_and_path_params_bind()
    @Test fun request_body_bytes_are_verbatim()          // 含内嵌 NUL / 非 UTF-8
    @Test fun response_content_type_is_honored()
    @Test fun error_status_codes_map_consistently()
    @Test fun headers_preserve_multi_value()

    // 按 capabilities 条件执行；不声明就跳过，并在报告里显式列为 skipped
    @Test fun streaming_chunks_arrive_before_completion()  // STREAMING_RESPONSE
    @Test fun multipart_upload_parses()                    // MULTIPART
    @Test fun http2_prior_knowledge_connection_serves()    // HTTP_2
}
```

### 5.2 两条纪律

- **条件跳过必须显式记录为 skipped，不得静默通过。** 一个能力全被跳过、
  报告却全绿的套件，等于没有套件。
- **声明了某能力却跳过对应测试 = 构建失败。** 这是防止「声明先行、实现拖延」的唯一闸门。

### 5.3 既有资产

`neton-core/src/commonTest` 里已有 `HttpResponseStreamContractTest`、
`ResponseEncodeDefaultsContractTest`，是这套东西的雏形，但它们测的是
**默认实现**而非**引擎实现**。迁移方式：把断言提到抽象基类，
让 `neton-http` 与 `neton-http-hyper4k` 各自继承并跑。

---

## 六、发布顺序

不可颠倒——每一步都能独立发布、独立回滚：

1. **能力枚举 + `HttpAdapter.capabilities` + 启动期校验**
   两个内置 Adapter 如实声明现状（hyper4k 此时**不**声明 h2 / streaming / multipart）
2. **一致性套件**，两个引擎各跑一遍，把差异钉成测试而不是口头知识
3. **hyper4k 补 `STREAMING_RESPONSE` / `MULTIPART` / `ASYNC_HANDOFF`**，
   每补一项，先让对应一致性测试通过，再在 `capabilities` 里加声明
4. **hyper4k 接 HTTP/2**（`auto::Builder` + h2c），同样测试先于声明
5. 视情况再谈默认引擎是否切换——**那是独立决策，不在本规范范围**

> 第 1 步单独发布就已经有价值：它把今天「SSE 在某些引擎上静默失效」这类问题
> 从运行时挪到启动期。哪怕后面几步都不做，这一条也值得先落地。

---

## 七、非目标

- **不**统一 HTTP 客户端（`neton-http/client` 是另一条线）
- **不**在本规范内决定默认引擎切换
- **不**做 ALPN / TLS 终止（§4.2）
- **不**把 Ktor CIO 「改造成」支持 h2——那需要重写引擎，不如用 hyper4k
- **不**为可协商、缺失只是变慢的特性（gzip、keep-alive 调参）建立能力项（§2.1）

---

## 八、验收标准

1. 新增 Adapter 时**不写** `capabilities` 无法编译（接口无默认实现）
2. 应用 require 一个引擎没有的能力 → **启动失败**，且错误信息包含
   「谁要求的」与「可换哪个引擎」
3. 一致性套件在 Ktor CIO 与 hyper4k 上各跑一遍；跳过项在报告中显式可见
4. 声明了能力但对应一致性测试被跳过 → 构建失败
5. hyper4k 接入 h2 后，`http2_prior_knowledge` 的客户端能完成一次完整请求-响应
