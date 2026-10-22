# module-site 站点发布：渲染缓存失效与搜索引擎推送

> 标识：NETON-APP-SITE
> 日期：2026-10-22 · 状态：**Accepted r3 · S1 + S2 已实现**（itwind C5 补 S2：搜索引擎推送、CDN 刷新端口与腾讯云 / 阿里云实现、推送记录与额度，module-site 2fd3247、front-site 3601f1e；itwind C2：`neton-application-module-site` d2d0d49、`neton-application-front-site` 339a593；C3 补 S1.1：网页服务就绪、退避上限、expire 回声、评论区刷新 b5cf131；C4 补 S3 的节点事件 U4 与计数筛选 8aed625）。网页服务一侧——失效端点 `/api/site/revalidate`、已删除台账的签名同步客户端、proxy 的 410——已在 C1 随底座实现，接口按本规范）
> 仓库：`neton-application-module-site`（服务端）、`neton-application-front-site`（后台页面）
> 对端：`neton-application-client` 底座的公开路由契约（`docs/spec/public-routes.md`）——标签命名（§8.3）、失效端点（§8.4）、已删除 URL 集合（§7.2）由那份契约定义，本模块是调用方。
> 使用方：[client-content.md](client-content.md)、[client-comment.md](client-comment.md)；样板产品 itwind 的门户。

## 1. 定位

Headless 的内容模块不出页面，网页由宿主自己的 SSR 服务渲染并缓存。对象的**对外可见状态**一变（上线、更新、撤回、删除、评论被隐藏），网页这一侧就要跟着变：缓存要失效、CDN 要刷新、搜索引擎要被告知、删掉的地址要返回 410。

这些副作用对资讯、电商、社区等任何「有网页门户」的平台都一样，作用于任意对象，有自己的数据（推送记录、已删除台账）与生命周期——满足套件的拆分原则（架构 §2.3），做成独立模块；**content、comment 不为网页写任何代码**，本模块只订阅通用对象事件、经 `ObjectResolver` 取链接。

**负责**：

1. 订阅通用对象事件，算出受影响的缓存标签，合并后投递到网页服务的失效端点。
2. 失效成功后经 CDN 端口刷新对应 URL（可选，产品实现端口）。
3. 向搜索引擎推送新增与删除的 URL（百度普通收录、IndexNow）。
4. 维护对象 → URL 台账与已删除 URL 台账，供 410 与删除推送使用。

**不负责**：页面渲染、sitemap 内容（各对象模块提供数据，网页服务生成）、统计分析、SEO 文案。

## 2. 依赖与装配

- 只依赖 system、infra 实现，以及契约库 `contract.core`（`ObjectRegistry`、通用对象事件）。**不依赖** content、comment 的契约子工程。
- 出站 HTTP 一律经框架缺省的自研网络栈（netonstream）客户端；目标地址全部来自部署配置（§8），按出站规范（[egress.md](../egress.md) §1）用应用的普通 `HttpClientProvider`。以后若把任何目标改成后台可配，必须换受控客户端 `GuardedHttpClientProvider`。
- 没装本模块的宿主：网页缓存只靠 TTL 过期，功能正确、只是更新慢；没有 410、没有主动推送。

