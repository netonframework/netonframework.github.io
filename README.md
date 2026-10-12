# Neton 框架与网络协议栈文档

neton.tech 的用户指南与能力入口。覆盖 Neton 框架、独立网络协议库和 msgtrans，基于 VitePress 构建。

## 本地开发

```bash
pnpm install
pnpm docs:dev
```

## 构建

```bash
pnpm docs:build
pnpm docs:preview
```

## 目录结构

- `docs/zh-hans/` — 中文用户指南
- `docs/ecosystem/` / `docs/zh-hans/ecosystem/` — 中英文协议库指南、支持矩阵与版本规则
- `docs/zh-hans/stack/` — 内部历史审计与证据索引，不直接发布
- `docs/zh-hans/spec/` — 框架、协议与生态内部规范
- `docs/zh-hans/spec/application/` — Application 生态规范唯一维护位置，按架构、认证安全与工程治理分类
- `docs/zh-hans/spec/application/index.md` — Application 规范分类索引

内部 spec 不随公开文档站点发布；应用仓库旧规范位置仅保留迁移链接，避免多份正文漂移。

公开能力更新须同步两种语言，并记录源码核对日期与提交。源码版本不当作发布确认；
历史测试记录不当作当前版本重新验证。KDoc、原始测试结果和实现 SPEC 仍由各源码仓库维护。
