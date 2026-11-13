# 后台操作审计

> 需要带操作审计的 System 模块，以及 Neton Framework 1.2.0 候选版本中的路由生命周期 API。脚手架用源码组装时，使用兼容的本地依赖，并在启动新版模块前执行 System 的 PostgreSQL 迁移 `V005__operation_audit.sql`。

Neton Framework 提供请求结束事件；Neton Application 的 **System 模块**决定后台操作的记录范围并写入日志，由现有操作日志页面查询。普通 CRUD 不用加审计注解。

## 配置记录范围

在 `application.conf` 中设置：

```toml
[audit]
operations = "write"
```

| 配置值 | 普通后台请求记录范围 |
| --- | --- |
| `off` | 不记录 |
| `delete` | 只记录删除 |
| `update` | 只记录更新 |
| `write` | 创建、更新、删除和其他写动作（默认） |
| `all` | 所有已匹配的后台路由，包括读取 |

分类依据 HTTP 方法及脚手架的标准 CRUD 路由约定。读取记录表示调用了接口，不代表人确实看到了某个页面。日志只保存路由模板等允许的字段，不保存原始查询值、凭据、请求正文或响应正文。普通记录进入有界异步队列，不保证可靠落库。

## 危险变更如何可靠留痕

已声明的危险路由不受普通日志开关影响。页面区分 **HTTP**（请求处理结果）与 **COMMIT**（已提交的业务事实）。二者通过服务端生成的调用 ID 关联，统计成功操作时不要重复计数。

System 已为管理员 MFA 重置、角色授权等操作接入事务审计。模块新增危险数据库操作时，在装配阶段通过 `OperationAudit.register` 注册方法、**不带挂载前缀**的路由模板和稳定动作键，再用 `OperationAudit.commit` 在同一个 `DbContext`、同一个事务内写入业务变更和审计事实。写审计失败，业务一起回滚。外部命令要分别持久化接受或派发事实与实际执行结果，不能把 HTTP 成功当作远端执行成功。

框架 API 参见 [路由生命周期扩展](./route-lifecycle.md)，模块接入与验收参见 [操作审计规范](https://github.com/netonframework/netonframework.github.io/blob/main/docs/zh-hans/spec/application/operation-audit.md)。
