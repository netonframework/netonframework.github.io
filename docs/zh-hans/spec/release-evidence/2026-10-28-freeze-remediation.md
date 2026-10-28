# 1.0 API 冻结整改与公开应用门禁

状态：完整候选 CI 已通过；不是 1.0.0 正式发布批准。

- Framework：`23e0b543e86f67b4bb0a6ba6c8dea8ee0e7e7e69`（实现提交 `f1e436e`，后续更新公开应用固定 SHA）。
- Public app：`2ee7825503af3faff50a4fa19dbe74c7780a03f5`，由框架 `tools/ci/neton-app.lock` 固定。
- 范围：neton、neton-docs、neton-app。维护者已授权候选通过后发布新 beta，仍未授权发布 1.0.0 正式版。

## 同提交完整 CI 证据

[Backend CI 40665694771](https://github.com/netonframework/neton/actions/runs/40665694771) 已完成，结论为 `success`，对应上述 Framework SHA。

- 编译 API/ABI 与源兼容正负样本、全量 framework-checks、PostgreSQL/Redis 契约均通过。
- KSP macOS ARM64、Linux x64/ARM64、Windows x64 增量验收通过，Linux ARM64 有原生执行结果。
- 三平台参考应用 release 构建、迁移重放/校验、两轮启停和数据库连接归零全部通过。
- 签名本地候选制品通过；公开 neton-app 固定版本在 macOS ARM64、Linux x64、Windows x64 消费同批候选制品，构建和两轮运行全部通过。
- 最终 `Neton release gates` 汇总成功；此结果不等同于 Maven Central 正式签名制品已经发布或发布后消费验收已经完成。

后续 beta26 生产签名、Central 发布及公开预览版本的验收单独记录，不用测试密钥候选代替。

## 整改

- F01：全局身份对象改为请求绑定实例，旧命名空间保留弃用类型别名；测试交错请求、嵌套视图、取消与跨调度器读取。正常认证路径仍使用请求属性。
- F02：SQLx 公开支持类型加 ERROR 级内部标记，KSP 生成代码显式 opt-in；没有隐藏 ABI，也没有将跨模块支持错误改成 internal。
- F03：AI 顶层公开契约加 ERROR 级实验标记；框架稳定版本不自动冻结 AI SDK。
- F04：WebSocket 引擎 SPI 闭包标记、机器可读稳定性分类、源标记检查及消费者正负编译样本；ABI 继续由编译器生成。样本覆盖具名/默认参数、类型别名、typed update、实验边界与旧全局身份入口。
- F05：SMTP 凭据默认字符串展示脱敏，并有回归测试。

## 本地证据与限制

- Core/HTTP Native 测试、数据库/WebSocket/AI 测试源码编译、KSP JVM 测试命令成功；后续给身份测试追加跨调度器断言，也已单独重跑通过。
- 7 组源消费者编译全部通过：stable/opt-in 编译成功；数据库内部 API、HTTP 内部 API、AI、WebSocket 引擎及旧全局身份调用均按预期编译失败，且匹配明确诊断。
- 六个受影响模块的 `updateKotlinAbi` 成功，真实编译全部声明目标；差异仅为身份入口收敛与新增 AI 实验标记。
- 门禁脚本 38 项单元测试通过；公开应用脚本 8 项单元测试通过。
- 公开应用 release 构建通过，使用之前已验收的本地打包候选 `1.0.0-candidate.d2d176b3deb3`；不是本次新框架候选的端到端证据。
- 对最终链接产物重新运行两轮，每轮健康至少 60 秒，版本精确匹配、SIGTERM 后退出 0、端口关闭。摘要 `078878761d2a111a79d789c66e1fc7007363a55c1470ad3868d38dfd2c16a260`。
- 构建未结束时的首次运行读到了旧二进制，不作为最终证据；最终记录为 `/tmp/neton-app-freeze-runtime-verified/evidence.json`，新门禁严格串行构建和运行。

## 放行条件

### 已发布 beta25 的 Windows 限制

公开应用首次 Windows 编译暴露 KSP 生成源重复归属，原因是过滤路径没有归一化 Windows 分隔符，已由 `2ee7825` 修复。
修复后 Windows release 构建和 HTTP 运行成功，但 beta25 在 CTRL_BREAK_EVENT 后退出码为 `3221225786`，不能视为正常停机。
macOS/Linux 的 beta25 运行验收已通过。此处没有放宽退出码断言；当前框架候选的 Windows 停机路径仍由完整候选门禁独立验证。
默认公开预览版需要发布含停机修复的新 beta，并升级应用版本。维护者已授权在候选全绿后发布新 beta；不等同于授权正式发布 1.0.0。

新框架候选 CI 必须完成 ABI/源消费者编译、KSP 增量、真实数据库、三平台参考应用、签名制品以及同批制品上的公开 neton-app 三平台运行。
`Neton release gates` 现在要求 10 类前置任务全部成功，缺失、失败、跳过均不放行。
生产签名身份和最终发布操作仍需维护者确认，测试密钥不替代生产签名。
