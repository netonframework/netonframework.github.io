# 1.0 API 冻结复评：契约修复之后

评审基线：Framework `cacda428c162fe9aa11d3854a021f8f5103fb6b6`，Public app `41266f3b8f97fc3b8b9563942ce4c5b1af340376`。
结论：本轮六项修复有回归覆盖；尚不能无条件签署全部 API 冻结。发布门禁结果另见本轮契约修复记录，不以 CI 绿色代替语义评审。

## 已关闭

存储错误回退/重复配置、Jobs 排空停机、Redis 类型化对象往返、codec 冲突注册/封印、凭据默认展示、规范与实现状态漂移，详见 [契约修复记录](./2026-10-28-contract-hardening.md)。

公开签名差异为新增默认 `DomainEventCodec.seal()` 与 `RedisClient.setTyped<T>`，未删除现有入口。旧式无状态 codec 与已有正常消费者编译通过；内部/实验 API 的无 opt-in 使用仍被拒绝。

## 新发现 F07 / P1：Storage DSL 丢失“显式默认值”意图

- 规范 `storage-spec.md` §6.4 的合并表要求：DSL **显式设置**的字段覆盖配置文件；未设置字段继承文件。
- 当前 `SourceConfig` 同时充当带默认值的数据对象和 DSL receiver，无法记录某个字段有没有被赋值。
- `SourceConfigParser.mergeSources` 使用 `d.pathStyle || f.pathStyle`；文件是 true 时，DSL 显式 false 仍得到 true。`type="local"`、空字符串、默认 basePath 也存在相同的缺失与默认值混淆。

已用临时 Native 测试复现：文件 `SourceConfig(pathStyle=true)`，DSL `source("default") { pathStyle=false }`，断言最终 false 失败。本次复评探针不作为成功回归提交，也不把现状改写成规范允许的行为。

这与本轮已修复的“错误配置必须拒绝、同一来源重复名称必须拒绝”不同，是 DSL 数据模型问题。建议在冻结前明确引入带 presence 的配置构建器，区分 unset、false、空值和默认值；保持最终运行时 SourceConfig 与构建期覆盖意图分离，并评审 source(name, block) 的消费者兼容性。

必须补充：true→false、s3→local、非空→空、默认 basePath、未赋值继承、文件/DSL 各自重复项的完整合并测试。不能只把 OR 改成赋值，否则未配置 false 也会覆盖文件 true。

## 不应承诺的范围

- AI 与 WebSocket 引擎 SPI 仍按显式实验 API 管理。
- WebSocket 的已实现功能及一致性测试不等于大规模混合负载 p99、完整压力或所有第三方 provider 已认证。
- Native 编译 ABI 不承诺跨任意 Kotlin 编译器版本的 KLIB 兼容；平台/数据库支持按 release-freeze-contract 限定。
- 未发布新 beta，也未创建正式版本或 v1.0.0 标签。本轮源码修复不回写已经发布的 beta26。
