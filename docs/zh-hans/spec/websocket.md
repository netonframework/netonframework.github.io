# Neton WebSocket 规范

> **定位**：在 Neton 框架内提供 WebSocket 服务端能力：路由注册、握手安全、会话收发、关闭与停机。
> 协议本身不在框架内实现，由 `com.netonstream:websocket` 提供；本文只规定**框架如何接入它**。
>
> **状态**：**Draft v1**。本文是实施规格，实施前的 API 讨论结论已并入。
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
| 同一时刻最多一个 `receive`、一个写操作，并发第二个抛 `IllegalStateException` | `WebSocket.kt:38` | `incoming` 单消费者；写统一串行（§7.3） |
| 写驱动协程使用**独立 Job**，不随创建方取消 | `WebSocket.kt:435` | 框架必须显式关闭连接，不能只靠取消（§7.5） |
| `close()` 只发起关闭握手，须继续 `receive` 直到返回 null | `WebSocket.kt:250` | 关闭需要等待期限与强制释放（§8.2） |
| 握手不检查 `Host` 与 `Origin` | `handshake/ServerHandshake.kt:36` | 框架自行校验 Origin（§6.3） |
| `Upgraded` 只在 101 写出、该次 HTTP 交换结束后才可用 | `h1/Server.kt:435` | **不得在返回 101 之前等待 `upgradeOn()`**（§7.2） |
| 默认 `maxMessageSize` 64 MiB、`maxFrameSize` 16 MiB；`sendCloseOnProtocolError = false` | `WebSocketConfig.kt:32-51` | 框架必须覆盖这些默认值（§10） |

### 2.4 框架侧的缺口（已核对源码，`main` 分支）

| 缺口 | 位置 |
|---|---|
| 适配器使用不支持升级的 `serveConnection(...)`（`upgrades = false`） | `NetonStreamHttpAdapter.kt:279` |
| HTTP 服务结束后立即 `connectionHandlers.cancel()`，会连带取消升级后的会话 | `NetonStreamHttpAdapter.kt:284` |
| handler 作用域固定为 `Dispatchers.Default`，挂起后离开 reactor | `NetonStreamHttpAdapter.kt:278` |
| 请求被压平为 `BufferedHttpRequest`，`extensions`（含 `OnUpgrade`）丢失 | `NetonStreamHttpAdapter.kt:607` |
| CORS 对不允许的 Origin 只是不加响应头，不拒绝请求 | `BufferedHttpDispatcher.kt:621` |
| 依赖钉在 `io:0.3.0 / http:0.1.2 / tls:0.1.0`；websocket 0.2.0 需要 `io:0.3.2 / http:0.2.0`；`tls` 仓库自身仍依赖 `io:0.1.0` | `neton-http-netonstream/build.gradle.kts:24-26`、`tls/tls/build.gradle.kts` |

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

签名：`fun webSocket(path: String, handler: suspend (WebSocketSession) -> Unit)`。显式写出 `session ->`，与现有 `get { ctx -> }` 的风格一致。

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

    /** 完整消息（分片已重组）。单消费者：并发迭代第二次抛 IllegalStateException。对端关闭后迭代结束。 */
    val incoming: WebSocketIncoming

    /** 发送一条消息。可在任意协程、任意线程调用（§7.3）。队列满时挂起。 */
    suspend fun send(message: WebSocketMessage)
    suspend fun sendText(text: String) = send(WebSocketMessage.Text(text))
    suspend fun sendBinary(bytes: ByteArray) = send(WebSocketMessage.Binary(bytes))

    /** 不挂起地入队；队列满或连接已关闭时返回 false。 */
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
    class Binary(val bytes: ByteArray) : WebSocketMessage
}
```

约束：

- **不暴露** `neton.websocket.*` 的任何类型，也不暴露 Ping、Pong、Close 帧。控制帧由框架处理。
- `incoming` 用挂起迭代器实现，而不是 `Channel`，避免每条入站消息多一次线程跳转。
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
| 8. 并发上限（§10 `maxConnections`） | 503 |
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
    ├─ 出站邮箱（有界，线程安全；跨线程发送的唯一入口）
    ├─ 心跳计时（reactor 上）
    └─ 业务处理协程（handler）
```

