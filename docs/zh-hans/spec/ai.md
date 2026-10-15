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

### 2.3 实施进度（2026-10-15）

§2.1 的三个 P0 已修复：工具异常只回稳定错误码（`AiToolException` 可显式给出可公开的信息）；流式用量由厂商配置文件决定是否请求；块顺序由 IR 保持。

| 步 | 状态 | 说明 |
|---|---|---|
| 0 | 完成 | 三个 P0 都有回归测试 |
| 1 | 完成 | `neton.ai.protocol`：IR、四协议编解码、自身往返 golden test、§4.4 保留项测试 |
| 2 | 完成 | `ProtocolConverter` / `StreamConverter`：诊断与损耗策略、用量完整性、错误按客户端协议渲染 |
| 3 | 完成 | SigV4、AWS event-stream、Google 服务账号令牌、Bedrock / Vertex / Azure 路径与报文；17 家厂商配置（取值按各家 2026-10-15 的官方文档，出处写在代码注释里） |
| 4 | 完成 | gateway 的编解码、SSE 分帧、UTF-8 解码、SigV4、event-stream 改用本层；原有编解码测试改为对本层的行为等价测试；gateway 单测与 harness 端到端 200 个场景全部通过 |
| 5 | 完成 | Anthropic 结构化输出（`output_config.format`，兼容读取已废弃的 `output_format`）；Bedrock Converse 作为第五种报文格式（Bedrock 上所有模型）；gateway 的 `/v1/responses` 可打非 OpenAI 上游（只桥接无状态请求，见 gateway 文档） |
| 6 | 部分 | 非文本端点的用量提取（token + 按件单位：图片数、音频秒数、输入字符、检索单位）；multipart 处理；`RealtimeBridge`（Realtime 与 Responses WebSocket 的双向转发、事件改写与拒绝、用量提取），与 socket 实现无关。gateway 的实时端点接线等 neton-websocket 提供客户端（含 TLS）后再做 |
| 7 | 完成 | 按 §10 重构（2026-10-15，对照 AI SDK v7 吸纳核心语义，不保留旧接口）：模型接口即 IR、单一请求与循环、可跨调用恢复的审批、工具校验与修复、请求内结构化输出、中间件、Agent、嵌入与多模态 API |

迁移 gateway 时，按既有生产行为与官方规范定下的细节：

- 开启 thinking 而 `max_tokens` 不够容纳预算时，把 `max_tokens` 抬到「预算 + 1024」，不放弃推理；开启 thinking 时不发送 `temperature` / `top_k`。
- 写往 OpenAI Chat 的纯文本内容合并为字符串（多段以换行连接），因为不少兼容服务不接受数组形式。
- OpenAI 的 `json_schema` 写到 Gemini 的 `responseJsonSchema`（接受 JSON Schema），不写只认 OpenAPI 子集的 `responseSchema`。
- Gemini 没有调用 ID 时按出现顺序生成内部 ID，只用于回配，不写出；发给客户端的响应带上真实 ID，发给上游只写来自 Gemini 的 ID。
- 上游流里出现无法解析的数据时以错误结束，不跳过。

### 2.4 主流项目的实际标准

- **new-api**：入站支持 OpenAI Chat 与 Responses、Anthropic Messages、Gemini（含 `streamGenerateContent`）、Realtime 与 Responses 的 WebSocket、图片生成与编辑、语音合成、转写、翻译、embeddings、rerank，以及任务插件。上游包括 OpenAI、Anthropic、Gemini、Azure、Bedrock、Vertex、DeepSeek、Qwen 和其他兼容服务。其 **RelayKit 是一个独立构建的协议模块**：四协议两两互转（请求、非流式、流式），每个结果带质量等级、实际路径和诊断；有损耗策略（allow / safe / strict）、媒体解析钩子、统一 usage（含 Claude 缓存写入的 5 分钟与 1 小时拆分），并附带上游原始 usage 供计费；HTTP、SSE 读写、渠道、鉴权、计费由宿主完成。
- **LiteLLM**：端点族更宽（files、batches、vector stores、assistants、OCR、search 等），作为覆盖面的上限参照，不作为本期目标。

**结论**："协议层独立于业务"已是主流做法，本规范据此设计。

---

## 三、协议与端点覆盖

### 3.1 文本协议（v1 必须）

