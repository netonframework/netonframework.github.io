# 能力总览

Neton 只做**几乎每个服务都要用的组件**，其余不做。组件少带来三件事：更容易维护、更快、
更适合微服务。

一个原生二进制，约 3ms 启动、20MB 常驻。没有 JVM，没有运行时反射，没有动态代理——
「启动时扫描全部类、用反射把对象图拼出来」这笔开销在这里根本不存在。

## 内建能力

全部由 KSP 在编译期装配，不是运行时拼装。

| 你要做的事 | Neton |
|---|---|
| HTTP 接口 | `@Controller` + `@Get` / `@Post` / `@Put` / `@Patch` / `@Delete` / `@Head` / `@Options` |
| 参数绑定 | 由方法签名推断 path / query / body，多数 handler 一个注解都不用写；需要时可用 `@PathVariable` / `@QueryParam` / `@Body` / `@Header` / `@Cookie` 显式指定 |
| 文件上传 | `UploadFile` / `UploadFiles`，按参数名匹配表单字段 |
| 参数校验 | `@Valid`，校验器编译期生成，错误直接映射为结构化响应 |
| 数据库 | `@Table` 实体 + 类型安全 Query DSL；`db.transaction { }`；原子增减（CAS）；软删除；查询拦截器 |
| 数据库迁移 | `sql/<dialect>/V*.sql` 版本化脚本，构建期内嵌进二进制，启动时按版本执行 |
| 缓存 | `@Cacheable` / `@CachePut` / `@CacheEvict`，进程内 L1 + Redis L2 两级透明分层，自带 singleflight 防击穿 |
| 分布式锁 | `@Lock` / `LockManager`，SET NX PX + Lua 校验 token 释放 |
| 安全 | Authenticator + Guard 双层，`@RequireAuth` / `@AllowAnonymous` / `@RolesAllowed` / `@Permission`，内建 JWT |
| 限流 | `@RateLimit`，在请求派发路径上强制执行，支持按 IP / 用户维度 |
| 定时任务 | `@Job(cron / fixedRate)`，`SINGLE_NODE`（多实例互斥）/ `ALL_NODES` |
| 模块解耦 | `DomainEventBus`，三种投递模式，含事务性 outbox（落库、退避重试、终态失败可人工处置） |
| 配置 | TOML 配置文件 + 环境覆盖（`application.<env>.conf`），`@NetonConfig` 扩展点，类型错误启动即报 |
| 日志 | 结构化 JSON，traceId / spanId 贯通，异步写入，Sink 路由，自动脱敏 |
| 对象存储 | Local / S3 统一抽象，多源配置 |
| HTTP 客户端 | 出站客户端、流式响应、SSE |

## 交给平台的

不是缺口，是边界。这些放进框架只会变臃肿：

| 不做 | 交给谁 |
|---|---|
| 服务发现、配置中心、熔断、网关 | Kubernetes 与服务网格。基础设施已经解决的问题，框架再实现一套是重复建设 |
| 静态文件服务 | 反向代理或 CDN |
| 组件扫描 | 每项能力在入口显式安装，「这个进程跑着什么」一屏看得完 |
| 运行时反射与动态代理 | 编译期生成。读到的就是跑的，异常栈里没有框架脚手架 |

## 为什么快、为什么好维护

**错误前移到编译期。** 路由、参数绑定、校验器、缓存与锁的 key、响应序列化器、配置扩展点，
全部由 KSP 生成并检查。一个区分不了两个请求的缓存 key 是编译错误，而不是线上的一次错误响应；
一个标错位置的注解会让构建失败，而不是静默失效。

**没有隐式装配。** 应用能力都在入口显式安装，模块靠显式清单注册。没有「某个 jar 在 classpath 上
就改变了行为」这类事。

**约定优于配置。** 参数绑定按签名推断，路由按目录分组，配置文件名即命名空间——90% 的场景不用写
注解和配置。

**部署形态简单。** 单个静态二进制，没有运行时依赖，容器镜像可以做到几十 MB；毫秒级启动让
缩容到零和按请求计费不再别扭。

## 按需再加

由真实项目驱动，不预先堆功能：

- 健康检查端点（k8s 存活 / 就绪探针需要，优先级最高）
- OpenAPI 生成（路由元数据编译期已有，属于生成工作）
- WebSocket（SSE 已有）
- HTTP 层测试支持（Logic 是普通类，已可直接单测）
