# 身份域与会话边界

状态：生效（2026-10-11）。来源：[全维度评审](reviews/2026-10-11-application-review.md) R01–R03。

本文规定应用层令牌的身份域隔离。框架 JWT 原语（[security §8](../security.md)）保持 v1 冻结，不认识业务表；
域的判定在应用模块里实现，通过框架 Authenticator SPI 装配。

## 1. 为什么需要身份域

应用里有两类主体：后台管理员（`system_users`，module-system）和终端用户（`account_users`，module-account）。
两者的令牌由同一个 HS256 密钥签发，`sub` 各自从小整数编号，**数值会相同**。只看签名和 `sub` 时，
终端用户令牌会被当成同 id 的管理员（R01 已复现取得 `*:*:*`）。

签名只证明「令牌是本应用签的」，不证明「令牌是给这个接口用的」。

## 2. 令牌声明

本应用签发的每一张 HS256 令牌必须携带：

| 声明 | 取值 | 说明 |
|---|---|---|
| `realm` | `admin` / `account` | 签发方所属身份域 |
| `type` | `access` / `refresh` | refresh 只能用于刷新接口，不能访问业务接口 |
| `sub` | 主体 id | 在所属域内解释 |

域专属声明：管理员令牌带 `mfa_revision`、`mfa_verified`；账号令牌带 `sid`（会话版本）、`did`（设备）。

## 3. 路由组与身份域

| 路由组 | 身份域 | 接受的令牌 |
|---|---|---|
| `admin` | `admin`（module-system） | 仅本应用 HS256，`realm=admin`、`type=access` |
| `app`、`manage` | `account`（module-account） | 本应用 HS256 `realm=account`、`type=access`；或受信任的外部统一令牌（如 RS256） |
| 其他组（`open` 等） | 无 | 不接受上述任何令牌；需要认证的组自行装配专用认证器（如 gateway 的 sk- 令牌） |

规则：

1. 一个路由组只能属于一个域，重复登记启动失败。
2. 令牌 `realm` 与路由组的域不一致 → 401。未登记域的路由组不接受本应用令牌。
3. 没有 `realm` 声明的令牌（本规范生效前签发的）一律 401，**不得**默认当作任一域。用户重新登录一次。
4. 外部统一令牌只在声明 `acceptsExternalTokens` 的域里交给 `UnifiedTokenAuthenticator`；管理员域不收。
5. 刷新接口与访问接口执行同样的域与类型校验：管理员刷新只收 `realm=admin, type=refresh`，账号刷新只收
   `realm=account, type=refresh`。

## 4. 访问时校验

| 域 | 每次请求校验 |
|---|---|
| admin | 用户存在且 `status=1`；MFA 状态与令牌的 `mfa_revision`/`mfa_verified` 一致 |
| account（内置后端） | 账号 `status=NORMAL`；令牌 `sid` 等于当前 `session_version` |
| account（外部后端） | 由外部令牌服务的 introspect / 会话版本负责；本应用不签发 `realm=account` 令牌给这类用户 |

账号刷新同样拒绝被禁用、已注销或会话版本已变化的账号。改密、注销、全端退出通过 bump `session_version`
使该账号已签发的 access 与 refresh 同时失效。

## 5. 实现位置

| 层 | 内容 |
|---|---|
| module-system | `TokenRealm` 契约、`TokenRealmRegistry`、`RealmAuthenticator`、管理员域 `AdminTokenRealm`、统一装配 `SystemSecurityConfig`（`@NetonConfig("security", order = 0)`） |
| module-account | 账号域 `AccountTokenRealm`；`AccountIdentityAdapter.acceptsAccessToken` 由内置后端实现 |
| 发行版 | 只装配模块，不再自带 SecurityConfig / 认证桥。外部令牌由产品模块在 `order < 0` 绑定 `UnifiedTokenAuthenticator`。确需包装 system 的认证器时必须 `replaceDefaultAuthenticator(replaces = "config.SystemSecurityConfig", ...)` 显式声明——同槽位隐式覆盖在启动期失败（security §6.3） |

## 6. 签名密钥

`security.jwt.secretKey` 只能由环境变量 `NETON_SECURITY__JWT__SECRETKEY` 注入。任何环境下，缺失、仍为示例占位值
（含 `REPLACE_ME`）或短于 32 个字符都拒绝启动。环境名默认是 `dev`，不能用环境名放行占位值。

## 7. 验收

- admin/account 的 access/refresh 在 `admin`、`app`、`manage`、未登记组之间的交叉矩阵：只有本域 access 通过。
- 同 id 的管理员与账号互不可用；无 `realm` 的旧令牌被拒；他人密钥签发的令牌被拒。
- 账号被禁用、注销、改密后，旧 access 与旧 refresh 都被拒。
- 占位密钥与短密钥启动失败。
