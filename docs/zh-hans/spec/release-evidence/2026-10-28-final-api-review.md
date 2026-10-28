# 1.0 API 冻结复评：契约修复之后

> 下文基线及 F07 复现保留为历史记录。后续修复采用 `SourceOverrides` 明确表示
> 字段存在性：null 继承，false、空字符串、默认路径均显式覆盖。完整 `sources`
> 列表不再猜测覆盖意图，而是整体替换。见 storage-spec §6.2–6.4 的迁移约定。
> 这属于冻结前明确的 API/ABI 调整，不声称与 beta26 二进制兼容，也未发布版本。

## F07 修复后的细节复评

实现提交：Framework `4784a4c`。本地验证：Storage 49 项 macosArm64 Native 测试
（含 17 项配置测试）全部通过；编译生成 ABI 并 checkKotlinAbi 通过；7 组消费者
编译/预期拒绝用例通过；15 个模块 ABI 清单及实验/内部 API 分类检查通过。
远端验收须以该提交对应 Backend CI 为准，原基线的绿灯不能替代本次运行。

**远端验收完成**：Framework `4784a4cfa7ce65256a328bfecca7071fb3cef312` 的
[Backend CI 40712385778](https://github.com/netonframework/neton/actions/runs/40712385778)
全部通过，包括 API/ABI、基础模块、真实 PostgreSQL/Redis、多平台 KSP、三平台
release 参考应用、签名候选制品和三平台固定版本公开应用消费，以及最终发布门禁汇总。
公开应用仍固定 `41266f3b8f97fc3b8b9563942ce4c5b1af340376`，其自身
[CI 40700915150](https://github.com/netonframework/neton-app/actions/runs/40700915150)
通过；不通过无关空提交制造新验收。规范实现提交 `b5934da` 的
[文档部署 40713634968](https://github.com/netonframework/netonframework.github.io/actions/runs/40713634968)
及 secret-scan 通过。

**结论**：F07 关闭；本轮配置构建与合并契约复评未发现新的阻塞项。迁移成本已明确，
不能将本次更新 ABI 基线解释为旧二进制兼容，也不等于所有模块已完成无条件冻结批准。
没有发布新 beta、正式包或版本标签。

- 最终 `SourceConfig` 保持既有字段；新增 `SourceOverrides`，避免给 data class
  塞入 copy/equals 无法保留的隐藏存在性状态。
- `StorageConfig` 的覆盖列表属于主构造器，copy 保留覆盖意图，保持明确的浅复制语义。
- DSL block 返回时取副本，保留 receiver 后的修改不会悄悄改动已登记配置。
- 两份配置列表中的重复名称共同拒绝；文件内部重复仍单独拒绝。已有非法文件不能被合法 DSL 掩盖。
- `SourceOverrides`、copy 和嵌套默认展示均脱敏；类型错误的诊断不包含原始字段值。
- 配置解析不再将错误字段类型静默转成字符串或 false；删除过时的专用环境变量别名描述。
- 明确迁移成本：typed receiver 从 SourceConfig 改为 SourceOverrides，读取字段处理 null；
  sources 不包含 DSL 登记的覆盖对象；直接构造 SourceConfig 需要部分继承时改用 DSL。

本次复评范围为上述配置构建、合并、复制、诊断及消费者兼容路径；未声称重新穷举所有
框架实现或负载场景。F07 的修复仍须结合对应提交的 CI 门禁，不以更新 ABI 基线本身
作为兼容性或稳定性证明。

评审基线：Framework `cacda428c162fe9aa11d3854a021f8f5103fb6b6`，Public app `41266f3b8f97fc3b8b9563942ce4c5b1af340376`。
结论：本轮六项修复有回归覆盖；尚不能无条件签署全部 API 冻结。发布门禁结果另见本轮契约修复记录，不以 CI 绿色代替语义评审。

框架最新主分支 [CI 40702031443](https://github.com/netonframework/neton/actions/runs/40702031443) 已全部通过，含 macOS/Linux/Windows 参考应用与候选消费；本评审的 F07 是在绿灯之外通过定向契约检查确认的问题。

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
