# 路由拦截器与请求结束观察器

> 适用于 Neton Framework 1.2.0 候选版本。源码已包含这些 API；本文不表示 Maven Central 已发布该版本。

标准 HTTP Dispatcher 提供两个扩展点：用 **around 拦截器**包裹已匹配的路由处理器，用 **completion 观察器**读取请求处理结果。二者都不替代认证、授权和限流。

| 扩展点 | 何时执行 | 可以做什么 |
| --- | --- | --- |
| around 拦截器 | 准入、认证授权、限流通过后 | 设置请求属性、调用处理器、检查或替换返回值，也可直接返回 |
| completion 观察器 | 已匹配路由的处理结束时，包括拒绝、失败和取消 | 读取结构化结果，记录指标或投递到队列 |

## 启动时注册

在应用或模块装配阶段、上下文冻结之前注册。无需给控制器加注解，也不需要运行时扫描。

```kotlin
import neton.core.component.NetonContext
import neton.core.http.RouteCompletion
import neton.core.http.RouteSelector
import neton.core.http.routeLifecycle

fun installRouteExtensions(ctx: NetonContext, record: (RouteCompletion) -> Unit) {
    val lifecycle = ctx.routeLifecycle()
    val admin = RouteSelector(group = "admin")
    lifecycle.intercept("example.admin-context", { http, next ->
        http.setAttribute("example.area", "backoffice")
        val result = next() // 只在当前请求内调用，最多一次。
        result             // 此处处理器已返回，框架还未映射响应。
    }, selector = admin)
    lifecycle.observe("example.admin-completion", { completion ->
        record(completion) // 不在这里阻塞。
    }, selector = admin)
}
```

省略选择器即可覆盖所有已匹配的路由；可组合 `group`、`method` 和 `pattern` 缩小范围。`pattern` 是**带挂载前缀的路由模板**，例如 `/admin/system/post/get/{id}`，不是请求的实际 URL。扩展 ID 必须唯一，按 `order` 升序、再按 ID 排序，嵌套的 around 按反序退出。

## 如何理解 completion

观察器可读取路由模板、服务端生成的调用 ID、认证主体 ID（若有）、解析后的客户端地址、耗时、终止阶段和结果，以及可用的 HTTP 状态或框架错误码。它拿不到实际路由参数、查询值、凭据及请求和响应正文。回调同步执行，需做 I/O 时应投递到有界队列，不要在回调中等待数据库。

路由未进入处理器也可能产生完成记录。未匹配请求、CORS 预检和进入 Dispatcher 前的拒绝不在覆盖范围。协议升级握手可产生完成记录，但不进入普通 around 链。完成记录**不能证明**客户端已收到响应、WebSocket 会话已结束，或业务事务已提交。

内建处理阶段参见 [HTTP 请求管道](./middleware.md)，Neton Application 的接入方式参见 [后台操作审计](./operation-audit.md)。