## 3. 数据模型

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `site_object_urls` | object_type, object_id, url（站内路径）, status（`live` / `unavailable` / `gone`）, first_live_at, changed_at | 唯一(object_type, object_id)。对象第一次上线时经 `ObjectResolver.describe` 取 `link.web` 记下；URL 变化（slug、模板）时更新并把旧 URL 记进 `site_url_history` |
| `site_url_history` | url, object_type, object_id, replaced_at | 旧 URL，供网页服务做 308（与 public-routes §13 的 legacy 互补：这是数据层面的旧地址） |
| `site_pending_tags` | tag, mode（`refresh` / `expire`）, due_at, event_ids（text JSON） | 唯一(tag)。合并窗口：同一标签在窗口内只投递一次，`expire` 覆盖 `refresh` |
| `site_pending_paths` | path, action（`gone` / `revived`）, due_at, event_ids（text JSON） | 唯一(path)。与标签同一合并窗口；动作由台账的最终状态在同一事务里决定（先删后恢复只投递 `revived`） |
| `site_deliveries` | id, batch_id, target, payload（text JSON：items / gone / revived）, tag_count, path_count, event_ids, status（`pending` / `delivered` / `dead`）, attempts, next_attempt_at, last_http_status, last_error, created_at, delivered_at | 投递 outbox：每批每个目标一行，按目标独立重试（§5.1） |
| `site_event_receipts` | event_id, received_at | 按事件 ID 幂等；保留 7 天 |
| `site_dispatch_lease` | name, holder, expires_at | 投递器的单节点租约（15 秒，过半续租） |
| `site_pending_urls`（S2，V003） | url（站内路径）, channel（`cdn:<provider>` / `baidu` / `indexnow:<端点主机>`）, action（`purge` / `prefetch` / `submit` / `delete`）, reason, priority, gate_batch, due_at, status（`pending` / `done` / `dead` / `skipped`）, attempts, next_attempt_at, submission_id, last_error | 每个通道一行的待办；唯一(url, channel, action) WHERE pending（合并）；`gate_batch` = 必须先投递完成的失效批（§5.3），0 = 不等；处理完的行保留 7 天做 24 小时去重 |
| `site_submissions`（S2） | channel, action, url_count, urls（text JSON）, outcome（`accepted` / `quota` / `rejected` / `failed`）, http_status, code, response, remain, task_id, rejected（text JSON：地址 → 原因） | 每次对外请求一行（后台推送记录、重推的来源），保留 30 天 |
| `site_engine_quota`（S2） | channel, day（北京时间日期）, remain, exhausted_until | 当日额度：百度回应的剩余条数；额度用完时停到下一个北京时间 0 点 |

全部经 migrate 建表；JSON 存 `text`（套件约定）。台账只为**有站内页面地址**的对象建行：`link.web` 带 `#` 锚点的嵌入对象（评论）、外站地址、从未见过地址就被删除的对象都不建行（只投递标签）——否则删除一条评论会把文章页记进已删除集合。

## 4. 事件到标签的映射

订阅（均 `RETRYABLE`，按事件 ID 幂等，按 `subjectVersion` 丢弃过期事件）：

| 事件 | 标签（mode） | 台账 | CDN | 搜索引擎 |
| --- | --- | --- | --- | --- |
| `ObjectAvailable`（含首次发布，见 §9 U1） | `obj:{type}:{id}`（refresh）、`feed:{type}`（refresh，合并 10 秒） | `live`；首次时 describe 记 URL | 刷新 URL | 首次上线：`submit`；重新上线：`submit` |
| `ObjectUpdated`（§9 U2） | `obj:{type}:{id}`（refresh） | URL 变了就更新并记历史，旧 URL 进 `site_url_history` | 刷新新旧 URL | URL 变了：新 URL `submit` |
| `ObjectUnavailable(permanent = false)` | `obj:{type}:{id}`（**expire**）、`feed:{type}`（refresh，合并 10 秒） | `unavailable` | 刷新 URL | 无（可能回来） |
| `ObjectUnavailable(permanent = true)` | 同上，`obj` expire | `gone`；投递 `gone: [url]` | 刷新 URL | `delete`（IndexNow 推送该 URL；百度见 §7.1） |
| `ObjectCounterChanged(counter = comments)`（2026-10-22） | `thread:{type}:{id}`（refresh，合并 10 秒） | — | — | — |
| 通用 `NodeChanged`（§9 U4：栏目、频道、楼层、楼层位置） | `node:{nodeType}:{id}`（refresh）；`navigation = true` 时另加 `site:nav`（refresh）；都在 feed 合并窗口（缺省 10 秒）里 | — | 刷新节点页、首页楼层、导航 | — |

