# infra 媒体标准

> 标识：NETON-APP-INFRA-MEDIA
> 日期：2026-10-15 · 状态：Draft r2（关联契约、临时文件生命周期、按引用授权、并发安全清理；2026-10-15 按 M1 实现校准）
> 归属：`neton-application-module-infra`（在现有文件上传能力上扩展）
> 适用：所有需要图片、视频、音频、附件的模块与产品，例如新闻配图、商品图、评论图片、用户头像、视频源文件。

## 实现状态（2026-10-15）

| 项 | 状态 |
| --- | --- |
| businessType 注册表开放：`FileBusinessPolicyRegistry`（`bindIfAbsent`）+ `FileBusinessPolicy` 新字段（access、usages、reusable、managedLifecycle、temporaryHours、orphanedDays、assetDir） | M1 已实现（3cc1008） |
| 临时文件生命周期与引用登记（V007：`infra_files.lifecycle` / `lifecycle_at` / `purged_at`、`infra_media_references`） | M1 已实现 |
| `port.MediaService`：attach / detach / detachAll / resolve / importFromUrl，行锁内校验 | M1 已实现 |
| `DELEGATED` 访问（唯一绑定的 `port.MediaOwnerAccess`）、非公开文件短期 HMAC 签名地址 | M1 已实现 |
| 清理任务 `infra-media-cleanup`（每小时第 41 分），路径咨询锁内物理删除 | M1 已实现 |
| 服务端转存 `importFromUrl`（http/https、按解析结果拦截内网并钉住地址、超时、大小上限、MIME 嗅探） | 已实现 |
| 后台媒体上传 `POST /admin/infra/media/upload`、后台读取 `GET /admin/infra/media/get/{fileId}`、`MediaService.resolveForAdmin`（V008） | 已实现（ce01341） |
| 默认 `SerializerDomainEventCodec` 由 infra 绑定（套件模块向它登记可重试事件） | 已实现 |
| 用途级引用数量上限、视频「处理中」状态校验 | 延后（随 M4） |
| `MediaKind`、`Retention` 独立结构、按派生规格展开（`variant`） | 未采用 / 延后（M1 用平铺字段；派生随 M2） |
| 图片派生版本 | 延后（M2；`ImagePolicy` 只有字段，不执行） |
| 分片 / 断点续传、秒传 | 延后（M3） |
| 视频处理、`MediaProcessor` | 延后（M4） |
| 事件 `infra.media.*` | 延后（M1 不发事件） |
| 后台 businessType 列表、按引用对象浏览、存储用量统计 | 延后（M1 文件页只加了生命周期与引用数） |

## 1. 原则

- **一个入口**：所有媒体经 infra 上传、存储、处理和访问。业务模块不自己对接对象存储，也不自己转码。
- **只存引用**：业务数据保存 `MediaRef(fileId)`，不保存 URL。访问地址由 infra 按访问者、存储配置和派生规格生成；更换存储或 CDN 时业务数据不变。
- **业务类型驱动**：每类上传是一个 businessType，由拥有它的模块注册，策略随类型走。
- **访问控制归拥有者**：公开或仅本人的规则由 infra 直接判断；依赖业务状态的访问（例如会员可见的文章里的图片）回调拥有模块判断。一句话：**infra 负责文件与派生资源；业务模块决定对象能否被访问；二者通过授权契约协作。**
- **上传成功不等于可以使用**：上传得到的是临时文件，经业务模块确认关联后才进入生命周期（§6）。
- **只管平台托管的文件**：外部链接（来源原文、合作方跳转）不是媒体，由业务模块按 `ExternalLink` 保存；需要纳入平台的外部文件经服务端转存（§4.3）。

## 2. 现状（2026-10-15）

