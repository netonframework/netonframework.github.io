# Neton WebSocket 规范

> **定位**：在 Neton 框架内提供 WebSocket 服务端能力：路由注册、握手安全、会话收发、关闭与停机。
> 协议本身不在框架内实现，由 `com.netonstream:websocket` 提供；本文只规定**框架如何接入它**。
>
> **状态**：**Draft v1 r3**。本文是实施规格，实施前的 API 讨论结论已并入。
> r2 按评审修订了运行时契约：单一协议读取者（§7.3）、发送顺序与数据所有权（§7.4）、
> 三类配额（§7.6）、升级中连接的停机（§8.3）、心跳三项配置（§10.2）、性能验收（§11.1）。
> r3 补充：各层职责划分（§2.5）、消费停滞与写阻塞不冒充心跳失败（§7.3、§7.4）、
> 心跳计时起点与错峰（§10.2）、全局预算与空闲连接成本（§10.3、§10.4）。
>
> **前置**：
> [HTTP 规范](./http.md)、[HTTP 引擎能力规范](./http-engine-capabilities.md)、
> [路由规范](./routing.md)、[参数绑定规范](./parameter-binding.md)、[安全规范](./security.md)、
> [Application Lifecycle Contract](./lifecycle.md)。
>
> **开发方式**：本阶段所有开发依赖**本地源码目录**，不发布任何版本（§3）。

---

## 一、范围

### 1.1 v1 交付

- HTTP/1.1 上的 `ws://` 与 `wss://`（RFC 6455），引擎为 `neton-http-netonstream`。
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
| hyper4k、Ktor 引擎上的 WebSocket | 这两个引擎不声明 `WEBSOCKET` 能力；注册了 WebSocket 路由时启动失败（§9） |
| `@OnOpen` / `@OnMessage` / `@OnClose` 生命周期注解 | 连接状态无处安放，见 §4.4 |

---

## 二、现状与依赖链

### 2.1 依赖链

```
Neton 路由 / 安全 / 会话 API          neton-core · neton-routing · neton-ksp · neton-http
        ↓
WebSocket 引擎适配                     neton-http-netonstream
        ↓
HTTP Upgrade → WebSocket              com.netonstream:http · com.netonstream:websocket
        ↓
io  或  tls → openssl → io            com.netonstream:io · tls · openssl
```

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

### 2.4 框架侧的缺口（已核对源码，`main` 分支）

| 缺口 | 位置 |
|---|---|
| 适配器使用不支持升级的 `serveConnection(...)`（`upgrades = false`） | `NetonStreamHttpAdapter.kt:279` |
| HTTP 服务结束后立即 `connectionHandlers.cancel()`，会连带取消升级后的会话 | `NetonStreamHttpAdapter.kt:284` |
| handler 作用域固定为 `Dispatchers.Default`，挂起后离开 reactor | `NetonStreamHttpAdapter.kt:278` |
| 请求被压平为 `BufferedHttpRequest`，`extensions`（含 `OnUpgrade`）丢失 | `NetonStreamHttpAdapter.kt:607` |
| CORS 对不允许的 Origin 只是不加响应头，不拒绝请求 | `BufferedHttpDispatcher.kt:621` |
| 依赖钉在 `io:0.3.0 / http:0.1.2 / tls:0.1.0`；websocket 0.2.0 需要 `io:0.3.2 / http:0.2.0`；`tls` 仓库自身仍依赖 `io:0.1.0` | `neton-http-netonstream/build.gradle.kts:24-26`、`tls/tls/build.gradle.kts` |

### 2.5 职责划分：哪些靠配置，哪些要框架实现

底层库提供**协议能力**，框架负责**连接管理**；业务用户只写 `webSocket { session -> … }` 和配置项，**不写心跳循环、不处理控制帧**。

| 能力 | 底层库已提供（已核对源码） | 框架必须实现的部分 | 业务用户 |
|---|---|---|---|
| Ping / Pong | 发送 Ping；解析 Pong；**读取时自动回复对端的 Ping**（`WebSocket.kt:27`） | 定时发 Ping、匹配 Pong、超时判定（§10.2）。`WebSocketConfig` **没有任何心跳或超时配置** | 只配参数 |
| 关闭握手 | Close 帧编解码与协议状态机 | 关闭期限、超时强制回收、取消业务协程（§7.7、§8） | 调用 `close()` 或直接返回 |
| 消息与帧大小、压缩 | `maxMessageSize`、`maxFrameSize`、permessage-deflate | 映射配置并设置服务端默认值（§10.1） | 只配参数 |
| 定时器 | io 的 reactor 本身是 `CoroutineDispatcher` + `Delay`，用最小堆加时间轮实现（`neton-io/.../net/Reactor.kt:82,247`） | 心跳、超时都用 reactor 上的定时器，**不为每条连接创建线程** | — |
| 空闲连接内存 | io 的池化 `Buffer` 首次写入时才取数组，reactor 的空闲扫描通过 `releaseIfIdle` 归还挂起读的数组（`neton-io/.../bytes/Buffer.kt:9-12`） | **需实测**：websocket 编解码器自己的读写缓冲是否被空闲扫描覆盖。若不覆盖，需在 websocket 库中补齐（§10.4） | — |
| 高并发连接管理 | 异步网络与协议收发 | 准入、单连接与全局预算、慢消费者与写阻塞处理、停机（§7.3、§7.4、§7.6、§8.3、§10.3） | 只配参数 |

