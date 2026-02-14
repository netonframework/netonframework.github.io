# 规范文档

本部分包含 Neton Framework 的设计规范与 API 冻结文档。

> **状态说明**：标记为"冻结"的规范定义了 v1 API 的最终形态，实现必须严格遵循。未标记"冻结"的文档为设计参考。

## 核心架构

- [Core 规范 v1](./core.md) — 启动流程、组件模型、运行时容器、HTTP 抽象 **(v1 冻结)**
- [Core 架构](./core-architecture.md) — 分层设计与优化策略
- [Core SPI 最佳实践](./core-spi-best-practices.md) — SPI 层实现规范
- [Core v2 重构设计](./core-v2-refactor.md) — v2 演进方向
- [Config SPI 规范](./config-spi.md) — @NetonConfig 与配置扩展点

## HTTP 与路由

- [HTTP 规范 v1](./http.md) — HttpAdapter、HttpContext、请求响应生命周期
- [HTTP 适配器总结](./ktor-adapter-summary.md) — HTTP 适配层完善
- [路由规范 v1](./routing.md) — 路由组、目录约定、安全集成
- [参数绑定规范 v1](./parameter-binding.md) — 参数推断、类型转换、绑定规则

## 安全

- [安全规范 v1](./security.md) — Principal、Authenticator、Guard、授权管道
- [安全 v1.1 API Freeze](./security-v1.1-freeze.md) — UserId、Identity 接口冻结
- [JWT 认证器规范](./jwt-authenticator.md) — JWT HS256 认证
- [AuthenticationPrincipal 设计](./authentication-principal-design.md) — @AuthenticationPrincipal 注解

## 日志

- [日志规范 v1](./logging.md) — Logger API、结构化日志、Trace 上下文 **(设计冻结)**

## 数据库

- [Database API Freeze v2](./database-api.md) — Entity + Table 模式 **(v2 冻结)**
- [Query DSL v2](./database-query-dsl.md) — 类型安全查询构建器
- [sqlx 适配设计](./database-sqlx-design.md) — sqlx4k 驱动集成
- [SqlxStore v2 API](./database-sqlxstore-v2.md) — Store 聚合层

## 缓存与 Redis

- [缓存规范 v1](./cache.md) — L1 + L2 缓存抽象 **(设计冻结)**
- [缓存注解规范 v1](./cache-annotation.md) — @Cacheable / @CachePut / @CacheEvict
- [Redis 设计](./redis-design.md) — Redis 客户端抽象
- [Redis 分布式锁规范](./redis-lock.md) — @Lock 注解与 LockManager

## 项目管理

- [路线图 v1](./roadmap.md) — 9 大方向、P0-P3 优先级
- [项目状态报告](./project-status-report.md) — v1.0.0-beta1 发布门控
