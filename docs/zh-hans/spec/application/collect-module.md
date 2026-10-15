# module-collect 通用采集模块

> 标识：NETON-APP-COLLECT
> 日期：2026-10-15 · 状态：Draft r2（对齐套件架构 r2：接入流程、来源信息、断点恢复、上游同步、媒体标准）
> 仓库：`neton-application-module-collect`（服务端）、`neton-application-front-collect`（后台页面）
> 一个模块管理所有采集：文章、评论、商品、视频、榜单……采到的东西经「投递端口」交给需要它的模块（content、comment 或产品自己的模块）。

## 1. 目标与边界

collect 是**内容接入流程**，不直接写任何模块的表：

> 采集 → 原始记录 → 清洗与映射 → 去重 → 策略检查 → 调用目标模块的契约接口入库

**负责**：采集源、采集任务与调度、采集执行（内置抓取器 + 外部采集器）、原始记录的存储与去重、清洗流水线、记录之间的关联、按规则投递给下游模块、投递结果回写、运行监控。

**不负责**：
- 采到之后怎么用：文章变成什么样的稿件、评论挂到哪篇文章，由下游模块的投递端口决定。
- AI 加工：如 itwind 的事件归并和改稿，是下游的处理逻辑，订阅采集记录即可。
- 浏览器渲染、验证码识别这类重型抓取：交给外部采集器（§5.2），模块只定义协议。

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
| **记录 Record** | 采到的一条数据：原始内容 + 按记录类型抽取的结构化字段。按 (source, origin_id) 去重 |
| **关联 Link** | 记录之间的关系，如「评论 → 所属文章」「图片 → 所属商品」，用原始 ID 表达，下游据此把子记录挂到正确的目标上 |
| **流水线 Pipeline** | 记录入库后的清洗步骤：HTML 白名单、正文抽取、去广告、图片转存、字段规范化、敏感词标记…… 步骤可插拔 |
| **投递 Delivery** | 把记录交给下游：按「记录类型 + 源 / 任务」配置投递规则，经下游注册的投递端口送达，并记录结果 |

## 3. 数据模型

| 表 | 关键字段 |
| --- | --- |
| `collect_sources` | id, code, name, site, kind(`crawl`/`partner`/`api`), request(jsonb：请求头、代理、Cookie 引用), rate_limit, weight, platform_app_id?（合作方推送用的 appKey）, relationship(`partner`/`public`/`internal`), usage_scope(jsonb：允许的用途，如 `publish` / `reference_only` / `analysis`), attribution(jsonb：署名与原文链接要求), upstream_delete_policy（§7.4）, enabled |
| `collect_tasks` | id, source_id, collector（采集器 code）, record_type, entry(jsonb), rules(jsonb：抽取规则), schedule, pipeline(jsonb：步骤列表), enabled, last_run_at, next_run_at, last_error |
| `collect_runs` | id, task_id, status(`queued`/`running`/`succeeded`/`failed`/`cancelled`), worker, rules_version, checkpoint(jsonb：断点), started_at, finished_at, fetched, created, updated, skipped, failed, log_ref |
| `collect_records` | id, source_id, task_id, run_id, rules_version, record_type, origin_id（与 source_id 联合唯一）, origin_url, parent_origin_id?, data(jsonb：结构化字段), media(jsonb：已转存的 MediaRef 与原始地址对照), raw_ref?（原始响应存档）, fingerprint（内容摘要，判断是否变化）, upstream_state(`present`/`changed`/`removed`), status(`new`/`processed`/`blocked`/`delivered`/`ignored`/`error`), first_seen_at, last_seen_at |
| `collect_deliveries` | id, record_id, sink（投递端口 code）, status(`pending`/`delivered`/`failed`/`skipped`), target_ref?（下游返回的目标，如 content 条目 ID）, attempts, error, delivered_at |
| `collect_rules` | id, record_type, source_id?, task_id?, sink, filter(jsonb), params(jsonb), enabled |
| `collect_seen_urls` | source_id, url_hash, seen_at（增量抓取用，按保留期清理） |

- **来源信息**：每条记录都能追溯到来源、任务、运行、规则版本、原始地址和采集时间；来源上的关系、用途范围、署名要求随记录一起交给下游，由下游写入自己的数据（例如 content 的来源字段）。
- 原始响应体（HTML、JSON）不进主表，按开关存到 infra 文件服务并只留引用，便于抽取规则调整后重放。
- 同一条记录再次采到时比较 fingerprint：没变化只更新 `last_seen_at`；有变化就更新字段、重新跑流水线，并按投递规则决定是否再次投递（例如文章更正、评论点赞数变化）。

