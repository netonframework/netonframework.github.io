# HTTP 路由生命周期扩展

适用于使用 Neton 标准 HTTP Dispatcher 的应用。本文定义路由扩展，不引入可重排安全管道的全局中间件。

## 注册与执行

- 启动装配期通过 `NetonContext` 注册，按全局、路由组或 HTTP 方法与挂载后路由模板匹配。按 order 升序、ID 字典序执行，重复 ID 启动失败。Dispatcher 绑定时编译快照，运行时不反射扫描，不修改 `RouteDefinition` ABI。
- around 位于准入、认证授权、限流之后，包裹普通 handler（含 KSP 参数绑定）。进入按注册排序，退出反序。可直接返回或抛出异常；`next` 只能在当前调用作用域内串行调用、至多一次，不能留到后台执行。响应仍由原有 HTTP 映射处理。不得用 around 替换认证授权。
- completion 针对匹配的路由执行一次，包含短路、鉴权失败、限流、处理失败和取消。未匹配、CORS 预检和进入 Dispatcher 前的传输拒绝不属于路由 completion。Upgrade 握手有 completion，但不进入普通 handler 的 around。
- completion 是 **Dispatcher 处理结束**，不是网络发送完成或 WebSocket 会话结束。只读同步观察器不得阻塞或修改响应，不能看到请求体、查询串、原始路由参数、令牌、响应体或可变上下文。提供路由模板、认证主体 ID（若有）、可信地址、服务端生成的调用标识、耗时、终止阶段、HTTP 状态（若有）和结果。观察器故障不改变原请求结果；框架不吞掉请求取消。不保证崩溃时观察器送达。

## 验收

覆盖嵌套顺序、选择器、短路、重复 next、鉴权拒绝、限流、异常、取消、观察器故障、未匹配路由，以及流式响应已提交后失败不被记成成功。未装扩展时不额外构造每请求观察快照。

## 注册示例

```kotlin
val lifecycle = ctx.routeLifecycle()
val admin = RouteSelector(group = "admin")
lifecycle.intercept("app.request-context", { http, next ->
    http.setAttribute("app.area", "backoffice")
    next()
}, admin)
lifecycle.observe("app.route-metrics", { result ->
    // 只同步记录指标或尝试投递到有界队列；不在这里等待数据库。
    metrics.record(result.endpoint.pattern, result.result, result.durationMillis)
}, admin)
```
