# Neton 项目状态

> **文档类型**：项目概览  
> **Scope**：neton 多模块框架模块清单与当前架构  
> **详细设计**：以各模块 spec（core.md、http.md、redis-design.md 等）为准。

---

## 一、模块清单

| 模块 | 职责 | 目录结构 | 状态 |
|------|------|----------|------|
| **neton-core** | 框架内核、组件管理、配置、HTTP 抽象 | `neton/core/` ✅ | 稳定 |
| **neton-logging** | 日志 API 与实现 | `neton/logging/` ✅ | 稳定 |
| **neton-http** | HTTP 适配器 | `neton/http/` ✅ | 稳定 |
| **neton-routing** | 路由、控制器扫描、参数绑定 | `neton/routing/` ✅ | 稳定 |
| **neton-security** | 认证、授权、JWT、守卫 | `neton/security/` ✅ | 稳定 |
| **neton-redis** | Redis 客户端、分布式锁 | `neton/redis/` ✅ | 稳定 |
| **neton-cache** | L1+L2 缓存抽象 | `neton/cache/` ✅ | 稳定 |
| **neton-database** | Store API、sqlx4k 适配、Query DSL | `neton/database/` ✅ | 稳定 |
| **neton-ksp** | 编译时代码生成 | `neton/ksp/` ✅ | 稳定 |
| **neton-validation** | 校验 | `neton/validation/` ✅ | 稳定 |

---

## 二、当前架构要点

- **唯一容器**：NetonContext，服务统一通过 `ctx.get<T>()` 获取
- **启动方式**：`Neton.run(args) { http { }; routing { }; onStart { } }`
- **已移除**：ServiceFactory、ComponentRegistry、runCompat 及旧启动路径（ServerTask/ServerRunner 等）
