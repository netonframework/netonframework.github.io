# module-collect 通用采集模块

> 标识：NETON-APP-COLLECT
> 日期：2026-10-15 · 状态：Draft r2（对齐套件架构 r2：接入流程、来源信息、断点恢复、上游同步、媒体标准；2026-10-15 按 P1 实现校准）
> 仓库：`neton-application-module-collect`（服务端）、`neton-application-front-collect`（后台页面）
> 一个模块管理所有采集：文章、评论、商品、视频、榜单……采到的东西经「投递端口」交给需要它的模块（content、comment 或产品自己的模块）。

## 实现状态（2026-10-15）

| 项 | 状态 |
| --- | --- |
| 记录类型注册表 `CollectRecordTypeRegistry`，内置 `article` / `comment` / `media` | 已实现 |
| 采集源、任务（调度 manual / interval / cron / once）、运行（租约、断点、计数、运行日志） | 已实现 |
| 内置采集器 `http-list`、`http-api`；抽取规则 CSS 选择器 / JSONPath / 正则 + 通用正文兜底 | 已实现 |
| 外部采集器协议 `/platform/collect/…`（`collect_workers` appKey + HMAC-SHA256） | 已实现 |
| 去重 (source, record_type, origin_id)、fingerprint 变化检测、增量地址 `collect_seen_urls` | 已实现 |
| 流水线 `html-sanitize`、`normalize`、`text-extract`、`media-localize`（经 infra `importFromUrl`）、`policy-check`；`CollectPipelineRegistry` 可扩展 | 已实现 |
| 原始响应存档 `collect_record_raws`（按开关、有大小上限）；后台单条重新处理 / 重投 | 已实现 |
| 投递端口 `CollectSinkRegistry`、投递规则（含 on_change）、父子关联、退避重试、下游拒绝直接进失败列表（`Rejected`，2026-10-17）、失败批量重投 | 已实现 |
| 内置端口 `content.draft`（支持撤回）、`comment.import` | 已实现 |
| 上游删除：合作方推送删除 + `collect-upstream-recheck` 复查原文 404/410（缺省关闭），按 `upstream_delete_policy` 处理 | 已实现 |
| 事件 `CollectRecordProcessed`（`collect.record.processed`） | 已实现 |
| 规则在线调试（`/admin/collect/debug/test`） | 已实现（原计划 P2） |
| XPath 抽取、`feed`（RSS/Atom）、`readability` / `strip-boilerplate` / `dedupe-content` 步骤、代理池 | 延后 |
| `content.media` 端口 | 延后 |
| 按源成功率之外的采集质量报表 | 延后 |

## 1. 目标与边界

collect 是**内容接入流程**，不直接写任何模块的表：

> 采集 → 原始记录 → 清洗与映射 → 去重 → 策略检查 → 调用目标模块的契约接口入库

**负责**：采集源、采集任务与调度、采集执行（内置抓取器 + 外部采集器）、原始记录的存储与去重、清洗流水线、记录之间的关联、按规则投递给下游模块、投递结果回写、运行监控。

**不负责**：
- 采到之后怎么用：文章变成什么样的稿件、评论挂到哪篇文章，由下游模块的投递端口决定。
- AI 加工：如 itwind 的事件归并和改稿，是下游的处理逻辑，订阅采集记录即可。
- 浏览器渲染、验证码识别这类重型抓取：交给外部采集器（§5.3），模块只定义协议。

```
                ┌──────────── module-collect ────────────┐
采集源 / 任务 ─►│ 调度 ─► 执行 ─► 原始记录 ─► 清洗 ─► 投递 │──► content（草稿）
  内置抓取器 ───┤                  ▲                     │──► comment（导入评论）
  外部采集器 ───┤── 记录上报 API ──┘                     │──► 产品模块（如 newsroom）
                └─────────────────────────────────────────┘
```

## 2. 核心概念

