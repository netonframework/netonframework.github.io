# 从 Spring 过来

Neton 对标 Spring Boot 与 Spring Cloud 的定位：写完整的服务端应用，并且能在微服务架构里跑。
但走的是另一条路——**只做几乎每个服务都要用的关键组件，其余不做**。

组件少带来三件事：更容易维护、更快、更适合微服务。一个原生二进制约 3ms 启动、20MB 常驻，
没有 JVM、没有反射、没有代理；Spring 那套「启动时扫描 + 反射装配」的开销在这里根本不存在。

## 关键组件

这些是绝大多数服务真正会用到的，Neton 全部内建，并且都由 KSP 在编译期装配：

| 你要做的事 | Neton |
|---|---|
| HTTP 接口 | `@Controller` + `@Get` / `@Post` …，参数由签名推断，多数 handler 零注解 |
| 参数校验 | `@Valid`，校验器编译期生成 |
| 数据库 | `@Table` 实体 + 类型安全 Query DSL；`db.transaction { }`；版本化 SQL 迁移 |
| 缓存 | `@Cacheable` / `@CachePut` / `@CacheEvict`，进程内 L1 + Redis L2 |
| 分布式锁 | `@Lock` / `LockManager` |
| 安全 | Authenticator + Guard，`@RequireAuth` / `@RolesAllowed` / `@Permission` |
| 限流 | `@RateLimit` |
| 定时任务 | `@Job(cron / fixedRate)`，`SINGLE_NODE` / `ALL_NODES` |
| 模块解耦 | `DomainEventBus`，含事务性 outbox（对应 Spring Modulith 的事件登记表） |
| 配置 | `application.<env>.conf`，`@NetonConfig` 配置器 |
| 日志与追踪 | 结构化 JSON，traceId 贯通，自动脱敏 |
| 对象存储 | Local / S3 统一抽象 |

## 有意不做的

不是缺口，是划清边界。这些交给平台或上游更合适，框架把它们收进来只会变臃肿：

| 不做 | 交给谁 |
|---|---|
| 服务发现、配置中心、熔断、网关（Spring Cloud 那一层） | Kubernetes 与服务网格。2026 年再由框架实现一套 Eureka / Config Server，是重复建设 |
| 静态文件服务 | 反向代理或 CDN |
| 组件扫描 | 每项能力在入口显式安装，「这个进程跑着什么」一屏看得完 |
| 运行时反射与动态代理 | 编译期生成。读到的就是跑的，异常栈里没有框架脚手架 |

## 按需再加的

由真实项目驱动：项目里需要什么就补什么，不预先堆功能。

- 健康检查端点（k8s 存活/就绪探针需要，优先级最高）
- OpenAPI 生成（路由元数据编译期已有，属于生成工作）
- WebSocket（SSE 已有）
- HTTP 层测试支持（Logic 是普通类，已可直接单测）

## 心智差异

写 Spring 时你在**描述**一个对象图，容器在启动时把它拼出来；写 Neton 时你在**写**它，KSP 把
样板补齐。所以很多错误从运行时提前到编译期——路由、参数绑定、校验器、缓存与锁的 key、序列化器
都在编译期检查。一个区分不了两个请求的缓存 key 是编译错误，而不是线上的一次错误响应。

代价是生态广度：Spring 有二十年的集成积累。如果你的服务由上面那张表构成，你不损失什么；
如果它依赖某个冷门 starter，那确实得自己写。