- `type` 的取舍：只处理 `ObjectRegistry` 里 `describe` 能给出 `link.web` 的类型，以及显式登记为「无独立页面但影响别的页面」的类型（如 `comment.comment`：没有自己的页面，`link.web` 是所属对象页 + 锚点，CDN 刷新时去掉锚点）。
- `ObjectCounterChanged` 只订阅评论数（`counter = comments`）：评论数变了说明评论区第一页变了（新评论可见、删除、隐藏、审核通过），刷新 `thread:{type}:{id}`，在 feed 窗口里合并——热门文章一分钟几十条评论，评论区也只每 10 秒重渲染一次；评论被隐藏 / 删除另有评论自身的 `ObjectUnavailable`（`obj:comment.comment:{id}` expire，立即生效）。其他计数（收藏、点赞、浏览）不订阅：允许在缓存时效内滞后（public-routes §8.1）。计数事件由评论模块在**自己的事务里**发布；本模块的监听者声明 `RETRYABLE`（事件随评论事务落库、提交后异步投递），site 出错不会让发评论失败、也不占评论事务的耗时（缺省的 SYNC 会把 site 变成评论写入路径上的一环）。其他计数在**发布端**就筛掉（监听者的 `accepts` 只收评论数，C4）：收藏、点赞不为本模块写事件 outbox 行；评论数每次变化一行，合并发生在本模块的待投递标签上（同一 `thread:` 标签在窗口里只留一行）。
- 合并窗口：`obj:` 标签 1 秒（把同一事务里的多个事件合并），`feed:` / `site:nav` 10 秒；可配置。

## 5. 投递

### 5.1 失效端点

- 目标：部署配置 `[revalidate] targets`（可多个，多实例且没有共享缓存时用；有共享缓存只配一个）。
- 请求格式、签名、限额按 public-routes §8.4；单次 ≤ 500 个标签，超出拆批。
- 超时 3 秒；失败按退避重试（1s、5s、15s、30s、60s，之后每 60 秒），超过 24 小时进死信并告警 `site.revalidate.dead`。任一目标失败只重试该目标。上限刻意低（2026-10-22，原为 10 分钟）：失效请求便宜且幂等，网页服务重启的几十秒里积压的批在它回来后一分钟内就投递。
- **网页服务就绪**（2026-10-22）：网页服务启动时、以及连不上后端之后重新连上时，调 `POST /platform/site/target/ready`（§6），该目标待投递行的下次尝试时间拉到现在、退避从头开始（`backoff_attempts` 归零，总尝试次数 `attempts` 保留作排查用），投递器的下一个节拍（250 毫秒）把积压合并成一次请求投出，照常严格按 id 顺序——重启后不再有「最多 10 分钟的旧页面」。
- **expire 回声**（public-routes §8.4 的已知竞态）：一批里有 expire 标签且投递成功后，在该目标队尾补一行只含这些 expire 标签的回声，1 秒后投递，冲掉 expire 到达时正在进行、稍后写回旧数据的后台重渲染；回声自己成功后不再回声。回声排在队尾、按 id 顺序，最多让该目标之后的批晚 1 秒；`target/ready` 不动回声行。
- 端点回 400 / 413（请求不合法、超限）不重试，直接死信（`site.revalidate.rejected`）：重试不会成功。401（两边密钥不一致）、503（端点未配密钥）、5xx、超时都按退避重试——它们是部署层面可恢复的。
- **同一目标严格按 id 顺序投递**（已删除 / 恢复路径的先后决定集合的最终状态）；目标恢复后把连续积压行合并成一次请求（标签 expire 胜出，路径以最后一批为准，`eventId = site.b<首批>-<末批>`），结果与逐批投递相同。
- 后台重投死信：在该目标队尾写新行，标签原样、路径按台账**当前**状态重新决定——不放回原位置，避免把之后已投递的状态退回去。
- 目标从配置里移除后，启动时其待投递行进死信（`TARGET_REMOVED`）。

### 5.2 CDN 端口

```kotlin
// contract.site（本模块的 contract 子工程 :module-site-contract）
interface CdnPurger {
    val provider: String              // 通道名后缀
    val maxUrlsPerRequest: Int
    val supportsPrefetch: Boolean
    suspend fun purge(urls: List<String>): CdnOutcome      // 绝对地址（origin + 站内路径，已去锚点与查询串）
    suspend fun prefetch(urls: List<String>): CdnOutcome
}
sealed interface CdnOutcome { Accepted(taskId) · QuotaExhausted(code) · Rejected(code) · Failed(code) }
```

