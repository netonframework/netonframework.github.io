# Neton Framework 文档

Neton 框架设计规范与用户指南。基于 VitePress 构建。

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
- `docs/zh-hans/spec/` — 框架、协议与生态内部规范
- `docs/zh-hans/spec/application/` — Application 生态规范唯一维护位置，按架构、认证安全与工程治理分类
- `docs/zh-hans/spec/application/index.md` — Application 规范分类索引

内部 spec 不随公开文档站点发布；应用仓库旧规范位置仅保留迁移链接，避免多份正文漂移。