| 能力 | 现状 |
| --- | --- |
| 用户端单文件上传 `POST /app/infra/file/upload`（multipart，`file` + `businessType`） | 已有 |
| businessType 策略：MIME 白名单、大小上限、可见性（PUBLIC / PRIVATE） | 已有；M1 起模块可注册（§3） |
| 内容寻址存储路径（`{businessType}/{sha256 前缀}/{sha256}.{ext}`）与 fileId | 已有 |
| `GET /app/infra/file/get/{fileId}` 按可见性读取 | 已有；M1 起接受签名参数，并按引用判断 `DELEGATED` |
| 后台上传、预签名地址、多存储配置（主存储切换） | 已有 |
| 图片处理策略 `ImagePolicy` | 只有字段，未执行 |
| 委托授权、引用登记与清理 | M1 已补齐 |
| 分片 / 断点续传、视频处理 | 没有 |

本规范描述补齐后的标准；已有接口保持语义不变并纳入标准。上表是 M1 之前的基线，当前状态见文首「实现状态」。

## 3. 业务类型注册

目标形态（设计稿）：

```kotlin
mediaRegistry.register(
    MediaBusinessType(
        code = "content.image",                     // <模块>.<用途>
        kinds = setOf(MediaKind.IMAGE),             // IMAGE / VIDEO / AUDIO / FILE
        allowedMimeTypes = setOf("image/jpeg", "image/png", "image/webp", "image/gif"),
        maxSizeBytes = 20 * MB,
        access = MediaAccess.DELEGATED,             // PUBLIC / OWNER / DELEGATED
        image = ImagePolicy(variants = listOf(
            ImageVariant("thumb", width = 360, fit = Fit.COVER, format = "webp"),
            ImageVariant("large", width = 1440, fit = Fit.INSIDE, format = "webp"),
        )),
        usages = setOf("content.image"),            // 可以 attach 到哪些用途
        reusable = true,                            // 已关联后能否被其他对象再次引用
        retention = Retention(temporaryHours = 24, orphanedDays = 7),
    )
)
```

**M1 实际 API**：在已有的 `logic.FileBusinessPolicy` 上扩展字段，不另起 `MediaBusinessType`；`kinds`、`image` 派生、`Retention` 结构未采用（宽限期是平铺字段）。

```kotlin
// 模块 bootstrap 里：
ctx.get(FileBusinessPolicyRegistry::class).register(
    FileBusinessPolicy(
        businessType = "content.image",            // <模块>.<用途>，注册时校验格式且不能重复
        access = MediaAccess.DELEGATED,            // PUBLIC / OWNER / DELEGATED
        allowedMimeTypes = setOf("image/jpeg", "image/png", "image/webp", "image/gif"),
        maxSizeBytes = 20L * 1024 * 1024,
        imagePolicy = null,                        // 预留，M2 才执行
        usages = setOf("content.image", "content.cover"),   // 空 = 只允许与类型同名的用途
        reusable = true,                           // 已关联后能否被其他对象再次引用
        managedLifecycle = true,                   // 参与「临时 → 关联 → 孤儿 → 清理」；内置类型一律 false
        temporaryHours = 24,                       // 仅 managedLifecycle 时生效
        orphanedDays = 7,
        assetDir = "content-image",                // 物理目录 platform/{assetDir}/…；新登记的类型必须填
    )
)
```

- 存储路径仍由脚手架决定（内容寻址 `{sha256[0..2)}/{sha256[2..4)}/{sha256}.{ext}`），策略只声明目录名。
- 套件里已注册的类型：`content.cover` / `content.image` / `content.video` / `content.attachment`、`comment.image`（`DELEGATED`）、`collect.media`（`PUBLIC`，供 collect 转存）。

| 访问方式 | 判断 |
| --- | --- |
| `PUBLIC` | 任何人可读（头像、公开文章配图） |
| `OWNER` | 仅上传者可读（反馈附件、证件） |
| `DELEGATED` | 按引用判断：调用引用对象所属模块的 `ObjectAccessPolicy`，详见 §7.1 |

- businessType 只能由模块在初始化时注册，未注册的类型拒绝上传。
- 内置类型保留：`member.avatar`、`feedback.attachment` 等现有类型迁入注册表（`FileBusinessPolicyRegistry.default()`），code 不变，行为不变（不进托管生命周期）。

## 4. 上传

### 4.1 单文件上传

保持现有 `POST /app/infra/file/upload`，适合 ≤ 20MB 的图片和附件。托管类型（`managedLifecycle`）上传后为 temporary，需业务模块 attach。

