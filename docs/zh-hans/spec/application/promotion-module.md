# module-promotion 商业推广识别、联盟转链与广告标识

> 标识：NETON-APP-PROMOTION
> 日期：2026-10-22 · 状态：**Accepted r1**（首期实现：`neton-application-module-promotion`、`neton-application-front-promotion`；接入方 collect、content、newsroom 同批落地，itwind C6）
> 仓库：`neton-application-module-promotion`（服务端）、`neton-application-front-promotion`（后台页面）
> 一句话：判断一篇内容是不是在**卖东西**（导购、带货、经销商促销）；是的话要么拦下来交给编辑，要么把购买链接换成我们自己的联盟推广链接、标上「广告」再按正常流程发布。

## 1. 定位与边界

| 负责 | 不负责 |
| --- | --- |
| 商业意图识别：商家链接、购买口令、促销话术、价格密度 + 可选的大模型复核，给出三级结论与证据 | 商品、SKU、订单、支付（那是领域模块 commerce，套件架构 §2.2）；促销活动、优惠券发放（同上） |
| 处理计划：按结论与已配置的联盟决定「发布 / 带推广链接发布 / 留待人工」，并给出审核保留原因 | 是否发布：只把**保留原因**交给内容模块，发布决定仍由 content 的发布策略与审核做（content §6） |
| 联盟转链：京东联盟、淘宝联盟（阿里妈妈）、拼多多多多进宝适配器，转换结果缓存与到期刷新 | 佣金结算与对账（联盟后台的事；本期不拉订单报表） |
| 托管链接：正文里只存「链接记录」的引用，展示时取当前推广地址（到期、失效自动降级为纯文字） | 渲染：客户端按契约渲染广告标识（§7） |

**为什么单独成模块**（套件架构 §2.3 三条）：资讯、汽车、数码评测、UGC 社区都会遇到软广和导购（≥ 两类平台）；作用于文章、评论、帖子、采集素材等任意文本（不绑定实体）；有自己的数据（链接记录、联盟配置）和生命周期（转换、到期、刷新）。识别和转链放在一起，因为两者共用同一份**商家链接注册表**，而「有没有能转的联盟」正是识别结论之后的分叉点。名字用 promotion（推广）而不是 commerce：commerce 留给交易领域。

## 2. 识别

### 2.1 输入与结论

```kotlin
// contract.promotion
data class CommercialText(val title: String, val html: String? = null, val text: String? = null, val pageUrl: String? = null)

@Serializable data class CommercialVerdict(
    val level: String,                 // none | editorial | promotional（CommercialLevel）
    val score: Int,                    // 规则分（§2.3）
    val reasons: List<String>,         // 机器码（§2.4），去重、按出现先后
    val evidence: List<ReviewEvidence>,// contract.core：kind + match + excerpt + field，后台高亮用
    val links: List<MerchantLink>,     // 识别到的商家链接（含锚文本）
    val commands: List<String>,        // 购买口令（淘口令等），原样
    val classifier: String? = null,    // 复核过的模型 id；规则直接定论时为空
    val version: Int = CommercialVerdict.VERSION,
)
```

| 级别 | 含义 | 例子 |
| --- | --- | --- |
| `none` | 与购买无关 | 发布会、评测、行业新闻 |
| `editorial` | 新闻里提到价格或商品页，但目的不是促成购买 | 「小米 15 发布，起售价 4499 元」 |
| `promotional` | 导购 / 带货 / 经销商促销：引导读者现在去买 | 「xxx 国补后 2999 元」「限时优惠 3 万，到店享置换补贴」 |

### 2.2 信号

