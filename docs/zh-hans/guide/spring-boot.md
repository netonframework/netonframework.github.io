# 从 Spring Boot 过来

Neton 要解决的问题和 Spring Boot 是同一个：写一个完整的服务端应用——HTTP、数据、缓存、安全、
定时任务、事件——而不用自己把这套栈拼起来。区别在于**装配发生在什么时候**：Spring 在启动时用
反射和代理把对象图拼出来，Neton 在编译期用 KSP 把它生成出来，产物是一个毫秒级启动的原生二进制。

这一页把你已经会的东西映射到 Neton 的叫法，并直说哪些还没有。

## 应用入口

```java
// Spring Boot
@SpringBootApplication
public class Application {
    public static void main(String[] args) { SpringApplication.run(Application.class, args); }
}
```

```kotlin
// Neton
fun main(args: Array<String>) {
    Neton.run(args) {
        http { port = 8080 }
        routing { }
        modules(GeneratedInitializer)
    }
}
```

Neton 没有组件扫描。每项能力都在入口显式安装，所以「这个进程里跑着什么」在一屏之内看得完。

## Web

| Spring Boot | Neton |
|---|---|
| `@RestController` | `@Controller` |
| `@GetMapping` / `@PostMapping` / … | `@Get` / `@Post` / `@Put` / `@Patch` / `@Delete` / `@Head` / `@Options` |
| `@PathVariable` / `@RequestParam` / `@RequestBody` | `@PathVariable` / `@QueryParam` / `@Body`——通常由签名推断，多数 handler 一个注解都不用写 |
| `@RequestHeader` / `@CookieValue` | `@Header` / `@Cookie` |
| `MultipartFile` | `UploadFile` / `UploadFiles` |
| `@ControllerAdvice` + `@ExceptionHandler` | 内建：异常带错误码，框架据此推导 HTTP 状态与响应信封 |
| 拦截器 / 过滤器 | 请求管道内建安全、限流、访问日志，见[中间件](./middleware.md) |
| CORS 配置 | `http { }` 配置 |
| Jackson | kotlinx.serialization，序列化器编译期生成 |

## 数据

| Spring Boot | Neton |
|---|---|
| Spring Data Repository | `@Table` 实体 + 生成的 `XxxTable` |
| 方法名推导查询 | 类型安全 Query DSL：`UserTable.query { where { and(User::status eq 1, User::name like "%a%") } }.page(1, 20)` |
| `@Transactional` | `db.transaction { }`——协程作用域会话，块内所有 Table 操作自动加入 |
| Flyway / Liquibase | `sql/<dialect>/V*.sql` 版本化脚本，构建期内嵌，由迁移引擎执行 |
| 乐观锁 | `increment` / `decrement` 生成 `col = col + ?`，配合 `where { }` 即 CAS |
| 连接池调优 | `database.conf` |

## 其余

| Spring Boot | Neton |
|---|---|
| `@Cacheable` / `@CachePut` / `@CacheEvict` | 同名注解，两级缓存（进程内 L1 + Redis L2） |
| `@Scheduled` | `@Job(cron = …)` 或 `@Job(fixedRate = …)`，支持 `SINGLE_NODE` / `ALL_NODES` |
| Spring Security 过滤器链 | Authenticator + Guard，配 `@RequireAuth` / `@AllowAnonymous` / `@RolesAllowed` / `@Permission` |
| Bucket4j / 自研限流 | `@RateLimit`，在派发路径上强制执行 |
| `ApplicationEventPublisher`、Spring Modulith 事件登记表 | `DomainEventBus`，三种投递模式 `SYNC` / `BEST_EFFORT` / `RETRYABLE`，后者是事务性 outbox，见[领域事件](./events.md) |
| Redisson / Redis 锁 | `@Lock` 与 `LockManager` |
| `@Valid` + Bean Validation | `@Valid`，校验器编译期生成 |
| `application-<profile>.yml` | `application.<env>.conf`（TOML） |
| `@ConfigurationProperties` | `@NetonConfig` 配置器 |
| 构造器注入 | `@Logic` 类，由生成代码构造并装配 |
| 优雅停机 | 内建，SIGINT / SIGTERM 触发逆序生命周期 |
| Micrometer / 结构化日志 | 结构化 JSON 日志，traceId 贯通，自动脱敏 |

## 还没有的

写下来是为了让缺口变成待办，而不是让人踩到才发现。**这份清单由真实项目驱动**：项目里需要什么，
就把什么补上。

| 缺口 | 说明 |
|---|---|
| Actuator 类端点 | 没有 `/health`、`/metrics`，也没有 Prometheus 抓取端点。目前的存活检查只能是「端口有响应」。 |
| OpenAPI / Swagger 生成 | 路由元数据编译期就有，属于生成工作，不需要新的运行时机制。 |
| 测试切片 | 没有 `@SpringBootTest` / `MockMvc` 等价物。Logic 是普通类可直接单测；HTTP 级测试需要起进程。 |
| 静态文件服务 | 没有内建静态资源处理，前面挂反向代理或 CDN。 |
| 服务发现、配置中心、熔断 | Spring Cloud 那一层没有对应物。 |
| WebSocket | 未实现。SSE 已有。 |

## 换来了什么

- **运行时没有 JVM**。单个原生二进制，启动约 3ms，常驻内存约 20MB。缩容到零、按请求计费这类部署
  不再别扭。
- **失败前移到编译期**。路由、参数绑定、校验器、缓存与锁的 key、序列化器、配置 SPI 全部由 KSP
  生成并检查。一个区分不了两个请求的缓存 key 是编译错误，而不是线上的一次错误响应。
- **没有反射、没有代理**。读到的就是跑的；异常栈里没有框架脚手架。

代价是生态广度。Spring 有二十年的集成积累，Neton 有上面这些模块。如果你的服务就是由这些构成的，
那么你没有损失什么。