## 4. 记录类型

```kotlin
RecordTypeDefinition(
    code = "comment",
    fields = listOf(
        field("content", TEXT, required = true),
        field("authorName", TEXT),
        field("authorAvatar", URL),
        field("publishedAt", DATETIME),
        field("likes", INT),
        field("ipRegion", TEXT),
        field("replyToOriginId", TEXT),   // 盖楼：回复的是哪条原始评论
    ),
    parentType = "article",               // 评论属于某篇文章
)
```

内置三种：`article`（标题、摘要、正文 HTML、作者、发布时间、封面、图片、标签、原文链接）、`comment`（如上）、`media`（图片 / 视频地址、尺寸、时长）。产品可以注册 `product`、`price`、`rank_entry` 等。

## 5. 采集执行

### 5.1 内置抓取器（在服务端进程内运行，适合大多数站点）

| 采集器 | 用途 |
| --- | --- |
| `http-list` | 抓列表页，按规则提取文章链接，增量抓取新链接对应的详情页 |
| `http-api` | 调 JSON 接口（列表 / 详情 / 评论），按 JSONPath 映射字段，支持翻页和签名参数模板 |
| `feed` | RSS / Atom |
| `push` | 不主动抓：合作方按记录格式调用上报接口推送 |

- 抽取规则：CSS 选择器、XPath、JSONPath、正则；可以组合，提供「通用正文抽取」兜底。
- 请求：并发和频率按源限制；失败指数退避；支持代理池（引用配置，不在规则里写明文凭据）。
- 调度由 neton-jobs 驱动，同一任务同一时间只运行一个实例（多实例部署时加分布式锁）。

### 5.2 断点与重试

- 任务按页或按批推进，每推进一步写一次 checkpoint（游标、页码、最后处理的原始 ID）；运行中断（进程重启、租约过期）后，下次从 checkpoint 继续，不从头再抓。
- 单个请求失败按指数退避重试；整次运行失败计入源的健康度，连续失败超过阈值自动暂停任务并告警。
- 记录级失败（解析失败、流水线某步失败）不影响同批其他记录，失败记录可以在后台单条重放。

### 5.3 外部采集器（独立进程，适合需要浏览器渲染、App 协议、复杂反爬的站点）

外部采集器可以用任何语言和框架（Scrapy、Crawlee、Playwright、自写脚本），按下面的协议和模块对接：

| 接口 | 说明 |
| --- | --- |
| `POST /open/collect/task/lease` | 领取到期任务（带租约时长），返回任务定义与规则 |
| `POST /open/collect/task/heartbeat` | 续租 |
| `POST /open/collect/record/batch` | 上报记录（批量，按记录类型校验） |
| `POST /open/collect/task/complete` | 上报运行结果和错误 |

- 每个外部采集器是 platform 模块里的一个应用，用 appKey 签名鉴权；可以限定它能领取哪些源的任务。
- 租约到期未续约的任务回到队列，由其他采集器接手。
- 合作方主动推送也走 `record/batch`，只是没有领任务这一步。

## 6. 清洗流水线

记录入库后按任务配置的步骤依次处理：

| 步骤 | 作用 |
| --- | --- |
| `html-sanitize` | HTML 白名单（段落、标题、图片、引用、列表、代码、表格），去掉脚本、样式、统计标记 |
| `readability` | 通用正文抽取（列表页规则没给正文时） |
| `strip-boilerplate` | 去掉「来源：」「责任编辑」、推广尾巴等按源配置的固定片段 |
| `media-localize` | 图片和视频经 infra 媒体标准转存（上传业务类型 `collect.media`），在记录的 media 里保存原始地址与 MediaRef 的对照；下游拿到的是 MediaRef，不是外链 |
| `normalize` | 时间统一为 UTC、相对时间（「3 分钟前」）换算、数字和单位规范化 |
| `text-extract` | 生成纯文本（给搜索、embedding、比对用） |
| `dedupe-content` | 按内容相似度标记跨源重复（只标记，是否合并由下游决定） |
| `policy-check` | 投递前的策略检查：来源用途范围是否允许该投递（如 `reference_only` 的记录不能投给会直接发布的端口）、敏感词标记、必填字段完整性；不通过的记录标记为 `blocked` 并说明原因 |

步骤可扩展：`CollectPipelineStep` 接口，产品可以注册自己的步骤。某一步失败时记录状态为 `error`，保留错误信息，可以在后台重放。