| 概念 | 说明 |
| --- | --- |
| **记录类型 RecordType** | 采什么：`article`、`comment`、`product`……在代码里注册，定义字段和校验（与 content 的内容类型同一思路）。下游按记录类型订阅 |
| **采集源 Source** | 从哪采：一个站点、一个合作方接口、一个 App 接口。包含站点信息、请求参数（请求头、Cookie、代理）、频率限制、可信度权重 |
| **任务 Task** | 怎么采：属于某个源，指定采集器、入口（列表页、接口地址、关键词）、抽取规则、调度（间隔 / cron / 一次性）、产出的记录类型 |
| **记录 Record** | 采到的一条数据：原始内容 + 按记录类型抽取的结构化字段。按 (source, record_type, origin_id) 去重 |
| **关联 Link** | 记录之间的关系，如「评论 → 所属文章」「图片 → 所属商品」，用原始 ID 表达，下游据此把子记录挂到正确的目标上 |
| **流水线 Pipeline** | 记录入库后的清洗步骤：HTML 白名单、正文抽取、去广告、图片转存、字段规范化、敏感词标记…… 步骤可插拔 |
| **投递 Delivery** | 把记录交给下游：按「记录类型 + 源 / 任务」配置投递规则，经下游注册的投递端口送达，并记录结果 |

## 3. 数据模型

| 表 | 关键字段 |
| --- | --- |
| `collect_sources` | id, code（唯一）, name, site, kind(`crawl`/`partner`/`api`), request（text JSON：请求头、userAgent、Cookie）, rate_limit, timeout_ms, weight, platform_app_id?（等于外部采集器的 appKey 时该采集器可领取 / 上报）, relationship(`partner`/`public`/`internal`), usage_scope（text JSON 数组：`publish` / `reference_only` / `analysis`，空表示不限）, attribution（text JSON：署名与原文链接要求）, upstream_delete_policy(`ignore`/`notify`/`withdraw`，§7.4), enabled, consecutive_failures, remark |
| `collect_tasks` | id, source_id, name, collector(`http-list`/`http-api`/`external`), record_type, entry（text JSON）, rules（text JSON：抽取规则）, rules_version, schedule_kind(`manual`/`interval`/`cron`/`once`), schedule_value, pipeline（text JSON：步骤列表）, enabled, last_run_at, next_run_at, last_status, last_error, consecutive_failures |
| `collect_runs` | id, task_id, source_id, status(`queued`/`running`/`succeeded`/`failed`/`cancelled`), trigger_kind, worker, rules_version, checkpoint（text JSON：断点）, lease_until, heartbeat_at, started_at, finished_at, fetched, created, updated, skipped, failed, error；同一任务同时只有一个 queued / running（部分唯一索引） |
| `collect_run_logs` | id, run_id, level, message, url, created_at（每次运行有条数上限，按保留期清理） |
| `collect_records` | id, source_id, task_id, run_id, rules_version, collector, record_type, origin_id, origin_url, parent_origin_id?, extracted（text JSON：抽取结果）, data（text JSON：清洗后字段）, media（text JSON：原始地址 → fileId）, flags（text JSON 数组）, fingerprint, upstream_state(`present`/`changed`/`removed`), status(`new`/`processed`/`blocked`/`delivered`/`ignored`/`error`), status_reason, version, first_seen_at, last_seen_at, changed_at, checked_at；唯一(source_id, record_type, origin_id) |
| `collect_record_raws` | record_id（主键）, content_type, content, truncated, fetched_at（原始响应存档） |
| `collect_deliveries` | id, record_id, rule_id, sink（投递端口 code）, status(`pending`/`waiting`（等父记录）/`delivered`/`failed`/`skipped`/`withdraw`/`withdrawn`), target_ref?（下游返回的目标，如 content 条目 ID）, attempts, next_attempt_at, reason, stale, delivered_version, delivered_at；唯一(record_id, sink) |
| `collect_rules` | id, name, record_type, source_id（0 = 任意）, task_id（0 = 任意）, sink, filter（text JSON）, params（text JSON）, on_change(`redeliver`/`notify`/`ignore`), sort, enabled |
| `collect_seen_urls` | id, source_id, url_hash, seen_at（增量抓取用，按保留期清理）；唯一(source_id, url_hash) |
| `collect_workers` | id, name, app_key（唯一）, secret, enabled, last_seen_at, last_ip, remark（外部采集器 / 合作方推送凭据） |