> 实现中另加了第五种：Amazon Bedrock Converse（`WireFormat.BEDROCK_CONVERSE`），它是 Bedrock 上所有模型共用的接口，接入它才覆盖 Nova、Llama、Mistral 等非 Anthropic 模型。

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

### 4.5 Gemini thought signature

**依据**：Google 官方文档 [Generate Content 的 thought signatures](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures)（2026-10-14 核对）：

- Gemini 3 及之后的型号：当前轮内，**任何一步的第一个 `functionCall` 部分**缺少签名，请求返回 400。更早的轮次不校验。
- 并行调用时，只有第一个 `functionCall` 部分带签名。
- 非函数调用的响应，签名可能出现在最后一个部分。**文本签名不是必需的**：缺失不会报错，但效果可能下降，官方仍建议回传。
- 官方给出两个**占位值**：`context_engineering_is_the_way_to_go`、`skip_thought_signature_validator`。只用于缺少真实签名的 `functionCall` 部分（例如迁移自不带签名的其他模型），并明确表示**强烈不鼓励**注入自定义调用。
- OpenAI 兼容格式：签名放在每个 tool call 的 `extra_content.google.thought_signature`。
- Gemini 2.5：签名在第一个部分（不论类型），回传是可选的。
- Interactions API 的签名位置与状态管理方式不同（有状态模式由服务端管理），本节规则只适用于 `generateContent`。

分成两条**独立**的规则。

#### 4.5.1 规则一：保留真实签名（已定，始终执行）

- 签名**绑定到原来的内容块**：`functionCall` 按调用 ID 及其在本步中的位置绑定，文本部分按位置绑定。不做消息级字段，**不按工具名称查找复用**。
- 原样保存，不修改、不覆盖；同协议透传时自然保留。
- **只在一次转换内保留，不等于多轮往返无损。** 签名要回到下一轮请求，必须经过下面的跨请求机制。
- **厂商原生字段保持原生含义**：不得把 Gemini 签名编码进 Anthropic thinking 的 `signature`、Responses 的 `encrypted_content` 等其他厂商的推理字段。这些字段有各自的协议语义，并会被对应厂商校验；一旦请求改走真实的 Anthropic 或 OpenAI 上游就会出错。

**跨请求回传机制**（按优先级）：

| 机制 | 适用 | 说明 |
|---|---|---|
| A. 官方扩展字段 | OpenAI 格式客户端 | 在每个 tool call 输出 `extra_content.google.thought_signature`（Google 官方约定），客户端原样带回。经 golden test 验证后**默认开启** |
| B. 宿主状态引用 | 所有格式的客户端，仅限 `functionCall` | 宿主把签名存入 `ThoughtSignatureStore`，生成**不可猜测的状态引用**并嵌入返回给客户端的**工具调用 ID**。各协议的客户端都会原样带回工具调用 ID，下一轮据此取回签名。取回时必须校验绑定信息（见下），任一不符即视为缺失 |
| C. 协商的命名空间扩展 | 双方显式协商过的客户端 | 使用明确的自定义命名空间（如 `x-neton` 前缀的字段），**不伪装成任何厂商的原生字段**。未协商时不输出 |
| D. 都没有 | — | 签名丢失，按下文的诊断处理 |

机制 B 的要求：

- 状态引用由宿主用安全随机数生成，**不使用上游或客户端给的调用 ID 作为主键**。客户端或上游给的 ID 不能当作可信的全局唯一标识。
- 存储记录绑定并在取回时校验：租户与授权主体；上游来源、API 类型和模型的兼容范围；原始响应、步骤、内容块位置与关联调用；**调用内容的摘要**（函数名与参数），防止参数被改动后仍然套用旧签名。
- 必须有容量上限、过期时间、租户隔离。框架不提供默认的进程内实现，避免多实例部署下悄悄失效。
- 嵌入后的工具调用 ID 必须满足每种客户端协议对 ID 的字符集与长度要求，由各协议的 golden test 验证。
- 文本部分没有工具调用 ID，机制 B 不覆盖。文本签名不是必需的，丢失只产生 `warning`（见下）。

**诊断**：

| 代码 | 级别 | 时机 |
|---|---|---|
| `gemini_thought_signature_missing` | `error` | 发往 Gemini 3 及之后型号的请求里，当前轮某一步的第一个 `functionCall` 没有真实签名 |
| `gemini_text_signature_unavailable` | `warning` | 文本签名无法回传。官方明确为非必需，只影响效果 |