- 端口返回四类结果而不是「失败的路径」（S2 定稿）：额度用完与请求本身错了不能被当成可重试，否则会被无限重试。
- **内置实现**（部署配置 `[cdn] provider`，不需要产品写代码）：腾讯云 CDN `PurgeUrlsCache` / `PushUrlsCache`（API 3.0，版本 2018-06-06，TC3-HMAC-SHA256；业务错误也回 200，看 `Response.Error.Code`：`LimitExceeded.*DayLimit` = 额度、`InvalidParameter*` / 域名类 = 拒绝、鉴权 / 限频 / 内部错误 = 重试）；阿里云 CDN `RefreshObjectCaches` / `PushObjectCache`（RPC，版本 2018-05-10，V3 签名 ACS3-HMAC-SHA256，参数在查询串；`QuotaExceeded.Refresh` / `.Preload` = 额度、路径 / 参数类 = 拒绝、签名 / 限频 = 重试）。两种签名都按官方文档实现，单测逐字节复现文档示例；本地假服务另用 node 的 crypto 独立校验。
- 产品接内置以外的 CDN（Cloudflare、自建缓存……）：`[cdn] provider = "custom"`，在自己的 bootstrap 里 `ctx.bind(CdnPurger::class, …)`（产品模块排在 site 之后初始化也可以：投递器启动时才取，没绑定启动失败）。
- 不配置 `[cdn]` = 不刷新 CDN，靠 CDN 的短 `s-maxage`（public-routes §8.2a）。
- 每批 ≤ 100 条地址（云厂商单次上限 1000 / 预热 500），通道间隔 `[cdn] interval_ms`（缺省 2 秒）；`prefetch = true` 时首次上线 / 重新上线 / 换地址的页面刷新后再预热一次（预热额度远小于刷新：腾讯云缺省每日 1000 条）。
- 刷新什么：对象页地址（上线、更新、撤回、删除都刷）；地址变了新旧都刷；嵌入对象（评论）被隐藏 / 删除时刷所属页面（`link.web` 去掉锚点）。列表页、首页不逐个刷新——每日额度（腾讯云 / 阿里云缺省 1 万条）经不起每 10 秒一次的 feed 刷新，靠 `list` 档 30 秒的 `s-maxage`。

### 5.3 顺序

同一批变化：**先**失效端点成功，**再**刷新 CDN，**最后**推送搜索引擎。CDN 先刷会让回源拿到 Next 里的旧缓存再缓存一轮；搜索引擎先推会让爬虫抓到旧页面。

实现（S2）：台账在同一事务里为每个通道写待办行（与失效标签同一合并窗口的 `due_at`）；装批之后把到期的行挂到当前最新的失效批上（`gate_batch`；只挂比任何还在等装批的标签 / 路径都早到期的行，保证它所在的窗口已装进批）；挂的批在所有目标上都不再 pending（已投递或死信）才放行——同一目标严格按 id 投递，最新的批投完意味着之前的都投完了。搜索引擎的行另等同一地址的 CDN 刷新完成（成功或进死信）。没开失效投递时不等批。

## 6. 网页服务调用的开放接口

### 6.0 网页服务就绪 `POST /platform/site/target/ready`

- 鉴权：与失效端点同一把共享密钥、同一形状：`X-Neton-Signature: t=<epoch 秒>,v1=hex(HMAC-SHA256(secret, t + "." + 原始请求体))`，时间偏差 300 秒；失败 401 `SIGNATURE_INVALID` / `SIGNATURE_EXPIRED`；没配密钥 503 `SITE_SYNC_DISABLED`。
- 请求体：`{ "target"?: "<与 [revalidate] targets 里完全一致的地址>" }`，省略（或空体、`{}`）= 全部已配置的目标——网页服务不一定知道后端用哪个地址找它，多给别的目标一次立即重试也无害；不认识的地址 400 `SITE_TARGET_UNKNOWN`；体不是对象、`target` 不是字符串 400 `SITE_READY_INVALID`。
- 响应：`{ targets: [地址], rescheduled: 被提前的待投递行数 }`。只改库，任何节点都可以处理；幂等。

### 6.1 已删除台账

`GET /platform/site/gone?since=<epoch 毫秒>&cursor=&limit=1000` → `{ list: [{ url, goneAt }], nextCursor, now }`

