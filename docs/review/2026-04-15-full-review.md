# Neton 全面评审报告 (2026-04-15)

> 范围：neton 框架、neton-application 脚手架、member/payment/platform 业务模块、admin 前端模板

---

## 一、neton 框架

### 1.1 高危

| # | 模块 | 文件 | 行号 | 问题 | 影响 |
|---|------|------|------|------|------|
| F-1 | neton-routing | `ControllerRegistry.kt` | 7,12,21 | `mutableMapOf` 无同步保护，多线程注册/读取存在竞态条件 | 并发注册导致数据损坏 |
| F-2 | neton-routing | `RequestEngineImpl.kt` | 55 | `_rateLimitInterceptor!!` — if 检查与使用之间存在 TOCTOU 窗口 | NPE |
| F-3 | neton-security | `Authenticator.kt` | 33,56,74 | `SessionAuthenticator` / `JwtAuthenticator` / `BasicAuthenticator` 均为空实现返回 null | 内置认证器全部不可用 |
| F-4 | neton-http | `KtorHttpAdapter.kt` | 39-41 | 三个 `private var` 字段无 volatile/同步 | 跨线程可见性问题 |
| F-5 | neton-database | `SqlxTableAdapter.kt` | 100,115 | `softDeleteConfig!!` 无 null guard | 未配置软删除时调用 NPE |

### 1.2 中危

| # | 模块 | 文件 | 行号 | 问题 | 影响 |
|---|------|------|------|------|------|
| F-6 | neton-ksp | `ControllerProcessor.kt` | 580 | 生成代码 `cookie("name")!!.value` — cookie 缺失时 NPE 而非 400 | 运行时 500 |
| F-7 | neton-database | `SqlxPhase1Query.kt` | 56-86 | 8 个 typed projection 方法抛 `TODO()` 但 API 已暴露 | 用户调用即 crash |
| F-8 | neton-redis | `RedisExtensions.kt` | 24,39 | `catch (_: Exception) { null }` 吞异常无日志 | 反序列化失败无法排查 |
| F-9 | neton-core | `Neton.kt` | 478,482 | `KotlinApplication(ctx = null)` 允许空 ctx，但 `get()` 用 `!!` | NPE |
| F-10 | neton-core | `posix/ConfigIO.kt` | 43 | POSIX 环境变量读取返回空 map（TODO） | 无法通过环境变量配置 |
| F-11 | neton-routing | `RequestEngineImpl.kt` | 90-95 | 路由重复注册静默跳过无警告 | 路由冲突难排查 |
| F-12 | neton-routing | `RequestEngineImpl.kt` | 200-240 | JSON 序列化手写拼接，特殊字符转义不完整 | 非法 JSON |
| F-13 | neton-database | `DatabaseConfig.kt` | 186 | 连接串 query 参数未解析（TODO） | JDBC 选项不可传递 |

### 1.3 低危

| # | 模块 | 文件 | 行号 | 问题 |
|---|------|------|------|------|
| F-14 | neton-core | `Neton.kt` | 469 | `printStartupStatistics()` 空方法死代码 |
| F-15 | neton-core | `CoreLog.kt` | 16 | `log!!` bootstrap 模式脆弱，外部置 null 即崩 |
| F-16 | 全局 | 多处 | — | 50+ 处 `@Suppress("UNCHECKED_CAST")`，类型系统设计待改善 |

---

## 二、neton-application 脚手架

### 2.1 高危

| # | 文件 | 行号 | 问题 | 影响 |
|---|------|------|------|------|
| A-1 | `config/application.conf` | 19 | 硬编码数据库密码 `root:123456` | 凭据泄露 |
| A-2 | `config/application.conf` | 13 | JWT secret 硬编码 `"dev-only-change-me"` | token 可伪造 |
| A-3 | `provider/Google/TelegramSocialProvider.kt` | 18,25,23 | OAuth2 未实现但端点可用，返回空 openId | 社交登录绕过 |
| A-4 | `logic/DeptLogic.kt` | 82-84 | `deleteList()` 绕过父子约束校验 | 数据完整性破坏 |
| A-5 | `logic/MessageSendLogic.kt` | 75-100 | Redis 不可用时 SMS 验证码未存储但返回成功 | 验证码无效 |

### 2.2 中危

