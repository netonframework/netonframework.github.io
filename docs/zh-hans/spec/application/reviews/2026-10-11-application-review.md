# Neton Application 与 Front 全维度评审

日期：2026-10-11（2026-10-20 更新整改状态）。状态：P0 R01 与 R02 已修复并通过回归验收，见「整改状态」；其余条目以该节为准。本文不替代已冻结的框架规范。

结论：模块化装配、框架 SPI、显式迁移和 MFA 主流程已具备基础，但当前版本不能认定为安全、国际化、可重复交付的通用发行版。最高优先级是评审时在隔离环境复现的认证域混淆（R01）：终端用户令牌可被当作同 ID 管理员令牌使用。该缺口已关闭（见「整改状态」）；统一防滥用、国际化、稳定性及交付门禁按后续批次推进。

## 范围与证据

主审仓库：`neton-application`（HEAD `1ecc34c`）与 `neton-application-front`（HEAD `8041932`）。沿实际装配关系检查 `module-system`、`module-account`、相关 frontend 模块和 Neton 认证、路由、HTTP 实现；system HEAD `d9f80ca`，account HEAD `3c9980e`。包含前一轮尚未提交的 MFA 验收文件，未覆盖或提交其他会话修改。

本轮进行了源码与规范对照、前端类型检查、隔离本地 PostgreSQL/Redis/Native 后端的认证负向实验。未访问线上，未开启可见浏览器，未对支付账务、文件上传、OAuth 各供应商或所有模块逐接口做渗透和压力测试。因此这是全维度基线评审，不是全系统安全认证或性能容量证明。

判级：P0 为已确认严重越权，P1 为上线前必须修复的高风险安全/交付缺口，P2 为通用发行版完整性、稳定性和可维护性改进。静态证据、运行时复现与待部署验证分别标明。

## 已确认的基础能力

- Application 使用 `SecurityConfig` / `NetonConfigurer` 装配认证和权限评估，业务代码复用框架密码、JWT、数据库、HTTP 能力。
- 模块注册表由 KSP 生成；启动仅检查迁移状态，显式 `migrate` 执行 DDL；迁移嵌入二进制。
- 网络准入在认证前拒绝，读取统一 `HttpRequest.clientAddress`。当前 routing 安装 resolver 时向 `realIp` 传 `null`，因此不能再把旧 `X-Real-IP` 回退描述为当前默认链仍可利用的漏洞。
- MFA 三态登录、挑战不充当会话、行锁原子消费、重放拒绝、管理员重置后的 MFA revision 失效已实现。前一轮真实 PostgreSQL 4 连接/8 并发/1 成功及后台浏览器完整验收见 [MFA 验收](../mfa-acceptance.md)。这些通过结果不覆盖本文发现的跨认证域攻击。
- 前端 TypeScript strict、模块页面注册、局部渲染错误边界、HttpOnly Cookie 已有实现。本轮 `pnpm typecheck` 通过，注册 8 个模块、68 个页面。

## P0 认证域隔离

### R01 会员刷新令牌可升级为管理员令牌

**状态：已修复（2026-10-11），2026-10-20 复验通过。**

影响（修复前）：两类主体（管理员 `system_users`、终端用户 `account_users`）的令牌由同一把 HS256 密钥签发，令牌中没有受校验的身份域；管理员刷新与访问路径只校验签名、令牌类型与 MFA 状态，再把 `sub` 当作管理员 ID。两表 ID 空间重叠时，终端用户令牌会被当作同 ID 管理员处理，可取得该管理员的全部权限。评审时仅在本地隔离环境（临时数据库、非生产账号）复现，未涉及任何线上环境。

根因：认证器按「签名正确」而非「签给这个路由组的身份域」判定可信；身份域只出现在响应 DTO 中，不在签名内。

修复：

