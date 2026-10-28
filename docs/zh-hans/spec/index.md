# 规范文档

本部分包含 Neton Framework 的设计规范与 API 冻结文档。

> **状态说明**：标记为"冻结"的规范定义了 v1 API 的最终形态，实现必须严格遵循。未标记"冻结"的文档为设计参考。

## 核心架构

- [Core 规范 v1](./core.md) — 启动流程、组件模型、运行时容器、HTTP 抽象 **(v1 冻结)**
- [Application Lifecycle Contract](./lifecycle.md) — 启动状态机、Context freeze、失败传播与资源所有权 **(NETON-LIFECYCLE-P0)**
- [Neton 1.0 Release Gate R0](./release-gate.md) — 原生 CI、release smoke 与发布基线
- [Core SPI 最佳实践](./core-spi-best-practices.md) — SPI 层实现规范
- [Config SPI 规范](./config-spi.md) — @NetonConfig 与配置扩展点
- [Module Manifest 规范](./module-manifest.md) — `@Module` 与 KSP 生成的 `{Id}ModuleManifest`

## HTTP 与路由

- [HTTP 规范 v1](./http.md) — 入站 HttpAdapter、出站 HttpClient、请求响应生命周期
- [HTTP 引擎能力规范](./http-engine-capabilities.md) — 引擎能力声明与启动期校验、引擎一致性套件、HTTP/2 落地边界（Ktor CIO 与 hyper4k 可插拔）
- [HTTP 引擎规范](./http-engine.md) — 单引擎交付（Server + Client）、契约层零引擎、引擎入口契约、Client 能力与一致性套件、hyper4k Kotlin 客户端封装、Ktor 归零路径、Server 侧 TLS 决策 **(Draft，冻结候选；开发前置)**
- [路由规范 v1](./routing.md) — 路由组、目录约定、安全集成
- [参数绑定规范 v1](./parameter-binding.md) — 参数推断、类型转换、绑定规则
- [出站策略与受控客户端](./egress.md) — URL 来自用户 / 内容 / 后台运行期数据 → 受控客户端，来自部署配置 → 普通客户端；全进程唯一的 `[egress]` 放行列表；经代理钉住目标；逐跳重定向校验
- [错误码规范](./error-codes.md) — 消息即机器码：信封 message、字段错误 code/params、框架内建码、模块规则
- [WebSocket 规范](./websocket.md) — 握手快照、关闭结果、单消费者及路由入站策略 **(v1 r12 业务 API 冻结候选；引擎 SPI 仍实验性，性能验收单列)**

## AI

- [neton-ai 规范：协议层与模型接入](./ai.md) — 四协议无损报文模型与统一中间表示、跨协议转换与诊断、流式与用量事实、托管上游、厂商配置文件、SDK 层边界 **(Draft v1)**

## 安全

- [Neton Application 生态规范](./application/index.md) — 应用架构、RBAC、MFA、防滥用及工程交付（**应用层**）

- [安全规范 v1](./security.md) — Identity、Authenticator、Guard、@Permission、PermissionEvaluator、JWT 认证器、@CurrentUser 注入（**框架层**）

## 日志

- [日志规范 v1](./logging.md) — Logger API、结构化日志、Trace 上下文 **(设计冻结)**

## 数据库

- [Database Session and Transaction Contract](./database-session.md) — transaction-aware DbSession、Table 唯一执行链 **(NETON-DB-SESSION-P0)**
- [数据库规范 v1](./database.md) — Entity + Table 模式、Query DSL、强类型列引用、Typed Projection **(v1 冻结)**
- [JOIN 查询规范](./database-join.md) — JOIN DSL、SelectBuilder、SelectAst、RecordN
- [执行链与约束规范](./database-execution.md) — DbContext 统一执行门面、QueryInterceptor、事务
- [Schema Migration](./database.md#_12-schema-migration) — history 表、原子执行与 `application.kexe migrate` 边界 **(架构边界 / 必读)**

## 缓存与 Redis

- [缓存规范 v1](./cache.md) — L1 + L2 缓存抽象、@Cacheable / @CachePut / @CacheEvict **(设计冻结)**
- [Redis 规范 v1](./redis.md) — Redis 客户端抽象、@Lock 注解与 LockManager

## 领域事件

- [领域事件规范 v1](./event.md) — 三种投递模式、outbox 端口、claim 令牌、总线与 codec 封印 **(1.0 冻结候选；持久化与运维实现归应用层)**

## 定时任务与存储

- [定时任务规范](./jobs.md) — `@Job` 注解、Cron / fixedRate 表达式、`JobScheduler`
- [存储规范](./storage-spec.md) — 文件存储抽象、多后端适配

## 项目管理

- [路线图 v1](./roadmap.md) — 9 大方向、P0-P3 优先级