结论：**不是"配置底层库就够了"**。协议层无需重写，但保活、超时、预算、回收这一层由框架实现；做完之后，业务侧只需要配置。

---

## 三、开发依赖方式：本地源码目录

### 3.1 规则

1. 本阶段**不发布** `io`、`http`、`tls`、`openssl`、`websocket`、`neton` 的任何版本。
2. neton 通过 Gradle **composite build** 直接使用兄弟目录的源码：
   `../io`、`../http`、`../tls`、`../openssl-kotlin`、`../websocket`。
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
    for (dir in listOf("../io", "../http", "../tls", "../openssl-kotlin", "../websocket")) {
        require(file(dir).isDirectory) { "netonstream.local=true requires $dir" }
        includeBuild(dir)
    }
}
```

所有库都通过 `allprojects { group = "com.netonstream" }` 设置坐标，composite build 会把整个构建图中的 `com.netonstream:*` 依赖替换为源码，**包括库与库之间的依赖**。例如 `websocket` 依赖的 `http:0.2.0` 也会被替换。

### 3.3 已知代价与风险

- `openssl` 按目标从源码编译 OpenSSL。首次本地构建较慢，增量构建不受影响。
- `tls` 当前按 `io:0.1.0` 编写。替换为 `io` 源码（0.3.2）后，**能否编译通过需要验证**，这是实施第 0 步（§11）。
- 坐标中的版本号在源码替换下不起作用，但仍须改写为与本地源码一致的版本，避免误读：`io:0.3.2`、`http:0.2.0`、`websocket:0.2.0`、`tls` 以其仓库当前版本为准。

### 3.4 恢复发布前的闸门

本阶段结束、准备发布时，必须依次完成：

1. 按依赖顺序发布各库：`io` → `openssl`（如有变化）→ `tls` → `http` → `websocket`。
2. neton 关闭 `netonstream.local`，坐标改为刚发布的版本。
3. 用 `netonstream.repository` 指向 staging 仓库，完整验证一遍。
4. 走既有的 [Release Gate](./release-gate.md)。

`netonstream.local=true` 的提交不得进入发布分支。

---

## 四、API

### 4.1 DSL

```kotlin
routing {
    get("/health") { ctx -> "ok" }

    webSocket("/echo") { session ->
        for (message in session.incoming) {
            session.send(message)
        }
    }

    webSocket("/chat/{room}") { session ->
        val room = session.request.pathParam("room")!!
        var count = 0                         // 连接级状态 = 局部变量
        try {
            for (message in session.incoming) {
                count++
                session.sendText("[$room] #$count")
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
    handler: suspend (WebSocketSession) -> Unit,
)
```

显式写出 `session ->`，与现有 `get { ctx -> }` 的风格一致。DSL 与注解的能力必须一一对应，任何一方新增参数时另一方同步提供。

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
package neton.core.websocket

interface WebSocketSession {
    /** 握手请求的只读视图：路径参数、查询参数、请求头、远端地址。 */
    val request: HttpRequest
    /** 握手阶段认证得到的身份；匿名路由为 null。 */
    val identity: Identity?
    /** 协商出的子协议；未协商时为 null。 */
    val subprotocol: String?

    /**
     * 完整数据消息（分片已重组），来自协议读取者的有界入站缓冲（§7.3）。
     * 单消费者：并发迭代第二次抛 IllegalStateException。连接进入关闭后迭代结束。
     * 不读取不会阻止控制帧处理与关闭握手。
     */
    val incoming: WebSocketIncoming

    /**
     * 把消息交给连接的出站队列（§7.4）。返回 = **已接受**（进入队列），不代表已送达对端。
     * 任意协程、任意线程可调用。队列满时挂起；挂起期间被取消 = 未接受，消息不会发出。
     * 单条消息超过 outboundQueueBytes 时立即抛 WebSocketMessageTooLargeException。
     * 连接已关闭时抛 WebSocketClosedException。
     */
    suspend fun send(message: WebSocketMessage)
    suspend fun sendText(text: String) = send(WebSocketMessage.Text(text))
    suspend fun sendBinary(bytes: ByteArray) = send(WebSocketMessage.Binary(bytes))

    /** 不挂起地尝试接受；队列满、超过单条上限或连接已关闭时返回 false。返回 true 与 send 返回的含义相同。 */
    fun trySend(message: WebSocketMessage): Boolean

    /** 发起关闭握手。幂等。返回时关闭握手已完成，或已超时强制释放（§8.2）。 */
    suspend fun close(code: CloseCode = CloseCode.NORMAL, reason: String = "")

    /** 连接最终的关闭原因；连接结束时完成。 */
    val closed: Deferred<CloseReason>
}

interface WebSocketIncoming {
    operator fun iterator(): WebSocketIterator
}

interface WebSocketIterator {
    suspend operator fun hasNext(): Boolean
    operator fun next(): WebSocketMessage
}

sealed interface WebSocketMessage {
    class Text(val text: String) : WebSocketMessage
    /** 构造时复制入参：此后调用方可任意修改原数组，不影响已构造的消息。 */
    class Binary(bytes: ByteArray) : WebSocketMessage {
        /** 构造时的副本。框架与调用方都不得修改它。 */
        val bytes: ByteArray = bytes.copyOf()
    }
}
```

约束：

- **不暴露** `neton.websocket.*` 的任何类型，也不暴露 Ping、Pong、Close 帧。控制帧由框架处理。
- `incoming` 是挂起迭代器，读的是协议读取者交接过来的有界缓冲（§7.3），不是第二个协议读取者。
- 数据所有权：`Binary` 在**构造时复制**，`send` / `trySend` 之后调用方修改原数组不影响发出的内容。框架内部从此只持有副本，不再复制。
- `close` 的 `reason` 超过 123 字节时抛 `IllegalArgumentException`（RFC 6455 §5.5 限制）。

### 4.4 不采用的写法

- **`@OnOpen` / `@OnMessage` / `@OnClose` 分散回调**：Controller 是单例，连接状态只能放进 `Map<sessionId, …>`，清理依赖关闭回调，容易泄漏。用一个挂起函数对应一条连接，状态用局部变量，清理写在 `finally` 中，停机时取消协程就能完成收尾。
- **把底层 `WebSocket` 直接交给业务**：会把 reactor 线程约束和单读单写约束暴露给用户。

---

## 五、注册与路由模型

### 5.1 路由描述

`RouteDefinition`（`neton-core/.../interfaces/RequestEngine.kt`）新增一个字段：

```kotlin
data class RouteDefinition(
    ...
    val webSocket: WebSocketEndpoint? = null,   // 非 null 即为 WebSocket 路由
)

class WebSocketEndpoint(
    val handler: WebSocketHandler,
    val subprotocols: List<String> = emptyList(),   // 服务端支持的子协议，按偏好排序
)

interface WebSocketHandler {
    suspend fun invoke(session: WebSocketSession, args: HandlerArgs)
}
```

- DSL 与 KSP 都生成 `method = GET` 且带 `webSocket` 的 `RouteDefinition`，**只有这一种注册形态**。
- `allowAnonymous`、`requireAuth`、`routeGroup`、`permission`、`rateLimit`、`parameterBindings` 沿用 HTTP 路由的含义，不另起一套。
- 这类路由的 `handler` 字段由框架填入固定实现：收到**不带升级头**的普通 GET 时，返回 `426 Upgrade Required`，并带响应头 `Upgrade: websocket`。

### 5.2 注解参数

```kotlin
annotation class WebSocket(val value: String = "", val subprotocols: Array<String> = [])
```

### 5.3 能力登记

注册任意一条 WebSocket 路由，都会向 `HttpCapabilityRequirements` 登记 `WEBSOCKET` 能力，来源记为该路由，例如 `WebSocket /chat/{room} (ChatController.connect)`。

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

握手鉴权只决定"能不能建立连接"。连接建立之后的授权由应用负责，比如能否加入某个房间、能否发布、令牌过期后如何处理。框架提供 `close(CloseCode.POLICY_VIOLATION)` 作为统一的踢出方式，不自动重验令牌。

---

## 七、线程与所有权模型

### 7.1 角色

```
一条 WebSocket 连接 =
  连接协程（reactor 上，所有者）
    ├─ 底层 WebSocket（fromUpgraded 在 reactor 上创建，写驱动随之运行在 reactor 上）
    ├─ 协议读取者（唯一调用底层 receive 的地方）──→ 入站缓冲（有界）──→ incoming
    ├─ 出站队列（有界，线程安全，单一 FIFO）──→ 写串行器 ──→ 底层写接口
    ├─ 心跳计时（reactor 上）
    └─ 业务处理协程（handler）
```

连接协程是**唯一所有者**，负责：协议读取、写入串行化、心跳、关闭握手、超时强制释放、三类配额的归还（§7.6）。业务处理协程只通过 `incoming` 与出站队列和连接交互，**从不直接调用底层 `WebSocket`**。

### 7.2 升级时序

```
reactor 线程（连接协程）                         HTTP 交换
─────────────────────────────────────────────────────────────────────
serveConnectionWithUpgrades(io, alpn, service)
                                               service(request):
                                                 §6.1 第 1–8 步
                                                 生成 101（第 9 步）
                                                 在请求上标记"接受升级"
                                               ← 返回 101 响应（不等待任何东西）
h1 写出并 flush 101
本次交换结束 → fulfill(Upgraded(stream, rest))
serve(connection) 返回
检查"接受升级"标记 ──否──→ 照旧清理连接，结束
        │是
upgraded = upgradeOn(request.extensions)       （此时已完成，不会阻塞）
ws = WebSocket.fromUpgraded(upgraded, Role.Server, config, deflate)
                                               （预读的首帧随 rest 一起交给 ws）
进入连接循环（§7.3、§7.4），启动业务处理协程
```

要点：

- **不得**在 service 返回 101 之前等待 `upgradeOn()`。h1 要等 101 写出之后才 `fulfill`，提前等待会让双方互相等待。
- 分发结果必须显式区分"普通响应"和"接受升级"。升级响应**不走**普通响应的包装、压缩（`Compression.kt`）和请求超时流程。
- 必须使用 `fromUpgraded`，不得使用 `fromRawStream(stream, …)`。后者会丢掉与握手同一个包到达的首帧。
- 升级失败（`upgradeOn` 抛 `UserNoUpgrade` 或其他错误）时，由连接协程关闭底层流并归还配额。业务处理协程尚未启动，不涉及业务清理。

### 7.3 入站：单一协议读取者

底层的 Ping 自动回复、关闭帧处理都发生在 `receive()` 内部，写驱动不会代为读取（`WebSocket.kt:27`）。因此：

- **始终只有一个协议读取者**：连接协程里的读循环。它是唯一调用底层 `receive()` 的地方，业务代码与框架其他部分都不调用。
- 读到的**数据消息**放入入站缓冲，`incoming` 从缓冲中取。**控制帧**（Ping、Pong、Close）由读取者当场处理，不进缓冲。
- 入站缓冲按消息数与字节数双重限制（§10.1 `inboundQueueMessages` / `inboundQueueBytes`）。
- **缓冲满时，读取者暂停读取**，由 TCP 把背压传给对端。
- **消费停滞是本地问题，不归咎对端**。暂停读取期间，对端回的 Pong 可能就在我们自己没读的数据之后，因此：
  - 暂停期间**冻结** Pong 等待计时与入站空闲计时，恢复读取后继续计时；
  - 缓冲**持续满**超过 `inboundStallTimeoutMillis`（§10.1），按"消费停滞"以 1011 关闭（§8.1），日志与 `closed` 的原因注明 consumer stalled，**不记为心跳失败**；
  - `inboundStallTimeoutMillis = 0` 表示不因消费停滞关闭。此时连接可以一直处于暂停读取状态，内存仍受入站缓冲预算约束。
- **连接进入关闭状态后**（任一方发起关闭、停机、超时）：
  - 正在等待 `incoming` 的业务协程立即被唤醒，迭代结束；
  - 读取者**丢弃**入站缓冲中尚未消费的数据和后续数据消息，恢复读取并持续推进，直到关闭握手完成或 `closeTimeoutMillis` 到期。关闭握手不依赖业务是否读取。
- handler 只发不收、正在等待其他 I/O、或自己调用了 `session.close()`，都不影响控制帧处理和关闭握手。

### 7.4 出站：单一 FIFO 与数据所有权

- **单一出站队列，单一顺序**。所有发送（任意线程的业务发送、Hub 等后续扩展）都按**被接受的先后**进入同一个 FIFO，写串行器按此顺序写出。**不设**"本 reactor 直接写、绕过队列"的旁路：旁路会让后发的消息越过队列中先被接受的消息。
  （性能优化只允许在**不改变顺序**的前提下进行，例如在 reactor 线程上且队列为空时就地写出；是否值得做，由 §11 第 3 步的数据决定。）
- **控制帧插队的边界**：心跳 Ping、Pong 回复、关闭帧不进数据 FIFO，由写串行器在两条数据消息之间插入，不会排在已积压的数据消息后面。但控制帧**不能**打断一次正在进行的网络写操作。对端不读时，控制帧同样写不出去。"插队"只解决排队，不解决慢客户端。
- **写超时**：每一次底层写出（flush）都有期限 `writeTimeoutMillis`（§10.1）。超时归类为"写阻塞"：对端已不读取，关闭帧也写不出去，因此**不发关闭帧**，直接强制关闭底层流（§7.7 第 4 至 7 步），`closed` 记为 1006，原因注明 write stalled，**不记为心跳失败**。
- **任何路径都不得绕过写串行器**直接调用底层写接口。
- **预算**：出站队列按消息数与字节数双重限制（§10.1）。字节预算覆盖"已接受未写出"与"正在写出"两部分。挂起中的 `send` 所持有的消息**不计入**预算，它仍归调用方所有；应用要自行约束并发挂起的发送数量。
- **单条超限**：一条消息本身超过 `outboundQueueBytes` 时，立即抛 `WebSocketMessageTooLargeException`，而不是永久挂起。
- **接受的时点**：消息进入 FIFO 的那一刻。之前被取消 = 未发送；之后被取消（调用方协程被取消）不影响它被写出，除非连接先关闭。
- **连接关闭后**，队列中尚未写出的消息丢弃，`send` 抛 `WebSocketClosedException`，`trySend` 返回 false。

### 7.5 业务处理协程跑在哪里（待定，见 §12）

| 方案 | 做法 | 优点 | 代价 |
|---|---|---|---|
| A：reactor 上运行 | handler 在连接所在 reactor 的调度器上启动，挂起后回到同一 reactor | 入站缓冲与出站队列的交接都在同一线程上，无线程跳转 | 业务若在 handler 中阻塞，会拖慢同一 reactor 上的其他连接；重活须 `withContext(Dispatchers.Default)` |
| B：Default 上运行 | handler 在 `Dispatchers.Default` 上运行 | 业务不可能阻塞 reactor | 入站、出站每条消息各一次线程跳转 |

两种方案都遵守 §7.3、§7.4 的**同一个所有权模型**：唯一协议读取者、单一出站 FIFO。区别只在 handler 运行的线程，API 完全相同（§4.3）。本节由 §11 第 3 步的基准测试数据决定；在得出结论之前不冻结。

### 7.6 三类配额

适配器里有两种性质不同的计数（已核对 `NetonStreamHttpAdapter.kt`）：`maxOpenConnections` 限制 **TCP 连接数**；`HttpServerConfig.maxConnections` 实际限制的是**在途 HTTP 请求数**（`admit()`，第 442 行）。WebSocket 再加一类自己的配额。三者的规则冻结如下：

| 配额 | 获取 | 释放 |
|---|---|---|
| TCP 连接（`maxOpenConnections`） | 接受 TCP 连接时（现有逻辑） | 底层流关闭时。**升级后继续持有**，直到 WebSocket 连接结束 |
| 在途 HTTP 请求（`maxConnections`） | 握手请求进入分发时（现有逻辑） | **升级交接完成时释放**。长连接不得长期占用请求名额，否则会挤掉普通 HTTP 请求 |
| WebSocket 连接（`websocket.maxConnections`） | **发送 101 之前预留**（§6.1 第 8 步） | 预留后握手失败或升级失败时**回滚**；否则在连接最终结束时释放 |

### 7.7 结束与清理

连接结束的唯一出口在连接协程的 `finally` 中。每一步都有时限，**任一步抛异常不影响后续步骤执行**：

1. 若连接尚未进入关闭状态，按 §8.1 发起关闭（发送关闭帧）；
2. 在 `closeTimeoutMillis` 内继续由协议读取者完成关闭握手（§8.2）；
3. 取消业务处理协程，并等待其结束，最长到第 2 步的同一截止时间；
4. 关闭底层 `WebSocket`。写驱动使用独立 Job（`WebSocket.kt:435`），**必须显式关闭**，不能指望取消传递；
5. 关闭底层流（强制，不再等待）；
6. 完成 `session.closed`；
7. 释放 WebSocket 配额与 TCP 连接配额。

**`closed` 的完成时点**：底层流已关闭之后。`closed` 完成时，连接不再收发任何字节。

**不配合取消的业务代码**：框架**不承诺**任意业务代码都能在时限内执行完 `finally`。第 3 步超时后，框架照常执行 4 至 7 步释放连接资源，并对该路由记录一条 WARN（包含路由与超时时长）。此后该 handler 对 `session` 的调用一律抛 `WebSocketClosedException`。

升级后的连接**不属于** HTTP 的 `connectionHandlers` 作用域，后者在 `serve()` 返回时取消，不能波及 WebSocket。升级后的连接由适配器级的 WebSocket 注册表管理（§8.3）。

---

## 八、关闭

### 8.1 关闭码

| 情况 | 关闭码 | 说明 |
|---|---|---|
| handler 正常返回 | 1000 Normal | |
| 服务端停机 | 1001 Going Away | |
| Pong 超时（§10.2） | 1001 Going Away | 尝试发送关闭帧，受 `closeTimeoutMillis` 与 `writeTimeoutMillis` 约束 |
| 入站空闲超时（§10.2） | 1001 Going Away | |
| 消费停滞：入站缓冲持续满超过 `inboundStallTimeoutMillis` | 1011 Internal Error | 本地问题，原因注明 consumer stalled |
| 写阻塞：一次写出超过 `writeTimeoutMillis` | 不发关闭帧 | 强制关闭，`closed` 记为 1006，原因注明 write stalled |
| 入站消息超过 `maxMessageBytes` | 1009 Message Too Big | |
| 入站文本不是合法 UTF-8 | 1007 Invalid Payload | |
| 协议错误（帧格式、未掩码等） | 1002 Protocol Error | 需要 `sendCloseOnProtocolError = true`（§10.1） |
| 应用主动拒绝（令牌过期、无权订阅） | 1008 Policy Violation | 应用调用 `close(POLICY_VIOLATION)` |
| handler 抛出异常 | 1011 Internal Error | 记录 ERROR 日志，带路由与异常 |
| handler 因停机被取消 | 1001 Going Away | 取消**不**映射为 1011 |
| 对端已断开（读到 EOF 或 I/O 错误） | 不发关闭帧 | 直接释放，`closed` 记为 1006 Abnormal |

`CloseCode` 提供上表各码的常量，并允许应用使用 3000–4999 的私有码。

### 8.2 关闭握手的等待期限

调用 `close(...)` 或框架触发关闭时：发送关闭帧，继续读取直到对端回应关闭帧。超过 `closeTimeoutMillis` 仍未收到回应，就强制关闭底层流。期间收到的数据消息丢弃，不再交给 `incoming`。

### 8.3 停机

**注册表**：适配器维护一个 WebSocket 注册表，同时管理两种状态的连接：

- **pending**：已在 §6.1 第 8 步预留配额、101 尚未完成交接的连接；
- **active**：已完成交接、连接协程正在运行的连接。

连接在预留配额时**同时**登记为 pending，交接完成后转为 active，结束时注销。登记、状态转换、注销与停机状态的读取在同一把锁（或同一原子状态）下完成，不存在"已接受但未登记"的窗口。

**停机状态是持续生效的标志，不是一次性快照**。适配器停机时：

1. 置 draining 标志。此后所有新握手在第 8 步前返回 503，不再预留配额。该标志不会复位；
2. 对 active 连接：按 §8.1 以 1001 发起关闭，并取消业务处理协程；
3. 对 pending 连接：不打断 101 的写出；交接一完成就检查 draining 标志，立即以 1001 关闭，不启动业务处理协程；
4. 等待注册表清空，最长到停机宽限期；
5. 宽限期到期后，对剩余连接强制执行 §7.7 的第 4 至 7 步。

停机流程纳入 [Lifecycle Contract](./lifecycle.md) 的资源所有权链：WebSocket 作用域在 HTTP 监听停止**之后**关闭，以保证已建立的连接能收到 1001。

---

## 九、引擎能力

```kotlin
enum class HttpCapability {
    HTTP_2, STREAMING_RESPONSE, MULTIPART, ASYNC_HANDOFF, TRAILERS,
    /** HTTP/1.1 Upgrade 到 WebSocket（RFC 6455）。 */
    WEBSOCKET,
}
```

| 引擎 | 声明 `WEBSOCKET` |
|---|---|
| `neton-http-netonstream` | 是 |
| `neton-http-hyper4k` | 否 |
| `neton-http-ktor` | 否 |

注册了 WebSocket 路由，而当前引擎不声明 `WEBSOCKET` 时，由现有的 `validateHttpCapabilities` 在 `adapter.start()` **之前**抛出 `HttpCapabilityException`，并列出所有相关路由。**不降级、不返回 501。**

---

## 十、配置

### 10.1 配置项

```toml
[websocket]
maxConnections        = 10000      # WebSocket 连接上限（§7.6）；与 HTTP 在途请求配额独立
maxMessageBytes       = 1048576    # 1 MiB，入站完整消息上限 → 底层 maxMessageSize
maxFrameBytes         = 1048576    # 1 MiB，入站单帧上限 → 底层 maxFrameSize
readBufferBytes       = 16384      # 16 KiB → 底层 readBufferSize（底层默认 128 KiB，见 §10.4）
writeBufferBytes      = 16384      # 16 KiB → 底层 writeBufferSize（底层默认 128 KiB）
inboundQueueMessages  = 64         # 每连接入站缓冲消息数上限（§7.3）
inboundQueueBytes     = 1048576    # 1 MiB，每连接入站缓冲字节数上限
inboundStallTimeoutMillis = 30000  # 入站缓冲持续满多久判定消费停滞；0 = 不因此关闭
outboundQueueMessages = 256        # 每连接出站队列消息数上限（§7.4）
outboundQueueBytes    = 4194304    # 4 MiB，每连接出站队列字节数上限；也是单条出站消息上限
maxSuspendedSends     = 16         # 每连接同时挂起的 send 上限；超出立即抛 WebSocketBackpressureException
writeTimeoutMillis    = 10000      # 单次底层写出的期限（§7.4）
maxBufferedBytes      = 536870912  # 512 MiB，全部 WebSocket 连接的入站与出站缓冲总预算（§10.3）
pingIntervalMillis    = 30000      # 0 = 不主动发 Ping
pongTimeoutMillis     = 10000      # 0 = 不等待 Pong
idleTimeoutMillis     = 0          # 0 = 关闭入站空闲超时
closeTimeoutMillis    = 5000
compression           = false      # permessage-deflate，默认关闭
allowedOrigins        = []         # 见 §6.3；空 = 仅同源
```

- 框架**始终**设置 `sendCloseOnProtocolError = true`，不对外暴露此项。
- 开启 `compression` 时，`maxMessageBytes` 限制的是**解压后**的大小，防止压缩炸弹。
- `inboundQueueBytes` 必须不小于 `maxMessageBytes`，否则一条合法的最大消息永远放不进缓冲；不满足时启动失败。
- `writeTimeoutMillis` 必须大于 0。写超时是回收"对端不读"连接的唯一手段，不允许关闭。
- 注解与 DSL 的路由级覆盖不在 v1 范围内，v1 只有全局配置。

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
- 读取暂停期间（§7.3）冻结 Pong 等待与入站空闲计时。
- **错峰**：每条连接的第一次 Ping 在 `[0, pingIntervalMillis)` 内随机偏移，此后按固定间隔。避免大量连接同时建立后在同一时刻发 Ping。
- 所有计时都用 reactor 上的定时器（§2.5），不为每条连接创建线程。

启动期校验只针对**同时开启**的组合：

- `pongTimeoutMillis > 0` 要求 `pingIntervalMillis > 0`，否则无从等待，启动失败；
- 两者都开启时，要求 `pongTimeoutMillis <= pingIntervalMillis`，否则启动失败；
- `idleTimeoutMillis` 与另外两项**不做**大小约束。任一项为 0 就是关闭该项，关闭不会导致启动失败。

### 10.3 全局预算与高并发

单连接有界，不等于全局内存可控。按 §10.1 的默认值，仅出站队列一项，10,000 条连接 × 4 MiB 的理论上限就约为 39 GiB。这不是预分配，但说明必须有全局约束：

- **全局缓冲预算** `maxBufferedBytes`：所有 WebSocket 连接的入站缓冲与出站队列（含正在写出的数据）共用一个计数。
  - 达到上限时，`send` 按"队列满"处理（挂起；`trySend` 返回 false），读取者按"缓冲满"处理（暂停读取）；
  - 达到上限时，新握手在 §6.1 第 8 步返回 503。
- **挂起发送者上限** `maxSuspendedSends`：每连接同时挂起的 `send` 超过该值时，后续 `send` 立即抛 `WebSocketBackpressureException`，不再继续挂起。挂起发送者持有的消息不计入缓冲预算（§7.4），所以必须用数量来限制它。
- **准入**：WebSocket 配额（§7.6）、TCP 配额、全局缓冲预算三者都满足，才允许升级。
- 心跳与超时定时器全部在 reactor 上（§10.2），**定时器数量与连接数线性相关，线程数与连接数无关**。

### 10.4 空闲连接成本

高并发下连接大多数时间是空闲的。空闲连接的内存成本决定单机能承载多少连接，因此列为验收项（§14）。

- 底层默认读写缓冲各 128 KiB。框架默认改为各 16 KiB（§10.1），大消息通过缓冲增长处理，不需要大的初始容量。
- io 的池化 `Buffer` 首次写入时才取数组，reactor 的空闲扫描会通过 `releaseIfIdle` 归还挂起读的缓冲数组。**websocket 编解码器自己的读写缓冲（`FrameCodec.input` / `output`、`WebSocket.writeBuffer`）是否被这一机制覆盖，目前未验证**。
- 实施第 2 步须实测：建立 N 条空闲连接（完成握手后不收发），测每条连接增加的 RSS。若编解码器缓冲在空闲时不归还，在 websocket 库中补齐空闲归还（本阶段按 §3 使用本地源码，可以直接改库）。
- 目标：空闲连接的每连接 RSS 要有明确的实测数字，并写回本节。

---

## 十一、实施步骤

每一步都有出口条件，达到后才进入下一步。

| 步 | 内容 | 出口条件 |
|---|---|---|
| 0 | **本地依赖与版本对齐**：按 §3 接入 composite build；适配器坐标改为 `io 0.3.2 / http 0.2.0`；修复 `tls` 在 `io 0.3.2` 下的编译问题 | neton 全量测试通过；**普通 HTTP 性能不回退**（按 §11.1 测量，这一步升级了底层依赖，必须实测） |
| 1 | **路由与 API**：`WebSocketSession` 等接口、`RouteDefinition.webSocket`、DSL `webSocket`、`@WebSocket` 与 KSP 校验、`WEBSOCKET` 能力登记、426 兜底 | 能力校验在 hyper4k 下启动失败并列出路由；KSP 非法签名编译失败 |
| 2 | **适配器升级接入**：仅在存在 WebSocket 路由时使用 `serveConnectionWithUpgrades`；分发结果区分"普通响应 / 接受升级"；§7.2 时序；§7.3 单一读取者；§7.4 出站 FIFO；§7.6 配额；§7.7 清理 | echo 可用；握手与首帧同包不丢帧；无 WebSocket 路由的应用走原路径；§11.1 的普通 HTTP 指标不回退 |
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

## 十二、待定决策

| 项 | 何时决定 |
|---|---|
| §7.5 业务处理协程运行在 reactor 上还是 Default 上 | 第 3 步基准测试之后 |
| 反向代理场景是否提供"信任代理"配置，以便使用 `X-Forwarded-Host` 做同源比较 | v1 不提供；有明确需求时另议 |

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
- 慢客户端：出站队列满时 `send` 挂起、`trySend` 返回 false，内存有界
- 第二个并发消费 `incoming` 抛 `IllegalStateException`

**单一读取者与背压**
- handler 只发不收：对端 Ping 仍得到 Pong，对端发起的关闭仍能完成
- handler 阻塞在其他 I/O 上时调用 `session.close()`：关闭握手照常完成
- 入站缓冲满：读取暂停、内存有界；持续不消费超过 `inboundStallTimeoutMillis` 时以 1011（consumer stalled）关闭
- 进入关闭状态后，后续数据消息被丢弃，关闭握手在 `closeTimeoutMillis` 内完成

**发送顺序与所有权**
- 先在其他线程 `trySend(A)` 成功，再回到 reactor 线程 `send(B)`：对端先收到 A
- `sendBinary(arr)` 返回后立刻修改 `arr`：对端收到的是修改前的内容
- `send` 挂起期间被取消：该消息不发出；已接受后调用方被取消：该消息仍发出
- 单条消息超过 `outboundQueueBytes`：立即抛 `WebSocketMessageTooLargeException`，不挂起

**配额**
- 升级完成后，在途 HTTP 请求计数归还，普通 HTTP 请求不受长连接数量影响
- 握手在预留 WebSocket 配额之后失败：配额回滚
- WebSocket 结束后，TCP 连接配额与 WebSocket 配额都归还

**保活与高并发**
- 长时间没有业务消息、但持续回复 Pong 的连接不被关闭（持续时长远大于 `pingIntervalMillis` 与 `pongTimeoutMillis` 之和）
- 对端失联（静默丢包，不回 Pong）：在 Ping 写出后 `pongTimeoutMillis` 内关闭，流、协程、配额全部释放
- 入站缓冲满：报告为消费停滞（1011，consumer stalled），不记为心跳失败；读取暂停期间不触发 Pong 超时
- 出站堵塞（对端不读）：报告为写阻塞（1006，write stalled），不记为心跳失败
- 关闭全部心跳配置（三项均为 0）：慢消费者与写阻塞仍能按 `inboundStallTimeoutMillis` 与 `writeTimeoutMillis` 回收
- 大量连接同时建立：Ping 时间分散，没有集中在同一时刻
- 大量空闲连接 + 少量活跃连接：活跃连接的 p99、reactor 定时器延迟、CPU、RSS 都在可接受范围，并记录数字
- 全局缓冲预算耗尽：`send` 挂起或 `trySend` 返回 false，新握手 503，内存不越过预算
- 单连接挂起的 `send` 超过 `maxSuspendedSends`：立即抛 `WebSocketBackpressureException`
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
- 心跳配置：三项各自为 0 时都能正常启动；`pongTimeoutMillis > 0` 而 `pingIntervalMillis = 0` 时启动失败；载荷不匹配的 Pong 不清除等待
- 长时间运行后连接数归零时，配额、协程、底层流全部释放

**性能**
- 无 WebSocket 路由的应用：baseline 与第 0 步之后的基线相比不回退
- echo 吞吐与延迟纳入基准测试，与独立运行的 `websocket` 库（`websocket-bench`）比较，量化框架层的开销

**协议一致性**
- 通过框架 echo 路由跑 Autobahn 服务端测试，结果与独立库一致
