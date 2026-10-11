# neton-application 项目介绍与规范说明

> 本文档描述 neton-application 的定位、架构、配置与 API 规范，供开发与对接使用。
> 最后更新：2026-02-26
>
> 开发硬规范请同时参考 [ENGINEERING_RULES.md](./ENGINEERING_RULES.md)。
>
> 安全整改执行请同时参考 [认证与短信防滥用规范](./auth-abuse-protection-spec.md)。
>
> 模块模板规范请同时参考 [模块模板规范](./module-template-spec.md)。
>
> 应用层 RBAC 实现规范（User/Role/Menu/权限串/通配/super_admin/缓存/RouteGroup 命名空间）请参考 [rbac-spec.md](./rbac-spec.md)。

> 登录与短信防滥用（可信代理链、失败节流、短信额度、人机验证与 MFA 分期）请参考 [auth-abuse-protection-spec.md](./auth-abuse-protection-spec.md)。

---

## 一、项目简介与定位

**neton-application** 是基于 [Neton](https://github.com/your-org/neton) 框架构建的**企业级后台 API 服务**，采用 Kotlin/Native 编译为原生二进制，面向管理后台与 C 端/开放平台提供统一后端能力。

| 维度 | 说明 |
|------|------|
| **定位** | 通用后台管理脚手架后端，对标 ruoyi-vue-pro 裁剪版（无 mall/risk） |
| **运行形态** | 单进程、单可执行文件，无 JVM 依赖 |
| **对接前端** | **neton-application-front**（React 19 + Next.js）为官方管理端；**neton-application-admin**（Vue3）为双轨期旧版，逐步下线 |
| **运行指标** | 冷启动 ~150ms（debug）/ ~3ms（release），内存约 ~20MB |

### 技术栈

| 项目 | 选型 |
|------|------|
| 语言 | Kotlin 2.4.20 (Multiplatform) |
| 框架 | Neton 1.0.0-beta1 |
| 编译 | Kotlin/Native → 原生二进制（.kexe） |
| 数据库 | **PostgreSQL**（发行版唯一支持的数据库，见 §6.1） |
| 认证 | 身份域隔离的 JWT + 服务端会话（见 [身份域与会话边界](identity-realm.md)） |
| 构建 | Gradle 8.14 + KSP |
| 日志 | 结构化 JSON，异步写入，多 Sink |

---

## 二、仓库与模块结构

### 2.1 多仓库与 Composite Build

实际为**多仓库 + Gradle Composite Build**，每个模块一个仓库，发行版只负责装配：

| 仓库 | 内容 |
|------|------|
| `neton` | 框架（neton-core、neton-http、neton-database、neton-security 等） |
| `neton-application` | 通用发行版：application 入口、配置、CI；不含业务模块代码 |
| `neton-application-module-system` | 管理员身份、认证与会话、RBAC、MFA、验证码、审计、配置 |
| `neton-application-module-infra` | 文件、定时任务、API 日志、Redis 监控等基础设施 |
| `neton-application-module-account` | 终端用户账号：注册登录、资料、手机 / 邮箱 / 密码、账号会话 |
| `neton-application-module-member` | 会员成长：等级、积分、签到、邀请、分组标签（依赖 account） |
| `neton-application-module-payment` / `-platform` / `-cs` | 支付、开放平台、客服 |
| `neton-application-front`（及 `-front-*` 模块） | 管理端前端壳与各模块页面 |

目录约定：所有仓库位于同一工作区，`Neton/` 与 `privchat/` 同级；`settings.gradle.kts` 与框架的
`includeBuild` 都按这个布局写相对路径。干净环境的检出清单与锁定版本见
`neton-application/scripts/ci/dependencies.lock`。

### 2.2 发行版结构

```
neton-application/
├── application/
│   ├── src/commonMain/kotlin/Main.kt   # 启动入口（只装配模块与基础设施 DSL）
│   └── config/                         # 运行时配置（TOML）：application / database / routing …
├── scripts/ci/                         # 依赖锁定与检出脚本
├── tests/security/                     # 身份域与会话 E2E
├── build.gradle.kts / settings.gradle.kts
```

鉴权装配（认证器、身份域、权限评估器）由 module-system 的 `SystemSecurityConfig` 提供，发行版不再自带
SecurityConfig。迁移脚本在各模块仓库的 `sql/postgresql/`，经 `application.kexe migrate up` 显式执行，
启动只检查不执行。

### 2.3 模块依赖关系

```
application
├── module-system        ← 核心（管理员、认证、RBAC、MFA、验证码、审计、配置）
├── module-infra         ← 依赖 system
├── module-account       ← 依赖 system、infra（终端用户身份域）
├── module-member        ← 依赖 account（会员成长）
├── module-payment       ← 依赖 system、account
├── module-platform      ← 依赖 system
└── module-cs            ← 依赖 account、payment
```

---

## 三、架构设计

### 3.1 分层架构

```
Controller  ──  HTTP 路由、参数绑定、@Permission、统一响应包装
     │
   Logic    ──  业务逻辑、事务编排、调用 Table
     │
   Table    ──  数据访问（KSP 生成 *TableImpl，CRUD + query/page）
     │
   DB       ──  PostgreSQL（由 database.conf 指定）
```

- **Controller**：仅做参数解析与调用 Logic，不直接操作 Table。
- **Logic**：分页接口统一返回 `dto.PageResponse<T>`，便于 JSON 序列化。
- **Table**：Facade 委托 KSP 生成的 Impl，表名与字段由 `@Table` / 注解约定。

### 3.2 路由组与挂载路径

由 `application/config/routing.conf` 定义，**所有管理端接口均以 `/admin` 为前缀**，C 端/开放接口分别挂载到 `/app`、`/platform`：

| 路由组 | 挂载路径 | 用途 | requireAuth |
|--------|----------|------|-------------|
| `admin` | `/admin` | 管理后台 API（neton-application-front 对接） | true |
| `app` | `/app` | C 端/移动端 API（会员、支付等） | true |
| `open` | `/platform` | 开放平台 API（签名计费等） | 按需 |

示例：

- 管理端登录：`POST /admin/system/auth/login`
- 获取权限信息：`GET /admin/system/auth/get-permission-info`
- 用户分页：`GET /admin/system/user/page?page=1&size=10`
- 健康检查（根路径，无前缀）：`GET /` → `{"status":"ok","service":"neton-application","version":"1.0.0"}`

**重要**：路由组需配置 `requireAuth = true`，否则带 `Identity` 的接口会因未注入认证信息而 500。

### 3.3 安全与认证

- **认证方式**：JWT，`Authorization: Bearer <accessToken>`；管理端浏览器用 HttpOnly 会话 Cookie，凭 Cookie 的写请求须带 `X-Neton-Csrf: 1`。
- **身份域**：`/admin` 只认管理员令牌，`/app`、`/manage` 只认账号令牌，refresh 令牌不能访问接口；规则见 [身份域与会话边界](identity-realm.md)。
- **装配**：module-system 的 `SystemSecurityConfig` 注册认证器、默认 Guard 与通配权限评估器；JWT 密钥只能由 `NETON_SECURITY__JWT__SECRETKEY` 注入。
- **超级管理员**：角色码 `super_admin` 在 PermissionEvaluator 中视为拥有所有权限，不依赖菜单权限数据。

默认账号（以 init_data 为准）：用户名 `admin`，登录口令 `admin123`；数据库中保存的是框架标准哈希值（生产请立即修改并更换 JWT 密钥）。

---

## 四、配置规范

### 4.1 配置文件位置与优先级

- 配置文件位于 **`application/config/`**，运行时可从 **`application`** 目录启动，或通过工作目录/环境变量指定 config 路径。
- 优先级：CLI 参数 > 环境变量 > 环境配置文件（如 `application.prod.conf`）> 基础配置文件 > 框架默认值。
- 环境切换：`./application.kexe --env=prod` 会加载 `application.prod.conf` 等覆盖项。

### 4.2 application.conf 要点

```toml
[application]
name = "neton-application"
debug = false

[server]
port = 8080
host = "0.0.0.0"

[database]
driver = "POSTGRESQL"   # 只支持 PostgreSQL，其他驱动启动即拒绝
uri = "postgresql://postgres:postgres@localhost:5432/neton-application"

[logging]
level = "INFO"
# async、sinks 等见实际文件
```

### 4.3 database.conf

与 `application.conf` 中 `[database]` 保持一致，供数据库组件单独加载时使用，例如：

```toml
[default]
driver = "POSTGRESQL"
uri = "postgresql://postgres:postgres@localhost:5432/neton-application"
debug = false
```

### 4.4 routing.conf

```toml
[[groups]]
group = "admin"
mount = "/admin"
requireAuth = true

[[groups]]
group = "app"
mount = "/app"
requireAuth = true

[[groups]]
group = "open"
mount = "/platform"
```

---

## 五、API 规范

### 5.1 统一响应体

框架层对业务返回值做统一包装，HTTP 200 时 body 格式为：

```json
{
  "code": 0,
  "msg": "success",
  "data": <Controller 返回值序列化>
}
```

- **成功**：`code = 0`，`msg = "success"`，`data` 为业务数据（可为 `null`）。
- **业务/校验错误**：如 400，`code` 为 4xx，`msg` 为错误信息，`data` 常为 `null`。
- **服务端错误**：500 时 `code = 500`，`msg = "Internal Server Error"`，`data = null`。

前端应统一根据 `code === 0` 判断成功，再使用 `data`。

### 5.2 分页规范

- **请求**：分页接口统一使用查询参数 `page`、`size`（从 1 开始，缺省由各接口定义）。
- **响应**：分页数据放在 `data` 中，类型为 `PageResponse<T>`：

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "items": [ /* 当前页列表 */ ],
    "total": 100,
    "page": 1,
    "size": 10,
    "totalPages": 10
  }
}
```

- **后端约定**：Logic 层分页方法返回 `dto.PageResponse<T>`（定义在 module-system），禁止直接返回框架内部的 `Page<T>`（不可序列化）。

### 5.3 认证相关接口示例

| 说明 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 登录 | POST | `/admin/system/auth/login` | Body: `{"username","password"}`，返回 accessToken、refreshToken 等 |
| 登出 | POST | `/admin/system/auth/logout` | 需 Bearer Token |
| 刷新 Token | POST | `/admin/system/auth/refresh-token` | Body: `{"refreshToken"}`；refresh 令牌只能用一次 |
| 全端退出 | POST | `/admin/system/auth/logout-all` | 作废该管理员所有会话 |
| 获取权限信息 | GET | `/admin/system/auth/get-permission-info` | 需 Bearer Token，返回 roles、permissions、menus |

### 5.4 错误与异常

- 业务校验/资源不存在：抛出框架 `BadRequestException` / `NotFoundException` 等，由框架映射为对应 HTTP 状态码和上述 `{ code, msg, data }`。
- 未认证访问需认证接口：401。
- 无权限：403。

---

## 六、数据与 SQL 规范

### 6.1 数据库支持

- **只支持 PostgreSQL。** 各模块只提供 `sql/postgresql/` 迁移，MFA、会话版本等依赖 PostgreSQL 的
  `ON CONFLICT` / `FOR UPDATE`。`database.conf` 配成其他驱动时 module-system 在启动时拒绝并说明原因。
- 迁移由 `application.kexe migrate up` 显式执行，已执行的脚本有校验和，禁止修改。

### 6.2 脚本命名与顺序

- `V001__create_tables.sql`：建表。
- `V002__init_data.sql`：初始数据（如管理员账号、默认角色等）。
- 扩展模块若带独立 V 系列，需在主库同库内按模块依赖顺序执行，避免外键/依赖缺失。

### 6.3 表命名

- system：`system_*`（如 `system_users`、`system_roles`、`system_menus`）。
- infra：`infra_*`。
- member / payment / platform：各模块自有前缀（见各仓库 sql 目录）。

---

## 七、构建与运行

### 7.1 环境要求

- **JDK 17+**（仅构建需要，运行时不需要 JVM）
- **Gradle**：使用项目 wrapper
- **PostgreSQL** 与 **Redis**：提前建库，用 `application.kexe migrate up` 执行迁移
- **JWT 密钥**：环境变量 `NETON_SECURITY__JWT__SECRETKEY`，至少 32 个随机字符（占位值会被拒绝启动）

### 7.2 编译

在 **neton-application** 根目录执行：

```bash
# macOS ARM64 (Apple Silicon)
./gradlew :application:linkDebugExecutableMacosArm64

