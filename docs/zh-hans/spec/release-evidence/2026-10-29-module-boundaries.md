# 1.0 冻结前模块边界与 Skill 校准

日期：2026-10-29。此记录不授权发布制品或标签。

## 变更范围

- `neton-websocket` 仍是框架模块，包名统一 `neton.websocket`；KSP 生成的类型名、
  示例、测试、源码目录和编译 ABI 同步。旧 beta26 制品不回写，新旧包名不能混用。
  框架注解与配置分别放入 `.annotations.WebSocket` / `.config.WebSocketConfig`，
  避免与底层协议库同名根包类型发生链接/编译歧义。
- `neton-ai` 连同示例、协议样本和相关提交历史迁至官方独立仓库；`neton.ai` 包名
  保持，独立候选版本 0.1.0-alpha.1，依赖公开 Framework beta26，不再使用兄弟源码。
  AI 的 ABI、实验 API 分类、正负消费者编译、三平台测试由独立 CI 接管。
- 框架发布清单从 15 个 Kotlin 模块/85 个坐标变为 14 个/79 个；BOM 不约束 AI。
  框架不得重新 include AI 或 Geario4k/Hyper4k/Ktor。底层协议栈固定依赖不受影响。
- `neton-http-geario4k` 带历史迁出；只提供显式 Rust 源路径联调，不再隐藏读取兄弟目录。
  它仍是未通过完整引擎一致性验收的原型，不因拆仓被宣布可生产使用。
- 删除过期 `neton-http-netonstream/docs`，历史仍可由 Git 查询；当前规范以 neton-docs 为准。
- `neton-http-ktor` 已独立的本地提交推送到新建远端，不重新并回框架。

## AI 发布隔离

AI release workflow 仅手动触发，要求匹配 main SHA、已提交版本和该 SHA 的绿色 AI CI。
构建签名制品、验证签名和依赖、保存摘要，再提交 Central USER_MANAGED 验证；正式发布
仍需维护者另行批准。生产签名、Central 凭据、release 环境审批须在正式操作前配置。
本轮不执行该 workflow，不把流程文件存在等同于实际完成生产发布验收。

旧版 AI 与新独立版使用同一坐标但版本序列不同；消费者必须删除旧版本/BOM 约束并检查
最终依赖解析，不能假设 Gradle 自动选择更低的新独立版本。

## Skill 校准

权威源仍为 `skills/neton-development`。新增按需加载的 service-delivery 指南：
从公开 neton-app 和固定版本契约出发，完成路由、服务、可选持久化、显式迁移、身份边界、
资源生命周期与真实验收。模型辅助写服务与运行时调用模型是不同能力；无 AI 业务的服务
无需引入 neton-ai 或模型密钥。框架 skill 不强加 Application 的业务实体和权限约定。

验证分层：manifest 校验、引用可达性和场景决策复查，以及 neton-app 的真实构建/运行。
这些不是“所有 AI 工具会自动加载”或“所有生成代码天然正确”的承诺；最终仍由编译、
测试和版本化规范约束。未覆盖本机已安装副本，避免静默覆盖用户自定义 skill。

## 发布判断纪律

等待本次框架提交的完整发布门禁和固定应用 SHA 的三平台候选消费；旧 CI 不代替新证据。
仅在同一候选验收通过后重新评审 1.0；命名迁移需要消费者重新编译。
AI/独立适配器的未认证能力不扩张框架支持声明，生产签名和正式版本放行另行确认。

## 独立消费发现的阻塞项

[AI CI 40740198829](https://github.com/netonframework/neton-ai/actions/runs/40740198829)
的 macOS 和 Windows 通过，但 Linux `linkDebugTestLinuxX64` 失败：HTTP 引入
`com.netonstream:openssl:4.0.2-3`，Security 的 cryptography-kotlin 预编译 provider
引入 OpenSSL 3，出现 `ossl_get_openssldir` 等重复符号。移出核心门禁并不解决这个
框架模块组合问题，不得用允许重复符号、禁用 Linux 或剔除签名测试来伪造通过。
需要统一加密后端并执行专项回归；未完成前不建议签署 1.0 最终放行。