#### 4.5.2 规则二：补占位值（有损兼容模式，默认关闭）

- 模式名 `geminiSignatureBypass`。只用于 `generateContent`，**只写到当前轮每一步中缺少真实签名的第一个 `functionCall` 部分**，使用官方占位值。**不写文本部分**：官方说文本签名不是必需的，占位值也只适用于 `functionCall`。这一点与 new-api 不同，new-api 会在没有调用时写第一个文本部分；官方文档已经写明，因此以官方为准。**已有真实签名的部分一律不写。**
- **这是官方不鼓励的跳过校验**：只让请求通过校验，**不恢复模型原来的推理状态**，效果可能下降。不得宣称为修复或无损往返。
- 每次写入都产生 `error` 级诊断 `gemini_thought_signature_bypassed`。应用须把它加入 `safe` 策略的已授权降级列表（§5.3），否则 `safe` 会拒绝这次转换。
- **可执行的启用闸门**：开启该模式还不够，只有对"接口 + 模型范围 + 渠道"存在**通过的验证记录**时才实际生效。验证由宿主提供，框架只调用判定钩子 `isBypassVerified(api, model, channel)`。验证未通过或不存在时，按规则一的缺失处理，**不补占位值**。
- `functionResponse.id` 的处理**不照搬** new-api 的"默认删除"：只有在同名工具并行调用、结果乱序返回的测试中，调用与结果仍能正确对应，才可以删除。

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

每条诊断包含：代码（如 `hosted_tool_omitted`、`cache_control_dropped`、`signature_dropped`、`n_gt_1_unsupported`、`unsupported_media_type`）、字段路径、说明、级别（`warning`：展示层面的差异，或厂商官方明确为非必需的信息丢失；`error`：工具行为、内容或必要状态发生了变化）、源与目标格式。流式转换累计诊断，包括没有产生下游事件的那些。

### 5.3 损耗策略

请求阶段按策略处理：`allow`（默认，完成转换并返回诊断）、`safe`（出现 `error` 级诊断时拒绝转换）、`strict`（出现任何诊断都拒绝）。响应与流式转换在三种策略下都完成转换并返回诊断。具体用哪种策略由应用决定（如按渠道配置）。

- **已授权降级**：应用可以给 `safe` 策略附带一个诊断代码白名单 `allowedLosses`，`safe` 对白名单内的代码放行，诊断照常记录。显式开启某个兼容模式时，由应用把对应代码加入白名单，例如 `geminiSignatureBypass` 对应 `gemini_thought_signature_bypassed`（§4.5.2）。**`strict` 不受白名单影响**，仍然是任何诊断都拒绝，便于理解与审计。
- **必要状态缺失属于 `error` 级**：推理签名、工具调用与结果的对应关系等丢失，会改变模型的行为，不是展示层面的差异。

### 5.4 宿主钩子

- **媒体解析**：转换需要下载 URL 或解析 data URL 时，调用宿主注册的解析器。未注册时转换返回错误，**框架从不自行发起网络请求**。下载的安全（SSRF 防护、大小上限）由宿主负责。
- **模型名推理尾缀**：提供可选的解析工具（`-thinking`、`-nothinking`、`-thinking-<budget>`、`-high` 等主流约定），解析为推理意图写入 `CallOptions.reasoning`。是否启用由应用决定。

---

## 六、流式

- 提供 SSE 解析与输出、AWS event-stream 解帧、增量 UTF-8 解码。读写 socket 由宿主完成。
- **每条流一个状态**（`StreamConverter`）：负责工具参数拼接、块的开闭、用量累加、终止状态。上游结束后**必须**调用 `finish`，部分转换器在这一步补发终止事件与最终用量。
- 上游可能交错发送多个块（Anthropic 的多个 content block、OpenAI 并行工具调用的参数），IR 允许同时打开多个块、按序号寻址；要求块连续输出的目标协议（Anthropic、Responses）由编码器重新排成「一个块完整输出后再输出下一个」。
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

建立在协议层 IR 之上，面向业务开发者。对照 AI SDK v7 吸纳其核心语义，但不追求接口一致：以 Kotlin 与本框架的约定为准。

### 10.1 模型接口直接使用 IR

