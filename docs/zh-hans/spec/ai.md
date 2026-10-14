# neton-ai 规范：协议层与模型接入

> **定位**：规定 neton-ai 作为**框架能力**应提供什么：主流大模型 API 协议的无损报文模型、跨协议转换、流式与用量、上游接入，以及建立在其上的高层 SDK。
> 中转站的渠道、计价、结算、配额等**业务**不在本文，写在 gateway 项目的
> [`docs/neton-ai-protocol-adoption.md`](../../../../neton-application-module-gateway/docs/neton-ai-protocol-adoption.md)。
>
> **状态**：**Draft v1**。实施规格，未冻结 API。
>
> **原则**：遵循**最新的主流实际标准**，不自创协议。参照：
> - Vercel AI SDK `ai@7.0.137`（本地 `vercel-ai/`，Apache-2.0）：核心能力与 SDK 语义。
> - new-api 及其 RelayKit（2026-10 的 `main`）：中转站协议覆盖、四协议互转、质量分级与诊断。
> - LiteLLM proxy 的端点族：端点覆盖面的上限参照。
>
> **许可证**：RelayKit 和 new-api 是 **AGPL-3.0**。本文只参考它们**公开文档描述的行为与概念**，实现必须独立编写，**不得复制其代码或 DTO 定义**。
>
> **前置**：[HTTP 规范](./http.md)（出站 HTTP 客户端）、[日志规范](./logging.md)、[WebSocket 规范](./websocket.md)（第 3.4 节的实时协议）。

---

## 一、目标与边界

### 1.1 目标

1. **核心能力**：对齐 AI SDK 的核心语义（文本生成、流式、工具、结构化输出、多模态、推理、向量、重排），只取后端框架需要的部分。
2. **最新接入方式**：一等支持各家最新模型实际使用的协议特性：OpenAI Responses、Anthropic 推理签名与提示缓存、Gemini thought signature、托管工具等。
3. **覆盖约 90% 的模型**：靠**协议族 + 厂商配置文件**（§9）实现，而不是逐个厂商写适配器。绝大多数厂商属于第 3.1 节四个文本协议族之一，差异用数据描述。

### 1.2 三层分工

| 层 | 归属 | 负责 |
|---|---|---|
| **协议层** `neton.ai.protocol` | neton-ai（框架） | 四种文本协议及非文本端点的**无损**报文模型；统一中间表示（§4）与编解码；跨协议转换、诊断与损耗策略；流式状态；用量事实；错误映射；上游传输与托管鉴权；厂商配置文件 |
| **SDK 层** `neton.ai` | neton-ai（框架） | 面向业务开发者的高层 API：`generateText` / `streamText` / 结构化输出 / 工具循环 / Agent（§10） |
| **应用** | 各业务项目（如 gateway） | 渠道、模型映射与路由策略、计价、预留与结算、配额、令牌、TPM 限流、运营后台、异步任务插件 |

协议层不依赖 SDK 层；中转站只使用协议层，不执行工具、不跑工具循环。

### 1.3 复用 Neton 既有标准，不在 neton-ai 里重复实现

| 能力 | 由谁提供 |
|---|---|
| 出站 HTTP、TLS | `neton-http` 的出站客户端（应用绑定的 `HttpClientProvider`） |
| 鉴权、身份、权限、API Key 校验 | `neton-security` |
| 按请求计数的限流 | `@RateLimit` |
| 共享计数、缓存 | `neton-redis`、`neton-cache` |
| 持久化、Schema 迁移 | `neton-database` 与 `sql/` 版本化脚本 |
| 定时任务 | `neton-jobs`（注意：定时调度**不等于**可持久化的执行与故障重放，workflow 不在本期） |
| 日志与脱敏 | `neton-logging` |
| WebSocket | `neton-websocket` |
| 配置加载 | `application.conf` 与组件 DSL |

neton-ai 只提供 AI 领域特有的部分：协议、转换、用量事实、上游错误语义、厂商差异。

---

## 二、现状（2026-10-14 核对源码）

### 2.1 neton-ai

