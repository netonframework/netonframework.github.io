# Neton Application 生态规范

本目录是应用生态规范的权威位置。框架、IO/HTTP/QUIC 等协议规范保留其原分类；业务应用的身份策略、模块、前端和发布契约在此维护。业务仓库仅保留链接，不维护副本。

## 架构与模块

- [应用架构与配置](./SPEC.md)
- [模块模板](./module-template-spec.md)
- [模块提取与迁移](./MODULE_EXTRACTION_MIGRATION.md)

## 身份与安全

- [应用 RBAC](./rbac-spec.md)
- [登录与短信防滥用](./auth-abuse-protection-spec.md)
- [账号偏好](./account-preferences.md)
- [TOTP MFA 与三态登录](./mfa.md)
- [MFA 数据库并发与浏览器验收](./mfa-acceptance.md)

## 工程与交付

- [工程硬规范](./ENGINEERING_RULES.md)
- [1.0 标准化](./NETON-1.0-STANDARDIZATION-RC.md)
- [模块源码归一化待办](./backlog/MODULE-SOURCE-CANONICALIZE-P0.md)

迁移保留历史文档原名与相互引用；文内历史状态不代表当前全部完成。新增规范须归入上述类别并在此建立索引。