1. **商家链接**（`MerchantLinkRegistry`，§2.5）：正文 `<a href>`、正文纯文本里的网址。按商家分类，抽取商品 ID，区分 `product`（商品页）、`short`（推广短链：u.jd.com、3.cn、s.click.taobao.com、m.tb.cn、p.pinduoduo.com……）、`coupon`（领券页）、`campaign`（会场 / 活动页）。
2. **购买口令**：淘口令一类的「符号 + 10–14 位大小写混排的字母数字 + 符号」（要求大小写都有，全大写的型号不算）（`￥AbCd1234Xy￥`、`€AbCd1234Xy€`、`(AbCd1234Xy)` 等），以及「复制…打开淘宝 / 京东 / 拼多多」提示语。
3. **促销话术**：国补后、到手价、券后、领券、立减、直降、限时、秒杀、x 元起、历史低价、补贴价、百亿补贴、好价、下单、拍下、抢购、包邮、满减、叠加、PLUS 价、入手……（内置词表，`promotion.extra_phrases` 追加）。
4. **经销商促销**（汽车）：到店（不含「到店铺」）、4S 店、现车、置换补贴、询底价、落地价、限时优惠 / 让利 / 直降 x 万（不含厂家上市的「限时优惠价 x 万起」）、优惠高达 x 万、金融贴息、0 首付、试驾礼、购车礼、厂补。
5. **标题**：标题里出现**强**购买话术（国补后、到手价、券后、领券、秒杀、好价……，以及经销商的限时优惠 x 万、到店、4S 店、置换补贴、询底价、落地价）；「强话术 + 价格」同时出现（「国补后 3599 元」）是最强的单项信号。「限时」「x 元起」「低至」「下单」「包邮」这类在发布会新闻标题里也常见的词只在正文里计分（懂车帝的上市新闻「海鸥限时 6.29 万起」不因标题被判为推广）。
6. **价格密度**：`¥ / ￥ / x 元 / x 万元 / x 万` 的出现次数。

### 2.3 打分与阈值

| 信号 | 分值 | 上限 |
| --- | --- | --- |
| 商家链接（每个，`product` / `short`） | 3 | 6 |
| 领券 / 会场链接 | 3 | 3 |
| 购买口令 | 4 | 4 |
| 促销话术（每个不同的词） | 2 | 8 |
| 经销商促销（每个不同的词） | 2 | 8 |
| 标题含促销话术 | 3 | 3 |
| 标题含「促销话术 + 价格」 | 3 | 3 |
| 价格 ≥ 3 处 / ≥ 6 处 | 2 / 3 | 3 |

- `score ≥ promotion.threshold.promotional`（默认 8）→ `promotional`；**例外**：没有购买渠道（商家链接、口令）、标题没有强话术、也没有经销商信号的「纯文字」高分（新闻常写「叠加国家补贴后到手价 6499 元」）按边界处理，交给复核，复核不可用时为 `editorial`。
- `promotion.threshold.borderline`（默认 4）≤ score < 8 → **边界**，交给大模型复核（§2.6）；复核不可用时：有商家链接或口令 → `promotional`，否则 `editorial`，并加原因 `CLASSIFIER_UNAVAILABLE`。
- score < 4：有价格或商家链接 → `editorial`，否则 `none`。

阈值后台可调（系统配置，§9）。分值表是代码常量，单测钉住（`PromotionRulesTest`），调整要改规范。

### 2.4 原因码

`MERCHANT_LINK`、`COUPON_LINK`、`PURCHASE_COMMAND`、`PROMO_PHRASE`、`DEALER_PROMO`、`PROMO_TITLE`、`PRICE_DENSITY`、`CLASSIFIER_PROMOTIONAL`、`CLASSIFIER_EDITORIAL`、`CLASSIFIER_NONE`、`CLASSIFIER_UNAVAILABLE`。证据 `ReviewEvidence.kind` 用小写同名（`merchant_link`、`promo_phrase`……），`match` 是命中的原文片段，`excerpt` 是前后各 30 字的上下文，`field` 是 `title` / `body`。

### 2.5 商家链接注册表

```kotlin
class MerchantLinkRegistry {                 // contract.promotion；promotion bindIfAbsent 并注册内置商家，产品可追加
    fun register(pattern: MerchantPattern)
    fun match(url: String): MerchantLink?    // 不认识返回 null
}
data class MerchantPattern(val merchant: String, val hosts: Set<String>, val kind: String, val productId: (Url) -> String?)
```

内置：`jd`（item.jd.com、item.m.jd.com、u.jd.com、3.cn、re.jd.com、pro.jd.com、coupon.jd.com、jingfen.jd.com）、`taobao`（item.taobao.com、s.click.taobao.com、m.tb.cn、tb.cn、uland.taobao.com、a.m.taobao.com）、`tmall`（detail.tmall.com、detail.m.tmall.com、chaoshi.detail.tmall.com）、`pdd`（mobile.yangkeduo.com、yangkeduo.com、mobile.pinduoduo.com、p.pinduoduo.com）、`suning`（product.suning.com、m.suning.com）、`vip`（detail.vip.com）、`douyin`（haohuo.jinritemai.com）。主机按后缀匹配（`m.item.jd.com` 算 `item.jd.com`）。