约 3,200 行，提供 `generateText`、`streamText`、工具循环、`embed`，接入 OpenAI 兼容与 Anthropic，带路由回退与用量记录，173 个测试。缺口：

| 问题 | 位置 | 级别 |
|---|---|---|
| 工具异常的 `e.message` 原样作为工具结果发回模型，可能泄露内部信息 | `internal/ToolLoop.kt:168` | P0 |
| 流式请求只设 `stream = true`，OpenAI 不会返回 usage，流式用量变成未知 | `OpenAiCompatibleTextModel.kt:75` | P0 |
| Anthropic 响应先分别提取文本与工具调用再重组，块的交错顺序丢失 | `AnthropicResponseMapper.kt:29` | P0 |
| `AiContent` 只有 `Text`；无推理块；无 provider 专属选项透传口 | `AiContent.kt` 等 | P1 |
| `GenerateTextRequest` 与 `StreamTextRequest` 字段完全重复 | — | P2 |
| 多轮用量汇总**已存在**（`aggregateUsage`），缺的是步骤明细、缓存与推理 token、完整性状态 | `ToolLoop.kt:129` | — |

### 2.2 gateway 现有协议层

`neton-application-module-gateway/logic/protocol`（约 2,300 行）：OpenAI、Azure、Anthropic、Gemini、Bedrock、Vertex 六类上游；以 **OpenAI Chat Completions 为转换中枢**；SSE 分帧、AWS event-stream、SigV4、Vertex OAuth、multipart。其保真矩阵自述的有损项：`cache_control`、Anthropic 服务端工具、Gemini thought signature、`n>1`；Responses 只能同协议；Anthropic 结构化输出未做。这些能力是通用协议能力，应下沉到本层（§12 第 4 步）。

### 2.3 主流项目的实际标准

- **new-api**：入站支持 OpenAI Chat 与 Responses、Anthropic Messages、Gemini（含 `streamGenerateContent`）、Realtime 与 Responses 的 WebSocket、图片生成与编辑、语音合成、转写、翻译、embeddings、rerank，以及任务插件。上游包括 OpenAI、Anthropic、Gemini、Azure、Bedrock、Vertex、DeepSeek、Qwen 和其他兼容服务。其 **RelayKit 是一个独立构建的协议模块**：四协议两两互转（请求、非流式、流式），每个结果带质量等级、实际路径和诊断；有损耗策略（allow / safe / strict）、媒体解析钩子、统一 usage（含 Claude 缓存写入的 5 分钟与 1 小时拆分），并附带上游原始 usage 供计费；HTTP、SSE 读写、渠道、鉴权、计费由宿主完成。
- **LiteLLM**：端点族更宽（files、batches、vector stores、assistants、OCR、search 等），作为覆盖面的上限参照，不作为本期目标。

**结论**："协议层独立于业务"已是主流做法，本规范据此设计。

---

## 三、协议与端点覆盖

### 3.1 文本协议（v1 必须）

| 协议 | 端点 | 入站 | 上游 |
|---|---|---|---|
| OpenAI Chat Completions | `/v1/chat/completions` | ✓ | ✓ |
| OpenAI Responses | `/v1/responses` | ✓ | ✓ |
| Anthropic Messages | `/v1/messages`（含 `count_tokens`） | ✓ | ✓ |
| Gemini | `/v1beta/models/{m}:generateContent`、`:streamGenerateContent` | ✓ | ✓ |

### 3.2 托管上游（同协议，换鉴权、路径与帧）

| 托管方 | 承载协议 | 要点 |
|---|---|---|
| Azure OpenAI | OpenAI Chat / Responses | 部署名路径、`api-version`、`api-key` |
| AWS Bedrock | Anthropic（`invoke`）、**Converse API**（新增） | SigV4；`invoke-with-response-stream` 的 event-stream 二进制帧 |
| Google Vertex | Anthropic、Gemini | 服务账号 JWT 换 OAuth token 并缓存；publisher 路径 |
| OpenAI 兼容厂商 | OpenAI Chat（部分支持 Responses） | 由厂商配置文件描述差异（§9） |