- module-system `d10d82b`：新增 `TokenRealm` / `TokenRealmRegistry` / `RealmAuthenticator`。每个路由组登记唯一身份域（重复登记启动失败）；本应用签发的每张令牌带签名内 `realm` 与 `type` 声明，`RealmAuthenticator` 要求 `realm` 与路由组登记的域一致，未登记域的组不接受任何本应用令牌；`AdminTokenRealm` 只接受 access 类型并校验账号状态、会话版本、会话吊销和 MFA，权限按服务端授权版本解析，不信任令牌内角色；外部统一令牌不进入管理员域。管理员刷新入口执行同样的域与类型校验。无 `realm` 的旧令牌一律拒绝（需要重新登录），不再默认视为管理员。
- module-account `85cd3f7`：`AccountTokenRealm` 承载 `/app`、`/manage`；内置适配器签发带 `realm=account` 的令牌，刷新入口拒绝非本域、非 refresh 类型令牌（同时关闭 R02）。
- neton-application `90e0a04`：发行版删除自带的 `SecurityConfig` / `CoreAuthenticatorBridge`，统一使用 module-system 的 `SystemSecurityConfig`。
- 2026-10-20 排查全部装配 system/account 的发行版：仍保留旧 `CoreAuthenticatorBridge` 副本的发行版已删除该副本。该副本不校验身份域，此前只因 system 的同序 configurer 在其后执行并覆盖默认认证器而未生效；删除后不再依赖装配顺序。

回归测试：module-system `RealmAuthenticatorTest`（access 只在本域可用、refresh 不能用于请求认证、无 realm 令牌拒绝、未登记域的路由组拒绝、伪造签名拒绝、一个路由组不能属于两个域）；`tests/security/realm-session-e2e.sh`（neton-application 与 itwind-backend 各一份）以真实二进制、临时 PostgreSQL/Redis、管理员与终端用户同 ID 为前提，断言 admin/app × access/refresh 交叉矩阵全部拒绝错误域与错误类型。

整改归属：system/account 定义独立身份域和 session policy，application 通过框架 Authenticator SPI 按 route group 装配。强制验证签名内的 issuer/audience/realm/type，刷新入口执行相同域校验；不同域分离密钥是额外隔离，不能代替 claim 校验。旧无域令牌必须有明确失效迁移，不能继续默认为 admin。不要把业务表查询塞进通用 `neton-security` JWT 原语。

验收：admin/app 的 access/refresh 两两交叉矩阵全部拒绝错误域及错误类型；加入同 ID、未绑定 MFA、禁用/删除用户、旧令牌的负向测试。MFA 与网络白名单只能作为附加保护，不能作为身份域隔离的前提。

## 整改状态（2026-10-20）

复验环境：本机构建的 Native debug 二进制、临时 PostgreSQL 库与独立 Redis，脚本结束即删除；未访问任何线上环境或生产账号。

| 条目 | 状态 | 证据 |
|---|---|---|
| R01 认证域混淆 | 已修复 | system `d10d82b`、account `85cd3f7`、application `90e0a04`；残留旧认证桥的发行版已清理 |
| R02 refresh 当 access | 已修复 | account `85cd3f7` |
| R03 占位 JWT 密钥 | 已修复 | system `d10d82b`（任何环境拒绝占位值与短密钥），E2E [0] |
| R04 退出/改密/刷新撤销 | 已修复 | system `d10d82b`、`e7e67a8`，account `13609ca`；E2E [3][4][5][8] |
| R05 撤权即时生效 | 已修复 | system `d10d82b`（授权版本 + 服务端解析）；E2E [6] |
| R08 登录节流与统一失败 | 部分修复 | system `7debed2`、account `190be46`；E2E [7]。CAPTCHA 已另行接入（system `1db9f12`、account `2d58f18`），覆盖 gate 未复核 |
| R09 Cookie CSRF | 部分修复 | `RealmAuthenticator` 要求 Cookie 写请求带 `X-Neton-Csrf`；E2E [2]。Secure/CSP 未复核 |
| R06/R07/R10–R20 | 本次未复核 | 保持原评审结论，按执行批次推进 |

2026-10-20 回归结果：

- module-system `macosArm64Test` 70 项、module-account `macosArm64Test` 16 项全部通过。
- `realm-session-e2e.sh`：neton-application、itwind-backend 各 50/50 通过；同一脚本对清理旧认证桥后的发行版二进制 50/50 通过。

## P1 安全与交付缺口

### R02 会员 refresh 可直接当 access 使用，会话版本未在访问时校验

证据：CoreAuthenticatorBridge（`neton-application/application/src/commonMain/kotlin/security/CoreAuthenticatorBridge.kt`）、BuiltinAccountIdentityAdapter（`neton-application-module-account/src/commonMain/kotlin/impl/BuiltinAccountIdentityAdapter.kt`）。`/app` 直接交给通用签名验证，没有 access 类型、账号状态、sessionVersion 的业务校验；refresh 有效期为 365 天。