连接协程是**唯一所有者**，负责：读循环、写入串行化、心跳、关闭握手、超时强制释放、连接配额的归还。

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
进入连接循环（§7.3），启动业务处理协程
```

要点：

- **不得**在 service 返回 101 之前等待 `upgradeOn()`。h1 要等 101 写出之后才 `fulfill`，提前等待会让双方互相等待。
- 分发结果必须显式区分"普通响应"和"接受升级"。升级响应**不走**普通响应的包装、压缩（`Compression.kt`）和请求超时流程。
- 必须使用 `fromUpgraded`，不得使用 `fromRawStream(stream, …)`。后者会丢掉与握手同一个包到达的首帧。
- 升级失败（`upgradeOn` 抛 `UserNoUpgrade` 或其他错误）时，由连接协程关闭底层流并归还配额。业务处理协程尚未启动，不涉及业务清理。

### 7.3 发送路径

`send` 对调用方的契约是：任意线程可调用、同一发送方的消息保序、有界、队列满时挂起。实现上分两条路径：

- **调用方就在连接所在的 reactor 线程**：直接写入底层 `WebSocket`，由连接协程的写串行器排序，不经过邮箱。
- **其他线程**：写入出站邮箱，由连接协程在 reactor 上取出并写出。

心跳 Ping、业务发送、关闭帧都经同一个写串行器，**不允许**任何路径绕过它直接调用底层写接口。

邮箱按**消息数**和**字节数**双重限制（§10）。队列满时 `send` 挂起，`trySend` 返回 false。连接关闭后，`send` 抛 `WebSocketClosedException`，`trySend` 返回 false。

### 7.4 业务处理协程跑在哪里（待定，见 §12）

| 方案 | 做法 | 优点 | 代价 |
|---|---|---|---|
| A：reactor 上运行 | handler 在连接所在 reactor 的调度器上启动，挂起后回到同一 reactor | `receive`/`send` 无线程跳转 | 业务若在 handler 中阻塞，会拖慢同一 reactor 上的其他连接；重活须 `withContext(Dispatchers.Default)` |
| B：Default 上运行 | handler 在 `Dispatchers.Default` 上运行，入站经桥接、出站经邮箱 | 业务不可能阻塞 reactor | 每条消息至少两次线程跳转 |

**两种方案的 API 完全相同**（§4.3），区别只在实现。用 §11 第 3 步的基准测试数据决定；在得出结论之前不冻结本节。

### 7.5 结束与清理

连接结束的唯一出口在连接协程的 `finally` 中，按以下顺序执行：

1. 取消业务处理协程（如仍在运行）；
2. 关闭底层 `WebSocket`。写驱动使用独立 Job，**必须显式关闭**，不能指望取消传递；
3. 关闭底层流；
4. 完成 `session.closed`；
5. 归还 `maxConnections` 配额。

升级后的连接**不属于** HTTP 的 `connectionHandlers` 作用域，后者在 `serve()` 返回时取消，不能波及 WebSocket。升级后的连接挂在适配器级别的 WebSocket 作用域下，由停机流程统一管理（§8.3）。

---

## 八、关闭

### 8.1 关闭码

| 情况 | 关闭码 | 说明 |
|---|---|---|
| handler 正常返回 | 1000 Normal | |
| 服务端停机 | 1001 Going Away | |
| 空闲超时、心跳超时 | 1001 Going Away | |
| 入站消息超过 `maxMessageBytes` | 1009 Message Too Big | |
| 入站文本不是合法 UTF-8 | 1007 Invalid Payload | |
| 协议错误（帧格式、未掩码等） | 1002 Protocol Error | 需要 `sendCloseOnProtocolError = true`（§10） |
| 应用主动拒绝（令牌过期、无权订阅） | 1008 Policy Violation | 应用调用 `close(POLICY_VIOLATION)` |
| handler 抛出异常 | 1011 Internal Error | 记录 ERROR 日志，带路由与异常 |
| handler 因停机被取消 | 1001 Going Away | 取消**不**映射为 1011 |
| 对端已断开（读到 EOF 或 I/O 错误） | 不发关闭帧 | 直接释放，`closed` 记为 1006 Abnormal |

`CloseCode` 提供上表各码的常量，并允许应用使用 3000–4999 的私有码。

### 8.2 关闭握手的等待期限

调用 `close(...)` 或框架触发关闭时：发送关闭帧，继续读取直到对端回应关闭帧。超过 `closeTimeoutMillis` 仍未收到回应，就强制关闭底层流。期间收到的数据消息丢弃，不再交给 `incoming`。

### 8.3 停机

适配器停机时，对所有 WebSocket 连接执行：

1. 停止接受新的升级（新握手返回 503）；
2. 对每条连接发送 1001，并取消其业务处理协程；
3. 等待关闭握手，最长 `min(closeTimeoutMillis, 停机宽限期剩余时间)`；
4. 强制释放剩余连接。

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

```toml
[websocket]
maxConnections      = 10000      # WebSocket 连接上限；占用 HTTP maxConnections 配额的同时另受此限
maxMessageBytes     = 1048576    # 1 MiB，入站完整消息上限 → 底层 maxMessageSize
maxFrameBytes       = 1048576    # 1 MiB，入站单帧上限 → 底层 maxFrameSize
outboundQueueMessages = 256      # 每连接出站邮箱消息数上限
outboundQueueBytes  = 4194304    # 4 MiB，每连接出站邮箱字节数上限
pingIntervalMillis  = 30000      # 0 = 关闭心跳
idleTimeoutMillis   = 60000      # 期间无任何入站帧（含 Pong）即关闭；0 = 不限
closeTimeoutMillis  = 5000
compression         = false      # permessage-deflate，默认关闭
allowedOrigins      = []         # 见 §6.3；空 = 仅同源
```

- 框架**始终**设置 `sendCloseOnProtocolError = true`，不对外暴露此项。
- 开启 `compression` 时，`maxMessageBytes` 限制的是**解压后**的大小，防止压缩炸弹。
- `idleTimeoutMillis` 必须大于 `pingIntervalMillis`，否则启动失败。
- 注解与 DSL 的路由级覆盖不在 v1 范围内，v1 只有全局配置。

---

## 十一、实施步骤

每一步都有出口条件，达到后才进入下一步。

| 步 | 内容 | 出口条件 |
|---|---|---|
| 0 | **本地依赖与版本对齐**：按 §3 接入 composite build；适配器坐标改为 `io 0.3.2 / http 0.2.0`；修复 `tls` 在 `io 0.3.2` 下的编译问题 | neton 全量测试通过；**普通 HTTP baseline 不回退**（arena 同法 A/B，按效率 rps/CPU% 比较） |
| 1 | **路由与 API**：`WebSocketSession` 等接口、`RouteDefinition.webSocket`、DSL `webSocket`、`@WebSocket` 与 KSP 校验、`WEBSOCKET` 能力登记、426 兜底 | 能力校验在 hyper4k 下启动失败并列出路由；KSP 非法签名编译失败 |
| 2 | **适配器升级接入**：仅在存在 WebSocket 路由时使用 `serveConnectionWithUpgrades`；分发结果区分"普通响应 / 接受升级"；§7.2 时序；§7.5 清理 | echo 可用；握手与首帧同包不丢帧；无 WebSocket 路由的应用走原路径（代码路径不变） |
| 3 | **线程模型定案**：方案 A、B 各实现一版，做 echo 与跨线程发送的基准测试 | §7.4 结论写回本文并冻结该节 |
| 4 | **握手安全**：Origin 策略、安全链复用、子协议协商 | §14 握手类用例全部通过 |
| 5 | **心跳、超时、关闭、停机** | §14 关闭类用例全部通过 |
| 6 | **wss** | TLS 上的 echo 与 Autobahn 子集通过 |

步骤 2 有一条性能硬约束：**没有注册 WebSocket 路由的应用，HTTP 处理路径不得有任何变化。** 按 baseline 跑分的教训，这一点靠代码结构保证，不靠事后测量。

---

## 十二、待定决策

| 项 | 何时决定 |
|---|---|
| §7.4 业务处理协程运行在 reactor 上还是 Default 上 | 第 3 步基准测试之后 |
| `maxConnections` 与 HTTP 连接配额的关系：共享还是独立计数 | 第 2 步实现时，以停机与过载测试结果为准 |
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
- 慢客户端：出站邮箱满时 `send` 挂起、`trySend` 返回 false，内存有界
- 第二个并发消费 `incoming` 抛 `IllegalStateException`

**关闭与生命周期**
- handler 正常返回发 1000；抛异常发 1011 并记录日志
- 对端发起关闭，`incoming` 正常结束，`finally` 执行
- 对端不回应关闭帧，`closeTimeoutMillis` 后强制释放
- 升级途中客户端断开：配额归还，无泄漏
- 心跳超时与空闲超时关闭连接
- 停机：所有连接收到 1001，在宽限期内完成或被强制释放，`finally` 全部执行
- 长时间运行后连接数归零时，配额、协程、底层流全部释放

**性能**
- 无 WebSocket 路由的应用：baseline 与第 0 步之后的基线相比不回退
- echo 吞吐与延迟纳入基准测试，与独立运行的 `websocket` 库（`websocket-bench`）比较，量化框架层的开销

**协议一致性**
- 通过框架 echo 路由跑 Autobahn 服务端测试，结果与独立库一致