**后台上传**（ce01341，V008）：`POST /admin/infra/media/upload`，multipart `file` + `businessType`，权限点 `infra:media:upload`，按用户限流 60 次/分钟；与 App 上传同一套策略与落盘路径。返回 fileId，非公开文件的 url 为后台读取地址。

- 后台账号与应用账号是两套 id 空间：后台上传的行 `owner_uid` 留空，上传者记在 `infra_files.admin_uploader_id`，应用侧「本人」判断不受影响。
- 后台保存路径一律以 `MediaService.attach(…, actorUserId = null)` 关联（不做归属校验）。
- 不放在 `/admin/infra/file/…`：那里的 `POST /upload`（只登记元数据）与 `GET /get/{id}`（按自增 id 返回元数据）是已有接口，语义不变。

**错误**（App 与后台上传相同，cc002a6）：`message` 只放机器码，便于客户端翻译；具体原因放在字段级错误 `errors: [{ field, message, code }]` 里，`field` 指向出错的表单字段（`file` 或 `businessType`），`code` 与 `message` 相同。

| 机器码 | 场景 | 字段 |
| --- | --- | --- |
| `INVALID_CONTENT_TYPE` | 请求不是 multipart/form-data | — |
| `MISSING_FILE_FIELD` / `MISSING_BUSINESS_TYPE` | 缺表单字段 | `file` / `businessType` |
| `INVALID_BUSINESS_TYPE` | businessType 未注册 | `businessType` |
| `INVALID_MIME_TYPE` / `FILE_TOO_LARGE` / `EMPTY_FILE` | 违反该类型的上传策略 | `file` |
| `FILE_NOT_FOUND` / `FILE_FORBIDDEN` | 读取文件时不存在 / 无权读取 | — |

### 4.2 分片 / 断点续传（M3，未实现）

大文件和视频使用：

| 接口 | 说明 |
| --- | --- |
| `POST /app/infra/media/upload/init` | 参数：businessType、文件名、大小、MIME、整体 sha256（可选）。若内容已存在且调用者有权复用，直接返回 fileId（秒传）；否则返回 uploadId、分片大小、已完成分片 |
| `PUT /app/infra/media/upload/{uploadId}/part/{n}` | 上传一个分片（或返回对象存储的分片预签名地址，客户端直传） |
| `POST /app/infra/media/upload/{uploadId}/complete` | 校验分片和摘要，合并，返回 fileId |
| `DELETE /app/infra/media/upload/{uploadId}` | 放弃，清理已传分片 |

- 未完成的上传会话按过期时间清理。
- 校验失败（大小、MIME 嗅探、摘要不符）在 complete 时拒绝并清理。

### 4.3 服务端转存

供其他模块（如 collect 转存外链图片、content 写入外部图片）调用：`MediaService.importFromUrl(businessType, url, ownerUserId): ImportResult`。

- 只允许 http / https；拒绝带用户信息（`user@host`）、含空白的地址（`MediaImportRules.checkUrl`，纯语法）。
- 出站走不可信 URL 客户端 `port.UntrustedHttpClient`，由全进程唯一的 `GuardedHttpClientProvider` 建（[出站策略](../egress.md)）：每条连接解析一次主机名，**任一**解析结果不是公网地址即拒（IANA 特殊用途 IPv4 / IPv6 段；IPv4 映射、NAT64、6to4 按内嵌 IPv4 判断），非规范 IP 字面写法直接拒，端口须在放行列表；然后只连校验过的地址（防 DNS 重绑定），TLS 仍按原主机名做 SNI 与证书校验。
- 跟随重定向（301 / 302 / 303 / 307 / 308，GET 重发）：最多 5 跳，超过为 `TOO_MANY_REDIRECTS`；`Location` 相对当前地址解析，每一跳重新做语法检查（非 http/https 为 `URL_SCHEME_FORBIDDEN`）并经同一个客户端发出，所以每一跳都重新解析、校验地址（公网 302 到内网在第二跳被拒）。3xx 无 `Location` 为 `FETCH_FAILED`。
- 放行列表只有运维的 `application.conf [egress]`（`allowed_ports` 默认 `80,443`、`allowed_hosts`、`allowed_networks`），infra 不另设配置；非空时启动打 WARN `egress.allowlist.enabled`。
- 带超时；声明长度或实际读取超过 businessType 的 `maxSizeBytes` 拒绝；按文件头嗅探 MIME；嗅探不到时图片 / 视频 / PDF 不信任声明类型（拒绝），其他类型才用声明值；结果不在白名单拒绝。
- 走正常落盘路径，文件归属 `ownerUserId`；托管类型的结果同样是 temporary，需要再 attach。
- 结果：`ImportResult.Imported(MediaView)` / `ImportResult.Rejected(code, message)`，错误码 `INVALID_BUSINESS_TYPE` / `INVALID_URL` / `URL_SCHEME_FORBIDDEN` / `URL_TARGET_FORBIDDEN` / `URL_PORT_FORBIDDEN` / `URL_RESOLVE_FAILED` / `TOO_MANY_REDIRECTS` / `FETCH_FAILED` / `FILE_TOO_LARGE` / `INVALID_MIME_TYPE` / `EMPTY_FILE` / `NOT_AVAILABLE`（部署没有出站 HTTP 客户端）。
- 已知缺口见 §11。

