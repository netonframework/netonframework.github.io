# Neton 1.0.0 正式 API 冻结评审

> 历史评审快照：下列发现描述 `d2d176b` 当时的实现。该提交主分支 CI 后来于
> attempt 2 全部通过；适配器迁出后的 `551ae83` CI 也已通过。
> 后续整改采用[发布冻结契约](../release-freeze-contract.md)，不能把本报告中的旧实现
> 描述或旧失败状态当作最新结论。整改后的新候选仍须独立完成全部门禁。

> 状态：评审结论为 **暂不批准整体冻结**；不是新的已接受规范。
> 对象：Framework `d2d176b3deb3c2b51e55aee92f0fbf9d765a9a05`，版本配置仍为 `1.0.0-beta25`。
> 工具链：Kotlin 2.4.20；评审不升级依赖，不发布、不创建标签。

## 1. 合并与验证边界

已将 `ci/1.0-abi-incremental` 快进合并到框架 `main` 并推送，主分支与已验收候选是同一提交。
[主分支 Backend CI](https://github.com/netonframework/neton/actions/runs/40643528553)
必须独立记录，不能把此前分支的成功冒充本次主分支全部成功。

本轮主分支 Linux Core 在 `Validate Gradle wrapper` 步骤访问外部服务时出现
`ETIMEDOUT` / `ENETUNREACH`，尚未执行 Core 测试。代码工作树未因这个环境失败而改变，
没有跳过校验或制造空提交触发重跑。需要通过具备 Actions 权限的操作者重跑失败任务。
主分支本轮已结束：除该任务及由其触发失败的 `Neton release gates` 汇总外，其他
Backend CI 任务全部成功，包括全量框架测试、ABI、KSP、三平台参考运行及候选制品。
`secret-scan` 和 `pages build and deployment` 也成功。总体仍为 failure，不能宣称全绿。
后续重跑成功后应新增证据，不改写本次网络失败事实。

本评审覆盖全部 17 个已发布 Kotlin 模块的 ABI 清单、分层归属及关键源代码；重点复核
请求身份隔离、跨模块实现边界、实验 API、生成代码和源兼容性。它不是对所有公开方法
逐一进行过语义证明的声明。既有三平台运行与候选包验收见
[候选验收记录](./2026-10-28-abi-ksp-candidate.md)。

## 2. 阻塞冻结的发现

### F01 / P1：两个公开 SecurityContext 使用全局可变身份，与请求级契约冲突

- 源码：`neton-core/src/commonMain/kotlin/neton/core/security/SecurityContext.kt:8–15`；
  `neton-security/src/commonMain/kotlin/neton/security/SecurityContext.kt:9–29`。
- 两者都是公开 singleton，`setIdentity` 改写同一个普通字段，读取没有请求或协程隔离。
- [security.md §九](../security.md) 要求身份属于 `HttpContext.attributes`，辅助
  `SecurityContext` 应委托请求上下文，不是进程全局当前用户。
- 用已签名候选包编译独立 macOS ARM64 Native 程序，使用两个 `CompletableDeferred`
  控制协程交错：A 设置身份后挂起，B 设置身份后唤醒 A。两个上下文均复现 **A 读取到 B**。
- 限定结论：源码搜索未发现正常 HTTP 认证主路径调用这两个 setter；主路径依然使用
  请求属性。本发现不等于声称现有所有登录请求串号，而是公开辅助 API 不能安全承诺该语义。
- 冻结前处置：删除/弃用无调用的旧入口，或设计必须绑定请求的唯一辅助入口。
  不能仅换成 ThreadLocal；协程迁移、挂起恢复、嵌套作用域、取消都应有隔离测试。
  两个命名空间应明确保留哪一个，不要冻结两个语义重复的全局入口。

### F02 / P1：数据库实现与生成代码支持接口尚未明确划分稳定 API / 内部 SPI

- `neton-database/api/neton-database.klib.api` 仍导出 `SqlxDatabase`、
  `SqlxTableAdapter`、`SqlxQueryBuilder`、`TypedFieldRef` 等 `adapter.sqlx` 类型。
- `SqlxDatabase.kt:27` 的 `initialize`、`executeDdl`、`close` 是可直接调用的公开入口，
  未标注 `InternalNetonApi`；这会让应用绑定具体适配器的生命周期和实现名字。
- `EntityTableProcessor.kt:316/340` 确实生成对 `SqlxTableAdapter` 的跨模块调用，
  因此 **不能机械地把全部适配器改成 internal**，否则下游生成代码不能编译。
- [database.md §10–11](../database.md) 限制业务 Logic 不依赖 `adapter.sqlx.*`，并要求
  明确 public visibility。当前 `Table.kt:12`、`DbContext.kt:24` 等仍依赖隐式 public，
  构建未启用 explicit API 模式。已有 ABI 清单没有替这些入口作稳定性决策。
- 冻结前处置：声明稳定 `api` / provider-neutral 扩展 SPI / 生成代码内部支持边界。
  必须跨模块公开的实现支持可使用现有 ERROR 级 `InternalNetonApi`，由生成器显式 opt-in，
  或提供中立支持入口。迁移前检查真实下游使用，不隐藏 ABI dump 来制造通过。
- 已排除的误报：目前 dump 没有 sqlx4k 原始驱动类型、`save/saveAll` 或旧运行期表注册器；
  先前移除 raw executor accessor 的整改仍然有效。

### F03 / P1：neton-ai 的已发布表面与 Draft 规格没有正式稳定性决策

- [ai.md](../ai.md) 明确为「Draft v1，未冻结 API」。
- `neton-ai` 已纳入 BOM 和 ABI 基线，公开协议层、转换、传输、模型和 Agent SDK；
  `src/commonMain` 未找到 `RequiresOptIn` 或 `InternalNetonApi` 稳定性边界。
- 因此不能从“包已发布、ABI 对比通过”推导出整个 AI SDK 都已获批准冻结。
- 冻结前需作明确选择：逐一接受拟稳定的协议/SDK 契约；或者将仍变化的表面明确标成
  实验 API，并给消费者可验证的 opt-in 与兼容性说明。协议模型是本模块的设计职责，
  **不应仅因为位于 protocol 包就全部认作泄漏的私有实现**。

### F04 / P1：编译 ABI 基线不足以执行正式源兼容性与稳定性分级承诺

- `tools/ci/verify_abi_policy.py` 检查模块/目标库存和数据库禁止项，未维护逐项稳定性清单。
- `HttpClientConfig.toEffectiveTimeout` 在源代码有 ERROR 级 `InternalNetonApi`，但
  `neton-http.klib.api:525` 只有方法签名，没有该标记，不能仅靠该 dump 审核 opt-in 边界。
- WebSocket 的 `WebSocketEngineProvider`、`WebSocketEngineConnection` 有实验标记，
  同文件的 `EngineLimits`、`HandshakeRequest`、`HandshakeResult`、`WebSocketEngineEvent`
  未直接标记。它们是否也属于实验闭包需显式决定；目前不能推断整个包都受标记保护。
- 公共参数名、默认值语义、typealias 使用、错误码和序列化形状还需源代码/行为契约。
  现有 KSP 编译测试和增量验收有价值，但不是所有公开 API 的旧消费者兼容性证明。
- 冻结前处置：为稳定消费者保存只读的源兼容样本，覆盖具名参数、默认参数、DSL、
  typed update、配置与 module 生成入口；新增 opt-in 正/负编译断言及公开声明分类门禁。
  KSP provider 服务发现入口、生成代码与运行期支持类需要一起版本化。

## 3. 发布前硬化项（不必因此改签名）

### F05 / P2：SmtpAccount 默认 toString 输出密码

- `neton-http/src/commonMain/kotlin/neton/http/mail/SmtpTransport.kt:7–14`
  定义了包含 `password` 的 data class，未重写 `toString`。
- 独立 Native 程序使用合成哨兵值验证，`toString().contains(sentinel)` 为 true；
  没有使用真实凭据，也没有打印哨兵值。
- 这不证明运行中的 SMTP 实现已经记录密码；问题是公开凭据模型的默认展示不安全，
  插值到日志后也不能依赖字段名脱敏来补救。建议保持签名，添加安全 `toString` 和回归测试。

## 4. 模块逐项归类建议

以下是评审建议，不自动改变兼容性承诺，也不批准尚未逐项审阅的声明。

| 模块 | 拟稳定边界 / 冻结前决定 |
| --- | --- |
| neton | 聚合入口及 BOM 对齐；自身没有业务声明，但依赖导出也是消费契约 |
| neton-core | Bootstrap、Lifecycle、Config、HTTP/安全基础 SPI；先处理 F01，分类 mock 与跨模块支持 |
| neton-logging | Logger、LoggerFactory、上下文与配置；保留资源所有权及脱敏行为契约 |
| neton-validation | 业务注解与验证结果；与 KSP 生成调用一同做源兼容样本 |
| neton-cache | Cache/CacheManager、缓存键与配置契约；区分实现工厂和扩展面 |
| neton-redis | Redis 客户端/命令及生命周期；不把第三方驱动暴露给业务 |
| neton-jobs | 调度/租约/锁 SPI；固定取消、关闭与失败语义 |
| neton-security | Authenticator、Guard、Identity 与授权 SPI；F01 阻塞旧 SecurityContext 冻结 |
| neton-routing | 路由及参数绑定入口、限流/代理契约；实现注册表需分类 |
| neton-database | Table/Query/DbContext/Session/迁移；F02 和生成代码配套处理 |
| neton-http | 客户端/服务端端口、能力与资源所有权；保留内部标记，处理 F04/F05 |
| neton-http-hyper4k | 可选适配器装配入口，不扩大到引擎实现承诺 |
| neton-http-ktor | 可选适配器；此模块显式 createWithEngine 引用 Ktor 是合法桥接，不是核心泄漏；不在 BOM 中 |
| neton-websocket | 应用 Session/路由与能力契约；实验 Engine SPI 闭包按 F04 决策 |
| neton-storage | StorageManager/Operator、模型、配置；明确本地/S3 工厂与实现支持边界 |
| neton-ai | F03：Draft 协议与 SDK 不应未经审批整体升为稳定 API |
| neton-ksp | 工具入口、选项、诊断与生成契约；实现 processor 类不是自动承诺给业务扩展的 SPI |

`neton-core.mock`、HTTP/WebSocket conformance 和 testkit 已在运行期包的 ABI 中。
规范允许 Mock 认证，跨引擎复用 conformance 也有合理用途；不能一概删除。
但它们必须明确归属稳定 testkit、实验工具还是内部支持，避免把所有 public 都默认永久冻结。

## 5. 支持范围必须一起公布

- Kotlin/Native 基线适用于当前明确支持的工具链；不能宣称任意 Kotlin 编译器版本之间
  原生二进制都兼容。需要单独定义源兼容、KLIB 消费和最终 native 制品的范围。
- 数据库只发布四个 Native 目标，其他模块为五个；Intel macOS 不含数据库的限制已在
  README 正确注明，本评审不把它误报为隐藏缺目标。
- 暂存候选数据库是 PostgreSQL 变体。MySQL/SQLite 的 API 比较通过不代表三个驱动
  变体都已作为可选择的远程制品发布；生产方的 Gradle 属性不能改变已发布 KLIB 的驱动。
- stable SPI 增加抽象成员、data class 构造/复制形状变化、sealed/enum 的穷举变化
  都需兼容性评审，不可把“加字段/加枚举”一律当成无破坏更新。

## 6. 下一步与复核条件

1. 主分支环境失败重跑成功后，再记录本次 main CI 全绿；不替换失败证据。
2. 先处理 F01，再作 F02/F03/F04 的冻结边界决策；F05 可保持 ABI 单独硬化。
3. 用户批准整改后，才改实现/生成器及配套测试；本轮评审没有修改框架 API。
4. 更新 ABI 需要显式评审 diff 和旧消费者编译，不允许用更新基线掩盖未解释的变化。
5. 完成后对新的干净提交重跑同一套门禁，再签署正式 API 冻结结论。

独立复现环境：macOS ARM64，使用候选版本 `1.0.0-candidate.d2d176b3deb3`
的实际暂存包，无源码替换。debug Native 构建及运行成功。程序路径
`/tmp/neton-api-freeze-probe` 为诊断临时目录，不属于发布制品。
