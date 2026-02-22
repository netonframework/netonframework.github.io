# 规范文档

本部分包含 Neton Framework 的设计规范与 API 冻结文档。

> **状态说明**：标记为"冻结"的规范定义了 v1 API 的最终形态，实现必须严格遵循。未标记"冻结"的文档为设计参考。

## 核心架构

- [Core 规范 v1](./core.md) — 启动流程、组件模型、运行时容器、HTTP 抽象 **(v1 冻结)**
- [Core SPI 最佳实践](./core-spi-best-practices.md) — SPI 层实现规范
- [Config SPI 规范](./config-spi.md) — @NetonConfig 与配置扩展点

## HTTP 与路由

- [HTTP 规范 v1](./http.md) — HttpAdapter、HttpContext、请求响应生命周期
- [路由规范 v1](./routing.md) — 路由组、目录约定、安全集成
- [参数绑定规范 v1](./parameter-binding.md) — 参数推断、类型转换、绑定规则

## 安全

- [安全规范 v1](./security.md) — Identity、Authenticator、Guard、@Permission、PermissionEvaluator、JWT 认证器、@CurrentUser 注入

## 日志

- [日志规范 v1](./logging.md) — Logger API、结构化日志、Trace 上下文 **(设计冻结)**

## 数据库

- [数据库规范 v1](./database.md) — Entity + Table 模式、Query DSL、强类型列引用、Typed Projection **(v1 冻结)**
- [JOIN 查询规范](./database-join.md) — JOIN DSL、SelectBuilder、SelectAst、RecordN
- [执行链与约束规范](./database-execution.md) — DbContext 统一执行门面、QueryInterceptor、事务

## 缓存与 Redis

- [缓存规范 v1](./cache.md) — L1 + L2 缓存抽象、@Cacheable / @CachePut / @CacheEvict **(设计冻结)**
- [Redis 规范 v1](./redis.md) — Redis 客户端抽象、@Lock 注解与 LockManager

## 定时任务与存储

- [定时任务规范](./jobs.md) — @Scheduled 注解、Cron 表达式、JobManager
- [存储规范](./storage-spec.md) — 文件存储抽象、多后端适配

## 项目管理

- [路线图 v1](./roadmap.md) — 9 大方向、P0-P3 优先级