- 所有 JSON 字段都存 `text` 列（序列化字符串），不用 jsonb：框架的行映射只支持基本类型（套件统一约定）。需要在 SQL 里取值时临时 `::jsonb`。
- **来源信息**：每条记录都能追溯到来源、任务、运行、规则版本、原始地址和采集时间；来源上的关系、用途范围、署名要求随记录一起交给下游，由下游写入自己的数据（例如 content 的来源字段）。
- 原始响应体（HTML、JSON）不进主表，按开关（`collect.raw.keep`，上限 `collect.raw.max_kb`，超出截断）存到本模块的 `collect_record_raws` 表，便于抽取规则调整后排查与重放。原设想的「存 infra 文件服务只留引用」未采用。
- 同一条记录再次采到时比较 fingerprint：没变化只更新 `last_seen_at`；有变化就更新字段、重新跑流水线，并按投递规则决定是否再次投递（例如文章更正、评论点赞数变化）。

## 4. 记录类型

```kotlin
// contract.collect
CollectRecordTypeDefinition(
    code = "comment",
    name = "评论",
    fields = listOf(
        field("content", CollectFieldType.TEXT, required = true, maxLength = 10_000),
        field("authorName", CollectFieldType.TEXT),
        field("authorAvatar", CollectFieldType.URL),
        field("publishedAt", CollectFieldType.DATETIME),
        field("likes", CollectFieldType.INT),
        field("ipRegion", CollectFieldType.TEXT),
        field("replyToOriginId", CollectFieldType.TEXT),   // 盖楼：回复的是哪条原始评论
        field("replyToAuthorName", CollectFieldType.TEXT), // 来源把回复都挂在楼主下、只在正文里点名（「回复 某某 :」）时，被回复的人
    ),
    parentType = "article",                                 // 评论属于某篇文章
)
```

字段类型 `CollectFieldType`：`TEXT`、`HTML`、`URL`、`URL_LIST`、`TEXT_LIST`、`INT`、`DATETIME`、`BOOLEAN`、`JSON`。注册表 `CollectRecordTypeRegistry`（契约子工程里定义；collect 在 bootstrap 里 `bindIfAbsent`，产品模块用同一份实例 `register`；装配期可变，`seal` 后只读）。

内置三种：`article`（标题、摘要、正文 HTML、作者、发布时间、封面、图片、标签、原文链接）、`comment`（如上）、`media`（图片 / 视频地址、尺寸、时长）。产品可以注册 `product`、`price`、`rank_entry` 等。

## 5. 采集执行

### 5.1 内置抓取器（在服务端进程内运行，适合大多数站点）

| 采集器 | 用途 |
| --- | --- |
| `http-list` | 抓列表页，按规则提取文章链接，增量抓取新链接对应的详情页 |
| `http-api` | 调 JSON 接口（列表 / 详情 / 评论），按 JSONPath 映射字段，支持翻页和签名参数模板 |
| `feed` | RSS / Atom（延后，未实现） |
| `external` | 不在进程内抓：任务由外部采集器领取（§5.3）；合作方主动推送也走上报接口 |