评审时本地复现 refresh 令牌可直接访问 `/app` 接口，refresh 的长有效期等于访问有效期。**已修复**（module-account `85cd3f7`：`AccountTokenRealm` 只接受 access 类型，每次请求校验账号状态、会话版本与会话吊销），E2E「refresh 当 access 用 → 拒绝」覆盖。整改：account 实现访问会话验证器，严格检查 access/域/账号有效性/session version，禁用、注销、改密、全端退出统一撤销。验收必须测试旧 access 和旧 refresh，不能只测刷新接口。

### R03 仓库占位 JWT 密钥能够通过配置校验

证据：默认配置（`neton-application/application/config/application.conf`）、配置读取（`neton-application-module-system/src/commonMain/kotlin/config/SecuritySettings.kt`）。校验仅要求非空，仓库公开的 `REPLACE_ME_...` 值非空，框架构造器也未阻止它。若部署遗漏覆盖，会以公开密钥签验 JWT；这不是已证明线上正在使用该值。

整改：生产启动拒绝占位值/缺失值，约束高熵密钥的生成与输入格式，提供密钥轮换与旧 key 撤销流程；配置示例和错误消息中的环境变量名称统一，并测试实际加载优先级。验收：默认示例不能直接作为生产配置启动。

### R04 退出、改密与刷新没有完整撤销闭环

证据：logout 与 refresh（`neton-application-module-system/src/commonMain/kotlin/logic/AuthLogic.kt`）、改密（`neton-application-module-system/src/commonMain/kotlin/logic/UserLogic.kt`）。管理员退出仅记日志、控制器清 Cookie；改密只更新密码哈希；refresh 不做单次轮换或复用检测。

评审时本地复现退出后原 access 仍可用；已由会话吊销与会话版本修复（module-system `d10d82b`、`e7e67a8`），E2E 第 [4]/[5]/[8] 组覆盖。MFA reset 的 revision 已能失效会话，但没有覆盖一般会话生命周期。

整改：system 使用服务端 session/jti 与用户会话版本；定义单会话退出、全端退出、改密/重置的不同语义，refresh 原子轮换并处理并发刷新。浏览器退出网络失败时不可仅显示已退出而 Cookie 仍有效。验收：捕获旧 access/refresh，在退出和改密之后分别验证拒绝；客户端并发刷新不能随机踢出正常用户。

### R05 角色和菜单权限撤销后旧 JWT 仍持有权限

证据：权限写入 JWT（`neton-application-module-system/src/commonMain/kotlin/logic/AuthLogic.kt`）、权限修改（`neton-application-module-system/src/commonMain/kotlin/logic/PermissionLogic.kt`）、评估器（`neton-application-module-system/src/commonMain/kotlin/security/WildcardPermissionEvaluator.kt`）。请求授权依赖 token 中的权限集合，写操作没有更新授权版本或撤销旧 token；前端权限快照也只读取一次。用户仍启用时，旧权限可持续到 access 过期。

整改：按 [RBAC §8](../rbac-spec.md) 使用 `neton-cache` 与主动失效，同时设计授权版本校验/短期服务端快照；单纯刷新前端菜单不能撤销后端 JWT 权限。角色禁用、撤权、菜单停用、用户移除角色均须覆盖。验收：持旧 token 调原写接口失败，多实例一致。

### R06 验证码消费分裂，跨用途共用且非原子

证据：MessageSendLogic（`neton-application-module-system/src/commonMain/kotlin/logic/MessageSendLogic.kt`）、短信消费（`neton-application-module-system/src/commonMain/kotlin/logic/MessageSendLogic.kt`）、account Lua 消费（`neton-application-module-account/src/commonMain/kotlin/logic/AccountAuthLogic.kt`）。

account 短信已有 Lua 原子消费和 5 次预算，应保留；但 system 短信、共享邮件仍为 GET/比较/DEL，错误不计数。两域短信都用 `sms:code:<mobile>`，用途 scene 不进挑战身份。单个入口有预算不代表所有消费路径共用预算；并发仍可能重复成功，登录码与重置码也未被可靠隔离。

整改：统一到 system 的验证码挑战服务，绑定 realm/recipient/purpose/challengeId/必要时 actor；成功一次消费，跨 IP/跨入口共享失败预算；业务模块通过服务调用，不直读 Redis。验收沿用防滥用规范 B08，额外覆盖管理员/会员相同手机号和跨用途提交。

### R07 验证码明文进入业务日志，未配置通道仍返回成功