- 供网页服务启动与定时增量同步已删除 URL 集合（public-routes §7.2）。
- 鉴权：与失效端点同一把共享密钥的 HMAC 签名（头 `X-Neton-Signature: t=…,v1=…`，签名串为 `t + "." + 请求路径与查询串`），时间偏差 300 秒；模块自带签名，不依赖 platform 模块（套件约定 §5.4）。
- 对象重新上线（`ObjectAvailable`）时从台账移除，并在下一次失效投递里带上 `revived: [url]`。
- 增量取 `gone_at >= since`，键集游标 `(gone_at, id)`；返回的 `now` 比本次查询开始早 5 秒，在途事务稍晚提交的行下一轮仍会取到（重复加入集合是幂等的）。签名串是原始请求路径与查询串（含 `/platform` 前缀）。没配密钥时接口 503 `SITE_SYNC_DISABLED`，不退化成匿名可读。

## 7. 搜索引擎推送

| 引擎 | 方式 | 说明 |
| --- | --- | --- |
| 百度 | 普通收录 API：`POST {endpoint}?site={origin}&token={token}`（生产 endpoint `http://data.zz.baidu.com/urls`，只写在部署配置里），`text/plain`，每行一个 URL，单次 ≤ 2000 | 返回 `{ success, remain, not_same_site, not_valid }`：`remain` 写进当日额度、下一批按它截断，为 0 时停到北京时间 0 点；逐条拒绝的地址进死信（`BAIDU_NOT_VALID` / `BAIDU_NOT_SAME_SITE`）。出错 `{ error, message }`：`over quota` = 额度用完（通道停到 0 点，地址留在队列）；`site error` / `site init fail` / `token is not valid` 是部署问题，退避重试；`empty content` / `only 2000 urls are allowed once` 不重试。新内容优先（priority 0），重新上线与换地址其次（1）；地址没变的更新**不**推百度（额度留给新地址） |
| IndexNow（Bing、Yandex、Seznam、Naver 等） | `POST {endpoint}`（生产 `https://api.indexnow.org/indexnow`），`{ host, key, keyLocation, urlList }`，单次 ≤ 10 000；可配多个端点，每个端点一个独立通道 `indexnow:<主机>` | 新增、更新、删除的 URL 都推（删除的 URL 返回 410，引擎据此移除）；`keyLocation` 是网页服务底座输出的 `/indexnow-key.txt`（必须在 origin 下）。200 / 202 = 收下；400 不重试；403（密钥文件取不到 / 不一致）、422、429 退避重试 |
| Google | 不推送 | Google 的 Indexing API 只用于招聘与直播类页面，资讯站不适用；依靠 sitemap（含 news sitemap）与 Search Console |

### 7.1 删除

- IndexNow：直接推删除的 URL。
- 百度：普通收录 API 不处理删除；网页服务返回 410 是主路径，死链文件由网页服务按已删除台账生成（`/sitemaps/gone.txt`，由产品决定是否提交到百度资源平台的死链工具），本模块不调用百度的其他接口。

### 7.2 去重与节流

- 同一 URL 同一动作对同一搜索引擎 24 小时内只推一次（S2：已完成的行保留 7 天，入队时查 24 小时内有没有完成过）；CDN 刷新不去重。待处理的同一 (url, 通道, 动作) 合并成一行（优先级取高、重新等装批）。
- 推送在投递器里批量进行：每个搜索引擎通道每 `[push] interval_ms`（缺省 30 秒）最多一次请求，一批只含一种动作；失败退避 30 秒、2 分钟、10 分钟、30 分钟、之后每小时，超过 24 小时进死信（`site.push.dead`）。退避比失效投递长：对方限频与额度是按天计的。
- 只推 `status = live` 且与站点 `origin` 同源的 URL（发出前再核对台账：撤回 / 删除后还没推出去的 submit 作废为 `skipped`；delete 只推仍是 gone 的地址）；`link.web` 为空的对象不推。
- 后台重推（`POST submission/resubmit/{id}`）：把一条记录里的地址重新排进同一通道，队首、不等失效批、绕过 24 小时去重；发出前照常核对台账。
- 启动时：配置里去掉的通道，待处理行进死信（`CHANNEL_REMOVED`）。

