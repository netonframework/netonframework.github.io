# 1.0 冻结前模块边界与 Skill 校准

日期：2026-10-29。此记录不授权发布制品或标签。

## 变更范围

- `neton-websocket` 仍是框架模块，包名统一 `neton.websocket`；KSP 生成的类型名、
  示例、测试、源码目录和编译 ABI 同步。旧 beta26 制品不回写，新旧包名不能混用。
  框架注解与配置分别放入 `.annotations.WebSocket` / `.config.WebSocketConfig`，
  避免与底层协议库同名根包类型发生链接/编译歧义。
- `neton-ai` 连同示例、协议样本和相关提交历史迁至官方独立仓库；`neton.ai` 包名
  保持，独立候选版本 0.1.0-alpha.1，不再使用兄弟源码。初始 beta26 消费发现下述
  OpenSSL 冲突；后续必须使用修复后的固定框架候选制品验收，不能宣称 beta26 全平台兼容。
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

用户已明确要求全部使用自有 OpenSSL 4 封装。本轮将 Security 和 Storage 的旧 provider
统一替换，保留公开 API、PBKDF2 哈希和 SecretBox 布局。验收覆盖固定摘要/HMAC/PBKDF2/
RSA/JWK/AES-GCM/TOTP 向量、篡改拒绝、历史数据、HTTP+Security 同进程运行，以及三平台
原生链接与运行；依赖解析拒绝重新引入旧 provider。实现中不等于这些验收已全部通过。

模块迁移已推送核心提交 `85c8ebd16a7f525f005a0b782c92c1b739aef622`；本地
`:neton-websocket:updateKotlinAbi :neton-websocket:macosArm64Test :neton-ksp:test` 通过。
Skill manifest 验证通过。加密改动和最终主分支门禁另行记录，尚不构成 1.0 放行。

## 核心候选验收与冻结复评