| # | 文件 | 行号 | 问题 | 影响 |
|---|------|------|------|------|
| A-6 | `logic/AuthLogic.kt` | 208-223 | 密码重置无复杂度校验（仅长度 8-128） | 弱密码 |
| A-7 | `controller/admin/dict/DictDataController.kt` | 28-32 | `@AllowAnonymous` 暴露全部字典数据 | 信息泄露 |
| A-8 | 多个 Controller | — | 批量删除 `deleteList()` 全部绕过单条校验 | 静默失败 |
| A-9 | `controller/admin/file/FileConfigController.kt` | 39-50 | update 时 `config` 字段（存储凭据）被丢弃 | 存储配置不可更新 |
| A-10 | `init/SystemModuleInitializer.kt` | — | **DeptLogic / PostLogic 未绑定到 ctx** | 运行时注入失败 |
| A-11 | 密码更新端点 | — | 无 `@RateLimit` | 可暴力尝试 |

---

## 三、业务模块

### 3.1 member 模块

#### 高危

| # | 文件 | 行号 | 问题 | 影响 |
|---|------|------|------|------|
| M-1 | `MemberModuleInitializer.kt` | — | `MemberGroupLogic` / `MemberTagLogic` / `MemberAddressLogic` / `MemberConfigLogic` 未绑定 ctx | Controller 运行时 crash |
| M-2 | admin Controller 全部 | — | **无 `@Permission` 注解** | 任意登录用户可操作管理功能 |
| M-3 | `MemberAuthLogic.kt` | 167 | SMS 验证码用 `kotlin.random.Random`（非密码学安全），仅 90 万种 | 可暴力枚举 |
| M-4 | `AuthController.kt` | 81-86 | `/validate-sms-code` 无 `@RateLimit` | 无限次尝试破解验证码 |
| M-5 | `MemberAuthLogic.kt` | 235-245 | SMS 验证码检查与删除非原子（TOCTOU） | 并发复用验证码 |

#### 中危

| # | 文件 | 行号 | 问题 | 影响 |
|---|------|------|------|------|
| M-6 | `UserPointUpdateReqVO.kt` | 10 | `point` 字段无校验注解，可传负数或极端值 | 积分异常 |
| M-7 | `MemberAuthLogic.kt` | 248 | JWT 不可用时 `return "jwt-not-configured"` 作为 token | 返回字面量字符串 |
| M-8 | `MemberLogic.kt` | 30-31 | LIKE 查询 `"%$it%"` 需确认框架是否参数化 | 潜在 SQL 注入 |

### 3.2 payment 模块

#### 高危

| # | 文件 | 行号 | 问题 | 影响 |
|---|------|------|------|------|
| P-1 | `PaymentModuleInitializer.kt` | — | `PayChannelLogic` / `PayWalletRechargePackageLogic` 未绑定 ctx | Controller 运行时 crash |
| P-2 | admin Controller 全部 | — | **无 `@Permission` 注解** | 越权操作支付管理 |
| P-3 | 两个 `PayOrderController.kt` | 11,14 | admin 和 app 路径都是 `/pay/order` — 路由冲突 | admin 接口可能被 app 覆盖 |
| P-4 | `controller/app/order/PayOrderController.kt` | 20 | `submit()` 缺少 `@Body` 注解 | 请求体解析失败 |
| P-5 | `PayWalletLogic.kt` | 168-190 | `markRechargePaid` 事务内读-改-写无乐观锁 | 并发双倍充值 |
| P-6 | `PayOrderLogic.kt` / `PayNotifyLogic.kt` | 30 / 51,64 | 支付渠道对接和商户回调都是 TODO | 支付核心链路未实现 |

#### 中危

| # | 文件 | 行号 | 问题 | 影响 |
|---|------|------|------|------|
| P-7 | `CreateWalletRechargeRequest.kt` | 8-15 | 无 `totalPrice >= payPrice` 约束 | 充值金额异常 |
| P-8 | `controller/app/order/PayOrderController.kt` | 14-16 | 订单 GET 无鉴权，任何用户可查任意订单 | 信息泄露 |
| P-9 | `PayWalletLogic.kt` | 42 | `bizType = 200` 硬编码魔法数字 | 可维护性差 |

### 3.3 platform 模块

#### 高危

| # | 文件 | 行号 | 问题 | 影响 |
|---|------|------|------|------|
| PL-1 | `ClientLogic.kt` | 61-71 | `generateAppSecret()` 用 `Random`（非密码学安全） | API 密钥可预测 |
| PL-2 | `ClientVO.kt` | 15 | `appSecret` 在 API 响应中明文返回 | 密钥泄露 |
| PL-3 | `PlatformOrderController.kt` | 68-76 | 签名验证不校验 timestamp 新鲜度 | 重放攻击 |
| PL-4 | admin Controller 全部 | — | **无 `@Permission` 注解** | 越权操作平台管理 |