## 5. 处理（M2 / M4，未实现）

### 5.1 图片

按 businessType 的 `ImagePolicy` 在上传完成后异步生成派生版本（缩略、裁剪、格式转换、质量），记录尺寸。原图保留。

### 5.2 视频

按 businessType 的 `VideoPolicy` 在上传完成后进入处理队列：

| 步骤 | 产出 |
| --- | --- |
| 探测 | 时长、分辨率、编码、码率、旋转 |
| 转码 | 按规格档（如 360p / 720p / 1080p）输出；可选 HLS 切片 |
| 截帧 | 封面候选图（作为图片派生版本） |
| 完成 | 发出 `infra.media.processed` 事件，失败发出 `infra.media.failed` |

- 处理是 infra 的标准能力；视频领域模块（播放授权、清晰度切换、统计）只消费处理结果，不重复转码。
- 处理器可替换：`MediaProcessor` 接口，默认实现调用本机 ffmpeg，也可以接云端媒体处理服务。

### 5.3 音频与附件

音频只探测时长；附件只做 MIME 嗅探和大小校验。

## 6. 关联与生命周期

### 6.1 状态

```
上传完成 ──► temporary ──attach──► attached ──最后一个引用 detach──► orphaned ──宽限期──► deleted
               │                       ▲                                   │
               └──宽限期内未关联──► deleted       └──── 宽限期内重新 attach ────┘
```

### 6.2 关联契约

M1 实际接口（`port.MediaService`，infra 在 bootstrap 里 `bindIfAbsent`，使用方 `ctx.get(port.MediaService::class)`）。owner 用 ObjectRef 的 type / id 两个字符串表达，例如 `("content.item", "1024")`；不依赖 contract.core 的类型：

```kotlin
interface MediaService {
    /** 确认关联。任何一项校验不通过都返回 Rejected，不静默放行。actorUserId 为应用账号；null 表示系统 / 后台操作（不做归属与读取权限校验）。 */
    suspend fun attach(fileId: String, ownerType: String, ownerId: String, usage: String, actorUserId: Long?): AttachResult
    /** 解除一个引用；托管文件引用数归零时进入 orphaned。返回是否真的删掉了一条引用。 */
    suspend fun detach(fileId: String, ownerType: String, ownerId: String, usage: String): Boolean
    /** 对象删除时解除它的全部引用。返回解除的条数。 */
    suspend fun detachAll(ownerType: String, ownerId: String): Int
    /** 批量展开；结果只包含访问者可读的文件（不存在、已删除、无权读取的 fileId 不出现，也不签发地址）。viewerUserId null = 匿名。 */
    suspend fun resolve(fileIds: Collection<String>, viewerUserId: Long?): Map<String, MediaView>
    /** 后台展开：任何未删除文件（含 temporary）；非公开文件给后台读取地址（ce01341）。 */
    suspend fun resolveForAdmin(fileIds: Collection<String>): Map<String, MediaView>
    suspend fun importFromUrl(businessType: String, url: String, ownerUserId: Long): ImportResult
}

sealed interface AttachResult {
    data class Attached(val fileId: String, val alreadyAttached: Boolean)   // alreadyAttached：同一引用早已存在（幂等）
    data class Rejected(val code: MediaErrorCode, val message: String)
}
data class MediaView(val fileId: String, val url: String, val mimeType: String, val size: Long,
                     val businessType: String, val lifecycle: MediaLifecycle, val expiresAt: Long? = null)   // expiresAt：签名过期 epoch 秒
enum class MediaLifecycle(val code: String) { TEMPORARY, ATTACHED, ORPHANED, DELETED }
```

