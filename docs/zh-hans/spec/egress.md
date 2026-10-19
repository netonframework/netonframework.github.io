# 出站策略与受控客户端（Egress）

> **定位**：服务端替谁发请求、能发到哪里。定义「哪些出站请求必须走受控客户端」的判定规则、
> 全进程唯一的运维出站策略 `[egress]`、受控客户端在直连与经代理时各自保证什么，以及各模块的落点。
>
> **状态**：已实施（neton-http `EgressSettings` / `GuardedHttpClientProvider` / `OutboundAddressPolicy`）。
>
> **前置**：[HTTP 引擎规范](./http-engine.md) §5（`ADDRESS_POLICY` 能力、`OutboundAddressPolicy` 的地址判定）。

## 1. 规则：地址从哪来，决定用哪个客户端

| 出站 URL 的来源 | 客户端 | 例子 |
| --- | --- | --- |
| 用户提交、抓取到的内容 | **受控**（`GuardedHttpClientProvider`） | 采集入口与翻页链接、正文里的图片、转存地址、重定向 `Location` |
| 后台**运行期**数据（数据库行、后台可改的配置） | **受控** | 网关渠道 `baseUrl` / `proxyUrl` / 服务账号 `token_uri`；短信渠道 `apiUrl`；邮件 `endpoint` 与 SMTP 主机；支付渠道网关地址（支付宝 `serverUrl`、四方 `apiUrl`） |
| 部署配置（`.conf`、环境变量、代码常量） | 应用的普通 `HttpClient` / `HttpClientProvider` | AI provider `baseUrl`（ai.conf）、对象存储 endpoint（storage.conf）、FCM（push.conf）、人机验证 `NETON_CAPTCHA_VERIFY_URL`、网关价目表 `NEWGATE_PRICE_SYNC_URL`、privchat service API |

一句话：**URL 来自用户 / 内容 / 后台运行期数据 → 受控；URL 来自部署配置 → 普通。**
判定看的是「谁能改这个地址」：管理员在后台能改的，和用户填的一样不可信——后台账号被盗、越权、或者只是填错，
都会把服务器变成打内网（含云元数据 `169.254.169.254`）的跳板。

新增出站调用时按这张表选客户端；把后台可改的地址交给普通客户端视为安全缺陷。

## 2. 运维出站策略 `[egress]`（全进程唯一）

`application.conf`：

```toml
[egress]
allowed_ports = "80,443"          # 受控 HTTP(S) 请求允许的端口，默认 80,443
allowed_hosts = ""                # 主机名 / IP 字面量精确匹配：解析到哪、什么端口都放行
allowed_networks = ""             # CIDR：这些特殊用途网段放行（端口仍按 allowed_ports）
```

- 列表逗号分隔；环境变量 `NETON_EGRESS__ALLOWED_PORTS` / `__ALLOWED_HOSTS` / `__ALLOWED_NETWORKS`（`egress` 是框架读取的根段）。
- 写错（端口不是数字、CIDR 不合法）启动失败，不回退默认值。
- 只有部署配置能放宽它；没有任何后台设置、数据库字段或环境开关能绕过（旧的 `NEWGATE_ALLOW_PRIVATE_UPSTREAM`、
  `infra.conf [untrusted_fetch]` 已删除）。
- 绑定一次：module-system（每个宿主第一个初始化的模块）读 `[egress]`，绑定 `GuardedHttpClientProvider`（宿主可先绑定自己的），
  任一放行项非空时启动打 WARN `egress.allowlist.enabled`，否则 INFO `egress.policy public-only`。
  infra、gateway、payment 及以后的模块都从 `NetonContext` 取同一个实例，**不再各自持有放行列表**。
- SMTP 共用同一份放行主机 / 网段，端口按邮件端口（25、465、587、2525）判断（`EgressSettings.smtpPolicy`）。

典型放行：自托管模型 `allowed_networks = "10.20.0.0/16"` + `allowed_ports = "80,443,8000"`；本机 SMTP 中继 `allowed_hosts = "127.0.0.1"`；
本地开发桩 `allowed_hosts = "stub.local.test"`；TUN 代理把公网域名解析成 `198.18.0.0/15` 假地址时 `allowed_networks = "198.18.0.0/15"`。

## 3. 受控客户端保证什么

`GuardedHttpClientProvider.create { }` 建的客户端带运维策略（`OutboundAddressPolicy`），调用方能设超时、代理、连接上限，
**不能**设或替换地址策略（设了即拒）。每条新连接：

1. scheme 只允许 http / https，端口在放行列表（或主机在 `allowed_hosts`）；
2. IP 字面量直接取地址，非规范写法（`2130706433`、`0x7f.1`、`127.1`、`0177.0.0.1`）直接拒；域名解析一次；
3. **任一**地址不是公网（IANA 特殊用途段；IPv4 映射 / NAT64 / 6to4 按内嵌 IPv4 判断）且不在 `allowed_networks` → 拒；
4. 只连校验过的地址（IP 字面量），不二次解析：DNS 重绑定挪不走连接；TLS 的 SNI 与证书校验仍用 URL 主机名。

