# 文件存储配置闭环

状态：实现，验收记录见文末。归属：module-infra / front-infra；驱动由 neton-storage 的 StorageOperatorFactory 提供，复用应用持有的 Neton HttpClient，不新建或关闭共享客户端。

## 配置契约

- `storage=0` 本地，`storage=1` S3 兼容。旧值 2/3 不作为已实现的 OSS/COS 原生驱动；厂商提供 S3 兼容端点时使用 1。
- 配置包含本地目录，或 endpoint / region / bucket / pathStyle，以及可选公开 baseUrl。访问凭证仅存环境变量名 `NETON_STORAGE_*`，不接受或返回明文密钥。
- 部署通过 `[file_storage] local_root` 限制后台可配置的本地根目录，`allowed_endpoints` 精确列出允许的 S3 endpoint；未配置不允许后台创建该类型。配置权限不等于任意文件系统/网络权限。
- 创建/更新必须校验具体配置。旧空配置可查看并修复，但不得测试成功或激活。分页与详情使用 DTO，不输出旧 config 原文。
- 真实测试执行随机探针 write/read/delete，限时，异常只返回稳定错误码；不以名字非空代替连通性。测试是写操作，需要 update 权限，使用 POST。

## 运行时和一致性

- 后台主配置用于新上传；无主配置时保持启动时 StorageOperator 兼容行为。新文件记录 configId；历史 null 继续使用启动默认源。
- 主配置切换不迁移数据。读、物理清理根据文件 configId 定位，而不是按当前主配置猜测。
- 配置变更持独占事务咨询锁；上传的配置选择/写入/登记持同 key 共享锁，允许上传间并行，防止配置检查与新文件引用之间的竞态。数据库部分唯一索引约束只能有一个 master。
- 新配置文件路径为 `platform/sources/{configId}/{assetDir}/{hash-prefixes}/{hash}.{ext}`，防止不同配置指向同一个桶时互相误删；null 历史文件保持原路径。全局 CDN 配置只用于 null/default 源；动态源使用自己的公开地址或鉴权中转，不套用其他源的 CDN。
- 已被文件引用的配置不可改变驱动及具体配置，删除也拒绝；只允许改名称/说明、切换主配置。迁移数据需另行设计，不能靠修改桶名实现。
- 普通 CRUD 使用既有后台操作审计；不记录凭证、配置 payload。配置变更成功不意味着已测通；激活主配置必须先完成真实探针。
- 旧 admin 预签名接口明确返回 `FILE_STORAGE_PRESIGN_UNSUPPORTED`，避免绕开标准上传的格式、配额和生命周期检查；禁止返回假 URL。未来开放直传必须另做上传授权和完成确认闭环。

## 部署与升级

在 `config/infra.conf` 中声明后台可用的范围（不是业务字段）：

```toml
[file_storage]
local_root = "/srv/neton/files"
allowed_endpoints = ["https://s3.example.com"]
```

后台本地目录填写 `images`，实际目录为 `/srv/neton/files/images`。部署方负责根目录所有权，不允许非可信用户在目录树创建符号链接。
S3 密钥例如 `NETON_STORAGE_MEDIA_ACCESS_KEY` / `NETON_STORAGE_MEDIA_SECRET_KEY`，由进程环境注入；后台填写变量名，不填写变量内容。不要把业务私有文件放到公开桶。

先执行 V003 迁移。此前主配置没有驱动实际上传，迁移会撤销旧 master 标记，继续使用原启动默认源；管理员修复旧配置、真实测试并明确激活后，才改变新文件写入目标。既有数据不移动、不删除。改址请新建，不要改环境外部挂载来绕过不可变规则。配置修改、切换不需要重启；变更进程环境仍需重启。

本轮没有实现原生 OSS/COS/FTP/SFTP 驱动，也没有后台密钥保险库；不应在选择框宣称这些能力已实现。S3 兼容须以厂商实际协议支持和部署实测为准。

## 验收

类型/字段验证、环境引用隔离、旧配置脱敏、测试失败及清理、取消传播；本地真实读写；主配置互斥、引用不可变、切换后旧文件可读/可清理；前端动态字段、失败保留表单、权限、双语；隔离数据库验收不得碰生产。

### 2026-11-24 验收记录（macOS ARM64）

- Framework：`:neton-storage:macosArm64Test` 51 项通过（含 S3 HTTP 契约夹具），`updateKotlinAbi` 后独立运行 `checkKotlinAbi` 通过。公开工厂为加法 API；没有发布新制品。
- module-infra：`./gradlew macosArm64Test` 95 项通过；`PG_BIN=/opt/homebrew/opt/postgresql@16/bin bash scripts/test-file-storage-postgres.sh` 32 项数据库契约全部通过。新探针标记 `FILE_STORAGE_POSTGRES_PASS` 验证真实磁盘上传、主配置切换后历史读取、引用不可变、批量回滚、旧配置脱敏修复、并发唯一主配置。数据库夹具先装载 system 依赖迁移，再装载 infra 迁移；临时数据库和文件目录自动清理。
- front-infra：`pnpm typecheck`，`pnpm test` 4 项通过；`pnpm test:browser` 无头 Chromium 通过，实际页面配合隔离 HTTP 夹具验证动态 Local/S3 字段、失败不丢表单、POST 探针、详情回填、只读权限和双语。此项是 UI 测试，**不冒充真实 S3 或完整部署验收**。
- 未操作生产配置/数据。未实测各厂商 OSS/COS 端点；上线仍需用部署凭证在目标服务执行真实探针。当前不承诺原生厂商协议、上传断点续传、后台明文密钥管理或自动数据搬迁。