`MediaErrorCode`（名字即机器码，可直接抛给前端做 i18n）：attach 用 `FILE_NOT_FOUND`、`FILE_DELETED`、`UNKNOWN_BUSINESS_TYPE`、`USAGE_NOT_ALLOWED`、`NOT_FILE_OWNER`、`NOT_REUSABLE`、`ACCESS_DENIED`、`INVALID_ARGUMENT`；importFromUrl 见 §4.3。

`attach` 的校验，任何一项不通过都拒绝：

| 校验 | 规则 |
| --- | --- |
| 存在性 | 文件存在，状态不是 deleted 或清理中 |
| 用途匹配 | 文件的 businessType 允许用于 `usage`（由 businessType 注册时声明可用于哪些用途） |
| 处理状态 | 视频等需要处理的文件，未处理完成时只能关联到声明接受处理中状态的用途（随 M4） |
| 归属 | temporary 文件只能由上传者本人关联；已关联文件被其他对象再次引用时，businessType 必须声明允许复用，且操作者对原文件有读取权限 |
| 数量与大小 | 用途可声明单个对象的引用数量上限（如评论最多 9 张图）（延后；M1 由业务模块自己限制） |

- **多重引用**：`infra_media_references(file_id, owner_type, owner_id, usage)`（V007，四列唯一）一行一个引用。删除对象只解除自己的引用，其他对象不受影响。
- **并发安全**：attach 与清理对同一文件互斥（按文件加行锁）。清理任务只处理在锁内确认引用数为 0 且已过宽限期的文件；已进入清理的文件拒绝 attach，已开始 attach 的文件不会被清理。
- **宽限期**：temporary 和 orphaned 文件的保留期按 businessType 配置（`temporaryHours` 默认 24、`orphanedDays` 默认 7），覆盖「上传后编辑很久才保存」「撤销删除」等情况。
- **清理任务** `infra-media-cleanup`（cron `41 * * * *`，单节点，锁 10 分钟）：只处理 `managedLifecycle` 的类型；每个文件在行锁内重新确认状态与引用数；内容寻址下多行可能共用一个物理对象，删除物理对象前在路径咨询锁内确认同路径没有存活记录，失败的下次重试。`SINGLE_NODE` 只是避免多节点重复扫表，正确性不依赖它。
- **V007**：`infra_files` 增加 `lifecycle`（`temporary`/`attached`/`orphaned`/`deleted`，CHECK 约束，历史行与非托管类型恒为 `attached`）、`lifecycle_at`、`purged_at`；新增 `infra_media_references`；部分索引 `(lifecycle, lifecycle_at) WHERE lifecycle <> 'attached'` 与 `path` 索引。

## 7. 访问与地址

### 7.1 访问判断

| businessType 的访问方式 | 判断 |
| --- | --- |
| `PUBLIC` | 任何人可读 |
| `OWNER` | 仅上传者可读 |
| `DELEGATED` | 逐个引用调用引用对象所属模块的 `ObjectAccessPolicy.check(viewer, owner, "view")`，**任一引用对象对访问者可见即允许**；没有引用的 temporary 文件只有上传者可读 |

**委托回调**：infra 不依赖 contract.core，只认一个端口：

```kotlin
fun interface MediaOwnerAccess {           // port.MediaOwnerAccess
    suspend fun canView(viewerUserId: Long?, ownerType: String, ownerId: String): Boolean
}
```

