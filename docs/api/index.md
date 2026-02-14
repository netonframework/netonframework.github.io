# API 参考

> API 参考文档正在建设中。

当前阶段请参考：
- [规范文档](/spec/) — 包含完整的接口定义与行为契约
- [用户指南](/guide/) — 包含使用示例与最佳实践

## 模块列表

| 模块 | 职责 |
|------|------|
| neton-core | 框架内核、组件管理、配置加载、HTTP 抽象 |
| neton-logging | 日志 API 与实现 |
| neton-http | HTTP 适配器 |
| neton-routing | 路由引擎、控制器扫描、参数绑定 |
| neton-security | 认证、授权、JWT、Guard |
| neton-redis | Redis 客户端、分布式锁 |
| neton-cache | L1 + L2 缓存抽象 |
| neton-database | Entity/Table/Store 适配、Query DSL |
| neton-ksp | 编译期代码生成（Controller / Entity / Config） |
| neton-validation | 校验集成 |