证据：邮件 fallback（`neton-application-module-system/src/commonMain/kotlin/logic/MessageSendLogic.kt`）、模板日志（`neton-application-module-system/src/commonMain/kotlin/logic/MessageSendLogic.kt`）、短信 fallback（`neton-application-module-system/src/commonMain/kotlin/logic/MessageSendLogic.kt`）。不仅 DEV 分支：正常模板路径也把渲染后的 content 和包含 code 的 params 写入 MessageLog。拥有日志读取权限的人或日志泄露可暴露仍有效验证码；无模板时返回 true 且没有生产环境门禁。

整改：验证码日志只保留挑战摘要、用途、脱敏接收方、供应商结果，禁止正文/params 含秘密；显式开发模拟器与生产发送器分开，生产缺通道必须报服务不可用。供应商超时不得当成功，也不能不加约束地重复发送。验收包括有模板/无模板/供应商异常三条路径。

### R08 认证入口覆盖和防滥用仍未实现完整规范

证据：account register/login-username（`neton-application-module-account/src/commonMain/kotlin/controller/app/auth/AuthController.kt`）、管理员 login（`neton-application-module-system/src/commonMain/kotlin/logic/AuthLogic.kt`）。前两者没有 `@RateLimit`，装配中未发现兜底认证组限流；两域 refresh 同样缺入口限流。管理员不存在用户名时立即返回、禁用账户先于密码校验返回不同文案。未发现账号+IP 失败冷却、发送多维预算或第三方人机验证 provider 实现。

第三方人机验证目前不能标为完成：当前是规范阶段，MFA 不等于 CAPTCHA。

整改：按 [防滥用规范](../auth-abuse-protection-spec.md) P0-b/B09 从生成路由元数据建立覆盖 gate；哈希前总请求限制、账号+IP 冷却、账号风险升级分别执行；短信原子预占手机号/IP/全站额度；假哈希仅减少时序差异；统一失败响应。CAPTCHA provider 随后接入统一策略与服务端核验，开关不能只在前端。

### R09 Cookie 模式的安全边界需要收口

证据：SessionCookie（`neton-application-module-system/src/commonMain/kotlin/config/SessionCookie.kt`）、issueSession（`neton-application-module-system/src/commonMain/kotlin/controller/admin/auth/AuthController.kt`）、Main CORS（`neton-application/application/src/commonMain/kotlin/Main.kt`）。

Secure 默认关闭且没有生产门禁；Cookie 已为 HttpOnly，但同一登录/刷新 JSON 仍把 access/refresh 返回给浏览器，脚本可读取认证响应，因此“XSS 偷不走会话”的注释过度承诺。没有发现应用级 CSRF token 或严格 Origin/Fetch Metadata 校验；Main 将 CORS `*` 固定在 DSL。SameSite=Lax 有保护作用，但不能覆盖所有同站不同源部署，也不能以 CORS 代替 CSRF。未验证线上代理补充策略，不把这里表述为已复现 CSRF。

整改：明确浏览器 Cookie 会话与 API token 传输契约；生产 HTTPS 配置校验，Cookie 属性枚举校验；Cookie 写请求实施 Origin/CSRF 策略；允许源走框架配置与 Config SPI。前端壳/部署模板补经过验证的 CSP、frame-ancestors 等头，兼容现有主题内联脚本。

### R10 限流和认证审计仍使用不同客户端 IP

证据：account 私有 helper（`neton-application-module-account/src/commonMain/kotlin/controller/app/auth/AuthController.kt`）、统一 resolver 装配（`neton/neton-routing/src/commonMain/kotlin/neton/routing/RoutingExtensions.kt`）。框架已提供 `clientAddress`，account 登录/设备记录仍只取 `peerAddress`。因此反代后限流可能正确而审计仍记录代理地址。默认 routing 示例也未配置 trusted proxies；实际生产是否补配，本轮未检查。

整改：account 直接消费框架 `clientAddress`，删除过期直连假设；gateway 可选模块也纳入同一策略，代理地址只作为独立诊断字段。验收一个请求的准入、限流、审计、可选网关 IP 一致，伪造转发头不得改变结果。

### R11 干净环境 CI 装配不完整