- 全局只有**一个**绑定，infra 在请求时 `ctx.getOrNull` 读取；没有绑定时 `DELEGATED` 文件只有上传者可读。
- 套件模块（content、comment、collect……）的 bootstrap 都写同一段 `bindIfAbsent`，先到先得；按对象类型的路由由 `contract.core.ObjectRegistry` 完成，所以谁先绑定结果都一样：

```kotlin
ctx.bindIfAbsent(port.MediaOwnerAccess::class, port.MediaOwnerAccess { viewer, type, id ->
    runCatching { objects.check(Viewer(viewer), ObjectRef(type, id), Actions.VIEW).allowed }.getOrDefault(false)
})
```

### 7.2 地址

- `PUBLIC`：可以使用长期地址（公开桶或 CDN）。
- `OWNER`、`DELEGATED`：**只签发短期签名地址**（默认 10 分钟），不生成永久公开地址。引用对象变为不可见后，不再签发新地址，已签发的地址到期失效。
- 签名地址形如 `/app/infra/file/get/{fileId}?exp=<epoch 秒>&sig=<hex>`，`sig = hex(HMAC-SHA256(key, "fileId|exp"))`，常数时间比较；密钥由 JWT 密钥按用途标签 `neton.infra.media-url.v1` 派生（不新增配置，也不与令牌签名共用同一把密钥）。签名只证明「签发时访问者可读」，到期即失效。
- 后台读取：`GET /admin/infra/media/get/{fileId}`（权限点 `infra:media:query`）可读任意未删除文件（含临时、草稿、会员可见），`private, no-store`、`nosniff`、沙箱 CSP，可执行类型按附件下载；地址由 `resolveForAdmin` 下发（相对路径，凭后台会话 Cookie，`expiresAt` 为 null），不签发能被转发出去的匿名链接。
- 同一文件既有公开引用也有私密引用时，按访问方式统一走签名地址。不因为某个引用公开，就给文件一个永久公开地址。
- `resolve` 是批量接口；处理中的视频返回 `status=processing`（随 M4）。

## 8. 事件（未实现，M1 不发事件）

| 事件 | 投递方式 |
| --- | --- |
| `infra.media.uploaded` | 可重试 |
| `infra.media.processed` / `infra.media.failed` | 可重试 |
| `infra.media.deleted` | 可重试 |

## 9. 后台

存储配置（已有）、businessType 列表（只读，展示注册结果和策略）、文件浏览（按类型、上传者、引用对象）、处理队列与失败重试、存储用量统计。

M1 已有：文件页展示生命周期与引用数；后台媒体上传 / 读取接口（§4.1、§7.2，按钮权限点 `infra:media:upload`、`infra:media:query`，V008 挂在「文件管理」页 `infra:file:query` 下，默认授予 `super_admin`；内容编辑、评论管理等需要上传 / 预览媒体的角色要同时授予这两个按钮）。其余延后。

## 10. 分期

| 期 | 内容 |
| --- | --- |
| M1（已实现） | businessType 注册表开放、临时文件与 attach / detach 校验、`DELEGATED` 访问与短期签名地址、`resolve`、并发安全清理、服务端转存；另加后台上传 / 读取与 `resolveForAdmin` |
| M2 | 图片派生版本（按首个产品的需要安排，不阻塞 M1） |
| M3 | 分片 / 断点续传、秒传 |
| M4 | 视频处理（探测、转码、截帧、HLS）、处理器可替换 |

内容平台首个闭环只依赖 M1；M2 视产品需要；M3、M4 在大文件或视频场景立项时同步排期。

## 11. 已知限制（M1）

- **SSRF**：已按解析结果拦截并钉住连接地址（见 §4.3）。不可信 URL 客户端不能配代理（代理会自行解析目标）；部署若必须经代理出网，需由代理侧执行同等出口策略。
- **multipart 上传不嗅探 MIME**：`POST /app/infra/file/upload` 与 `POST /admin/infra/media/upload` 按客户端声明的 Content-Type 对照白名单，不检查文件内容；只有 `importFromUrl` 做嗅探。后台读取接口用 `nosniff` + 沙箱 CSP + 可执行类型按附件下载降低风险，App 侧读取依赖声明类型。
- 用途级引用数量上限、视频处理中状态、事件均未实现（见文首表）。