## 8. 配置

部署配置 `config/site.conf`（不进后台、不进数据库；改了重启生效）：

```toml
[site]
origin = "https://www.example.com"          # 与网页服务的站点配置一致

[revalidate]
targets = "http://web-internal:3000/api/site/revalidate"   # 逗号分隔（框架 TOML 解析器不支持行内数组，与 [egress] 同一写法）
# 共享密钥：环境变量 NETON_SITE_REVALIDATE_SECRET（≥ 32 字节），缺失时本模块不投递并在启动时 WARN site.revalidate.disabled

[push]
interval_ms = 30000

[push.baidu]
enabled = false
endpoint = "http://data.zz.baidu.com/urls"
# token：环境变量 NETON_SITE_BAIDU_TOKEN

[push.indexnow]
enabled = false
endpoints = "https://api.indexnow.org/indexnow"          # 逗号分隔
key_location = "https://www.example.com/indexnow-key.txt"   # 网页服务底座输出（public-routes §11.4）
# key：环境变量 NETON_SITE_INDEXNOW_KEY（与网页服务同一个）

[cdn]
provider = "none"                                         # none | tencent | aliyun | custom
# endpoint = "https://cdn.tencentcloudapi.com/"           # 阿里云 https://cdn.aliyuncs.com/
# area = "mainland"                                       # 腾讯 mainland / overseas / global，阿里 domestic / overseas
prefetch = false
interval_ms = 2000
# 密钥：环境变量 NETON_SITE_CDN_SECRET_ID / NETON_SITE_CDN_SECRET_KEY

[dispatch]
obj_window_ms = 1000
feed_window_ms = 10000
```

- 内网目标（`web-internal`）来自部署配置，用普通客户端，不受 `[egress]` 的公网限制（出站规范 §1）。
- **出站地址没有代码里的缺省**（S2）：开了通道就必须写 `endpoint`，否则启动失败；生产地址只出现在部署配置里，测试与本地联调指向本地假服务（`test-stub/push-fakes.mts`）。通道开着却缺密钥：启动 WARN `site.push.disabled`（带缺的环境变量名），该通道关闭，其余照常。
- 环境覆盖按模块配置规则：`NETON_SITE__SITE__ORIGIN`、`NETON_SITE__REVALIDATE__TARGETS`、`NETON_SITE__DISPATCH__OBJ_WINDOW_MS`……（本地联调用它把目标指向本机门户，生产值只在部署配置里）。
- 后台只读展示当前生效配置（密钥打码）。

## 9. 依赖的上游补齐

按定制三分法属于「缺少通用扩展机制」，需要在对应规范里补齐：

| 编号 | 模块 | 补齐 | 理由 |
| --- | --- | --- | --- |
| U1 | content（及所有对象拥有模块） | 首次发布也发 `ObjectAvailable`（现在只在重新发布时发） | 本模块只订阅通用事件就能处理「上线」 |
| U2 | 契约库 `contract.core` + content | 新增通用事件 `ObjectUpdated`（`object.updated`）：对象的**公开表示**变化时发布（新版本上线、slug 变化、可见性设置变化），不含计数变化 | 不订阅 `content.item.published(revisionUpdate)` 这类模块专属事件 |
| U3（已实现，comment cea7b4b） | comment | 评论隐藏、管理员删除、作者删除时发 `ObjectUnavailable(subject = comment.comment:{id})`（作者删除与管理员删除 `permanent = false`，保留期清理后 `permanent = true`），恢复时 `ObjectAvailable`；`comment.comment` 的 `link.web` = 所属对象的 `link.web` + `#comment-{id}` | 评论区缓存按评论粒度失效（public-routes §8.3） |
| U4（已实现，itwind C4） | 契约库、content（栏目）、filter（频道 / 楼层 / 挂载） | 通用事件 `contract.core.NodeChanged(subject = 节点引用, navigation)`（契约 6aafdc4）：节点不是注册表对象，但沿用 `ObjectRef` 的形状，键与网页端的 `node:{type}:{id}` 一致（频道 / 楼层用 code，放置位置用位置名，栏目用 id）。filter（107d428）在节点增改删（code、位置改了时旧的与新的都发）、挂载 / 换挂 / 卸载、筛选器发布新版本 / 启停时发；content（7ebc0aa）在词条增改删时发（树形分类法 `navigation = true`）。本模块只订阅这一个通用事件，不认识 filter / content | 首页楼层、频道页、栏目导航在合并窗口内失效（实测：后台改首页楼层名，约 11 秒后门户首页出现新名，不再等 `list` 档 30 秒） |
| U5 | 契约库 | `ObjectSummary` 增加可选的 `publishedAt`、`updatedAt` | 台账与推送的时间字段；sitemap 不依赖它 |
| U6 | infra 媒体 | **可缓存的媒体地址**：已由 infra-media §7.3「CDN 地址策略」取代（见下） | 缓存的 HTML、OG 图、图片搜索都不能用 10 分钟签名地址 |
| U7 | account | 公开资料变化（昵称、头像）发 `ObjectUpdated(subject = account.user:{id})` | 评论区、作者页里的头像昵称失效（可选，不做就靠 TTL） |