### 3.3 非文本端点（v1：报文模型 + 同协议透传 + 用量提取）

embeddings、rerank、images（generations / edits）、audio（speech / transcriptions / translations，multipart）。跨协议转换只在有明确需求时为 embeddings 补充。

### 3.4 实时协议（v1 第二阶段）

Realtime（`/v1/realtime`）与 Responses WebSocket（`GET /v1/responses` 升级）。协议层提供事件模型、用量提取与帧级桥接，连接管理使用 `neton-websocket`。

### 3.5 v1 不做

files、batches、fine-tuning、evals、assistants、vector stores、containers、moderations、OCR、search。batches 列入下一期（中转站可按批价结算）。**图片、视频等异步任务**的接入差异大、业务性强，归应用层的任务插件，不进协议层。

---

## 四、统一中间表示（IR）

### 4.1 设计选择

- **跨协议转换经由一个超集 IR**：每种协议只需写一对编解码器（N 对，而不是 N² 个转换器），而且 SDK 层与转换共用同一套模型。
- 与 RelayKit 的两两直转 + 经 Chat 多跳相比，超集 IR 让 Claude ↔ Gemini 这类转换只经过一层，不必像 RelayKit 那样经 Chat 两跳。IR 表达不了的内容按 §5 产生诊断。
- **同协议恒等透传，不经过 IR**：入站与上游同协议时只改模型名、合并参数覆盖，原始字节透传，避免无谓的解析与损耗。

### 4.2 消息与内容块

消息由**有序内容块**组成，块的顺序即上游原始顺序，往返必须保持：

| 块 | 关键字段 |
|---|---|
| `Text` | 文本；可选引用（citations） |
| `Image` / `File` | 来源：URL、base64（含媒体类型）、厂商文件 ID |
| `Reasoning` | 文本或摘要；`signature`（Anthropic）；`encryptedContent` 与 item ID（Responses）；`redacted` 标记 |
| `ToolCall` | ID、名称、参数 JSON；种类：`function` / `custom` / `hosted`（如 web search） |
| `ToolResult` | 对应的调用 ID；内容（可含文本与图片块）；`isError` |
| `HostedToolActivity` | 托管工具的调用与结果（如 web search 的检索记录），按原样保留 |
| `Refusal` | 模型拒绝内容 |

- 系统指令放在独立的 `instructions` 字段，不混在消息列表里。改名本身不能防提示注入，外部内容的信任边界与工具授权仍需单独控制（§10）。
- 每个块和每条消息都可以挂**厂商命名空间元数据**（如 `anthropic.cacheControl`、`gemini.thoughtSignature`、`openai.itemId`），用于往返保留。

### 4.3 公共调用选项

一份 `CallOptions` 供请求与 SDK 共用：`maxOutputTokens`、`temperature`、`topP`、`topK`、`stop`、`seed`、`toolChoice`、`parallelToolCalls`、`responseFormat`（`text` / `json` / `jsonSchema` 含 `strict`）、`reasoning`（`effort`、`budgetTokens`、`includeThoughts`）、提示缓存提示（块级，含 TTL），以及按厂商命名空间隔离的 `providerOptions`。

- `providerOptions` 的覆盖优先级：请求显式值 > 厂商配置文件的默认值 > 协议默认值。保留字段（模型名、`stream`、消息体）不得被覆盖。
- **回退到另一家 provider 时，不转发前一家的命名空间选项**，只转发公共选项。

### 4.4 往返保留规则

以下数据在 IR 中必须保留，目标是同一家族时必须原样写回；目标不支持时丢弃并产生诊断：

- 工具调用 ID（Gemini 没有 ID 时按名称与顺序回配，并记录映射）；
- Anthropic thinking 块的 `signature`，以及 redacted thinking；
- Gemini 的 `thoughtSignature`（function call 部分）；
- Responses 的 reasoning `encrypted_content` 与 item ID；
- Anthropic `cache_control`（含 TTL）；
- 未被 IR 建模的未知字段：保留原始 JSON，同协议回写时补回。

### 4.5 Gemini thought signature（已定，2026-10-14）