- 抽取规则：CSS 选择器（`sel@attr` / `sel@html`）、JSONPath、正则，可以组合；提供「通用正文抽取」兜底（只补缺失的 title / 正文 / 发布时间）。XPath 延后。
- 请求：频率与超时按源限制；失败指数退避（兼顾 Retry-After）；响应体上限 `collect.http.max_body_kb`。代理池延后。
- 调度由 neton-jobs 驱动：`collect-scheduler`（10 秒，单节点）按 `next_run_at` 建运行并按时间片推进（`collect.run.slice_seconds`、`collect.run.max_per_tick`）；同一任务同一时间只运行一个实例（`collect_runs` 部分唯一索引）。

### 5.2 断点与重试

- 任务按页或按批推进，每推进一步写一次 checkpoint（游标、页码、最后处理的原始 ID）；运行中断（进程重启、租约过期）后，下次从 checkpoint 继续，不从头再抓。
- 单个请求失败按指数退避重试；整次运行失败计入 `consecutive_failures`，连续失败超过 `collect.task.auto_pause_failures`（默认 5）自动暂停任务（告警延后）。
- 记录级失败（解析失败、流水线某步失败）不影响同批其他记录，失败记录可以在后台单条重放。

### 5.3 外部采集器（独立进程，适合需要浏览器渲染、App 协议、复杂反爬的站点）

外部采集器可以用任何语言和框架（Scrapy、Crawlee、Playwright、自写脚本），按下面的协议和模块对接：

| 接口 | 说明 |
| --- | --- |
| `POST /platform/collect/task/lease` | 领取到期任务（body：max, leaseSeconds?），返回 runId、任务定义、规则、源请求参数、上次断点、租约到期时间 |
| `POST /platform/collect/task/heartbeat` | 续租（body：runId, checkpoint?, stats?, leaseSeconds?） |
| `POST /platform/collect/record/batch` | 上报记录（批量，按记录类型校验；可带 parentOriginId、removed 表示上游删除） |
| `POST /platform/collect/task/complete` | 上报运行结果（body：runId, status = `succeeded`/`failed`, error?, checkpoint?, stats?） |

开放分组由框架挂在 `/platform` 前缀下（不是 `/open`）。

- **鉴权**：collect 自有 HMAC 方案，凭据在本模块的 `collect_workers` 表（套件模块不依赖 platform 模块的实现、不读别人的表）。请求头：
  - `X-Collect-Key`：appKey
  - `X-Collect-Timestamp`：Unix 秒；与服务器偏差超过 `collect.open.signature_skew_seconds`（默认 300）拒绝
  - `X-Collect-Nonce`：每次不同，8..64 字符；偏差窗口内只能用一次（有 Redis 用 Redis，否则进程内）
  - `X-Collect-Signature`：`hex(HMAC-SHA256(secret, "METHOD\nPATH\nTIMESTAMP\nNONCE\n" + hex(SHA256(body))))`，PATH 为完整路径（如 `/platform/collect/task/lease`），不含查询串
- 采集器只能领取 / 上报 `collect_sources.platform_app_id` 等于自己 appKey 的源。
- 租约（默认 `collect.open.lease_seconds` = 300 秒）到期未续约的任务回到队列，由其他采集器接手。
- 合作方主动推送也走 `record/batch`，只是没有领任务这一步。

## 6. 清洗流水线

记录入库后按任务配置的步骤依次处理（任务未配置时默认 `html-sanitize` → `normalize` → `text-extract` → `policy-check`）：