框架提交 `934764fcf15f960a61410780e32cc3c8d83ec470` 的
[Backend CI 40744597869](https://github.com/netonframework/neton/actions/runs/40744597869)
全部 19 个 job 通过，含最终 Neton release gates。对应未发布候选版本为
`1.0.0-candidate.934764fcf15f`；制品摘要、临时签名验证结果、二进制摘要和运行证据
保存在该运行的候选及各平台验收 artifacts 中。

- 编译 API/ABI 基线和消费者正负编译通过。Security 公开 API 保持不变；WebSocket
  的显式包名迁移及 AI 移出清单是本次冻结前已授权的边界调整，不承诺旧二进制兼容。
- Security 统一 OpenSSL 4 后，Linux/Windows 原生测试和 macOS framework-checks
  通过。本地 `:neton-security:macosArm64Test` 也通过，含 6 项新增迁移测试。
  原有 RSA/JWK、摘要、HMAC、TOTP、PBKDF2 向量及历史哈希仍由回归覆盖；HTTP 与
  Security 同进程真实创建/关闭的测试验证组合链接，未通过跳过 Linux 绕过问题。
- macOS ARM64、Linux x64、Windows x64 的 release 参考应用均通过迁移和两轮启停。
  PostgreSQL、Redis、KSP 各平台增量检查及 Linux ARM64 实际执行均通过。
- 固定公开应用 `d1c31329daea1b76daa449ef461605e23a99cd6d` 从同一候选制品
  三平台构建并通过两轮运行/退出；其自身 [CI 40739772323](https://github.com/netonframework/neton-app/actions/runs/40739772323) 通过。
- 规范基线 `416476c1c0ce0e160de7577af641b80375db5431` 的文档构建和 secret-scan
  均通过；后续证据记录提交不改变上述框架或应用验收基线。

**本轮结论**：模块边界、命名迁移、加密后端替换及其公开契约复评未发现新的核心
发布阻塞项，核心技术门禁满足冻结候选要求。正式发布仍须维护者确认版本、生产签名
身份和发布说明；本轮不创建标签、不发布制品。正式 Central 发布后的独立消费复验
尚未发生，不能用测试密钥候选替代它。平台、数据库和实验 SPI 的承诺边界不扩大。

独立 AI 的候选消费 CI 另行记录；适配器迁出并不代表 Geario4k 原型已通过生产一致性
验收，也不要求其补齐所有能力才放行核心框架。

## 独立 AI 消费进度

AI 提交 `51d419b64556e97271d7d673ac04afbe651ae340` 的
[AI CI 40747405997](https://github.com/netonframework/neton-ai/actions/runs/40747405997)
已验证上述固定框架候选的提交和正文摘要；Linux x64、Windows x64 的实际 AI 测试与
示例链接均通过，原 Linux OpenSSL 重复符号故障在独立消费者中消除。本地候选与发布
工具共 10 项测试通过。记录时 macOS job 仍排队，尚不能宣称这次独立 AI 全平台 CI
通过；需以该运行后续结果为准。核心 19 项门禁的成功不替代此项独立验收。

## 独立 AI 最终验收（2026-10-29）

上述 [AI CI 40747405997，attempt 2](https://github.com/netonframework/neton-ai/actions/runs/40747405997/attempts/2)
在同一提交 `51d419b64556e97271d7d673ac04afbe651ae340` 上全部通过：固定框架候选
校验、macOS ARM64 / Linux x64 / Windows x64 原生测试与示例链接，以及最终 AI gates。
macOS 的完整 ABI 与 opt-in 边界检查也通过；该检查按工作流设计仅在 macOS 执行，
其他平台的 skipped 不代表在那里执行了 ABI 检查。

第一次运行的 macOS 没有执行任何代码：GitHub 注明 hosted runner 获取失败及 macOS
ARM64 容量不足。维护者重跑后成功，本轮没有为基础设施排队问题修改源码或跳过测试。
本机补充 AI 构建因宿主负载过高主动停止，不计作成功；最终证据来自上述实际 CI。

## 运行时 HTTP 路径复核

范围为上述框架候选、独立 AI 提交和公开 neton-app 固定提交；不把任意业务 fork、
第三方注入实现或独立兼容适配器纳入“官方默认客户端”的承诺。

- 默认链路：`HttpClient.create` → `createDefaultHttpClient` →
  `createNetonStreamHttpClient` → 自有协议库 `Client` + `ClientConnector` →
  `neton.io.net.connect`；HTTPS 使用自有 `neton.tls.tlsConnect` 和 OpenSSL 封装。
- AI 的模型请求、SSE、多媒体、Google token 获取、MCP 流及会话删除均使用注入的
  `neton.http.client.HttpClient`。超时包装仍委托同一个客户端，没有引入供应商 SDK
  自带的 HTTP 栈。示例通过默认工厂创建并负责关闭客户端。
- Storage S3 请求及流式传输使用同一 HTTP 抽象；公开 neton-app 安装默认 HTTP
  组件。所核查生产源码及依赖中未发现 Ktor Client、OkHttp、Apache HTTP、
  URLSession 或 libcurl 等外部 HTTP 客户端路径。
- `MediaResolver` 的下载器、`JwksFetcher` 及实时通道仍是宿主提供的扩展契约，
  不是隐藏的第二套 HTTP 实现；官方实现必须遵循 HTTP 引擎规范。不能由此声称
  任意第三方扩展都已完成网络实现审计。

除源码检查外，还通过 `tools/framework_candidate.py` 验证并下载同一固定候选，执行：

```sh
./gradlew --no-daemon -Pneton.repository=/tmp/neton-ai-http-audit-934764f/repository \
  :neton-ai:dependencies --configuration macosArm64CompileKlibraries
```

依赖解析成功：`com.netonstream:http:0.3.0`、`io:0.4.1`、`tls:0.3.0`，HTTP/TLS
和 Security 使用同一 `openssl:4.0.2-3`。候选 HTTP 模块的 POM/Gradle metadata
也未发现外部 HTTP 客户端坐标。这里不承诺“零第三方基础依赖”：Kotlin 协程、序列化
及 OpenSSL 本身仍是正常依赖。CI 中的 gh/curl/Gradle 制品下载属于构建工具，不是
服务运行时 HTTP 路径；外迁的显式可选适配器也不属于核心默认栈。

**最终复评**：本轮独立 AI 三平台消费验证消除了此前待确认项，未发现新的核心 1.0
技术门禁阻塞。核心候选及公开参考应用的基线不变，发布范围继续遵循冻结契约。
仍需正式发布时确认版本、生产签名身份和发布说明；Central 发布后的消费复验必须
在发布后执行。本轮仅补充验收记录，不创建发布标签、不发布或暂存正式制品。
