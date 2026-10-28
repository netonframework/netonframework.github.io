# 1.0 契约修复与冻结复评

> 本文保留六项修复的原始验收基线；后续 F07 的实现和复评进展见
> [最终 API 评审的修复后复评](./2026-10-28-final-api-review.md#f07-修复后的细节复评)。

状态：本地回归与远端完整 CI 均通过；未发布新 beta 或正式版。API 冻结复评仍有新增 F07 阻塞，不能把工程门禁绿色当作最终冻结批准。

- Framework：`cacda428c162fe9aa11d3854a021f8f5103fb6b6`；实现提交 `3fe4801`，后续仅同步 Redis 使用示例。
- Public app：`41266f3b8f97fc3b8b9563942ce4c5b1af340376`，已更新框架 lock；应用公开依赖仍是 beta26，新修复只在候选验收中消费。
- 范围：neton、neton-docs、neton-app。不使用任何专属业务产品作为门禁。

## 本轮六项处理

1. Storage：解析错误不再吞掉；仅未提供配置时默认本地源。文件与 DSL 分别检查重复项再合并；同名跨来源覆盖合法。
2. Jobs：调度与执行有独立 Job 所有者，生命周期锁界定接收边界；先停止新任务、排空已接受任务，超时再取消。拒绝停机后 start/trigger，重复停机安全。
3. Redis：新增 setTyped<T>，remember<T> 使用同一 serializer 往返；保留原始 set(Any) 编码。非法基本类型值和损坏 JSON 视为 miss，不打印 key/解码内容。
4. Events：冲突注册先检查再修改；registered 返回快照；总线封印 codec，无状态自定义 codec 可使用默认 seal 方法。JSON codec 明确为可选工具，outbox 实现仍归应用层。
5. 凭据：Storage、Redis、数据库 URI/解析结果、AI 有效配置默认展示脱敏，副本/嵌套展示也测试；既有 SMTP 规则保留。
6. 规范：撤回 Jobs 错误停机示例；统一事件 codec 所有权；WebSocket 当前实现与历史记录分开，业务 API 为冻结候选、引擎 SPI 仍实验性，性能清单不冒充已验收。

## 本地验证

- 新增 Storage 重复配置、凭据展示、事件冲突后旧映射保持测试在旧实现失败。
- Jobs 测试初次编译发现测试返回值不是 Unit，已修正；随后显式将排空变异为立即取消，排空测试失败，恢复修复后通过。
- Core、Storage、Jobs、Database、Redis Native 测试通过；数据库本地未配置外部数据库，真实数据库契约由远端隔离 PostgreSQL 门禁证明，不将本地可选测试视为真实数据库验收。
- 独立 loopback Redis 7.2.7，端口 16389，无持久化；NETON_TEST_REDIS_REQUIRED=true 的真实对象往返、损坏回填、TTL 与 pipeline 测试通过。
- AI 凭据回归及 WebSocket Native 回归通过。
- core/redis/database/storage ABI 真实编译全部声明目标后更新；差异仅为默认 DomainEventCodec.seal、具体实现 seal 和 Redis setTyped。无目标推断、无隐藏公开符号。
- 增加旧式无状态 codec 和 typed Redis 的源码消费者样本；本轮七组正负消费者全部通过。

## 远端验收

- Framework `cacda42`：[Backend CI 40702031443](https://github.com/netonframework/neton/actions/runs/40702031443) 完成，`success`。API/ABI、源消费者、全量框架、真实 PostgreSQL/Redis、三平台参考应用、KSP 增量与 ARM64 原生执行、签名候选和三平台公开应用候选全部通过。主分支 secret-scan 与 Pages 也通过。
- Public app `41266f3`：[40700915150](https://github.com/netonframework/neton-app/actions/runs/40700915150) 完成，三平台公开 beta26 消费均通过；自动提升级 PR 在 push 事件按设计跳过。新框架修复的消费由上面的同批候选矩阵证明。
- Docs `71041bd`：[部署 40702862865](https://github.com/netonframework/netonframework.github.io/actions/runs/40702862865) 与 secret-scan 均通过；最终证据提交还需其自身部署成功。

冻结复评见 [最终 API 评审](./2026-10-28-final-api-review.md)。F07 的临时失败探针已移除，Storage 已恢复运行全套测试并通过；没有留下忽略、禁用或预期通过的错误行为测试。

## 冻结复评纪律

CI 绿色不自动等于全部语义稳定。只关闭有代码和回归证据的问题；没有执行的容量、性能或第三方实现验证仍不得宣传为通过。正式版需要独立授权，不创建 v1.0.0 标签或上传正式制品。
