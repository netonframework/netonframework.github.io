# TOTP MFA 与三态登录

> 2026-10-11 · 实施规范 · 归属 module-system / front-system
> 本期交付系统管理员端；会员端遵循相同协议，须单独集成其 unified-token 发行链，不能据此宣称会员 MFA 已上线。

## 1. 用户体验与状态

系统用户管理提供「必须绑定 MFA」、只读「已绑定」状态和管理员重置。已绑定用户即使取消强制要求也继续验证 MFA，不自动解绑。

| 密码/第一因子通过后的状态 | 响应 | 行为 |
| --- | --- | --- |
| 未绑定且不要求 | authenticated | 签发正式会话 |
| 未绑定且要求 | mfa_enrollment_required | 扫码/手动密钥绑定，输入正确 TOTP 才生效 |
| 已绑定 | mfa_required | 输入 TOTP，成功后签发正式会话 |

两个需要 MFA 的分支仅返回随机短时 challengeToken，不返回 accessToken、refreshToken 或登录 Cookie。challengeToken 不采用普通 JWT，认证器不能接受它。前端 MFA 页由 front-system 提供，登录壳负责跳转；挑战仅存当前标签页 sessionStorage，不放 URL 或持久 localStorage。

## 2. API

组内前缀 `/system/auth`：登录结果保留成功字段，新增 status。未完成 MFA 的响应仅包含 status、challengeToken、challengeExpiresAt，敏感令牌字段省略。

- POST `/mfa/enrollment`：challengeToken 换取绑定 secret 和 otpauthUri，仅绑定挑战可用；响应禁止缓存。
- POST `/mfa/verify`：challengeToken + 6 位 code；绑定确认和登录验证共用，成功返回 authenticated 和正式令牌。
- GET `/system/user/mfa/{id}`：required / bound 状态，要求 system:user:query。
- PUT `/system/user/mfa/{id}`：设置 required，要求 system:user:update。
- POST `/system/user/mfa/{id}/reset`：清除绑定、保留 required、失效旧会话及挑战，要求 system:user:update-password。禁止远程自重置。

所有现存管理员登录方式（密码、短信、社交）必须经相同 MFA 分流。刷新只能使用已完成认证的 refresh token，不创建 MFA 挑战，校验用户状态和 MFA 修订版本。

## 3. TOTP 与存储

标准 RFC 6238：HMAC-SHA1、6 位、30 秒，允许前后各一步时钟偏移；CSPRNG 生成 160 位独立密钥，Base32 编码，兼容 Google/Microsoft Authenticator。二维码在前端本地生成，禁止将密钥送入外部二维码服务。

持久化采用 module-system 自有表，不依赖 system_users 的迁移顺序。密钥使用 AES-256-GCM 加密，主密钥来自服务端 `NETON_MFA_MASTER_KEY`（Base64 的 32 字节），不写库、不输出日志；部署必须备份主密钥，丢失后无法恢复绑定。无密钥时不能开启强制 MFA、不能绕过已有绑定。

本期使用 PostgreSQL 事务存储挑战与重放状态，无第三方在线认证服务依赖。挑战有效期 5 分钟、最多 5 次尝试；多实例通过行锁串行校验、原子消费，错误计数必须提交，不能随抛错回滚。每次密码登录替换该用户上一个待完成挑战，避免无限积累预算。还须保留 IP 请求限流；密码持有人反复开启新挑战的风险由第一因子入口限流控制。

未确认密钥仅绑定于挑战；绑定确认原子落库。成功 TOTP 时间步必须大于已消费时间步，阻止跨挑战重放。过期、用途错误、策略版本变化、账号禁用/删除、密码变化均拒绝。成功消费后签发失败应重新登录，不能恢复旧挑战。

## 4. 会话与恢复

每个用户保存 MFA revision；强制策略变更与重置递增 revision。正式 access/refresh token 携带 revision，认证入口验证当前状态；旧 revision 失效。开启 MFA 不能让旧无 MFA 会话继续访问。先发 Token 再遮住页面不符合本规范。

重置需确认并记录操作人/目标/动作，不记录密钥或验证码。唯一超级管理员丢失设备时，受控服务器终端可事务性清除其密钥并递增 revision；保留 required，下次凭密码重新绑定。此途径不是公开恢复 API。首版不提供自助恢复码。

## 5. 模块边界与验收

- module-system：挑战、加密持久化、用户策略、统一登录分流、刷新验证。
- front-system：MFA 页面、用户 MFA 管理控件。
- 前端壳/运行时：三态识别、公开 MFA 页面挂载、Cookie 请求。
- 应用认证 bridge：令牌 revision 检查；未升级 bridge 的发行版不能宣布 MFA 完成。
- neton-security：通用 TOTP 算法和 RFC 测试向量，不含业务用户模型。

验收：RFC 时间向量；绑定确认前无正式令牌；错误次数与到期；重放/并发最多一个成功；策略变化与重置撤销旧会话；匿名挑战无法访问业务 API 或刷新；扫码绑定与验证码登录 UI；取消强制不解除绑定；全部管理员第一因子路径一致。密钥/挑战/验证码不得出现在日志或 URL。

生产上线需执行迁移、配置主密钥、升级模块与认证桥、验证实际前端发行版；本规范不是部署完成声明。

## 6. 部署与验证边界

部署前通过安全终端生成主密钥（例如 `openssl rand -base64 32`），以服务端密钥管理方式注入 `NETON_MFA_MASTER_KEY`，不得使用 `NEXT_PUBLIC_` 前缀、提交仓库或输出到部署日志。所有实例使用同一主密钥并备份；首版不支持直接更换密钥，轮换需另行设计重加密迁移。

执行 module-system 的 `V003__system_mfa.sql` 后再启用新版应用。前端需要同时更新 front-system、front-runtime 与登录外壳。先为一个有备用管理员可恢复的测试账号开启强制 MFA，验证绑定、重新登录、刷新与管理员重置，再逐步启用；不要一次性强制所有管理员。

自动测试中的内存数据库适配器用于验证服务状态机、错误预算与并发单次消费契约，不代替真实 PostgreSQL 事务/锁集成验收。真实 PostgreSQL 并发和生产前端浏览器完整流程已于 2026-10-11 完成本地验收，范围、结果和复现方式见 [MFA 数据库并发与浏览器验收](./mfa-acceptance.md)。跨主机部署仍需按实际环境验收。