### 9.1 可缓存的媒体地址（U6，已定）

原提案（每次请求按匿名可见性放行的无签名地址 `GET /app/infra/media/public/{fileId}`）已被产品决定 1 取代，定稿在 **infra-media §7.3「CDN 地址策略」**：

- 文章图片一律用 CDN 地址；是否带令牌取决于部署是否开启 CDN 鉴权。未开启：公开对象上的媒体给稳定地址；开启：按云厂商的鉴权方式（腾讯云 A/B/C/D、阿里云 A/B/C、通用 HMAC 查询令牌）做**按时间桶取整的确定性签名**——同一桶内所有人拿到同一个地址，HTML 与图片照样可缓存。
- 网页服务的页面缓存时长必须短于签名有效期（revalidate ≤ 有效期 / 2，启动时校验，public-routes §8.1，C1 已实现）；长时间打开的标签页由客户端在图片加载失败时换取新地址。
- 私密媒体（会员可见、仅本人）永不出现在公开 HTML 里。
- 本模块与此无直接关系：对象下线后 CDN 上的旧图由签名过期与 CDN 刷新端口（§5.2）兜底。

## 10. 接口

**后台（`/admin/site/*`）**

| 接口 | 权限点 |
| --- | --- |
| `GET delivery/page?status&target`、`GET delivery/get/{id}`（含请求内容） | `site:delivery:query` |
| `POST delivery/retry/{id}`（死信重投，见 §5.1） | `site:delivery:retry` |
| `GET url/page?status&keyword`（含旧地址） | `site:url:query` |
| `GET submission/page?channel&outcome`、`POST submission/resubmit/{id}` | `site:submission:query` / `site:submission:retry`（S2，V003 菜单「推送记录」） |
| `POST revalidate/run` `{ tags, paths, mode }`（手动失效：标签或站内路径，≤ 100 条；路径按台账找对象；任一条不合法整批 400，字段错误 `tags[i]` / `paths[i]`） | `site:revalidate:run` |
| `GET config/get`（只读，密钥打码；S2 起带各推送通道的待处理 / 死信数、当日剩余额度与停推时刻、因缺密钥关闭的通道） | `site:config:query` |

权限点全部进后台菜单种子（页面 type=2 用 query，其余按钮 type=3），默认授予 `super_admin`。

**开放（`/platform/site/…`）**：`GET gone`（§6.1）、`POST target/ready`（§6.0）。

## 11. 验收

- 发布一篇文章：1 秒内失效端点收到 `obj:` 与（10 秒内）`feed:`；网页服务的详情页与栏目页随后更新；百度、IndexNow 各收到一次推送，记录可在后台看到。
- 撤回：详情页立即 404（`expire`），栏目页 10 秒内不再出现该条；不推送删除。
- 彻底删除：详情页 410；IndexNow 收到删除推送。
- 评论被管理员隐藏：包含它的评论区缓存失效，对象页 CDN 刷新。
- 失效端点宕机 10 分钟后恢复：积压的标签按合并后的结果投递完，无重复副作用。
- 全部用真库、真实模块装配的测试覆盖（失效端点用测试桩）。
- S2 验收（itwind C5 端到端，本地假服务，2026-10-22）：发布约 2 秒后假的腾讯云 CDN 收到刷新与预热、百度与 IndexNow 收到新地址，CDN 刷新早于两者、失效批投递早于 CDN 刷新；撤回只刷 CDN；删除后 410、`/sitemaps/gone.txt` 与 `gone.xml` 列出该地址、CDN 刷新、IndexNow 收到该地址；评论被隐藏后文章页 CDN 刷新；百度回 `over quota` 后通道停到下一个北京时间 0 点、地址留在队列、IndexNow 照常。