- `AiLanguageModel` 的调用参数与结果**就是协议层 IR**（`ChatRequest` → `ChatResponse` / `StreamEvent` 流）：SDK、网关与中间件共用一套类型，不再有第二套 provider DTO。失败抛 `AiException`，流是冷流，连接错误在收集时抛出。
- 警告来自协议层诊断：error 级为 `UNSUPPORTED`（行为会变），warning 级为 `COMPATIBILITY`（近似实现），随每一步返回。
- **中间件**作用在 IR 上，对所有协议生效：`transformRequest`、`wrapGenerate`、`wrapStream`。内置默认参数、默认指令、`<think>` 推理抽取（流式状态机，标签可跨块）、JSON 围栏去除、模拟流式。按 provider 在配置里挂载。
- provider 另可提供嵌入、图片、语音合成、语音识别、重排序模型；OpenAI 兼容服务内置全部五种。

### 10.2 请求与循环

- **一个请求类型 `AiRequest`**，`generate` 与 `stream` 共用同一个循环引擎（非流式即一次完整调用、不对外发事件）。
- **继续条件**（全部满足才进入下一步）：结束原因是 Stop 或 ToolCalls（截断、过滤时的工具调用不执行）；有本地工具调用；每个调用都有了输出（执行结果、拒绝或参数错误）；没有挂起的审批或无执行器的调用；`stopWhen` 都不满足。默认上限 20 步。
- **`prepareStep`**：`model`、`toolChoice`、`activeTools`、`settings`、`providerOptions`（按命名空间与请求级合并）只作用于当步；`instructions` 与 `messages` 延续到之后的步骤（用于压缩历史）。
- **工具调用校验**：工具存在、参数通过 JSON Schema 校验（常用子集），空参数视为 `{}`，再经 `refineInput` 改写。失败时调用 `repairToolCall`（只修一次）；仍失败的调用标记 invalid，**不执行**，以错误结果交给模型，循环继续——不让一次坏调用打断整个请求。
- **toolChoice 强制**：要求调用工具（Required / Named）而模型没有调用，报 `ToolChoiceViolation`。
- **执行**：相邻的 `parallelSafe` 调用在 `toolCallConcurrency` 内并行，其余串行；结果按模型的调用顺序排列。单工具超时、阶段性结果（`preliminary`，只在流里）。
- **重试与超时**：只重试可重试的错误，指数退避（2s、4s…），上游给了 Retry-After 且小于 60 秒或小于退避时间时按它；流式只在首个输出之前重试。超时分整次、每步、首块、块间、单工具；块间计时只由真正的输出（文本、推理、工具参数）重置。
- **回退**：按路由策略，第一步在任何输出之前失败、且错误可回退时换下一个候选模型；之后不再回退。
- **推理**：统一档位 `AiReasoning`（none … max），各协议按自己的写法发送；预算型协议按输出上限的比例换算（minimal 2%、low 10%、medium 30%、high 60%、xhigh 90%、max 95%，不低于 1024）。

### 10.3 工具、授权与审批

- 工具三类：本地函数、动态（运行时才知道 schema，如 MCP）、厂商托管（`厂商.类型`，由上游执行）。类型化工具从序列化描述生成**受支持的 schema 子集**，不承诺任意自定义序列化器或联合类型都能转换。
- 工具结果是富输出：文本、JSON、错误、拒绝、多模态内容；不支持富结果的协议降级为文本。工具异常只回稳定错误码（§8），`AiToolException` 可给出可公开的信息。
- **授权**（这个主体能不能用这个工具）与**审批**（是否同意这一次调用）分开。授权可直接按 Neton 身份的权限或角色判断。审批状态：不需要、自动批准、自动拒绝、等待调用方。
- **审批可跨调用恢复**：审批请求与答复作为消息内容保存在历史里，不依赖进程内状态。调用方把答复作为最后一条消息发回，循环在第一步之前处理：被批准的调用重新校验签名（配置了密钥时，HMAC 覆盖审批 id、调用 id、工具名与参数）、参数、授权与审批策略——**策略拒绝优先于调用方的批准**——再执行；被拒绝的调用写入拒绝结果。自动决定也记录成一对请求与答复，便于审计。
- **工具检索**：标记 `deferLoading` 的工具默认不可见，模型调用检索工具查到后，从下一步起可用。
- **观测回调与控制逻辑是两种机制**：回调只观察，抛出的异常写日志后忽略；授权、审批、`prepareStep` 是控制逻辑，异常照常抛出。取消一律传播。

### 10.4 输出与结果

