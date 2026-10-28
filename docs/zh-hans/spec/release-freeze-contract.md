# Neton 1.0 发布冻结契约

状态：冻结候选；只有同一干净提交的全部发布门禁通过后，才能签署放行。
本规范不授权创建发布标签或上传正式制品。

## 范围与稳定性

核心仓库为 `neton`、`neton-docs`、`neton-app`。Hyper4k/Ktor 独立适配器不阻塞核心发布。
实际使用的 I/O、HTTP、TLS、WebSocket 依赖必须固定版本并通过核心集成验收；不要求整个生态同时发布 1.0。

框架 ABI 清单内的 public API 默认受稳定兼容性约束，以下除外：

- `InternalNetonApi`：框架内部与生成代码支持，不供业务扩展，编译器 ERROR 级 opt-in。
- `ExperimentalNetonAiApi`：AI 协议和 SDK 尚未冻结，ERROR 级 opt-in。
- `ExperimentalWebSocketEngineApi`：`neton.ws.spi` 引擎接入契约，包括握手、限制和预算类型，ERROR 级 opt-in；不等于业务 WebSocket API 全部实验化。
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

- 同一框架提交的全量测试、ABI/源兼容、KSP、数据库、三平台参考应用及签名候选门禁通过。
- 固定 SHA 的公开 `neton-app` 从同次候选仓库构建，两轮运行、每轮至少 60 秒健康检查、正常退出且端口关闭；数据库迁移与连接归零由框架参考应用负责。
- 保存框架 SHA、应用 SHA、文档 SHA、候选版本、二进制摘要和实际测试结果。
- 生产签名身份、正式版本号、发布说明经维护者确认；临时测试密钥不等于生产签名授权。
- 发布后的 Maven Central 独立消费复验属于发布后步骤，不能在尚未发布时宣称已完成。

文档构建成功不是 API 评审通过；旧候选 CI 成功不是新候选证据。