#### 中危

| # | 文件 | 行号 | 问题 | 影响 |
|---|------|------|------|------|
| PL-5 | `PlatformOrderController.kt` | 68-72 | 签名字符串手动拼接不排序，可选参数影响顺序 | 签名碰撞风险 |
| PL-6 | `PlatformOrderController.kt` | 58,102 | `@RateLimit(key = "query:appId")` 攻击者控制 key 可绕过限流 | 限流无效 |
| PL-7 | `PlatformOrderController.kt` | 121 | 订单号 `"ORD_${appId}_${timestamp}"` 可预测 | 枚举风险 |

---

## 四、admin 前端模板

### 4.1 高危

| # | 文件 | 行号 | 问题 | 影响 |
|---|------|------|------|------|
| UI-1 | `views/system/mail/log/data.ts` | 231 | `innerHTML` 渲染邮件模板内容无 sanitize | XSS |
| UI-2 | `components/markdown-view/markdown-view.vue` | 50 | `v-html` 渲染 Markdown 无 DOMPurify | XSS |
| UI-3 | `scripts/deploy/nginx.conf` | 58 | `Access-Control-Allow-Origin: *` 通配符 | CSRF / 凭据盗取 |
| UI-4 | `.env.development` | 18-21 | 硬编码默认账号密码 `admin/admin123` | 凭据泄露 |
| UI-5 | `.env` | 29-35 | API 加密密钥明文写在源码中 | 加密失效 |

### 4.2 中危

| # | 文件 | 行号 | 问题 | 影响 |
|---|------|------|------|------|
| UI-6 | `packages/stores/src/setup.ts` | 24-45 | Token 存 localStorage（XSS 可读） | token 盗取 |
| UI-7 | `api/core/auth.ts` | 71-75 | Refresh token 通过 URL query 参数传递 | 日志/历史泄露 |
| UI-8 | nginx.conf | — | 缺失 CSP / X-Frame-Options / HSTS 等安全头 | 攻击面扩大 |
| UI-9 | `api/request.ts` | 36,91,113 | `console.warn`/`console.error` 留在生产代码中 | 调试信息泄露 |
| UI-10 | `.env` | 8 | `VITE_APP_STORE_SECURE_KEY=please-replace-me-with-your-own-key` 占位符 | 上线忘替换 |

---

## 五、修复优先级

### 阻断级（上线前必须修复）

| 编号 | 问题 | 涉及 |
|------|------|------|
| F-1 | ControllerRegistry 线程安全 | 框架 |
| F-2 | `_rateLimitInterceptor!!` 空安全 | 框架 |
| F-5 | softDeleteConfig `!!` NPE | 框架 |
| M-1,P-1 | Logic 绑定缺失（共 6 个） | 业务模块 |
| M-2,P-2,PL-4 | admin 接口无 `@Permission` | 全部业务模块 |
| P-3 | `/pay/order` 路由冲突 | payment |
| P-4 | `@Body` 注解缺失 | payment |
| P-5 | 钱包充值无乐观锁 | payment |
| PL-1 | appSecret 弱随机生成 | platform |
| PL-2 | appSecret 明文返回 | platform |
| PL-3 | 签名无 timestamp 过期校验 | platform |
| A-1,A-2 | 硬编码凭据 | 脚手架 |
| A-10 | DeptLogic/PostLogic 未绑定 | 脚手架 |
| UI-1,UI-2 | XSS 漏洞 | 前端 |

### 必修不阻断

| 编号 | 问题 |
|------|------|
| F-3 | 内置认证器空实现 |
| F-6 | Cookie 绑定 NPE |
| F-8 | Redis 吞异常 |
| M-3,M-4,M-5 | SMS 验证码安全链 |
| A-4,A-8 | 批量删除绕过校验 |
| UI-3 | CORS 通配 |
| UI-6,UI-7 | Token 存储 / Refresh token URL 传递 |

### 低优先级

| 编号 | 问题 |
|------|------|
| F-10 | POSIX 环境变量 |
| F-12 | JSON 序列化 |
| F-14,F-15 | 死代码 / bootstrap 模式 |
| P-9 | 魔法数字 |
| PL-7 | 订单号可预测 |
| UI-9,UI-10 | console 语句 / 占位符 |