**结论：按必需处理。** Google 现行文档要求原样回传签名，但没有逐个型号写明缺失时的后果。社区多处报告，Gemini 3 对当前轮的 `functionCall` 部分做严格校验，缺签名时返回 400（"Function call is missing a thought_signature in functionCall parts"）；Gemini 2.5 不会报错，只是质量下降。依据用户规定的"无法判断时参照 new-api 最新版"，策略对齐 new-api `main`（`1b63c28`，2026-10-14）：

| 情况 | 处理 |
|---|---|
| 同协议（Gemini 入、Gemini 出） | 原样透传，签名自然保留 |
| 历史里有真实签名（IR 元数据 `gemini.thoughtSignature`） | 原样写回，**不得**用占位值覆盖 |
| 跨协议转到 Gemini、历史里没有真实签名 | 写入绕过占位值 `context_engineering_is_the_way_to_go`，规则同 new-api：每条 assistant 消息的**第一个** `functionCall` 部分；没有 `functionCall` 时写到第一个文本部分；从 assistant 消息里解析出的内联图片部分也写入。Responses 的每个 `function_call` 条目单独写入 |
| 开关 | 厂商配置文件的 `gemini.functionCallThoughtSignature`，**默认开启**（与 new-api 默认一致） |
| `functionResponse` 的 `id` | 默认移除（对齐 new-api 的 `RemoveFunctionResponseIdEnabled = true`） |

- 每次写入占位值都产生诊断 `gemini_thought_signature_bypassed`（`warning` 级）。
- **改进项（new-api 没有）**：Gemini 响应转成其他协议时，把真实签名记入 IR 元数据，回到 Gemini 时优先使用真实签名。客户端是 OpenAI 格式时，可选地在 `tool_calls[].extra_content.google.thought_signature` 中输出并接收签名。这个字段路径目前只有社区报告佐证，所以默认关闭，以 golden test 加真实上游冒烟测试确认后再开启。
- 占位值属于非公开约定，Google 可能调整。由真实上游冒烟测试持续监控。

---

## 五、转换、诊断与损耗策略

### 5.1 质量等级

每次转换返回：源格式、目标格式、质量等级、诊断列表。

| 源 \ 目标 | OpenAI Chat | Responses | Anthropic | Gemini |
|---|---|---|---|---|
| OpenAI Chat | — | good | fair | fair |
| Responses | good | — | fair | fair |
| Anthropic | fair | fair | — | fair |
| Gemini | fair | fair | fair | — |

`good`：结构接近，字段基本一一对应。`fair`：主要内容都能转换，协议独有字段以诊断报告。实际等级以实现与 golden test 为准，本表是目标。

### 5.2 诊断

每条诊断包含：代码（如 `hosted_tool_omitted`、`cache_control_dropped`、`signature_dropped`、`n_gt_1_unsupported`、`unsupported_media_type`）、字段路径、说明、级别（`warning`：仅展示层面的差异；`error`：工具行为或内容发生了变化）、源与目标格式。流式转换累计诊断，包括没有产生下游事件的那些。

### 5.3 损耗策略

请求阶段按策略处理：`allow`（默认，完成转换并返回诊断）、`safe`（出现 `error` 级诊断时拒绝转换）、`strict`（出现任何诊断都拒绝）。响应与流式转换在三种策略下都完成转换并返回诊断。具体用哪种策略由应用决定（如按渠道配置）。

### 5.4 宿主钩子

- **媒体解析**：转换需要下载 URL 或解析 data URL 时，调用宿主注册的解析器。未注册时转换返回错误，**框架从不自行发起网络请求**。下载的安全（SSRF 防护、大小上限）由宿主负责。
- **模型名推理尾缀**：提供可选的解析工具（`-thinking`、`-nothinking`、`-thinking-<budget>`、`-high` 等主流约定），解析为推理意图写入 `CallOptions.reasoning`。是否启用由应用决定。

---

## 六、流式