### 2.6 大模型复核

- 模型 `promotion.classifier.model`（默认 `dashscope:qwen-flash`，经 neton-ai，`AiClient` 不在时视为不可用），温度 0，JSON 输出，超时 15 秒。
- 输入：标题、正文前 2000 字、规则命中的证据；输出 `{"verdict":"none|editorial|promotional","reasons":["…"]}`，只取 `verdict`，模型给出的 reasons 作为一条 `classifier` 证据（≤ 200 字）。解析失败按不可用处理。
- 只在边界区间调用：规则能定论的不花钱。结论按「标题 + 正文」的 sha256 进程内缓存 10 分钟（同一素材重投不重复调用）。

## 3. 处理计划

```kotlin
interface CommercialContentGuard {           // contract.promotion；promotion 绑定，使用方 ctx.getOrNull
    suspend fun detect(input: CommercialText, classify: Boolean = true): CommercialVerdict
    /** 按一份或多份结论（一篇转载 = 一份；AI 合成稿 = 用到的各篇素材 + 合成稿本身）决定怎么处理，并完成转链。 */
    suspend fun plan(verdicts: List<CommercialVerdict>): CommercialPlan
    /** 把计划应用到 HTML：可转换的链接换成托管链接，其余商家链接去掉链接只留文字，口令删掉。 */
    fun rewriteHtml(html: String, plan: CommercialPlan): String
}

data class CommercialPlan(
    val level: String,                       // 各结论里最高的级别
    val action: String,                      // publish | sponsored | hold
    val holds: List<ReviewHold>,             // 交给 content 的审核保留原因（hold 时非空）
    val links: List<PlannedLink>,            // 每个商家链接一项：convert（有 linkRef / href）或 strip（带原因）
    val disclosure: String?,                 // 有托管推广链接时为 Disclosures.ADVERTISING
)
```

| 级别 | 条件 | 动作 | 交给 content |
| --- | --- | --- | --- |
| promotional | 至少一个商家链接，且**全部**能经已启用的联盟转换（口令照样删除，读者经推广链接购买） | `sponsored` | 托管推广链接 + `disclosure = advertising`，**不**保留，按正常发布策略 |
| promotional | 没有商家链接（经销商促销、只有口令），或有任何一个链接转不了 | `hold` | `CONTENT_COMMERCIAL_SUSPECTED`（证据：话术、口令、每个转不了的链接与原因）；能转的照样托管，转不了的去掉链接 |
| editorial | — | `publish` | `promotion.editorial_links = strip`（缺省）：商家链接只留文字；`= convert`：能转的托管并标广告，转不了的只留文字 |
| none | — | `publish` | 万一有商家链接，只留文字 |

- **永远不发布原始商家链接**：要么换成我们的托管推广链接，要么去掉链接。口令一律删除。
- 转不了的原因：`PROVIDER_NOT_CONFIGURED`（该商家没有启用的联盟）、`PROVIDER_REJECTED`（联盟说这件商品不在推广计划里 / 参数错）、`PROVIDER_FAILED`（网络、超时、限流、5xx）、`MERCHANT_UNSUPPORTED`（认得是商家但没有对应联盟，如苏宁）。
- 编辑在后台对保留的稿件「通过」即发布（保留原因留作审计）；也可以驳回或删除。

## 4. 联盟转链

### 4.1 适配器

```kotlin
interface AffiliateProvider {                // 实现类在本模块；产品可以绑定自己的实现扩展商家
    val code: String                         // jd | taobao | pdd
    val merchants: Set<String>               // jd → {jd}；taobao → {taobao, tmall}；pdd → {pdd}
    suspend fun convert(link: MerchantLink, options: ProviderOptions): ConversionOutcome   // Converted(url, shortUrl?, expiresAt?) / Rejected(code) / Failed(code)
}
```