证据：settings（`neton-application/settings.gradle.kts`）、Backend CI（`neton-application/.github/workflows/backend-ci.yml`）。settings 必需 sibling system/infra/cs、geolite4k、privchat-service-client 等，但 application-build checkout 清单不完整，还清理旧 in-tree module 路径；outbox job 也不能满足根 settings 的仓库要求。依赖 checkout 未锁 revision。静态可确认缺依赖，未声称已查看远端 CI 实际结果。

前端没有仓库 CI 工作流和通用 test/lint 脚本；前一轮 MFA 数据库与浏览器验收尚未成为持续门禁。整改：干净 checkout 的装配清单与版本锁统一；前端 registry/typecheck/build/契约测试，后端 Native 单测、真实数据库、认证跨域矩阵和无界面 E2E 纳入 CI；接入生产目标 Linux release 构建，不能仅通过 macOS 编译验收发布。

## P2 国际化、稳定性与标准化

### R12 国际化仅有声明，没有运行时体系

证据：locales 契约（`neton-application-front/packages/front-contract/src/index.ts`）、registry generator（`neton-application-front/scripts/generate-registry.mts`）、layout（`neton-application-front/apps/shell/src/app/layout.tsx`）、日期（`neton-application-front/packages/front-runtime/src/types.ts`）、金额（`neton-application-front/packages/front-resource/src/index.tsx`）。locales 没有装配/加载；界面大量中英混写；html 固定 zh-CN、日期固定 zh-CN、金额固定 ¥ 和两位小数。

整改：front-contract 定义模块命名空间和 locale 资源，front-runtime 统一加载、fallback、语言选择、ICU 参数/复数及 Intl 格式化，front-kit 消费翻译；模块保存本域词条。菜单增加稳定翻译 key，仍允许业务自定义名称。后端稳定错误码与参数、前端翻译文案，未知错误安全回退；不能依赖匹配英文异常字符串。时间明确 UTC 传输和展示时区，金额携带 currency 和单位精度，不把翻译当成简单替换字符串。

验收：至少 zh-CN/en-US 全流程、缺 key 检测、长文本、不同地区/时区、货币零/二/三位精度；语言切换不破坏页签及未提交表单。

### R13 品牌没有单一配置来源

证据：metadata（`neton-application-front/apps/shell/src/app/layout.tsx`）、登录页（`neton-application-front/apps/shell/src/app/(auth`）/login/page.tsx:70)、导航品牌（`neton-application-front/apps/shell/src/components/app-shell.tsx`）。标题、介绍、版权、地点及登录页健康状态文本写死；“Identity service operational”没有实际探测依据。

整改：统一 BrandConfig（appName/description/logo/copyright 等），所有页面和 metadata 共用。发行版固定品牌可由 env 构建注入；要同一镜像多部署、运行期修改时，使用受校验公开配置端点或启动注入，不能误以为 NEXT_PUBLIC env 在构建后仍可热改。品牌配置与 locale 翻译分层。MFA issuer 独立、稳定且可区分部署，不能随页面改名自动改变已绑定凭据身份。

验收：仅修改一份配置即可覆盖浏览器标题、登录页、导航；未配置走统一默认；敏感配置不进入公开端点。

### R14 模块加载失败会永久停留在加载态

证据：usePageComponent（`neton-application-front/packages/front-workspace/src/host.tsx`）。`page.load()` rejection 被保留在 loadingCache；只有 finally，没有错误 state/catch/清理。渲染 ErrorBoundary 捕捉不到 effect 异步异常，组件一直为 null，无法通过页面重试恢复。

整改：显式 loading/error/ready 状态，失败 promise 出缓存，有限重试与重新加载操作；chunk 版本变化与已有 BuildUpdateGuard 协调。验收：第一次 chunk 失败、恢复网络后重试成功，没有 unhandled rejection；其他已打开页签不受影响。

### R15 HTTP 错误和会话故障被混为登录失效

证据：runtime HTTP client（`neton-application-front/packages/front-runtime/src/client.ts`）、protected layout（`neton-application-front/apps/shell/src/app/(protected`）/layout.tsx:27)。apiFetch 无统一 deadline、无 HTTP/content-type 校验，代理返回 HTML 502 时暴露 JSON 解析错误；丢弃 429 Retry-After、字段 errors 等信息。fetchSession 网络失败或 5xx 被布局统一重定向登录。

整改：统一 ApiError 保存 status/code/field errors/requestId/retryAfter，支持 AbortSignal 和超时；401、403、429、5xx、离线分别处理。只对明确认证失效跳登录，后端不可达显示可恢复错误。幂等读取可有限退避，写入不得盲目重试；会话续期策略要与 R04 一起定义。

