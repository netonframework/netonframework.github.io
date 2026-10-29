# Neton 1.0 发布冻结契约

状态：1.0.0 已冻结并发布；源码提交 `e7a78204854464326ca878414968a96f4bdb2575`
的全部 19 项发布门禁通过，维护者已明确授权生产发布。具体生产签名和公开消费证据见
[正式发布记录](./release-evidence/2026-10-29-stable-release.md)。本规范不自动授权后续版本发布。

## 范围与稳定性

核心仓库为 `neton`、`neton-docs`、`neton-app`。Hyper4k/Ktor/Geario4k 独立适配器及独立 neton-ai 不阻塞核心发布，也不进入框架 BOM。各自负责其版本、测试和发布流程。

稳定性分级说明的是正式 1.0 的兼容承诺范围，不是仅凭 ABI 检查成功就自动冻结。冻结评审必须同时核对规范语义与行为回归；状态过时的模块文档要按实际证据同步，不得把未来能力当成已实现。
实际使用的 I/O、HTTP、TLS、WebSocket 依赖必须固定版本并通过核心集成验收；不要求整个生态同时发布 1.0。

框架 ABI 清单内的 public API 默认受稳定兼容性约束，以下除外：

- `InternalNetonApi`：框架内部与生成代码支持，不供业务扩展，编译器 ERROR 级 opt-in。
- 独立 `neton-ai` 的 `ExperimentalNetonAiApi` 由 AI 仓库维护，ERROR 级 opt-in；不属于框架 1.0 ABI 清单。
- `ExperimentalWebSocketEngineApi`：`neton.websocket.spi` 引擎接入契约，包括握手、限制和预算类型，ERROR 级 opt-in；不等于业务 WebSocket API 全部实验化。
- KSP processor 实现类不是业务扩展点；生成结果、编译选项、诊断和服务入口必须配套测试。

`neton.core.mock`、`neton.http.conformance` 是显式测试支持契约，不是业务认证的默认配置。
机器可读清单为框架 `tools/ci/api-stability.json`；ABI 检查、源消费者编译、实验 API
正负编译断言和行为测试共同执行，不能用更新 ABI dump 掩盖未评审变化。

## beta25 迁移

1. `SecurityContext` 不再是全局对象，改用 `SecurityContext(httpContext)` 或 `@CurrentUser`。
2. 业务不直接调用 SQLx 实现；KSP 和框架版本必须同时升级，生成代码显式处理内部 opt-in。
3. 使用 AI/引擎 SPI 的调用方必须显式 opt-in 并固定版本。
4. `SmtpAccount.toString()` 对用户名和密码脱敏，不能用它获取凭据。
5. 兼容适配器不再由框架 BOM 提供，使用方显式声明独立版本。

## 平台与制品支持

工具链基线为 Kotlin 2.4.20、KSP 2.3.12；不承诺跨任意 Kotlin 编译器版本的 KLIB 二进制兼容。
Native 运行门禁覆盖 macOS ARM64、Linux x64、Windows x64；Linux ARM64 另有 KSP 原生执行门禁。
macOS x64 库编译不等于原生运行验收，数据库不提供 macOS x64 目标。
默认数据库制品使用 PostgreSQL；MySQL/SQLite 的 API 变体检查不等于已发布可切换驱动制品。
1.0 不可宣传尚无验收证据的平台/数据库组合为已认证支持。

## 最终放行

凭据展示统一规则：配置对象（含副本和嵌套对象）默认 toString 不输出密码、密钥、带凭据 URI 或认证请求头。显式访问字段供协议认证使用不受影响；应用仍不得主动日志输出这些字段。Storage、Redis、数据库 URI、AI 有效配置与 SMTP 均需回归测试。

- 同一框架提交的全量测试、ABI/源兼容、KSP、数据库、三平台参考应用及签名候选门禁通过。
- 固定 SHA 的公开 `neton-app` 从同次候选仓库构建，两轮运行、每轮至少 60 秒健康检查、正常退出且端口关闭；数据库迁移与连接归零由框架参考应用负责。
- 保存框架 SHA、应用 SHA、文档 SHA、候选版本、二进制摘要和实际测试结果。
- 生产签名身份、正式版本号、发布说明经维护者确认；临时测试密钥不等于生产签名授权。
- 发布后的 Maven Central 独立消费复验属于发布后步骤，不能在尚未发布时宣称已完成。

文档构建成功不是 API 评审通过；旧候选 CI 成功不是新候选证据。