## 7. 投递

### 7.1 投递端口（下游模块实现）

```kotlin
interface CollectSink {
    val code: String                        // 如 "content.draft"、"comment.import"
    val acceptTypes: Set<String>            // 能接收的记录类型
    /** 幂等：同一条记录重复投递时更新而不是新建。返回下游目标引用，供子记录关联使用。 */
    suspend fun deliver(record: CollectRecordView, params: JsonObject): DeliveryResult
}
```

- `DeliveryResult`：`Delivered(targetRef)` / `Skipped(reason)` / `Retry(after)` / `Failed(error)`。
- 失败按退避重试，超过次数进入失败列表，可以在后台手动重投。

### 7.2 投递规则

`collect_rules` 决定「哪些记录投给谁、带什么参数」，例如：

| 记录类型 | 条件 | 投递给 | 参数 |
| --- | --- | --- | --- |
| article | 源 = 合作媒体 A | `content.draft` | 栏目 = 手机，作者署名 = 来源名，需审核 |
| article | 任意源 | `newsroom.material`（itwind） | — |
| comment | 父文章已投递 | `comment.import` | 挂到父文章对应的 content 条目；每篇最多 30 条；按点赞数取前若干 |

一条记录可以同时命中多条规则，投给多个下游。

### 7.3 默认进入草稿或审核

投递端口默认把记录写成**草稿或待审**。抓取成功不等于允许发布；是否免审只由目标模块的发布策略决定（例如 content 的 `ContentPublishPolicy`），collect 不能替目标模块做发布决定。

### 7.4 来源更新与上游删除

| 上游变化 | 检测方式 | 处理 |
| --- | --- | --- |
| 内容更新 | 重新采到同一 origin_id，fingerprint 变化 | 记录更新为 `changed`，按投递规则决定：重新投递（目标模块生成新版本，仍走审核）或仅提示 |
| 上游删除 / 下架 | 定期复查已投递记录的原始地址（404、内容被替换）或合作方推送删除通知 | 记录标记 `removed`，按来源的 `upstream_delete_policy` 处理：`ignore`（不处理）、`notify`（通知编辑）、`withdraw`（调用目标模块的撤回接口） |

目标模块需要在投递端口里提供对应的「撤回由本记录产生的对象」能力，否则 `withdraw` 策略不可选。

### 7.5 父子关联

子记录（评论）投递时，模块按 `parent_origin_id` 找到父记录在目标下游的投递结果（`target_ref`），作为子记录的投递目标。父记录还没投递时子记录排队等待，父记录被跳过或下线时子记录随之跳过。

## 8. 各下游的投递端口

| 端口 | 提供方 | 行为 |
| --- | --- | --- |
| `content.draft` | module-content | 经 `ContentDraftWriter` 写成草稿或待审（按 source + origin_id 幂等），带上来源信息与署名要求；支持撤回由该记录产生的内容 |
| `comment.import` | module-comment | 经评论导入端口把评论挂到目标对象上（见 comment 规范「导入」一节） |
| `content.media` | module-content | 图片 / 视频记录写进内容图集字段 |
| 产品自定义 | 如 itwind 的 `newsroom.material` | 记录进入产品自己的加工流程 |

## 9. 后台（neton-application-front-collect）

- **源与任务**：创建源、任务；在线调试抽取规则（填一个地址，实时看抽取结果）；立即运行、暂停。
- **运行监控**：每次运行的抓取数、新增、更新、跳过、失败，错误日志；按源统计成功率。
- **记录浏览**：按类型、源、状态查询，看原始内容和抽取结果，单条重新处理或重投。
- **投递规则与投递记录**：规则配置、投递结果、失败重投。
- **外部采集器**：在线状态、领取中的任务、最近上报。

## 10. 权限点

`collect:source:manage`、`collect:task:manage`、`collect:task:run`、`collect:record:view`、`collect:rule:manage`、`collect:delivery:retry`、`collect:worker:manage`。

## 11. 分期

| 期 | 内容 |
| --- | --- |
| P1 | 记录类型（article、comment）、源、任务、`http-list` / `http-api` 抓取器、外部采集器协议、记录去重、基础流水线（sanitize、normalize、text-extract）、投递规则与端口、父子关联、后台源 / 任务 / 记录 / 运行页面 |
| P2 | 规则在线调试、图片转存、原始响应存档与重放、跨源重复标记、代理池、`feed` |
| P3 | 更多记录类型与采集器、采集质量报表 |