| 联盟 | 接口 | 签名 |
| --- | --- | --- |
| 京东联盟 | 网关 `POST {endpoint}`（生产 `https://api.jd.com/routerjson`，表单），`method = jd.union.open.promotion.common.get`，业务参数 `360buy_param_json = {"promotionCodeReq":{"materialId":"<商品或联盟链接>","siteId":"…","positionId":"…","subUnionId":"…","sceneId":1|2}}`：主站商品链接（`item.jd.com`、`3.cn`）`sceneId = 2`，联盟链接（`u.jd.com`、`union-click`、京粉）`sceneId = 1`；回应 `jd_union_open_promotion_common_get_responce.getResult`（对象或 JSON 字符串，`code = 200` 时取 `data.clickURL`）。拒绝码：2001101 / 2001102 / 2001104 / 2001106 / 2001706 / 2001707 / 2001212 / 400 / 1002024；其余（403、限流、2001609 / 2001504 降级、`error_response`）算暂时失败 | `sign = upper(md5(secret + Σ(key+value 按 key 升序) + secret))`；`timestamp = yyyy-MM-dd HH:mm:ss`（北京时间）、`v = 1.0`、`sign_method = md5`、`format = json` |
| 淘宝联盟（阿里妈妈） | TOP 网关（生产 `https://eco.taobao.com/router/rest`），推广者万能转链 `method = taobao.tbk.dg.general.link.convert`（不需要用户授权），`adzone_id`（部署配置）+ `material_list`（商品链接、s.click / m.tb.cn 短链）；系统参数放查询串、业务参数放表单体；回应 `data.material_url_list[0].link_info_dto`（兼容不精简时外层的 `tbk_dg_general_link_convert_response` 与双层数组），优先 `coupon_short_url`，其次 `cps_short_url`；`error_response` 的 `sub_code` 以 `isv.` 开头算拒绝，签名 / App Key / 限流算暂时失败 | TOP md5（同上算法）；`timestamp = yyyy-MM-dd HH:mm:ss`（GMT+8）、`v = 2.0`、`sign_method = md5`、`format = json`、`simplify = true` |
| 多多进宝 | 网关（生产 `https://gw-api.pinduoduo.com/api/router`，POST JSON），`type = pdd.ddk.goods.zs.unit.url.gen`（把任意拼多多商品链接转成自己推广位的链接）：`pid`、`source_url`、`custom_parameters`（后台跟踪参数）；回应 `goods_zs_unit_generate_response`，优先 `mobile_short_url` / `short_url`。`error_response` 算拒绝，`sub_code` 含 `limit` 的算暂时失败。开放平台的接口详情页需登录，字段按公开文档目录与官方 SDK，**未逐字核对** | `sign = upper(md5(client_secret + Σ(key+value 升序) + client_secret))`；`timestamp` 为 Unix 秒、`data_type = JSON` |

签名单测（`PromotionSigningTest`）：淘宝 TOP「API调用方法详解」与拼多多「API调用指南」的**官方示例**（输入与期望签名逐字取自文档，`66987CB1…`、`E4DE3ED2…`）；京东 JOS 文档里的示例无法从它打印出的字符串复现，京东与三条转链请求的向量按同一算法用独立实现（Python hashlib）算出。e2e 用本仓 `test-stub/affiliate-fakes.mts`：三个假网关按同一算法**验签**，签名不对返回各自的错误码，签名对的返回 `https://fake-*.local/...` 推广地址。

### 4.2 部署配置与后台

部署配置 `config/promotion.conf`（改了重启生效；**出站地址没有代码缺省**，开了联盟就必须写 `endpoint`，生产地址只在部署配置里）：

```toml
[provider.jd]
enabled = true
endpoint = "https://api.jd.com/routerjson"
site_id = "<网站 ID>"
position_id = "<推广位 ID>"
# 密钥：NETON_PROMOTION_JD_APP_KEY / NETON_PROMOTION_JD_APP_SECRET

[provider.taobao]
enabled = true
endpoint = "https://eco.taobao.com/router/rest"
adzone_id = "<推广位 adzone_id>"
site_id = "<媒体 site_id>"
# 密钥：NETON_PROMOTION_TAOBAO_APP_KEY / NETON_PROMOTION_TAOBAO_APP_SECRET

[provider.pdd]
enabled = true
endpoint = "https://gw-api.pinduoduo.com/api/router"
pid = "<推广位 pid>"
# 密钥：NETON_PROMOTION_PDD_CLIENT_ID / NETON_PROMOTION_PDD_CLIENT_SECRET

[link]
ttl_hours = 168          # 转换结果有效期（联盟没给到期时间时）
refresh_before_hours = 24
```