**经代理**（`proxyUrl`，网关渠道可配）时目标仍由客户端解析与校验，代理只拿到校验过的 IP：

- https：`CONNECT <校验过的 IP>:<port>`，隧道内 TLS 的 SNI 与证书校验用原主机名；解析出多个地址时按序尝试，代理拒绝一个换下一个；
- http：absolute-form 请求行写校验过的 IP，`Host` 保留原 authority。
- 代理端点本身按同一地址规则校验（`OutboundAddressPolicy.admitProxy`，端口不限）：公网，或被 `[egress]` 放行；同样只连校验过的地址。

被拒 = `HttpClientError.TargetRejected(SCHEME | PORT | ADDRESS | RESOLVE | PROXY)`，不发出任何字节。
拒绝信息与日志里的地址一律是规范文本：IPv4 点分十进制，IPv6 按 RFC 5952（小写、去前导零、最长一段连续零组压成 `::`，
IPv4 映射写成 `::ffff:a.b.c.d`）；`allowed_hosts` 里的 IP 字面量也按规范文本匹配（写 `0:0:0:0:0:0:0:1` 与 `::1` 等价）。
SMTP 被拒 = `SmtpTargetRejectedException(reason)`。

**重定向**：客户端不自动跟随。需要跟随的调用方（采集、媒体转存）手动跟随，最多 5 跳，每一跳重新做语法检查（只许 http / https）并
用同一个受控客户端发出——第一跳公网、第二跳 302 到内网，在第二跳连接前被拒。`stream()` 的非 2xx 错误
`HttpClientError.Http` 带响应头（`headers`），调用方从中读 `Location`。

## 4. 写入时校验与请求时强制

强制点永远在请求时（受控客户端）。写入时校验（网关渠道新建 / 修改 / 添加 Key）只是快速反馈：用**同一个**策略与解析器
（`systemHostResolver()`）先判一遍、不过不落库；直接写库的数据、之后改了 DNS 的域名一样在请求时被拒。

## 5. 各模块落点

| 模块 | 出站 | 客户端 | 被拒时 |
| --- | --- | --- | --- |
| infra 媒体转存 | 用户 / 内容给的图片地址，跟随 ≤5 跳重定向 | 受控（`port.UntrustedHttpClient`，由 `GuardedHttpClientProvider` 建） | `URL_TARGET_FORBIDDEN` / `URL_PORT_FORBIDDEN` / `URL_RESOLVE_FAILED` / `URL_SCHEME_FORBIDDEN` / `TOO_MANY_REDIRECTS` |
| collect 采集 | 入口、列表 / 详情 / 翻页链接、robots.txt，跟随 ≤5 跳 | 受控（同上） | 同上（采集记录错误码） |
| gateway | 渠道转发、探测、拉模型、能力校验、Vertex 换 token（`token_uri` 只许 https） | 受控（按渠道代理与超时建，经代理亦钉住目标；按渠道缓存，渠道改 / 删 / 停用即退役，空闲 10 分钟或超过 256 条回收，在用的请求归还后才关，进程停止全部关闭） | 写入时字段 400：`UPSTREAM_URL_*` / `UPSTREAM_PROXY_FORBIDDEN`；请求时：转发换下一渠道（不计 Key 失败，全拒 503 `no_available_channel`），探测 / 拉模型结果 `errorCode` |
| gateway 价目表同步 | `NEWGATE_PRICE_SYNC_URL`（环境变量） | 普通 | — |
| system 短信 / 邮件 | 渠道 `apiUrl`、邮件 `endpoint`、SMTP 主机 | 受控 HTTP 客户端 + SMTP `smtpPolicy` | `MESSAGE_ENDPOINT_FORBIDDEN` |
| system 人机验证 | `NETON_CAPTCHA_VERIFY_URL`（环境变量） | 普通 | — |
| payment | 支付宝 `serverUrl`、四方 `apiUrl`（渠道配置） | 受控（payment 自建，宿主不能 bind 注册表；宿主只经 `PayCallbackHooks` 给回调地址） | `PAY_ENDPOINT_FORBIDDEN`（503，与网络失败 / 平台报错区分；原因与地址只进服务端日志 `pay.platform.endpoint_forbidden`）；对账任务记下后跳过该单 |
| push FCM、AI、storage、cs→privchat | 部署配置 | 普通 | — |

## 6. 不在本文

- 入站来源 IP 判定（可信代理、`X-Forwarded-For`）：routing 规范。
- 出网网络策略（容器 egress 规则、云元数据 IMDSv2）：部署文档，作为纵深防御仍建议配置。