| 步骤 | 作用 |
| --- | --- |
| `html-sanitize` | HTML 白名单（段落、标题、图片、引用、列表、代码、表格），去掉脚本、样式、统计标记 |
| `readability` | 通用正文抽取（延后；P1 由抽取阶段的通用兜底代替） |
| `strip-boilerplate` | 去掉「来源：」「责任编辑」、推广尾巴等按源配置的固定片段（延后） |
| `media-localize` | 图片经 infra `MediaService.importFromUrl` 转存（上传业务类型 `collect.media`：公开可读、jpeg/png/webp/gif、≤20MB、可复用、参与生命周期管理，允许被 `content.cover` / `content.image` / `comment.image` 引用），在记录的 media 里保存原始地址 → fileId；每条记录上限 `collect.media.max_per_record`。视频转存延后 |
| `normalize` | 时间统一为 UTC、相对时间（「3 分钟前」）换算、数字和单位规范化 |
| `text-extract` | 生成纯文本（给搜索、embedding、比对用） |
| `dedupe-content` | 按内容相似度标记跨源重复（只标记，是否合并由下游决定；延后） |
| `policy-check` | 投递前的策略检查：必填字段完整性、敏感词标记（`collect.policy.sensitive_words`）；不通过的记录标记为 `blocked` 并说明原因。来源用途范围与端口用途的匹配在投递时检查（不满足的投递记为 `skipped`，原因 `POLICY_USAGE_SCOPE_DENIED`） |

步骤可扩展（契约 `contract.collect`）：

```kotlin
interface CollectPipelineStep {
    val code: String
    suspend fun process(record: CollectPipelineRecord): CollectStepOutcome   // Continue / Block(reason) / Fail(error)
}
class CollectPipelineRegistry { fun register(step: CollectPipelineStep); fun get(code: String); fun codes() }
```

`CollectPipelineRecord` 带 recordId、recordType、sourceCode、originId、originUrl、可原地修改的 fields 与 media、usageScope、flags、任务级 options。产品在 bootstrap 里取同一份 `CollectPipelineRegistry`（`bindIfAbsent`）注册自己的步骤。`Block` 使记录为 `blocked`、`Fail` 使记录为 `error`，保留错误信息，可以在后台重放。

## 7. 投递

### 7.1 投递端口（下游模块实现）

```kotlin
interface CollectSink {
    val code: String                        // 如 "content.draft"、"comment.import"
    val acceptTypes: Set<String>            // 能接收的记录类型
    /** 幂等：同一条记录重复投递时更新而不是新建。返回下游目标引用，供子记录关联使用。 */
    suspend fun deliver(record: CollectRecordView, params: JsonObject): DeliveryResult
    /** 撤回由这条记录产生的下游对象（上游删除且策略为 withdraw 时调用）。不支持返回 false。 */
    suspend fun withdraw(record: CollectRecordView, params: JsonObject): Boolean = false
}

class CollectSinkRegistry {
    fun register(sink: CollectSink, usage: String = CollectUsage.PUBLISH, supportsWithdraw: Boolean = false, name: String = sink.code)
    fun get(code: String): Registration?
    fun all(): List<Registration>
}
```

- `DeliveryResult`：`Delivered(targetRef)` / `Skipped(reason)` / `Retry(afterMillis, reason)` / `Failed(error)` / `Rejected(code, detail?)`。端口必须把**下游拒绝**和**暂时性故障**分开：
  - `Rejected`：下游不接受这条记录（校验不过、内容被拦截、目标不可编辑、端口参数写错），原样重投结果不会变。投递直接进入 `failed`（次数 +1，reason = 错误码），不再自动重试。
  - `Failed` / `Retry`：网络、下游不可用、依赖未就绪、冲突、限流、内部错误，按退避重试。
  - 端口抛出的异常按同一口径归类：`HttpException` 的错误码属于参数段（10100–10199）、`OPERATION_NOT_ALLOWED` 或业务段（≥ 20000）算 `Rejected`，其余算 `Failed`。
- `CollectRecordView`：recordId, sourceCode, sourceName, recordType, originId, originUrl, parentTargetRef（父记录在同一端口的投递结果）, data, media（原始地址 → fileId）, relationship, usageScope, attribution, collectedAt。
- 端口用途 `CollectUsage`：`publish` ⊃ `reference_only` ⊃ `analysis`；来源 `usage_scope` 不包含端口用途时不投递。
- 注册表在契约子工程里定义，collect `bindIfAbsent` 后注册内置端口，产品模块取同一份实例注册自己的端口（只依赖契约）；`seal` 后只读。
- 投递由 `collect-delivery` 任务（10 秒，单节点）执行；暂时性失败按退避重试，超过 `collect.delivery.max_attempts`（默认 8）进入失败列表；下游拒绝不占用重试，直接进入失败列表。失败列表可以在后台单条或批量重投（次数清零、回到 `pending`），通常在改了数据或下游配置（如评论长度上限）之后。