- 密钥只从环境变量读；配置了 `enabled = true` 却缺密钥：启动 WARN `promotion.provider.disabled` 并关闭该联盟（不是写错）。写错（地址不是 http(s)、数值越界）启动即失败。
- 联盟地址来自部署配置，用应用的普通出站客户端（不经受控客户端，与 site 模块同一规则）；超时 5 秒。
- **后台**（`/admin/promotion/provider/*`）只管运行期开关与非敏感默认值：启用 / 停用某个已配置的联盟、跟踪参数（京东 `subUnionId`、拼多多 `custom_parameters`）。没在部署配置里配好的联盟在后台显示「未配置」，不能启用。

### 4.3 链接记录（托管链接）

| 表 | 关键字段 |
| --- | --- |
| `promotion_links` | id, url_hash（规范化原始地址的 sha256，唯一）, original_url, merchant, kind, product_id?, provider?, status(`active`/`unconvertible`/`failed`/`expired`), affiliate_url?, short_url?, expires_at?, reason?, attempts, next_attempt_at?, converted_at?, last_planned_at, created_at, updated_at |
| `promotion_providers` | code（主键）, enabled（0/1）, settings（text JSON：跟踪参数）, updated_by, updated_at |

- **缓存**：同一原始地址（规范化：小写主机、去锚点与跟踪参数 `spm` / `utm_*`）只有一条记录。`active` 且未到期直接复用；否则重新转换。转换失败的记录按 1 分钟 / 10 分钟 / 1 小时退避，退避期内直接当「转不了」。
- **托管**：正文里引用 `ObjectRef("promotion.link", id)`（HTML 里是 `<a href="…" data-managed-link="promotion.link:12">`，content 存成带 `ref` 的链接标记，content §5.2）。展示时 content 经 `ManagedLinkRegistry` 批量解析（§5），本模块只给 `active` 且未到期的记录：`ManagedLink(href = short_url ?: affiliate_url, rel = {sponsored, nofollow}, disclosure = advertising)`；其余不给，客户端显示纯文字。
- **刷新**：任务 `promotion-link-refresh`（10 分钟，单节点）把 `refresh_before_hours` 内到期、且 30 天内被规划过的 `active` 记录重新转换；失败的到期后转 `expired`。
- 解析结果在进程内缓存 60 秒（读路径不打库）。

## 5. 契约库补充（contract.core）

托管链接与审核保留原因不是本模块私有的概念（评论里的推广链接、短链服务、站外跳转追踪都会用到；任何写入方都可能要求「这一版要人看」），放进套件基础契约：

```kotlin
// contract.core
@Serializable data class ReviewEvidence(val kind: String, val match: String, val excerpt: String? = null, val field: String? = null)
@Serializable data class ReviewHold(val code: String, val evidence: List<ReviewEvidence> = emptyList())

@Serializable data class ManagedLink(val href: String, val rel: Set<String> = setOf(REL_NOFOLLOW), val disclosure: String? = null)
fun interface ManagedLinkResolver { suspend fun resolve(ids: Collection<String>): Map<String, ManagedLink> }
class ManagedLinkRegistry {                 // infra / 第一个用到的模块 bindIfAbsent；拥有链接记录的模块 register(type, resolver)
    fun register(type: String, resolver: ManagedLinkResolver)
    suspend fun resolve(refs: Collection<ObjectRef>): Map<ObjectRef, ManagedLink>   // 未注册的类型、不存在的记录不在结果里
}
object ManagedLinks { const val HTML_ATTRIBUTE = "data-managed-link"; const val REL_SPONSORED = "sponsored"; const val REL_NOFOLLOW = "nofollow" }
object Disclosures { const val ADVERTISING = "advertising"; val ALL = setOf(ADVERTISING) }
```

## 6. 接入方

| 接入方 | 怎么用 |
| --- | --- |
| **collect**（转载路线） | 本模块向 `CollectPipelineRegistry` 注册步骤 `promotion-check`（只处理 `article`）：识别 → 计划 → 改写 `contentHtml`、去掉摘要 / 纯文本里的口令 → `hold` 时把保留原因加到记录的 `holds`，有推广链接时写 `disclosure` 字段。步骤只改记录，从不 Block（拦不拦是 content 审核的事）。`content.draft` 端口把 `holds`、`disclosure` 原样交给 `ContentDraftInput`（collect §6、§8） |
| **newsroom**（AI 合成路线） | 素材入库时 `detect`，结论存在素材上；`promotional` 的素材只和 `promotional` 的素材归并（导购帖不混进新闻选题）。合成提示词禁止链接、口令、促销话术（价格只能作为事实陈述）；交付前再用规则 `detect` 一次合成稿（`classify = false`：它是我们自己的改写，复核只用于来源素材），`plan(用到的素材 + 合成稿)`：`sponsored` / 有转换的链接 → 正文末尾附「购买链接」段（托管链接，锚文本取素材里的商品名，没有时「在{商家}查看」），`disclosure = advertising`；`hold` → 保留原因交给 content。编辑台显示选题的商业级别、证据与每个链接的转换结果 |
| **content** | 不认识本模块：只认 `ReviewHold`（§5，content §6）、带 `ref` 的链接标记与 `ManagedLinkRegistry`（content §5.2）、`disclosure`（content §5.1） |
| **客户端** | 详情 / 卡片的 `disclosure` 与链接标记的 `rel` / `disclosure` 渲染广告标识（§7） |