# 其他平台
./gradlew :application:linkDebugExecutableMacosX64   # macOS x64
./gradlew :application:linkDebugExecutableLinuxX64    # Linux x64
./gradlew :application:linkDebugExecutableLinuxArm64  # Linux ARM64
./gradlew :application:linkDebugExecutableMingwX64    # Windows x64
```

Release：将 `linkDebugExecutable*` 换为 `linkReleaseExecutable*`。

### 7.3 运行

**必须从 `application` 目录启动**，以便正确加载 `application/config/` 下配置：

```bash
cd neton-application/application
./build/bin/macosArm64/debugExecutable/application.kexe
```

默认监听 **http://0.0.0.0:8080**。生产可指定环境：`./application.kexe --env=prod`。

### 7.4 验证

```bash
curl http://localhost:8080/admin/system/health/live    # 进程存活
curl http://localhost:8080/admin/system/health/ready   # 数据库与 Redis 可用，否则 503
```

---

## 八、与前端对接（neton-application-front）

### 8.1 对接关系

- **管理端前端**：**neton-application-front**（React + Next.js）为官方管理端，模块页面与后端模块一一对应；
  vben 版（neton-application-admin）为双轨期旧版。
- **后端前缀**：管理端接口统一为 **`/admin`**，例如 `/admin/system/user/page`。
- 前端默认同源访问后端（nginx 反代 `/admin/`）；会话用 HttpOnly Cookie，不在浏览器存令牌。

### 8.2 联调顺序

1. 启动 PostgreSQL 与 Redis。
2. `NETON_SECURITY__JWT__SECRETKEY=<随机串> application.kexe migrate up`。
3. 启动后端：`application.kexe`（同样需要上述环境变量）。
4. 启动前端：`cd neton-application-front && pnpm install && pnpm dev`。
5. 使用默认账号登录（`admin` / `admin123`），**首次登录后立即修改密码**。

---

## 九、扩展与开发约定

### 9.1 新增 Controller

- 使用 `@Controller("/xxx")`、`@Get`/`@Post` 等注解，KSP 自动生成路由注册，无需手写路由表。
- 管理端接口放在对应模块的 `controller/admin/` 下，路径会挂到该模块所属路由组（如 admin 的 `/admin`）。

### 9.2 新增分页接口

- Logic 层返回 `dto.PageResponse<T>`，例如：
  `return PageResponse(result.items, result.total, page, size, totalPages)`
- 确保 T 可序列化（如 `@Serializable` 的 VO/Model）。

### 9.3 新增 Model 与 Table

- Model：`@Table("表名")`、`@Id`、`@CreatedAt`/`@UpdatedAt`/`@SoftDelete` 等注解，KSP 生成 *TableImpl。
- Table Facade：`object XxxTable : Table<Xxx, Long> by XxxTableImpl`，可在此增加自定义方法。

### 9.4 KSP 与清理

- 若修改 Model/Table 后出现 “Unresolved reference *TableImpl”，可清理 KSP 缓存后全量编译，例如：
  `rm -rf module-system/build/generated/ksp module-system/build/kspCaches`
  再执行 `./gradlew :application:linkDebugExecutableMacosArm64`。

---

## 十、当前实现状态摘要

| 模块 | 说明 | 完成度 |
|------|------|--------|
| System | 认证、用户/角色/菜单/权限/部门/岗位/字典/日志/通知/消息/社交 | 100% |
| Infra | 配置、文件、定时任务、API 日志、Redis 监控 | 100% |
| Member | 会员认证、用户/等级/积分/签到/地址/分组/标签/配置 | 100% |
| Payment | 应用/渠道/订单/退款/钱包/充值/转账/回调查询；Webhook 回调端点待实现 | ~94% |
| Platform | 客户端/API/授权/计费/日志/统计/开放 API | 100% |

Payment 模块剩余 3 个 Webhook 回调端点（order/refund/transfer）为 v1 唯一待实现项。

---

## 十一、文档与参考

| 文档 | 说明 |
|------|------|
| **README.md** | 快速开始、配置示例、构建命令、开发示例 |
| **SPEC.md** | 本文档：项目介绍、架构与标准化规范 |

若规范与代码不一致，以代码与当前 config 为准；建议修改代码或配置后同步更新本文档。