### 7.2 投递规则

`collect_rules` 决定「哪些记录投给谁、带什么参数」，例如：

| 记录类型 | 条件 | 投递给 | 参数 |
| --- | --- | --- | --- |
| article | 源 = 合作媒体 A | `content.draft` | 栏目 = 手机，作者署名 = 来源名，需审核 |
| article | 任意源 | `newsroom.material`（itwind） | — |
| comment | 父文章已投递 | `comment.import` | 挂到父文章对应的 content 条目；每篇最多 30 条；按点赞数取前若干 |

一条记录可以同时命中多条规则，投给多个下游（同一记录同一端口只有一条投递，唯一(record_id, sink)）。规则的 `on_change` 决定记录变化后 `redeliver`（重新投递）/ `notify`（仅标记）/ `ignore`。

### 7.3 默认进入草稿或审核

投递端口默认把记录写成**草稿或待审**。抓取成功不等于允许发布；是否免审只由目标模块的发布策略决定（例如 content 的 `ContentPublishPolicy`），collect 不能替目标模块做发布决定。

### 7.4 来源更新与上游删除

| 上游变化 | 检测方式 | 处理 |
| --- | --- | --- |
| 内容更新 | 重新采到同一 origin_id，fingerprint 变化 | 记录更新为 `changed`，按投递规则决定：重新投递（目标模块生成新版本，仍走审核）或仅提示 |
| 上游删除 / 下架 | `collect-upstream-recheck` 任务（缺省关闭，`collect.recheck.enabled`；间隔 `collect.recheck.interval_hours`）复查已投递文章的原文地址 404 / 410，或合作方在 `record/batch` 里推送删除 | 记录标记 `removed`，按来源的 `upstream_delete_policy` 处理：`ignore`（不处理）、`notify`（通知编辑）、`withdraw`（调用目标模块的撤回接口） |

目标模块需要在投递端口里提供对应的「撤回由本记录产生的对象」能力，否则 `withdraw` 策略不可选。

### 7.5 父子关联

到期的投递按记录的**原始发布时间**依次处理：下游按收到的先后编号（评论楼层），所以收到的顺序必须跟来源的时间一致，而不是站点列表的顺序（IT之家这类站点最新在前）。文章发布早于它的评论，同一轮里也先于评论送达。

子记录（评论）投递时，模块按 `parent_origin_id` 找到父记录在目标下游的投递结果（`target_ref`），作为子记录的投递目标。父记录还没投递时子记录以 `waiting` 排队（最长 `collect.delivery.parent_wait_hours`，默认 72 小时），父记录被跳过或下线时子记录随之跳过。

## 8. 各下游的投递端口

| 端口 | 提供方 | 行为 |
| --- | --- | --- |
| `content.draft` | collect 内置（只依赖 content 契约） | 经 `ContentDraftWriter` 写成草稿或待审（按 source + origin_id 幂等），带上来源信息、署名要求与原始发布时间（`originalPublishedAt`，content 首次发布时作为发布时间，见 content 规范 §5.1）；支持撤回由该记录产生的内容；content 的校验 / 状态拒绝记为 `Rejected` |
| `comment.import` | collect 内置（只依赖 comment 契约） | 经 `CommentImporter` 把评论挂到目标对象上（见 comment 规范「导入」一节）；带 `replyToAuthorName` 时在同一楼里按作者名找到被回复的那条（发布不晚于本条的最近一条），找不到就回复楼主；`CommentImportCodes.REJECTIONS` 里的失败（`CONTENT_TOO_LONG`、`CONTENT_REQUIRED`、`AUTHOR_REQUIRED`、`CONTENT_BLOCKED`、`INVALID_*`）记为 `Rejected`，目标或被回复评论不存在、`IMPORT_FAILED` 按退避重试；不支持撤回 |
| `content.media` | module-content | 图片 / 视频记录写进内容图集字段（延后，未实现） |
| 产品自定义 | 如 itwind 的 `newsroom.material` | 记录进入产品自己的加工流程 |