## 12. 分期

| 期 | 内容 |
| --- | --- |
| S1 | 台账、事件订阅（U1、U2、U3 落地后）、失效投递、已删除台账接口、后台查询 — **已实现**（真库测试 14 项：映射、合并、expire 胜出、幂等与过期事件、嵌入对象、旧地址、删除 / 恢复与台账接口签名与增量、宕机退避与积压合并、死信与重投、租约、经底座校验代码的真实 HTTP 投递） |
| S1.1（itwind C3，2026-10-22） | 网页服务就绪接口 `target/ready`、退避上限 60 秒、expire 回声、评论数 → `thread:` 刷新；U3 由 comment 落地（隐藏 / 删除 / 恢复 / 折叠发通用事件，评论 `link.web` 带锚点）— **已实现**（真库测试 17 项，新增：回声只投一次、评论区刷新合并、网页服务重启后 ready 立即追平积压且顺序正确、退避封顶） |
| S2（itwind C5） | 搜索引擎推送（百度、IndexNow）、CDN 端口与腾讯云 / 阿里云实现、推送记录与额度、后台推送记录页 — **已实现**（单测：两份官方签名示例逐字节复现、三家回应分类、配置校验；真库测试 6 项：失效 → CDN → 搜索引擎的顺序（失效端点宕机时 CDN 不动）、各种变化到通道的映射与 24 小时去重、百度额度截批与停到北京时间 0 点后继续、逐条拒绝 / 请求错误 / 退避与 24 小时死信 / 后台重推 / 通道退役、不开失效投递时不等批、经真实 HTTP 的本地假服务独立校验签名与格式；itwind c5 端到端 11 项） |
| S3.1（itwind C4，2026-10-22） | 节点事件（U4，`SiteNodeListener`，listenerId `site.node-on-changed`）；评论数监听者在发布端筛掉别的计数（框架 `DomainEventListener.accepts`，neton 91efbc2）：收藏 / 点赞不再为本模块写待投递事件行 — **已实现**（真库测试 19 项，新增：节点与导航在合并窗口内合并投递、经真实总线 + infra 待投递表只有评论数留下一行） |
| S3 | 资料事件（U7）；U6 改由 infra-media §7.3 实现（随 itwind C2） |

## 13. 开放项

| 项 | 决议 |
| --- | --- |
| 渲染服务调后端匿名只读接口时的限流归属：所有可缓存渲染都来自同一个出口 IP | **已决（产品决定 8）**：匿名、可缓存的只读接口（详情、列表、栏目树、频道 / 楼层）不按 IP 限流——按 IP 限流等于所有访客一起被限；滥用防护在边缘（CDN / nginx）。搜索与写接口按真实客户端 IP 限流：网页服务的 `dynamic` 路由转发 X-Forwarded-For，后端只在对端属于 `ratelimit.trusted_proxies`（Next 出口）时信它（public-routes §5）。filter 已落地（module-filter 0e6955d，filter-module §10.6）；content、comment 随 C2、C3 |
| 删除、下线、不存在的状态码 | **已决（产品决定 4）**：彻底删除 → 410（网页服务 proxy + 由 §6 台账同步的已删除集合）；撤回 / 下线 → 404 + noindex；从未存在 → 404 |
| 是否需要按引擎区分推送的 URL 范围 | 不区分；百度额度不够时只推新内容 |
| 360、搜狗等其他国内引擎的推送 | 不做；需要时按 §7 的形态加引擎实现 |
| 投递器调度粒度 | 常驻协程（单节点租约），不依赖分钟级定时任务 |