- 提供 SSE 解析与输出、AWS event-stream 解帧、增量 UTF-8 解码。读写 socket 由宿主完成。
- **每条流一个 `StreamState`**：负责工具参数拼接、按块顺序开闭（先关后开）、用量累加、终止状态。上游结束后**必须**调用 `finalize`，部分转换器在这一步补发终止事件与最终用量。
- 上游中途出错时，按**目标协议**的格式生成错误事件。目标是 Responses 时可选附带 `sequence_number`。
- 被取消或截断的流，用量记为 `PARTIAL`（§7）。

---

## 七、用量（计费事实，不做计费）

```kotlin
data class Usage(
    val inputTokens: Long?,
    val outputTokens: Long?,
    val cacheReadTokens: Long?,
    val cacheWrite5mTokens: Long?,
    val cacheWrite1hTokens: Long?,
    val reasoningTokens: Long?,
    val audioInputTokens: Long?, val audioOutputTokens: Long?,
    val imageTokens: Long?,
    val completeness: UsageCompleteness,    // COMPLETE / PARTIAL / UNKNOWN
    val raw: RawUsage?,                     // 上游原始 usage JSON 与来源协议
)
```

- **字段级未知用 `null` 表示，未知绝不记成 0**。`totalTokens` 不由框架推算。
- `raw` 保留上游原始结构与来源协议，供应用按上游规则计费。跨协议转换只改变客户端看到的形状，**不改变计费事实**。
- 累加规则：后到的**已知**值覆盖先前的值；`null` 不覆盖已知值；已知的 0 是真实的 0。
- 是否请求流式用量（如 OpenAI 的 `stream_options.include_usage`）由厂商配置文件决定（§9），不对所有兼容服务一律添加。

---

## 八、错误

- 上游错误按现有 `AiError` 分类（含 `isFallbackEligible`），并保留上游状态码与原始错误体。
- 跨协议时，错误体按**客户端协议**的形状重新渲染；同协议时原样透传。
- **内部异常不得原样发给模型或客户端**：工具执行异常、编解码异常只返回稳定的错误码与简短描述，详细信息只写入受控日志（修复 §2.1 的 P0）。

---

## 九、厂商配置文件

用**数据**描述同一协议族内的厂商差异，新增厂商通常不需要写代码：

| 字段类别 | 示例 |
|---|---|
| 端点与鉴权 | baseUrl、路径、鉴权方式（Bearer / `api-key` / SigV4 / OAuth）、额外头 |
| 协议能力 | 是否支持 Responses、`stream_options`、`parallel_tool_calls`、`json_schema` strict、`tool_choice` 各取值 |
| 字段方言 | 推理内容字段名（`reasoning_content` / `reasoning`）、`max_tokens` 与 `max_completion_tokens`、推理强度的写法 |
| 默认值 | 默认 `max_tokens`（Anthropic 必填）、推理预算比例 |
| 模型能力（可覆盖） | 输入模态、工具、推理、结构化输出、上下文窗口 |

- 内置主流配置：OpenAI、Anthropic、Gemini、Azure、Bedrock、Vertex、DeepSeek、通义千问（兼容模式）、Kimi、GLM、豆包/火山方舟、MiniMax、SiliconFlow、OpenRouter、Groq、Together、Fireworks、xAI、Mistral、vLLM、Ollama。具体字段值实施时按各家最新文档核对。
- 应用可以覆盖或新增配置。未知厂商使用保守默认值（不发送未声明支持的字段）。

---

## 十、SDK 层

建立在协议层 IR 之上，面向业务开发者：

1. **先迁移数据模型**：消息改为有序内容块，新增 `instructions`，请求共用 `CallOptions`，结果带每一步的明细（用量含缓存与推理 token，以及完整性状态）。
2. **基础模型能力**：结构化输出（定义 schema 校验、模型拒绝、截断、非法输出；流式中途的半成品不得作为最终成功结果）、多模态输入、推理内容、`providerOptions`。
3. **Agent 能力**：
   - 循环控制：停止条件、`prepareStep`（每一步可换模型、工具、消息）；
   - 生命周期回调：规定执行顺序、异常传播、取消行为。**观测回调与授权拦截是两种机制，不混用**；
   - 工具**授权**（能不能做）与**审批**（是否同意这一次具体操作）分开：核心提供独立接口，`neton-security` 作为可选接线，不强制绑定；
   - 工具调用上下文（身份、请求信息）；
   - 并行：默认串行，工具显式声明可并行，并限制并发度；取消不能撤销已经发生的副作用，重试需要幂等规则；
   - 类型化工具：从序列化描述生成**受支持的 schema 子集**，不承诺任意自定义序列化器或联合类型都能无损转换；
   - MCP 客户端。