内置端口的对端实现（`ContentDraftWriter`、`CommentImporter`）在投递时才从上下文取；宿主没装对应模块时投递等待重试并写明原因。

### 8.1 事件

| 事件 | 说明 |
| --- | --- |
| `collect.record.processed`（`CollectRecordProcessed`，主体 `collect.record`） | 一条记录清洗完成，带 recordType、sourceCode、originId、change（`created` / `changed` / `removed`）、status。在 collect 事务里发布，已登记到 `SerializerDomainEventCodec`；AI 加工等下游订阅它即可 |

## 9. 后台（neton-application-front-collect）

- **源与任务**：创建源、任务；立即运行、暂停。
- **规则调试**：填一个地址和规则，实时看抽取结果（`/admin/collect/debug/test`）。
- **运行监控**：每次运行的抓取数、新增、更新、跳过、失败，错误日志；按源统计成功率。
- **记录浏览**：按类型、源、状态查询，看原始内容和抽取结果，单条重新处理或重投。
- **投递规则与投递记录**：规则配置、投递结果、失败重投。
- **外部采集器**：凭据管理（新建、重置密钥、停用）、最近在线时间与 IP、领取过的运行。

## 10. 权限点

命名 `collect:<resource>:<action>`，资源段与后台路由段（`/admin/collect/<resource>/…`）一致；全部写在 V001 菜单种子里，默认授予 `super_admin`。

| 资源 | 页面（type=2） | 按钮（type=3） | 接口 |
| --- | --- | --- | --- |
| source | `collect:source:query` | `collect:source:create` / `update` / `delete` | `page`、`simple-list`、`get/{id}`、`create`、`update`、`update-status/{id}`、`delete/{id}` |
| task | `collect:task:query` | `collect:task:create` / `update` / `delete` / `run` | 同上 + `options`、`run/{id}` |
| run | `collect:run:query` | `collect:run:cancel` | `page`、`get/{id}`、`stats`、`cancel/{id}` |
| record | `collect:record:query` | `collect:record:update` / `reprocess` / `redeliver` | `page`、`get/{id}`、`update/{id}?action`、`reprocess/{id}`、`redeliver/{id}` |
| rule | `collect:rule:query` | `collect:rule:create` / `update` / `delete` | `page`、`options`、`get/{id}`、`create`、`update`、`update-status/{id}`、`delete/{id}` |
| delivery | `collect:delivery:query` | `collect:delivery:retry` | `page`、`retry/{id}`、`retry-failed` |
| worker | `collect:worker:query` | `collect:worker:create` / `update` / `delete` | `page`、`get/{id}`、`runs/{id}`、`create`、`update`、`reset-secret/{id}`、`update-status/{id}`、`delete/{id}` |
| debug | `collect:debug:query` | `collect:debug:test` | `options`、`test` |

开放接口（§5.3）不走权限点，走 HMAC 签名。

## 11. 分期

| 期 | 内容 |
| --- | --- |
| P1（已实现） | 记录类型（article、comment、media）、源、任务、`http-list` / `http-api` 抓取器、外部采集器协议、记录去重、流水线（sanitize、normalize、text-extract、media-localize、policy-check）、投递规则与端口、父子关联、上游删除复查、原始响应存档与重放、规则在线调试、后台全部页面 |
| P2 | 跨源重复标记、代理池、`feed`、XPath、`readability` / `strip-boilerplate`、视频转存 |
| P3 | 更多记录类型与采集器、采集质量报表 |
