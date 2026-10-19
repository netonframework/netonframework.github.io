# module-gateway 错误码

gateway（LLM 网关：渠道 / 定价 / 计费组 / 用户级例外 / 额度 / 充值 / 令牌 / 兑换码）在 **Neton 信封**里抛出的业务错误，
`message` 一律是本模块的机器码（`^[A-Z][A-Z0-9_]{2,}$`），不放中英文句子、不带 `CODE: detail` 前缀、不做插值或拼接；
数字 `code` 仍取 `NetonErrorCode` 的类别（参数错 / 不存在 / 已存在 / 冲突 / 不允许 …），HTTP 状态由框架按类别推导。
跟请求字段有关的细节放字段级错误 `errors = [{ path, message: CODE, code: CODE }]`（message 与 code 同为机器码）；
只对排障有用的细节（被拒的 host、解析出的内网地址、批次号、引用它的渠道数等）写服务端日志，不进响应。
码集中定义在 `logic.GatewayErrorCodes`，字段级 400 统一走 `logic.rejectField(path, CODE)`；后台前端
`neton-application-front-gateway` 在 `src/locales/{zh-CN,en-US}.ts` 里以 `error.<CODE>` 翻译，页面经
`useDescribeError("gateway")`（ResourcePage 用 `errorNamespace: "gateway"`）显示。
新增码顺序：`GatewayErrorCodes` → 本表 → 前端两种语言。模块 `macosArm64Test` 里的 `ErrorMessageGuardTest`
（共享夹具 `contract.testing.ErrorMessageGuard`，并把 `rejectField` 登记为需检查的构造器）扫描 `src/commonMain`，
出现非机器码 message 即失败。

**不在本规则内**：OpenAI / Anthropic / Gemini 兼容转发端点（`/v1/…` 等）返回厂商格式的错误体
`{"error":{"message":…,"type":…}}`，那是对 API 客户端的协议契约，`type` 才是稳定标识，`message` 维持原样。

| 机器码 | NetonErrorCode | 场景 | 字段 |
|---|---|---|---|
| `CHANNEL_NOT_FOUND` | RESOURCE_NOT_FOUND | 后台更新 / 探测 / 拉模型，渠道 id 不存在 | — |
| `CHANNEL_TYPE_UNKNOWN` | INVALID_PARAMS | 探测 / 拉模型：渠道类型没有对应的上游适配器 | — |
| `CHANNEL_NO_AVAILABLE_KEY` | INVALID_PARAMS | 探测 / 拉模型：渠道没有可用 Key | — |
| `CHANNEL_MODELS_EMPTY` | INVALID_PARAMS | 探测未指定模型且渠道没有模型清单 | `model` |
| `CHANNEL_CAPABILITIES_REQUIRED` | INVALID_PARAMS | 渠道能力清单为空 | `capabilities` |
| `CHANNEL_CAPABILITY_UNKNOWN` | INVALID_PARAMS | 能力清单含未知能力名（chat / embeddings / images / rerank / audio 之外） | `capabilities` |
| `CHANNEL_LOSS_POLICY_INVALID` | INVALID_PARAMS | 损耗策略不是 allow / safe / strict | `lossPolicy` |
| `UPSTREAM_URL_EMPTY` | INVALID_PARAMS | SSRF 校验：地址为空 | `baseUrl` / `proxyUrl` |
| `UPSTREAM_URL_SCHEME_INVALID` | INVALID_PARAMS | SSRF 校验：不是 http / https（服务账号 `token_uri` 只许 https） | `baseUrl` / `proxyUrl` / `apiKey` |
| `UPSTREAM_URL_USERINFO_NOT_ALLOWED` | INVALID_PARAMS | SSRF 校验：地址带 userinfo | `baseUrl` / `proxyUrl` |
| `UPSTREAM_URL_HOST_EMPTY` | INVALID_PARAMS | SSRF 校验：缺主机名 | `baseUrl` / `proxyUrl` |
| `UPSTREAM_URL_PRIVATE_ADDRESS` | INVALID_PARAMS | SSRF 校验：字面量或任一解析结果不在公网且运维 `[egress]` 未放行（回环 / 内网 / 链路本地 / 云元数据…） | `baseUrl` / `apiKey`（`token_uri`） |
| `UPSTREAM_URL_UNRESOLVABLE` | INVALID_PARAMS | SSRF 校验：域名解析不出地址（fail-closed） | `baseUrl` / `apiKey` |
| `UPSTREAM_URL_PORT_FORBIDDEN` | INVALID_PARAMS | SSRF 校验：端口不在 `[egress] allowed_ports`（默认 80、443）或不是合法端口 | `baseUrl` / `apiKey` |
| `UPSTREAM_PROXY_FORBIDDEN` | INVALID_PARAMS | 代理地址不在公网且 `[egress]` 未放行，或解析不出 | `proxyUrl` |
| `CHANNEL_KEY_SERVICE_ACCOUNT_INVALID` | INVALID_PARAMS | Key 以 `{` 开头却不是 JSON 对象 | `apiKey` |