模块之间没有对本模块实现的依赖：collect 只看到一个流水线步骤，content 只看到契约库的类型，newsroom 依赖 `:module-promotion-contract` 并在调用时 `ctx.getOrNull(CommercialContentGuard::class)`，本模块没装时照旧（不识别、不改写）。

## 7. 广告标识（合规）

《互联网广告管理办法》（2023-05-01 施行）第九条：互联网广告应当具有可识别性，能够使消费者辨明其为广告；通过互联网媒介推销商品、附加购物链接等的，**应当显著标明「广告」**。联盟佣金链接属于附加购物链接的商业推广，本套件的规则：

- 内容带托管推广链接（或编辑手动设 `disclosure = advertising`）时，详情顶部、卡片标题旁显示「广告」标签；`disclosure` 由 content 按「保存的值 ∨ 正文里任一已解析的推广链接带 disclosure」得出，编辑忘了设也不会漏标。
- 每个推广链接后紧跟「广告」小标签；网页上 `rel="sponsored nofollow noopener"`、新窗口打开。
- App 与网页的文案走各自的 i18n（`ad` → 「广告」/「Ad」），不用「推广」「赞助」等模糊说法。

## 8. 接口与权限

| 接口（`/admin/promotion/*`） | 权限点 |
| --- | --- |
| `GET provider/list`（含部署配置状态：configured / enabled / 缺的环境变量名） | `promotion:provider:query` |
| `PUT provider/update`（enabled、跟踪参数） | `promotion:provider:update` |
| `GET link/page?merchant&status&keyword&pageNo&pageSize`、`GET link/get/{id}` | `promotion:link:query` |
| `POST link/refresh/{id}`（立即重新转换） | `promotion:link:refresh` |
| `POST detect/test`（标题 + 正文 → 结论与计划，不落库、不转链，给编辑试规则） | `promotion:detect:test` |

菜单种子在 `V001`（「推广」目录：联盟、链接、识别测试），默认授予 `super_admin`。没有 `/app/*` 接口：读者看到的是 content 解析好的地址。

错误码（`message` 只放机器码）：`PROVIDER_UNKNOWN`、`PROVIDER_NOT_CONFIGURED`、`PROVIDER_SETTINGS_INVALID`、`LINK_NOT_FOUND`、`DETECT_INPUT_REQUIRED`、`DETECT_INPUT_TOO_LONG`。

## 9. 配置（system 配置，分类 `promotion`）

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `promotion.threshold.promotional` | 8 | §2.3 |
| `promotion.threshold.borderline` | 4 | §2.3 |
| `promotion.classifier.enabled` | true | 关掉后边界区间按规则兜底 |
| `promotion.classifier.model` | `dashscope:qwen-flash` | neton-ai 模型 id |
| `promotion.editorial_links` | `strip` | `strip` / `convert`（§3） |
| `promotion.extra_phrases` | 空 | 追加的促销话术，逗号分隔 |

## 10. 测试

- 单测：规则打分与阈值（IT之家导购帖、懂车帝经销商促销、普通发布会新闻三类真实样本）、商家注册表与 ID 抽取、口令识别、HTML 改写、计划决策表（§3 每一行）、三个联盟的签名向量与回应解析、部署配置校验。
- 真库：`promotion_links` 缓存 / 退避 / 到期 / 刷新、托管链接解析、后台接口（`PROMOTION_DB_URI`，`postgresContractTest`）。
- 装配 e2e（itwind）：假联盟网关 + 开发后端：导购帖无联盟时进待审并带证据；配置假京东 / 淘宝后同一批稿件带托管推广链接与「广告」发布；普通新闻不受影响。