### R16 前后端权限通配语义不一致

证据：前端 permissionMatches（`neton-application-front/packages/front-runtime/src/client-context.tsx`）、后端 evaluator（`neton-application-module-system/src/commonMain/kotlin/security/WildcardPermissionEvaluator.kt`）、[RBAC §4](../rbac-spec.md)。前端接受单个 `*` 和任意段通配，例如 `system:*:list`，后端规范明确拒绝。结果是按钮展示与实际授权不一致；这本身不意味着绕过后端权限。

整改：根据规范生成或共享跨语言测试向量，前后端都只接受冻结形式。验收覆盖合法/非法通配、空段、跨模块和缺权限，不再维护两套自由解释器。

### R17 文档、数据库支持及 API 契约存在漂移

证据：[Application SPEC](../SPEC.md)、[工程硬规范](../ENGINEERING_RULES.md)、前端 README（`neton-application-front/README.md`）、MFA SQL（`neton-application-module-system/src/commonMain/kotlin/logic/MfaLogic.kt`）。SPEC/README 仍描述 Vue、in-tree 模块、手动旧 SQL；前端主规范仍位于 privchat-docs；工程规范 §2 定义 status=1 启用，§5 示例却写 0 正常。正文不应把历史结论当作当前硬规则。

MFA 明确采用 PostgreSQL，通用 README 却宣称 MySQL/PostgreSQL/SQLite 可配置切换；MFA 在普通认证也会执行 PostgreSQL ON CONFLICT/FOR UPDATE，不能只说“非 PG 不启用 MFA 即可”。明确当前发行版数据库支持矩阵并启动拒绝不支持的组合，或者按框架 DbContext 能力做真正跨方言实现与测试。

前后端分页请求 pageNo/pageSize 与响应 page/size 是现状，应在契约明确，不能误报所有请求分页不符合。前端 IDs 多为 number，而持久化为 Long；对超出 JS 安全整数的发行版必须统一字符串线格式及 round-trip 测试，当前小自增 ID 不应被误报为已发生精度损失。旧 LoginResponse 类型也应与三态响应合并为判别联合。

整改：canonical 前端规范迁入 neton-docs/application 合理分类，原位置只留链接；记录冲突决议/生效版本/迁移策略；从 KSP 路由和 DTO 元数据产出可校验 API 契约，前端消费同一版本。

### R18 热路径数据库成本、健康检查和审计不足

证据：管理员每请求校验（`neton-application/application/src/commonMain/kotlin/config/SecurityConfig.kt`）、MFA state（`neton-application-module-system/src/commonMain/kotlin/logic/MfaLogic.kt`）、Health（`neton-application/application/src/commonMain/kotlin/controller/HomeController.kt`）、AuthLogic 日志（`neton-application-module-system/src/commonMain/kotlin/logic/AuthLogic.kt`）。每个 admin 请求查 user，MFA state 总会 INSERT ON CONFLICT 再 SELECT，随后 delegate 再验 JWT。PermissionInfo 按规范应缓存，当前仍多表读取。根 health 永远返回 ok，不代表数据库/Redis 可用。

AuthLogic 登录失败分支没有调用登录审计服务，MFA 和若干权限日志用字符串拼接，不能满足页面所称完整审计；与 [框架 logging](../../logging.md) 的结构化 fields 要求不一致。

整改：状态初始化移出只读请求路径，避免重复验签；用框架 neton-cache 和明确失效契约优化，不能以缓存换取撤权延迟。区分 liveness/readiness，依赖探测超时有界；通过框架日志上下文关联 requestId、认证失败、MFA、权限修改。压测记录 p95/p99、DB 查询次数、连接等待和错误率，README 的启动指标不能当吞吐结论。

### R19 对话框无完整焦点管理，工作区持久化未区分用户

证据：Drawer/ConfirmDialog（`neton-application-front/packages/front-kit/src/components/admin.tsx`）、workspace persistence（`neton-application-front/packages/front-workspace/src/store.ts`）。Dialog 只有 role/aria-modal，缺焦点圈定、初始焦点、关闭回焦；页签 href 和业务标题保存在全站同一 localStorage key，换用户仍可恢复前一人的描述，不能视为没有数据的纯 UI 状态。