4. **测试替身从第一阶段开始提供**：扩展现有 `testkit/Scripted`，用来验证流式、取消与多步时序。
5. **不做**：UI 与 RSC、终端 UI、编程代理 harness、Code Mode（需要 JS 沙箱）。workflow 暂不做。

---

## 十一、模块与包

- 保持一个模块 `neton-ai`，内部分包：`neton.ai.protocol`（`dto`、`ir`、`codec`、`stream`、`usage`、`error`、`profile`、`transport`）与 `neton.ai`（SDK）。
- **依赖单向**：`neton.ai.protocol` 不得引用 `neton.ai` 的 SDK 类型，由构建检查保证。日后若有需要，可拆成独立模块，不影响 API。
- 依赖：`neton-core`、`neton-http`（出站客户端）、`neton-logging`、kotlinx-serialization。实时协议依赖 `neton-websocket`，且只在使用时引入。

---

## 十二、实施步骤

| 步 | 内容 | 出口条件 |
|---|---|---|
| 0 | **修复现有正确性问题**：工具异常脱敏；流式用量（经厂商配置决定是否请求）；Anthropic 块顺序 | 各有回归测试；用量测试覆盖：尾部才给 usage、缺失 usage、中途取消，未知不记 0 |
| 1 | **IR 与四协议报文模型、编解码** | 每种协议的请求、响应、流式事件解码再编码回自身无损（golden test）；§4.4 的保留项都有往返测试 |
| 2 | **转换、诊断、损耗策略、流式状态、用量、错误映射** | 4×4 矩阵的请求、非流式、流式 golden test；诊断与策略测试；错误按客户端协议渲染 |
| 3 | **上游传输与托管、厂商配置文件** | SigV4、event-stream、Vertex OAuth 的单测；内置配置的方言测试；未知厂商保守默认 |
| 4 | **gateway 切换到本协议层** | gateway 现有三向编解码测试与 harness 端到端测试全部通过，行为等价（见 gateway 文档） |
| 5 | **补齐最新接入方式**：跨协议 Responses、Anthropic 结构化输出、缓存与签名的往返保留、Bedrock Converse | 对应 golden test；有损项清单更新 |
| 6 | **非文本端点整合；Realtime 与 Responses WebSocket** | 同协议透传与用量提取测试；WebSocket 桥接测试 |
| 7 | **SDK 层迁移与能力补齐**（§10） | 测试替身覆盖流式、取消、多步时序；结构化输出的失败语义测试 |

---

## 十三、验收

- **保真**：同协议透传字节等价（只改模型名）；四协议自身往返无损；4×4 转换的 golden test（请求、非流式、流式）。
- **最新特性往返**：推理签名、Gemini thought signature（含 §4.5 的占位规则：第一个 functionCall、无调用时第一个文本、真实签名不被覆盖）、Responses 加密推理与 item ID、`cache_control` 及 TTL。
- **用量**：完整、部分、未知三种状态；取消与截断；缓存写入 5 分钟与 1 小时拆分；推理 token；`raw` 原样保留。
- **错误**：分类与回退判断；按客户端协议渲染；内部异常不外泄。
- **厂商配置**：每个内置配置的方言请求快照；新增厂商只改配置即可接入。
- **性能**：流式路径的每块分配有上限，纳入基准测试。

---

## 十四、待定

| 项 | 决定时机 |
|---|---|
| Gemini thought signature | **已定**，见 §4.5：按必需处理，策略对齐 new-api 最新版 |
| 实时协议的用量提取与计费事实的具体口径 | 第 6 步 |
| 是否把 `neton.ai.protocol` 拆成独立模块 | 第 4 步后视依赖情况而定 |