上面 `UPSTREAM_*` 同时是**请求时**的机器码：渠道探测 / 拉模型结果的 `errorCode` 字段（受控客户端在连接前拒绝目标时），
以及转发全部候选被拒时 `503 no_available_channel` 消息里的码。写入时校验与请求时强制用同一个运维出站策略，见 [出站策略](../egress.md)。
| `PRICE_NOT_FOUND` | RESOURCE_NOT_FOUND | 后台更新定价，id 不存在 | — |
| `PRICE_INVALID` | INVALID_PARAMS | 价格不是非负十进制数（整数位 ≤ 7） | 价格字段名，如 `inputPrice`、`saleOverride.input` |
| `RATIO_INVALID` | INVALID_PARAMS | 倍率 / 折扣不是十进制数 | `ratio` / `costDiscount` |
| `RATIO_OUT_OF_RANGE` | INVALID_PARAMS | 倍率 / 折扣不在 (0, 100] | `ratio` / `costDiscount` |
| `SALE_OVERRIDE_INVALID` | INVALID_PARAMS | saleOverride 不是 JSON 对象 | `saleOverride` |
| `SALE_PER_REQUEST_INVALID` | INVALID_PARAMS | saleOverride.perRequest 不是非负整数或 null | `saleOverride.perRequest` |
| `SALE_PRICE_BELOW_COST_FLOOR` | INVALID_PARAMS | 售价低于毛利底线（官方成本 × 毛利下限倍率） | `saleOverride.<维度>` |
| `PRICE_SYNC_NOT_CONFIGURED` | OPERATION_NOT_ALLOWED | 立即同步价目表，但未配置 `NEWGATE_PRICE_SYNC_URL` | — |
| `GROUP_NOT_FOUND` | RESOURCE_NOT_FOUND | 后台更新 / 删除计费组，id 不存在 | — |
| `GROUP_CODE_REQUIRED` | INVALID_PARAMS | 组 code 为空（建组 / 写例外） | `code` / `groupCode` |
| `GROUP_CODE_TOO_LONG` | INVALID_PARAMS | 组 code 超过 64 字符 | `code` / `groupCode` |
| `GROUP_CODE_INVALID_FORMAT` | INVALID_PARAMS | 组 code 含字母数字 `_` `-` 以外的字符 | `code` |
| `GROUP_CODE_ALREADY_EXISTS` | RESOURCE_ALREADY_EXISTS | 建组 code 重复（含并发抢建撞唯一索引） | `code` |
| `GROUP_CODE_IMMUTABLE` | OPERATION_CONFLICT | 更新时带了与现值不同的 code | `code` |
| `GROUP_CODE_UNKNOWN` | INVALID_PARAMS | 写用户级例外指向不存在 / 已软删的组 | `groupCode` |
| `GROUP_IN_USE_BY_TOKEN` | OPERATION_CONFLICT | 删组：仍有令牌把它用作分组覆盖 | — |
| `GROUP_IN_USE_BY_OVERRIDE` | OPERATION_CONFLICT | 删组：仍有用户级例外指向它 | — |
| `GROUP_IN_USE_BY_CHANNEL` | OPERATION_CONFLICT | 删组：仍有渠道的分组 CSV 列着它 | — |
| `MEMBER_GROUP_ALREADY_MAPPED` | OPERATION_CONFLICT | 会员组已映射到另一个计费组 | `memberGroupId` |
| `GROUP_OVERRIDE_NOT_FOUND` | RESOURCE_NOT_FOUND | 更新 / 删除用户级例外，该用户没有例外 | — |
| `GROUP_OVERRIDE_ALREADY_EXISTS` | RESOURCE_ALREADY_EXISTS | 新建例外，该用户已有一条（含并发抢建） | `userId` |
| `USER_ID_INVALID` | INVALID_PARAMS | userId 非正数 | `userId` |
| `MEMBER_NOT_CHARGEABLE` | INVALID_PARAMS | 新建例外：userId 不是可计费会员（id 打错 / 停用 / 注销） | `userId` |
| `REMARK_TOO_LONG` | INVALID_PARAMS | 例外备注超过 256 字符 | `remark` |
| `QUOTA_GRANT_AMOUNT_INVALID` | INVALID_PARAMS | 发放额度非正数（减额度应走 revoke） | `amount` |
| `QUOTA_REVOKE_AMOUNT_INVALID` | INVALID_PARAMS | 撤回额度非正数（非正撤回等于发放） | `amount` |
| `QUOTA_REVOKE_REF_REQUIRED` | INVALID_PARAMS | 撤回没带幂等 ref | `ref` |
| `RECHARGE_INVALID` | INVALID_PARAMS | 充值下单校验失败（逐项见字段错误） | 见下两行 |
| `RECHARGE_PRICE_INVALID` | INVALID_PARAMS | （字段错误）充值金额非正数 | `price` |
| `RECHARGE_CHANNEL_REQUIRED` | INVALID_PARAMS | （字段错误）未指定支付渠道（payment 无默认渠道） | `channelCode` |
| `RECHARGE_NOT_FOUND` | RESOURCE_NOT_FOUND | 回读充值单：不存在或不是自己的（不区分，防探测） | — |
| `MOCK_RECHARGE_DISABLED` | OPERATION_NOT_ALLOWED | 模拟充值未开启（`NEWGATE_ENABLE_MOCK_RECHARGE`） | — |
| `RECHARGE_AMOUNT_INVALID` | INVALID_PARAMS | 模拟充值额度非正数 | `amount` |
| `TOKEN_NOT_FOUND` | RESOURCE_NOT_FOUND | 自助令牌按 id 操作：不存在或不属于当前用户（不区分） | — |
| `TOKEN_NAME_REQUIRED` | INVALID_PARAMS | 令牌名为空 | `name` |
| `TOKEN_QUOTA_BUDGET_INVALID` | INVALID_PARAMS | 令牌预算非正数 | `quotaBudget` |
| `TOKEN_EXPIRES_AT_INVALID` | INVALID_PARAMS | 令牌过期时间不晚于当前 | `expiresAt` |
| `TOKEN_STATUS_INVALID` | INVALID_PARAMS | 状态不是 0 / 1 | `status` |
| `REDEMPTION_QUOTA_INVALID` | INVALID_PARAMS | 生成兑换码：面额非正数 | `quotaMicro` |
| `REDEMPTION_COUNT_INVALID` | INVALID_PARAMS | 生成数量非正数 | `count` |
| `REDEMPTION_COUNT_TOO_LARGE` | INVALID_PARAMS | 单次生成超过 1000 张 | `count` |
| `REDEMPTION_EXPIRES_AT_INVALID` | INVALID_PARAMS | 过期时间不晚于当前 | `expiresAt` |
| `REDEMPTION_NOTE_TOO_LONG` | INVALID_PARAMS | 备注超过 255 字符 | `note` |
| `REDEMPTION_CODE_REQUIRED` | INVALID_PARAMS | 兑换：码为空（归一化后） | `code` |
| `REDEMPTION_CODE_INVALID_FORMAT` | INVALID_PARAMS | 兑换：码超长 | `code` |
| `REDEMPTION_CODE_NOT_FOUND` | RESOURCE_NOT_FOUND | 兑换查无此码 / 后台作废的 id 不存在 | — |
| `REDEMPTION_CODE_USED` | OPERATION_CONFLICT | 兑换或作废：码已被使用（含并发占位失败） | — |
| `REDEMPTION_CODE_DISABLED` | OPERATION_CONFLICT | 兑换或作废：码已作废 | — |
| `REDEMPTION_CODE_EXPIRED` | OPERATION_CONFLICT | 兑换：码已过期 | — |
| `REDEMPTION_BATCH_ID_REQUIRED` | INVALID_PARAMS | 整批作废 / 批次统计：批次号为空 | `batchId` |
| `REDEMPTION_BATCH_NOT_FOUND` | RESOURCE_NOT_FOUND | 批次统计：批次不存在 | — |

批量生成兑换码中途失败（DB 故障）不是业务错误：仍是 500，批次号与已生成张数写服务端日志；
已入库的那部分在后台列表（按 id 倒序）最上方可见，按批次整批作废后重新生成。
价目表导入 / 同步的逐条结果（`PriceImportResult.errors`）是响应数据而非错误信封，不在本表内。