整改：front-kit 统一可访问 Dialog primitive；键盘、屏幕阅读器、缩放、减少动画逐项验收。持久化按发行版/身份域/用户隔离，退出清理或安全重建，敏感标题不持久化。长期工作区无自动回收是当前设计选择，应通过页签预算提示与压力验收控制内存，不能擅自用 LRU 丢弃未保存表单。

### R20 发布依赖与供应链验证不够可重复

证据：shell package（`neton-application-front/apps/shell/package.json`）、registry 校验（`neton-application-front/scripts/generate-registry.mts`）。大量 file sibling 依赖需要完整本地目录，注册检查只看文件存在不保证内容版本一致；contractVersion 仅 major 比较，不能表达真实兼容范围；release 依赖没有完整跨仓版本清单。

整改：开发允许 composite/file，发布使用锁定 revision 或版本化制品清单、frozen lockfile、干净安装和可复现 registry；契约版本与兼容测试一起发布；可选私有/产品模块不应成为最小通用发行版的隐式构建前提。

本轮依赖审计：默认 npmmirror 缺 audit endpoint；使用官方 npm registry 重试 60 秒超时，未取得结果。不能据此声称没有依赖漏洞。后续 CI 应运行可用 registry 的依赖审计与 SBOM，并检查 Native 传递依赖；本轮未改变全局 registry。

## 按 Neton Framework 边界实施

| 层 | 负责能力 | 必须遵循的规范与验收 |
|---|---|---|
| neton-core / security / routing / http | 通用身份 SPI、签验原语、可信来源、请求门禁、错误与日志上下文 | [security](../../security.md)、[routing](../../routing.md)、[Config SPI](../../config-spi.md)；框架不依赖应用 User/MFA 表 |
| module-system | 管理员身份域、会话、MFA、验证码服务、防滥用策略、RBAC 与审计 | [MFA](../mfa.md)、[防滥用](../auth-abuse-protection-spec.md)、[RBAC](../rbac-spec.md)；统一服务，不分散复制 |
| module-account | 终端用户域、账号状态/会话版本、消费共享验证码能力 | 域隔离、account 适配器契约；member 保留会员业务而非复制认证 |
| application | 发行版装配、配置、生命周期、迁移/部署入口 | Configurer 注册业务扩展，DSL 安装基础设施；显式迁移、生命周期关闭、生产校验 |
| front-contract / runtime | 模块/i18n/API 契约、HTTP 错误、会话、权限语义 | 版本与生成检查、与后端相同负向测试向量 |
| front-kit / front-system | 可访问 UI；用户/MFA 管理、翻译资源 | kit 独占 primitive，模块不引入 shell 私有实现 |
| front shell | 品牌、宿主路由、布局、发行版组合 | 公开配置明确构建/运行时语义，业务翻译留模块 |

执行批次与完成定义：

1. **认证隔离补丁**：R01/R02/R03；先冻结身份域与旧 token 失效策略，补失败测试，再改实现。交叉 token 矩阵及同 ID 测试全通过才能关闭 P0。
2. **会话与防滥用**：R04–R10；会话/授权失效、验证码原子消费、脱敏、入口覆盖、真实 IP 和 Cookie 策略，每项独立验收；保留已通过的 MFA 行为。
3. **发布门禁**：R11/R20；干净机器完整构建，真实 PG/Redis 并发、负向安全 E2E，Linux release 制品，依赖审计。不能用本地增量构建代替。
4. **国际化和前端稳定性**：R12–R19；先校准规范冲突，再实现 locale/品牌/错误/权限/可访问性；中英文生产构建与无界面浏览器验收。

每个整改必须链接规范条款、代码改动、回归测试和真实验收记录。规范冲突先形成明确决议；未完成项保留状态，不把文档中的 DONE、单次 typecheck 或单条成功流程当整体达标。

## 外部依据与测试限制

外部资料只辅助安全和 Web 平台要求，不替代 Neton 的应用分层规范。失败提示与登录节流参考 [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)；退出、失效和会话更新参考 [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)。模块 locale 落地结合 [Next.js Internationalization](https://nextjs.org/docs/app/guides/internationalization)；对话框焦点与键盘行为按 [WAI-ARIA Dialog Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) 验收。

本轮认证实验使用前一轮验收构建的本地 Native debug 二进制，并以当前源码追踪原因；未重新做 release 构建。测试只创建隔离 account fixture，已删除该记录并关闭临时后端、Redis 和 PostgreSQL。未改生产业务代码、线上配置或数据库。整改与复验记录见「整改状态」。