- **结构化输出是请求的一部分**（文本、任意 JSON、对象、数组、选项），只解析最后一步的文本。结果区分成功、拒绝、截断、非法、未生成（例如以工具调用结束）。流式持续给出半成品，**半成品不是结果**；数组的半成品只包含完整的元素。
- 结果带每一步的内容、来源、警告、性能（整步与模型耗时、首个输出时间、输出速度、每个工具的耗时）与用量；文本、结束原因取自最后一步，用量是全部步骤之和。用量细分缓存读写、推理与正文 token，并带完整性；未知不当 0。
- `responseMessages` 可以直接接到历史后面，下一轮继续。
- 流式事件：每一步以 StepStart 开始、StepFinish 结束；文本、推理、工具参数都是 start / delta / end；整次调用以恰好一个 Finish 或 Error 结束（被取消时都没有）。

### 10.5 其余能力

- 可复用的 `AiAgent`（固定模型、指令、工具等，每次只传对话；无状态，`prepareCall` 可按调用改写）。
- 批量嵌入（按模型单次上限切分、并发、逐批重试）、图片生成（按单次上限分批并发）、语音合成、语音识别、重排序；`cosineSimilarity`。
- `pruneMessages`（裁剪推理与已结束的工具轮次，保留区与配对部分不动）、平滑流（按词或行重新切分）。
- MCP 客户端（Streamable HTTP），按 MCP 最新协议 2026-07-28：
  - 先发 `server/discover` 协商（1 秒超时），之后每个请求无状态：不握手、不建会话；`params._meta` 携带协议版本、客户端能力与客户端信息；请求头带 `MCP-Protocol-Version`、`Mcp-Method`、`Mcp-Name`。
  - 工具 schema 中 `x-mcp-header` 标注的参数作为 `Mcp-Param-*` 头发送，非纯 ASCII 的值用 `=?base64?…?=` 编码；标注不合法的工具被忽略。
  - 结果必须带 `resultType`；服务端要求多轮输入（`input_required`）时报错，暂不支持。请求前先检查服务端是否声明了对应能力。
  - 服务端不认识 `server/discover` 时回退到 legacy 握手（最高 2025-11-25，带会话，关闭时 DELETE）；探测返回 modern 协议错误码（-32020/-32021/-32022）时直接报错，不回退。
  - 工具映射为动态工具（带标题与行为提示，结果为富输出），另支持资源与提示词。
- 测试替身 `ScriptedAiProvider`：按 IR 块编写脚本，支持流式切分、延迟、中途失败，记录收到的请求。

### 10.6 不做

UI 与 RSC、UI 消息流、终端 UI、编程代理 harness、Code Mode（需要 JS 沙箱）、workflow。暂不做：流开始后的自动重试、遥测集成（用观测回调与用量记录器接 Neton 日志）、视频生成、文件与 skill 上传、流式转写与翻译、`decide`。

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
- **最新特性往返**：推理签名、Responses 加密推理与 item ID、`cache_control` 及 TTL。
- **Gemini 签名完整链路**（§4.5）：非流式、流式、并行工具调用、多步工具调用，以及**下一轮请求**的完整往返；官方扩展字段、状态引用嵌入工具调用 ID（含各协议的 ID 约束、绑定校验、参数被改动后不套用旧签名、过期、容量、租户隔离）、协商扩展未协商时不输出；缺失时按策略拒绝或降级；同名工具并行、结果乱序时调用与结果仍能对应。最后用真实上游验证占位兼容，**不能只断言生成的 JSON 里有那个字符串**。
- **用量**：完整、部分、未知三种状态；取消与截断；缓存写入 5 分钟与 1 小时拆分；推理 token；`raw` 原样保留。
- **错误**：分类与回退判断；按客户端协议渲染；内部异常不外泄。
- **厂商配置**：每个内置配置的方言请求快照；新增厂商只改配置即可接入。
- **性能**：流式路径的每块分配有上限，纳入基准测试。

---

## 十四、待定

| 项 | 决定时机 |
|---|---|
| Gemini thought signature | 依据官方文档已定（§4.5）。实施时验证：机制 B 的状态引用在各客户端协议的 ID 约束下可用；规则二在各渠道与模型上的验证记录 |
| 实时协议的用量提取与计费事实的具体口径 | 第 6 步 |
| 是否把 `neton.ai.protocol` 拆成独立模块 | 第 4 步后视依赖情况而定 |
